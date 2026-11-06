// Ajandam: tipler ve yardımcılar (saatler hep İstanbul: UTC+3, yaz saati yok)
import { api, MON, LMON, LDAY } from '../api';

export interface AFile { id: string; noteId: string; name: string; type: string; size: number; url: string; inline: boolean; createdAt: string }
export interface Check { id: string; text: string; done: boolean }
export interface Note {
  id: string; kind: 'work' | 'personal'; title: string; body: string; color: string; pinned: boolean; clientId: string | null;
  checks: Check[]; createdAt: string; updatedAt: string; files: AFile[];
}
export type Remind = { offset: number } | { at: string } | null;
export type Repeat = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly';
interface RemindFields { repeat: Repeat; remind: Remind; nextAt: string | null; firedAt: string | null }
export interface Todo extends RemindFields {
  id: string; title: string; note: string; dueDate: string | null; dueTime: string | null; star: boolean; done: boolean;
  doneAt: string | null; taskId: string | null; createdAt: string;
}
export interface Ev extends RemindFields { id: string; title: string; date: string; start: string; end: string; note: string; color: string }
export interface Agenda { notes: Note[]; todos: Todo[]; events: Ev[] }

export const COLORS: { key: string; label: string }[] = [
  { key: '', label: 'Renksiz' }, { key: 'accent', label: 'Kiremit' }, { key: 'red', label: 'Kırmızı' },
  { key: 'amber', label: 'Sarı' }, { key: 'green', label: 'Yeşil' }, { key: 'blue', label: 'Mavi' },
];
export const REPEATS: { key: Repeat; label: string }[] = [
  { key: 'none', label: 'Tekrar yok' }, { key: 'daily', label: 'Her gün' }, { key: 'weekdays', label: 'Hafta içi her gün' },
  { key: 'weekly', label: 'Her hafta' }, { key: 'monthly', label: 'Her ay' },
];
export const OFFSETS: { v: number; label: string }[] = [
  { v: 0, label: 'Zamanında' }, { v: 10, label: '10 dk önce' }, { v: 60, label: '1 saat önce' }, { v: 1440, label: '1 gün önce' },
];
export const repeatLabel = (r: Repeat) => REPEATS.find((x) => x.key === r)?.label || '';

const TZ = 3 * 3600_000;
const pad = (n: number) => String(n).padStart(2, '0');
/** İstanbul'a göre bugün (YYYY-MM-DD) */
export const istToday = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);
/** UTC ISO → İstanbul 'YYYY-MM-DDTHH:MM' */
export const isoLocal = (iso: string) => new Date(Date.parse(iso) + TZ).toISOString().slice(0, 16);
export const nowLocal = () => isoLocal(new Date().toISOString());
/** Bir saat sonrasının tam saati (İstanbul) — 'Belirli zaman' için varsayılan */
export const soonLocal = () => isoLocal(new Date(Date.now() + 3600_000).toISOString()).slice(0, 14) + '00';
export const addDays = (s: string, n: number) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
export const weekday = (s: string) => new Date(s + 'T00:00:00Z').getUTCDay();
export const shortDate = (s: string) => +s.slice(8, 10) + ' ' + MON[+s.slice(5, 7) - 1];
export const longDate = (s: string) => +s.slice(8, 10) + ' ' + LMON[+s.slice(5, 7) - 1] + ' ' + LDAY[weekday(s)];
export function dayWord(s: string) {
  const t = istToday();
  if (s === t) return 'Bugün';
  if (s === addDays(t, 1)) return 'Yarın';
  if (s === addDays(t, -1)) return 'Dün';
  return shortDate(s) + (s.slice(0, 4) !== t.slice(0, 4) ? ' ' + s.slice(0, 4) : '');
}
/** UTC ISO → "Bugün 14:00" / "8 Kas 09:30" */
export function whenIso(iso: string) { const l = isoLocal(iso); return dayWord(l.slice(0, 10)) + ' ' + l.slice(11, 16); }
export const lower = (s: string) => (s || '').toLocaleLowerCase('tr');

/** Etkinlik (başlangıç + tekrar) o günde var mı? (sunucudaki ile aynı) */
export function occursOn(start: string, repeat: Repeat, day: string): boolean {
  if (day === start) return true;
  if (repeat === 'none' || day < start) return false;
  const d = new Date(day + 'T00:00:00Z'), s = new Date(start + 'T00:00:00Z');
  if (repeat === 'daily') return true;
  if (repeat === 'weekdays') return d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
  if (repeat === 'weekly') return d.getUTCDay() === s.getUTCDay();
  if (repeat === 'monthly') {
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    return d.getUTCDate() === Math.min(s.getUTCDate(), last);
  }
  return false;
}

/** Ay görünümü: Pazartesi başlar, 6 hafta */
export function monthDays(month: string): string[] {
  const first = month + '-01';
  const wd = (weekday(first) + 6) % 7;
  const start = addDays(first, -wd);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
}
export const monthTitle = (month: string) => LMON[+month.slice(5, 7) - 1] + ' ' + month.slice(0, 4);

/** Açık yapılacak sıralaması: tarihliler önce (tarih + saat), aynı günde yıldızlı üstte; tarihsizler sonda (yıldızlı üstte). */
export function byTodo(a: Todo, b: Todo) {
  const da = a.dueDate || '9999-99-99', db = b.dueDate || '9999-99-99';
  if (da !== db) return da < db ? -1 : 1;
  if (a.star !== b.star) return a.star ? -1 : 1;
  const ta = a.dueTime || '99', tb = b.dueTime || '99';
  if (ta !== tb) return ta < tb ? -1 : 1;
  return a.createdAt < b.createdAt ? -1 : 1;
}

export function remindLabel(x: { remind: Remind; repeat: Repeat }) {
  if (!x.remind) return '';
  const base = 'offset' in x.remind ? OFFSETS.find((o) => o.v === (x.remind as { offset: number }).offset)?.label || '' : dayWord(x.remind.at.slice(0, 10)) + ' ' + x.remind.at.slice(11, 16);
  return base + (x.repeat !== 'none' ? ' · ' + repeatLabel(x.repeat).toLocaleLowerCase('tr') : '');
}

export function fmtSize(n: number) { return n < 1024 * 1024 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB'; }

/** Dosya yükleme (FormData) — api() JSON gönderdiği için ayrı. */
export async function uploadFile(noteId: string, file: File): Promise<AFile> {
  const f = new FormData(); f.append('file', file, file.name || 'image.png');
  const r = await fetch('/api/agenda/notes/' + noteId + '/files', { method: 'POST', body: f, credentials: 'same-origin' });
  let data: any = null; try { data = await r.json(); } catch { /* */ }
  if (!r.ok) throw new Error((data && data.error) || 'Yüklenemedi');
  return data as AFile;
}

export const agendaApi = {
  load: () => api<Agenda>('GET', '/agenda'),
  addTodo: (b: Partial<Todo> & { title: string }) => api<Todo>('POST', '/agenda/todos', b),
  patchTodo: (id: string, b: Record<string, unknown>) => api<Todo>('PATCH', '/agenda/todos/' + id, b),
  delTodo: (id: string) => api('DELETE', '/agenda/todos/' + id),
  toTask: (id: string, b: Record<string, unknown>) => api<{ taskId: string; todo: Todo }>('POST', '/agenda/todos/' + id + '/task', b),
  addEvent: (b: Record<string, unknown>) => api<Ev>('POST', '/agenda/events', b),
  patchEvent: (id: string, b: Record<string, unknown>) => api<Ev>('PATCH', '/agenda/events/' + id, b),
  delEvent: (id: string) => api('DELETE', '/agenda/events/' + id),
  remind: (id: string, b: Record<string, unknown>) => api<Todo | Ev>('POST', '/agenda/remind/' + id, b),
  addNote: (b: Record<string, unknown>) => api<Note>('POST', '/agenda/notes', b),
  patchNote: (id: string, b: Record<string, unknown>) => api<Note>('PATCH', '/agenda/notes/' + id, b),
  delNote: (id: string) => api('DELETE', '/agenda/notes/' + id),
  delFile: (id: string) => api('DELETE', '/agenda/files/' + id),
};

/** Klavye kısayolu yazı alanında mı? */
export const typing = (e: Event) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};
