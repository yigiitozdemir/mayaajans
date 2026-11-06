// Çekim Planı: çekimler, ekip, hazırlık listesi, "yarın çekim var" hatırlatması
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Vars } from '../types';
import { notify, changed } from '../notify';
import { broadcast } from '../hub';
import { clean, isDate, newId } from '../util';
import { cekimHavalari, istanbulDate, HAVA_GUN } from '../hava';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
type C = Context<{ Bindings: Env; Variables: Vars }>;

interface ShootRow {
  id: string; title: string; client: string; date: string; time: string; location: string; status: number;
  note: string; crew: string; checks: string; source: string; created_by: string | null;
  created_at: string; updated_at: string; completed_at: string | null; reminded_for: string | null; outdoor: number;
}
interface Check { text: string; done: boolean }

export const DEFAULT_CHECKS = ['Yedek batarya ve kart', 'Gimbal', 'Hava durumu kontrolü', 'Lokasyon / izin teyidi'];
const MAX_CHECKS = 40;
const MAX_CREW = 20;

const LMON = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const LDAY = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
/** "2026-11-06" → "6 Kasım Cuma" */
export function longDate(s: string): string {
  const d = new Date(s + 'T00:00:00Z');
  return d.getUTCDate() + ' ' + LMON[d.getUTCMonth()] + ' ' + LDAY[d.getUTCDay()];
}

/** Serbest saat metnini sıralama anahtarına çevirir ("10:00" → 600, "Sabah" → 540, boş → en sona). */
export function timeKey(t: string): number {
  const s = (t || '').toLocaleLowerCase('tr').trim();
  const m = /(\d{1,2})[:.](\d{2})/.exec(s);
  if (m) return Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
  if (!s) return 1440;
  if (s.includes('tam gün')) return 480;
  if (s.includes('sabah')) return 540;
  if (s.includes('öğleden sonra')) return 840;
  if (s.includes('öğle')) return 720;
  if (s.includes('akşam')) return 1080;
  if (s.includes('gece')) return 1260;
  return 1439;
}

const parseArr = <T>(s: string): T[] => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };

function view(s: ShootRow) {
  return {
    id: s.id, title: s.title, client: s.client, date: s.date, time: s.time, location: s.location, status: s.status,
    note: s.note, crew: parseArr<string>(s.crew), checks: parseArr<Check>(s.checks), source: s.source, createdBy: s.created_by,
    createdAt: s.created_at, updatedAt: s.updated_at, completedAt: s.completed_at, remindedFor: s.reminded_for,
    outdoor: !!s.outdoor,
  };
}
type ShootView = ReturnType<typeof view>;

/** Sıralama: Planlanan (tarih + saat artan) → Tamamlanan (en yeni üstte) → İptal (en yeni üstte). */
function sortShoots(a: ShootView, b: ShootView): number {
  const rank = (x: ShootView) => (x.status === 0 ? 0 : x.status === 1 ? 1 : 2);
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  const dir = a.status === 0 ? 1 : -1;
  if (a.date !== b.date) return (a.date < b.date ? -1 : 1) * dir;
  return (timeKey(a.time) - timeKey(b.time)) * dir;
}

function cleanChecks(v: unknown): Check[] | null {
  if (!Array.isArray(v)) return null;
  const out: Check[] = [];
  for (const x of v.slice(0, MAX_CHECKS)) {
    const text = clean(typeof x === 'string' ? x : x && typeof x === 'object' ? (x as Check).text : '', 200);
    if (text) out.push({ text, done: !!(x && typeof x === 'object' && (x as Check).done) });
  }
  return out;
}

/** Ekip listesini doğrular: benzersiz, var olan (çıkarılmamış) kullanıcılar. */
async function cleanCrew(c: C, v: unknown): Promise<string[] | string> {
  if (!Array.isArray(v)) return 'Çekim ekibi listesi geçersiz';
  if (v.some((x) => typeof x !== 'string' || x.length > 64)) return 'Çekim ekibi listesi geçersiz';
  const ids = [...new Set(v as string[])];
  if (ids.length > MAX_CREW) return 'Çekim ekibi en fazla ' + MAX_CREW + ' kişi olabilir';
  if (!ids.length) return [];
  const { results } = await c.env.DB.prepare(`SELECT id FROM users WHERE status != 'removed' AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string }>();
  if (results.length !== ids.length) return 'Ekipte olmayan bir kişi seçildi';
  return ids;
}

const metaLine = (s: ShootView) => [[longDate(s.date), s.time].filter(Boolean).join(' '), s.location].filter(Boolean).join(' · ');
const bodyLine = (s: ShootView) => [s.title, s.client].filter(Boolean).join(' · ');

async function notifyCrew(c: C, s: ShootView, ids: string[], title: string) {
  const actor = c.get('user').id;
  const wu = c.executionCtx.waitUntil.bind(c.executionCtx);
  for (const uid of ids) {
    await notify(c.env, { userId: uid, kind: 'shoot', title, body: bodyLine(s), actorId: actor, link: '/cekim?id=' + s.id, meta: metaLine(s) }, wu);
  }
}

const getRow = (c: C, id: string) => c.env.DB.prepare('SELECT * FROM shoots WHERE id = ?').bind(id).first<ShootRow>();
const live = (c: C, id: string) => changed(c.env, 'shoots', c.executionCtx.waitUntil.bind(c.executionCtx), { id });

// ---------- liste / tek çekim ----------
r.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM shoots').all<ShootRow>();
  return c.json(results.map(view).sort(sortShoots));
});

// ---------- hava durumu: önümüzdeki 16 gündeki planlı dış çekimler ----------
// { [çekimId]: HavaOzet } · ağ hatasında ilgili çekim listede olmaz (arayüz sessizce göstermez)
r.get('/hava', async (c) => {
  const from = istanbulDate(), to = istanbulDate(new Date(), HAVA_GUN - 1);
  const { results } = await c.env.DB.prepare(
    'SELECT id, date, time, location FROM shoots WHERE outdoor = 1 AND status = 0 AND date >= ? AND date <= ?',
  ).bind(from, to).all<{ id: string; date: string; time: string; location: string }>();
  const out = results.length ? await cekimHavalari(c.env, results) : {};
  return c.json(out, 200, { 'Cache-Control': 'no-store' });
});

r.get('/:id', async (c) => {
  const row = await getRow(c, c.req.param('id'));
  if (!row) return c.json({ error: 'Çekim bulunamadı' }, 404);
  return c.json(view(row));
});

// ---------- ekle ----------
r.post('/', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const title = clean(b.title, 200);
  if (!title) return c.json({ error: 'Çekim / içerik adını yaz' }, 400);
  if (!isDate(b.date)) return c.json({ error: 'Çekim tarihi seç' }, 400);
  const status = [0, 1, 2].includes(b.status as number) ? (b.status as number) : 0;
  const crew = b.crew === undefined ? [] : await cleanCrew(c, b.crew);
  if (typeof crew === 'string') return c.json({ error: crew }, 400);
  let checks: Check[] | null = DEFAULT_CHECKS.map((text) => ({ text, done: false }));
  if (b.checks !== undefined) { checks = cleanChecks(b.checks); if (!checks) return c.json({ error: 'Hazırlık listesi geçersiz' }, 400); }
  const id = newId('s');
  await c.env.DB.prepare(
    `INSERT INTO shoots (id, title, client, date, time, location, status, note, crew, checks, source, created_by, completed_at, outdoor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'app', ?, ${status === 1 ? "datetime('now')" : 'NULL'}, ?)`,
  ).bind(id, title, clean(b.client, 120), b.date, clean(b.time, 40), clean(b.location, 160), status, clean(b.note, 4000),
    JSON.stringify(crew), JSON.stringify(checks), u.id, b.outdoor === true ? 1 : 0).run();
  const s = view((await getRow(c, id))!);
  if (status !== 2) await notifyCrew(c, s, crew, 'Çekim ekibine eklendin');
  live(c, id);
  return c.json(s, 201);
});

// ---------- düzenle ----------
r.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const beforeRow = await getRow(c, id);
  if (!beforeRow) return c.json({ error: 'Çekim bulunamadı' }, 404);
  const before = view(beforeRow);
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const sets: string[] = []; const vals: unknown[] = [];
  if ('title' in b) { const t = clean(b.title, 200); if (!t) return c.json({ error: 'Çekim / içerik adı boş olamaz' }, 400); sets.push('title = ?'); vals.push(t); }
  if ('client' in b) { sets.push('client = ?'); vals.push(clean(b.client, 120)); }
  if ('date' in b) {
    if (!isDate(b.date)) return c.json({ error: 'Çekim tarihi boş bırakılamaz' }, 400);
    sets.push('date = ?'); vals.push(b.date);
    if (b.date !== before.date) sets.push('reminded_for = NULL');
  }
  if ('time' in b) { sets.push('time = ?'); vals.push(clean(b.time, 40)); }
  if ('location' in b) { sets.push('location = ?'); vals.push(clean(b.location, 160)); }
  if ('note' in b) { sets.push('note = ?'); vals.push(clean(b.note, 4000)); }
  if ('outdoor' in b) {
    if (typeof b.outdoor !== 'boolean') return c.json({ error: 'Dış çekim işareti geçersiz' }, 400);
    sets.push('outdoor = ?'); vals.push(b.outdoor ? 1 : 0);
  }
  if ('status' in b) {
    if (![0, 1, 2].includes(b.status as number)) return c.json({ error: 'Geçersiz durum' }, 400);
    sets.push('status = ?'); vals.push(b.status);
    sets.push(b.status === 1 ? "completed_at = COALESCE(completed_at, datetime('now'))" : 'completed_at = NULL');
  }
  let crew: string[] | null = null;
  if ('crew' in b) {
    const cr = await cleanCrew(c, b.crew);
    if (typeof cr === 'string') return c.json({ error: cr }, 400);
    crew = cr; sets.push('crew = ?'); vals.push(JSON.stringify(cr));
  }
  if ('checks' in b) {
    const ck = cleanChecks(b.checks);
    if (!ck) return c.json({ error: 'Hazırlık listesi geçersiz' }, 400);
    sets.push('checks = ?'); vals.push(JSON.stringify(ck));
  }
  if (!sets.length) return c.json({ error: 'Değişiklik yok' }, 400);
  await c.env.DB.prepare(`UPDATE shoots SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...vals, id).run();
  const s = view((await getRow(c, id))!);
  const added = crew ? crew.filter((x) => !before.crew.includes(x)) : [];
  if (s.status !== 2 && added.length) await notifyCrew(c, s, added, 'Çekim ekibine eklendin');
  const moved = s.date !== before.date || s.time !== before.time || s.location !== before.location;
  if (moved && s.status === 0) await notifyCrew(c, s, s.crew.filter((x) => !added.includes(x)), 'Çekim güncellendi');
  live(c, id);
  return c.json(s);
});

// ---------- hazırlık maddeleri (tek tek; aynı anda düzenleyenler birbirini ezmesin) ----------
async function editChecks(c: C, fn: (list: Check[]) => Check[] | string) {
  const id = c.req.param('id') as string;
  const row = await getRow(c, id);
  if (!row) return c.json({ error: 'Çekim bulunamadı' }, 404);
  const next = fn(parseArr<Check>(row.checks));
  if (typeof next === 'string') return c.json({ error: next }, 400);
  await c.env.DB.prepare("UPDATE shoots SET checks = ?, updated_at = datetime('now') WHERE id = ?").bind(JSON.stringify(next), id).run();
  live(c, id);
  return c.json(view((await getRow(c, id))!));
}
const idx = (c: C, list: Check[]) => { const i = Number(c.req.param('i')); return Number.isInteger(i) && i >= 0 && i < list.length ? i : -1; };

r.post('/:id/checks', async (c) => {
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const text = clean(b.text, 200);
  return editChecks(c, (list) => {
    if (!text) return 'Madde boş olamaz';
    if (list.length >= MAX_CHECKS) return 'Hazırlık listesi en fazla ' + MAX_CHECKS + ' madde olabilir';
    return [...list, { text, done: false }];
  });
});
r.patch('/:id/checks/:i', async (c) => {
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  return editChecks(c, (list) => {
    const i = idx(c, list); if (i < 0) return 'Madde bulunamadı';
    const t = 'text' in b ? clean(b.text, 200) : list[i].text;
    if (!t) return 'Madde boş olamaz';
    return list.map((x, j) => (j === i ? { text: t, done: 'done' in b ? !!b.done : x.done } : x));
  });
});
r.delete('/:id/checks/:i', (c) => editChecks(c, (list) => {
  const i = idx(c, list); if (i < 0) return 'Madde bulunamadı';
  return list.filter((_, j) => j !== i);
}));

// ---------- sil ----------
r.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM shoots WHERE id = ?').bind(id).run();
  if (!res.meta.changes) return c.json({ error: 'Çekim bulunamadı' }, 404);
  live(c, id);
  return c.json({ ok: true });
});

/** İstanbul saatine göre (UTC+3) yarının tarihi. */
export function istanbulTomorrow(now = new Date()): string {
  return new Date(now.getTime() + 3 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
}

/** Her gün 16:30 (İstanbul): yarın çekimi olan ekibe ve #çekim-planı kanalına hatırlatma. */
export async function cekimHatirlatma(env: Env): Promise<void> {
  const date = istanbulTomorrow();
  const { results } = await env.DB.prepare(
    'SELECT * FROM shoots WHERE date = ? AND status = 0 AND (reminded_for IS NULL OR reminded_for != ?)',
  ).bind(date, date).all<ShootRow>();
  if (!results.length) return;
  const list = results.map(view).sort(sortShoots);
  // önce işaretle: aynı çekim için iki kez gönderilmesin
  await env.DB.batch(list.map((s) => env.DB.prepare('UPDATE shoots SET reminded_for = ? WHERE id = ?').bind(date, s.id)));

  const { results: users } = await env.DB.prepare("SELECT id, first_name FROM users WHERE status != 'removed'").all<{ id: string; first_name: string }>();
  const nameOf = new Map(users.map((u) => [u.id, u.first_name]));
  for (const s of list) {
    for (const uid of s.crew) {
      if (!nameOf.has(uid)) continue;
      try {
        await notify(env, { userId: uid, kind: 'shoot', title: 'Yarın çekim var', body: bodyLine(s), link: '/cekim?id=' + s.id, meta: metaLine(s) });
      } catch (e) { console.error('çekim hatırlatma bildirimi', e); }
    }
  }

  const lines = ['Yarınki çekimler – ' + longDate(date)];
  for (const s of list) {
    lines.push('• ' + [s.time, [s.client, s.title].filter(Boolean).join(': ')].filter(Boolean).join(' – '));
    if (s.location) lines.push('Konum: ' + s.location);
    const crew = s.crew.map((x) => nameOf.get(x)).filter(Boolean);
    if (crew.length) lines.push('Ekip: ' + crew.join(', '));
    const open = s.checks.filter((x) => !x.done).map((x) => x.text);
    if (s.checks.length) lines.push('Hazırlık: ' + (open.length ? open.join(', ') : 'hepsi hazır ✓') + ' (' + (s.checks.length - open.length) + '/' + s.checks.length + ')');
    if (s.note) lines.push('Not: ' + s.note.slice(0, 300));
  }
  let author = list.map((s) => s.createdBy).find((x) => x && nameOf.has(x)) || null;
  if (!author) author = (await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").first<{ id: string }>())?.id || null;
  if (!author) return;
  await env.DB.prepare("INSERT INTO messages (id, channel_id, user_id, text) VALUES (?, 'ch_cekim', ?, ?)")
    .bind(newId('m'), author, lines.join('\n').slice(0, 4000)).run();
  await broadcast(env, { type: 'chat', channelId: 'ch_cekim' });
  await broadcast(env, { type: 'shoots' });
}
