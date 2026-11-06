// İlham panosu (moodboard): her müşteri için beğenilen referans görseller ve bağlantılar; ayrıca ajansın "Genel" panosu.
// Ekleme: ekipteki herkes. Not/etiket düzenleme ve silme: ekleyen ya da yönetici.
// Görseller R2'de; yalnızca giriş yapmış ekibe bu uçtan sunulur (/api altında, giriş zorunlu).
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Vars } from '../types';
import { changed } from '../notify';
import { clean, newId } from '../util';
import { IMG_EXT, findClient, normLink, serveImage, sniffImage } from './kriz';

type C = Context<{ Bindings: Env; Variables: Vars }>;
export const r = new Hono<{ Bindings: Env; Variables: Vars }>();

const MAX_IMG = 8 * 1024 * 1024;
const MAX_ITEMS = 600;        // pano başına
const MAX_TAGS = 8;
const MAX_TAG_LEN = 24;
const MAX_NOTE = 280;

interface Row {
  id: string; client: string; kind: 'image' | 'link'; r2_key: string | null; content_type: string | null; size: number;
  width: number | null; height: number | null; url: string; site: string; note: string; tags: string; created_by: string | null; created_at: string;
}

const err = (c: C, msg: string, code: 400 | 403 | 404 | 409 | 413 | 415 = 400) => c.json({ error: msg }, code);
const live = (c: C, extra: Record<string, unknown>) => changed(c.env, 'ilham', c.executionCtx.waitUntil.bind(c.executionCtx), extra);

function parseTags(s: string): string[] { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []; } catch { return []; } }

/** Etiketler: dizi ya da virgüllü metin → küçük harf, tekil, en fazla 8 × 24 karakter. */
export function normTags(v: unknown): { ok: true; v: string[] } | { ok: false; e: string } {
  let list: unknown[] = [];
  if (Array.isArray(v)) list = v;
  else if (typeof v === 'string') list = v.split(',');
  else if (v === undefined || v === null) list = [];
  else return { ok: false, e: 'Etiketler geçersiz' };
  const out: string[] = [];
  for (const x of list) {
    if (typeof x !== 'string') return { ok: false, e: 'Etiketler geçersiz' };
    const t = x.trim().replace(/^#/, '').replace(/\s+/g, ' ').toLocaleLowerCase('tr');
    if (!t) continue;
    if (t.length > MAX_TAG_LEN) return { ok: false, e: 'Bir etiket en fazla ' + MAX_TAG_LEN + ' karakter olabilir' };
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > MAX_TAGS) return { ok: false, e: 'En fazla ' + MAX_TAGS + ' etiket eklenebilir' };
  return { ok: true, v: out };
}

/** Bağlantının türü (kartın simgesi/rengi): instagram | pinterest | behance | web */
export function siteOf(url: string): string {
  let h = '';
  try { h = new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return 'web'; }
  if (h === 'instagram.com' || h.endsWith('.instagram.com') || h === 'instagr.am') return 'instagram';
  if (h === 'pin.it' || /(^|\.)pinterest\.[a-z.]+$/.test(h)) return 'pinterest';
  if (h === 'behance.net' || h.endsWith('.behance.net')) return 'behance';
  return 'web';
}

function view(x: Row) {
  return {
    id: x.id, client: x.client, kind: x.kind, url: x.kind === 'image' ? `/api/ilham/${x.id}/dosya` : x.url,
    site: x.site, contentType: x.content_type, size: x.size, width: x.width, height: x.height,
    note: x.note, tags: parseTags(x.tags), createdBy: x.created_by, createdAt: x.created_at,
  };
}

/** ?client= boş/yok → Genel pano (''). Dolu → var olan müşteri adı (arşivdekiler de okunabilir). */
async function board(c: C, raw: unknown, forWrite: boolean): Promise<{ ok: true; v: string } | { ok: false; e: string }> {
  const n = clean(raw, 120);
  if (!n) return { ok: true, v: '' };
  const name = await findClient(c.env, n, !forWrite);
  return name ? { ok: true, v: name } : { ok: false, e: 'Müşteri bulunamadı' };
}
const getRow = (c: C, id: string) => c.env.DB.prepare('SELECT * FROM inspirations WHERE id = ?').bind(id).first<Row>();
const canChange = (c: C, x: Row) => c.get('user').role === 'admin' || x.created_by === c.get('user').id;
const NO_RIGHT = 'Bunu yalnızca ekleyen kişi ya da yönetici değiştirebilir';
async function roomFor(c: C, client: string) {
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM inspirations WHERE client = ?').bind(client).first<{ n: number }>();
  return (n?.n || 0) < MAX_ITEMS;
}
const posInt = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 100000 ? n : null; };

// ---------- liste ----------
r.get('/', async (c) => {
  const b = await board(c, c.req.query('client'), false);
  if (!b.ok) return err(c, b.e, 404);
  const { results } = await c.env.DB.prepare('SELECT * FROM inspirations WHERE client = ? ORDER BY created_at DESC').bind(b.v).all<Row>();
  return c.json({ client: b.v, items: (results || []).map(view) });
});

// ---------- görsel ekle (tek dosya; birden çok görsel için istemci sırayla gönderir) ----------
r.post('/files', async (c) => {
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > MAX_IMG + 64 * 1024) return err(c, 'Görsel en fazla 8 MB olabilir', 413);
  let form: FormData;
  try { form = await c.req.formData(); } catch { return err(c, 'Dosya okunamadı'); }
  const b = await board(c, form.get('client'), true);
  if (!b.ok) return err(c, b.e, 404);
  const f = form.get('file');
  if (!f || typeof f === 'string') return err(c, 'Dosya seçilmedi');
  const file = f as File;
  if (file.size === 0) return err(c, 'Dosya boş');
  if (file.size > MAX_IMG) return err(c, 'Görsel en fazla 8 MB olabilir', 413);
  const note = clean(form.get('note'), 2000);
  if (note.length > MAX_NOTE) return err(c, 'Not en fazla ' + MAX_NOTE + ' karakter olabilir');
  const tags = normTags(typeof form.get('tags') === 'string' ? form.get('tags') : undefined);
  if (!tags.ok) return err(c, tags.e);
  const buf = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(buf);
  if (!type) return err(c, 'Yalnızca PNG, JPG, WEBP ya da GIF görsel yüklenebilir', 415);
  if (!(await roomFor(c, b.v))) return err(c, 'Bu panoya en fazla ' + MAX_ITEMS + ' öğe eklenebilir');
  const id = newId('il');
  const key = `ilham/${b.v ? 'musteri' : 'genel'}/${id}.${IMG_EXT[type]}`;
  await c.env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  await c.env.DB.prepare('INSERT INTO inspirations (id, client, kind, r2_key, content_type, size, width, height, note, tags, created_by) VALUES (?, ?, \'image\', ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, b.v, key, type, file.size, posInt(form.get('width')), posInt(form.get('height')), note, JSON.stringify(tags.v), c.get('user').id).run();
  live(c, { client: b.v, id, action: 'added' });
  return c.json(view((await getRow(c, id))!), 201);
});

// ---------- bağlantı ekle (Instagram / Pinterest / Behance / web — önizlemesiz kart) ----------
r.post('/links', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return err(c, 'Geçersiz istek');
  const b = await board(c, body.client, true);
  if (!b.ok) return err(c, b.e, 404);
  const l = normLink(body.url);
  if (!l.ok) return err(c, l.e);
  if (!l.v) return err(c, 'Bağlantıyı yapıştır');
  const note = clean(body.note, 2000);
  if (note.length > MAX_NOTE) return err(c, 'Not en fazla ' + MAX_NOTE + ' karakter olabilir');
  const tags = normTags(body.tags);
  if (!tags.ok) return err(c, tags.e);
  if (!(await roomFor(c, b.v))) return err(c, 'Bu panoya en fazla ' + MAX_ITEMS + ' öğe eklenebilir');
  const id = newId('il');
  await c.env.DB.prepare("INSERT INTO inspirations (id, client, kind, url, site, note, tags, created_by) VALUES (?, ?, 'link', ?, ?, ?, ?, ?)")
    .bind(id, b.v, l.v, siteOf(l.v), note, JSON.stringify(tags.v), c.get('user').id).run();
  live(c, { client: b.v, id, action: 'added' });
  return c.json(view((await getRow(c, id))!), 201);
});

// ---------- not / etiket ----------
r.patch('/:id', async (c) => {
  const x = await getRow(c, c.req.param('id'));
  if (!x) return err(c, 'Öğe bulunamadı', 404);
  if (!canChange(c, x)) return err(c, NO_RIGHT, 403);
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body)) return err(c, 'Geçersiz istek');
  const sets: string[] = []; const vals: unknown[] = [];
  if ('note' in body) {
    const note = clean(body.note, 2000);
    if (note.length > MAX_NOTE) return err(c, 'Not en fazla ' + MAX_NOTE + ' karakter olabilir');
    sets.push('note = ?'); vals.push(note);
  }
  if ('tags' in body) {
    const t = normTags(body.tags); if (!t.ok) return err(c, t.e);
    sets.push('tags = ?'); vals.push(JSON.stringify(t.v));
  }
  if (!sets.length) return err(c, 'Değişiklik yok');
  await c.env.DB.prepare(`UPDATE inspirations SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, x.id).run();
  live(c, { client: x.client, id: x.id, action: 'edit' });
  return c.json(view((await getRow(c, x.id))!));
});

r.delete('/:id', async (c) => {
  const x = await getRow(c, c.req.param('id'));
  if (!x) return err(c, 'Öğe bulunamadı', 404);
  if (!canChange(c, x)) return err(c, 'Bunu yalnızca ekleyen kişi ya da yönetici silebilir', 403);
  await c.env.DB.prepare('DELETE FROM inspirations WHERE id = ?').bind(x.id).run();
  if (x.r2_key) c.executionCtx.waitUntil(c.env.FILES.delete(x.r2_key).catch(() => {}));
  live(c, { client: x.client, id: x.id, action: 'deleted' });
  return c.json({ ok: true });
});

// ---------- görseli sun (giriş zorunlu) ----------
r.get('/:id/dosya', async (c) => {
  const x = await getRow(c, c.req.param('id'));
  if (!x || x.kind !== 'image' || !x.r2_key) return err(c, 'Görsel bulunamadı', 404);
  const obj = await c.env.FILES.get(x.r2_key);
  if (!obj) return err(c, 'Görsel bulunamadı', 404);
  const ext = IMG_EXT[x.content_type || ''] || 'png';
  const name = 'ilham-' + (x.client ? x.client : 'genel') + '-' + x.id.slice(-6) + '.' + ext;
  return serveImage(obj, x.content_type || 'application/octet-stream', name, c.req.query('download') !== undefined);
});
