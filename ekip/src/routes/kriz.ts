// Kriz anı kayıtları: olumsuz yorum, şikâyet, yanlış paylaşım… hızlı kayıt, ekibe haber, çözüm takibi.
// Yetki: kaydı açmak, adım notu eklemek, durumu değiştirmek ve ekran görüntüsü eklemek → ekipteki herkes.
//        Bilgileri (başlık, öncelik, sorumlu…) düzenlemek → kaydı açan, sorumlu ya da yönetici.
//        Kaydı silmek → kaydı açan ya da yönetici. Ekran görüntüsünü silmek → ekleyen ya da yönetici.
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Vars } from '../types';
import { changed, notify } from '../notify';
import { clean, newId } from '../util';

type C = Context<{ Bindings: Env; Variables: Vars }>;
export const r = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- sabitler ----------
export const SOURCES: Record<string, string> = {
  instagram: 'Instagram yorumu', google: 'Google yorumu', dm: 'DM / mesaj', telefon: 'Telefon / e-posta', paylasim: 'Yanlış paylaşım', diger: 'Diğer',
};
export const PRIORITIES: Record<string, { label: string; emoji: string; rank: number }> = {
  acil: { label: 'Acil', emoji: '🚨', rank: 4 }, yuksek: { label: 'Yüksek', emoji: '🔴', rank: 3 },
  orta: { label: 'Orta', emoji: '🟠', rank: 2 }, dusuk: { label: 'Düşük', emoji: '🟢', rank: 1 },
};
export const STATUSES: Record<string, string> = { acik: 'Açık', mudahale: 'Müdahale ediliyor', cozuldu: 'Çözüldü' };
const MAX_SHOT = 8 * 1024 * 1024;
const MAX_SHOTS = 12;
const SHOT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

interface CrisisRow {
  id: string; client: string; title: string; source: string; link: string; description: string; priority: string; status: string;
  owner_id: string | null; resolution: string; created_by: string; created_at: string; updated_at: string; resolved_at: string | null; resolved_by: string | null;
}
interface EventRow { id: string; crisis_id: string; user_id: string | null; kind: string; text: string; created_at: string }
interface FileRow { id: string; crisis_id: string; name: string; r2_key: string; content_type: string; size: number; created_by: string | null; created_at: string }

// ---------- ortak yardımcılar (ilham.ts de kullanır) ----------
const err = (c: C, msg: string, code: 400 | 403 | 404 | 409 | 413 | 415 = 400) => c.json({ error: msg }, code);

/** İlk baytlardan görsel türü; tarayıcının söylediğine güvenilmez. */
export function sniffImage(b: Uint8Array): string | null {
  const s = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  if (b.length >= 8 && b[0] === 0x89 && s(1, 3) === 'PNG') return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && (s(0, 6) === 'GIF87a' || s(0, 6) === 'GIF89a')) return 'image/gif';
  if (b.length >= 12 && s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return 'image/webp';
  return null;
}
export const IMG_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };

/** http(s) bağlantısını doğrular; boşsa ''. Şemasız yazılana https:// eklenir. */
export function normLink(v: unknown): { ok: true; v: string } | { ok: false; e: string } {
  if (v === undefined || v === null) return { ok: true, v: '' };
  if (typeof v !== 'string') return { ok: false, e: 'Bağlantı metin olmalı' };
  let s = v.trim();
  if (!s) return { ok: true, v: '' };
  if (s.length > 800) return { ok: false, e: 'Bağlantı en fazla 800 karakter olabilir' };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, e: 'Bağlantı http:// ya da https:// ile başlamalı' };
    if (!u.hostname.includes('.')) return { ok: false, e: 'Geçerli bir bağlantı yaz' };
    return { ok: true, v: u.toString() };
  } catch { return { ok: false, e: 'Geçerli bir bağlantı yaz' }; }
}

/** Ad ile müşteri bulur (büyük/küçük harf duyarsız); işlerdeki gibi müşteri ADI saklanır. */
export async function findClient(env: Env, name: unknown, allowArchived = false): Promise<string | null> {
  const n = clean(name, 120);
  if (!n) return null;
  const row = await env.DB.prepare(`SELECT name FROM clients WHERE name = ? COLLATE NOCASE ${allowArchived ? '' : 'AND archived = 0'}`).bind(n).first<{ name: string }>();
  return row?.name ?? null;
}

/** Görseli giriş yapmış ekibe sunar (önizleme satır içi; ?download → ek). */
export function serveImage(obj: R2ObjectBody, type: string, name: string, download: boolean) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const h = new Headers({
    'Content-Type': type,
    'Content-Length': String(obj.size),
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'" + (download ? '' : '; sandbox'),
    'Cache-Control': 'private, max-age=86400',
  });
  if (obj.httpEtag) h.set('ETag', obj.httpEtag);
  return new Response(obj.body, { headers: h });
}

const live = (c: C, extra: Record<string, unknown>) => changed(c.env, 'kriz', c.executionCtx.waitUntil.bind(c.executionCtx), extra);
const wu = (c: C) => c.executionCtx.waitUntil.bind(c.executionCtx);
const isAdmin = (c: C) => c.get('user').role === 'admin';
const canEdit = (c: C, k: CrisisRow) => isAdmin(c) || k.created_by === c.get('user').id || k.owner_id === c.get('user').id;
const NO_EDIT = 'Bu kaydın bilgilerini yalnızca kaydı açan, sorumlusu ya da yönetici değiştirebilir';

function fileView(f: FileRow) {
  return { id: f.id, name: f.name, contentType: f.content_type, size: f.size, createdBy: f.created_by, createdAt: f.created_at, url: `/api/krizler/${f.crisis_id}/files/${f.id}` };
}
function view(k: CrisisRow, files: FileRow[] = [], events?: EventRow[]) {
  return {
    id: k.id, client: k.client, title: k.title, source: k.source, link: k.link, description: k.description,
    priority: k.priority, status: k.status, ownerId: k.owner_id, resolution: k.resolution,
    createdBy: k.created_by, createdAt: k.created_at, updatedAt: k.updated_at, resolvedAt: k.resolved_at, resolvedBy: k.resolved_by,
    files: files.map(fileView),
    ...(events ? { events: events.map((e) => ({ id: e.id, userId: e.user_id, kind: e.kind, text: e.text, createdAt: e.created_at })) } : {}),
  };
}

const getRow = (c: C, id: string) => c.env.DB.prepare('SELECT * FROM crises WHERE id = ?').bind(id).first<CrisisRow>();
async function detail(c: C, id: string) {
  const k = await getRow(c, id);
  if (!k) return null;
  const [f, e] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM crisis_files WHERE crisis_id = ? ORDER BY created_at').bind(id).all<FileRow>(),
    c.env.DB.prepare('SELECT * FROM crisis_events WHERE crisis_id = ? ORDER BY created_at, rowid').bind(id).all<EventRow>(),
  ]);
  return view(k, f.results || [], e.results || []);
}
const event = (c: C, crisisId: string, kind: string, text = '') =>
  c.env.DB.prepare('INSERT INTO crisis_events (id, crisis_id, user_id, kind, text) VALUES (?, ?, ?, ?, ?)').bind(newId('ke'), crisisId, c.get('user').id, kind, text);
const touch = (c: C, id: string) => c.env.DB.prepare("UPDATE crises SET updated_at = datetime('now') WHERE id = ?").bind(id);

async function activeUser(c: C, id: unknown): Promise<string | null> {
  if (typeof id !== 'string' || !id) return null;
  const u = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").bind(id).first<{ id: string }>();
  return u?.id ?? null;
}
const firstName = async (c: C, id: string | null) => id ? (await c.env.DB.prepare('SELECT first_name FROM users WHERE id = ?').bind(id).first<{ first_name: string }>())?.first_name || '' : '';

// ---------- bildirimler ----------
/** Kime gider: Acil/Yüksek → bütün aktif ekip; Orta/Düşük → sorumlu + yönetici(ler). (notify kaydı açana göndermez.) */
export function recipients(priority: string, ownerId: string | null, active: { id: string; role: string }[]): string[] {
  if (priority === 'acil' || priority === 'yuksek') return active.map((u) => u.id);
  const set = new Set<string>(active.filter((u) => u.role === 'admin').map((u) => u.id));
  if (ownerId && active.some((u) => u.id === ownerId)) set.add(ownerId);
  return [...set];
}
async function notifyNew(c: C, k: CrisisRow) {
  const { results } = await c.env.DB.prepare("SELECT id, role FROM users WHERE status = 'active'").all<{ id: string; role: string }>();
  const p = PRIORITIES[k.priority];
  const owner = await firstName(c, k.owner_id);
  const to = recipients(k.priority, k.owner_id, results || []);
  await Promise.all(to.map((uid) => notify(c.env, {
    userId: uid, kind: 'kriz', actorId: c.get('user').id, link: '/krizler?id=' + k.id,
    title: `${p.emoji} ${p.label} kriz · ${k.client}`,
    body: k.title,
    meta: [SOURCES[k.source], owner ? 'Sorumlu: ' + owner : ''].filter(Boolean).join(' · '),
  }, wu(c))));
}
async function notifyStatus(c: C, k: CrisisRow, status: string, note: string) {
  const p = PRIORITIES[k.priority];
  const who = new Set([k.owner_id, k.created_by].filter(Boolean) as string[]);
  const emoji = status === 'cozuldu' ? '✅' : status === 'mudahale' ? '🛠️' : p.emoji;
  const label = status === 'cozuldu' ? 'Kriz çözüldü' : status === 'mudahale' ? 'Krize müdahale ediliyor' : 'Kriz yeniden açıldı';
  await Promise.all([...who].map((uid) => notify(c.env, {
    userId: uid, kind: 'kriz', actorId: c.get('user').id, link: '/krizler?id=' + k.id,
    title: `${emoji} ${label} · ${k.client}`,
    body: k.title + (note ? ' — ' + note.slice(0, 140) : ''),
    meta: c.get('user').firstName + ' · ' + STATUSES[status],
  }, wu(c))));
}

// ---------- liste ----------
// ?client=<ad> o müşterinin kayıtları; ?status=open yalnızca çözülmemiş olanlar
r.get('/', async (c) => {
  const client = clean(c.req.query('client'), 120);
  const onlyOpen = c.req.query('status') === 'open';
  const where: string[] = []; const vals: unknown[] = [];
  if (client) { where.push('client = ? COLLATE NOCASE'); vals.push(client); }
  if (onlyOpen) where.push("status != 'cozuldu'");
  const [rows, files] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM crises ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 1000`).bind(...vals).all<CrisisRow>(),
    c.env.DB.prepare('SELECT * FROM crisis_files ORDER BY created_at').all<FileRow>(),
  ]);
  const by = new Map<string, FileRow[]>();
  for (const f of files.results || []) { const a = by.get(f.crisis_id) || []; a.push(f); by.set(f.crisis_id, a); }
  return c.json((rows.results || []).map((k) => view(k, by.get(k.id) || [])));
});

// Müşteriler sayfası rozeti: çözülmemiş kriz sayısı ve en yüksek öncelik, müşteri adına göre
r.get('/acik', async (c) => {
  const { results } = await c.env.DB.prepare("SELECT client, priority, COUNT(*) AS n FROM crises WHERE status != 'cozuldu' GROUP BY client, priority").all<{ client: string; priority: string; n: number }>();
  const out: Record<string, { count: number; priority: string }> = {};
  for (const x of results || []) {
    const o = out[x.client] || { count: 0, priority: 'dusuk' };
    o.count += x.n;
    if (PRIORITIES[x.priority].rank > PRIORITIES[o.priority].rank) o.priority = x.priority;
    out[x.client] = o;
  }
  return c.json(out);
});

r.get('/:id', async (c) => {
  const d = await detail(c, c.req.param('id'));
  if (!d) return err(c, 'Kriz kaydı bulunamadı', 404);
  return c.json(d);
});

// ---------- yeni kayıt ----------
r.post('/', async (c) => {
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return err(c, 'Geçersiz istek');
  const client = await findClient(c.env, b.client);
  if (!client) return err(c, clean(b.client, 120) ? 'Müşteri bulunamadı' : 'Müşteri seç');
  const title = clean(b.title, 400).replace(/\s+/g, ' ');
  if (!title) return err(c, 'Kısa bir başlık yaz');
  if (title.length > 140) return err(c, 'Başlık en fazla 140 karakter olabilir');
  const source = b.source ?? 'diger';
  if (typeof source !== 'string' || !SOURCES[source]) return err(c, 'Kaynak geçersiz');
  const priority = b.priority ?? 'orta';
  if (typeof priority !== 'string' || !PRIORITIES[priority]) return err(c, 'Öncelik Düşük, Orta, Yüksek ya da Acil olmalı');
  const link = normLink(b.link);
  if (!link.ok) return err(c, link.e);
  const description = typeof b.description === 'string' ? b.description.trim() : '';
  if (description.length > 4000) return err(c, 'Açıklama en fazla 4000 karakter olabilir');
  let owner: string | null = null;
  if (b.ownerId) { owner = await activeUser(c, b.ownerId); if (!owner) return err(c, 'Sorumlu ekipte bulunamadı'); }
  const id = newId('k');
  const uid = c.get('user').id;
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO crises (id, client, title, source, link, description, priority, owner_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, client, title, source, link.v, description, priority, owner, uid),
    event(c, id, 'created', ''),
  ]);
  const row = (await getRow(c, id))!;
  await notifyNew(c, row);
  live(c, { id, client, action: 'added' });
  return c.json(await detail(c, id), 201);
});

// ---------- bilgileri düzenle ----------
r.patch('/:id', async (c) => {
  const k = await getRow(c, c.req.param('id'));
  if (!k) return err(c, 'Kriz kaydı bulunamadı', 404);
  if (!canEdit(c, k)) return err(c, NO_EDIT, 403);
  const b = await c.req.json().catch(() => null);
  if (!b || typeof b !== 'object' || Array.isArray(b)) return err(c, 'Geçersiz istek');
  const sets: string[] = []; const vals: unknown[] = []; const evs: D1PreparedStatement[] = [];
  const fields: string[] = [];
  if ('title' in b) {
    const t = clean(b.title, 400).replace(/\s+/g, ' ');
    if (!t) return err(c, 'Başlık boş olamaz');
    if (t.length > 140) return err(c, 'Başlık en fazla 140 karakter olabilir');
    if (t !== k.title) { sets.push('title = ?'); vals.push(t); fields.push('başlık'); }
  }
  if ('client' in b) {
    const cl = await findClient(c.env, b.client);
    if (!cl) return err(c, 'Müşteri bulunamadı');
    if (cl !== k.client) { sets.push('client = ?'); vals.push(cl); fields.push('müşteri'); }
  }
  if ('source' in b) {
    if (typeof b.source !== 'string' || !SOURCES[b.source]) return err(c, 'Kaynak geçersiz');
    if (b.source !== k.source) { sets.push('source = ?'); vals.push(b.source); fields.push('kaynak'); }
  }
  if ('link' in b) {
    const l = normLink(b.link); if (!l.ok) return err(c, l.e);
    if (l.v !== k.link) { sets.push('link = ?'); vals.push(l.v); fields.push('bağlantı'); }
  }
  if ('description' in b) {
    const d = typeof b.description === 'string' ? b.description.trim() : '';
    if (d.length > 4000) return err(c, 'Açıklama en fazla 4000 karakter olabilir');
    if (d !== k.description) { sets.push('description = ?'); vals.push(d); fields.push('açıklama'); }
  }
  let newPriority: string | null = null;
  if ('priority' in b) {
    if (typeof b.priority !== 'string' || !PRIORITIES[b.priority]) return err(c, 'Öncelik Düşük, Orta, Yüksek ya da Acil olmalı');
    if (b.priority !== k.priority) { sets.push('priority = ?'); vals.push(b.priority); newPriority = b.priority; evs.push(event(c, k.id, 'priority', PRIORITIES[b.priority].label)); }
  }
  let newOwner: string | null = null;
  if ('ownerId' in b) {
    const o = b.ownerId ? await activeUser(c, b.ownerId) : null;
    if (b.ownerId && !o) return err(c, 'Sorumlu ekipte bulunamadı');
    if (o !== k.owner_id) { sets.push('owner_id = ?'); vals.push(o); newOwner = o; evs.push(event(c, k.id, 'owner', o ? await firstName(c, o) : '')); }
  }
  if (!sets.length) return c.json(await detail(c, k.id));
  if (fields.length) evs.push(event(c, k.id, 'edit', fields.join(', ')));
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE crises SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(...vals, k.id),
    ...evs,
  ]);
  const row = (await getRow(c, k.id))!;
  if (newOwner) {
    const p = PRIORITIES[row.priority];
    await notify(c.env, { userId: newOwner, kind: 'kriz', actorId: c.get('user').id, link: '/krizler?id=' + row.id, title: `${p.emoji} Krizin sorumlusu sensin · ${row.client}`, body: row.title, meta: c.get('user').firstName + ' atadı' }, wu(c));
  }
  // öncelik Yüksek/Acil'e çıktıysa bütün ekip duysun
  if (newPriority && row.status !== 'cozuldu' && PRIORITIES[newPriority].rank >= 3 && PRIORITIES[k.priority].rank < 3) await notifyNew(c, row);
  live(c, { id: row.id, client: row.client, action: 'edit' });
  return c.json(await detail(c, row.id));
});

// ---------- durum: Açık → Müdahale ediliyor → Çözüldü (çözüm notu zorunlu) ----------
r.post('/:id/status', async (c) => {
  const k = await getRow(c, c.req.param('id'));
  if (!k) return err(c, 'Kriz kaydı bulunamadı', 404);
  const b = await c.req.json().catch(() => ({}));
  const status = b.status;
  if (typeof status !== 'string' || !STATUSES[status]) return err(c, 'Durum geçersiz');
  if (status === k.status) return err(c, 'Kayıt zaten bu durumda: ' + STATUSES[status], 409);
  const note = typeof b.note === 'string' ? b.note.trim() : '';
  if (note.length > 2000) return err(c, 'Not en fazla 2000 karakter olabilir');
  if (status === 'cozuldu' && !note) return err(c, 'Çözüldü demeden önce kısa bir çözüm notu yaz');
  const uid = c.get('user').id;
  const upd = status === 'cozuldu'
    ? c.env.DB.prepare("UPDATE crises SET status = ?, resolution = ?, resolved_at = datetime('now'), resolved_by = ?, updated_at = datetime('now') WHERE id = ?").bind(status, note, uid, k.id)
    : c.env.DB.prepare("UPDATE crises SET status = ?, resolved_at = NULL, resolved_by = NULL, updated_at = datetime('now') WHERE id = ?").bind(status, k.id);
  await c.env.DB.batch([upd, event(c, k.id, 'status', status + (note ? '\n' + note : ''))]);
  await notifyStatus(c, k, status, note);
  live(c, { id: k.id, client: k.client, action: 'status', status });
  return c.json(await detail(c, k.id));
});

// ---------- adım notu ----------
r.post('/:id/notes', async (c) => {
  const k = await getRow(c, c.req.param('id'));
  if (!k) return err(c, 'Kriz kaydı bulunamadı', 404);
  const b = await c.req.json().catch(() => ({}));
  const text = typeof b.text === 'string' ? b.text.trim() : '';
  if (!text) return err(c, 'Not boş olamaz');
  if (text.length > 2000) return err(c, 'Not en fazla 2000 karakter olabilir');
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM crisis_events WHERE crisis_id = ?').bind(k.id).first<{ n: number }>();
  if ((n?.n || 0) >= 500) return err(c, 'Bu kayda en fazla 500 adım eklenebilir');
  await c.env.DB.batch([event(c, k.id, 'note', text), touch(c, k.id)]);
  live(c, { id: k.id, client: k.client, action: 'note' });
  return c.json(await detail(c, k.id), 201);
});

// ---------- sil ----------
r.delete('/:id', async (c) => {
  const k = await getRow(c, c.req.param('id'));
  if (!k) return err(c, 'Kriz kaydı bulunamadı', 404);
  if (!isAdmin(c) && k.created_by !== c.get('user').id) return err(c, 'Kaydı yalnızca açan kişi ya da yönetici silebilir', 403);
  const { results } = await c.env.DB.prepare('SELECT r2_key FROM crisis_files WHERE crisis_id = ?').bind(k.id).all<{ r2_key: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM crisis_files WHERE crisis_id = ?').bind(k.id),
    c.env.DB.prepare('DELETE FROM crisis_events WHERE crisis_id = ?').bind(k.id),
    c.env.DB.prepare("DELETE FROM notifications WHERE kind = 'kriz' AND link = ?").bind('/krizler?id=' + k.id),
    c.env.DB.prepare('DELETE FROM crises WHERE id = ?').bind(k.id),
  ]);
  if (results?.length) c.executionCtx.waitUntil(c.env.FILES.delete(results.map((x) => x.r2_key)).catch(() => {}));
  live(c, { id: k.id, client: k.client, action: 'deleted' });
  return c.json({ ok: true });
});

// ---------- ekran görüntüleri (R2) ----------
r.post('/:id/files', async (c) => {
  const k = await getRow(c, c.req.param('id'));
  if (!k) return err(c, 'Kriz kaydı bulunamadı', 404);
  const len = Number(c.req.header('Content-Length') || 0);
  if (len > MAX_SHOT + 64 * 1024) return err(c, 'Ekran görüntüsü en fazla 8 MB olabilir', 413);
  let form: FormData;
  try { form = await c.req.formData(); } catch { return err(c, 'Dosya okunamadı'); }
  const f = form.get('file');
  if (!f || typeof f === 'string') return err(c, 'Dosya seçilmedi');
  const file = f as File;
  if (file.size === 0) return err(c, 'Dosya boş');
  if (file.size > MAX_SHOT) return err(c, 'Ekran görüntüsü en fazla 8 MB olabilir', 413);
  const buf = new Uint8Array(await file.arrayBuffer());
  const type = sniffImage(buf);
  if (!type || !SHOT_TYPES.has(type)) return err(c, 'Yalnızca PNG, JPG ya da WEBP görsel yüklenebilir', 415);
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM crisis_files WHERE crisis_id = ?').bind(k.id).first<{ n: number }>();
  if ((n?.n || 0) >= MAX_SHOTS) return err(c, 'Bir kayda en fazla ' + MAX_SHOTS + ' ekran görüntüsü eklenebilir');
  let name = (file.name || '').replace(/[\u0000-\u001f\u007f/\\"]/g, '').trim().slice(0, 150);
  if (!name || /^image\.(png|jpe?g|webp)$/i.test(name)) {
    const t = new Date(Date.now() + 3 * 3600_000).toISOString();
    name = `Ekran görüntüsü ${t.slice(0, 10)} ${t.slice(11, 16).replace(':', '.')}.${IMG_EXT[type]}`;
  }
  const fid = newId('kf');
  const key = `krizler/${k.id}/${fid}.${IMG_EXT[type]}`;
  await c.env.FILES.put(key, buf, { httpMetadata: { contentType: type } });
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO crisis_files (id, crisis_id, name, r2_key, content_type, size, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(fid, k.id, name, key, type, file.size, c.get('user').id),
    event(c, k.id, 'file', name),
    touch(c, k.id),
  ]);
  live(c, { id: k.id, client: k.client, action: 'file' });
  const row = await c.env.DB.prepare('SELECT * FROM crisis_files WHERE id = ?').bind(fid).first<FileRow>();
  return c.json(fileView(row!), 201);
});

r.get('/:id/files/:fid', async (c) => {
  const f = await c.env.DB.prepare('SELECT * FROM crisis_files WHERE id = ? AND crisis_id = ?').bind(c.req.param('fid'), c.req.param('id')).first<FileRow>();
  if (!f) return err(c, 'Dosya bulunamadı', 404);
  const obj = await c.env.FILES.get(f.r2_key);
  if (!obj) return err(c, 'Dosya bulunamadı', 404);
  return serveImage(obj, f.content_type, f.name, c.req.query('download') !== undefined);
});

r.delete('/:id/files/:fid', async (c) => {
  const f = await c.env.DB.prepare('SELECT * FROM crisis_files WHERE id = ? AND crisis_id = ?').bind(c.req.param('fid'), c.req.param('id')).first<FileRow>();
  if (!f) return err(c, 'Dosya bulunamadı', 404);
  if (!isAdmin(c) && f.created_by !== c.get('user').id) return err(c, 'Ekran görüntüsünü yalnızca ekleyen ya da yönetici silebilir', 403);
  const k = (await getRow(c, f.crisis_id))!;
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM crisis_files WHERE id = ?').bind(f.id), touch(c, k.id)]);
  c.executionCtx.waitUntil(c.env.FILES.delete(f.r2_key).catch(() => {}));
  live(c, { id: k.id, client: k.client, action: 'file' });
  return c.json({ ok: true });
});
