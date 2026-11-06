// Yönetici özeti (yalnızca yönetici): ekip iş yükü, gecikenler, haftalık tamamlanan, müşteri başı iş yükü, onay bekleyenler, yedek durumu
import { Hono } from 'hono';
import type { Env, Vars } from '../types';
import { requireAdmin } from '../auth';
import { haftalikYedek, yedekListesi, YEDEK_ONEK } from '../yedek';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
r.use('*', requireAdmin);

// ---------- tarih yardımcıları (İstanbul, UTC+3) ----------
const DAYMS = 86_400_000;
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const msOf = (iso: string) => Date.parse(iso + 'T00:00:00Z');
const addDays = (iso: string, n: number) => isoOf(msOf(iso) + n * DAYMS);
const istanbulIso = (d = new Date()) => isoOf(d.getTime() + 3 * 3600_000);
/** O tarihin haftasının pazartesisi */
const monday = (iso: string) => addDays(iso, -((new Date(msOf(iso)).getUTCDay() + 6) % 7));
const lastOfMonth = (iso: string) => { const d = new Date(msOf(iso)); return isoOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)); };

export const DONEMLER = { 'bu-hafta': 'Bu hafta', 'gecen-hafta': 'Geçen hafta', 'bu-ay': 'Bu ay', 'son-30': 'Son 30 gün' } as const;
type Donem = keyof typeof DONEMLER;
export function donemAraligi(key: Donem, today: string): { start: string; end: string } {
  if (key === 'bu-hafta') { const s = monday(today); return { start: s, end: addDays(s, 6) }; }
  if (key === 'gecen-hafta') { const s = addDays(monday(today), -7); return { start: s, end: addDays(s, 6) }; }
  if (key === 'bu-ay') return { start: today.slice(0, 8) + '01', end: lastOfMonth(today) };
  return { start: addDays(today, -29), end: today };
}

/** Onay bekleyen: tasks.approval = 'sent' (migration 0007: '' → sent → revision/approved → published). Sütun yoksa kutu gizlenir. */
async function hasApproval(env: Env) {
  const { results } = await env.DB.prepare('PRAGMA table_info(tasks)').all<{ name: string }>();
  return results.some((c) => c.name === 'approval');
}

// tamamlanma tarihi İstanbul gününe çevrilir (completed_at UTC 'YYYY-MM-DD HH:MM:SS')
const DONE_DAY = "date(t.completed_at, '+3 hours')";

r.get('/', async (c) => {
  const key = (c.req.query('donem') || 'bu-hafta') as Donem;
  if (!(key in DONEMLER)) return c.json({ error: 'Geçersiz dönem' }, 400);
  const today = istanbulIso();
  const { start, end } = donemAraligi(key, today);
  const wkStart = monday(today), wkEnd = addDays(wkStart, 6);
  const in7 = addDays(today, 7), late7 = addDays(today, -7);
  const trendStart = addDays(wkStart, -7 * 7);
  const db = c.env.DB;
  const approval = await hasApproval(c.env);

  const [totals, special, people, team, clients, trend, lateList, unassigned, staleShoots, approvalRow] = await db.batch<any>([
    db.prepare(`SELECT
        SUM(CASE WHEN status != 2 THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN status != 2 AND due_date IS NOT NULL AND due_date < ?1 THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN status = 2 AND ${DONE_DAY} BETWEEN ?2 AND ?3 THEN 1 ELSE 0 END) AS done,
        (SELECT COUNT(*) FROM shoots WHERE status = 1 AND date BETWEEN ?2 AND ?3) AS shoots
      FROM tasks t`).bind(today, start, end),
    db.prepare(`SELECT SUM(CASE WHEN r.status != 2 THEN 1 ELSE 0 END) AS pending, COUNT(*) AS total
      FROM special_day_rows r JOIN special_days d ON d.id = r.day_id WHERE d.date BETWEEN ? AND ?`).bind(wkStart, wkEnd),
    db.prepare(`SELECT t.assignee_id AS id,
        SUM(CASE WHEN t.status != 2 THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN t.status != 2 AND t.due_date IS NOT NULL AND t.due_date < ?1 THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN t.status = 1 THEN 1 ELSE 0 END) AS doing,
        SUM(CASE WHEN t.status = 2 AND ${DONE_DAY} BETWEEN ?2 AND ?3 THEN 1 ELSE 0 END) AS done,
        AVG(CASE WHEN t.status = 2 AND ${DONE_DAY} BETWEEN ?2 AND ?3 AND t.due_date IS NOT NULL
            THEN MAX(0, julianday(${DONE_DAY}) - julianday(t.due_date)) END) AS avgDelay,
        SUM(CASE WHEN t.status != 2 AND t.due_date BETWEEN ?1 AND ?4 THEN 1 ELSE 0 END) AS upcoming
      FROM tasks t GROUP BY t.assignee_id`).bind(today, start, end, in7),
    db.prepare("SELECT id, first_name, last_name, color, photo FROM users WHERE status != 'removed' ORDER BY role = 'admin' DESC, first_name"),
    db.prepare(`SELECT t.client AS name,
        SUM(CASE WHEN t.status != 2 THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN t.status != 2 AND t.due_date IS NOT NULL AND t.due_date < ?1 THEN 1 ELSE 0 END) AS late,
        SUM(CASE WHEN t.status = 2 AND ${DONE_DAY} BETWEEN ?2 AND ?3 THEN 1 ELSE 0 END) AS done,
        (SELECT MAX(s.date) FROM shoots s WHERE s.client = t.client AND s.status = 1) AS lastShoot
      FROM tasks t WHERE t.client != '' GROUP BY t.client HAVING open > 0
      ORDER BY open DESC, late DESC, t.client LIMIT 10`).bind(today, start, end),
    db.prepare(`SELECT ${DONE_DAY} AS day, COUNT(*) AS n FROM tasks t
      WHERE t.status = 2 AND ${DONE_DAY} BETWEEN ? AND ? GROUP BY day`).bind(trendStart, wkEnd),
    db.prepare(`SELECT id, title, client, assignee_id, due_date FROM tasks
      WHERE status != 2 AND due_date IS NOT NULL AND due_date < ? ORDER BY due_date, title LIMIT 50`).bind(late7),
    db.prepare(`SELECT id, title, client, due_date FROM tasks
      WHERE status != 2 AND (assignee_id IS NULL OR assignee_id NOT IN (SELECT id FROM users WHERE status != 'removed'))
      ORDER BY due_date IS NULL, due_date, title LIMIT 50`),
    db.prepare(`SELECT id, title, client, date, time FROM shoots WHERE status = 0 AND date < ? ORDER BY date, time LIMIT 50`).bind(today),
    approval
      ? db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE approval = 'sent'")
      : db.prepare('SELECT NULL AS n'),
  ]);

  const t0 = totals.results[0] || {};
  const byUser = new Map<string | null, any>(people.results.map((p: any) => [p.id, p]));
  const activeIds = new Set(team.results.map((u: any) => u.id));
  const zero = { open: 0, late: 0, doing: 0, done: 0, avgDelay: null, upcoming: 0 };
  const num = (p: any) => ({
    open: p.open || 0, late: p.late || 0, doing: p.doing || 0, done: p.done || 0, upcoming: p.upcoming || 0,
    avgDelay: p.avgDelay === null || p.avgDelay === undefined ? null : Math.round(p.avgDelay * 10) / 10,
  });
  const peopleOut: any[] = team.results.map((u: any) => ({
    id: u.id, firstName: u.first_name, lastName: u.last_name, name: (u.first_name + ' ' + u.last_name).trim(), color: u.color, photo: u.photo,
    ...num(byUser.get(u.id) || zero),
  }));
  peopleOut.sort((a, b) => b.open - a.open || b.late - a.late || a.name.localeCompare(b.name, 'tr'));
  // atanmamış (ya da ayrılmış üyeye kalmış) işler tek satırda
  const rest = people.results.filter((p: any) => !activeIds.has(p.id));
  if (rest.length) {
    const sum = rest.reduce((a: any, p: any) => ({ open: a.open + (p.open || 0), late: a.late + (p.late || 0), doing: a.doing + (p.doing || 0), done: a.done + (p.done || 0), upcoming: a.upcoming + (p.upcoming || 0) }), { open: 0, late: 0, doing: 0, done: 0, upcoming: 0 });
    if (sum.open || sum.done) peopleOut.push({ id: null, firstName: 'Atanmamış', lastName: '', name: 'Atanmamış', color: '#8C8074', photo: null, ...sum, avgDelay: null });
  }

  const perDay = new Map<string, number>(trend.results.map((x: any) => [x.day, x.n]));
  const trendOut = Array.from({ length: 8 }, (_, i) => {
    const s = addDays(trendStart, i * 7);
    let n = 0; for (let d = 0; d < 7; d++) n += perDay.get(addDays(s, d)) || 0;
    return { start: s, end: addDays(s, 6), count: n };
  });
  const daysLate = (due: string) => Math.round((msOf(today) - msOf(due)) / DAYMS);

  return c.json({
    today, period: { key, label: DONEMLER[key], start, end }, week: { start: wkStart, end: wkEnd },
    approvalEnabled: approval,
    totals: {
      open: t0.open || 0, late: t0.late || 0, done: t0.done || 0, shoots: t0.shoots || 0,
      approval: approval ? (approvalRow.results[0]?.n ?? 0) : null,
      special: { pending: special.results[0]?.pending || 0, total: special.results[0]?.total || 0 },
    },
    people: peopleOut,
    clients: clients.results.map((x: any) => ({ name: x.name, open: x.open || 0, late: x.late || 0, done: x.done || 0, lastShoot: x.lastShoot || null })),
    trend: trendOut,
    attention: {
      late: lateList.results.map((x: any) => ({ id: x.id, title: x.title, client: x.client, assigneeId: x.assignee_id, dueDate: x.due_date, days: daysLate(x.due_date) })),
      unassigned: unassigned.results.map((x: any) => ({ id: x.id, title: x.title, client: x.client, dueDate: x.due_date })),
      shoots: staleShoots.results.map((x: any) => ({ id: x.id, title: x.title, client: x.client, date: x.date, time: x.time })),
    },
  });
});

// ---------- yedekler ----------
r.get('/backups', async (c) => {
  const list = await yedekListesi(c.env);
  return c.json({ count: list.length, last: list[0] || null, items: list.slice(0, 12) });
});

r.post('/backup', async (c) => {
  try {
    const b = await haftalikYedek(c.env, { actorId: c.get('user').id, waitUntil: c.executionCtx.waitUntil.bind(c.executionCtx) });
    return c.json(b);
  } catch (e) {
    return c.json({ error: 'Yedek alınamadı: ' + (e instanceof Error ? e.message : String(e)).slice(0, 200) }, 500);
  }
});

const NAME = /^\d{4}-\d{2}-\d{2}-\d{4}(-\d{1,3})?\.json\.gz$/;
r.get('/backup/:name', async (c) => {
  const name = c.req.param('name');
  if (!NAME.test(name)) return c.json({ error: 'Geçersiz yedek adı' }, 400);
  const obj = await c.env.BACKUP.get(YEDEK_ONEK + name);
  if (!obj) return c.json({ error: 'Yedek bulunamadı' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Length': String(obj.size),
      'Content-Disposition': `attachment; filename="maya-ekip-${name}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
