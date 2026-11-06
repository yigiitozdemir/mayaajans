// Duyuru panosu: önemli duyurular kaybolmasın, kimin okuduğu görünsün.
// Herkes yazar · yazan ya da yönetici düzenler/siler · yönetici sabitler · "Okudum" · okumayanlara hatırlatma.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Vars } from '../types';
import { notify, changed } from '../notify';
import { newId, DAY } from '../util';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
type C = Context<{ Bindings: Env; Variables: Vars }>;

export const DUYURU_BASLIK_MAX = 120;
export const DUYURU_METIN_MAX = 4000;
/** 30 günden eski ve okunmuş (sabit olmayan) duyurular Arşiv'e iner. */
export const ARSIV_GUN = 30;
/** Aynı duyuru için okumayanlara en sık hatırlatma aralığı (sn). */
export const HATIRLAT_ARALIK_S = 60;

interface DuyuruRow {
  id: string; author_id: string; title: string; body: string; important: number; pinned: number;
  reminded_at: string | null; created_at: string; edited_at: string | null;
}
interface ReadRow { duyuru_id: string; user_id: string; read_at: string }

const iso = (s: string | null) => (s ? s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z') : null);
const err = (c: C, msg: string, code: 400 | 403 | 404 | 429 = 400) => c.json({ error: msg }, code);
const isAdmin = (c: C) => c.get('user').role === 'admin';

/** Saf fonksiyon: duyuru arşivde mi? (sabit değil, okunmuş ve 30 günden eski) */
export function arsivde(d: { pinned: boolean; readByMe: boolean; createdAt: string }, now = Date.now()): boolean {
  return !d.pinned && d.readByMe && now - Date.parse(d.createdAt) > ARSIV_GUN * DAY;
}

/** Saf fonksiyon: liste sırası — sabitler üstte, sonra yeniye göre. */
export function sirala<T extends { pinned: boolean; createdAt: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (a.pinned === b.pinned ? (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0) : a.pinned ? -1 : 1));
}

async function activeIds(c: C): Promise<string[]> {
  const rows = await c.env.DB.prepare("SELECT id FROM users WHERE status = 'active' ORDER BY first_name").all<{ id: string }>();
  return (rows.results || []).map((x) => x.id);
}

function view(c: C, d: DuyuruRow, reads: ReadRow[], team: string[], now = Date.now()) {
  const me = c.get('user');
  const manage = d.author_id === me.id || me.role === 'admin';
  const active = new Set(team);
  const readers = reads.filter((x) => active.has(x.user_id)).sort((a, b) => (a.read_at < b.read_at ? -1 : 1));
  const readSet = new Set(readers.map((x) => x.user_id));
  const createdAt = iso(d.created_at)!;
  const readByMe = readSet.has(me.id);
  const pinned = !!d.pinned;
  return {
    id: d.id, authorId: d.author_id, title: d.title, body: d.body, important: !!d.important, pinned,
    createdAt, editedAt: iso(d.edited_at), readByMe,
    readers: readers.map((x) => ({ userId: x.user_id, at: iso(x.read_at) })),
    readCount: readSet.size, total: team.length,
    canEdit: manage, canPin: me.role === 'admin',
    // kimler okumadı: yalnızca yazana ve yöneticiye
    unread: manage ? team.filter((id) => !readSet.has(id)) : null,
    remindedAt: manage ? iso(d.reminded_at) : null,
    archived: arsivde({ pinned, readByMe, createdAt }, now),
  };
}

async function loadOne(c: C, id: string) {
  return c.env.DB.prepare('SELECT * FROM duyurular WHERE id = ?').bind(id).first<DuyuruRow>();
}
async function detail(c: C, d: DuyuruRow) {
  const [reads, team] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM duyuru_okumalar WHERE duyuru_id = ?').bind(d.id).all<ReadRow>(),
    activeIds(c),
  ]);
  return view(c, d, reads.results || [], team);
}
const live = (c: C, extra: Record<string, unknown>) => changed(c.env, 'duyuru', c.executionCtx.waitUntil.bind(c.executionCtx), extra);

type Input = { title?: string; body?: string; important?: boolean; pinned?: boolean };
function readInput(b: any, partial: boolean): Input | string {
  const out: Input = {};
  if (!partial || b.title !== undefined) {
    if (typeof b.title !== 'string' || !b.title.trim()) return 'Başlık boş olamaz';
    const t = b.title.replace(/\s+/g, ' ').trim();
    if (Array.from(t).length > DUYURU_BASLIK_MAX) return `Başlık en fazla ${DUYURU_BASLIK_MAX} karakter olabilir`;
    out.title = t;
  }
  if (!partial || b.body !== undefined) {
    if (b.body !== undefined && b.body !== null && typeof b.body !== 'string') return 'Metin geçersiz';
    const body = typeof b.body === 'string' ? b.body.replace(/\r\n?/g, '\n').replace(/^(\s*\n)+/, '').replace(/\s+$/, '') : '';
    if (Array.from(body).length > DUYURU_METIN_MAX) return `Metin en fazla ${DUYURU_METIN_MAX} karakter olabilir`;
    out.body = body;
  }
  if (b.important !== undefined) { if (typeof b.important !== 'boolean') return 'Önemli işareti geçersiz'; out.important = b.important; }
  if (b.pinned !== undefined) { if (typeof b.pinned !== 'boolean') return 'Sabitleme geçersiz'; out.pinned = b.pinned; }
  return out;
}

// ---------- liste ----------
r.get('/', async (c) => {
  const [rows, reads, team] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM duyurular').all<DuyuruRow>(),
    c.env.DB.prepare('SELECT * FROM duyuru_okumalar').all<ReadRow>(),
    activeIds(c),
  ]);
  const byId = new Map<string, ReadRow[]>();
  for (const x of reads.results || []) { const a = byId.get(x.duyuru_id) || []; a.push(x); byId.set(x.duyuru_id, a); }
  const now = Date.now();
  const items = sirala((rows.results || []).map((d) => view(c, d, byId.get(d.id) || [], team, now)));
  return c.json({ items, total: team.length });
});

// Menü rozeti: bana ait okunmamış duyuru sayısı
r.get('/okunmamis', async (c) => {
  const me = c.get('user').id;
  const row = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM duyurular d WHERE NOT EXISTS (SELECT 1 FROM duyuru_okumalar o WHERE o.duyuru_id = d.id AND o.user_id = ?)',
  ).bind(me).first<{ n: number }>();
  return c.json({ sayi: row?.n || 0 });
});

r.get('/:id', async (c) => {
  const d = await loadOne(c, c.req.param('id'));
  if (!d) return err(c, 'Duyuru bulunamadı', 404);
  return c.json(await detail(c, d));
});

// ---------- yaz ----------
r.post('/', async (c) => {
  const me = c.get('user');
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object') return err(c, 'İstek geçersiz');
  const inp = readInput(b, false);
  if (typeof inp === 'string') return err(c, inp);
  if (inp.pinned && me.role !== 'admin') return err(c, 'Duyuruyu yalnızca yönetici sabitleyebilir', 403);
  const id = newId('dy');
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO duyurular (id, author_id, title, body, important, pinned) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, me.id, inp.title!, inp.body || '', inp.important ? 1 : 0, inp.pinned ? 1 : 0),
    c.env.DB.prepare('INSERT INTO duyuru_okumalar (duyuru_id, user_id) VALUES (?, ?)').bind(id, me.id), // yazan okumuş sayılır
  ]);
  const d = (await loadOne(c, id))!;
  // bütün aktif ekibe bildirim
  const wu = c.executionCtx.waitUntil.bind(c.executionCtx);
  const team = await activeIds(c);
  const snippet = (inp.body || '').replace(/\s+/g, ' ').slice(0, 160);
  const title = inp.important ? '📣 Önemli duyuru: ' + inp.title : 'Yeni duyuru: ' + inp.title;
  await Promise.all(team.filter((u) => u !== me.id).map((u) => notify(c.env, {
    userId: u, kind: 'duyuru', title, body: snippet || me.firstName + ' bir duyuru paylaştı', actorId: me.id,
    link: '/duyurular?id=' + id, meta: me.firstName + ' · Duyuru',
  }, wu)));
  live(c, { id, action: 'new' });
  return c.json(await detail(c, d), 201);
});

r.patch('/:id', async (c) => {
  const me = c.get('user');
  const d = await loadOne(c, c.req.param('id'));
  if (!d) return err(c, 'Duyuru bulunamadı', 404);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object') return err(c, 'İstek geçersiz');
  const inp = readInput(b, true);
  if (typeof inp === 'string') return err(c, inp);
  const editsContent = inp.title !== undefined || inp.body !== undefined || inp.important !== undefined;
  if (editsContent && d.author_id !== me.id && !isAdmin(c)) return err(c, 'Bu duyuruyu yalnızca yazan ya da yönetici düzenleyebilir', 403);
  if (inp.pinned !== undefined && !isAdmin(c)) return err(c, 'Duyuruyu yalnızca yönetici sabitleyebilir', 403);
  if (!editsContent && inp.pinned === undefined) return err(c, 'Değişiklik yok');
  const contentChanged = (inp.title !== undefined && inp.title !== d.title) || (inp.body !== undefined && inp.body !== d.body)
    || (inp.important !== undefined && inp.important !== !!d.important);
  await c.env.DB.prepare(
    `UPDATE duyurular SET title = ?, body = ?, important = ?, pinned = ?,
       edited_at = CASE WHEN ? THEN strftime('%Y-%m-%d %H:%M:%f', 'now') ELSE edited_at END WHERE id = ?`,
  ).bind(
    inp.title ?? d.title, inp.body ?? d.body,
    inp.important === undefined ? d.important : inp.important ? 1 : 0,
    inp.pinned === undefined ? d.pinned : inp.pinned ? 1 : 0,
    contentChanged ? 1 : 0, d.id,
  ).run();
  live(c, { id: d.id, action: 'edit' });
  return c.json(await detail(c, (await loadOne(c, d.id))!));
});

r.delete('/:id', async (c) => {
  const me = c.get('user');
  const d = await loadOne(c, c.req.param('id'));
  if (!d) return err(c, 'Duyuru bulunamadı', 404);
  if (d.author_id !== me.id && !isAdmin(c)) return err(c, 'Bu duyuruyu yalnızca yazan ya da yönetici silebilir', 403);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM duyuru_okumalar WHERE duyuru_id = ?').bind(d.id),
    c.env.DB.prepare('DELETE FROM duyurular WHERE id = ?').bind(d.id),
  ]);
  live(c, { id: d.id, action: 'delete' });
  return c.json({ ok: true });
});

// ---------- okudum / hatırlat ----------
r.post('/:id/okudum', async (c) => {
  const me = c.get('user');
  const d = await loadOne(c, c.req.param('id'));
  if (!d) return err(c, 'Duyuru bulunamadı', 404);
  const res = await c.env.DB.prepare('INSERT OR IGNORE INTO duyuru_okumalar (duyuru_id, user_id) VALUES (?, ?)').bind(d.id, me.id).run();
  if (res.meta.changes) live(c, { id: d.id, action: 'read', userId: me.id });
  return c.json(await detail(c, d));
});

r.post('/:id/hatirlat', async (c) => {
  const me = c.get('user');
  const d = await loadOne(c, c.req.param('id'));
  if (!d) return err(c, 'Duyuru bulunamadı', 404);
  if (d.author_id !== me.id && !isAdmin(c)) return err(c, 'Hatırlatmayı yalnızca yazan ya da yönetici gönderebilir', 403);
  if (d.reminded_at) {
    const ago = (Date.now() - Date.parse(iso(d.reminded_at)!)) / 1000;
    if (ago < HATIRLAT_ARALIK_S) return err(c, `Az önce hatırlattın, ${Math.ceil(HATIRLAT_ARALIK_S - ago)} saniye sonra yeniden deneyebilirsin`, 429);
  }
  const v = await detail(c, d);
  const targets = (v.unread || []).filter((u) => u !== me.id);
  if (!targets.length) return c.json({ sent: 0, item: v });
  await c.env.DB.prepare("UPDATE duyurular SET reminded_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = ?").bind(d.id).run();
  const wu = c.executionCtx.waitUntil.bind(c.executionCtx);
  await Promise.all(targets.map((u) => notify(c.env, {
    userId: u, kind: 'duyuru', title: 'Hatırlatma: ' + d.title, body: me.firstName + ' bu duyuruyu okumanı rica ediyor',
    actorId: me.id, link: '/duyurular?id=' + d.id, meta: 'Duyuru · okunmadı',
  }, wu)));
  return c.json({ sent: targets.length, item: await detail(c, (await loadOne(c, d.id))!) });
});
