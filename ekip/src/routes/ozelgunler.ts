// Özel Günler: gün ekle/düzenle/sil, firmalar, sorumlu, Hazırladım, İş Planı'na gönder
// Ekipteki herkes her şeyi yapabilir. Atama yalnızca kullanıcı seçince yapılır (otomatik atama yok).
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Vars } from '../types';
import { notify, changed } from '../notify';
import { broadcast } from '../hub';
import { clean, isDate, newId } from '../util';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
type C = Context<{ Bindings: Env; Variables: Vars }>;

const TONES = ['anma', 'kutlama', 'bilgi', 'kampanya'];
const FORMATS = ['Story', 'Post', 'Reels', 'Video'];
const MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

interface DayRow {
  id: string; name: string; date: string; star: number; tone: string; note: string; range_label: string | null;
  created_by: string | null; created_at: string; updated_at: string;
}
interface LineRow {
  day_id: string; client: string; format: string; lang: string; assignee_id: string | null; status: number;
  done_by: string | null; done_at: string | null; task_id: string | null; created_at: string; updated_at: string;
}

/** Paylaşımdan 2 iş günü önce (Cumartesi/Pazar sayılmaz). */
export function prepDate(date: string, n = 2): string {
  const d = new Date(date + 'T00:00:00Z');
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}
const short = (s: string) => { const d = new Date(s + 'T00:00:00Z'); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()]; };

const lineView = (l: LineRow) => ({
  client: l.client, format: l.format, lang: l.lang, assigneeId: l.assignee_id, status: l.status,
  doneBy: l.done_by, doneAt: l.done_at, taskId: l.task_id, createdAt: l.created_at, updatedAt: l.updated_at,
});
const byCreated = (a: LineRow, b: LineRow) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.client.localeCompare(b.client, 'tr');
const dayView = (d: DayRow, lines: LineRow[]) => ({
  id: d.id, name: d.name, date: d.date, star: !!d.star, tone: d.tone, note: d.note, rangeLabel: d.range_label || '',
  prepDate: prepDate(d.date), createdBy: d.created_by, createdAt: d.created_at, updatedAt: d.updated_at,
  rows: lines.filter((l) => l.day_id === d.id).sort(byCreated).map(lineView),
});

async function loadDay(env: Env, id: string) {
  const d = await env.DB.prepare('SELECT * FROM special_days WHERE id = ?').bind(id).first<DayRow>();
  if (!d) return null;
  const { results } = await env.DB.prepare('SELECT * FROM special_day_rows WHERE day_id = ?').bind(id).all<LineRow>();
  return dayView(d, results);
}
const wu = (c: C) => c.executionCtx.waitUntil.bind(c.executionCtx);
const dayChanged = (c: C, id: string) => changed(c.env, 'days', wu(c), { id });

async function validUser(c: C, id: unknown): Promise<string | null | false> {
  if (id === null || id === '' || id === undefined) return null;
  if (typeof id !== 'string') return false;
  const u = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status != 'removed'").bind(id).first();
  return u ? id : false;
}
function cleanLang(v: unknown): string | false {
  if (v === undefined || v === null || v === '') return 'TR';
  const s = clean(v, 24).toLocaleUpperCase('tr').replace(/\s+/g, '');
  return /^[A-ZÇĞİÖŞÜ]{2,3}(\+[A-ZÇĞİÖŞÜ]{2,3}){0,4}$/.test(s) ? s : false;
}

// Gün alanlarını doğrular. partial: yalnızca gelen alanlar
function readDayFields(b: any, partial: boolean): { error: string } | { sets: Record<string, unknown> } {
  const sets: Record<string, unknown> = {};
  if (!partial || 'name' in b) {
    const name = clean(b.name, 200);
    if (!name) return { error: 'Özel günün adını yaz' };
    sets.name = name;
  }
  if (!partial || 'date' in b) {
    if (!isDate(b.date)) return { error: 'Geçerli bir tarih seç' };
    sets.date = b.date;
  }
  if ('star' in b) { if (typeof b.star !== 'boolean') return { error: 'Önemli gün bilgisi geçersiz' }; sets.star = b.star ? 1 : 0; }
  if ('tone' in b) { if (!TONES.includes(b.tone)) return { error: 'Tür anma, kutlama, bilgi ya da kampanya olmalı' }; sets.tone = b.tone; }
  if ('note' in b) sets.note = clean(b.note, 2000);
  if ('rangeLabel' in b) sets.range_label = clean(b.rangeLabel, 60) || null;
  return { sets };
}

// ---------- günler ----------
r.get('/', async (c) => {
  const [{ results: days }, { results: lines }] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM special_days ORDER BY date, name').all<DayRow>(),
    c.env.DB.prepare('SELECT * FROM special_day_rows').all<LineRow>(),
  ]);
  return c.json(days.map((d) => dayView(d, lines)));
});

r.get('/:id', async (c) => {
  const d = await loadDay(c.env, c.req.param('id'));
  return d ? c.json(d) : c.json({ error: 'Özel gün bulunamadı' }, 404);
});

r.post('/', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const f = readDayFields(b, false);
  if ('error' in f) return c.json({ error: f.error }, 400);
  const s = f.sets;
  const id = newId('d');
  await c.env.DB.prepare('INSERT INTO special_days (id, name, date, star, tone, note, range_label, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, s.name, s.date, s.star ?? 0, s.tone ?? 'bilgi', s.note ?? '', s.range_label ?? null, c.get('user').id).run();
  dayChanged(c, id);
  return c.json(await loadDay(c.env, id), 201);
});

r.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const before = await c.env.DB.prepare('SELECT id FROM special_days WHERE id = ?').bind(id).first();
  if (!before) return c.json({ error: 'Özel gün bulunamadı' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const f = readDayFields(b, true);
  if ('error' in f) return c.json({ error: f.error }, 400);
  const keys = Object.keys(f.sets);
  if (!keys.length) return c.json({ error: 'Değişiklik yok' }, 400);
  await c.env.DB.prepare(`UPDATE special_days SET ${keys.map((k) => k + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .bind(...keys.map((k) => f.sets[k]), id).run();
  dayChanged(c, id);
  return c.json(await loadDay(c.env, id));
});

r.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const d = await c.env.DB.prepare('SELECT id FROM special_days WHERE id = ?').bind(id).first();
  if (!d) return c.json({ error: 'Özel gün bulunamadı' }, 404);
  // İş Planı'na gönderilmiş işler yerinde kalır
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM special_day_rows WHERE day_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM special_days WHERE id = ?').bind(id),
  ]);
  dayChanged(c, id);
  return c.json({ ok: true });
});

// ---------- firma satırları ----------
async function notifyAssignee(c: C, day: DayRow, client: string, format: string, userId: string) {
  await notify(c.env, {
    userId, kind: 'special', actorId: c.get('user').id, title: 'Özel gün görevi',
    body: `${day.name} · ${client} · ${format}`, link: '/ozel-gunler?id=' + day.id,
    meta: 'Hazırlık: ' + short(prepDate(day.date)) + ' · Paylaşım: ' + short(day.date),
  }, wu(c));
}

// Firma ekle: { rows: [{ client, format?, lang?, assigneeId? }] } ya da tek satır { client, … }
r.post('/:id/rows', async (c) => {
  const id = c.req.param('id');
  const day = await c.env.DB.prepare('SELECT * FROM special_days WHERE id = ?').bind(id).first<DayRow>();
  if (!day) return c.json({ error: 'Özel gün bulunamadı' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const input: any[] = Array.isArray(b.rows) ? b.rows : b.client !== undefined ? [b] : [];
  if (!input.length) return c.json({ error: 'En az bir firma seç' }, 400);
  if (input.length > 100) return c.json({ error: 'Tek seferde en fazla 100 firma eklenebilir' }, 400);
  const { results: clients } = await c.env.DB.prepare('SELECT name FROM clients WHERE archived = 0').all<{ name: string }>();
  const known = new Map(clients.map((x) => [x.name.toLocaleLowerCase('tr'), x.name]));
  const { results: existing } = await c.env.DB.prepare('SELECT client FROM special_day_rows WHERE day_id = ?').bind(id).all<{ client: string }>();
  const have = new Set(existing.map((x) => x.client.toLocaleLowerCase('tr')));
  const rows: { client: string; format: string; lang: string; assignee: string | null }[] = [];
  for (const it of input) {
    const name = known.get(clean(it?.client, 120).toLocaleLowerCase('tr'));
    if (!name) return c.json({ error: 'Firma müşteri listesinde yok: ' + (clean(it?.client, 120) || '—') }, 400);
    if (have.has(name.toLocaleLowerCase('tr'))) return c.json({ error: name + ' bu güne zaten eklenmiş' }, 409);
    const format = it.format === undefined ? 'Story' : it.format;
    if (!FORMATS.includes(format)) return c.json({ error: 'Biçim Story, Post, Reels ya da Video olmalı' }, 400);
    const lang = cleanLang(it.lang);
    if (lang === false) return c.json({ error: 'Dil TR, EN, TR+BG gibi yazılmalı' }, 400);
    const assignee = await validUser(c, it.assigneeId);
    if (assignee === false) return c.json({ error: 'Sorumlu bulunamadı' }, 400);
    have.add(name.toLocaleLowerCase('tr'));
    rows.push({ client: name, format, lang, assignee });
  }
  // created_at: seçim sırası korunsun diye saniye saniye artar
  await c.env.DB.batch(rows.map((x, i) => c.env.DB.prepare(
    `INSERT INTO special_day_rows (day_id, client, format, lang, assignee_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'), datetime('now'))`,
  ).bind(id, x.client, x.format, x.lang, x.assignee, i)));
  for (const x of rows) if (x.assignee) await notifyAssignee(c, day, x.client, x.format, x.assignee);
  dayChanged(c, id);
  return c.json(await loadDay(c.env, id), 201);
});

async function loadLine(c: C) {
  const id = c.req.param('id') as string;
  const client = c.req.param('client') as string;
  const day = await c.env.DB.prepare('SELECT * FROM special_days WHERE id = ?').bind(id).first<DayRow>();
  if (!day) return { err: c.json({ error: 'Özel gün bulunamadı' }, 404) };
  const line = await c.env.DB.prepare('SELECT * FROM special_day_rows WHERE day_id = ? AND client = ?').bind(id, client).first<LineRow>();
  if (!line) return { err: c.json({ error: 'Bu firma bu günde yok' }, 404) };
  return { day, line };
}

// Satır güncelle: { format?, lang?, assigneeId?, status? } — status 2 = Hazırladım (yapan kişi kaydedilir)
r.patch('/:id/rows/:client', async (c) => {
  const got = await loadLine(c);
  if ('err' in got) return got.err;
  const { day, line } = got;
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = []; const vals: unknown[] = [];
  if ('format' in b) { if (!FORMATS.includes(b.format)) return c.json({ error: 'Biçim Story, Post, Reels ya da Video olmalı' }, 400); sets.push('format = ?'); vals.push(b.format); }
  if ('lang' in b) { const l = cleanLang(b.lang); if (l === false) return c.json({ error: 'Dil TR, EN, TR+BG gibi yazılmalı' }, 400); sets.push('lang = ?'); vals.push(l); }
  let newAssignee: string | null | undefined;
  if ('assigneeId' in b) {
    const a = await validUser(c, b.assigneeId);
    if (a === false) return c.json({ error: 'Sorumlu bulunamadı' }, 400);
    sets.push('assignee_id = ?'); vals.push(a);
    if (a !== line.assignee_id) newAssignee = a;
  }
  let statusChanged = false;
  if ('status' in b) {
    if (![0, 1, 2].includes(b.status)) return c.json({ error: 'Geçersiz durum' }, 400);
    sets.push('status = ?'); vals.push(b.status);
    if (b.status === 2) { if (line.status !== 2) { sets.push("done_by = ?, done_at = datetime('now')"); vals.push(u.id); } }
    else sets.push('done_by = NULL, done_at = NULL');
    statusChanged = b.status !== line.status;
  }
  if (!sets.length) return c.json({ error: 'Değişiklik yok' }, 400);
  await c.env.DB.prepare(`UPDATE special_day_rows SET ${sets.join(', ')}, updated_at = datetime('now') WHERE day_id = ? AND client = ?`)
    .bind(...vals, day.id, line.client).run();
  if (newAssignee) await notifyAssignee(c, day, line.client, 'format' in b ? b.format : line.format, newAssignee);
  // İş Planı'na gönderilmişse durum oradaki işe de yansır
  if (statusChanged && line.task_id) {
    const res = await c.env.DB.prepare(`UPDATE tasks SET status = ?, completed_at = ${b.status === 2 ? "COALESCE(completed_at, datetime('now'))" : 'NULL'}, updated_at = datetime('now') WHERE id = ?`)
      .bind(b.status, line.task_id).run();
    if (res.meta.changes) c.executionCtx.waitUntil(broadcast(c.env, { type: 'tasks' }));
  }
  dayChanged(c, day.id);
  return c.json(await loadDay(c.env, day.id));
});

r.delete('/:id/rows/:client', async (c) => {
  const got = await loadLine(c);
  if ('err' in got) return got.err;
  await c.env.DB.prepare('DELETE FROM special_day_rows WHERE day_id = ? AND client = ?').bind(got.day.id, got.line.client).run();
  dayChanged(c, got.day.id);
  return c.json(await loadDay(c.env, got.day.id));
});

// İş Planı'na gönder: satır için iş oluşturur (bir satır bir kez)
r.post('/:id/rows/:client/task', async (c) => {
  const got = await loadLine(c);
  if ('err' in got) return got.err;
  const { day, line } = got;
  const u = c.get('user');
  if (line.task_id) {
    const t = await c.env.DB.prepare('SELECT id FROM tasks WHERE id = ?').bind(line.task_id).first();
    if (t) return c.json({ error: 'Bu satır zaten İş Planı\'na gönderildi', taskId: line.task_id }, 409);
  }
  const taskId = newId('t');
  const title = `${day.name} – ${line.format}`.slice(0, 300);
  const due = prepDate(day.date);
  const note = [line.lang && line.lang !== 'TR' ? 'Dil: ' + line.lang : '', 'Paylaşım: ' + short(day.date), day.note].filter(Boolean).join('\n');
  // satırı kilitle: aynı anda iki gönderim olursa yalnızca biri kazanır
  const lock = await c.env.DB.prepare("UPDATE special_day_rows SET task_id = ?, updated_at = datetime('now') WHERE day_id = ? AND client = ? AND task_id IS ?")
    .bind(taskId, day.id, line.client, line.task_id).run();
  if (!lock.meta.changes) return c.json({ error: 'Bu satır zaten İş Planı\'na gönderildi' }, 409);
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, title, client, assignee_id, due_date, status, note, source, created_by, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'ozel-gun', ?, ${line.status === 2 ? "datetime('now')" : 'NULL'})`,
  ).bind(taskId, title, line.client, line.assignee_id, due, line.status, note, u.id).run();
  if (line.assignee_id) {
    await notify(c.env, {
      userId: line.assignee_id, kind: 'assign', taskId, actorId: u.id, title: 'Sana yeni iş atandı', body: title,
      meta: line.client + ' · Teslim: ' + short(due),
    }, wu(c));
  }
  c.executionCtx.waitUntil(broadcast(c.env, { type: 'tasks' }));
  dayChanged(c, day.id);
  return c.json({ taskId, day: await loadDay(c.env, day.id) }, 201);
});
