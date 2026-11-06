// Dürtme: ekipten birinin dikkatini çekmek (ses + ekran titremesi + Mac bildirimi, alıcı tarafta).
import { Hono } from 'hono';
import { activeMood } from '../util';
import type { Env, Vars } from '../types';
import { broadcast } from '../hub';
import { notify } from '../notify';
import { newId } from '../util';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();

export const NUDGE_COOLDOWN_S = 15;
export const NUDGE_MSG_MAX = 80;

interface NudgeRow { id: string; from_id: string; to_id: string; message: string; created_at: string }

// SQLite 'YYYY-MM-DD HH:MM:SS.SSS' (UTC) → ISO
const iso = (s: string) => s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z');
const view = (n: NudgeRow, me: string) => ({
  id: n.id, fromId: n.from_id, toId: n.to_id, message: n.message, at: iso(n.created_at),
  dir: n.from_id === me ? 'out' : 'in',
});

r.post('/', async (c) => {
  const me = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const to = typeof b.to === 'string' ? b.to : '';
  if (!to) return c.json({ error: 'Kimi dürteceğini seç' }, 400);
  if (to === me.id) return c.json({ error: 'Kendini dürtemezsin' }, 400);
  if (b.message !== undefined && b.message !== null && typeof b.message !== 'string') return c.json({ error: 'Mesaj geçersiz' }, 400);
  const message = typeof b.message === 'string' ? b.message.replace(/\s+/g, ' ').trim() : '';
  if (Array.from(message).length > NUDGE_MSG_MAX) return c.json({ error: `Mesaj en fazla ${NUDGE_MSG_MAX} karakter olabilir` }, 400);

  const target = await c.env.DB.prepare("SELECT id, settings FROM users WHERE id = ? AND status = 'active'")
    .bind(to).first<{ id: string; settings: string }>();
  if (!target) return c.json({ error: 'Bu kişi bulunamadı' }, 404);

  // aynı kişiye 15 saniyede bir
  const last = await c.env.DB.prepare(
    `SELECT (julianday('now') - julianday(created_at)) * 86400.0 AS ago FROM nudges
     WHERE from_id = ? AND to_id = ? ORDER BY created_at DESC LIMIT 1`,
  ).bind(me.id, to).first<{ ago: number }>();
  if (last && last.ago < NUDGE_COOLDOWN_S) {
    const wait = Math.max(1, Math.ceil(NUDGE_COOLDOWN_S - last.ago));
    c.header('Retry-After', String(wait));
    return c.json({ error: `Biraz bekle, ${wait} saniye sonra yeniden dürtebilirsin`, wait }, 429);
  }

  let settings: Record<string, unknown> = {};
  try { settings = JSON.parse(target.settings || '{}'); } catch { /* */ }
  const dnd = settings.dnd === true || !!activeMood(settings)?.focus; // "Odaklanıyorum" durumu da sessize alır

  const id = newId('nd');
  await c.env.DB.prepare('INSERT INTO nudges (id, from_id, to_id, message) VALUES (?, ?, ?, ?)').bind(id, me.id, to, message).run();
  const row = (await c.env.DB.prepare('SELECT * FROM nudges WHERE id = ?').bind(id).first<NudgeRow>())!;
  const at = iso(row.created_at);

  const waitUntil = c.executionCtx.waitUntil.bind(c.executionCtx);
  waitUntil(broadcast(c.env, { type: 'nudge', nudge: { id, fromId: me.id, message, at } }, { to }));
  const name = me.firstName.trim() || 'Ekipten biri';
  await notify(c.env, { userId: to, kind: 'nudge', title: `${name} seni dürttü`, body: message || '👋', link: '/durt', actorId: me.id }, waitUntil);

  return c.json({ ok: true, id, at, wait: NUDGE_COOLDOWN_S, ...(dnd ? { dnd: true } : {}) }, 201);
});

// Bana gelen + benim gönderdiğim son 30 dürtme
r.get('/log', async (c) => {
  const me = c.get('user').id;
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM nudges WHERE from_id = ? OR to_id = ? ORDER BY created_at DESC LIMIT 30',
  ).bind(me, me).all<NudgeRow>();
  return c.json(results.map((n) => view(n, me)));
});
