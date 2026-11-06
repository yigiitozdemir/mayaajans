// Çekim Planı
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, onLive, snack, todayIso, parseD, LMON, LDAY, DAY } from '../api';
import { Icon, useStore, Sayi } from '../ui';
import { Bell } from '../components/Notify';
import { ClientMark, findClient } from '../components/ClientMark';
import {
  type Shoot, type HavaMap, STATUS, REMIND_INFO, HAVA_INFO, ShootForm, ShootDrawer, MonthCal, CrewStack, HavaRozet,
  lower, longDate, isLate, byWhenAsc, byWhenDesc,
} from '../components/CekimPanels';
import '../styles/cekim.css';

const addDays = (s: string, n: number) => { const d = parseD(s); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const urlId = () => (location.pathname === '/cekim' ? new URLSearchParams(location.search).get('id') : null);
const UI_KEY = 'maya.cekim.ui';
function loadUi(): { view?: 'list' | 'cal'; showDone?: boolean; showCancel?: boolean } {
  try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch { return {}; }
}

export function Cekim({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const today = todayIso();
  const ui0 = loadUi();
  const [shoots, setShoots] = useState<Shoot[] | null>(null);
  const [view, setView] = useState<'list' | 'cal'>(ui0.view === 'cal' ? 'cal' : 'list');
  const [q, setQ] = useState('');
  const [firm, setFirm] = useState('all');
  const [mine, setMine] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [showDone, setShowDone] = useState(!!ui0.showDone);
  const [showCancel, setShowCancel] = useState(!!ui0.showCancel);
  const [openId, setOpenId] = useState<string | null>(urlId());
  const [form, setForm] = useState<Partial<Shoot> | null>(null);
  const [hava, setHava] = useState<HavaMap>({});

  useEffect(() => { try { localStorage.setItem(UI_KEY, JSON.stringify({ view, showDone, showCancel })); } catch { /* */ } }, [view, showDone, showCancel]);

  // hava durumu ayrı yüklenir (yavaşlarsa liste beklemez; hata olursa sessizce gösterilmez)
  const loadHava = () => { api<HavaMap>('GET', '/shoots/hava').then(setHava).catch(() => {}); };
  const load = async () => {
    try { setShoots(await api<Shoot[]>('GET', '/shoots')); loadHava(); }
    catch (e: any) { snack(e.message); setShoots((x) => x || []); }
  };
  useEffect(() => { load(); return onLive(['shoots'], () => { load(); }); }, []);

  // bildirim bağlantısı: /cekim?id=…
  useEffect(() => {
    const f = () => { const id = urlId(); if (id) setOpenId(id); };
    window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); };
  }, []);
  const opened = openId && shoots ? shoots.find((x) => x.id === openId) || null : null;
  useEffect(() => {
    if (!openId || !shoots) return;
    if (!opened) { snack('Çekim bulunamadı · silinmiş olabilir'); closeDrawer(); return; }
    setMonth(opened.date.slice(0, 7));
    if (opened.status === 1) setShowDone(true);
    if (opened.status === 2) setShowCancel(true);
  }, [openId, !!shoots]);
  function closeDrawer() {
    setOpenId(null);
    if (location.search) history.replaceState({}, '', '/cekim');
  }
  const openShoot = (id: string) => { setOpenId(id); history.replaceState({}, '', '/cekim?id=' + id); };
  const applyOne = (x: Shoot | null) => { if (x) { setShoots((l) => (l || []).map((y) => (y.id === x.id ? x : y))); loadHava(); } else load(); };

  const all = shoots || [];
  const firms = useMemo(() => Array.from(new Set([...s.clients.map((c) => c.name), ...all.map((x) => x.client).filter(Boolean)])).sort((a, b) => a.localeCompare(b, 'tr')), [s.clients, shoots]);
  const base = all.filter((x) =>
    (firm === 'all' || x.client === firm) &&
    (!mine || x.crew.includes(me.id)) &&
    (!q || lower([x.title, x.client, x.location, x.note, x.time].join(' ')).includes(lower(q))));
  const list = day ? base.filter((x) => x.date === day) : base;
  const planned = list.filter((x) => x.status === 0).sort(byWhenAsc);
  const doneL = list.filter((x) => x.status === 1).sort(byWhenDesc);
  const cancelL = list.filter((x) => x.status === 2).sort(byWhenDesc);
  const lateN = all.filter(isLate).length;

  const wk = addDays(today, 7);
  const stats = [
    { label: 'Bugün', value: all.filter((x) => x.date === today && x.status !== 2).length, dot: 'var(--accent)' },
    { label: 'Önümüzdeki 7 gün', value: all.filter((x) => x.status === 0 && x.date > today && x.date <= wk).length, dot: '#5B8DEF' },
    { label: 'Planlanan', value: all.filter((x) => x.status === 0 && x.date >= today).length, dot: '#5B8DEF' },
    { label: 'Bu ay tamamlanan', value: all.filter((x) => x.status === 1 && x.date.startsWith(today.slice(0, 7))).length, dot: 'var(--green-dot)' },
  ];

  async function markDone(x: Shoot) {
    try { applyOne(await api<Shoot>('PATCH', '/shoots/' + x.id, { status: 1 })); snack('"' + x.title + '" tamamlandı · Tamamlanan bölümüne taşındı'); }
    catch (e: any) { snack(e.message); }
  }

  const card = (x: Shoot) => {
    const late = isLate(x);
    const doneN = x.checks.filter((c) => c.done).length;
    const d = parseD(x.date);
    const hv = x.status === 0 && x.outdoor ? hava[x.id] : undefined;
    return (
      <div class={'ck-card' + (late ? ' late' : '') + (x.status === 2 ? ' cancel' : '') + (findClient(s.clients, x.client)?.color ? ' stripe' : '')} style={findClient(s.clients, x.client)?.color ? { '--stripe': findClient(s.clients, x.client)!.color } : undefined}>
        <span class="ck-when"><b>{x.time || '—'}</b><span>{DAY[d.getDay()]} · {d.getDate()} {LMON[d.getMonth()].slice(0, 3)}</span></span>
        <button type="button" class="ck-body" onClick={() => openShoot(x.id)} aria-label={x.title + ' çekiminin detayını aç'}>
          <span class="ck-top">
            <span class="ck-title">{x.title}</span>
            {late ? <span class="ck-st late">Geçti, durumu güncelle</span> : <span class={'ck-st ' + STATUS[x.status].cls}>{STATUS[x.status].label}</span>}
          </span>
          <span class="ck-meta">
            <span class="cline"><ClientMark name={x.client} size={16} /><span>{x.client || '—'}</span></span>
            {x.location && <span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></svg>{x.location}</span>}
            {x.checks.length > 0 && <span style={doneN === x.checks.length ? 'color:var(--green)' : ''}><Icon n="check" size={12} />Hazırlık {doneN}/{x.checks.length}</span>}
            {x.outdoor && !hv && x.status === 0 && <span class="ck-outtag"><Icon n="sun" size={12} />Dış çekim</span>}
            {hv && <HavaRozet h={hv} />}
          </span>
          {hv?.risk && <span class="ck-hava-w"><Icon n="uyari" size={13} />{hv.reason}</span>}
          {x.note && <span class="ck-note">{x.note}</span>}
        </button>
        <span class="ck-side">
          <CrewStack ids={x.crew} />
          {x.status === 0 && x.date <= today && <button type="button" class="btn sm" onClick={() => markDone(x)}><Icon n="check" size={13} w={2.6} />Çekildi</button>}
        </span>
      </div>
    );
  };

  const groups = (arr: Shoot[]) => {
    const out: { key: string; items: Shoot[] }[] = [];
    for (const x of arr) { const g = out[out.length - 1]; if (g && g.key === x.date) g.items.push(x); else out.push({ key: x.date, items: [x] }); }
    return out.map((g) => {
      let label = longDate(g.key), cls = '';
      if (g.key === today) { label = 'Bugün · ' + label; cls = 'today'; }
      else if (g.key === addDays(today, 1)) label = 'Yarın · ' + label;
      else if (g.key < today && arr === planned) { label += ' · geçti'; cls = 'late'; }
      if (g.key.slice(0, 4) !== today.slice(0, 4)) label += ' ' + g.key.slice(0, 4);
      return <div class="ck-group"><h3 class={cls}>{label}</h3>{g.items.map(card)}</div>;
    });
  };

  const sub = (key: 'done' | 'cancel', title: string, hint: string, arr: Shoot[], shown: boolean, toggle: () => void, dot: string) => (
    <section class={'ck-sec sub' + (key === 'cancel' ? ' muted' : '')} aria-label={title}>
      <div class="ck-sec-h">
        <span class={'dot ' + dot} /><h2>{title}<span>{arr.length}</span></h2>
        <span class="sub">{hint}</span><span class="spacer" />
        <button type="button" class="btn sm" aria-expanded={shown} onClick={toggle}>{shown ? 'Gizle' : 'Göster'}</button>
      </div>
      {shown && (arr.length ? groups(arr) : <p class="empty">{key === 'done' ? 'Tamamlanan çekim yok.' : 'İptal edilen çekim yok.'}</p>)}
    </section>
  );

  const pickDay = (d: string) => setDay(day === d ? null : d);
  const filtered = firm !== 'all' || q || mine || day;

  const sections = (
    <div class="ck-main">
      {day && (
        <div class="ck-daybar" role="status">
          <span>Seçili gün: <strong>{longDate(day)}</strong> · {list.length} çekim</span><span class="spacer" />
          <button type="button" class="btn sm" onClick={() => setForm({ date: day, client: firm === 'all' ? '' : firm, crew: mine ? [me.id] : [] })}>Bu güne çekim ekle</button>
          <button type="button" class="btn sm ghost" onClick={() => setDay(null)}>Temizle</button>
        </div>
      )}
      <section class="ck-sec" aria-label="Planlanan">
        <div class="ck-sec-h"><span class="dot ck-dot0" /><h2>Planlanan<span>{planned.length}</span></h2><span class="sub">Yaklaşan tarih üstte</span></div>
        {planned.length ? groups(planned) : <p class="empty">{shoots === null ? 'Yükleniyor…' : filtered ? 'Bu filtrede planlanmış çekim yok.' : 'Planlanmış çekim yok. “Yeni çekim” ile ekle.'}</p>}
      </section>
      {sub('done', 'Tamamlanan', 'En yeni çekim üstte', doneL, showDone, () => setShowDone(!showDone), 'ck-dot1')}
      {sub('cancel', 'İptal', 'En yeni üstte', cancelL, showCancel, () => setShowCancel(!showCancel), 'ck-dot2')}
    </div>
  );

  const td = parseD(today);
  return (
    <div class="page">
      <header class="row" style="align-items:flex-end;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:6px">
          <span class="sub">{td.getDate()} {LMON[td.getMonth()]} {td.getFullYear()} · {LDAY[td.getDay()]}</span>
          <h1 class="h1">Çekim Planı</h1>
          <span class="row sub" style="gap:6px"><span class="dot" style={{ background: s.online ? 'var(--green-dot)' : 'var(--red)' }} />
            {s.online ? 'Canlı · Slack “Çekim Programı” listesinden aktarıldı · ' + all.length + ' çekim' : 'Bağlantı yok · yeniden bağlanıyor'}</span>
        </div>
        <div class="row">
          <Bell onOpenTask={openTask} />
          <div class="seg" role="group" aria-label="Görünüm">
            <button type="button" class={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>Liste</button>
            <button type="button" class={view === 'cal' ? 'on' : ''} aria-pressed={view === 'cal'} onClick={() => setView('cal')}>Takvim</button>
          </div>
          <button type="button" class="btn primary" onClick={() => setForm({ date: day || '', client: firm === 'all' ? '' : firm, crew: mine ? [me.id] : [] })}><Icon n="plus" size={15} w={2.4} />Yeni çekim</button>
        </div>
      </header>

      <div class="stats">
        {stats.map((st) => (
          <div class="stat">
            <span class="row sub" style="gap:8px;color:var(--mute)"><span class="dot" style={{ background: st.dot }} />{st.label}</span>
            <span class="v"><Sayi v={st.value} /></span>
          </div>
        ))}
      </div>

      {lateN > 0 && !day && (
        <div class="ck-alert" role="status"><Icon n="cam" size={16} />Tarihi geçmiş {lateN} çekim hâlâ “Planlandı” görünüyor — çekildiyse ya da iptal olduysa durumunu güncelle.</div>
      )}

      <div class="ck-tool">
        <label class="ck-field" style="flex:2 1 240px"><Icon n="search" size={16} /><span class="sr">Çekim ara</span>
          <input type="search" value={q} placeholder="Çekim, firma veya lokasyon ara…" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
        <label class="ck-field" style="flex:1 1 200px"><span style="font-size:12px">Firma</span>
          <select value={firm} onChange={(e) => setFirm((e.target as HTMLSelectElement).value)}>
            <option value="all">Tüm firmalar</option>{firms.map((f) => <option value={f}>{f}</option>)}
          </select>
        </label>
        <button type="button" class="ck-mine" aria-pressed={mine} onClick={() => setMine(!mine)}><Icon n="user" size={15} />Benim çekimlerim <span style="color:var(--mute2);font-weight:500">{all.filter((x) => x.status === 0 && x.crew.includes(me.id)).length}</span></button>
        {filtered && <button type="button" class="btn" onClick={() => { setQ(''); setFirm('all'); setMine(false); setDay(null); }}>Filtreleri temizle</button>}
      </div>

      {view === 'cal' ? (
        <div class="ck-layout wide">
          <MonthCal big month={month} setMonth={setMonth} shoots={base} day={day} onPick={pickDay} />
          <div class="ck-info"><Icon n="bell" size={15} /><span>{REMIND_INFO} Güne tıklayınca o günün çekimleri aşağıda listelenir.</span></div>
          {sections}
        </div>
      ) : (
        <div class="ck-layout">
          {sections}
          <aside class="ck-rail">
            <MonthCal month={month} setMonth={setMonth} shoots={base} day={day} onPick={pickDay} />
            <section class="panel ck-info"><Icon n="bell" size={16} /><span><strong style="display:block;color:var(--ink);margin-bottom:2px">Çekim hatırlatması</strong>{REMIND_INFO}</span></section>
            <section class="panel ck-info"><Icon n="bulut" size={16} /><span><strong style="display:block;color:var(--ink);margin-bottom:2px">Hava durumu</strong>{HAVA_INFO}</span></section>
          </aside>
        </div>
      )}

      {opened && <ShootDrawer shoot={opened} hava={opened.outdoor && opened.status === 0 ? hava[opened.id] : undefined} onClose={closeDrawer} onEdit={() => setForm(opened)} onChanged={applyOne} />}
      {form && <ShootForm initial={form} firms={firms} onClose={() => setForm(null)} onSaved={(x) => { setForm(null); setShoots((l) => [...(l || []).filter((y) => y.id !== x.id), x]); if (!form.id) setMonth(x.date.slice(0, 7)); load(); }} />}
    </div>
  );
}
