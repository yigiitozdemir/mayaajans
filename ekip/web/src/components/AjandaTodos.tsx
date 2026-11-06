// Ajandam: yapılacaklar, anımsatıcı seçici, yaklaşan anımsatıcılar
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Ref } from 'preact';
import { snack, reloadTasks } from '../api';
import { Icon, Modal, useStore, kutla } from '../ui';
import {
  type Todo, type Ev, type Remind, type Repeat, OFFSETS, REPEATS, agendaApi, byTodo, dayWord, istToday, soonLocal, remindLabel, whenIso, isoLocal, addDays,
} from './AjandaData';

// ---------- anımsatıcı seçici ----------
export function RemindPicker({ remind, repeat, hasDate, defaultAt, onChange, idp }: {
  remind: Remind; repeat: Repeat; hasDate: boolean; defaultAt: string; idp: string;
  onChange: (r: Remind, rep: Repeat) => void;
}) {
  const mode = !remind ? '' : 'offset' in remind ? String(remind.offset) : 'at';
  return (
    <div class="aj-remind">
      <label class="field" for={idp + '-rm'}>
        <span class="row" style="gap:6px"><Icon n="bell" size={13} />Hatırlat</span>
        <select id={idp + '-rm'} class="input" value={mode} onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          if (!v) onChange(null, repeat);
          else if (v === 'at') onChange({ at: defaultAt }, repeat);
          else onChange({ offset: +v }, repeat);
        }}>
          <option value="">Hatırlatma yok</option>
          {OFFSETS.map((o) => <option value={String(o.v)} disabled={!hasDate}>{o.label}{!hasDate ? ' (önce tarih seç)' : ''}</option>)}
          <option value="at">Belirli bir zamanda…</option>
        </select>
      </label>
      {remind && 'at' in remind && (
        <label class="field" for={idp + '-at'}>Zaman (İstanbul)
          <input id={idp + '-at'} class="input" type="datetime-local" value={remind.at} onInput={(e) => { const v = (e.target as HTMLInputElement).value; if (v) onChange({ at: v.slice(0, 16) }, repeat); }} />
        </label>
      )}
      <label class="field" for={idp + '-rp'}>Tekrar
        <select id={idp + '-rp'} class="input" value={repeat} onChange={(e) => onChange(remind, (e.target as HTMLSelectElement).value as Repeat)}>
          {REPEATS.map((r) => <option value={r.key}>{r.label}</option>)}
        </select>
      </label>
    </div>
  );
}

// ---------- tek satır ----------
function TodoRow({ t, onToggle, onStar, onOpen, hl }: { t: Todo; onToggle: () => void; onStar: () => void; onOpen: () => void; hl: boolean }) {
  const today = istToday();
  const late = !t.done && t.dueDate && t.dueDate < today;
  const cls = t.dueDate ? (late ? 'late' : t.dueDate === today ? 'today' : t.dueDate <= addDays(today, 6) ? 'soon' : 'far') : '';
  return (
    <li class={'aj-todo' + (t.done ? ' done' : '') + (hl ? ' hl' : '')} id={'aj-' + t.id}>
      <input type="checkbox" checked={t.done} onChange={(e) => { if (!t.done) kutla(e.currentTarget); onToggle(); }} aria-label={(t.done ? 'Geri al: ' : 'Tamamla: ') + t.title} />
      <button type="button" class="aj-todo-b" onClick={onOpen} aria-label={t.title + ' · düzenle'}>
        <span class="aj-todo-t">{t.title}</span>
        <span class="aj-todo-m">
          {t.dueDate && <span class={'tag ' + cls}>{late ? 'Gecikti · ' : ''}{dayWord(t.dueDate)}{t.dueTime ? ' ' + t.dueTime : ''}</span>}
          {t.remind && !t.done && <span class="aj-mi" title={'Hatırlat: ' + remindLabel(t)}><Icon n="bell" size={12} />{t.nextAt ? whenIso(t.nextAt).replace(/^Bugün /, '') : 'çaldı'}</span>}
          {t.repeat !== 'none' && !t.done && <span class="aj-mi">↻</span>}
          {t.taskId && <span class="aj-mi"><Icon n="board" size={12} />İş Planı'nda</span>}
          {t.note && <span class="aj-mi aj-ell">{t.note}</span>}
        </span>
      </button>
      {!t.done && (
        <button type="button" class={'aj-star' + (t.star ? ' on' : '')} aria-pressed={t.star} aria-label={t.star ? 'Önemli işaretini kaldır' : 'Önemli olarak işaretle'} onClick={onStar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={t.star ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
        </button>
      )}
    </li>
  );
}

// ---------- yapılacaklar paneli ----------
export function TodoPanel({ todos, setTodos, onOpen, inputRef, hlId, presetDate }: {
  todos: Todo[]; setTodos: (f: (l: Todo[]) => Todo[]) => void; onOpen: (t: Todo) => void; inputRef: Ref<HTMLInputElement>; hlId: string | null; presetDate?: string | null;
}) {
  const [draft, setDraft] = useState('');
  const [date, setDate] = useState('');
  const [star, setStar] = useState(false);
  const [showDone, setShowDone] = useState(() => { try { return localStorage.getItem('maya.ajanda.done') === '1'; } catch { return false; } });
  const [filter, setFilter] = useState<'all' | 'today' | 'star'>('all');
  useEffect(() => { try { localStorage.setItem('maya.ajanda.done', showDone ? '1' : '0'); } catch { /* */ } }, [showDone]);
  const today = istToday();
  const replace = (x: Todo) => setTodos((l) => l.map((y) => (y.id === x.id ? x : y)));

  async function add() {
    // kutudaki güncel yazıyı oku (hızlı yazıp Enter'a basınca durum henüz güncellenmemiş olabilir)
    const el = (inputRef as { current: HTMLInputElement | null }).current;
    const raw = el ? el.value : draft;
    const title = raw.trim(); if (!title) return;
    const st = star;
    setDraft(''); setStar(false); if (el) el.value = '';
    try {
      const x = await agendaApi.addTodo({ title, dueDate: date || presetDate || null, star: st } as any);
      setTodos((l) => [...l.filter((y) => y.id !== x.id), x]);
    } catch (e: any) { snack(e.message); setDraft(raw); }
  }
  async function toggle(t: Todo) {
    replace({ ...t, done: !t.done });
    try { const x = await agendaApi.patchTodo(t.id, { done: !t.done }); replace(x); if (x.done) snack('Tamamlandı · “Tamamlanan” bölümüne taşındı'); }
    catch (e: any) { replace(t); snack(e.message); }
  }
  async function starIt(t: Todo) {
    replace({ ...t, star: !t.star });
    try { replace(await agendaApi.patchTodo(t.id, { star: !t.star })); } catch (e: any) { replace(t); snack(e.message); }
  }

  const open = todos.filter((t) => !t.done).sort(byTodo);
  const shown = open.filter((t) => filter === 'all' || (filter === 'today' ? !!t.dueDate && t.dueDate <= today : t.star));
  const done = todos.filter((t) => t.done).sort((a, b) => ((b.doneAt || '') > (a.doneAt || '') ? 1 : -1));
  const lateN = open.filter((t) => t.dueDate && t.dueDate < today).length;
  const row = (t: Todo) => <TodoRow t={t} hl={hlId === t.id} onToggle={() => toggle(t)} onStar={() => starIt(t)} onOpen={() => onOpen(t)} />;

  return (
    <section class="panel aj-panel" aria-label="Yapılacaklar">
      <div class="aj-ph">
        <h2>Yapılacaklar<span>{open.length}</span></h2>
        {lateN > 0 && <span class="tag late">{lateN} gecikti</span>}
        <span class="spacer" />
        <div class="seg aj-seg-sm" role="group" aria-label="Yapılacak filtresi">
          {([['all', 'Tümü'], ['today', 'Bugün'], ['star', 'Önemli']] as const).map(([k, l]) => (
            <button type="button" class={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      <form class="quick aj-quick" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <Icon n="plus" size={16} />
        <input ref={inputRef} type="text" value={draft} maxLength={300} placeholder="Yeni yapılacak yaz, Enter’a bas…  (T)" aria-label="Yeni yapılacak"
          onInput={(e) => setDraft((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(''); (e.target as HTMLInputElement).blur(); } }} />
        <input type="date" class="aj-qdate" value={date} aria-label="Tarih (isteğe bağlı)" onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        <button type="button" class={'aj-star' + (star ? ' on' : '')} aria-pressed={star} aria-label="Önemli" onClick={() => setStar(!star)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill={star ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" /></svg>
        </button>
        <button type="submit" class="btn primary sm">Ekle</button>
      </form>
      {shown.length ? <ul class="aj-todos">{shown.map(row)}</ul> : <p class="empty">{open.length ? 'Bu filtrede yapılacak yok.' : 'Yapılacak yok. Yukarıya yazıp Enter’a bas.'}</p>}
      <div class="aj-donesec">
        <button type="button" class="aj-donebtn" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
          <span class={'aj-caret' + (showDone ? ' on' : '')} aria-hidden="true">›</span>Tamamlanan <span class="sub">{done.length}</span>
        </button>
        {showDone && (done.length ? <ul class="aj-todos">{done.slice(0, 100).map(row)}</ul> : <p class="empty">Tamamlanan yapılacak yok.</p>)}
      </div>
    </section>
  );
}

// ---------- yapılacak düzenle ----------
export function TodoModal({ todo, onClose, onSaved, onDeleted, openTask }: {
  todo: Todo; onClose: () => void; onSaved: (t: Todo) => void; onDeleted: (id: string) => void; openTask: (id: string) => void;
}) {
  const [f, setF] = useState({ title: todo.title, note: todo.note, dueDate: todo.dueDate || '', dueTime: todo.dueTime || '', star: todo.star, remind: todo.remind, repeat: todo.repeat });
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [convert, setConvert] = useState(false);
  const [err, setErr] = useState('');
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  async function save() {
    if (!f.title.trim()) { setErr('Başlık boş olamaz'); return; }
    if (f.remind && 'offset' in f.remind && !f.dueDate) { setErr('Göreli hatırlatma için tarih seç'); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { title: f.title, note: f.note, dueDate: f.dueDate || null, dueTime: f.dueDate ? f.dueTime || null : null, star: f.star, repeat: f.repeat };
      if (JSON.stringify(f.remind) !== JSON.stringify(todo.remind) || f.dueDate !== (todo.dueDate || '')) body.remind = f.remind;
      onSaved(await agendaApi.patchTodo(todo.id, body)); onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function del() {
    if (!confirm) { setConfirm(true); return; }
    try { await agendaApi.delTodo(todo.id); onDeleted(todo.id); onClose(); snack('Yapılacak silindi'); } catch (e: any) { snack(e.message); }
  }
  if (convert) return <ConvertModal todo={{ ...todo, title: f.title, dueDate: f.dueDate || null }} onClose={() => setConvert(false)} onDone={(t, taskId) => { onSaved(t); onClose(); snack("İş Planı'na eklendi"); openTask(taskId); }} />;
  return (
    <Modal title="Yapılacak" onClose={onClose} width={560}>
      <form class="aj-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label class="field" for="td-title">Başlık
          <input id="td-title" class="input" value={f.title} maxLength={300} onInput={(e) => set({ title: (e.target as HTMLInputElement).value })} autoFocus />
        </label>
        <div class="aj-grid2">
          <label class="field" for="td-date">Tarih <span class="sub" style="font-weight:500">(isteğe bağlı)</span>
            <input id="td-date" class="input" type="date" value={f.dueDate} onInput={(e) => { const v = (e.target as HTMLInputElement).value; set({ dueDate: v, ...(v ? {} : { dueTime: '', remind: f.remind && 'offset' in f.remind ? null : f.remind }) }); }} />
          </label>
          <label class="field" for="td-time">Saat
            <input id="td-time" class="input" type="time" value={f.dueTime} disabled={!f.dueDate} onInput={(e) => set({ dueTime: (e.target as HTMLInputElement).value })} />
          </label>
        </div>
        <RemindPicker idp="td" remind={f.remind} repeat={f.repeat} hasDate={!!f.dueDate}
          defaultAt={f.dueDate ? f.dueDate + 'T' + (f.dueTime || '09:00') : soonLocal()}
          onChange={(remind, repeat) => set({ remind, repeat })} />
        {todo.nextAt && <p class="sub" style="margin:-6px 0 0">Sıradaki hatırlatma: <strong>{whenIso(todo.nextAt)}</strong></p>}
        <label class="field" for="td-note">Not
          <textarea id="td-note" class="input" rows={3} value={f.note} maxLength={2000} onInput={(e) => set({ note: (e.target as HTMLTextAreaElement).value })} />
        </label>
        <button type="button" class="check" style={f.star ? 'border-color:var(--amber)' : ''} aria-pressed={f.star} onClick={() => set({ star: !f.star })}>
          <span class="aj-star on" aria-hidden="true" style={f.star ? '' : 'color:var(--mute2)'}>★</span>
          <span style="display:flex;flex-direction:column;gap:2px"><strong style="font-size:13px">Önemli</strong><span class="sub">Aynı gün içindekilerin en üstünde görünür</span></span>
        </button>
        {err && <p class="errtext" role="alert" style="margin:0">{err}</p>}
        <div class="row">
          <button type="button" class={'btn danger' + (confirm ? ' confirm' : '')} onClick={del}>{confirm ? 'Eminim, sil' : 'Sil'}</button>
          {!todo.taskId ? (
            <button type="button" class="btn ghost" onClick={() => setConvert(true)}><Icon n="board" size={15} />İş Planı’na dönüştür</button>
          ) : (
            <button type="button" class="btn ghost" onClick={() => { onClose(); openTask(todo.taskId!); }}><Icon n="board" size={15} />İşi aç</button>
          )}
          <span class="spacer" />
          <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
          <button type="submit" class="btn primary" disabled={busy}>Kaydet</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- İş Planı'na dönüştür ----------
export function ConvertModal({ todo, onClose, onDone }: { todo: Todo; onClose: () => void; onDone: (t: Todo, taskId: string) => void }) {
  const s = useStore();
  const [due, setDue] = useState(todo.dueDate || '');
  const [client, setClient] = useState('');
  const [title, setTitle] = useState(todo.title);
  const [err, setErr] = useState('');
  async function go() {
    if (!due) { setErr('Teslim tarihi seç'); return; }
    try { const r = await agendaApi.toTask(todo.id, { dueDate: due, client, title }); await reloadTasks().catch(() => {}); onDone(r.todo, r.taskId); }
    catch (e: any) { setErr(e.message); }
  }
  return (
    <Modal title="İş Planı’na dönüştür" onClose={onClose} width={500}>
      <form class="aj-form" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <p class="sub" style="margin:0">Bu yapılacak, sana atanmış resmî bir iş olarak İş Planı’na eklenir; ekip de görür. Burada tamamlandı olarak işaretlenir.</p>
        <label class="field" for="cv-title">İş başlığı<input id="cv-title" class="input" value={title} maxLength={300} onInput={(e) => setTitle((e.target as HTMLInputElement).value)} /></label>
        <div class="aj-grid2">
          <label class="field" for="cv-due">Teslim tarihi *
            <input id="cv-due" class={'input' + (err && !due ? ' err' : '')} type="date" value={due} onInput={(e) => { setDue((e.target as HTMLInputElement).value); setErr(''); }} autoFocus={!due} />
          </label>
          <label class="field" for="cv-client">Firma
            <select id="cv-client" class="input" value={client} onChange={(e) => setClient((e.target as HTMLSelectElement).value)}>
              <option value="">—</option>{s.clients.map((c) => <option value={c.name}>{c.name}</option>)}
            </select>
          </label>
        </div>
        {err && <p class="errtext" role="alert" style="margin:0">{err}</p>}
        <div class="row"><span class="spacer" /><button type="button" class="btn" onClick={onClose}>Vazgeç</button><button type="submit" class="btn primary">İş Planı’na ekle</button></div>
      </form>
    </Modal>
  );
}

// ---------- yaklaşan anımsatıcılar ----------
type RItem = { id: string; title: string; kind: 'todo' | 'event'; nextAt: string | null; firedAt: string | null; repeat: Repeat };
export function RemindPanel({ todos, events, onChanged, onOpen }: { todos: Todo[]; events: Ev[]; onChanged: () => void; onOpen: (id: string) => void }) {
  const [menu, setMenu] = useState<string | null>(null);
  const items: RItem[] = [
    ...todos.filter((t) => !t.done && (t.nextAt || t.firedAt)).map((t) => ({ id: t.id, title: t.title, kind: 'todo' as const, nextAt: t.nextAt, firedAt: t.firedAt, repeat: t.repeat })),
    ...events.filter((e) => e.nextAt || e.firedAt).map((e) => ({ id: e.id, title: e.title, kind: 'event' as const, nextAt: e.nextAt, firedAt: e.firedAt, repeat: e.repeat })),
  ];
  // çalanlar (son 2 gün) üstte, sonra yaklaşanlar
  const fired = items.filter((x) => x.firedAt && Date.now() - Date.parse(x.firedAt) < 2 * 86_400_000 && (!x.nextAt || x.repeat !== 'none')).sort((a, b) => (a.firedAt! < b.firedAt! ? 1 : -1));
  const firedIds = new Set(fired.map((x) => x.id));
  const upcoming = items.filter((x) => x.nextAt && !firedIds.has(x.id)).sort((a, b) => (a.nextAt! < b.nextAt! ? -1 : 1));
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const f = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', f); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', f); document.removeEventListener('keydown', k); };
  }, [menu]);
  async function act(id: string, b: Record<string, unknown>, msg: string) {
    setMenu(null);
    try { await agendaApi.remind(id, b); onChanged(); snack(msg); } catch (e: any) { snack(e.message); }
  }
  const row = (x: RItem, isFired: boolean) => (
    <li class={'aj-rem' + (isFired ? ' fired' : '')}>
      <span class="aj-rem-ic" aria-hidden="true">{isFired ? '⏰' : <Icon n="bell" size={14} />}</span>
      <button type="button" class="aj-rem-b" onClick={() => onOpen(x.id)}>
        <span class="aj-todo-t">{x.title}</span>
        <span class="sub">{isFired ? 'Çaldı · ' + whenIso(x.firedAt!) : whenIso(x.nextAt!)}{x.repeat !== 'none' ? ' · ↻' : ''}{x.kind === 'event' ? ' · Etkinlik' : ''}</span>
      </button>
      <div class="aj-rem-act" ref={menu === x.id ? ref : undefined}>
        <button type="button" class="btn sm" aria-haspopup="menu" aria-expanded={menu === x.id} onClick={() => setMenu(menu === x.id ? null : x.id)}>Ertele</button>
        {menu === x.id && (
          <div class="aj-menu" role="menu">
            <button type="button" role="menuitem" onClick={() => act(x.id, { action: 'snooze', minutes: 10 }, '10 dakika ertelendi')}>10 dakika</button>
            <button type="button" role="menuitem" onClick={() => act(x.id, { action: 'snooze', minutes: 60 }, '1 saat ertelendi')}>1 saat</button>
            <button type="button" role="menuitem" onClick={() => act(x.id, { action: 'snooze', until: 'tomorrow9' }, 'Yarın 09:00’a ertelendi')}>Yarın 09:00</button>
          </div>
        )}
        <button type="button" class="iconbtn aj-x" aria-label={(isFired ? 'Kapat: ' : x.repeat !== 'none' ? 'Bu seferi atla: ' : 'Hatırlatmayı kaldır: ') + x.title}
          title={isFired ? 'Kapat' : x.repeat !== 'none' ? 'Bu seferi atla' : 'Hatırlatmayı kaldır'}
          onClick={() => act(x.id, { action: 'dismiss' }, isFired ? 'Kapatıldı' : x.repeat !== 'none' ? 'Bu sefer atlandı' : 'Hatırlatma kaldırıldı')}><Icon n="x" size={14} /></button>
      </div>
    </li>
  );
  return (
    <section class="panel aj-panel" aria-label="Anımsatıcılar">
      <div class="aj-ph"><h2>Anımsatıcılar<span>{upcoming.length}</span></h2><span class="spacer" /><span class="sub">Zamanı gelince zil + bildirim</span></div>
      {fired.length > 0 && <ul class="aj-rems">{fired.map((x) => row(x, true))}</ul>}
      {upcoming.length ? <ul class="aj-rems">{upcoming.slice(0, 12).map((x) => row(x, false))}</ul>
        : !fired.length && <p class="empty">Kurulu anımsatıcı yok. Bir yapılacağa ya da etkinliğe “Hatırlat” ekle.</p>}
      {upcoming.length > 12 && <p class="sub" style="margin:0">+{upcoming.length - 12} anımsatıcı daha</p>}
    </section>
  );
}

export { isoLocal };
