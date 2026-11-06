// Giriş, oturum ve davet. Kural: bir kere giriş yapılır, oturum cihazda açık kalır.
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import type { Env, SessionUser, UserRow, Vars } from './types';
import { DAY, clean, hashPassword, isEmail, randomToken, sha256, sqlNow, timingSafeEqual } from './util';

export const COOKIE = 'maya_s';
const REMEMBER_MS = 365 * DAY;
const SHORT_MS = DAY;
export const INVITE_MS = 14 * DAY;
const MAX_FAILS = 8;          // 15 dakikada en fazla hatalı deneme
const MIN_PASSWORD = 8;

export function toSessionUser(u: UserRow, sessionId: string): SessionUser {
  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(u.settings || '{}'); } catch { /* boş */ }
  return {
    id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, photo: u.photo, color: u.color,
    role: u.role, canEditClients: u.role === 'admin' || !!u.can_edit_clients, settings, sessionId,
  };
}

function deviceName(ua: string): string {
  if (/Tauri|MayaAjans/i.test(ua)) return 'Mac uygulaması';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Macintosh/i.test(ua)) return 'Mac · tarayıcı';
  if (/Windows/i.test(ua)) return 'Windows · tarayıcı';
  if (/Android/i.test(ua)) return 'Android';
  return 'Tarayıcı';
}

export async function createSession(c: any, userId: string, remember: boolean) {
  const token = randomToken(32);
  const id = await sha256(token);
  const ttl = remember ? REMEMBER_MS : SHORT_MS;
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, device, expires_at) VALUES (?, ?, ?, ?)')
    .bind(id, userId, deviceName(c.req.header('User-Agent') || ''), sqlNow(ttl)).run();
  setCookie(c, COOKIE, token, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/',
    ...(remember ? { maxAge: Math.floor(REMEMBER_MS / 1000) } : {}),
  });
}

// Oturum doğrulama: çerezdeki token → sessions tablosu → aktif kullanıcı
export const requireUser: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: 'Giriş gerekli' }, 401);
  const sid = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT u.*, s.id AS sid, s.last_seen_at, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > datetime('now') AND u.status = 'active'`,
  ).bind(sid).first<UserRow & { sid: string; last_seen_at: string; expires_at: string }>();
  if (!row) { deleteCookie(c, COOKIE, { path: '/' }); return c.json({ error: 'Oturum sona erdi' }, 401); }
  // Kayan süre: saatte bir son görülme güncellenir, "beni hatırla" oturumları uzatılır
  if (Date.parse(row.last_seen_at + 'Z') < Date.now() - 3600_000) {
    const long = Date.parse(row.expires_at + 'Z') - Date.now() > 2 * DAY;
    c.executionCtx.waitUntil(
      c.env.DB.prepare('UPDATE sessions SET last_seen_at = datetime(\'now\'), expires_at = ? WHERE id = ?')
        .bind(long ? sqlNow(REMEMBER_MS) : row.expires_at, sid).run(),
    );
  }
  c.set('user', toSessionUser(row, sid));
  await next();
};

export const requireAdmin: MiddlewareHandler<{ Bindings: Env; Variables: Vars }> = async (c, next) => {
  if (c.get('user').role !== 'admin') return c.json({ error: 'Bu işlem sadece yöneticiye açık' }, 403);
  await next();
};

// Değiştiren istekler başka siteden gelemez
export const sameOrigin: MiddlewareHandler = async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const origin = c.req.header('Origin');
    const host = new URL(c.req.url).host;
    if (origin && new URL(origin).host !== host) return c.json({ error: 'Geçersiz istek kaynağı' }, 403);
  }
  await next();
};

export const authRoutes = new Hono<{ Bindings: Env; Variables: Vars }>();

authRoutes.post('/login', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const email = clean(b.email, 200).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  const remember = b.remember !== false;
  if (!isEmail(email) || !password) return c.json({ error: 'E-posta ve şifre gerekli' }, 400);

  const fails = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND at > datetime('now', '-15 minutes')")
    .bind(email).first<{ n: number }>();
  if ((fails?.n ?? 0) >= MAX_FAILS) return c.json({ error: 'Çok fazla hatalı deneme. 15 dakika sonra tekrar dene.' }, 429);

  const u = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  let ok = false;
  if (u && u.status === 'active' && u.password_hash && u.password_salt) {
    const { hash } = await hashPassword(password, u.password_salt);
    ok = timingSafeEqual(hash, u.password_hash);
  } else {
    await hashPassword(password); // zamanlama farkıyla hesap varlığı anlaşılmasın
  }
  if (!ok || !u) {
    await c.env.DB.prepare('INSERT INTO login_attempts (email) VALUES (?)').bind(email).run();
    return c.json({ error: 'E-posta ya da şifre hatalı' }, 401);
  }
  await c.env.DB.prepare('DELETE FROM login_attempts WHERE email = ?').bind(email).run();
  await createSession(c, u.id, remember);
  return c.json({ ok: true });
});

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

// Davet / şifre belirleme bağlantısı bilgisi
authRoutes.get('/invite/:token', async (c) => {
  const id = await sha256(c.req.param('token'));
  const row = await c.env.DB.prepare(
    `SELECT i.kind, u.email, u.first_name, u.last_name FROM invites i JOIN users u ON u.id = i.user_id
     WHERE i.id = ? AND i.used_at IS NULL AND i.expires_at > datetime('now') AND u.status != 'removed'`,
  ).bind(id).first<{ kind: string; email: string; first_name: string; last_name: string }>();
  if (!row) return c.json({ error: 'Bu bağlantı geçersiz ya da süresi dolmuş. Yöneticiden yeni bağlantı iste.' }, 404);
  return c.json({ kind: row.kind, email: row.email, firstName: row.first_name, lastName: row.last_name });
});

// Daveti kabul et / şifre belirle → hesap aktif olur ve giriş yapılır
authRoutes.post('/accept', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const token = clean(b.token, 200);
  const password = typeof b.password === 'string' ? b.password : '';
  const firstName = clean(b.firstName, 40);
  const lastName = clean(b.lastName, 40);
  if (password.length < MIN_PASSWORD) return c.json({ error: `Şifre en az ${MIN_PASSWORD} karakter olmalı` }, 400);
  if (!firstName) return c.json({ error: 'Adını yaz' }, 400);
  const id = await sha256(token);
  const inv = await c.env.DB.prepare(
    "SELECT * FROM invites WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')",
  ).bind(id).first<{ user_id: string }>();
  if (!inv) return c.json({ error: 'Bu bağlantı geçersiz ya da süresi dolmuş' }, 404);
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(inv.user_id).first<UserRow>();
  if (!u || u.status === 'removed') return c.json({ error: 'Bu hesap kullanılamıyor' }, 403);
  const { hash, salt } = await hashPassword(password);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, first_name = ?, last_name = ?, status = 'active', updated_at = datetime('now') WHERE id = ?")
      .bind(hash, salt, firstName, lastName, u.id),
    c.env.DB.prepare("UPDATE invites SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").bind(u.id),
    // şifre değişince eski oturumlar kapanır
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id),
  ]);
  await createSession(c, u.id, true);
  return c.json({ ok: true });
});

export async function createInviteLink(env: Env, origin: string, userId: string, kind: 'invite' | 'reset'): Promise<string> {
  const token = randomToken(24);
  await env.DB.batch([
    env.DB.prepare("UPDATE invites SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").bind(userId),
    env.DB.prepare('INSERT INTO invites (id, user_id, kind, expires_at) VALUES (?, ?, ?, ?)').bind(await sha256(token), userId, kind, sqlNow(INVITE_MS)),
  ]);
  return `${origin}/davet/${token}`;
}
