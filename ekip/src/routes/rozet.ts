// Haftanın yıldızı ve rozetler (Paket D) — /api/rozetler
import { Hono } from 'hono';
import type { Env, Vars } from '../types';
import { haftaOf, haftalikOlculer, sqlTime, ROZETLER, ROZET_SIRA, type RozetKey } from '../rozet';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();

const BADGES = ROZET_SIRA.map((k) => ({ key: k, ...ROZETLER[k] }));

// Bu haftanın canlı durumu (ilk 3 + kendi sıram) ve son verilen haftanın kazananları
r.get('/', async (c) => {
  const me = c.get('user');
  const now = new Date();
  const h = haftaOf(now);
  const m = await haftalikOlculer(c.env, h, sqlTime(now.getTime()));
  const ranked = Object.entries(m)
    .filter(([, o]) => o.done > 0)
    .map(([userId, o]) => ({ userId, done: o.done, onTime: o.onTime, shoots: o.shoots, approved: o.approved, days: o.days }))
    .sort((a, b) => b.done - a.done || b.onTime - a.onTime || a.userId.localeCompare(b.userId));
  // sıra: beraberlikte aynı sıra (1, 1, 3 …)
  const withRank = ranked.map((x) => ({ ...x, rank: 1 + ranked.filter((y) => y.done > x.done).length }));
  const mine = withRank.find((x) => x.userId === me.id) || null;
  const meStats = m[me.id];

  const lastRow = await c.env.DB.prepare('SELECT week FROM badges WHERE week <= ? ORDER BY week DESC LIMIT 1').bind(h.week).first<{ week: string }>();
  let last: null | { week: string; end: string; current: boolean; winners: { userId: string; badge: RozetKey; value: number }[] } = null;
  if (lastRow) {
    const { results } = await c.env.DB.prepare(
      "SELECT b.user_id AS userId, b.badge, b.value FROM badges b JOIN users u ON u.id = b.user_id WHERE b.week = ? AND u.status != 'removed'",
    ).bind(lastRow.week).all<{ userId: string; badge: RozetKey; value: number }>();
    const end = new Date(Date.parse(lastRow.week + 'T00:00:00Z') + 6 * 86_400_000).toISOString().slice(0, 10);
    results.sort((a, b) => ROZET_SIRA.indexOf(a.badge) - ROZET_SIRA.indexOf(b.badge) || b.value - a.value);
    last = { week: lastRow.week, end, current: lastRow.week === h.week, winners: results };
  }
  const awarded = !!(await c.env.DB.prepare('SELECT 1 AS x FROM badge_weeks WHERE week = ?').bind(h.week).first());
  return c.json({
    week: { start: h.week, end: h.end }, awarded,
    top: withRank.slice(0, 3),
    me: mine ? { ...mine, of: ranked.length } : { rank: null, of: ranked.length, done: meStats?.done || 0, onTime: meStats?.onTime || 0, shoots: meStats?.shoots || 0, approved: meStats?.approved || 0, days: meStats?.days || 0 },
    last, badges: BADGES,
  });
});

// Bir kişinin rozet geçmişi (sayılarıyla). id = 'ben' → kendisi
r.get('/kisi/:id', async (c) => {
  const id = c.req.param('id') === 'ben' ? c.get('user').id : c.req.param('id');
  if (!/^[\w-]{1,60}$/.test(id)) return c.json({ error: 'Geçersiz kişi' }, 400);
  const u = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status != 'removed'").bind(id).first();
  if (!u) return c.json({ error: 'Kişi bulunamadı' }, 404);
  const [counts, recent] = await Promise.all([
    c.env.DB.prepare('SELECT badge, COUNT(*) AS n, MAX(week) AS last FROM badges WHERE user_id = ? GROUP BY badge').bind(id).all<{ badge: RozetKey; n: number; last: string }>(),
    c.env.DB.prepare('SELECT week, badge, value FROM badges WHERE user_id = ? ORDER BY week DESC, created_at DESC LIMIT 8').bind(id).all<{ week: string; badge: RozetKey; value: number }>(),
  ]);
  const map = new Map(counts.results.map((x) => [x.badge, x]));
  const list = ROZET_SIRA.filter((k) => map.has(k)).map((k) => ({ badge: k, count: Number(map.get(k)!.n), last: map.get(k)!.last }));
  return c.json({
    userId: id, total: list.reduce((s, x) => s + x.count, 0),
    counts: list, recent: recent.results.filter((x) => x.badge in ROZETLER), badges: BADGES,
  });
});
