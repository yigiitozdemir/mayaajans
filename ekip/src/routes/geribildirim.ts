// Geri bildirim: ekip programda gördüğü hatayı / isteği / fikri tek tıkla yöneticiye iletir.
// Gönderen: POST / (isteğe bağlı görsel, R2) · GET /benim · GET /:id/gorsel (yalnız gönderen + yönetici)
// Yönetici: GET / (filtre) · GET /:id · PATCH /:id (durum, yanıt notu → gönderene bildirim) · DELETE /:id
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Vars } from '../types';
import { notify } from '../notify';
import { broadcast } from '../hub';
import { newId, clean } from '../util';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
type C = Context<{ Bindings: Env; Variables: Vars }>;

export const GB_TURLER = ['hata', 'istek', 'fikir'] as const;
export const GB_DURUMLAR = ['yeni', 'inceleniyor', 'yapildi', 'olmayacak'] as const;
export const GB_MESAJ_MAX = 4000;
export const GB_YANIT_MAX = 2000;
export const GB_GORSEL_MAX = 8 * 1024 * 1024;
const TUR_AD: Record<string, string> = { hata: 'Hata', istek: 'İstek', fikir: 'Fikir' };
const DURUM_AD: Record<string, string> = { yeni: 'Yeni', inceleniyor: 'İnceleniyor', yapildi: 'Yapıldı', olmayacak: 'Olmayacak' };

interface GbRow {
  id: string; user_id: string; kind: string; message: string; status: string; page: string; device: string;
  image_key: string | null; image_type: string | null; image_size: number | null; reply: string; replied_at: string | null;
  created_at: string; updated_at: string;
}

const iso = (s: string | null) => (s ? s.replace(' ', 'T') + (s.endsWith('Z') ? '' : 'Z') : null);
const err = (c: C, msg: string, code: 400 | 403 | 404 | 413 | 415 = 400) => c.json({ error: msg }, code);
const isAdmin = (c: C) => c.get('user').role === 'admin';
const view = (g: GbRow) => ({
  id: g.id, userId: g.user_id, kind: g.kind, message: g.message, status: g.status, page: g.page, device: g.device,
  hasImage: !!g.image_key, imageSize: g.image_size || 0, reply: g.reply, repliedAt: iso(g.replied_at),
  createdAt: iso(g.created_at)!, updatedAt: iso(g.updated_at)!,
});

/** Dosyanın ilk baytlarından görsel türü (dosya adına/beyana güvenmeden). */
export function gorselTuru(b: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'image/webp';
  return null;
}

async function adminIds(c: C): Promise<string[]> {
  const rows = await c.env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all<{ id: string }>();
  return (rows.results || []).map((x) => x.id);
}
/** Canlı yayın yalnızca yöneticilere ve gönderene (başkasının geri bildirimi görünmez). */
async function live(c: C, g: { id: string; user_id: string }, action: string) {
  const to = new Set([...(await adminIds(c)), g.user_id]);
  for (const u of to) c.executionCtx.waitUntil(broadcast(c.env, { type: 'geribildirim', id: g.id, action }, { to: u }));
}
const loadOne = (c: C, id: string) => c.env.DB.prepare('SELECT * FROM geri_bildirimler WHERE id = ?').bind(id).first<GbRow>();

// ---------- gönder ----------
r.post('/', async (c) => {
  const me = c.get('user');
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > GB_GORSEL_MAX + 128 * 1024) return err(c, 'Görsel en fazla 8 MB olabilir', 413);
  let body: Record<string, unknown>;
  const ct = c.req.header('Content-Type') || '';
  try { body = ct.includes('application/json') ? await c.req.json() : await c.req.parseBody(); } catch { return err(c, 'İstek okunamadı'); }
  const kind = typeof body.kind === 'string' ? body.kind : '';
  if (!(GB_TURLER as readonly string[]).includes(kind)) return err(c, 'Tür seç: Hata, İstek ya da Fikir');
  const message = typeof body.message === 'string' ? body.message.replace(/\r\n?/g, '\n').trim() : '';
  if (!message) return err(c, 'Ne olduğunu kısaca yaz');
  if (Array.from(message).length > GB_MESAJ_MAX) return err(c, `Mesaj en fazla ${GB_MESAJ_MAX} karakter olabilir`);
  const page = clean(body.page, 300);
  const device = clean(body.device, 300);
  const file = body.file;
  let img: { buf: ArrayBuffer; type: string } | null = null;
  if (file !== undefined && file !== null && file !== '') {
    if (!(file instanceof File)) return err(c, 'Görsel okunamadı');
    if (file.size === 0) return err(c, 'Görsel boş');
    if (file.size > GB_GORSEL_MAX) return err(c, 'Görsel en fazla 8 MB olabilir', 413);
    const buf = await file.arrayBuffer();
    const type = gorselTuru(new Uint8Array(buf.slice(0, 16)));
    if (!type) return err(c, 'Yalnızca PNG, JPG ya da WEBP görsel eklenebilir', 415);
    img = { buf, type };
  }
  const id = newId('gb');
  let key: string | null = null;
  if (img) {
    key = `geri-bildirim/${me.id}/${id}.${img.type.split('/')[1].replace('jpeg', 'jpg')}`;
    await c.env.FILES.put(key, img.buf, { httpMetadata: { contentType: img.type } });
  }
  await c.env.DB.prepare('INSERT INTO geri_bildirimler (id, user_id, kind, message, page, device, image_key, image_type, image_size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, me.id, kind, message, page, device, key, img?.type ?? null, img ? img.buf.byteLength : null).run();
  const wu = c.executionCtx.waitUntil.bind(c.executionCtx);
  const admins = await adminIds(c);
  await Promise.all(admins.map((a) => notify(c.env, {
    userId: a, kind: 'geribildirim', title: `Yeni geri bildirim (${TUR_AD[kind]}) · ${me.firstName}`,
    body: message.replace(/\s+/g, ' ').slice(0, 160), actorId: me.id, link: '/geri-bildirim?id=' + id,
    meta: (page || 'Geri bildirim') + (img ? ' · görsel var' : ''),
  }, wu)));
  const g = (await loadOne(c, id))!;
  await live(c, g, 'new');
  return c.json(view(g), 201);
});

// Kendi gönderdiklerim (herkes)
r.get('/benim', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM geri_bildirimler WHERE user_id = ? ORDER BY created_at DESC LIMIT 100').bind(c.get('user').id).all<GbRow>();
  return c.json((rows.results || []).map(view));
});

// Görsel: yalnızca yöneticiye ve gönderene
r.get('/:id/gorsel', async (c) => {
  const g = await loadOne(c, c.req.param('id'));
  if (!g) return err(c, 'Geri bildirim bulunamadı', 404);
  if (!isAdmin(c) && g.user_id !== c.get('user').id) return err(c, 'Bu görsel yalnızca yöneticiye ve gönderene açık', 403);
  if (!g.image_key) return err(c, 'Görsel yok', 404);
  const obj = await c.env.FILES.get(g.image_key);
  if (!obj) return err(c, 'Görsel bulunamadı', 404);
  const h = new Headers({
    'Content-Type': g.image_type || 'application/octet-stream',
    'Content-Length': String(obj.size),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `inline; filename="geri-bildirim-${g.id}.${(g.image_type || '').split('/')[1] || 'bin'}"`,
  });
  if (obj.httpEtag) h.set('ETag', obj.httpEtag);
  return new Response(obj.body, { headers: h });
});

// ---------- yönetici ----------
r.use('*', async (c, next) => {
  if (!isAdmin(c)) return c.json({ error: 'Bu bölüm yalnızca yöneticiye açık' }, 403);
  await next();
});

r.get('/', async (c) => {
  const tur = c.req.query('tur') || '';
  const durum = c.req.query('durum') || '';
  if (tur && !(GB_TURLER as readonly string[]).includes(tur)) return err(c, 'Tür geçersiz');
  if (durum && !(GB_DURUMLAR as readonly string[]).includes(durum)) return err(c, 'Durum geçersiz');
  const where: string[] = []; const args: string[] = [];
  if (tur) { where.push('kind = ?'); args.push(tur); }
  if (durum) { where.push('status = ?'); args.push(durum); }
  const rows = await c.env.DB.prepare(`SELECT * FROM geri_bildirimler ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 500`)
    .bind(...args).all<GbRow>();
  const counts = await c.env.DB.prepare('SELECT status, COUNT(*) AS n FROM geri_bildirimler GROUP BY status').all<{ status: string; n: number }>();
  const byStatus: Record<string, number> = { yeni: 0, inceleniyor: 0, yapildi: 0, olmayacak: 0 };
  for (const x of counts.results || []) byStatus[x.status] = x.n;
  return c.json({ items: (rows.results || []).map(view), counts: byStatus });
});

r.get('/:id', async (c) => {
  const g = await loadOne(c, c.req.param('id'));
  if (!g) return err(c, 'Geri bildirim bulunamadı', 404);
  return c.json(view(g));
});

r.patch('/:id', async (c) => {
  const me = c.get('user');
  const g = await loadOne(c, c.req.param('id'));
  if (!g) return err(c, 'Geri bildirim bulunamadı', 404);
  const b = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!b || typeof b !== 'object') return err(c, 'İstek geçersiz');
  let status = g.status, reply = g.reply;
  if (b.status !== undefined) {
    if (typeof b.status !== 'string' || !(GB_DURUMLAR as readonly string[]).includes(b.status)) return err(c, 'Durum geçersiz');
    status = b.status;
  }
  if (b.reply !== undefined) {
    if (typeof b.reply !== 'string') return err(c, 'Yanıt geçersiz');
    reply = b.reply.replace(/\r\n?/g, '\n').trim();
    if (Array.from(reply).length > GB_YANIT_MAX) return err(c, `Yanıt en fazla ${GB_YANIT_MAX} karakter olabilir`);
  }
  const replyChanged = reply !== g.reply && !!reply;
  if (status === g.status && reply === g.reply) return c.json(view(g));
  await c.env.DB.prepare(
    `UPDATE geri_bildirimler SET status = ?, reply = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now'),
       replied_at = CASE WHEN ? THEN strftime('%Y-%m-%d %H:%M:%f', 'now') WHEN ? = '' THEN NULL ELSE replied_at END WHERE id = ?`,
  ).bind(status, reply, replyChanged ? 1 : 0, reply, g.id).run();
  const wu = c.executionCtx.waitUntil.bind(c.executionCtx);
  if (replyChanged) {
    await notify(c.env, {
      userId: g.user_id, kind: 'geribildirim', title: 'Geri bildirimine yanıt: ' + reply.replace(/\s+/g, ' ').slice(0, 90),
      body: `${DURUM_AD[status]} · “${g.message.replace(/\s+/g, ' ').slice(0, 100)}”`, actorId: me.id, link: '/?gb=' + g.id,
      meta: 'Geri bildirim · ' + DURUM_AD[status],
    }, wu);
  } else if (status !== g.status && (status === 'yapildi' || status === 'olmayacak')) {
    await notify(c.env, {
      userId: g.user_id, kind: 'geribildirim', title: `Geri bildirimin: ${DURUM_AD[status]}`,
      body: `“${g.message.replace(/\s+/g, ' ').slice(0, 120)}”`, actorId: me.id, link: '/?gb=' + g.id, meta: 'Geri bildirim',
    }, wu);
  }
  const n = (await loadOne(c, g.id))!;
  await live(c, n, 'edit');
  return c.json(view(n));
});

r.delete('/:id', async (c) => {
  const g = await loadOne(c, c.req.param('id'));
  if (!g) return err(c, 'Geri bildirim bulunamadı', 404);
  if (g.image_key) await c.env.FILES.delete(g.image_key);
  await c.env.DB.prepare('DELETE FROM geri_bildirimler WHERE id = ?').bind(g.id).run();
  await live(c, g, 'delete');
  return c.json({ ok: true });
});
