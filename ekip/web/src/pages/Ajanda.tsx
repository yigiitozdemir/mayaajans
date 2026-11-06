// Ajandam: kişiye özel notlar, yapılacaklar, takvim ve anımsatıcılar (yalnızca sahibi görür)
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, onLive, snack, LMON, LDAY } from '../api';
import { useStore, navigate, Icon } from '../ui';
import { Bell } from '../components/Notify';
import { type Agenda, type Todo, type Ev, type Note, agendaApi, istToday, monthDays, occursOn, typing, addDays } from '../components/AjandaData';
import { TodoPanel, TodoModal, RemindPanel } from '../components/AjandaTodos';
import { MonthCal, DayPanel, EventModal, type CalItem } from '../components/AjandaCal';
import { NotesView } from '../components/AjandaNotes';
import '../styles/ajanda.css';

interface ShootLite { id: string; title: string; client: string; date: string; time: string; status: number; crew: string[] }
interface DayLite { id: string; name: string; date: string; rows: { client: string; assigneeId: string | null; status: number }[] }
type Tab = 'todo' | 'cal' | 'notes';

function useNarrow() {
  const mq = useMemo(() => window.matchMedia('(max-width: 760px)'), []);
  const [n, setN] = useState(mq.matches);
  useEffect(() => { const f = () => setN(mq.matches); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f); }, []);
  return n;
}
const params = () => (location.pathname === '/ajanda' ? new URLSearchParams(location.search) : new URLSearchParams());
const timeKey = (t: string) => (/^\d{1,2}[:.]\d{2}/.test(t) ? t.padStart(5, '0') : t ? '99' + t : '');

export function Ajanda({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const narrow = useNarrow();
  const today = istToday();
  const [data, setData] = useState<Agenda | null>(null);
  const [shoots, setShoots] = useState<ShootLite[]>([]);
  const [days, setDays] = useState<DayLite[]>([]);
  const [tab, setTab] = useState<Tab>(() => (params().get('not') ? 'notes' : (() => { try { return (localStorage.getItem('maya.ajanda.tab') as Tab) || 'todo'; } catch { return 'todo'; } })()));
  const [month, setMonth] = useState(today.slice(0, 7));
  const [sel, setSel] = useState(today);
  const [noteId, setNoteId] = useState<string | null>(params().get('not'));
  const [todoOpen, setTodoOpen] = useState<Todo | null>(null);
  const [evOpen, setEvOpen] = useState<(Partial<Ev> & { date: string }) | null>(null);
  const [hl, setHl] = useState<string | null>(null);
  const [wantNew, setWantNew] = useState(false);
  const [urlReq, setUrlReq] = useState<URLSearchParams>(params());
  const todoInput = useRef<HTMLInputElement>(null);

  useEffect(() => { try { localStorage.setItem('maya.ajanda.tab', tab); } catch { /* */ } }, [tab]);
  // geniş ekranda Yapılacaklar ve Takvim aynı görünümde
  const view: Tab = tab === 'notes' ? 'notes' : narrow ? tab : 'todo';

  const load = async () => {
    try { setData(await agendaApi.load()); } catch (e: any) { snack(e.message); setData((d) => d || { notes: [], todos: [], events: [] }); }
  };
  const loadShoots = () => api<ShootLite[]>('GET', '/shoots').then(setShoots).catch(() => {});
  const loadDays = () => api<DayLite[]>('GET', '/days').then(setDays).catch(() => {});
  useEffect(() => {
    load(); loadShoots(); loadDays();
    const a = onLive(['agenda'], () => load());
    const b = onLive(['shoots'], () => loadShoots());
    const c = onLive(['days'], () => loadDays());
    return () => { a(); b(); c(); };
  }, []);

  // bağlantıdan açılış: /ajanda?not=… · ?r=<yapılacak/etkinlik> · ?gun=YYYY-MM-DD
  useEffect(() => {
    const f = () => { if (location.pathname === '/ajanda') setUrlReq(params()); };
    window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); };
  }, []);
  useEffect(() => {
    if (!data) return;
    const not = urlReq.get('not'), rid = urlReq.get('r'), gun = urlReq.get('gun');
    if (not) {
      if (data.notes.some((n) => n.id === not)) { setTab('notes'); setNoteId(not); }
      else { snack('Not bulunamadı · silinmiş olabilir'); history.replaceState({}, '', '/ajanda'); }
    } else if (rid) {
      const t = data.todos.find((x) => x.id === rid), e = data.events.find((x) => x.id === rid);
      if (t) {
        setTab('todo'); setHl(t.id); setTodoOpen(t);
        if (t.dueDate) { setSel(t.dueDate); setMonth(t.dueDate.slice(0, 7)); }
        setTimeout(() => document.getElementById('aj-' + t.id)?.scrollIntoView({ block: 'center' }), 50);
      } else if (e) {
        const d = e.repeat !== 'none' && e.date < today ? today : e.date;
        setTab('cal'); setSel(d); setMonth(d.slice(0, 7)); setEvOpen(e);
      } else snack('Kayıt bulunamadı · silinmiş olabilir');
      history.replaceState({}, '', '/ajanda');
    } else if (gun && /^\d{4}-\d{2}-\d{2}$/.test(gun)) { setTab('cal'); setSel(gun); setMonth(gun.slice(0, 7)); history.replaceState({}, '', '/ajanda'); }
  }, [urlReq, !!data]);
  useEffect(() => { if (!hl) return; const t = setTimeout(() => setHl(null), 4000); return () => clearTimeout(t); }, [hl]);

  const openNote = (id: string | null) => {
    setNoteId(id);
    history.replaceState({}, '', id ? '/ajanda?not=' + id : '/ajanda');
  };

  // klavye: N yeni not, T yeni yapılacak (yazı alanında değilken)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e) || document.querySelector('.overlay, .aj-lb')) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setTab('notes'); setWantNew(true); }
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); setTab('todo'); setTimeout(() => todoInput.current?.focus(), 30); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);

  const todos = data?.todos || [];
  const events = data?.events || [];
  const notes = data?.notes || [];
  const setTodos = (f: (l: Todo[]) => Todo[]) => setData((d) => (d ? { ...d, todos: f(d.todos) } : d));
  const setEvents = (f: (l: Ev[]) => Ev[]) => setData((d) => (d ? { ...d, events: f(d.events) } : d));
  const setNotes = (f: (l: Note[]) => Note[]) => setData((d) => (d ? { ...d, notes: f(d.notes) } : d));
  const putTodo = (t: Todo) => setTodos((l) => (l.some((x) => x.id === t.id) ? l.map((x) => (x.id === t.id ? t : x)) : [...l, t]));
  const putEvent = (e: Ev) => setEvents((l) => (l.some((x) => x.id === e.id) ? l.map((x) => (x.id === e.id ? e : x)) : [...l, e]));

  // takvim öğeleri: görünen ayın 6 haftası + seçili gün
  const itemsMap = useMemo(() => {
    const m = new Map<string, CalItem[]>();
    const range = new Set([...monthDays(month), sel, today, addDays(today, 1)]);
    const push = (d: string, x: CalItem) => { if (!range.has(d)) return; const a = m.get(d) || []; a.push(x); m.set(d, a); };
    for (const d of range) for (const e of events) if (occursOn(e.date, e.repeat, d)) {
      push(d, { key: e.id + d, kind: 'event', title: e.title, time: e.start ? e.start + (e.end ? '–' + e.end : '') : '', color: e.color, sub: e.repeat !== 'none' ? 'tekrarlı' : e.note, open: () => setEvOpen(e) });
    }
    for (const t of todos) if (t.dueDate) push(t.dueDate, { key: t.id, kind: 'todo', title: t.title, time: t.dueTime || '', done: t.done, sub: t.done ? 'tamamlandı' : t.star ? 'önemli' : '', open: () => setTodoOpen(t) });
    for (const t of s.tasks) if (t.assigneeId === me.id && t.status !== 2 && t.dueDate) push(t.dueDate, { key: t.id, kind: 'task', title: t.title, time: '', sub: t.client || 'İş Planı', open: () => openTask(t.id) });
    for (const x of shoots) if (x.status === 0 && x.crew.includes(me.id)) push(x.date, { key: x.id, kind: 'shoot', title: x.title, time: x.time, sub: x.client, open: () => navigate('/cekim?id=' + x.id) });
    for (const d of days) {
      const mine = d.rows.filter((r) => r.assigneeId === me.id && r.status !== 2);
      if (mine.length) push(d.date, { key: d.id, kind: 'day', title: d.name, time: '', sub: mine.map((r) => r.client).join(', '), open: () => navigate('/ozel-gunler?id=' + d.id) });
    }
    for (const a of m.values()) a.sort((x, y) => (timeKey(x.time) < timeKey(y.time) ? -1 : timeKey(x.time) > timeKey(y.time) ? 1 : 0));
    return m;
  }, [month, sel, today, events, todos, s.tasks, shoots, days, me.id]);
  const itemsFor = (d: string) => itemsMap.get(d) || [];

  const openItem = (id: string) => {
    const t = todos.find((x) => x.id === id); if (t) { setTodoOpen(t); return; }
    const e = events.find((x) => x.id === id); if (e) setEvOpen(e);
  };

  const todayItems = itemsFor(today);
  const count = (k: CalItem['kind']) => todayItems.filter((x) => x.kind === k && !x.done).length;
  const summary = [[count('todo'), 'yapılacak'], [count('event'), 'etkinlik'], [count('task'), 'iş teslimi'], [count('shoot'), 'çekim'], [count('day'), 'özel gün']]
    .filter(([n]) => n).map(([n, l]) => n + ' ' + l);
  const tomorrowN = itemsFor(addDays(today, 1)).length;

  const td = new Date(today + 'T00:00:00Z');
  const tabs: [Tab, string][] = narrow ? [['todo', 'Yapılacaklar'], ['cal', 'Takvim'], ['notes', 'Notlar']] : [['todo', 'Ajanda'], ['notes', 'Notlar']];
  const isOn = (k: Tab) => (k === 'notes' ? view === 'notes' : narrow ? view === k : view !== 'notes');

  return (
    <div class="page aj">
      <header class="row" style="align-items:flex-end;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
          <span class="sub">{td.getUTCDate()} {LMON[td.getUTCMonth()]} {td.getUTCFullYear()} · {LDAY[td.getUTCDay()]}</span>
          <h1 class="h1">Ajandam</h1>
          <span class="row sub" style="gap:6px"><Icon n="lock" size={13} />Yalnızca sen görürsün · Bugün: {summary.length ? summary.join(' · ') : 'boş'}</span>
        </div>
        <div class="row aj-hright">
          <Bell onOpenTask={openTask} />
          <div class="seg" role="tablist" aria-label="Ajandam bölümleri">
            {tabs.map(([k, l]) => (
              <button type="button" role="tab" aria-selected={isOn(k)} class={isOn(k) ? 'on' : ''} onClick={() => setTab(k)}>
                {l}{k === 'notes' && notes.length ? <span class="aj-cnt">{notes.length}</span> : null}
              </button>
            ))}
          </div>
          {view === 'notes'
            ? <button type="button" class="btn primary" onClick={() => setWantNew(true)}><Icon n="plus" size={15} w={2.4} />Yeni not</button>
            : <button type="button" class="btn primary" onClick={() => setEvOpen({ date: sel })}><Icon n="plus" size={15} w={2.4} />Yeni etkinlik</button>}
        </div>
      </header>

      {!data ? <p class="sub">Yükleniyor…</p> : view === 'notes' ? (
        <NotesView notes={notes} setNotes={setNotes} openId={noteId} setOpenId={openNote} wantNew={wantNew} onConsumed={() => setWantNew(false)} />
      ) : (
        <div class={'aj-layout v-' + view}>
          <div class="aj-left">
            <TodoPanel todos={todos} setTodos={setTodos} onOpen={setTodoOpen} inputRef={todoInput} hlId={hl} />
            <RemindPanel todos={todos} events={events} onChanged={load} onOpen={openItem} />
          </div>
          <div class="aj-right">
            <MonthCal month={month} setMonth={setMonth} sel={sel} onPick={(d) => { setSel(d); if (d.slice(0, 7) !== month) setMonth(d.slice(0, 7)); }} itemsFor={itemsFor} />
            <DayPanel day={sel} items={itemsFor(sel)}
              onAddEvent={async (title, start) => { putEvent(await agendaApi.addEvent({ title, date: sel, start, color: 'accent' })); snack('Etkinlik eklendi'); }}
              onAddTodo={async (title) => { putTodo(await agendaApi.addTodo({ title, dueDate: sel } as any)); snack('Yapılacak eklendi'); }} />
            {sel !== today ? <button type="button" class="btn sm ghost" style="align-self:flex-start" onClick={() => { setSel(today); setMonth(today.slice(0, 7)); }}>Bugüne dön</button>
              : tomorrowN > 0 && <button type="button" class="btn sm ghost" style="align-self:flex-start" onClick={() => setSel(addDays(today, 1))}>Yarın: {tomorrowN} kayıt →</button>}
          </div>
        </div>
      )}

      {todoOpen && (
        <TodoModal todo={todos.find((x) => x.id === todoOpen.id) || todoOpen} onClose={() => setTodoOpen(null)} onSaved={putTodo} openTask={openTask}
          onDeleted={(id) => setTodos((l) => l.filter((x) => x.id !== id))} />
      )}
      {evOpen && <EventModal initial={evOpen} onClose={() => setEvOpen(null)} onSaved={(e) => { putEvent(e); setSel(e.date); setMonth(e.date.slice(0, 7)); }} onDeleted={(id) => setEvents((l) => l.filter((x) => x.id !== id))} />}
    </div>
  );
}
