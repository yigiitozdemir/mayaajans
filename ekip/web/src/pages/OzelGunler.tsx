// Özel Günler: yaklaşan günler, firma satırları, sorumlu, Hazırladım
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, onLive, reloadClients, snack, todayIso, parseD, DAY, LMON, memberName, fmtDate } from '../api';
import { Avatar, Icon, useStore, Sayi } from '../ui';
import { Bell } from '../components/Notify';
import { DayDetail, DayForm, prepTag, toneLabel, type SDay, type SRow } from '../components/OzelGunPanels';
import '../styles/ozelgunler.css';

const lower = (s: string) => (s || '').toLocaleLowerCase('tr');
const urlId = () => new URLSearchParams(location.search).get('id');

export function OzelGunler({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const [days, setDays] = useState<SDay[] | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [sel, setSel] = useState<string | null>(urlId());
  const [person, setPerson] = useState<string>('all'); // all | me | <userId>
  const [state, setState] = useState<'all' | 'left' | 'done'>('all');
  const [q, setQ] = useState('');
  const [showRest, setShowRest] = useState(false);
  const [form, setForm] = useState<{ day: SDay | null } | null>(null);

  async function load() {
    try { setDays(await api<SDay[]>('GET', '/days')); setLoadErr(''); }
    catch (e: any) { setLoadErr(e.message); }
  }
  useEffect(() => {
    load();
    const off = onLive(['days', 'clients'], (m) => { if (m.type === 'clients' || m.type === '*') reloadClients().catch(() => {}); load(); });
    const nav = () => { if (location.pathname === '/ozel-gunler') setSel(urlId()); };
    window.addEventListener('maya-nav', nav); window.addEventListener('popstate', nav);
    return () => { off(); window.removeEventListener('maya-nav', nav); window.removeEventListener('popstate', nav); };
  }, []);

  function pick(id: string | null) {
    setSel(id);
    history.replaceState(history.state, '', id ? '/ozel-gunler?id=' + id : '/ozel-gunler');
  }
  const replaceDay = (d: SDay) => setDays((cur) => {
    if (!cur) return [d];
    const has = cur.some((x) => x.id === d.id);
    return (has ? cur.map((x) => (x.id === d.id ? d : x)) : [...cur, d]).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name, 'tr')));
  });

  const today = todayIso();
  const pid = person === 'me' ? me.id : person;
  const scopedRows = (d: SDay): SRow[] => (pid === 'all' ? d.rows : d.rows.filter((r) => r.assigneeId === pid));
  const isComplete = (d: SDay) => { const r = scopedRows(d); return r.length > 0 && r.every((x) => x.status === 2); };

  const visible = useMemo(() => (days || []).filter((d) => {
    if (pid !== 'all' && scopedRows(d).length === 0) return false;
    if (q && !lower(d.name + ' ' + d.note + ' ' + d.rangeLabel + ' ' + d.rows.map((r) => r.client).join(' ')).includes(lower(q))) return false;
    if (state === 'left' && isComplete(d)) return false;
    if (state === 'done' && !isComplete(d)) return false;
    return true;
  }), [days, pid, q, state]);
  const upcoming = visible.filter((d) => d.date >= today && !isComplete(d));
  const rest = visible.filter((d) => d.date < today || isComplete(d)).sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
  const restOpen = showRest || state === 'done';

  // aylara böl
  const months: { key: string; label: string; days: SDay[] }[] = [];
  for (const d of upcoming) {
    const key = d.date.slice(0, 7);
    let m = months.find((x) => x.key === key);
    if (!m) { const dt = parseD(d.date); m = { key, label: LMON[dt.getMonth()] + ' ' + dt.getFullYear(), days: [] }; months.push(m); }
    m.days.push(d);
  }

  // özet (yaklaşan günler, seçili kişiye göre)
  const future = (days || []).filter((d) => d.date >= today);
  const futRows = future.flatMap((d) => scopedRows(d).map((r) => ({ d, r })));
  const stats = [
    { label: 'Hazırlığı geciken', v: futRows.filter(({ d, r }) => r.status !== 2 && d.prepDate < today).length, dot: '#f28482' },
    { label: 'Bu hafta hazırlanacak', v: futRows.filter(({ d, r }) => r.status !== 2 && d.prepDate >= today && d.prepDate <= addDays(today, 7)).length, dot: 'var(--accent)' },
    { label: 'Sorumlusu seçilmemiş', v: futRows.filter(({ r }) => r.status !== 2 && !r.assigneeId).length, dot: 'var(--wait)' },
    { label: 'Hazırlandı', v: futRows.filter(({ r }) => r.status === 2).length, dot: 'var(--green-dot)' },
  ];

  const selDay = days?.find((d) => d.id === sel) || null;
  useEffect(() => { if (days && sel && !days.some((d) => d.id === sel)) pick(null); }, [days, sel]);

  const card = (d: SDay) => {
    const rows = scopedRows(d);
    const ready = rows.filter((r) => r.status === 2).length;
    const prep = prepTag(d, rows.length - ready);
    const dd = Math.round((parseD(d.date).getTime() - parseD(today).getTime()) / 864e5);
    const people = [...new Set(rows.map((r) => r.assigneeId).filter(Boolean))] as string[];
    const unassigned = rows.filter((r) => !r.assigneeId).length;
    const dt = parseD(d.date);
    return (
      <button type="button" class={'og-card' + (sel === d.id ? ' on' : '') + (dd === 0 || dd === 1 ? ' today' : '') + (dd < 0 ? ' past' : '')}
        aria-pressed={sel === d.id} onClick={() => pick(sel === d.id ? null : d.id)}>
        <span class="og-date"><span class="n">{dt.getDate()}</span><span class="w">{DAY[dt.getDay()]}</span></span>
        <span class="og-mid">
          <span class="og-name">{d.star && <span class="og-star" aria-label="Önemli gün">★</span>}<span>{d.name}</span></span>
          <span class="og-meta">
            {dd === 0 && <span class="daytag">Bugün</span>}{dd === 1 && <span class="daytag">Yarın</span>}
            <span class={'tone ' + d.tone}>{toneLabel(d.tone)}</span>
            {d.rangeLabel && <span>{d.rangeLabel}</span>}
            {dd >= 0 && <span class={'prep ' + prep.cls}>{prep.label}</span>}
            {dd < 0 && <span>{fmtDate(d.date)}</span>}
          </span>
        </span>
        <span class="og-right">
          {rows.length ? (
            <>
              <span class="og-prog">{ready}/{rows.length} hazır{rows.length - ready > 0 ? ' · ' + (rows.length - ready) + ' kaldı' : ''}</span>
              <span class="og-bar"><span style={{ width: Math.round((ready / rows.length) * 100) + '%' }} /></span>
              <span class="og-avs">
                {people.slice(0, 5).map((id) => <span title={memberName(s.team, id)}><Avatar m={s.team.find((m) => m.id === id)} size={20} radius={6} /></span>)}
                {unassigned > 0 && <span class="chip" style="font-size:11px;padding:1px 7px" title="Sorumlusu seçilmemiş firma">{unassigned} atanmamış</span>}
              </span>
            </>
          ) : <span class="og-nofirm">Firma eklenmedi</span>}
        </span>
      </button>
    );
  };

  const others = s.team.filter((m) => m.id !== me.id);
  return (
    <div class="page">
      <header class="row" style="align-items:flex-end;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:6px">
          <h1 class="h1">Özel Günler</h1>
          <span class="row sub" style="gap:6px"><span class="dot" style={{ background: s.online ? 'var(--green-dot)' : 'var(--red)' }} />
            {s.online ? 'Canlı · ekipteki herkes ne hazır, ne kaldı aynı anda görür' : 'Bağlantı yok · yeniden bağlanıyor'}</span>
        </div>
        <div class="row">
          <Bell onOpenTask={openTask} />
          <button type="button" class="btn primary" onClick={() => setForm({ day: null })}><Icon n="plus" size={16} />Yeni özel gün</button>
        </div>
      </header>

      <div class="stats">
        {stats.map((st) => (
          <div class="stat"><span class="row sub" style="gap:8px;color:var(--mute)"><span class="dot" style={{ background: st.dot }} />{st.label}</span><span class="v"><Sayi v={st.v} /></span></div>
        ))}
      </div>

      <div class="og-filters">
        <div class="seg" role="group" aria-label="Kişi">
          <button type="button" class={person === 'all' ? 'on' : ''} aria-pressed={person === 'all'} onClick={() => setPerson('all')}>Herkes</button>
          <button type="button" class={person === 'me' ? 'on' : ''} aria-pressed={person === 'me'} onClick={() => setPerson('me')}>Benim görevlerim</button>
        </div>
        <label class={'og-sel' + (person !== 'all' && person !== 'me' ? ' on' : '')}>Kişi
          <select value={person !== 'all' && person !== 'me' ? person : ''} onChange={(e) => setPerson((e.target as HTMLSelectElement).value || 'all')}>
            <option value="">Seç…</option>{others.map((m) => <option value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <div class="seg" role="group" aria-label="Durum">
          {([['all', 'Tümü'], ['left', 'Kalanlar'], ['done', 'Hazır']] as const).map(([k, l]) => (
            <button type="button" class={state === k ? 'on' : ''} aria-pressed={state === k} onClick={() => setState(k)}>{l}</button>
          ))}
        </div>
        <label class="og-search"><Icon n="search" size={16} /><span class="sr">Özel günlerde ara</span>
          <input type="search" value={q} placeholder="Gün, firma veya not ara…" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
      </div>

      {loadErr && <p class="errtext" role="alert">{loadErr}</p>}
      {!days && !loadErr && <p class="empty">Yükleniyor…</p>}

      {days && (
        <div class={'og-wrap' + (selDay ? ' has-sel' : '')}>
          <div class="og-list">
            {months.map((m) => (
              <section class="og-month" aria-label={m.label}>
                <h2>{m.label}</h2>
                {m.days.map(card)}
              </section>
            ))}
            {upcoming.length === 0 && <p class="empty card">{state === 'done' ? 'Tamamen hazır günler aşağıda.' : 'Bu filtrede yaklaşan özel gün yok.'}</p>}
            {rest.length > 0 && (
              <section style="display:flex;flex-direction:column;gap:8px">
                <div class="og-section-h">
                  <span class="dot" style="background:var(--green-dot)" />
                  <strong style="font-size:15px">Hazır ve geçmiş günler <span style="font-weight:500;color:var(--mute2)">{rest.length}</span></strong>
                  <span class="sub">En yeni tarih üstte</span><span class="spacer" />
                  {state !== 'done' && <button type="button" class="btn sm" aria-expanded={restOpen} onClick={() => setShowRest(!showRest)}>{restOpen ? 'Gizle' : 'Göster'}</button>}
                </div>
                {restOpen && rest.map(card)}
              </section>
            )}
          </div>
          <div class="og-detail">
            {selDay
              ? <DayDetail day={selDay} openTask={openTask} onBack={() => pick(null)} onChange={replaceDay}
                  onEdit={() => setForm({ day: selDay })} onDeleted={() => { setDays((cur) => (cur || []).filter((x) => x.id !== selDay.id)); pick(null); }} />
              : <Overview days={days} today={today} onPick={pick} />}
          </div>
        </div>
      )}

      {form && <DayForm day={form.day} onClose={() => setForm(null)} onSaved={(d) => { setForm(null); replaceDay(d); pick(d.id); }} />}
    </div>
  );
}

function addDays(iso: string, n: number) {
  const d = parseD(iso); d.setDate(d.getDate() + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Gün seçilmemişken sağ panel: önümüzdeki 14 gün ekip durumu ve son hazırlananlar
function Overview({ days, today, onPick }: { days: SDay[]; today: string; onPick: (id: string) => void }) {
  const s = useStore();
  const end = addDays(today, 14);
  const rows = days.filter((d) => d.date >= today && d.date <= end).flatMap((d) => d.rows);
  const people = s.team.map((m) => {
    const mine = rows.filter((r) => r.assigneeId === m.id);
    return { m, total: mine.length, ready: mine.filter((r) => r.status === 2).length };
  }).filter((p) => p.total > 0);
  const unassigned = rows.filter((r) => !r.assigneeId && r.status !== 2).length;
  const recent = days.flatMap((d) => d.rows.filter((r) => r.status === 2 && r.doneAt).map((r) => ({ d, r })))
    .sort((a, b) => (a.r.doneAt! > b.r.doneAt! ? -1 : 1)).slice(0, 6);
  const next = days.find((d) => d.date >= today);
  return (
    <section class="og-panel" aria-label="Genel bakış">
      <div style="display:flex;flex-direction:column;gap:4px">
        <h2 style="font-size:20px">Ne hazır, ne kaldı?</h2>
        <span class="sub">Önümüzdeki 14 gün · soldan bir gün seçince firmaları ve sorumluları burada açılır</span>
      </div>
      <div class="og-people">
        <strong style="font-size:13px">Ekip durumu</strong>
        {people.map((p) => (
          <div class="og-person">
            <Avatar m={p.m} size={28} />
            <span class="b">
              <span class="l"><span style="font-weight:600">{p.m.name}</span><span class="sub">{p.ready}/{p.total} hazır</span></span>
              <span class="og-bar"><span style={{ width: Math.round((p.ready / p.total) * 100) + '%' }} /></span>
            </span>
          </div>
        ))}
        {people.length === 0 && <p class="empty" style="padding:0">Önümüzdeki 14 günde kimseye özel gün görevi seçilmemiş. Bir gün seç, firmaları ekle ve sorumluyu belirle.</p>}
        {unassigned > 0 && <span class="sub" style="color:var(--red)">{unassigned} firma satırının sorumlusu seçilmemiş.</span>}
      </div>
      {recent.length > 0 && (
        <div class="og-people">
          <strong style="font-size:13px">Son hazırlananlar</strong>
          {recent.map(({ d, r }) => (
            <button type="button" class="nitem" style="padding:8px 10px;align-items:center" onClick={() => onPick(d.id)}>
              <Avatar m={s.team.find((m) => m.id === r.doneBy)} size={24} radius={7} />
              <span style="flex:1;min-width:0;font-size:13px"><strong>{memberName(s.team, r.doneBy)}</strong> · {r.client} · {d.name}</span>
            </button>
          ))}
        </div>
      )}
      {next && <button type="button" class="btn" onClick={() => onPick(next.id)}>Sıradaki güne git · {next.name}</button>}
      {!next && <button type="button" class="btn" onClick={() => snack('Yaklaşan özel gün yok')}>Yaklaşan gün yok</button>}
    </section>
  );
}
