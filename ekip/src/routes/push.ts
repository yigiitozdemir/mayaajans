// iPhone / tarayıcı bildirimleri (Web Push): abone ol / çık / deneme
import { Hono } from 'hono';
import type { Env, Vars } from '../types';
import { clean, newId } from '../util';
import { b64uDecode, endpointAllowed, pushToUser, vapidReady } from '../push';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();

const MAX_DEVICES = 10;

function keyOk(s: unknown, len: number): s is string {
  if (typeof s !== 'string' || s.length > 200 || !/^[A-Za-z0-9_-]+=*$/.test(s)) return false;
  try { const b = b64uDecode(s.replace(/=+$/, '')); return b.length === len && (len !== 65 || b[0] === 4); } catch { return false; }
}

// açık anahtar + bu hesabın kayıtlı cihazları
r.get('/key', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, device, created_at, last_ok_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at')
    .bind(c.get('user').id).all<{ id: string; device: string; created_at: string; last_ok_at: string | null }>();
  return c.json({
    key: c.env.VAPID_PUBLIC || '',
    ready: vapidReady(c.env),
    devices: results.map((d) => ({ id: d.id, device: d.device, createdAt: d.created_at, lastOkAt: d.last_ok_at })),
  });
});

r.post('/subscribe', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const s = b?.subscription;
  const endpoint = s?.endpoint;
  if (typeof endpoint !== 'string' || !endpointAllowed(c.env, endpoint)) return c.json({ error: 'Geçersiz bildirim aboneliği' }, 400);
  const p256dh = s?.keys?.p256dh, auth = s?.keys?.auth;
  if (!keyOk(p256dh, 65) || !keyOk(auth, 16)) return c.json({ error: 'Bildirim anahtarları geçersiz' }, 400);
  const device = clean(b.device, 60);
  // aynı tarayıcıda başka biri oturum açtıysa abonelik yeni kişiye geçer
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, device) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
       device = excluded.device, fail_count = 0`,
  ).bind(newId('ps'), u.id, endpoint, p256dh.replace(/=+$/, ''), auth.replace(/=+$/, ''), device).run();
  // kişi başına en fazla 10 cihaz: en eskiler bırakılır
  await c.env.DB.prepare(
    `DELETE FROM push_subscriptions WHERE user_id = ? AND id NOT IN
       (SELECT id FROM push_subscriptions WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ${MAX_DEVICES})`,
  ).bind(u.id, u.id).run();
  return c.json({ ok: true, ready: vapidReady(c.env) });
});

r.post('/unsubscribe', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const endpoint = b?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint || endpoint.length > 1000) return c.json({ error: 'Geçersiz istek' }, 400);
  await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').bind(endpoint, c.get('user').id).run();
  return c.json({ ok: true });
});

// kendine deneme bildirimi
r.post('/test', async (c) => {
  const u = c.get('user');
  if (!vapidReady(c.env)) return c.json({ error: 'Sunucuda bildirim anahtarı ayarlanmamış' }, 503);
  const res = await pushToUser(c.env, u.id, {
    title: 'Deneme bildirimi',
    body: `Merhaba ${u.firstName || ''}, bu cihaza bildirimler gelecek.`.replace(/\s+,/, ','),
    link: '/', tag: 'test',
  });
  if (!res.devices) return c.json({ error: 'Bu hesapta bildirim açık bir cihaz yok' }, 404);
  if (!res.delivered) return c.json({ error: 'Bildirim gönderilemedi, birazdan yeniden dene', ...res }, 502);
  return c.json({ ok: true, ...res });
});
