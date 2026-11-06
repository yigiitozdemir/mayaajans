// Ajandam: ay takvimi, seçili günün listesi, etkinlik formu
import { useState } from 'preact/hooks';
import { snack, DAY } from '../api';
import { Icon, Modal } from '../ui';
import { RemindPicker } from './AjandaTodos';
import {
  type Ev, type Remind, type Repeat, COLORS, agendaApi, istToday, longDate, monthDays, monthTitle, shiftMonth, dayWord, remindLabel, whenIso, soonLocal,
} from './AjandaData';

/** Takvimde görünen öğe: kendi etkinliğin, yapılacağın ya da salt okunur iş/çekim/özel gün */
export interface CalItem {
  key: string; kind: 'event' | 'todo' | 'task' | 'shoot' | 'day';
  title: string; time: string; color?: string; done?: boolean; sub?: string;
  open: () => void;
}
export const KIND: Record<CalItem['kind'], { label: string; icon: string }> = {
  event: { label: 'Etkinlik', icon: 'cal' },
  todo: { label: 'Yapılacak', icon: 'check' },
  task: { label: 'İş teslimi', icon: 'board' },
  shoot: { label: 'Çekim', icon: 'cam' },
  day: { label: 'Özel gün', icon: 'note' },
};
const WEEK = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

export function MonthCal({ month, setMonth, sel, onPick, itemsFor }: {
  month: string; setMonth: (m: string) => void; sel: string; onPick: (d: string) => void; itemsFor: (d: string) => CalItem[];
}) {
  const today = istToday();
  const days = monthDays(month);
  const rows = days.slice(35).every((d) => d.slice(0, 7) !== month) ? days.slice(0, 35) : days;
  return (
    <section class="panel aj-cal" aria-label="Takvim">
      <div class="aj-cal-h">
        <h2>{monthTitle(month)}</h2>
        <button type="button" class="btn sm ghost" onClick={() => { setMonth(today.slice(0, 7)); onPick(today); }}>Bugün</button>
        <button type="button" class="iconbtn" aria-label="Önceki ay" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <button type="button" class="iconbtn" aria-label="Sonraki ay" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>
      <div class="aj-wk" aria-hidden="true">{WEEK.map((w) => <span>{w}</span>)}</div>
      <div class="aj-grid" role="grid" aria-label={monthTitle(month)}>
        {rows.map((d) => {
          const items = itemsFor(d);
          const out = d.slice(0, 7) !== month;
          return (
            <button type="button" role="gridcell" aria-selected={d === sel}
              class={'aj-day' + (out ? ' out' : '') + (d === today ? ' today' : '') + (d === sel ? ' sel' : '')}
              aria-label={longDate(d) + (items.length ? ', ' + items.length + ' kayıt' : '')} onClick={() => onPick(d)}>
              <span class="n">{+d.slice(8, 10)}</span>
              {items.slice(0, 3).map((x) => <span class={'aj-chip k-' + x.kind + (x.color ? ' c-' + x.color : '') + (x.done ? ' done' : '')}>{x.time ? <b>{x.time}</b> : null}{x.title}</span>)}
              {items.length > 3 && <span class="aj-more">+{items.length - 3}</span>}
              {items.length > 0 && <span class="aj-dots" aria-hidden="true">{items.slice(0, 4).map((x) => <i class={'k-' + x.kind + (x.color ? ' c-' + x.color : '')} />)}</span>}
            </button>
          );
        })}
      </div>
      <div class="aj-legend" aria-label="Renkler">
        {(['event', 'todo', 'task', 'shoot', 'day'] as const).map((k) => <span><i class={'k-' + k} />{KIND[k].label}</span>)}
      </div>
    </section>
  );
}

export function DayPanel({ day, items, onAddEvent, onAddTodo }: {
  day: string; items: CalItem[]; onAddEvent: (title: string, start: string) => Promise<void>; onAddTodo: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [as, setAs] = useState<'event' | 'todo'>('event');
  const wd = new Date(day + 'T00:00:00Z').getUTCDay();
  async function add() {
    const t = title.trim(); if (!t) return;
    try { if (as === 'event') await onAddEvent(t, start); else await onAddTodo(t); setTitle(''); setStart(''); } catch (e: any) { snack(e.message); }
  }
  return (
    <section class="panel aj-panel aj-daypanel" aria-label={'Seçili gün: ' + longDate(day)}>
      <div class="aj-ph">
        <h2>{dayWord(day) === 'Bugün' || dayWord(day) === 'Yarın' || dayWord(day) === 'Dün' ? dayWord(day) + ' · ' : ''}{longDate(day)}<span>{items.length}</span></h2>
        <span class="spacer" /><span class="sub">{DAY[wd]}</span>
      </div>
      {items.length ? (
        <ul class="aj-dlist">
          {items.map((x) => (
            <li>
              <button type="button" class={'aj-ditem k-' + x.kind + (x.color ? ' c-' + x.color : '') + (x.done ? ' done' : '')} onClick={x.open}>
                <span class="aj-dtime">{x.time || 'Gün boyu'}</span>
                <span class="aj-dbody">
                  <span class="aj-todo-t">{x.title}</span>
                  <span class="aj-dmeta"><Icon n={KIND[x.kind].icon} size={12} />{KIND[x.kind].label}{x.sub ? ' · ' + x.sub : ''}{x.kind !== 'event' && x.kind !== 'todo' ? ' · aç' : ''}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p class="empty">Bu gün için kayıt yok.</p>}
      <form class="quick aj-quick" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <div class="seg aj-seg-sm" role="group" aria-label="Eklenecek tür">
          <button type="button" class={as === 'event' ? 'on' : ''} aria-pressed={as === 'event'} onClick={() => setAs('event')}>Etkinlik</button>
          <button type="button" class={as === 'todo' ? 'on' : ''} aria-pressed={as === 'todo'} onClick={() => setAs('todo')}>Yapılacak</button>
        </div>
        <input type="text" value={title} maxLength={200} placeholder={as === 'event' ? 'Bu güne etkinlik ekle…' : 'Bu güne yapılacak ekle…'} aria-label={as === 'event' ? 'Bu güne etkinlik ekle' : 'Bu güne yapılacak ekle'}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)} />
        {as === 'event' && <input type="time" class="aj-qdate" value={start} aria-label="Başlangıç saati" onInput={(e) => setStart((e.target as HTMLInputElement).value)} />}
        <button type="submit" class="btn primary sm">Ekle</button>
      </form>
    </section>
  );
}

export function EventModal({ initial, onClose, onSaved, onDeleted }: {
  initial: Partial<Ev> & { date: string }; onClose: () => void; onSaved: (e: Ev) => void; onDeleted: (id: string) => void;
}) {
  const [f, setF] = useState({
    title: initial.title || '', date: initial.date, start: initial.start || '', end: initial.end || '', note: initial.note || '',
    color: initial.color ?? 'accent', remind: (initial.remind ?? null) as Remind, repeat: (initial.repeat || 'none') as Repeat,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const set = (p: Partial<typeof f>) => { setF((x) => ({ ...x, ...p })); setErr(''); };
  async function save() {
    if (!f.title.trim()) { setErr('Etkinlik adını yaz'); return; }
    if (!f.date) { setErr('Tarih seç'); return; }
    if (f.end && !f.start) { setErr('Bitiş için başlangıç saati de seç'); return; }
    if (f.end && f.end < f.start) { setErr('Bitiş saati başlangıçtan önce olamaz'); return; }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { title: f.title, date: f.date, start: f.start, end: f.end, note: f.note, color: f.color, repeat: f.repeat };
      if (!initial.id || JSON.stringify(f.remind) !== JSON.stringify(initial.remind ?? null)) body.remind = f.remind;
      const e = initial.id ? await agendaApi.patchEvent(initial.id, body) : await agendaApi.addEvent(body);
      onSaved(e); onClose(); snack(initial.id ? 'Etkinlik güncellendi' : 'Etkinlik eklendi' + (e.nextAt ? ' · ' + whenIso(e.nextAt) + ' hatırlatılacak' : ''));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function del() {
    if (!confirm) { setConfirm(true); return; }
    try { await agendaApi.delEvent(initial.id!); onDeleted(initial.id!); onClose(); snack('Etkinlik silindi'); } catch (e: any) { snack(e.message); }
  }
  return (
    <Modal title={initial.id ? 'Etkinliği düzenle' : 'Yeni etkinlik'} onClose={onClose} width={560}>
      <form class="aj-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <label class="field" for="ev-title">Başlık
          <input id="ev-title" class="input" value={f.title} maxLength={200} placeholder="ör. Doktor randevusu" onInput={(e) => set({ title: (e.target as HTMLInputElement).value })} autoFocus />
        </label>
        <div class="aj-grid3">
          <label class="field" for="ev-date">Tarih *
            <input id="ev-date" class={'input' + (!f.date && err ? ' err' : '')} type="date" value={f.date} onInput={(e) => set({ date: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="field" for="ev-start">Başlangıç
            <input id="ev-start" class="input" type="time" value={f.start} onInput={(e) => set({ start: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="field" for="ev-end">Bitiş
            <input id="ev-end" class="input" type="time" value={f.end} disabled={!f.start} onInput={(e) => set({ end: (e.target as HTMLInputElement).value })} />
          </label>
        </div>
        <RemindPicker idp="ev" remind={f.remind} repeat={f.repeat} hasDate={!!f.date} defaultAt={f.date ? f.date + 'T' + (f.start || '09:00') : soonLocal()} onChange={(remind, repeat) => set({ remind, repeat })} />
        {f.repeat !== 'none' && <p class="sub" style="margin:-6px 0 0">Etkinlik takvimde de {f.repeat === 'daily' ? 'her gün' : f.repeat === 'weekdays' ? 'hafta içi her gün' : f.repeat === 'weekly' ? 'her hafta' : 'her ay'} görünür.</p>}
        <div class="field"><span>Renk</span>
          <div class="aj-colors" role="radiogroup" aria-label="Renk">
            {COLORS.map((c) => <button type="button" role="radio" aria-checked={f.color === c.key} aria-label={c.label} title={c.label} class={'aj-color c-' + (c.key || 'none')} onClick={() => set({ color: c.key })} />)}
          </div>
        </div>
        <label class="field" for="ev-note">Not
          <textarea id="ev-note" class="input" rows={2} value={f.note} maxLength={2000} onInput={(e) => set({ note: (e.target as HTMLTextAreaElement).value })} />
        </label>
        {initial.id && initial.remind && <p class="sub" style="margin:0">Şu an: {remindLabel(initial as Ev)}{initial.nextAt ? ' · sıradaki ' + whenIso(initial.nextAt) : ''}</p>}
        {err && <p class="errtext" role="alert" style="margin:0">{err}</p>}
        <div class="row">
          {initial.id && <button type="button" class={'btn danger' + (confirm ? ' confirm' : '')} onClick={del}>{confirm ? 'Eminim, sil' : 'Sil'}</button>}
          <span class="spacer" />
          <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
          <button type="submit" class="btn primary" disabled={busy}>{initial.id ? 'Kaydet' : 'Ekle'}</button>
        </div>
      </form>
    </Modal>
  );
}
