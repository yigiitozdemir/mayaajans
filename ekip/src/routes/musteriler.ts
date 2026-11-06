// Müşteriler: liste, marka kiti, logolar (R2)
// Ekleme / kaldırma: sadece yönetici. Kit ve dosya düzenleme: yönetici + yetki verilen üyeler (canEditClients).
// Görüntüleme ve indirme: giriş yapmış herkes.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Vars } from '../types';
import { requireAdmin } from '../auth';
import { changed } from '../notify';
import { clean, newId } from '../util';

type C = Context<{ Bindings: Env; Variables: Vars }>;
export const r = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- sabitler ----------
export const VARIANTS = ['Renkli', 'Beyaz', 'Siyah', 'Yatay', 'Dikey', 'İkon', 'Diğer'] as const;
const FONT_USES = ['Başlık', 'Gövde', 'Vurgu'];
const LINK_KEYS = ['instagram', 'facebook', 'tiktok', 'linkedin', 'web', 'drive'] as const;
const MAX_FILE = 25 * 1024 * 1024;
const MAX_FILES_PER_CLIENT = 60;
const MAX_KIT_JSON = 64 * 1024;
const TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', ai: 'application/postscript', eps: 'application/postscript', zip: 'application/zip',
};
const IMAGE = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']);
// liste önizlemesi için tercih sırası (beyaz logo açık zeminde görünmez, en sona)
const PREVIEW_ORDER = ['İkon', 'Renkli', 'Yatay', 'Dikey', 'Siyah', 'Diğer', 'Beyaz'];

interface ClientRow { id: string; name: string; slack_channel: string | null; archived: number; kit: string; updated_at: string | null; created_at: string }
interface FileRow { id: string; client_id: string; variant: string; name: string; r2_key: string; content_type: string; size: number; created_by: string | null; created_at: string }

export interface Kit {
  sector: string; owner: string;
  colors: { hex: string; name: string }[];
  fonts: { name: string; use: string }[];
  tone: string[]; banned: string[];
  tagSets: { name: string; tags: string }[];
  links: Record<string, string>;
  notes: { id: string; text: string; by: string; at: string }[];
}

// ---------- yardımcılar ----------
const err = (c: C, msg: string, code: 400 | 403 | 404 | 409 | 413 | 415 = 400) => c.json({ error: msg }, code);
const trLower = (s: string) => s.toLocaleLowerCase('tr');
const live = (c: C, extra: Record<string, unknown>) => changed(c.env, 'clients', c.executionCtx.waitUntil.bind(c.executionCtx), extra);

/** "Gülümse Davet Evi" → "gulumse-davet-evi" */
export function slug(name: string): string {
  return trLower(name).replace(/ı/g, 'i')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '') || 'musteri';
}

/** R2 anahtarı ve indirme adı için güvenli ASCII dosya adı */
function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  return (slug(base).slice(0, 80) || 'dosya') + (ext ? '.' + ext : '');
}

function emptyKit(): Kit {
  return { sector: '', owner: '', colors: [], fonts: [], tone: [], banned: [], tagSets: [], links: {}, notes: [] };
}
function parseKit(s: string | null): Kit {
  let raw: any = {};
  try { raw = JSON.parse(s || '{}') || {}; } catch { /* bozuk → boş */ }
  const k = emptyKit();
  if (typeof raw.sector === 'string') k.sector = raw.sector;
  if (typeof raw.owner === 'string') k.owner = raw.owner;
  if (Array.isArray(raw.colors)) k.colors = raw.colors.filter((x: any) => x && typeof x.hex === 'string').map((x: any) => ({ hex: x.hex, name: String(x.name || '') }));
  if (Array.isArray(raw.fonts)) k.fonts = raw.fonts.filter((x: any) => x && typeof x.name === 'string').map((x: any) => ({ name: x.name, use: String(x.use || 'Başlık') }));
  if (Array.isArray(raw.tone)) k.tone = raw.tone.filter((x: any) => typeof x === 'string');
  if (Array.isArray(raw.banned)) k.banned = raw.banned.filter((x: any) => typeof x === 'string');
  if (Array.isArray(raw.tagSets)) k.tagSets = raw.tagSets.filter((x: any) => x && typeof x.tags === 'string').map((x: any) => ({ name: String(x.name || 'Genel'), tags: x.tags }));
  if (raw.links && typeof raw.links === 'object') for (const key of LINK_KEYS) if (typeof raw.links[key] === 'string' && raw.links[key]) k.links[key] = raw.links[key];
  if (Array.isArray(raw.notes)) k.notes = raw.notes.filter((x: any) => x && typeof x.text === 'string' && typeof x.id === 'string');
  return k;
}

function fileView(f: FileRow) {
  const ext = (f.name.includes('.') ? f.name.split('.').pop()! : '').toLowerCase();
  return {
    id: f.id, variant: f.variant, name: f.name, contentType: f.content_type, size: f.size, ext,
    isImage: IMAGE.has(f.content_type), createdBy: f.created_by, createdAt: f.created_at,
  };
}

const variantIdx = (v: string) => { const i = (VARIANTS as readonly string[]).indexOf(v); return i < 0 ? 99 : i; };

function previewFile(files: FileRow[]): FileRow | undefined {
  return files.filter((f) => IMAGE.has(f.content_type))
    .sort((a, b) => PREVIEW_ORDER.indexOf(a.variant) - PREVIEW_ORDER.indexOf(b.variant) || (a.created_at < b.created_at ? -1 : 1))[0];
}

function listView(row: ClientRow, files: FileRow[]) {
  const kit = parseKit(row.kit);
  const logo = previewFile(files);
  return {
    id: row.id, name: row.name, slack_channel: row.slack_channel,
    archived: !!row.archived,
    sector: kit.sector, owner: kit.owner || null,
    logoFileId: logo?.id || null, logoVariant: logo?.variant || null,
    fileCount: files.length, colorCount: kit.colors.length,
    incomplete: !kit.sector && kit.colors.length === 0 && files.length === 0,
    updatedAt: row.updated_at,
  };
}

const getClient = (c: C, id: string) => c.env.DB.prepare('SELECT * FROM clients WHERE id = ?').bind(id).first<ClientRow>();

async function detail(c: C, id: string) {
  const row = await getClient(c, id);
  if (!row) return null;
  const [files, ch] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM client_files WHERE client_id = ? ORDER BY created_at').bind(id).all<FileRow>(),
    c.env.DB.prepare("SELECT id, name, archived FROM channels WHERE client_id = ? AND kind = 'client' ORDER BY archived, created_at LIMIT 1").bind(id).first<{ id: string; name: string; archived: number }>(),
  ]);
  const fr = files.results || [];
  return {
    ...listView(row, fr),
    kit: parseKit(row.kit),
    files: fr.slice().sort((a, b) => variantIdx(a.variant) - variantIdx(b.variant) || (a.created_at < b.created_at ? -1 : 1)).map(fileView),
    channel: ch ? { id: ch.id, name: ch.name, archived: !!ch.archived } : null,
    createdAt: row.created_at,
  };
}

const canEdit = (c: C) => !!c.get('user').canEditClients;
const NO_EDIT = 'Müşteri kartını düzenleme yetkin yok. Yetkiyi yönetici verir.';

// ---------- doğrulama ----------
type Res<T> = { ok: true; v: T } | { ok: false; e: string };
const bad = (e: string): Res<never> => ({ ok: false, e });

function strList(v: unknown, label: string, maxItems: number, maxLen: number): Res<string[]> {
  if (!Array.isArray(v)) return bad(label + ' liste olmalı');
  if (v.length > maxItems) return bad(label + ' en fazla ' + maxItems + ' öğe olabilir');
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string') return bad(label + ' geçersiz');
    const s = x.trim().replace(/\s+/g, ' ');
    if (!s) continue;
    if (s.length > maxLen) return bad(label + ' en fazla ' + maxLen + ' karakter olabilir');
    if (!out.some((y) => trLower(y) === trLower(s))) out.push(s);
  }
  return { ok: true, v: out };
}

function normUrl(v: unknown): Res<string> {
  if (typeof v !== 'string') return bad('Bağlantı metin olmalı');
  let s = v.trim();
  if (!s) return { ok: true, v: '' };
  if (s.length > 500) return bad('Bağlantı en fazla 500 karakter olabilir');
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return bad('Bağlantı http(s) ile başlamalı');
    if (!u.hostname.includes('.')) return bad('Geçerli bir bağlantı yaz');
    return { ok: true, v: u.toString() };
  } catch { return bad('Geçerli bir bağlantı yaz'); }
}

async function applyPatch(c: C, kit: Kit, b: any): Promise<Res<string[]>> {
  const touched: string[] = [];
  if ('sector' in b) {
    if (typeof b.sector !== 'string' || b.sector.trim().length > 80) return bad('Sektör en fazla 80 karakter olabilir');
    kit.sector = b.sector.trim().replace(/\s+/g, ' '); touched.push('sector');
  }
  if ('owner' in b) {
    const o = b.owner === null ? '' : b.owner;
    if (typeof o !== 'string') return bad('Sorumlu geçersiz');
    if (o) {
      const u = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status != 'removed'").bind(o).first();
      if (!u) return bad('Sorumlu ekipte bulunamadı');
    }
    kit.owner = o; touched.push('owner');
  }
  if ('colors' in b) {
    if (!Array.isArray(b.colors) || b.colors.length > 30) return bad('Renkler en fazla 30 olabilir');
    const out: Kit['colors'] = [];
    for (const x of b.colors) {
      let hex = typeof x?.hex === 'string' ? x.hex.trim() : '';
      if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) hex = '#' + hex;
      if (/^#[0-9a-f]{3}$/i.test(hex)) hex = '#' + hex.slice(1).split('').map((ch: string) => ch + ch).join('');
      if (!/^#[0-9a-f]{6}$/i.test(hex)) return bad('Geçerli bir HEX kodu yaz, örn. #0E5E6F');
      const name = typeof x?.name === 'string' ? x.name.trim() : '';
      if (name.length > 40) return bad('Renk adı en fazla 40 karakter olabilir');
      out.push({ hex: hex.toUpperCase(), name });
    }
    kit.colors = out; touched.push('colors');
  }
  if ('fonts' in b) {
    if (!Array.isArray(b.fonts) || b.fonts.length > 12) return bad('Yazı tipleri en fazla 12 olabilir');
    const out: Kit['fonts'] = [];
    for (const x of b.fonts) {
      const name = typeof x?.name === 'string' ? x.name.trim() : '';
      if (!name || name.length > 60) return bad('Yazı tipi adı 1–60 karakter olmalı');
      let use = typeof x?.use === 'string' ? x.use : 'Başlık';
      if (use === 'Metin') use = 'Gövde';
      if (!FONT_USES.includes(use)) return bad('Kullanım Başlık, Gövde ya da Vurgu olmalı');
      out.push({ name, use });
    }
    kit.fonts = out; touched.push('fonts');
  }
  for (const [key, label] of [['tone', 'Ses tonu'], ['banned', 'Yasaklı ifadeler']] as const) {
    if (key in b) {
      const rr = strList(b[key], label, 40, 80);
      if (!rr.ok) return rr;
      kit[key] = rr.v; touched.push(key);
    }
  }
  if ('tagSets' in b) {
    if (!Array.isArray(b.tagSets) || b.tagSets.length > 20) return bad('Hashtag setleri en fazla 20 olabilir');
    const out: Kit['tagSets'] = [];
    for (const x of b.tagSets) {
      const name = (typeof x?.name === 'string' ? x.name.trim() : '') || 'Genel';
      const tags = Array.isArray(x?.tags) ? x.tags.join(' ') : typeof x?.tags === 'string' ? x.tags : '';
      const norm = tags.trim().split(/[\s,]+/).filter(Boolean).map((t: string) => (t.startsWith('#') ? t : '#' + t)).join(' ');
      if (!norm) return bad('Hashtag seti boş olamaz');
      if (name.length > 40) return bad('Set adı en fazla 40 karakter olabilir');
      if (norm.length > 1500) return bad('Bir hashtag seti en fazla 1500 karakter olabilir');
      out.push({ name, tags: norm });
    }
    kit.tagSets = out; touched.push('tagSets');
  }
  if ('links' in b) {
    if (!b.links || typeof b.links !== 'object' || Array.isArray(b.links)) return bad('Bağlantılar geçersiz');
    for (const key of Object.keys(b.links)) {
      if (!(LINK_KEYS as readonly string[]).includes(key)) return bad('Bilinmeyen bağlantı: ' + key);
      const u = normUrl(b.links[key]);
      if (!u.ok) return u;
      if (u.v) kit.links[key] = u.v; else delete kit.links[key];
    }
    touched.push('links');
  }
  return { ok: true, v: touched };
}

async function saveKit(c: C, id: string, kit: Kit): Promise<boolean> {
  const json = JSON.stringify(kit);
  if (json.length > MAX_KIT_JSON) return false;
  await c.env.DB.prepare("UPDATE clients SET kit = ?, updated_at = datetime('now') WHERE id = ?").bind(json, id).run();
  return true;
}

// ---------- liste ----------
// Şekil korunur: [{ id, name, slack_channel, … }] (İş Planı firma listesi bunu kullanır). Arşivliler hariç.
r.get('/', async (c) => {
  const withArchived = c.req.query('archived') === '1' && c.get('user').role === 'admin';
  const [rows, files] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM clients ${withArchived ? '' : 'WHERE archived = 0'}`).all<ClientRow>(),
    c.env.DB.prepare('SELECT * FROM client_files').all<FileRow>(),
  ]);
  const byClient = new Map<string, FileRow[]>();
  for (const f of files.results || []) { const a = byClient.get(f.client_id) || []; a.push(f); byClient.set(f.client_id, a); }
  const list = (rows.results || []).map((row) => listView(row, byClient.get(row.id) || []));
  list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  return c.json(list);
});

r.get('/:id', async (c) => {
  const d = await detail(c, c.req.param('id'));
  if (!d) return err(c, 'Müşteri bulunamadı', 404);
  return c.json(d);
});

// ---------- ekle / kaldır (yönetici) ----------
r.post('/', requireAdmin, async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const name = clean(b.name, 200).replace(/\s+/g, ' ');
  if (!name) return err(c, 'Firma adı boş olamaz');
  if (name.length > 80) return err(c, 'Firma adı en fazla 80 karakter olabilir');
  const db = c.env.DB;
  const all = (await db.prepare('SELECT * FROM clients').all<ClientRow>()).results || [];
  const same = all.find((x) => trLower(x.name) === trLower(name));
  if (same && !same.archived) return c.json({ error: 'Bu müşteri zaten var', id: same.id }, 409);
  if (same) {
    // arşivdeki müşteriyi geri getir, kanalını da aç
    const ch = await db.prepare("SELECT id FROM channels WHERE client_id = ? AND kind = 'client'").bind(same.id).first<{ id: string }>();
    await db.batch([
      db.prepare("UPDATE clients SET archived = 0, updated_at = datetime('now') WHERE id = ?").bind(same.id),
      ch ? db.prepare("UPDATE channels SET archived = 0 WHERE client_id = ? AND kind = 'client'").bind(same.id)
        : db.prepare("INSERT INTO channels (id, name, kind, topic, client_id) VALUES (?, ?, 'client', ?, ?)").bind('ch_' + same.id, same.slack_channel || slug(same.name), same.name, same.id),
    ]);
    live(c, { id: same.id, action: 'restored', channelId: ch?.id || 'ch_' + same.id });
    return c.json({ ...(await detail(c, same.id)), reactivated: true });
  }
  const id = newId('c');
  const channel = slug(name);
  await db.batch([
    db.prepare("INSERT INTO clients (id, name, slack_channel, kit, updated_at) VALUES (?, ?, ?, '{}', datetime('now'))").bind(id, name, channel),
    db.prepare("INSERT INTO channels (id, name, kind, topic, client_id) VALUES (?, ?, 'client', ?, ?)").bind('ch_' + id, channel, name, id),
  ]);
  live(c, { id, action: 'added', channelId: 'ch_' + id });
  return c.json(await detail(c, id), 201);
});

r.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');
  const row = await getClient(c, id);
  if (!row) return err(c, 'Müşteri bulunamadı', 404);
  const db = c.env.DB;
  await db.batch([
    db.prepare("UPDATE clients SET archived = 1, updated_at = datetime('now') WHERE id = ?").bind(id),
    db.prepare("UPDATE channels SET archived = 1 WHERE client_id = ? AND kind = 'client'").bind(id),
  ]);
  live(c, { id, action: 'archived' });
  return c.json({ ok: true });
});

// ---------- marka kiti (düzenleme yetkisi) ----------
r.patch('/:id', async (c) => {
  if (!canEdit(c)) return err(c, NO_EDIT, 403);
  const id = c.req.param('id');
  const row = await getClient(c, id);
  if (!row || row.archived) return err(c, 'Müşteri bulunamadı', 404);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return err(c, 'Geçersiz istek');
  const kit = parseKit(row.kit);
  const rr = await applyPatch(c, kit, b);
  if (!rr.ok) return err(c, rr.e);
  if (!rr.v.length) return err(c, 'Değişiklik yok');
  if (!(await saveKit(c, id, kit))) return err(c, 'Marka kiti çok büyük', 413);
  live(c, { id, action: 'kit', fields: rr.v });
  return c.json(await detail(c, id));
});

r.post('/:id/notes', async (c) => {
  if (!canEdit(c)) return err(c, NO_EDIT, 403);
  const id = c.req.param('id');
  const row = await getClient(c, id);
  if (!row || row.archived) return err(c, 'Müşteri bulunamadı', 404);
  const b = await c.req.json().catch(() => ({}));
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return err(c, 'Not boş olamaz');
  if (text.length > 2000) return err(c, 'Not en fazla 2000 karakter olabilir');
  const kit = parseKit(row.kit);
  if (kit.notes.length >= 200) return err(c, 'En fazla 200 not eklenebilir');
  kit.notes.unshift({ id: newId('cn'), text, by: c.get('user').id, at: new Date().toISOString() });
  if (!(await saveKit(c, id, kit))) return err(c, 'Marka kiti çok büyük', 413);
  live(c, { id, action: 'kit', fields: ['notes'] });
  return c.json(await detail(c, id), 201);
});

r.delete('/:id/notes/:nid', async (c) => {
  if (!canEdit(c)) return err(c, NO_EDIT, 403);
  const id = c.req.param('id');
  const row = await getClient(c, id);
  if (!row) return err(c, 'Müşteri bulunamadı', 404);
  const kit = parseKit(row.kit);
  const before = kit.notes.length;
  kit.notes = kit.notes.filter((n) => n.id !== c.req.param('nid'));
  if (kit.notes.length === before) return err(c, 'Not bulunamadı', 404);
  await saveKit(c, id, kit);
  live(c, { id, action: 'kit', fields: ['notes'] });
  return c.json(await detail(c, id));
});

// ---------- dosyalar (R2) ----------
r.post('/:id/files', async (c) => {
  if (!canEdit(c)) return err(c, NO_EDIT, 403);
  const id = c.req.param('id');
  const row = await getClient(c, id);
  if (!row || row.archived) return err(c, 'Müşteri bulunamadı', 404);
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > MAX_FILE + 64 * 1024) return err(c, 'Dosya en fazla 25 MB olabilir', 413);
  let body: Record<string, unknown>;
  try { body = await c.req.parseBody(); } catch { return err(c, 'Dosya okunamadı'); }
  const file = body.file;
  if (!(file instanceof File)) return err(c, 'Dosya seçilmedi');
  const variant = typeof body.variant === 'string' && body.variant ? body.variant : 'Diğer';
  if (!(VARIANTS as readonly string[]).includes(variant)) return err(c, 'Logo türü geçersiz');
  const orig = (file.name || 'dosya').replace(/[\u0000-\u001f\u007f"\\/<>:|?*]/g, '').trim().slice(-150) || 'dosya';
  const ext = (orig.includes('.') ? orig.split('.').pop()! : '').toLowerCase();
  const type = TYPES[ext];
  if (!type) return err(c, 'Bu dosya türü yüklenemez. İzinli: PNG, JPG, WEBP, SVG, PDF, AI, EPS, ZIP', 415);
  if (file.size === 0) return err(c, 'Dosya boş');
  if (file.size > MAX_FILE) return err(c, 'Dosya en fazla 25 MB olabilir', 413);
  const count = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM client_files WHERE client_id = ?').bind(id).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_FILES_PER_CLIENT) return err(c, 'Bu müşteriye en fazla ' + MAX_FILES_PER_CLIENT + ' dosya yüklenebilir');
  const fid = newId('cf');
  const key = `clients/${id}/${fid}/${safeFileName(orig)}`;
  await c.env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: type } });
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO client_files (id, client_id, variant, name, r2_key, content_type, size, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(fid, id, variant, orig, key, type, file.size, c.get('user').id),
    c.env.DB.prepare("UPDATE clients SET updated_at = datetime('now') WHERE id = ?").bind(id),
  ]);
  live(c, { id, action: 'files' });
  const f = await c.env.DB.prepare('SELECT * FROM client_files WHERE id = ?').bind(fid).first<FileRow>();
  return c.json(fileView(f!), 201);
});

// Önizleme (görseller satır içi) ve indirme (?download=1 → orijinal adla ek olarak). Giriş yapmış herkes.
r.get('/:id/files/:fid', async (c) => {
  const f = await c.env.DB.prepare('SELECT * FROM client_files WHERE id = ? AND client_id = ?').bind(c.req.param('fid'), c.req.param('id')).first<FileRow>();
  if (!f) return err(c, 'Dosya bulunamadı', 404);
  const obj = await c.env.FILES.get(f.r2_key);
  if (!obj) return err(c, 'Dosya bulunamadı', 404);
  const download = c.req.query('download') === '1' || !IMAGE.has(f.content_type);
  const h = new Headers({
    'Content-Type': f.content_type,
    'Content-Length': String(obj.size),
    'X-Content-Type-Options': 'nosniff',
    // SVG vb. doğrudan açılırsa betik çalışmasın (indirmede sandbox yok: Chrome sandbox'lı yanıtta indirmeyi engeller)
    'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'" + (download ? '' : '; sandbox'),
    'Cache-Control': 'private, max-age=3600',
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeFileName(f.name)}"; filename*=UTF-8''${encodeURIComponent(f.name)}`,
  });
  if (obj.httpEtag) h.set('ETag', obj.httpEtag);
  return new Response(obj.body, { headers: h });
});

r.delete('/:id/files/:fid', async (c) => {
  if (!canEdit(c)) return err(c, NO_EDIT, 403);
  const id = c.req.param('id');
  const f = await c.env.DB.prepare('SELECT * FROM client_files WHERE id = ? AND client_id = ?').bind(c.req.param('fid'), id).first<FileRow>();
  if (!f) return err(c, 'Dosya bulunamadı', 404);
  await c.env.FILES.delete(f.r2_key);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM client_files WHERE id = ?').bind(f.id),
    c.env.DB.prepare("UPDATE clients SET updated_at = datetime('now') WHERE id = ?").bind(id),
  ]);
  live(c, { id, action: 'files' });
  return c.json({ ok: true });
});
