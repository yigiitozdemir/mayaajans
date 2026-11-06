// Müşteri portalı — ilk müşteri: Vatan Hastanesi (içerik onayı + talepler).
// Ekipte yalnızca portal üyeleri (portal_members) ve yönetici görür/düzenler.
// Misafirler (guests) ekip üyesi değildir: ayrı oturum çerezi (maya_g), yalnızca kendi müşterisinin
// portal kayıtlarını görür; ekip verisine hiçbir erişimi yoktur.
import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Env, Vars } from './types';
import { broadcast } from './hub';
import { driveOnizleme } from './drive';
import { notify } from './notify';
import { DAY, clean, hashPassword, isDate, isEmail, newId, randomToken, sha256, sqlNow } from './util';

export const PORTALS: Record<string, { name: string; short: string }> = {
  vatan: { name: 'Vatan Hastanesi', short: 'Vatan' },
};
export const CONTENT_STATUS = ['hazirlaniyor', 'onay_bekliyor', 'revize', 'onaylandi', 'paylasildi'] as const;
export const REQUEST_STATUS = ['bekliyor', 'devam', 'tamam'] as const;
const STATUS_LABEL: Record<string, string> = {
  hazirlaniyor: 'Hazırlanıyor', onay_bekliyor: 'Onay bekleniyor', revize: 'Revize istendi', onaylandi: 'Onaylandı', paylasildi: 'Paylaşıldı',
  bekliyor: 'Beklemede', devam: 'Devam ediyor', tamam: 'Tamamlandı',
};

export const GUEST_COOKIE = 'maya_g';
const GUEST_REMEMBER_MS = 180 * DAY;
const INVITE_MS = 14 * DAY;
export const MIN_PASSWORD = 8;

type ItemRow = {
  id: string; client: string; kind: 'content' | 'request'; no: number; title: string; link: string;
  plan_date: string | null; given_date: string | null; due_date: string | null; date_text: string;
  description: string; status: string; created_by_kind: string; created_by: string | null; created_at: string; updated_at: string;
};
type NoteRow = { id: string; item_id: string; author_kind: string; author_id: string | null; author_name: string; action: string; body: string; created_at: string };
export type GuestRow = {
  id: string; email: string; first_name: string; last_name: string; client: string; status: string;
  password_hash: string | null; password_salt: string | null; last_login_at: string | null; created_at: string;
};
type GuestVars = { guest: GuestRow & { sid: string } };

const itemView = (r: ItemRow) => ({
  id: r.id, kind: r.kind, no: r.no, title: r.title, link: r.link, planDate: r.plan_date, givenDate: r.given_date, dueDate: r.due_date,
  dateText: r.date_text, description: r.description, status: r.status, createdByKind: r.created_by_kind, createdAt: r.created_at, updatedAt: r.updated_at,
});
const noteView = (n: NoteRow) => ({ id: n.id, itemId: n.item_id, authorKind: n.author_kind, authorName: n.author_name, action: n.action, body: n.body, createdAt: n.created_at });
const guestView = (g: GuestRow) => ({ id: g.id, email: g.email, firstName: g.first_name, lastName: g.last_name, status: g.status, lastLoginAt: g.last_login_at, createdAt: g.created_at });

/** Yalnızca http(s) bağlantıları kabul et (javascript: vb. engellenir). */
function cleanLink(v: unknown): string {
  const s = clean(v, 1000);
  if (!s) return '';
  try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : ''; } catch { return ''; }
}
const optDate = (v: unknown) => (v === null || v === '' ? null : isDate(v) ? v : undefined);

async function listFor(env: Env, client: string) {
  const [items, notes] = await Promise.all([
    env.DB.prepare('SELECT * FROM portal_items WHERE client = ? AND deleted_at IS NULL ORDER BY kind, no DESC').bind(client).all<ItemRow>(),
    env.DB.prepare(`SELECT n.* FROM portal_notes n JOIN portal_items i ON i.id = n.item_id
      WHERE i.client = ? AND i.deleted_at IS NULL ORDER BY n.created_at`).bind(client).all<NoteRow>(),
  ]);
  return { items: items.results.map(itemView), notes: notes.results.map(noteView) };
}

async function nextNo(env: Env, client: string, kind: string) {
  const r = await env.DB.prepare('SELECT COALESCE(MAX(no), 0) + 1 AS n FROM portal_items WHERE client = ? AND kind = ?').bind(client, kind).first<{ n: number }>();
  return r?.n ?? 1;
}

/** Portal üyeleri + yöneticiler (bildirim alacak ekip) */
async function teamWatchers(env: Env, client: string): Promise<string[]> {
  const { results } = await env.DB.prepare(`SELECT id FROM users WHERE status = 'active' AND (role = 'admin' OR id IN (SELECT user_id FROM portal_members WHERE client = ?))`)
    .bind(client).all<{ id: string }>();
  return results.map((r) => r.id);
}

const changed = (c: Context, client: string) => c.executionCtx.waitUntil(broadcast(c.env, { type: 'portal', client }));

// ============================ EKİP TARAFI (/api/portal) ============================
export async function portalsOf(env: Env, user: { id: string; role: string }): Promise<string[]> {
  if (user.role === 'admin') return Object.keys(PORTALS);
  const { results } = await env.DB.prepare('SELECT client FROM portal_members WHERE user_id = ?').bind(user.id).all<{ client: string }>();
  return results.map((r) => r.client).filter((k) => k in PORTALS);
}

export const team = new Hono<{ Bindings: Env; Variables: Vars }>();

// her istek: müşteri tanımlı mı, kişi bu portalın üyesi mi
team.use('/:client/*', async (c, next) => {
  const client = c.req.param('client');
  if (!(client in PORTALS)) return c.json({ error: 'Bulunamadı' }, 404);
  const mine = await portalsOf(c.env, c.get('user'));
  if (!mine.includes(client)) return c.json({ error: 'Bu bölümü görme yetkin yok' }, 403);
  await next();
});

team.get('/:client/all', async (c) => {
  const client = c.req.param('client');
  const [data, guests] = await Promise.all([
    listFor(c.env, client),
    c.env.DB.prepare("SELECT * FROM guests WHERE client = ? AND status != 'removed' ORDER BY created_at").bind(client).all<GuestRow>(),
  ]);
  return c.json({ ...data, guests: guests.results.map(guestView), client: { id: client, ...PORTALS[client] } });
});

function readItemBody(b: any, kind: 'content' | 'request', partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || 'title' in b) { const t = clean(b.title, 300); if (!t) throw new Error('Başlık yaz'); out.title = t; }
  if ('link' in b) out.link = cleanLink(b.link);
  if ('description' in b) out.description = clean(b.description, 4000);
  if ('dateText' in b) out.date_text = clean(b.dateText, 60);
  for (const [k, col] of [['planDate', 'plan_date'], ['givenDate', 'given_date'], ['dueDate', 'due_date']] as const) {
    if (k in b) { const d = optDate(b[k]); if (d === undefined) throw new Error('Tarih geçersiz'); out[col] = d; }
  }
  if ('status' in b) {
    const ok = (kind === 'content' ? CONTENT_STATUS : REQUEST_STATUS) as readonly string[];
    if (!ok.includes(b.status)) throw new Error('Durum geçersiz');
    out.status = b.status;
  }
  return out;
}

team.post('/:client/items', async (c) => {
  const client = c.req.param('client'); const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const kind = b.kind === 'request' ? 'request' : 'content';
  let f: Record<string, unknown>;
  try { f = readItemBody(b, kind, false); } catch (e: any) { return c.json({ error: e.message }, 400); }
  const id = newId('pi');
  const no = await nextNo(c.env, client, kind);
  await c.env.DB.prepare(`INSERT INTO portal_items (id, client, kind, no, title, link, plan_date, given_date, due_date, date_text, description, status, created_by_kind, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'team', ?)`)
    .bind(id, client, kind, no, f.title, f.link ?? '', f.plan_date ?? null, f.given_date ?? null, f.due_date ?? null, f.date_text ?? '', f.description ?? '',
      f.status ?? (kind === 'content' ? 'onay_bekliyor' : 'bekliyor'), u.id).run();
  changed(c, client);
  return c.json({ ok: true, id });
});

async function ownItem(c: Context, client: string, id: string) {
  return c.env.DB.prepare('SELECT * FROM portal_items WHERE id = ? AND client = ? AND deleted_at IS NULL').bind(id, client).first() as Promise<ItemRow | null>;
}

team.patch('/:client/items/:id', async (c) => {
  const client = c.req.param('client'); const u = c.get('user');
  const it = await ownItem(c, client, c.req.param('id'));
  if (!it) return c.json({ error: 'Kayıt bulunamadı' }, 404);
  const b = await c.req.json().catch(() => ({}));
  let f: Record<string, unknown>;
  try { f = readItemBody(b, it.kind, true); } catch (e: any) { return c.json({ error: e.message }, 400); }
  const cols = Object.keys(f);
  if (!cols.length) return c.json({ ok: true });
  const stmts = [c.env.DB.prepare(`UPDATE portal_items SET ${cols.map((k) => k + ' = ?').join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...cols.map((k) => f[k]), it.id)];
  if (f.status && f.status !== it.status) {
    stmts.push(c.env.DB.prepare("INSERT INTO portal_notes (id, item_id, author_kind, author_id, author_name, action, body) VALUES (?, ?, 'team', ?, ?, 'status', ?)")
      .bind(newId('pn'), it.id, u.id, (u.firstName + ' ' + u.lastName).trim() + ' · Maya Ajans', STATUS_LABEL[f.status as string] || String(f.status)));
  }
  await c.env.DB.batch(stmts);
  changed(c, client);
  return c.json({ ok: true });
});

team.delete('/:client/items/:id', async (c) => {
  const client = c.req.param('client');
  const it = await ownItem(c, client, c.req.param('id'));
  if (!it) return c.json({ error: 'Kayıt bulunamadı' }, 404);
  await c.env.DB.prepare("UPDATE portal_items SET deleted_at = datetime('now') WHERE id = ?").bind(it.id).run();
  changed(c, client);
  return c.json({ ok: true });
});

team.post('/:client/items/:id/notes', async (c) => {
  const client = c.req.param('client'); const u = c.get('user');
  const it = await ownItem(c, client, c.req.param('id'));
  if (!it) return c.json({ error: 'Kayıt bulunamadı' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const body = clean(b.body, 4000);
  if (!body) return c.json({ error: 'Not boş olamaz' }, 400);
  await c.env.DB.prepare("INSERT INTO portal_notes (id, item_id, author_kind, author_id, author_name, action, body) VALUES (?, ?, 'team', ?, ?, 'note', ?)")
    .bind(newId('pn'), it.id, u.id, (u.firstName + ' ' + u.lastName).trim() + ' · Maya Ajans', body).run();
  changed(c, client);
  return c.json({ ok: true });
});

// ---- misafir hesapları ----
async function guestLink(env: Env, origin: string, guestId: string) {
  const token = randomToken(24);
  await env.DB.batch([
    env.DB.prepare("UPDATE guest_invites SET used_at = datetime('now') WHERE guest_id = ? AND used_at IS NULL").bind(guestId),
    env.DB.prepare('INSERT INTO guest_invites (id, guest_id, expires_at) VALUES (?, ?, ?)').bind(await sha256(token), guestId, sqlNow(INVITE_MS)),
  ]);
  return `${origin}/davet/${token}`;
}
function originOf(c: Context) {
  const o = c.req.header('Origin');
  if (o) { try { return new URL(o).origin; } catch { /* */ } }
  const host = c.req.header('Host') || new URL(c.req.url).host;
  return (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http://' : 'https://') + host;
}

team.post('/:client/guests', async (c) => {
  const client = c.req.param('client'); const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const email = clean(b.email, 200).toLowerCase();
  const firstName = clean(b.firstName, 40); const lastName = clean(b.lastName, 40);
  if (!isEmail(email)) return c.json({ error: 'Geçerli bir e-posta yaz' }, 400);
  if (!firstName) return c.json({ error: 'Adını yaz' }, 400);
  const teamUser = await c.env.DB.prepare("SELECT 1 FROM users WHERE email = ? AND status != 'removed'").bind(email).first();
  if (teamUser) return c.json({ error: 'Bu e-posta bir ekip üyesine ait' }, 400);
  const ex = await c.env.DB.prepare('SELECT * FROM guests WHERE email = ?').bind(email).first<GuestRow>();
  let id: string;
  if (ex && ex.status !== 'removed') {
    if (ex.client !== client) return c.json({ error: 'Bu e-posta başka bir müşteri portalında kayıtlı' }, 400);
    return c.json({ error: 'Bu kişi zaten ekli. Listeden yeni bağlantı oluşturabilirsin.' }, 400);
  } else if (ex) {
    id = ex.id;
    await c.env.DB.prepare("UPDATE guests SET status = 'pending', client = ?, first_name = ?, last_name = ?, password_hash = NULL, password_salt = NULL WHERE id = ?")
      .bind(client, firstName, lastName, id).run();
  } else {
    id = newId('g');
    await c.env.DB.prepare('INSERT INTO guests (id, email, first_name, last_name, client, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, email, firstName, lastName, client, u.id).run();
  }
  const link = await guestLink(c.env, originOf(c), id);
  changed(c, client);
  return c.json({ ok: true, id, link, email, firstName });
});

team.post('/:client/guests/:id/link', async (c) => {
  const client = c.req.param('client');
  const g = await c.env.DB.prepare("SELECT * FROM guests WHERE id = ? AND client = ? AND status != 'removed'").bind(c.req.param('id'), client).first<GuestRow>();
  if (!g) return c.json({ error: 'Misafir bulunamadı' }, 404);
  const link = await guestLink(c.env, originOf(c), g.id);
  return c.json({ ok: true, link, email: g.email, firstName: g.first_name, reset: g.status === 'active' });
});

team.delete('/:client/guests/:id', async (c) => {
  const client = c.req.param('client');
  const g = await c.env.DB.prepare("SELECT * FROM guests WHERE id = ? AND client = ?").bind(c.req.param('id'), client).first<GuestRow>();
  if (!g) return c.json({ error: 'Misafir bulunamadı' }, 404);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE guests SET status = 'removed', password_hash = NULL, password_salt = NULL WHERE id = ?").bind(g.id),
    c.env.DB.prepare('DELETE FROM guest_sessions WHERE guest_id = ?').bind(g.id),
    c.env.DB.prepare("UPDATE guest_invites SET used_at = datetime('now') WHERE guest_id = ? AND used_at IS NULL").bind(g.id),
  ]);
  changed(c, client);
  return c.json({ ok: true });
});

// ============================ MİSAFİR TARAFI (/api/misafir) ============================
function deviceName(ua: string): string {
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android/i.test(ua)) return 'Android';
  if (/Macintosh/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows';
  return 'Tarayıcı';
}

export async function createGuestSession(c: Context, guestId: string) {
  const token = randomToken(32);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO guest_sessions (id, guest_id, device, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), guestId, deviceName(c.req.header('User-Agent') || ''), sqlNow(GUEST_REMEMBER_MS)),
    c.env.DB.prepare("UPDATE guests SET last_login_at = datetime('now') WHERE id = ?").bind(guestId),
  ]);
  setCookie(c, GUEST_COOKIE, token, { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: Math.floor(GUEST_REMEMBER_MS / 1000) });
}

const requireGuest: MiddlewareHandler<{ Bindings: Env; Variables: GuestVars }> = async (c, next) => {
  const token = getCookie(c, GUEST_COOKIE);
  if (!token) return c.json({ error: 'Giriş gerekli' }, 401);
  const sid = await sha256(token);
  const row = await c.env.DB.prepare(`SELECT g.*, s.id AS sid, s.last_seen_at FROM guest_sessions s JOIN guests g ON g.id = s.guest_id
    WHERE s.id = ? AND s.expires_at > datetime('now') AND g.status = 'active'`).bind(sid).first<GuestRow & { sid: string; last_seen_at: string }>();
  if (!row || !(row.client in PORTALS)) { deleteCookie(c, GUEST_COOKIE, { path: '/' }); return c.json({ error: 'Oturum sona erdi' }, 401); }
  if (Date.parse(row.last_seen_at + 'Z') < Date.now() - 3600_000) {
    c.executionCtx.waitUntil(c.env.DB.prepare("UPDATE guest_sessions SET last_seen_at = datetime('now'), expires_at = ? WHERE id = ?").bind(sqlNow(GUEST_REMEMBER_MS), sid).run());
  }
  c.set('guest', row);
  await next();
};

export const guest = new Hono<{ Bindings: Env; Variables: GuestVars }>();

guest.post('/logout', async (c) => {
  const token = getCookie(c, GUEST_COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM guest_sessions WHERE id = ?').bind(await sha256(token)).run();
  deleteCookie(c, GUEST_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

guest.use('*', requireGuest);

guest.get('/me', (c) => {
  const g = c.get('guest');
  return c.json({ id: g.id, email: g.email, firstName: g.first_name, lastName: g.last_name, client: { id: g.client, ...PORTALS[g.client] } });
});

guest.get('/items', async (c) => c.json(await listFor(c.env, c.get('guest').client)));

// Drive önizlemesi: yalnızca kendi kurumunun içeriklerine eklenmiş bağlantılar için
guest.get('/drive', async (c) => {
  const g = c.get('guest'); const url = c.req.query('url') || '';
  const own = await c.env.DB.prepare('SELECT 1 FROM portal_items WHERE client = ? AND link = ? AND deleted_at IS NULL').bind(g.client, url).first();
  if (!own) return c.json({ aktif: false });
  return c.json(await driveOnizleme(c.env, url), 200, { 'Cache-Control': 'private, max-age=300' });
});

const guestName = (g: GuestRow) => (g.first_name + ' ' + g.last_name).trim() + ' · ' + (PORTALS[g.client]?.name || '');

async function tellTeam(c: Context, g: GuestRow, it: ItemRow, title: string, body: string) {
  const ids = await teamWatchers(c.env, g.client);
  for (const id of ids) {
    await notify(c.env, { userId: id, kind: 'portal', title, body, link: `/${g.client}?kayit=${it.id}` }, (p) => c.executionCtx.waitUntil(p));
  }
}

guest.post('/items/:id/:action', async (c) => {
  const g = c.get('guest');
  const action = c.req.param('action');
  if (!['approve', 'revise', 'note'].includes(action)) return c.json({ error: 'Geçersiz işlem' }, 400);
  const it = await c.env.DB.prepare('SELECT * FROM portal_items WHERE id = ? AND client = ? AND deleted_at IS NULL').bind(c.req.param('id'), g.client).first<ItemRow>();
  if (!it) return c.json({ error: 'Kayıt bulunamadı' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const body = clean(b.body, 4000);
  if ((action === 'revise' || action === 'note') && !body) return c.json({ error: action === 'revise' ? 'Revize notunu yaz' : 'Not boş olamaz' }, 400);
  if (action !== 'note' && it.kind !== 'content') return c.json({ error: 'Bu işlem yalnızca içeriklerde' }, 400);
  const stmts = [c.env.DB.prepare('INSERT INTO portal_notes (id, item_id, author_kind, author_id, author_name, action, body) VALUES (?, ?, \'guest\', ?, ?, ?, ?)')
    .bind(newId('pn'), it.id, g.id, guestName(g), action, body)];
  if (action === 'approve') stmts.push(c.env.DB.prepare("UPDATE portal_items SET status = 'onaylandi', updated_at = datetime('now') WHERE id = ?").bind(it.id));
  if (action === 'revise') stmts.push(c.env.DB.prepare("UPDATE portal_items SET status = 'revize', updated_at = datetime('now') WHERE id = ?").bind(it.id));
  await c.env.DB.batch(stmts);
  changed(c, g.client);
  const who = g.first_name || 'Misafir';
  const head = action === 'approve' ? `✅ ${who} onayladı` : action === 'revise' ? `🔄 ${who} revize istedi` : `💬 ${who} not yazdı`;
  await tellTeam(c, g, it, `${PORTALS[g.client].short} · ${head}`, it.title + (body ? ' — ' + body.slice(0, 140) : ''));
  return c.json({ ok: true });
});

guest.post('/requests', async (c) => {
  const g = c.get('guest');
  const b = await c.req.json().catch(() => ({}));
  const title = clean(b.title, 300);
  if (!title) return c.json({ error: 'Talebi kısaca yaz' }, 400);
  const due = optDate(b.dueDate);
  if (due === undefined) return c.json({ error: 'Tarih geçersiz' }, 400);
  const id = newId('pi');
  const no = await nextNo(c.env, g.client, 'request');
  await c.env.DB.prepare(`INSERT INTO portal_items (id, client, kind, no, title, link, given_date, due_date, description, status, created_by_kind, created_by)
    VALUES (?, ?, 'request', ?, ?, ?, date('now', '+3 hours'), ?, ?, 'bekliyor', 'guest', ?)`)
    .bind(id, g.client, no, title, cleanLink(b.link), due, clean(b.description, 4000), g.id).run();
  changed(c, g.client);
  const it = (await c.env.DB.prepare('SELECT * FROM portal_items WHERE id = ?').bind(id).first<ItemRow>())!;
  await tellTeam(c, g, it, `${PORTALS[g.client].short} · 📝 Yeni talep (${g.first_name})`, title);
  return c.json({ ok: true, id });
});

// ---- giriş / davet yardımcıları (auth.ts kullanır) ----
export async function guestLogin(env: Env, email: string, password: string): Promise<GuestRow | null> {
  const g = await env.DB.prepare("SELECT * FROM guests WHERE email = ? AND status = 'active'").bind(email).first<GuestRow>();
  if (!g || !g.password_hash || !g.password_salt) return null;
  const { hash } = await hashPassword(password, g.password_salt);
  const { timingSafeEqual } = await import('./util');
  return timingSafeEqual(hash, g.password_hash) ? g : null;
}

export async function guestInviteInfo(env: Env, token: string) {
  return env.DB.prepare(`SELECT g.* FROM guest_invites i JOIN guests g ON g.id = i.guest_id
    WHERE i.id = ? AND i.used_at IS NULL AND i.expires_at > datetime('now') AND g.status != 'removed'`).bind(await sha256(token)).first<GuestRow>();
}

export async function acceptGuestInvite(c: Context, token: string, password: string, firstName: string, lastName: string) {
  const g = await guestInviteInfo(c.env, token);
  if (!g) return false;
  const { hash, salt } = await hashPassword(password);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE guests SET password_hash = ?, password_salt = ?, first_name = ?, last_name = ?, status = 'active' WHERE id = ?").bind(hash, salt, firstName, lastName, g.id),
    c.env.DB.prepare("UPDATE guest_invites SET used_at = datetime('now') WHERE guest_id = ? AND used_at IS NULL").bind(g.id),
    c.env.DB.prepare('DELETE FROM guest_sessions WHERE guest_id = ?').bind(g.id),
  ]);
  await createGuestSession(c, g.id);
  c.executionCtx.waitUntil(broadcast(c.env, { type: 'portal', client: g.client }));
  return true;
}
