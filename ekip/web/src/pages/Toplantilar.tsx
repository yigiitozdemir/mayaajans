// Toplantılar: müşteri toplantıları — liste (Yaklaşan / Geçmiş) + ay takvimi; detayda notlar, kararlar, aksiyonlar, ses kaydı
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, onLive, snack, todayIso, parseD, LMON, LDAY } from '../api';
import { Icon, Link, Sayi, useStore } from '../ui';
import { Bell } from '../components/Notify';
import {
  type Meeting, type Tab, TAB_KEYS, REMIND_INFO, MeetingCard, MeetingDrawer, MeetingForm, MeetCal, byWhen, lower, longDate, needsNotes,
} from '../components/ToplantiPanels';
import '../styles/cekim.css';
import '../styles/toplanti.css';

const addDays = (s: string, n: number) => { const d = parseD(s); d.setDate(d.getDate() + n); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const urlParam = (k: string) => (location.pathname === '/toplantilar' ? new URLSearchParams(location.search).get(k) : null);
const UI_KEY = 'maya.toplanti.ui';
function loadUi(): { view?: 'list' | 'cal'; when?: 'up' | 'past' } {
  try { return JSON.parse(localStorage.getItem(UI_KEY) || '{}') || {}; } catch { return {}; }
}

export function Toplantilar({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const today = todayIso();
  const ui0 = loadUi();
  const [list, setList] = useState<Meeting[] | null>(null);
  const [view, setView] = useState<'list' | 'cal'>(ui0.view === 'cal' ? 'cal' : 'list');
  const [when, setWhen] = useState<'up' | 'past'>(ui0.when === 'past' ? 'past' : 'up');
  const [q, setQ] = useState('');
  const [firm, setFirm] = useState(() => urlParam('musteri') || 'all');
  const [mine, setMine] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [openId, setOpenId] = useState<string | null>(urlParam('id'));
  const [tab, setTab] = useState<Tab | null>(() => { const t = urlParam('sekme'); return t && (TAB_KEYS as string[]).includes(t) ? (t as Tab) : null; });
  const [form, setForm] = useState<Partial<Meeting> | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => { try { localStorage.setItem(UI_KEY, JSON.stringify({ view, when })); } catch { /* */ } }, [view, when]);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const load = async () => {
    try { setList(await api<Meeting[]>('GET', '/toplantilar')); }
    catch (e: any) { snack(e.message); setList((x) => x || []); }
  };
  useEffect(() => { load(); return onLive(['toplanti'], () => { load(); }); }, []);

  // bildirim bağlantısı: /toplantilar?id=…
  useEffect(() => {
    const f = () => { const id = urlParam('id'); if (id) { setOpenId(id); const t = urlParam('sekme'); setTab(t && (TAB_KEYS as string[]).includes(t) ? (t as Tab) : null); } };
    window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); };
  }, []);
  const opened = openId && list ? list.find((x) => x.id === openId) || null : null;
  useEffect(() => {
    if (!openId || !list) return;
    if (!opened) { snack('Toplantı bulunamadı · silinmiş olabilir'); closeDrawer(); return; }
    setMonth(opened.date.slice(0, 7));
    if (opened.date < today && !day) setWhen('past');
  }, [openId, !!list]);
  function closeDrawer() {
    setOpenId(null); setTab(null);
    if (location.search) history.replaceState({}, '', '/toplantilar');
  }
  const openMeeting = (id: string, t?: Tab) => { setOpenId(id); setTab(t || null); history.replaceState({}, '', '/toplantilar?id=' + id + (t ? '&sekme=' + t : '')); };
  const applyOne = (x: Meeting | null) => { if (x) setList((l) => (l || []).map((y) => (y.id === x.id ? x : y))); else load(); };

  const all = list || [];
  const firms = useMemo(() => Array.from(new Set([...s.clients.map((c) => c.name), ...all.map((x) => x.client).filter(Boolean)])).sort((a, b) => a.localeCompare(b, 'tr')), [s.clients, list]);
  const base = all.filter((x) =>
    (firm === 'all' || x.client === firm) &&
    (!mine || x.participants.includes(me.id) || x.createdBy === me.id) &&
    (!q || lower([x.title, x.client, x.location, x.clientAttendees, x.notes, x.agenda.map((a) => a.text).join(' ')].join(' ')).includes(lower(q))));
  const shown = day ? base.filter((x) => x.date === day) : base;
  const upcoming = shown.filter((x) => x.date >= today && !needsNotes(x, now)).sort(byWhen);
  const past = shown.filter((x) => x.date < today || needsNotes(x, now)).sort((a, b) => -byWhen(a, b));
  const waiting = all.filter((x) => needsNotes(x, now));

  const wk = addDays(today, 7);
  const stats = [
    { label: 'Bugün', value: all.filter((x) => x.date === today && x.status !== 'iptal').length, dot: 'var(--accent)' },
    { label: 'Önümüzdeki 7 gün', value: all.filter((x) => x.status === 'planlandi' && x.date > today && x.date <= wk).length, dot: 'var(--blue)' },
    { label: 'Notları bekleyen', value: waiting.length, dot: 'var(--amber)' },
    { label: 'Bu ay yapılan', value: all.filter((x) => x.status === 'yapildi' && x.date.startsWith(today.slice(0, 7))).length, dot: 'var(--green-dot)' },
  ];

  const groups = (arr: Meeting[], isPast: boolean) => {
    const out: { key: string; items: Meeting[] }[] = [];
    for (const x of arr) { const g = out[out.length - 1]; if (g && g.key === x.date) g.items.push(x); else out.push({ key: x.date, items: [x] }); }
    return out.map((g) => {
      let label = longDate(g.key), cls = '';
      if (g.key === today) { label = 'Bugün · ' + label; cls = 'today'; }
      else if (g.key === addDays(today, 1)) label = 'Yarın · ' + label;
      else if (g.key === addDays(today, -1)) label = 'Dün · ' + label;
      if (g.key.slice(0, 4) !== today.slice(0, 4)) label += ' ' + g.key.slice(0, 4);
      return <div class="ck-group"><h3 class={cls}>{label}</h3>{g.items.map((m) => <MeetingCard m={m} onOpen={openMeeting} now={now} />)}</div>;
    });
  };

  const pickDay = (d: string) => setDay(day === d ? null : d);
  const filtered = firm !== 'all' || q || mine || day;
  const newMeeting = () => setForm({ date: day || (view === 'cal' ? '' : ''), client: firm === 'all' ? '' : firm, participants: [me.id] });
  const arr = when === 'up' ? upcoming : past;

  const sections = (
    <div class="ck-main">
      {day && (
        <div class="ck-daybar" role="status">
          <span>Seçili gün: <strong>{longDate(day)}</strong> · {shown.length} toplantı</span><span class="spacer" />
          <button type="button" class="btn sm" onClick={() => setForm({ date: day, client: firm === 'all' ? '' : firm, participants: [me.id] })}>Bu güne toplantı ekle</button>
          <button type="button" class="btn sm ghost" onClick={() => setDay(null)}>Temizle</button>
        </div>
      )}
      <div class="tp-when-tabs" role="tablist" aria-label="Toplantılar">
        <button type="button" role="tab" aria-selected={when === 'up'} onClick={() => setWhen('up')}>Yaklaşan <span>{upcoming.length}</span></button>
        <button type="button" role="tab" aria-selected={when === 'past'} onClick={() => setWhen('past')}>Geçmiş <span>{past.length}</span>{waiting.length > 0 && <i class="tp-wdot" aria-label={waiting.length + ' toplantının notları bekliyor'} />}</button>
      </div>
      <section class="ck-sec" aria-label={when === 'up' ? 'Yaklaşan toplantılar' : 'Geçmiş toplantılar'}>
        {arr.length ? groups(arr, when === 'past') : (
          <div class="tp-emptybox">
            <span class="ic" aria-hidden="true"><Icon n="toplanti" size={26} /></span>
            <strong>{list === null ? 'Yükleniyor…' : filtered ? 'Bu filtrede toplantı yok.' : when === 'up' ? 'Yaklaşan toplantı yok.' : 'Geçmiş toplantı yok.'}</strong>
            {list !== null && !filtered && when === 'up' && <span>Müşteriyle bir toplantı ayarladığında buraya ekle; ekibe bildirim ve 30 dk önce hatırlatma gider.</span>}
            {list !== null && !filtered && when === 'up' && <button type="button" class="btn primary sm" onClick={newMeeting}><Icon n="plus" size={14} w={2.4} />Yeni toplantı</button>}
          </div>
        )}
      </section>
    </div>
  );

  const td = parseD(today);
  return (
    <div class="page tp-page">
      <header class="row" style="align-items:flex-end;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:6px">
          <span class="sub">{td.getDate()} {LMON[td.getMonth()]} {td.getFullYear()} · {LDAY[td.getDay()]}</span>
          <h1 class="h1">Toplantılar</h1>
          <span class="row sub" style="gap:6px"><span class="dot" style={{ background: s.online ? 'var(--green-dot)' : 'var(--red)' }} />
            {s.online ? 'Canlı · müşteri toplantıları, notlar ve ses kayıtları · ' + all.length + ' toplantı' : 'Bağlantı yok · yeniden bağlanıyor'}</span>
        </div>
        <div class="row">
          <Bell onOpenTask={openTask} />
          <div class="seg" role="group" aria-label="Görünüm">
            <button type="button" class={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>Liste</button>
            <button type="button" class={view === 'cal' ? 'on' : ''} aria-pressed={view === 'cal'} onClick={() => setView('cal')}>Takvim</button>
          </div>
          <button type="button" class="btn primary" onClick={newMeeting}><Icon n="plus" size={15} w={2.4} />Yeni toplantı</button>
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

      {waiting.length > 0 && !day && (
        <div class="tp-alert" role="status">
          <Icon n="note" size={16} />
          <span>{waiting.length === 1 ? 'Saati geçen 1 toplantının' : 'Saati geçen ' + waiting.length + ' toplantının'} notları bekleniyor — notları, kararları ve ses kaydını ekleyip durumu güncelle.</span>
          <button type="button" class="btn sm" onClick={() => { if (waiting.length === 1) openMeeting(waiting[0].id, 'notlar'); else { setWhen('past'); setView('list'); } }}>Toplantı notlarını ekle</button>
        </div>
      )}

      <div class="ck-tool">
        <label class="ck-field" style="flex:2 1 240px"><Icon n="search" size={16} /><span class="sr">Toplantı ara</span>
          <input type="search" value={q} placeholder="Toplantı, firma, not ya da gündem ara…" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
        <label class="ck-field" style="flex:1 1 200px"><span style="font-size:12px">Firma</span>
          <select value={firm} onChange={(e) => setFirm((e.target as HTMLSelectElement).value)}>
            <option value="all">Tüm firmalar</option>{firms.map((f) => <option value={f}>{f}</option>)}
          </select>
        </label>
        <button type="button" class="ck-mine" aria-pressed={mine} onClick={() => setMine(!mine)}><Icon n="user" size={15} />Benim toplantılarım <span class="tp-cnt">{all.filter((x) => x.date >= today && x.status !== 'iptal' && x.participants.includes(me.id)).length}</span></button>
        {filtered && <button type="button" class="btn" onClick={() => { setQ(''); setFirm('all'); setMine(false); setDay(null); }}>Filtreleri temizle</button>}
      </div>

      {view === 'cal' ? (
        <div class="ck-layout wide">
          <MeetCal big month={month} setMonth={setMonth} list={base} day={day} onPick={pickDay} onOpen={(id) => openMeeting(id)} />
          <div class="ck-info"><Icon n="bell" size={15} /><span>{REMIND_INFO} Güne tıklayınca o günün toplantıları aşağıda listelenir.</span></div>
          {sections}
        </div>
      ) : (
        <div class="ck-layout">
          {sections}
          <aside class="ck-rail">
            <MeetCal month={month} setMonth={setMonth} list={base} day={day} onPick={pickDay} />
            <section class="panel ck-info"><Icon n="bell" size={16} /><span><strong style="display:block;color:var(--ink);margin-bottom:2px">Hatırlatma ve takvim</strong>{REMIND_INFO} Aboneliği <b>Profilim → Takvim eşitleme</b>'den açabilirsin.</span></section>
            <section class="panel ck-info"><Icon n="mic" size={16} /><span><strong style="display:block;color:var(--ink);margin-bottom:2px">Toplantıdan sonra</strong>Notları, alınan kararları ve aksiyonları ekle; aksiyonları tek tıkla İş Planı'na aktar. Ses kaydını uygulamadan alabilir ya da dosya yükleyebilirsin.</span></section>
          </aside>
        </div>
      )}

      {opened && <MeetingDrawer m={opened} tab0={tab} openTask={openTask} onClose={closeDrawer} onEdit={() => setForm(opened)} onChanged={applyOne} reload={load} />}
      {form && <MeetingForm initial={form} firms={firms} onClose={() => setForm(null)} onSaved={(x) => {
        const isNew = !form.id; setForm(null);
        setList((l) => [...(l || []).filter((y) => y.id !== x.id), x]);
        if (isNew) { setMonth(x.date.slice(0, 7)); openMeeting(x.id); }
        load();
      }} />}
    </div>
  );
}

/** Bugün sayfası: bugünkü toplantılar (yalnızca varsa, kısa satırlar) */
export function BugunToplantilar() {
  const s = useStore();
  const [list, setList] = useState<Meeting[]>([]);
  const today = todayIso();
  useEffect(() => {
    const f = () => api<Meeting[]>('GET', '/toplantilar?gun=' + today).then(setList).catch(() => {});
    f(); return onLive(['toplanti', '*'], f);
  }, [today]);
  const items = list.filter((x) => x.status !== 'iptal').sort(byWhen);
  if (!items.length) return null;
  const now = Date.now();
  const me = s.me!.id;
  return (
    <section class="card tp-today" aria-label="Bugünkü toplantılar">
      <div class="row" style="gap:8px"><span class="tp-today-ic" aria-hidden="true"><Icon n="toplanti" size={15} /></span><h2>Bugün {items.length} toplantı</h2><span class="spacer" /><Link href="/toplantilar" class="sub">Toplantılar</Link></div>
      <div class="tp-today-l">
        {items.map((m) => {
          const st = Date.parse(m.date + 'T' + m.startTime + ':00+03:00');
          const en = m.endTime ? Date.parse(m.date + 'T' + m.endTime + ':00+03:00') : st + 3600_000;
          const tag = m.status === 'yapildi' ? 'Yapıldı' : now >= st && now <= en ? 'Şimdi' : now > en ? (needsNotes(m, now) ? 'Notları ekle' : 'Bitti') : Math.round((st - now) / 60_000) <= 90 ? Math.max(1, Math.round((st - now) / 60_000)) + ' dk sonra' : '';
          return (
            <Link href={'/toplantilar?id=' + m.id + (needsNotes(m, now) ? '&sekme=notlar' : '')} class={'tp-today-it' + (m.participants.includes(me) ? ' mine' : '')}>
              <b>{m.startTime}</b>
              <span class="t"><span class="tt">{m.title}</span><span class="sub">{[m.client, m.type === 'online' ? 'Online' : m.type === 'telefon' ? 'Telefon' : m.location || 'Yüz yüze'].filter(Boolean).join(' · ')}</span></span>
              {tag && <span class={'tag ' + (tag === 'Şimdi' ? 'today' : tag === 'Notları ekle' ? 'late' : 'soon')}>{tag}</span>}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** Müşteri kartı: o firmanın toplantıları (yaklaşan + geçmiş) */
export function MusteriToplantilari({ client }: { client: string }) {
  const [list, setList] = useState<Meeting[] | null>(null);
  const [showPast, setShowPast] = useState(false);
  const load = () => api<Meeting[]>('GET', '/toplantilar?client=' + encodeURIComponent(client)).then(setList).catch((e) => snack(e.message));
  useEffect(() => { setList(null); load(); }, [client]);
  useEffect(() => onLive(['toplanti', '*'], () => load()), [client]);
  const today = todayIso(); const now = Date.now();
  const up = (list || []).filter((x) => x.date >= today && !needsNotes(x, now)).sort(byWhen);
  const past = (list || []).filter((x) => x.date < today || needsNotes(x, now)).sort((a, b) => -byWhen(a, b));
  const go = (id: string, t?: Tab) => { history.pushState({}, '', '/toplantilar?id=' + id + (t ? '&sekme=' + t : '')); window.dispatchEvent(new Event('maya-nav')); };
  return (
    <div class="tp-mk">
      <div class="row" style="gap:8px">
        <span class="sub">{list ? (up.length ? up.length + ' yaklaşan' : 'Yaklaşan toplantı yok') + (past.length ? ' · ' + past.length + ' geçmiş' : '') : 'Yükleniyor…'}</span>
        <span class="spacer" />
        <Link href={'/toplantilar?musteri=' + encodeURIComponent(client)} class="btn sm ghost">Tüm toplantılar</Link>
      </div>
      {up.map((m) => <MeetingCard m={m} onOpen={go} showClient={false} now={now} />)}
      {list && !up.length && !past.length && <div class="tp-emptybox sm"><span class="ic" aria-hidden="true"><Icon n="toplanti" size={22} /></span><strong>{client} ile henüz toplantı kaydı yok.</strong></div>}
      {past.length > 0 && (
        <div class="tp-pastbox">
          <button type="button" class="tp-pastbtn" aria-expanded={showPast} onClick={() => setShowPast(!showPast)}>
            <span aria-hidden="true">{showPast ? '▾' : '▸'}</span>Geçmiş toplantılar <span class="sub">{past.length}</span>
          </button>
          {showPast && past.map((m) => <MeetingCard m={m} onOpen={go} showClient={false} now={now} />)}
        </div>
      )}
    </div>
  );
}
