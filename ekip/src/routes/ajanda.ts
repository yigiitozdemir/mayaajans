// Ajandam: kişiye özel notlar (ekran görüntüleriyle), yapılacaklar, takvim ve anımsatıcılar. Yalnızca sahibine açık.
// Başkasının (yönetici dahil) kaydı sorulursa hep 404 döner; varlığı bile belli olmaz.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Vars } from '../types';
import { broadcast } from '../hub';
import { notify } from '../notify';
import { clean, isDate, newId } from '../util';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
type C = Context<{ Bindings: Env; Variables: Vars }>;

const MAX_FILE = 15 * 1024 * 1024;
const MAX_FILES_PER_NOTE = 40;
const MAX_NOTES = 2000;
const MAX_TODOS = 3000;
const MAX_EVENTS = 3000;
const COLORS = ['', 'accent', 'red', 'amber', 'green', 'blue'];
const REPEATS = ['none', 'daily', 'weekdays', 'weekly', 'monthly'];
const OFFSETS = [0, 10, 60, 1440];
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const TZ = 3 * 3600_000; // İstanbul: UTC+3, yaz saati yok

// ---------- zaman yardımcıları ----------
const toSql = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const fromSql = (s: string) => Date.parse(s.replace(' ', 'T').slice(0, 19) + 'Z');
const isoOf = (s: string | null) => (s ? s.replace(' ', 'T').slice(0, 19) + 'Z' : null);
const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isLocal = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(s) && isDate(s.slice(0, 10));
/** 'YYYY-MM-DDTHH:MM' (İstanbul) → UTC ms */
const localMs = (s: string) => Date.parse(s + ':00Z') - TZ;
/** UTC ms → İstanbul 'YYYY-MM-DDTHH:MM' */
const msLocal = (ms: number) => new Date(ms + TZ).toISOString().slice(0, 16);
export const istanbulDate = (d = new Date()) => new Date(d.getTime() + TZ).toISOString().slice(0, 10);

/** Tekrarın bir sonraki zamanı (İstanbul takvimine göre). */
export function nextOccurrence(ms: number, repeat: string): number {
  const d = new Date(ms + TZ); // İstanbul saatini UTC alanlarında taşır
  if (repeat === 'daily') d.setUTCDate(d.getUTCDate() + 1);
  else if (repeat === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  else if (repeat === 'weekdays') { do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6); }
  else if (repeat === 'monthly') {
    const day = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
  } else return NaN;
  return d.getTime() - TZ;
}
/** Tekrarlıyı şimdiden sonraki ilk zamana ilerletir. `off`: "x dk önce" farkı (tekrar, etkinliğin/yapılacağın gününe göre sayılır). */
function advancePast(ms: number, repeat: string, now: number, off = 0, atLeastOne = false): number {
  let occ = ms + off; let i = 0;
  if (atLeastOne) occ = nextOccurrence(occ, repeat);
  while (occ - off <= now && i++ < 5000) occ = nextOccurrence(occ, repeat);
  return occ - off;
}
const offOf = (x: { remind_offset: number | null }) => (x.remind_offset ?? 0) * 60_000;

interface RemindCols { repeat: string; remind_offset: number | null; remind_local: string | null; remind_base: string | null; remind_at: string | null; fired_at: string | null }
interface TodoRow extends RemindCols {
  id: string; user_id: string; title: string; note: string; due_date: string | null; due_time: string | null; star: number;
  done: number; done_at: string | null; task_id: string | null; created_at: string; updated_at: string;
}
interface EventRow extends RemindCols {
  id: string; user_id: string; title: string; date: string; start_time: string; end_time: string; note: string; color: string;
  created_at: string; updated_at: string;
}
interface NoteRow {
  id: string; user_id: string; kind: 'work' | 'personal'; title: string; body: string; color: string; pinned: number;
  client_id: string | null; checks: string; created_at: string; updated_at: string;
}
interface FileRow { id: string; user_id: string; note_id: string; name: string; r2_key: string; content_type: string; size: number; created_at: string }
type Cfg = { offset: number | null; local: string | null };

/**
 * Anımsatıcı sütunlarını `sets` içine yazar.
 * Göreli anımsatıcı (zamanında / 10 dk / 1 saat / 1 gün önce) tarih + saatten hesaplanır; saat yoksa 09:00 sayılır.
 * Tekrarsız ve zamanı geçmişse yine kurulur → ilk dakikada bir kez gönderilir (yeniden açılan yapılacakta kurulmaz).
 */
function applyRemind(sets: Record<string, unknown>, cfg: Cfg, date: string | null, time: string | null, repeat: string, opts: { active: boolean; skipPast?: boolean; resetFired?: boolean }) {
  sets.remind_offset = cfg.offset; sets.remind_local = cfg.local;
  if (opts.resetFired) sets.fired_at = null;
  let base: number | null = null;
  if (opts.active) {
    if (cfg.local) base = localMs(cfg.local);
    else if (cfg.offset !== null && date) base = localMs(date + 'T' + (time || '09:00')) - cfg.offset * 60_000;
  }
  const now = Date.now();
  if (base !== null && repeat !== 'none') base = advancePast(base, repeat, now - 60_000, (cfg.offset ?? 0) * 60_000);
  else if (base !== null && opts.skipPast && base <= now) base = null;
  sets.remind_base = base === null ? null : toSql(base);
  sets.remind_at = sets.remind_base;
}

function remindView(x: RemindCols) {
  return {
    repeat: x.repeat,
    remind: x.remind_offset !== null ? { offset: x.remind_offset } : x.remind_local ? { at: x.remind_local } : null,
    nextAt: isoOf(x.remind_at), firedAt: isoOf(x.fired_at),
  };
}
const todoView = (t: TodoRow) => ({
  id: t.id, title: t.title, note: t.note, dueDate: t.due_date, dueTime: t.due_time, star: !!t.star, done: !!t.done,
  doneAt: isoOf(t.done_at), taskId: t.task_id, createdAt: isoOf(t.created_at), ...remindView(t),
});
const eventView = (e: EventRow) => ({
  id: e.id, title: e.title, date: e.date, start: e.start_time, end: e.end_time, note: e.note, color: e.color, ...remindView(e),
});
const fileView = (f: FileRow) => ({
  id: f.id, noteId: f.note_id, name: f.name, type: f.content_type, size: f.size, createdAt: isoOf(f.created_at),
  url: '/api/agenda/files/' + f.id, inline: INLINE_TYPES.has(f.content_type),
});
function noteView(n: NoteRow, files: FileRow[]) {
  let checks: { id: string; text: string; done: boolean }[] = [];
  try { checks = JSON.parse(n.checks || '[]'); } catch { /* */ }
  return {
    id: n.id, kind: n.kind, title: n.title, body: n.body, color: n.color, pinned: !!n.pinned, clientId: n.client_id, checks,
    createdAt: isoOf(n.created_at), updatedAt: isoOf(n.updated_at), files: files.filter((f) => f.note_id === n.id).map(fileView),
  };
}

const err = (c: C, msg: string, code: 400 | 404 | 409 | 413 | 415 = 400) => c.json({ error: msg }, code);
/** Yalnızca sahibine: aynı kişinin diğer pencereleri/cihazları anında güncellenir. */
const live = (c: C, extra: Record<string, unknown> = {}) =>
  c.executionCtx.waitUntil(broadcast(c.env, { type: 'agenda', ...extra }, { to: c.get('user').id }).catch(() => {}));

async function own<T>(c: C, table: 'agenda_notes' | 'agenda_todos' | 'agenda_events' | 'agenda_files', id: string): Promise<T | null> {
  return c.env.DB.prepare(`SELECT * FROM ${table} WHERE id = ? AND user_id = ?`).bind(id, c.get('user').id).first<T>();
}
async function update(c: C, table: string, id: string, s: Record<string, unknown>, stamp: string) {
  const keys = Object.keys(s);
  await c.env.DB.prepare(`UPDATE ${table} SET ${keys.map((k) => k + ' = ?').join(', ')}${stamp} WHERE id = ? AND user_id = ?`)
    .bind(...keys.map((k) => s[k]), id, c.get('user').id).run();
}

/** Gövdedeki anımsatıcı ayarını okur. undefined = dokunma. */
function readRemind(b: Record<string, unknown>): Cfg | undefined | string {
  if (!('remind' in b)) return undefined;
  const v = b.remind as Record<string, unknown> | null;
  if (v === null || v === undefined || (v as unknown) === false) return { offset: null, local: null };
  if (typeof v !== 'object') return 'Anımsatıcı geçersiz';
  if ('at' in v) { if (!isLocal(v.at)) return 'Anımsatıcı zamanı geçersiz'; return { offset: null, local: v.at }; }
  if ('offset' in v) { if (!OFFSETS.includes(v.offset as number)) return 'Anımsatıcı seçeneği geçersiz'; return { offset: v.offset as number, local: null }; }
  return 'Anımsatıcı geçersiz';
}

// ---------- tümü ----------
r.get('/', async (c) => {
  const uid = c.get('user').id;
  const [notes, files, todos, events] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM agenda_notes WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC').bind(uid).all<NoteRow>(),
    c.env.DB.prepare('SELECT * FROM agenda_files WHERE user_id = ? ORDER BY created_at').bind(uid).all<FileRow>(),
    c.env.DB.prepare('SELECT * FROM agenda_todos WHERE user_id = ? ORDER BY created_at').bind(uid).all<TodoRow>(),
    c.env.DB.prepare('SELECT * FROM agenda_events WHERE user_id = ? ORDER BY date, start_time').bind(uid).all<EventRow>(),
  ]);
  return c.json({
    notes: notes.results.map((n) => noteView(n, files.results)),
    todos: todos.results.map(todoView),
    events: events.results.map(eventView),
  });
});

// ---------- notlar ----------
function readChecks(v: unknown): string | null {
  if (!Array.isArray(v) || v.length > 100) return null;
  const out = [];
  for (const x of v) {
    if (!x || typeof x !== 'object') return null;
    const o = x as Record<string, unknown>;
    const id = typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) ? o.id : newId('k');
    out.push({ id, text: clean(o.text, 300), done: !!o.done });
  }
  return JSON.stringify(out);
}

async function noteFields(c: C, b: Record<string, unknown>): Promise<{ sets: Record<string, unknown> } | { error: string }> {
  const sets: Record<string, unknown> = {};
  if ('title' in b) sets.title = clean(b.title, 200);
  if ('body' in b) { if (typeof b.body !== 'string' || b.body.length > 20000) return { error: 'Not en fazla 20.000 karakter olabilir' }; sets.body = b.body.replace(/\r\n/g, '\n'); }
  if ('kind' in b) { if (b.kind !== 'work' && b.kind !== 'personal') return { error: 'Tür İş ya da Kişisel olmalı' }; sets.kind = b.kind; }
  if ('color' in b) { if (!COLORS.includes(b.color as string)) return { error: 'Renk geçersiz' }; sets.color = b.color; }
  if ('pinned' in b) sets.pinned = b.pinned ? 1 : 0;
  if ('checks' in b) { const ch = readChecks(b.checks); if (ch === null) return { error: 'Kontrol listesi geçersiz' }; sets.checks = ch; }
  if ('clientId' in b) {
    if (b.clientId === null || b.clientId === '') sets.client_id = null;
    else {
      if (typeof b.clientId !== 'string') return { error: 'Müşteri bulunamadı' };
      const found = await c.env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(b.clientId).first();
      if (!found) return { error: 'Müşteri bulunamadı' };
      sets.client_id = b.clientId;
    }
  }
  return { sets };
}

async function loadNote(c: C, id: string) {
  const n = await own<NoteRow>(c, 'agenda_notes', id);
  if (!n) return null;
  const { results } = await c.env.DB.prepare('SELECT * FROM agenda_files WHERE note_id = ? AND user_id = ? ORDER BY created_at').bind(id, n.user_id).all<FileRow>();
  return noteView(n, results);
}

r.post('/notes', async (c) => {
  const uid = c.get('user').id;
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const f = await noteFields(c, b);
  if ('error' in f) return err(c, f.error);
  const count = await c.env.DB.prepare('SELECT COUNT(*) n FROM agenda_notes WHERE user_id = ?').bind(uid).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_NOTES) return err(c, 'En fazla ' + MAX_NOTES + ' not tutulabilir');
  const s = f.sets;
  const id = newId('nt');
  await c.env.DB.prepare('INSERT INTO agenda_notes (id, user_id, kind, title, body, color, pinned, client_id, checks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, uid, s.kind ?? 'work', s.title ?? '', s.body ?? '', s.color ?? '', s.pinned ?? 0, s.client_id ?? null, s.checks ?? '[]').run();
  live(c, { what: 'note', id });
  return c.json(await loadNote(c, id), 201);
});

r.patch('/notes/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await own<NoteRow>(c, 'agenda_notes', id))) return err(c, 'Not bulunamadı', 404);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const f = await noteFields(c, b);
  if ('error' in f) return err(c, f.error);
  if (!Object.keys(f.sets).length) return err(c, 'Değişiklik yok');
  await update(c, 'agenda_notes', id, f.sets, ", updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')");
  live(c, { what: 'note', id });
  return c.json(await loadNote(c, id));
});

r.delete('/notes/:id', async (c) => {
  const id = c.req.param('id');
  const uid = c.get('user').id;
  if (!(await own<NoteRow>(c, 'agenda_notes', id))) return err(c, 'Not bulunamadı', 404);
  const { results } = await c.env.DB.prepare('SELECT r2_key FROM agenda_files WHERE note_id = ? AND user_id = ?').bind(id, uid).all<{ r2_key: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM agenda_files WHERE note_id = ? AND user_id = ?').bind(id, uid),
    c.env.DB.prepare('DELETE FROM agenda_notes WHERE id = ? AND user_id = ?').bind(id, uid),
  ]);
  if (results.length) c.executionCtx.waitUntil(c.env.FILES.delete(results.map((x) => x.r2_key)).catch(() => {}));
  live(c, { what: 'note', id });
  return c.json({ ok: true });
});

// ---------- dosyalar (ekran görüntüleri, pdf) ----------
/** İlk baytlara bakarak türü bulur; tarayıcının söylediği türe güvenilmez. */
function sniff(b: Uint8Array): string | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 8 && b[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && (s(0, 6) === 'GIF87a' || s(0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  if (b.length >= 5 && s(0, 5) === '%PDF-') return 'application/pdf';
  if (b.length >= 12 && s(4, 4) === 'ftyp') {
    const brand = s(8, 4);
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis'].includes(brand)) return 'image/heic';
    if (['mif1', 'msf1', 'heif'].includes(brand)) return 'image/heif';
  }
  return null;
}
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf', 'image/heic': 'heic', 'image/heif': 'heif' };
function safeName(name: string): string {
  const base = name.replace(/ı/g, 'i').replace(/İ/g, 'I').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return base.slice(0, 80) || 'dosya';
}

r.post('/notes/:id/files', async (c) => {
  const uid = c.get('user').id;
  const note = await own<NoteRow>(c, 'agenda_notes', c.req.param('id'));
  if (!note) return err(c, 'Not bulunamadı', 404);
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > MAX_FILE + 64 * 1024) return err(c, 'Dosya en fazla 15 MB olabilir', 413);
  let form: FormData;
  try { form = await c.req.formData(); } catch { return err(c, 'Dosya okunamadı'); }
  const f = form.get('file');
  if (!f || typeof f === 'string') return err(c, 'Dosya seçilmedi');
  const file = f as File;
  if (file.size > MAX_FILE) return err(c, 'Dosya en fazla 15 MB olabilir', 413);
  if (file.size === 0) return err(c, 'Dosya boş');
  const buf = new Uint8Array(await file.arrayBuffer());
  const type = sniff(buf);
  if (!type) return err(c, 'Yalnızca görsel (PNG, JPG, WEBP, GIF, HEIC) ve PDF yüklenebilir', 415);
  const count = await c.env.DB.prepare('SELECT COUNT(*) n FROM agenda_files WHERE note_id = ?').bind(note.id).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_FILES_PER_NOTE) return err(c, 'Bir nota en fazla ' + MAX_FILES_PER_NOTE + ' dosya eklenebilir');
  let name = (file.name || '').replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 150);
  if (!name || /^image\.(png|jpe?g|gif|webp)$/i.test(name)) { // panodan yapıştırılan ekran görüntüsü
    const t = new Date(Date.now() + TZ).toISOString();
    name = `Ekran görüntüsü ${t.slice(0, 10)} ${t.slice(11, 16).replace(':', '.')}.${EXT[type]}`;
  }
  const id = newId('af');
  const key = `personal/${uid}/${note.id}/${id}-${safeName(name)}`;
  await c.env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO agenda_files (id, user_id, note_id, name, r2_key, content_type, size) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, uid, note.id, name, key, type, file.size),
    c.env.DB.prepare("UPDATE agenda_notes SET updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?").bind(note.id),
  ]);
  live(c, { what: 'note', id: note.id });
  const row = (await own<FileRow>(c, 'agenda_files', id))!;
  return c.json(fileView(row), 201);
});

r.get('/files/:fid', async (c) => {
  const f = await own<FileRow>(c, 'agenda_files', c.req.param('fid'));
  if (!f) return err(c, 'Dosya bulunamadı', 404);
  const obj = await c.env.FILES.get(f.r2_key);
  if (!obj) return err(c, 'Dosya bulunamadı', 404);
  const inline = INLINE_TYPES.has(f.content_type) && c.req.query('download') === undefined;
  const ascii = f.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(obj.body, {
    headers: {
      'Content-Type': inline ? f.content_type : 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    },
  });
});

r.delete('/files/:fid', async (c) => {
  const f = await own<FileRow>(c, 'agenda_files', c.req.param('fid'));
  if (!f) return err(c, 'Dosya bulunamadı', 404);
  await c.env.DB.prepare('DELETE FROM agenda_files WHERE id = ? AND user_id = ?').bind(f.id, f.user_id).run();
  c.executionCtx.waitUntil(c.env.FILES.delete(f.r2_key).catch(() => {}));
  live(c, { what: 'note', id: f.note_id });
  return c.json({ ok: true });
});

// ---------- yapılacaklar ----------
function todoFields(b: Record<string, unknown>, partial: boolean): { sets: Record<string, unknown> } | { error: string } {
  const sets: Record<string, unknown> = {};
  if ('title' in b || !partial) { const t = clean(b.title, 300); if (!t) return { error: 'Yapılacak boş olamaz' }; sets.title = t; }
  if ('note' in b) sets.note = clean(b.note, 2000);
  if ('dueDate' in b) {
    if (b.dueDate === null || b.dueDate === '') { sets.due_date = null; sets.due_time = null; }
    else if (!isDate(b.dueDate)) return { error: 'Tarih geçersiz' };
    else sets.due_date = b.dueDate;
  }
  if ('dueTime' in b && sets.due_date !== null) {
    if (b.dueTime === null || b.dueTime === '') sets.due_time = null;
    else if (!isTime(b.dueTime)) return { error: 'Saat geçersiz (SS:DD)' };
    else sets.due_time = b.dueTime;
  }
  if ('star' in b) sets.star = b.star ? 1 : 0;
  if ('repeat' in b) { if (!REPEATS.includes(b.repeat as string)) return { error: 'Tekrar seçeneği geçersiz' }; sets.repeat = b.repeat; }
  return { sets };
}

r.post('/todos', async (c) => {
  const uid = c.get('user').id;
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const f = todoFields(b, false);
  if ('error' in f) return err(c, f.error);
  const cfg = readRemind(b);
  if (typeof cfg === 'string') return err(c, cfg);
  const s = f.sets;
  if (s.due_time && !s.due_date) return err(c, 'Saat için önce tarih seç');
  if (cfg && cfg.offset !== null && !s.due_date) return err(c, 'Göreli anımsatıcı için tarih seç');
  const count = await c.env.DB.prepare('SELECT COUNT(*) n FROM agenda_todos WHERE user_id = ?').bind(uid).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_TODOS) return err(c, 'Çok fazla yapılacak var; tamamlananları temizle');
  applyRemind(s, cfg || { offset: null, local: null }, (s.due_date as string) ?? null, (s.due_time as string) ?? null, (s.repeat as string) ?? 'none', { active: true });
  const id = newId('td');
  await c.env.DB.prepare(`INSERT INTO agenda_todos (id, user_id, title, note, due_date, due_time, star, repeat, remind_offset, remind_local, remind_base, remind_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, uid, s.title, s.note ?? '', s.due_date ?? null, s.due_time ?? null, s.star ?? 0, s.repeat ?? 'none',
    s.remind_offset, s.remind_local, s.remind_base, s.remind_at).run();
  live(c, { what: 'todo', id });
  return c.json(todoView((await own<TodoRow>(c, 'agenda_todos', id))!), 201);
});

r.patch('/todos/:id', async (c) => {
  const id = c.req.param('id');
  const before = await own<TodoRow>(c, 'agenda_todos', id);
  if (!before) return err(c, 'Yapılacak bulunamadı', 404);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const f = todoFields(b, true);
  if ('error' in f) return err(c, f.error);
  const cfg = readRemind(b);
  if (typeof cfg === 'string') return err(c, cfg);
  const s = f.sets;
  const date = 'due_date' in s ? (s.due_date as string | null) : before.due_date;
  const time = 'due_time' in s ? (s.due_time as string | null) : date ? before.due_time : null;
  if (s.due_time && !date) return err(c, 'Saat için önce tarih seç');
  const conf: Cfg = cfg ?? { offset: before.remind_offset, local: before.remind_local };
  if (conf.offset !== null && !date) {
    if (cfg) return err(c, 'Göreli anımsatıcı için tarih seç');
    conf.offset = null; // tarih kaldırıldı → göreli anımsatıcı da kalkar
  }
  const done = 'done' in b ? !!b.done : !!before.done;
  if ('done' in b) { s.done = done ? 1 : 0; s.done_at = done ? (before.done_at || toSql(Date.now())) : null; }
  const reopened = !done && !!before.done;
  // tamamlanınca anımsatıcı durur; geri alınınca (zamanı geçmediyse) yeniden kurulur
  if (cfg !== undefined || 'repeat' in s || 'due_date' in s || 'due_time' in s || done !== !!before.done) {
    applyRemind(s, conf, date, time, (s.repeat as string) ?? before.repeat, { active: !done, skipPast: reopened, resetFired: cfg !== undefined || done || reopened });
  }
  if (!Object.keys(s).length) return err(c, 'Değişiklik yok');
  await update(c, 'agenda_todos', id, s, ", updated_at = datetime('now')");
  live(c, { what: 'todo', id });
  return c.json(todoView((await own<TodoRow>(c, 'agenda_todos', id))!));
});

r.delete('/todos/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await own<TodoRow>(c, 'agenda_todos', id))) return err(c, 'Yapılacak bulunamadı', 404);
  await c.env.DB.prepare('DELETE FROM agenda_todos WHERE id = ? AND user_id = ?').bind(id, c.get('user').id).run();
  live(c, { what: 'todo', id });
  return c.json({ ok: true });
});

// Yapılacağı İş Planı'na resmî iş olarak taşır (kendine atanır, teslim tarihi zorunlu)
r.post('/todos/:id/task', async (c) => {
  const u = c.get('user');
  const todo = await own<TodoRow>(c, 'agenda_todos', c.req.param('id'));
  if (!todo) return err(c, 'Yapılacak bulunamadı', 404);
  if (todo.task_id) return err(c, "Bu yapılacak zaten İş Planı'na eklendi", 409);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const due = b.dueDate ?? todo.due_date;
  if (!isDate(due)) return err(c, 'Teslim tarihi seç');
  const title = clean(b.title ?? todo.title, 300);
  if (!title) return err(c, 'İş başlığı boş olamaz');
  const taskId = newId('t');
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO tasks (id, title, client, assignee_id, due_date, status, note, items, link, source, created_by) VALUES (?, ?, ?, ?, ?, 0, ?, '[]', '', 'ajanda', ?)")
      .bind(taskId, title, clean(b.client, 120), u.id, due, clean(todo.note, 4000), u.id),
    c.env.DB.prepare("UPDATE agenda_todos SET task_id = ?, done = 1, done_at = COALESCE(done_at, datetime('now')), remind_at = NULL, remind_base = NULL, fired_at = NULL, updated_at = datetime('now') WHERE id = ? AND user_id = ?")
      .bind(taskId, todo.id, u.id),
  ]);
  c.executionCtx.waitUntil(broadcast(c.env, { type: 'tasks' }).catch(() => {}));
  live(c, { what: 'todo', id: todo.id });
  return c.json({ taskId, todo: todoView((await own<TodoRow>(c, 'agenda_todos', todo.id))!) }, 201);
});

// ---------- etkinlikler ----------
function eventFields(b: Record<string, unknown>, partial: boolean): { sets: Record<string, unknown> } | { error: string } {
  const sets: Record<string, unknown> = {};
  if ('title' in b || !partial) { const t = clean(b.title, 200); if (!t) return { error: 'Etkinlik adını yaz' }; sets.title = t; }
  if ('date' in b || !partial) { if (!isDate(b.date)) return { error: 'Etkinlik tarihi seç' }; sets.date = b.date; }
  if ('start' in b) { if (b.start === '' || b.start === null) sets.start_time = ''; else if (!isTime(b.start)) return { error: 'Başlangıç saati geçersiz' }; else sets.start_time = b.start; }
  if ('end' in b) { if (b.end === '' || b.end === null) sets.end_time = ''; else if (!isTime(b.end)) return { error: 'Bitiş saati geçersiz' }; else sets.end_time = b.end; }
  if ('note' in b) sets.note = clean(b.note, 2000);
  if ('color' in b) { if (!COLORS.includes(b.color as string)) return { error: 'Renk geçersiz' }; sets.color = b.color; }
  if ('repeat' in b) { if (!REPEATS.includes(b.repeat as string)) return { error: 'Tekrar seçeneği geçersiz' }; sets.repeat = b.repeat; }
  return { sets };
}

r.post('/events', async (c) => {
  const uid = c.get('user').id;
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const f = eventFields(b, false);
  if ('error' in f) return err(c, f.error);
  const s = f.sets;
  if (s.end_time && !s.start_time) return err(c, 'Bitiş saati için başlangıç saati de seç');
  if (s.end_time && s.start_time && (s.end_time as string) < (s.start_time as string)) return err(c, 'Bitiş saati başlangıçtan önce olamaz');
  const cfg = readRemind(b);
  if (typeof cfg === 'string') return err(c, cfg);
  const count = await c.env.DB.prepare('SELECT COUNT(*) n FROM agenda_events WHERE user_id = ?').bind(uid).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_EVENTS) return err(c, 'Çok fazla etkinlik var');
  applyRemind(s, cfg || { offset: null, local: null }, s.date as string, (s.start_time as string) || null, (s.repeat as string) ?? 'none', { active: true });
  const id = newId('ev');
  await c.env.DB.prepare(`INSERT INTO agenda_events (id, user_id, title, date, start_time, end_time, note, color, repeat, remind_offset, remind_local, remind_base, remind_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, uid, s.title, s.date, s.start_time ?? '', s.end_time ?? '', s.note ?? '', s.color ?? '', s.repeat ?? 'none',
    s.remind_offset, s.remind_local, s.remind_base, s.remind_at).run();
  live(c, { what: 'event', id });
  return c.json(eventView((await own<EventRow>(c, 'agenda_events', id))!), 201);
});

r.patch('/events/:id', async (c) => {
  const id = c.req.param('id');
  const before = await own<EventRow>(c, 'agenda_events', id);
  if (!before) return err(c, 'Etkinlik bulunamadı', 404);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const f = eventFields(b, true);
  if ('error' in f) return err(c, f.error);
  const s = f.sets;
  const start = 'start_time' in s ? (s.start_time as string) : before.start_time;
  const end = 'end_time' in s ? (s.end_time as string) : before.end_time;
  if (end && !start) return err(c, 'Bitiş saati için başlangıç saati de seç');
  if (end && start && end < start) return err(c, 'Bitiş saati başlangıçtan önce olamaz');
  const cfg = readRemind(b);
  if (typeof cfg === 'string') return err(c, cfg);
  if (cfg !== undefined || 'repeat' in s || 'date' in s || 'start_time' in s) {
    applyRemind(s, cfg ?? { offset: before.remind_offset, local: before.remind_local }, (s.date as string) ?? before.date, start || null,
      (s.repeat as string) ?? before.repeat, { active: true, resetFired: cfg !== undefined });
  }
  if (!Object.keys(s).length) return err(c, 'Değişiklik yok');
  await update(c, 'agenda_events', id, s, ", updated_at = datetime('now')");
  live(c, { what: 'event', id });
  return c.json(eventView((await own<EventRow>(c, 'agenda_events', id))!));
});

r.delete('/events/:id', async (c) => {
  const id = c.req.param('id');
  if (!(await own<EventRow>(c, 'agenda_events', id))) return err(c, 'Etkinlik bulunamadı', 404);
  await c.env.DB.prepare('DELETE FROM agenda_events WHERE id = ? AND user_id = ?').bind(id, c.get('user').id).run();
  live(c, { what: 'event', id });
  return c.json({ ok: true });
});

// ---------- anımsatıcı: ertele / kapat ----------
const itemTable = (id: string) => (id.startsWith('td_') ? 'agenda_todos' : id.startsWith('ev_') ? 'agenda_events' : null);

r.post('/remind/:id', async (c) => {
  const id = c.req.param('id');
  const table = itemTable(id);
  const row = table ? await own<RemindCols & { id: string }>(c, table, id) : null;
  if (!table || !row) return err(c, 'Anımsatıcı bulunamadı', 404);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const now = Date.now();
  let sets: Record<string, unknown>;
  if (b.action === 'snooze') {
    let at: number;
    if (b.until === 'tomorrow9') at = localMs(msLocal(now + 86_400_000).slice(0, 10) + 'T09:00');
    else if ([10, 60].includes(b.minutes as number)) at = now + (b.minutes as number) * 60_000;
    else return err(c, 'Erteleme seçeneği geçersiz');
    sets = { remind_at: toSql(at), fired_at: null };
    // tekrarsızda dayanak da ertelenen zaman olur; tekrarlıda sıradaki tekrar korunur
    if (row.repeat === 'none' || !row.remind_base) sets.remind_base = toSql(at);
  } else if (b.action === 'dismiss') {
    if (row.fired_at) sets = { fired_at: null }; // çalmış olanı listeden kaldır (tekrarlıysa sıradaki zaten kurulu)
    else if (row.repeat !== 'none' && row.remind_base) {
      const n = advancePast(fromSql(row.remind_base), row.repeat, now, offOf(row), true); // yalnızca bu seferi atla
      sets = { remind_base: toSql(n), remind_at: toSql(n) };
    } else sets = { remind_at: null, remind_base: null, remind_offset: null, remind_local: null };
  } else return err(c, 'İşlem geçersiz');
  const keys = Object.keys(sets);
  await c.env.DB.prepare(`UPDATE ${table} SET ${keys.map((k) => k + ' = ?').join(', ')} WHERE id = ? AND user_id = ?`).bind(...keys.map((k) => sets[k]), id, c.get('user').id).run();
  live(c, { what: table === 'agenda_todos' ? 'todo' : 'event', id });
  const fresh = (await own<TodoRow & EventRow>(c, table, id))!;
  return c.json(table === 'agenda_todos' ? todoView(fresh) : eventView(fresh));
});

// ---------- dakikalık anımsatıcı ----------
const MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const shortDate = (d: string) => +d.slice(8, 10) + ' ' + MON[+d.slice(5, 7) - 1];

/** Her dakika: zamanı gelen anımsatıcılar için bildirim gönderir. Kaçırılanlar (ör. kesinti) yine bir kez gönderilir. */
export async function ajandaHatirlatma(env: Env, now = Date.now()): Promise<void> {
  const nowSql = toSql(now);
  const [todos, events] = await Promise.all([
    env.DB.prepare('SELECT * FROM agenda_todos WHERE remind_at IS NOT NULL AND remind_at <= ? AND done = 0 ORDER BY remind_at LIMIT 100').bind(nowSql).all<TodoRow>(),
    env.DB.prepare('SELECT * FROM agenda_events WHERE remind_at IS NOT NULL AND remind_at <= ? ORDER BY remind_at LIMIT 100').bind(nowSql).all<EventRow>(),
  ]);
  const today = istanbulDate(new Date(now));
  const tomorrow = istanbulDate(new Date(now + 86_400_000));
  const dayWord = (d: string) => (d === today ? 'Bugün' : d === tomorrow ? 'Yarın' : shortDate(d));
  const jobs: { table: string; row: TodoRow | EventRow; body: string; meta: string }[] = [];
  for (const t of todos.results) {
    const when = t.due_date ? dayWord(t.due_date) + (t.due_time ? ' ' + t.due_time : '') : '';
    jobs.push({ table: 'agenda_todos', row: t, body: [when ? 'Yapılacak · ' + when : 'Yapılacak', t.note].filter(Boolean).join(' — ').slice(0, 300), meta: 'Ajandam' + (when ? ' · ' + when : '') });
  }
  for (const e of events.results) {
    // tekrarlı etkinlikte o seferin tarihini anımsatıcı zamanından bul
    const occ = e.repeat !== 'none' && e.remind_base && e.remind_offset !== null ? istanbulDate(new Date(fromSql(e.remind_base) + e.remind_offset * 60_000)) : e.repeat !== 'none' ? today : e.date;
    const time = e.start_time ? e.start_time + (e.end_time ? '–' + e.end_time : '') : 'Tüm gün';
    jobs.push({ table: 'agenda_events', row: e, body: [dayWord(occ) + ' ' + time, e.note].filter(Boolean).join(' — ').slice(0, 300), meta: 'Ajandam · ' + dayWord(occ) + ' ' + time });
  }
  for (const j of jobs) {
    const x = j.row;
    let next: string | null = null;
    // tekrarlı: sıradaki zamana kay (ertelenmişse dayanak zaten ilerde, aynı kalır)
    if (x.repeat !== 'none' && x.remind_base) next = toSql(advancePast(fromSql(x.remind_base), x.repeat, now, offOf(x)));
    // önce sahiplen: iki çalışma çakışırsa yalnız biri gönderir
    const res = await env.DB.prepare(`UPDATE ${j.table} SET remind_at = ?, remind_base = ?, fired_at = ? WHERE id = ? AND remind_at = ?`)
      .bind(next, next ?? x.remind_base, nowSql, x.id, x.remind_at).run();
    if (!res.meta.changes) continue;
    await notify(env, { userId: x.user_id, kind: 'reminder', title: '⏰ ' + x.title, body: j.body, link: '/ajanda?r=' + x.id, meta: j.meta });
    await broadcast(env, { type: 'agenda', what: 'remind', id: x.id }, { to: x.user_id }).catch(() => {});
  }
}

/** Etkinlik (başlangıç tarihi + tekrar) verilen günde var mı? (web tarafında da aynısı var) */
export function occursOn(start: string, repeat: string, day: string): boolean {
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

/** Sabah özeti için: bugün tarihli açık yapılacak ve bugünkü (tekrarlılar dahil) etkinlik sayısı. */
export async function ajandaBugun(env: Env, userId: string, todayIso: string): Promise<{ todos: number; events: number }> {
  const [t, ev] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) n FROM agenda_todos WHERE user_id = ? AND done = 0 AND due_date = ?').bind(userId, todayIso).first<{ n: number }>(),
    env.DB.prepare("SELECT date, repeat FROM agenda_events WHERE user_id = ? AND (date = ? OR (repeat != 'none' AND date <= ?))").bind(userId, todayIso, todayIso).all<{ date: string; repeat: string }>(),
  ]);
  return { todos: t?.n || 0, events: ev.results.filter((e) => occursOn(e.date, e.repeat, todayIso)).length };
}
