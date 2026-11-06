// Maya Ajans ekip programı — API
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, UserRow, Vars } from './types';
import { authRoutes, createInviteLink, publicOrigin, requireAdmin, requireUser, sameOrigin } from './auth';
import { Hub, broadcast } from './hub';
import { clean, isDate, isEmail, istanbulHour, newId } from './util';
import { serveStatic } from './static';
import { indir } from './indir';
import { r as musteriler } from './routes/musteriler';
import { r as ozelgunler } from './routes/ozelgunler';
import { r as cekim, cekimHatirlatma } from './routes/cekim';
import { r as sohbet } from './routes/sohbet';
import { r as durt } from './routes/durt';
import { r as ajanda, ajandaHatirlatma } from './routes/ajanda';
import { sabahOzeti } from './sabah';
import { r as arama } from './routes/arama';
import { r as yonetim } from './routes/yonetim';
import { r as pushRoutes } from './routes/push';
import { haftalikYedek } from './yedek';
import { sendPush } from './push';
import { onayHatirlatma } from './onay';

export { Hub };

type C = Context<{ Bindings: Env; Variables: Vars }>;
const app = new Hono<{ Bindings: Env; Variables: Vars }>();

app.use('/api/*', sameOrigin);
app.onError((err, c) => { console.error(err); return c.json({ error: 'Beklenmeyen bir hata oldu' }, 500); });

app.route('/api/auth', authRoutes);
app.get('/api/health', (c) => c.json({ ok: true }));

const api = new Hono<{ Bindings: Env; Variables: Vars }>();
api.use('*', requireUser);

// ---------- yardımcılar ----------
const PALETTE = ['#2F6F8F', '#7A4E9C', '#3E7A55', '#9C4A5E', '#8A5A2B', '#5B6B3A', '#4C6A9E', '#8E5B8A'];
const SETTING_BOOLS = ['remindHourly', 'quietHours', 'morning', 'weekendQuiet', 'nudgeSound', 'nudgeShake', 'nudgeMac', 'dnd', 'launchWindow'];

function teamView(u: UserRow, admin: boolean) {
  return {
    id: u.id, firstName: u.first_name, lastName: u.last_name,
    name: (u.first_name + ' ' + u.last_name).trim() || u.email.split('@')[0],
    color: u.color, photo: u.photo, role: u.role, status: u.status,
    canEditClients: u.role === 'admin' || !!u.can_edit_clients,
    email: u.email,
    ...(admin ? {} : {}),
  };
}

interface TaskRow {
  id: string; title: string; client: string; assignee_id: string | null; due_date: string | null; status: number;
  note: string; items: string; link: string; done_link: string; source: string; created_by: string | null;
  created_at: string; updated_at: string; completed_at: string | null;
}
function taskView(t: TaskRow) {
  let items: string[] = [];
  try { items = JSON.parse(t.items || '[]'); } catch { /* */ }
  return {
    id: t.id, title: t.title, client: t.client, assigneeId: t.assignee_id, dueDate: t.due_date, status: t.status,
    note: t.note, items, link: t.link, doneLink: t.done_link || '', source: t.source, createdBy: t.created_by,
    createdAt: t.created_at, updatedAt: t.updated_at, completedAt: t.completed_at,
  };
}

async function notifyAssign(c: C, task: TaskRow) {
  const actor = c.get('user');
  if (!task.assignee_id || task.assignee_id === actor.id) return;
  const n = {
    id: newId('n'), user_id: task.assignee_id, kind: 'assign', task_id: task.id, actor_id: actor.id,
    title: 'Sana yeni iş atandı', body: task.title,
  };
  // aynı iş için okunmamış eski atama bildirimi varsa yenisiyle değiştirilir
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM notifications WHERE user_id = ? AND task_id = ? AND kind = 'assign' AND read_at IS NULL").bind(n.user_id, n.task_id),
    c.env.DB.prepare('INSERT INTO notifications (id, user_id, kind, task_id, actor_id, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(n.id, n.user_id, n.kind, n.task_id, n.actor_id, n.title, n.body),
  ]);
  c.executionCtx.waitUntil(broadcast(c.env, {
    type: 'notify',
    notification: { id: n.id, kind: n.kind, taskId: n.task_id, actorId: n.actor_id, title: n.title, body: n.body, task: taskView(task), readAt: null, reminders: 0 },
  }, { to: n.user_id }));
  c.executionCtx.waitUntil(sendPush(c.env, n.user_id, { title: n.title, body: task.title + (task.client ? ' · ' + task.client : ''), link: '/isler?is=' + task.id, tag: 'assign' }).catch(() => {}));
}

const tasksChanged = (c: C) => c.executionCtx.waitUntil(broadcast(c.env, { type: 'tasks' }));
const teamChanged = (c: C) => c.executionCtx.waitUntil(broadcast(c.env, { type: 'team' }));

// ---------- profil ----------
api.get('/me', (c) => c.json(c.get('user')));

api.patch('/me', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = []; const vals: unknown[] = [];
  if ('firstName' in b) {
    const f = clean(b.firstName, 40);
    if (!f) return c.json({ error: 'Ad boş olamaz' }, 400);
    sets.push('first_name = ?'); vals.push(f);
  }
  if ('lastName' in b) { sets.push('last_name = ?'); vals.push(clean(b.lastName, 40)); }
  if ('photo' in b) {
    const p = b.photo;
    if (p === null || p === '') { sets.push('photo = NULL'); }
    else if (typeof p === 'string' && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(p) && p.length <= 400_000) { sets.push('photo = ?'); vals.push(p); }
    else return c.json({ error: 'Fotoğraf geçersiz ya da çok büyük' }, 400);
  }
  if (b.settings && typeof b.settings === 'object') {
    const next: Record<string, unknown> = { ...u.settings };
    for (const k of SETTING_BOOLS) if (typeof b.settings[k] === 'boolean') next[k] = b.settings[k];
    if (['system', 'light', 'dark'].includes(b.settings.theme)) next.theme = b.settings.theme;
    if (typeof b.settings.morningTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.settings.morningTime)) next.morningTime = b.settings.morningTime;
    sets.push('settings = ?'); vals.push(JSON.stringify(next));
  }
  if (!sets.length) return c.json({ error: 'Değişiklik yok' }, 400);
  await c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...vals, u.id).run();
  teamChanged(c);
  const row = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(u.id).first<UserRow>();
  return c.json(teamView(row!, false));
});

// ---------- ekip ----------
api.get('/team', async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM users WHERE status != 'removed' ORDER BY role = 'admin' DESC, first_name").all<UserRow>();
  return c.json(results.map((u) => teamView(u, c.get('user').role === 'admin')));
});

api.get('/online', async (c) => {
  const r = await c.env.HUB.get(c.env.HUB.idFromName('maya')).fetch('https://hub/online');
  return c.json(await r.json());
});

// ---------- yönetici ----------
const admin = new Hono<{ Bindings: Env; Variables: Vars }>();
admin.use('*', requireAdmin);

admin.get('/users', async (c) => {
  const { results: users } = await c.env.DB.prepare("SELECT * FROM users WHERE status != 'removed' ORDER BY role = 'admin' DESC, created_at").all<UserRow>();
  const { results: sessions } = await c.env.DB.prepare("SELECT id, user_id, device, created_at, last_seen_at FROM sessions WHERE expires_at > datetime('now') ORDER BY last_seen_at DESC").all<{ id: string; user_id: string; device: string; created_at: string; last_seen_at: string }>();
  const me = c.get('user');
  return c.json(users.map((u) => ({
    ...teamView(u, true),
    sessions: sessions.filter((s) => s.user_id === u.id).map((s) => ({ id: s.id, device: s.device, lastSeenAt: s.last_seen_at, isThis: s.id === me.sessionId })),
  })));
});

admin.post('/invite', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const email = clean(b.email, 200).toLowerCase();
  if (!isEmail(email)) return c.json({ error: 'Geçerli bir e-posta adresi yaz' }, 400);
  const existing = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<UserRow>();
  let id: string;
  if (existing && existing.status !== 'removed') return c.json({ error: 'Bu e-posta zaten ekipte' }, 409);
  if (existing) {
    id = existing.id;
    await c.env.DB.prepare("UPDATE users SET status = 'pending', role = 'member', password_hash = NULL, password_salt = NULL, updated_at = datetime('now') WHERE id = ?").bind(id).run();
  } else {
    id = newId('u');
    const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
    const first = email.split('@')[0];
    await c.env.DB.prepare('INSERT INTO users (id, email, first_name, color, role, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, email, first.charAt(0).toLocaleUpperCase('tr') + first.slice(1), PALETTE[(count?.n ?? 0) % PALETTE.length], 'member', 'pending').run();
  }
  const link = await createInviteLink(c.env, publicOrigin(c), id, 'invite');
  teamChanged(c);
  return c.json({ id, link });
});

// Davet bağlantısını yenile (bekleyen üye) ya da şifre sıfırlama bağlantısı üret (aktif üye)
admin.post('/users/:id/link', async (c) => {
  const u = await c.env.DB.prepare("SELECT * FROM users WHERE id = ? AND status != 'removed'").bind(c.req.param('id')).first<UserRow>();
  if (!u) return c.json({ error: 'Üye bulunamadı' }, 404);
  const link = await createInviteLink(c.env, publicOrigin(c), u.id, u.status === 'active' ? 'reset' : 'invite');
  return c.json({ link, kind: u.status === 'active' ? 'reset' : 'invite' });
});

admin.patch('/users/:id', async (c) => {
  const id = c.req.param('id');
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.canEditClients !== 'boolean') return c.json({ error: 'Değişiklik yok' }, 400);
  await c.env.DB.prepare("UPDATE users SET can_edit_clients = ?, updated_at = datetime('now') WHERE id = ? AND role = 'member'").bind(b.canEditClients ? 1 : 0, id).run();
  teamChanged(c);
  return c.json({ ok: true });
});

admin.delete('/users/:id', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) return c.json({ error: 'Kendini ekipten çıkaramazsın' }, 400);
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
  if (!u || u.role === 'admin') return c.json({ error: 'Bu üye çıkarılamaz' }, 400);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET status = 'removed', password_hash = NULL, password_salt = NULL, updated_at = datetime('now') WHERE id = ?").bind(id),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    c.env.DB.prepare("UPDATE invites SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL").bind(id),
  ]);
  c.executionCtx.waitUntil(broadcast(c.env, { type: 'session-revoked' }, { to: id }));
  teamChanged(c);
  return c.json({ ok: true });
});

admin.delete('/sessions/:sid', async (c) => {
  const sid = c.req.param('sid');
  if (sid === c.get('user').sessionId) return c.json({ error: 'Kullandığın oturumu buradan kapatamazsın' }, 400);
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(sid).run();
  c.executionCtx.waitUntil(broadcast(c.env, { type: 'session-revoked' }, { session: sid }));
  return c.json({ ok: true });
});

admin.delete('/users/:id/sessions', async (c) => {
  const id = c.req.param('id');
  if (id === c.get('user').id) return c.json({ error: 'Kendi oturumlarını buradan kapatamazsın' }, 400);
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id).run();
  c.executionCtx.waitUntil(broadcast(c.env, { type: 'session-revoked' }, { to: id }));
  return c.json({ ok: true });
});

api.route('/admin', admin);

// ---------- Aşama 2–3 bölümleri (src/routes/…) ----------
api.route('/clients', musteriler);
api.route('/days', ozelgunler);
api.route('/shoots', cekim);
api.route('/chat', sohbet);
api.route('/nudge', durt);
api.route('/agenda', ajanda);
api.route('/search', arama);
api.route('/admin-summary', yonetim);
api.route('/push', pushRoutes);

// ---------- işler ----------
api.get('/tasks', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM tasks ORDER BY created_at').all<TaskRow>();
  return c.json(results.map(taskView));
});

async function validAssignee(c: C, id: unknown): Promise<string | null | false> {
  if (id === null || id === '' || id === undefined) return null;
  if (typeof id !== 'string') return false;
  const u = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status != 'removed'").bind(id).first();
  return u ? id : false;
}

function cleanItems(v: unknown): string {
  if (!Array.isArray(v)) return '[]';
  return JSON.stringify(v.filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, 200)).filter(Boolean).slice(0, 50));
}

api.post('/tasks', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  const title = clean(b.title, 300);
  if (!title) return c.json({ error: 'İş başlığı boş olamaz' }, 400);
  if (!isDate(b.dueDate)) return c.json({ error: 'Teslim tarihi seç' }, 400);
  const assignee = await validAssignee(c, b.assigneeId);
  if (assignee === false) return c.json({ error: 'Sorumlu bulunamadı' }, 400);
  const status = [0, 1, 2].includes(b.status) ? b.status : 0;
  const link = clean(b.link, 1000);
  if (link && !/^https?:\/\//i.test(link)) return c.json({ error: 'Link http:// ya da https:// ile başlamalı' }, 400);
  const id = newId('t');
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, title, client, assignee_id, due_date, status, note, items, link, created_by, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${status === 2 ? "datetime('now')" : 'NULL'})`,
  ).bind(id, title, clean(b.client, 120), assignee, b.dueDate, status, clean(b.note, 4000), cleanItems(b.items), link, u.id).run();
  const row = (await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>())!;
  await notifyAssign(c, row);
  tasksChanged(c);
  return c.json(taskView(row), 201);
});

api.patch('/tasks/:id', async (c) => {
  const id = c.req.param('id');
  const before = await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>();
  if (!before) return c.json({ error: 'İş bulunamadı' }, 404);
  const b = await c.req.json().catch(() => ({}));
  const sets: string[] = []; const vals: unknown[] = [];
  if ('title' in b) { const t = clean(b.title, 300); if (!t) return c.json({ error: 'İş başlığı boş olamaz' }, 400); sets.push('title = ?'); vals.push(t); }
  if ('client' in b) { sets.push('client = ?'); vals.push(clean(b.client, 120)); }
  if ('dueDate' in b) { if (!isDate(b.dueDate)) return c.json({ error: 'Geçerli bir teslim tarihi seç' }, 400); sets.push('due_date = ?'); vals.push(b.dueDate); }
  if ('status' in b) {
    if (![0, 1, 2].includes(b.status)) return c.json({ error: 'Geçersiz durum' }, 400);
    sets.push('status = ?'); vals.push(b.status);
    sets.push(b.status === 2 ? "completed_at = COALESCE(completed_at, datetime('now'))" : 'completed_at = NULL');
  }
  if ('note' in b) { sets.push('note = ?'); vals.push(clean(b.note, 4000)); }
  if ('items' in b) { sets.push('items = ?'); vals.push(cleanItems(b.items)); }
  if ('link' in b) { const l = clean(b.link, 1000); if (l && !/^https?:\/\//i.test(l)) return c.json({ error: 'Link http:// ya da https:// ile başlamalı' }, 400); sets.push('link = ?'); vals.push(l); }
  if ('doneLink' in b) {
    let l = clean(b.doneLink, 1000);
    if (l && !/^[a-z]+:\/\//i.test(l) && /^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(l)) l = 'https://' + l; // "drive.google.com/…" yapıştırılırsa
    if (l && !/^https?:\/\//i.test(l)) return c.json({ error: 'Teslim linki http:// ya da https:// ile başlamalı' }, 400);
    sets.push('done_link = ?'); vals.push(l);
  }
  let assigneeChanged = false;
  if ('assigneeId' in b) {
    const a = await validAssignee(c, b.assigneeId);
    if (a === false) return c.json({ error: 'Sorumlu bulunamadı' }, 400);
    sets.push('assignee_id = ?'); vals.push(a); assigneeChanged = a !== before.assignee_id;
  }
  if (!sets.length) return c.json({ error: 'Değişiklik yok' }, 400);
  await c.env.DB.prepare(`UPDATE tasks SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...vals, id).run();
  const row = (await c.env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first<TaskRow>())!;
  if (assigneeChanged) await notifyAssign(c, row);
  tasksChanged(c);
  return c.json(taskView(row));
});

api.delete('/tasks/:id', async (c) => {
  const u = c.get('user');
  const t = await c.env.DB.prepare('SELECT created_by FROM tasks WHERE id = ?').bind(c.req.param('id')).first<{ created_by: string | null }>();
  if (!t) return c.json({ error: 'İş bulunamadı' }, 404);
  if (u.role !== 'admin' && t.created_by !== u.id) return c.json({ error: 'Bu işi sadece ekleyen kişi ya da yönetici silebilir' }, 403);
  await c.env.DB.prepare('DELETE FROM tasks WHERE id = ?').bind(c.req.param('id')).run();
  tasksChanged(c);
  return c.json({ ok: true });
});

// ---------- bildirimler ----------
api.get('/notifications', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM notifications WHERE user_id = ? AND (read_at IS NULL OR read_at > datetime('now', '-7 days')) ORDER BY read_at IS NOT NULL, created_at DESC LIMIT 50`,
  ).bind(c.get('user').id).all<{ id: string; kind: string; task_id: string | null; actor_id: string | null; title: string; body: string; created_at: string; read_at: string | null; reminders: number }>();
  return c.json(results.map((n) => ({ id: n.id, kind: n.kind, taskId: n.task_id, actorId: n.actor_id, title: n.title, body: n.body, createdAt: n.created_at, readAt: n.read_at, reminders: n.reminders })));
});

// Okundu: belirli bildirimler, bir işe ait atamalar (işi açınca) ya da hepsi
api.post('/notifications/read', async (c) => {
  const uid = c.get('user').id;
  const b = await c.req.json().catch(() => ({}));
  if (b.all === true) await c.env.DB.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").bind(uid).run();
  else if (typeof b.taskId === 'string') await c.env.DB.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND task_id = ? AND read_at IS NULL").bind(uid, b.taskId).run();
  else if (typeof b.id === 'string') await c.env.DB.prepare("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND id = ? AND read_at IS NULL").bind(uid, b.id).run();
  else return c.json({ error: 'Ne okunduğu belirtilmedi' }, 400);
  return c.json({ ok: true });
});

// ---------- canlı bağlantı ----------
api.get('/live', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') return c.json({ error: 'WebSocket gerekli' }, 426);
  const u = c.get('user');
  const h = new Headers(c.req.raw.headers);
  h.set('X-User-Id', u.id); h.set('X-Session-Id', u.sessionId);
  return c.env.HUB.get(c.env.HUB.idFromName('maya')).fetch(new Request(c.req.raw.url, { headers: h }));
});

app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: 'Bulunamadı' }, 404));
app.route('/indir', indir);
app.get('*', (c) => serveStatic(c.req.raw));

// ---------- saatlik hatırlatma ----------
async function hourlyReminders(env: Env) {
  const hour = istanbulHour();
  const { results } = await env.DB.prepare(
    `SELECT n.*, u.settings, t.title AS task_title, t.client AS task_client, t.due_date AS task_due
     FROM notifications n JOIN users u ON u.id = n.user_id LEFT JOIN tasks t ON t.id = n.task_id
     WHERE n.kind = 'assign' AND n.read_at IS NULL AND u.status = 'active'
       AND n.created_at <= datetime('now', '-55 minutes')
       AND (n.last_reminded_at IS NULL OR n.last_reminded_at <= datetime('now', '-55 minutes'))`,
  ).all<{ id: string; user_id: string; task_id: string; settings: string; reminders: number; task_title: string; task_client: string; task_due: string | null }>();
  for (const n of results) {
    let s: Record<string, unknown> = {};
    try { s = JSON.parse(n.settings || '{}'); } catch { /* */ }
    if (s.remindHourly === false) continue;
    if (s.quietHours !== false && (hour >= 19 || hour < 9)) continue;
    await env.DB.prepare("UPDATE notifications SET reminders = reminders + 1, last_reminded_at = datetime('now') WHERE id = ?").bind(n.id).run();
    await broadcast(env, {
      type: 'remind',
      notification: { id: n.id, kind: 'assign', taskId: n.task_id, title: 'Hatırlatma: bu iş seni bekliyor', body: n.task_title, reminders: n.reminders + 1, task: { title: n.task_title, client: n.task_client, dueDate: n.task_due } },
    }, { to: n.user_id });
    await sendPush(env, n.user_id, { title: 'Hatırlatma: bu iş seni bekliyor', body: n.task_title, link: '/isler?is=' + n.task_id, tag: 'remind' }).catch(() => {});
  }
  // eski denemeleri ve süresi dolmuş oturumları temizle
  await env.DB.batch([
    env.DB.prepare("DELETE FROM login_attempts WHERE at < datetime('now', '-1 day')"),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),
  ]);
}

export default {
  fetch: app.fetch,
  scheduled: async (e: ScheduledController, env: Env, ctx: ExecutionContext) => {
    if (e.cron === '* * * * *') ctx.waitUntil(ajandaHatirlatma(env)); // Ajandam anımsatıcıları (dakikalık)
    else if (e.cron === '17 0 * * 1') ctx.waitUntil(haftalikYedek(env)); // haftalık yedek
    else if (e.cron === '30 13 * * *') ctx.waitUntil(cekimHatirlatma(env)); // 16:30 İstanbul
    else ctx.waitUntil(Promise.all([hourlyReminders(env), sabahOzeti(env), onayHatirlatma(env)]));
  },
} satisfies ExportedHandler<Env>;
