// Toplantılar: müşteri (firma) toplantıları — tarih/saat, tür (yüz yüze / online / telefon), ekipten katılımcılar,
// müşteri tarafı katılımcılar, gündem. Toplantıdan sonra: notlar, alınan kararlar, aksiyon maddeleri
// (İş Planı'na aktarılabilir), ses kayıtları ve dosyalar (R2; yalnızca giriş yapmış ekibe sunulur).
// Yetki: herkes görür, ekipteki herkes ekler/düzenler; toplantıyı silmek → ekleyen ya da yönetici;
//        dosya / ses kaydını silmek → yükleyen ya da yönetici.
// Hatırlatma: başlamadan 30 dk önce katılımcılara (dakikalık zamanlayıcı; her saatte — takvim alarmı gibi).
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Vars } from '../types';
import { changed, notify } from '../notify';
import { clean, isDate, newId } from '../util';
import { normLink, sniffImage } from './kriz';
import { longDate } from './cekim';

type C = Context<{ Bindings: Env; Variables: Vars }>;
export const r = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- sabitler ----------
export const TYPES: Record<string, string> = { yuzyuze: 'Yüz yüze', online: 'Online', telefon: 'Telefon' };
export const STATUSES: Record<string, string> = { planlandi: 'Planlandı', yapildi: 'Yapıldı', ertelendi: 'Ertelendi', iptal: 'İptal' };
const MAX_PART = 20;
const MAX_AGENDA = 30;
const MAX_DECISIONS = 40;
const MAX_ACTIONS = 60;
const MAX_NOTES = 20_000;
export const MAX_AUDIO = 95 * 1024 * 1024; // Worker istek sınırı 100 MB
export const MAX_DOC = 25 * 1024 * 1024;
const MAX_FILES = 40; // toplantı başına (ses + dosya)
export const REMIND_MIN = 30;

interface MeetingRow {
  id: string; title: string; client: string; date: string; start_time: string; end_time: string; type: string;
  location: string; link: string; participants: string; client_attendees: string; agenda: string; status: string;
  notes: string; decisions: string; reminded_for: string | null; created_by: string | null; created_at: string; updated_at: string;
}
interface ActionRow { id: string; meeting_id: string; text: string; assignee_id: string | null; due_date: string | null; done: number; task_id: string | null; created_by: string | null; created_at: string; updated_at: string }
interface FileRow { id: string; meeting_id: string; kind: 'ses' | 'dosya'; name: string; r2_key: string; content_type: string; size: number; duration_s: number | null; created_by: string | null; created_at: string }
interface AgendaItem { text: string; done: boolean }

const err = (c: C, msg: string, code: 400 | 403 | 404 | 409 | 411 | 413 | 415 = 400) => c.json({ error: msg }, code);
const parseArr = <T>(s: string): T[] => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const isTime = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const wu = (c: C) => c.executionCtx.waitUntil.bind(c.executionCtx);
const isAdmin = (c: C) => c.get('user').role === 'admin';
const live = (c: C, id: string, action: string) => changed(c.env, 'toplanti', wu(c), { id, action });

// ---------- görünümler ----------
function fileView(f: FileRow) {
  return {
    id: f.id, kind: f.kind, name: f.name, contentType: f.content_type, size: f.size, durationS: f.duration_s,
    createdBy: f.created_by, createdAt: f.created_at, url: `/api/toplantilar/${f.meeting_id}/files/${f.id}`,
  };
}
function actionView(a: ActionRow) {
  return { id: a.id, text: a.text, assigneeId: a.assignee_id, dueDate: a.due_date, done: !!a.done, taskId: a.task_id, createdBy: a.created_by, createdAt: a.created_at };
}
function view(m: MeetingRow, actions: ActionRow[] = [], files: FileRow[] = []) {
  return {
    id: m.id, title: m.title, client: m.client, date: m.date, startTime: m.start_time, endTime: m.end_time, type: m.type,
    location: m.location, link: m.link, participants: parseArr<string>(m.participants), clientAttendees: m.client_attendees,
    agenda: parseArr<AgendaItem>(m.agenda), status: m.status, notes: m.notes, decisions: parseArr<string>(m.decisions),
    remindedFor: m.reminded_for, createdBy: m.created_by, createdAt: m.created_at, updatedAt: m.updated_at,
    actions: actions.map(actionView), files: files.map(fileView),
  };
}
type MeetingView = ReturnType<typeof view>;

const getRow = (c: C, id: string) => c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<MeetingRow>();
async function detail(c: C, id: string) {
  const m = await getRow(c, id);
  if (!m) return null;
  const [a, f] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM meeting_actions WHERE meeting_id = ? ORDER BY created_at, rowid').bind(id).all<ActionRow>(),
    c.env.DB.prepare('SELECT * FROM meeting_files WHERE meeting_id = ? ORDER BY created_at').bind(id).all<FileRow>(),
  ]);
  return view(m, a.results || [], f.results || []);
}
const touch = (c: C, id: string) => c.env.DB.prepare("UPDATE meetings SET updated_at = datetime('now') WHERE id = ?").bind(id);

// ---------- doğrulama ----------
async function cleanPeople(c: C, v: unknown): Promise<string[] | string> {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || x.length > 64)) return 'Katılımcı listesi geçersiz';
  const ids = [...new Set(v as string[])];
  if (ids.length > MAX_PART) return 'En fazla ' + MAX_PART + ' katılımcı seçilebilir';
  if (!ids.length) return [];
  const { results } = await c.env.DB.prepare(`SELECT id FROM users WHERE status != 'removed' AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string }>();
  if (results.length !== ids.length) return 'Ekipte olmayan bir kişi seçildi';
  return ids;
}
function cleanAgenda(v: unknown): AgendaItem[] | null {
  if (!Array.isArray(v) || v.length > MAX_AGENDA) return null;
  const out: AgendaItem[] = [];
  for (const x of v) {
    const text = clean(typeof x === 'string' ? x : x && typeof x === 'object' ? (x as AgendaItem).text : '', 300);
    if (text) out.push({ text, done: !!(x && typeof x === 'object' && (x as AgendaItem).done) });
  }
  return out;
}
function cleanDecisions(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > MAX_DECISIONS || v.some((x) => typeof x !== 'string')) return null;
  return (v as string[]).map((x) => x.trim().slice(0, 500)).filter(Boolean);
}
async function validUser(c: C, id: unknown): Promise<string | null | false> {
  if (id === null || id === '' || id === undefined) return null;
  if (typeof id !== 'string') return false;
  const u = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status != 'removed'").bind(id).first<{ id: string }>();
  return u ? u.id : false;
}
/** Müşteri kaydı varsa adını oradaki gibi yazar; yoksa serbest metin. */
async function clientName(c: C, v: unknown): Promise<string> {
  const n = clean(v, 120);
  if (!n) return '';
  const row = await c.env.DB.prepare('SELECT name FROM clients WHERE name = ? COLLATE NOCASE').bind(n).first<{ name: string }>();
  return row?.name ?? n;
}

// ---------- bildirim metinleri ----------
export const whenLine = (m: { date: string; startTime: string; endTime: string }) => longDate(m.date) + ' · ' + m.startTime + (m.endTime ? '–' + m.endTime : '');
const bodyLine = (m: MeetingView) => [m.title, m.client].filter(Boolean).join(' · ');
const metaLine = (m: MeetingView) => [whenLine(m), TYPES[m.type] + (m.type === 'yuzyuze' && m.location ? ': ' + m.location : '')].join(' · ');
async function notifyPeople(c: C, m: MeetingView, ids: string[], title: string) {
  const actor = c.get('user').id;
  for (const uid of ids) {
    await notify(c.env, { userId: uid, kind: 'toplanti', title, body: bodyLine(m), actorId: actor, link: '/toplantilar?id=' + m.id, meta: metaLine(m) }, wu(c));
  }
}

// ---------- liste ----------
// ?client=<ad> o firmanın toplantıları · ?gun=YYYY-MM-DD o günün toplantıları (Bugün sayfası)
r.get('/', async (c) => {
  const client = clean(c.req.query('client'), 120);
  const gun = c.req.query('gun');
  const where: string[] = []; const vals: unknown[] = [];
  if (client) { where.push('client = ? COLLATE NOCASE'); vals.push(client); }
  if (gun !== undefined) { if (!isDate(gun)) return err(c, 'Tarih geçersiz'); where.push('date = ?'); vals.push(gun); }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const sub = where.length ? `WHERE meeting_id IN (SELECT id FROM meetings ${W})` : '';
  const [rows, acts, files] = await c.env.DB.batch([
    c.env.DB.prepare(`SELECT * FROM meetings ${W} ORDER BY date, start_time LIMIT 2000`).bind(...vals),
    c.env.DB.prepare(`SELECT * FROM meeting_actions ${sub} ORDER BY created_at, rowid`).bind(...vals),
    c.env.DB.prepare(`SELECT * FROM meeting_files ${sub} ORDER BY created_at`).bind(...vals),
  ]);
  const group = <T extends { meeting_id: string }>(list: T[]) => { const m = new Map<string, T[]>(); for (const x of list) { const a = m.get(x.meeting_id) || []; a.push(x); m.set(x.meeting_id, a); } return m; };
  const A = group((acts.results || []) as ActionRow[]), F = group((files.results || []) as FileRow[]);
  return c.json(((rows.results || []) as MeetingRow[]).map((m) => view(m, A.get(m.id) || [], F.get(m.id) || [])));
});

r.get('/:id', async (c) => {
  const d = await detail(c, c.req.param('id'));
  if (!d) return err(c, 'Toplantı bulunamadı', 404);
  return c.json(d);
});

// ---------- ekle ----------
r.post('/', async (c) => {
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return err(c, 'Geçersiz istek');
  const title = clean(b.title, 200).replace(/\s+/g, ' ');
  if (!title) return err(c, 'Toplantı başlığını yaz');
  if (!isDate(b.date)) return err(c, 'Toplantı tarihi seç');
  if (!isTime(b.startTime)) return err(c, 'Başlangıç saatini seç');
  const endTime = b.endTime === undefined || b.endTime === '' || b.endTime === null ? '' : b.endTime;
  if (endTime && !isTime(endTime)) return err(c, 'Bitiş saati geçersiz');
  if (endTime && endTime <= b.startTime) return err(c, 'Bitiş saati başlangıçtan sonra olmalı');
  const type = b.type ?? 'yuzyuze';
  if (typeof type !== 'string' || !TYPES[type]) return err(c, 'Toplantı türü Yüz yüze, Online ya da Telefon olmalı');
  const status = b.status ?? 'planlandi';
  if (typeof status !== 'string' || !STATUSES[status]) return err(c, 'Durum geçersiz');
  const link = normLink(b.link);
  if (!link.ok) return err(c, link.e);
  const people = b.participants === undefined ? [] : await cleanPeople(c, b.participants);
  if (typeof people === 'string') return err(c, people);
  const agenda = b.agenda === undefined ? [] : cleanAgenda(b.agenda);
  if (!agenda) return err(c, 'Gündem en fazla ' + MAX_AGENDA + ' madde olabilir');
  const notes = typeof b.notes === 'string' ? b.notes.slice(0, MAX_NOTES + 1) : '';
  if (notes.length > MAX_NOTES) return err(c, 'Notlar en fazla 20.000 karakter olabilir');
  const id = newId('tp');
  await c.env.DB.prepare(
    `INSERT INTO meetings (id, title, client, date, start_time, end_time, type, location, link, participants, client_attendees, agenda, status, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, title, await clientName(c, b.client), b.date, b.startTime, endTime, type, clean(b.location, 200), link.v,
    JSON.stringify(people), clean(b.clientAttendees, 500), JSON.stringify(agenda), status, notes, c.get('user').id).run();
  const m = (await detail(c, id))!;
  if (status === 'planlandi') await notifyPeople(c, m, people, 'Toplantıya eklendin');
  live(c, id, 'added');
  return c.json(m, 201);
});

// ---------- düzenle ----------
r.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const row = await getRow(c, id);
  if (!row) return err(c, 'Toplantı bulunamadı', 404);
  const before = view(row);
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object' || Array.isArray(b)) return err(c, 'Geçersiz istek');
  const sets: string[] = []; const vals: unknown[] = [];
  const set = (col: string, v: unknown) => { sets.push(col + ' = ?'); vals.push(v); };
  if ('title' in b) { const t = clean(b.title, 200).replace(/\s+/g, ' '); if (!t) return err(c, 'Toplantı başlığı boş olamaz'); set('title', t); }
  if ('client' in b) set('client', await clientName(c, b.client));
  let date = before.date, start = before.startTime, end = before.endTime;
  if ('date' in b) { if (!isDate(b.date)) return err(c, 'Toplantı tarihi boş bırakılamaz'); date = b.date; set('date', date); }
  if ('startTime' in b) { if (!isTime(b.startTime)) return err(c, 'Başlangıç saatini seç'); start = b.startTime; set('start_time', start); }
  if ('endTime' in b) {
    const e = b.endTime === null || b.endTime === '' ? '' : b.endTime;
    if (e && !isTime(e)) return err(c, 'Bitiş saati geçersiz');
    end = e as string; set('end_time', end);
  }
  if (end && end <= start) return err(c, 'Bitiş saati başlangıçtan sonra olmalı');
  if (date !== before.date || start !== before.startTime) sets.push('reminded_for = NULL');
  if ('type' in b) { if (typeof b.type !== 'string' || !TYPES[b.type]) return err(c, 'Toplantı türü Yüz yüze, Online ya da Telefon olmalı'); set('type', b.type); }
  if ('location' in b) set('location', clean(b.location, 200));
  if ('link' in b) { const l = normLink(b.link); if (!l.ok) return err(c, l.e); set('link', l.v); }
  if ('clientAttendees' in b) set('client_attendees', clean(b.clientAttendees, 500));
  if ('status' in b) { if (typeof b.status !== 'string' || !STATUSES[b.status]) return err(c, 'Durum geçersiz'); set('status', b.status); }
  if ('notes' in b) {
    if (typeof b.notes !== 'string') return err(c, 'Notlar metin olmalı');
    if (b.notes.length > MAX_NOTES) return err(c, 'Notlar en fazla 20.000 karakter olabilir');
    set('notes', b.notes);
  }
  if ('agenda' in b) { const a = cleanAgenda(b.agenda); if (!a) return err(c, 'Gündem en fazla ' + MAX_AGENDA + ' madde olabilir'); set('agenda', JSON.stringify(a)); }
  if ('decisions' in b) { const d = cleanDecisions(b.decisions); if (!d) return err(c, 'Kararlar listesi geçersiz (en fazla ' + MAX_DECISIONS + ')'); set('decisions', JSON.stringify(d)); }
  let people: string[] | null = null;
  if ('participants' in b) { const p = await cleanPeople(c, b.participants); if (typeof p === 'string') return err(c, p); people = p; set('participants', JSON.stringify(p)); }
  if (!sets.length) return err(c, 'Değişiklik yok');
  await c.env.DB.prepare(`UPDATE meetings SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...vals, id).run();
  const m = (await detail(c, id))!;
  // bildirimler: yeni eklenen katılımcı · tarih/saat değişti · iptal / ertelendi
  const added = people ? people.filter((x) => !before.participants.includes(x)) : [];
  if (added.length && (m.status === 'planlandi' || m.status === 'ertelendi')) await notifyPeople(c, m, added, 'Toplantıya eklendin');
  const others = m.participants.filter((x) => !added.includes(x));
  const moved = m.date !== before.date || m.startTime !== before.startTime;
  if (m.status !== before.status && (m.status === 'iptal' || m.status === 'ertelendi')) await notifyPeople(c, m, others, m.status === 'iptal' ? 'Toplantı iptal edildi' : 'Toplantı ertelendi');
  else if (moved && m.status === 'planlandi') await notifyPeople(c, m, others, 'Toplantının zamanı değişti');
  live(c, id, 'edit');
  return c.json(m);
});

// ---------- sil ----------
r.delete('/:id', async (c) => {
  const row = await getRow(c, c.req.param('id'));
  if (!row) return err(c, 'Toplantı bulunamadı', 404);
  if (!isAdmin(c) && row.created_by !== c.get('user').id) return err(c, 'Toplantıyı yalnızca ekleyen kişi ya da yönetici silebilir', 403);
  const { results } = await c.env.DB.prepare('SELECT r2_key FROM meeting_files WHERE meeting_id = ?').bind(row.id).all<{ r2_key: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM meeting_files WHERE meeting_id = ?').bind(row.id),
    c.env.DB.prepare('DELETE FROM meeting_actions WHERE meeting_id = ?').bind(row.id),
    c.env.DB.prepare("DELETE FROM notifications WHERE kind = 'toplanti' AND link = ?").bind('/toplantilar?id=' + row.id),
    c.env.DB.prepare('DELETE FROM meetings WHERE id = ?').bind(row.id),
  ]);
  if (results?.length) c.executionCtx.waitUntil(c.env.FILES.delete(results.map((x) => x.r2_key)).catch(() => {}));
  live(c, row.id, 'deleted');
  return c.json({ ok: true });
});

// ---------- aksiyon maddeleri ----------
async function actionInput(c: C, b: Record<string, unknown>, partial: boolean): Promise<{ sets: Record<string, unknown> } | string> {
  const sets: Record<string, unknown> = {};
  if (!partial || 'text' in b) { const t = clean(b.text, 300); if (!t) return 'Aksiyon maddesi boş olamaz'; sets.text = t; }
  if ('assigneeId' in b) { const a = await validUser(c, b.assigneeId); if (a === false) return 'Sorumlu ekipte bulunamadı'; sets.assignee_id = a; }
  if ('dueDate' in b) { if (b.dueDate !== null && b.dueDate !== '' && !isDate(b.dueDate)) return 'Teslim tarihi geçersiz'; sets.due_date = b.dueDate || null; }
  if ('done' in b) { if (typeof b.done !== 'boolean') return 'Tamamlandı işareti geçersiz'; sets.done = b.done ? 1 : 0; }
  if ('taskId' in b) {
    if (b.taskId === null) sets.task_id = null;
    else {
      if (typeof b.taskId !== 'string') return 'İş bulunamadı';
      const t = await c.env.DB.prepare('SELECT id FROM tasks WHERE id = ?').bind(b.taskId).first();
      if (!t) return 'İş bulunamadı';
      sets.task_id = b.taskId;
    }
  }
  return { sets };
}

r.post('/:id/actions', async (c) => {
  const m = await getRow(c, c.req.param('id'));
  if (!m) return err(c, 'Toplantı bulunamadı', 404);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const v = await actionInput(c, b, false);
  if (typeof v === 'string') return err(c, v);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM meeting_actions WHERE meeting_id = ?').bind(m.id).first<{ n: number }>();
  if ((n?.n || 0) >= MAX_ACTIONS) return err(c, 'Bir toplantıya en fazla ' + MAX_ACTIONS + ' aksiyon eklenebilir');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO meeting_actions (id, meeting_id, text, assignee_id, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(newId('ta'), m.id, v.sets.text, v.sets.assignee_id ?? null, v.sets.due_date ?? null, c.get('user').id),
    touch(c, m.id),
  ]);
  live(c, m.id, 'action');
  return c.json(await detail(c, m.id), 201);
});

r.patch('/:id/actions/:aid', async (c) => {
  const a = await c.env.DB.prepare('SELECT * FROM meeting_actions WHERE id = ? AND meeting_id = ?').bind(c.req.param('aid'), c.req.param('id')).first<ActionRow>();
  if (!a) return err(c, 'Aksiyon maddesi bulunamadı', 404);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const v = await actionInput(c, b, true);
  if (typeof v === 'string') return err(c, v);
  const keys = Object.keys(v.sets);
  if (!keys.length) return err(c, 'Değişiklik yok');
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE meeting_actions SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...keys.map((k) => v.sets[k]), a.id),
    touch(c, a.meeting_id),
  ]);
  live(c, a.meeting_id, 'action');
  return c.json(await detail(c, a.meeting_id));
});

r.delete('/:id/actions/:aid', async (c) => {
  const a = await c.env.DB.prepare('SELECT * FROM meeting_actions WHERE id = ? AND meeting_id = ?').bind(c.req.param('aid'), c.req.param('id')).first<ActionRow>();
  if (!a) return err(c, 'Aksiyon maddesi bulunamadı', 404);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM meeting_actions WHERE id = ?').bind(a.id), touch(c, a.meeting_id)]);
  live(c, a.meeting_id, 'action');
  return c.json(await detail(c, a.meeting_id));
});

// ---------- ses kayıtları ve dosyalar (R2) ----------
const ASCII = (s: string, i: number, n: number, b: Uint8Array) => String.fromCharCode(...b.subarray(i, i + n)) === s;
/** İlk baytlardan ses türü; tarayıcının söylediğine güvenilmez. */
export function sniffAudio(b: Uint8Array): { type: string; ext: string } | null {
  if (b.length < 12) return null;
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { type: 'audio/webm', ext: 'webm' };
  if (ASCII('OggS', 0, 4, b)) return { type: 'audio/ogg', ext: 'ogg' };
  if (ASCII('ftyp', 4, 4, b)) return { type: 'audio/mp4', ext: 'm4a' };
  if (ASCII('RIFF', 0, 4, b) && ASCII('WAVE', 8, 4, b)) return { type: 'audio/wav', ext: 'wav' };
  if (ASCII('fLaC', 0, 4, b)) return { type: 'audio/flac', ext: 'flac' };
  if (ASCII('#!AMR', 0, 5, b)) return { type: 'audio/amr', ext: 'amr' };
  if (ASCII('caff', 0, 4, b)) return { type: 'audio/x-caf', ext: 'caf' };
  if (ASCII('ID3', 0, 3, b)) return { type: 'audio/mpeg', ext: 'mp3' };
  if (b[0] === 0xff && (b[1] & 0xf6) === 0xf0) return { type: 'audio/aac', ext: 'aac' }; // ADTS
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return { type: 'audio/mpeg', ext: 'mp3' };
  return null;
}
const DOC_EXT: Record<string, string> = {
  pdf: 'application/pdf', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  key: 'application/vnd.apple.keynote', pages: 'application/vnd.apple.pages', numbers: 'application/vnd.apple.numbers', zip: 'application/zip',
  ppt: 'application/vnd.ms-powerpoint', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic',
};
/** Belge türü: içerik + uzantı birlikte; tanınmayan biçim reddedilir. */
export function sniffDoc(b: Uint8Array, name: string): { type: string; ext: string } | null {
  const ext = (/\.([a-z0-9]{1,8})$/i.exec(name)?.[1] || '').toLowerCase();
  const img = sniffImage(b);
  if (img) return { type: img, ext: img === 'image/jpeg' ? 'jpg' : img.split('/')[1] };
  if (ASCII('%PDF', 0, 4, b)) return { type: 'application/pdf', ext: 'pdf' };
  if (b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) { // ZIP: Office / iWork / zip
    const e = ['pptx', 'docx', 'xlsx', 'key', 'pages', 'numbers', 'zip'].includes(ext) ? ext : 'zip';
    return { type: DOC_EXT[e], ext: e };
  }
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) { const e = ['ppt', 'doc', 'xls'].includes(ext) ? ext : 'doc'; return { type: DOC_EXT[e], ext: e }; }
  if (ASCII('ftyp', 4, 4, b) && /^(heic|heix|mif1)/.test(String.fromCharCode(...b.subarray(8, 12)))) return { type: 'image/heic', ext: 'heic' };
  return null;
}
const INLINE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Gövdeyi belleğe almadan R2'ye akıtır: ilk baytları okuyup türü tanır, gerisini sabit uzunlukla gönderir. */
async function readHead(body: ReadableStream<Uint8Array>): Promise<{ head: Uint8Array; reader: ReadableStreamDefaultReader<Uint8Array> }> {
  const reader = body.getReader();
  let head = new Uint8Array(0);
  while (head.length < 16) {
    const { done, value } = await reader.read();
    if (done) break;
    const n = new Uint8Array(head.length + value.length); n.set(head); n.set(value, head.length); head = n;
  }
  return { head, reader };
}

r.post('/:id/files', async (c) => {
  const m = await getRow(c, c.req.param('id'));
  if (!m) return err(c, 'Toplantı bulunamadı', 404);
  const kind = c.req.query('kind') === 'ses' ? 'ses' : c.req.query('kind') === 'dosya' ? 'dosya' : null;
  if (!kind) return err(c, 'Dosya türü belirtilmedi');
  const max = kind === 'ses' ? MAX_AUDIO : MAX_DOC;
  const maxMsg = kind === 'ses' ? 'Ses kaydı en fazla 95 MB olabilir' : 'Dosya en fazla 25 MB olabilir';
  const len = Number(c.req.header('Content-Length') || 0);
  if (!len || !c.req.raw.body) return err(c, 'Dosya boş', len ? 400 : 411);
  if (len > max) return err(c, maxMsg, 413);
  const declared = (c.req.header('Content-Type') || '').toLowerCase().split(';')[0].trim();
  if (kind === 'ses' && !/^(audio\/[a-z0-9.+-]+|video\/(webm|mp4|quicktime))$/.test(declared)) return err(c, 'Yalnızca ses dosyası yüklenebilir', 415);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM meeting_files WHERE meeting_id = ?').bind(m.id).first<{ n: number }>();
  if ((n?.n || 0) >= MAX_FILES) return err(c, 'Bir toplantıya en fazla ' + MAX_FILES + ' dosya eklenebilir');

  let rawName = c.req.query('name') || '';
  try { rawName = decodeURIComponent(rawName); } catch { /* olduğu gibi */ }
  let name = rawName.replace(/[\u0000-\u001f\u007f/\\"]/g, '').trim().slice(0, 150);
  const { head, reader } = await readHead(c.req.raw.body);
  const t = kind === 'ses' ? sniffAudio(head) : sniffDoc(head, name);
  if (!t) { reader.cancel().catch(() => {}); return err(c, kind === 'ses' ? 'Ses dosyası tanınmadı (webm, m4a, mp3, wav, ogg…)' : 'Bu dosya türü desteklenmiyor (PDF, sunum, belge, görsel)', 415); }
  if (!name || /^(blob|kayit|recording)(\.[a-z0-9]+)?$/i.test(name)) {
    const now = new Date(Date.now() + 3 * 3600_000).toISOString();
    name = (kind === 'ses' ? 'Ses kaydı ' : 'Dosya ') + now.slice(0, 10).split('-').reverse().join('.') + ' ' + now.slice(11, 16);
  }
  const dur = Number(c.req.query('sure'));
  const duration = kind === 'ses' && Number.isFinite(dur) && dur > 0 && dur < 24 * 3600 ? Math.round(dur) : null;

  const fid = newId('tf');
  const key = `toplantilar/${m.id}/${fid}.${t.ext}`;
  const { readable, writable } = new FixedLengthStream(len);
  const pump = (async () => {
    const w = writable.getWriter();
    try {
      await w.write(head);
      for (;;) { const { done, value } = await reader.read(); if (done) break; await w.write(value); }
      await w.close();
    } catch (e) { await w.abort(e).catch(() => {}); throw e; }
  })();
  try { await Promise.all([c.env.FILES.put(key, readable, { httpMetadata: { contentType: t.type } }), pump]); }
  catch { c.executionCtx.waitUntil(c.env.FILES.delete(key).catch(() => {})); return err(c, 'Dosya yüklenemedi, tekrar dene'); }
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO meeting_files (id, meeting_id, kind, name, r2_key, content_type, size, duration_s, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(fid, m.id, kind, name, key, t.type, len, duration, c.get('user').id),
    touch(c, m.id),
  ]);
  live(c, m.id, 'file');
  const f = await c.env.DB.prepare('SELECT * FROM meeting_files WHERE id = ?').bind(fid).first<FileRow>();
  return c.json(fileView(f!), 201);
});

const getFile = (c: C) => c.env.DB.prepare('SELECT * FROM meeting_files WHERE id = ? AND meeting_id = ?').bind(c.req.param('fid'), c.req.param('id')).first<FileRow>();

// İndirme / dinleme: giriş zorunlu (api altında). Safari'nin ses oynatıcısı için bayt aralığı (Range) desteklenir.
r.get('/:id/files/:fid', async (c) => {
  const f = await getFile(c);
  if (!f) return err(c, 'Dosya bulunamadı', 404);
  const download = c.req.query('download') !== undefined;
  const inline = !download && (f.kind === 'ses' || INLINE.has(f.content_type));
  const ext = f.r2_key.split('.').pop() || '';
  const fname = /\.[a-z0-9]{1,8}$/i.test(f.name) ? f.name : f.name + '.' + ext;
  const ascii = fname.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const h = new Headers({
    'Content-Type': f.content_type,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fname)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'" + (inline ? '; sandbox' : ''),
    'Cache-Control': 'private, max-age=86400',
    'Accept-Ranges': 'bytes',
  });
  const range = /^bytes=(\d*)-(\d*)$/.exec(c.req.header('Range') || '');
  if (range && (range[1] || range[2])) {
    const size = f.size;
    let start: number, end: number;
    if (!range[1]) { const n = Math.min(size, +range[2]); start = size - n; end = size - 1; }
    else { start = +range[1]; end = range[2] ? Math.min(+range[2], size - 1) : size - 1; }
    if (start >= size || start > end) { h.set('Content-Range', `bytes */${size}`); return new Response(null, { status: 416, headers: h }); }
    const obj = await c.env.FILES.get(f.r2_key, { range: { offset: start, length: end - start + 1 } });
    if (!obj) return err(c, 'Dosya bulunamadı', 404);
    h.set('Content-Range', `bytes ${start}-${end}/${size}`);
    h.set('Content-Length', String(end - start + 1));
    return new Response(obj.body, { status: 206, headers: h });
  }
  const obj = await c.env.FILES.get(f.r2_key);
  if (!obj) return err(c, 'Dosya bulunamadı', 404);
  h.set('Content-Length', String(obj.size));
  if (obj.httpEtag) h.set('ETag', obj.httpEtag);
  return new Response(obj.body, { headers: h });
});

r.patch('/:id/files/:fid', async (c) => {
  const f = await getFile(c);
  if (!f) return err(c, 'Dosya bulunamadı', 404);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const name = (typeof b.name === 'string' ? b.name : '').replace(/[\u0000-\u001f\u007f/\\"]/g, '').trim().slice(0, 150);
  if (!name) return err(c, 'Ad boş olamaz');
  await c.env.DB.batch([c.env.DB.prepare('UPDATE meeting_files SET name = ? WHERE id = ?').bind(name, f.id), touch(c, f.meeting_id)]);
  live(c, f.meeting_id, 'file');
  return c.json(await detail(c, f.meeting_id));
});

r.delete('/:id/files/:fid', async (c) => {
  const f = await getFile(c);
  if (!f) return err(c, 'Dosya bulunamadı', 404);
  if (!isAdmin(c) && f.created_by !== c.get('user').id) return err(c, (f.kind === 'ses' ? 'Ses kaydını' : 'Dosyayı') + ' yalnızca yükleyen ya da yönetici silebilir', 403);
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM meeting_files WHERE id = ?').bind(f.id), touch(c, f.meeting_id)]);
  c.executionCtx.waitUntil(c.env.FILES.delete(f.r2_key).catch(() => {}));
  live(c, f.meeting_id, 'file');
  return c.json(await detail(c, f.meeting_id));
});

// ---------- 30 dk önce hatırlatma (dakikalık zamanlayıcı) ----------
/** "2026-11-07" + "14:30" (İstanbul, UTC+3) → epoch ms */
export const startMs = (date: string, time: string) => Date.parse(date + 'T' + time + ':00+03:00');

export async function toplantiHatirlatma(env: Env, now = new Date()): Promise<void> {
  const t = now.getTime();
  const today = new Date(t + 3 * 3600_000).toISOString().slice(0, 10);
  const tomorrow = new Date(t + 27 * 3600_000).toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    "SELECT * FROM meetings WHERE status = 'planlandi' AND date IN (?, ?)",
  ).bind(today, tomorrow).all<MeetingRow>();
  for (const row of results || []) {
    const key = row.date + ' ' + row.start_time;
    if (row.reminded_for === key) continue;
    const left = startMs(row.date, row.start_time) - t;
    if (!(left > 0 && left <= REMIND_MIN * 60_000)) continue;
    // önce işaretle (aynı toplantı için iki kez gitmesin); başka bir çalıştırma önce davrandıysa atla
    const upd = await env.DB.prepare('UPDATE meetings SET reminded_for = ? WHERE id = ? AND (reminded_for IS NULL OR reminded_for != ?)').bind(key, row.id, key).run();
    if (!upd.meta.changes) continue;
    const m = view(row);
    let to = m.participants;
    if (!to.length && m.createdBy) to = [m.createdBy];
    const { results: act } = to.length
      ? await env.DB.prepare(`SELECT id FROM users WHERE status = 'active' AND id IN (${to.map(() => '?').join(',')})`).bind(...to).all<{ id: string }>()
      : { results: [] as { id: string }[] };
    const mins = Math.max(1, Math.round(left / 60_000));
    const where = m.type === 'online' ? (m.link ? 'Online · bağlantı toplantı sayfasında' : 'Online') : m.type === 'telefon' ? 'Telefon' : m.location ? 'Yer: ' + m.location : 'Yüz yüze';
    for (const u of act || []) {
      try {
        await notify(env, { userId: u.id, kind: 'toplanti', title: mins + ' dk sonra toplantı', body: bodyLine(m), link: '/toplantilar?id=' + m.id, meta: m.startTime + (m.endTime ? '–' + m.endTime : '') + ' · ' + where });
      } catch (e) { console.error('toplantı hatırlatma', e); }
    }
  }
}
