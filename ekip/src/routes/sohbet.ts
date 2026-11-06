// Sohbet: kanallar, birebir mesajlar, dosyalar (R2)
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, SessionUser, Vars } from '../types';
import { broadcast } from '../hub';
import { newId } from '../util';

export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
type C = Context<{ Bindings: Env; Variables: Vars }>;

const MAX_TEXT = 4000;
const MAX_FILE = 25 * 1024 * 1024;
const PAGE = 50;
// Tarayıcıda satır içi gösterilebilecek (betik çalıştıramayan) görseller; SVG/HTML hep indirilir
const INLINE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

interface ChannelRow {
  id: string; name: string; kind: 'general' | 'client' | 'dm'; topic: string; client_id: string | null;
  dm_key: string | null; archived: number; created_at: string;
}
interface MessageRow {
  id: string; channel_id: string; user_id: string; text: string;
  file_key: string | null; file_name: string | null; file_type: string | null; file_size: number | null;
  created_at: string; edited_at: string | null; deleted: number;
}

/** SQLite zamanı ('YYYY-MM-DD HH:MM:SS.SSS', UTC) → ISO */
const iso = (s: string | null) => (s ? (s.includes('T') ? s : s.replace(' ', 'T')) + (/[zZ]$|[+-]\d\d:?\d\d$/.test(s) ? '' : 'Z') : null);
const nowSql = "strftime('%Y-%m-%d %H:%M:%f', 'now')";

const dmMembers = (ch: Pick<ChannelRow, 'dm_key'>): string[] => (ch.dm_key || '').split('|').filter(Boolean);
const canAccess = (u: SessionUser, ch: ChannelRow) => ch.kind !== 'dm' || dmMembers(ch).includes(u.id);

function messageView(m: MessageRow) {
  const deleted = !!m.deleted;
  return {
    id: m.id, channelId: m.channel_id, userId: m.user_id,
    text: deleted ? '' : m.text,
    file: !deleted && m.file_key ? { name: m.file_name || 'dosya', type: m.file_type || 'application/octet-stream', size: m.file_size || 0, url: '/api/chat/files/' + m.id } : null,
    createdAt: iso(m.created_at), editedAt: iso(m.edited_at), deleted,
  };
}

function channelView(ch: ChannelRow & { unread?: number; mentions?: number; last_at?: string | null }, me: string) {
  return {
    id: ch.id, name: ch.name, kind: ch.kind, topic: ch.topic, clientId: ch.client_id,
    dmWith: ch.kind === 'dm' ? (dmMembers(ch).find((x) => x !== me) ?? me) : null,
    unread: ch.unread ?? 0, mentions: ch.mentions ?? 0, lastAt: iso(ch.last_at ?? null),
  };
}

/** Kanalı bulur ve erişimi denetler; hata durumunda Response döner. */
async function channelFor(c: C, id: string): Promise<ChannelRow | Response> {
  const ch = await c.env.DB.prepare('SELECT * FROM channels WHERE id = ?').bind(id).first<ChannelRow>();
  if (!ch) return c.json({ error: 'Kanal bulunamadı' }, 404);
  if (!canAccess(c.get('user'), ch)) return c.json({ error: 'Bu konuşmayı göremezsin' }, 403);
  return ch;
}

/** Yeni/düzenlenen/silinen mesajı yayınla: DM'de yalnızca iki kişiye, diğerlerinde herkese. */
function publish(c: C, ch: ChannelRow, payload: Record<string, unknown>) {
  const msg = { type: 'chat', channelId: ch.id, ...payload };
  const p = ch.kind === 'dm'
    ? Promise.all([...new Set(dmMembers(ch))].map((uid) => broadcast(c.env, msg, { to: uid })))
    : broadcast(c.env, msg);
  c.executionCtx.waitUntil(p);
}

/** Bahsetme sayımı için: "@ad" — SQLite lower() gibi yalnızca ASCII harfleri küçültür */
const mentionToken = (u: SessionUser) => '@' + (u.firstName || '').trim().split(/\s+/)[0].replace(/[A-Z]/g, (x) => x.toLowerCase());

function checkText(raw: unknown): { text: string } | { error: string } {
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return { error: 'Mesaj metni geçersiz' };
  const text = (typeof raw === 'string' ? raw : '').replace(/\r\n?/g, '\n').replace(/^\s+|\s+$/g, '');
  if (text.length > MAX_TEXT) return { error: `Mesaj en fazla ${MAX_TEXT} karakter olabilir` };
  return { text };
}

/** R2 anahtarı için güvenli dosya adı */
function safeName(name: string): string {
  const tr: Record<string, string> = { ç: 'c', Ç: 'C', ğ: 'g', Ğ: 'G', ı: 'i', İ: 'I', ö: 'o', Ö: 'O', ş: 's', Ş: 'S', ü: 'u', Ü: 'U' };
  const base = name.split(/[\\/]/).pop() || 'dosya';
  const s = base.replace(/[çÇğĞıİöÖşŞüÜ]/g, (ch) => tr[ch]).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').replace(/^[._-]+/, '').slice(-120);
  return s || 'dosya';
}
function cleanType(t: string): string {
  const v = (t || '').toLowerCase().split(';')[0].trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(v) && v.length <= 100 ? v : 'application/octet-stream';
}

// ---------- kanallar ----------
r.get('/channels', async (c) => {
  const u = c.get('user');
  const { results } = await c.env.DB.prepare(
    `SELECT ch.*,
       (SELECT MAX(m.created_at) FROM messages m WHERE m.channel_id = ch.id AND m.deleted = 0) AS last_at,
       (SELECT COUNT(*) FROM messages m WHERE m.channel_id = ch.id AND m.deleted = 0 AND m.user_id != ?1
          AND m.created_at > COALESCE(rd.last_read_at, '')) AS unread,
       (SELECT COUNT(*) FROM messages m WHERE m.channel_id = ch.id AND m.deleted = 0 AND m.user_id != ?1
          AND m.created_at > COALESCE(rd.last_read_at, '')
          AND (instr(lower(m.text), ?2) > 0 OR instr(lower(m.text), '@herkes') > 0)) AS mentions
     FROM channels ch LEFT JOIN channel_reads rd ON rd.channel_id = ch.id AND rd.user_id = ?1
     WHERE ch.archived = 0 AND (ch.kind != 'dm' OR substr(ch.dm_key, 1, length(?1) + 1) = ?1 || '|' OR substr(ch.dm_key, -(length(?1) + 1)) = '|' || ?1)
     ORDER BY CASE ch.kind WHEN 'general' THEN 0 WHEN 'client' THEN 1 ELSE 2 END, ch.created_at, ch.name`,
  ).bind(u.id, mentionToken(u)).all<ChannelRow & { unread: number; mentions: number; last_at: string | null }>();
  return c.json(results.filter((ch) => canAccess(u, ch)).map((ch) => channelView(ch, u.id)));
});

// Birebir konuşmayı aç (yoksa oluştur)
r.post('/dm', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.userId !== 'string' || !b.userId) return c.json({ error: 'Kişi seçilmedi' }, 400);
  if (b.userId === u.id) return c.json({ error: 'Kendinle birebir konuşma açamazsın' }, 400);
  const other = await c.env.DB.prepare("SELECT id FROM users WHERE id = ? AND status != 'removed'").bind(b.userId).first();
  if (!other) return c.json({ error: 'Kişi bulunamadı' }, 404);
  const key = [u.id, b.userId].sort().join('|');
  await c.env.DB.prepare("INSERT OR IGNORE INTO channels (id, name, kind, dm_key) VALUES (?, '', 'dm', ?)").bind(newId('dm'), key).run();
  const ch = (await c.env.DB.prepare('SELECT * FROM channels WHERE dm_key = ?').bind(key).first<ChannelRow>())!;
  return c.json(channelView(ch, u.id));
});

// ---------- mesajlar ----------
r.get('/channels/:id/messages', async (c) => {
  const ch = await channelFor(c, c.req.param('id'));
  if (ch instanceof Response) return ch;
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '', 10) || PAGE));
  const before = c.req.query('before');
  let rows: MessageRow[];
  if (before) {
    const ref = await c.env.DB.prepare('SELECT created_at, id FROM messages WHERE id = ? AND channel_id = ?').bind(before, ch.id).first<{ created_at: string; id: string }>();
    if (!ref) return c.json({ error: 'Mesaj bulunamadı' }, 400);
    rows = (await c.env.DB.prepare(
      'SELECT * FROM messages WHERE channel_id = ? AND (created_at < ? OR (created_at = ? AND id < ?)) ORDER BY created_at DESC, id DESC LIMIT ?',
    ).bind(ch.id, ref.created_at, ref.created_at, ref.id, limit + 1).all<MessageRow>()).results;
  } else {
    rows = (await c.env.DB.prepare('SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC, id DESC LIMIT ?')
      .bind(ch.id, limit + 1).all<MessageRow>()).results;
  }
  const hasMore = rows.length > limit;
  return c.json({ messages: rows.slice(0, limit).reverse().map(messageView), hasMore });
});

r.post('/channels/:id/messages', async (c) => {
  const u = c.get('user');
  const ch = await channelFor(c, c.req.param('id'));
  if (ch instanceof Response) return ch;
  if (ch.archived) return c.json({ error: 'Bu kanal arşivlendi, yeni mesaj yazılamaz' }, 400);

  const ct = c.req.header('Content-Type') || '';
  let rawText: unknown; let file: File | null = null;
  if (ct.startsWith('multipart/form-data')) {
    const len = Number(c.req.header('Content-Length') || 0);
    if (len > MAX_FILE + 256 * 1024) return c.json({ error: 'Dosya en fazla 25 MB olabilir' }, 413);
    let form: FormData;
    try { form = await c.req.formData(); } catch { return c.json({ error: 'Dosya okunamadı' }, 400); }
    rawText = form.get('text') ?? '';
    const f = form.get('file');
    if (f && typeof f !== 'string') {
      file = f as File;
      if (file.size > MAX_FILE) return c.json({ error: 'Dosya en fazla 25 MB olabilir' }, 413);
      if (file.size === 0) return c.json({ error: 'Dosya boş' }, 400);
    }
  } else {
    const b = await c.req.json().catch(() => ({}));
    rawText = b.text;
  }
  const t = checkText(rawText);
  if ('error' in t) return c.json({ error: t.error }, 400);
  if (!t.text && !file) return c.json({ error: 'Boş mesaj gönderilemez' }, 400);

  const id = newId('m');
  let fileKey: string | null = null, fileName: string | null = null, fileType: string | null = null, fileSize: number | null = null;
  if (file) {
    fileName = (file.name || 'dosya').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'dosya';
    fileType = cleanType(file.type);
    fileSize = file.size;
    fileKey = `chat/${ch.id}/${id}/${safeName(fileName)}`;
    await c.env.FILES.put(fileKey, await file.arrayBuffer(), { httpMetadata: { contentType: fileType } });
  }
  await c.env.DB.prepare(
    `INSERT INTO messages (id, channel_id, user_id, text, file_key, file_name, file_type, file_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${nowSql})`,
  ).bind(id, ch.id, u.id, t.text, fileKey, fileName, fileType, fileSize).run();
  const row = (await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(id).first<MessageRow>())!;
  // Kendi mesajını yazan kanalı okumuş sayılır
  await c.env.DB.prepare('INSERT INTO channel_reads (user_id, channel_id, last_read_at) VALUES (?, ?, ?) ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_at = MAX(last_read_at, excluded.last_read_at)')
    .bind(u.id, ch.id, row.created_at).run();
  const view = messageView(row);
  publish(c, ch, { action: 'new', message: view });
  return c.json(view, 201);
});

async function ownMessage(c: C): Promise<{ m: MessageRow; ch: ChannelRow } | Response> {
  const m = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(c.req.param('id')).first<MessageRow>();
  if (!m) return c.json({ error: 'Mesaj bulunamadı' }, 404);
  const ch = await channelFor(c, m.channel_id);
  if (ch instanceof Response) return ch;
  if (m.user_id !== c.get('user').id) return c.json({ error: 'Yalnızca kendi mesajını değiştirebilirsin' }, 403);
  if (m.deleted) return c.json({ error: 'Bu mesaj silinmiş' }, 400);
  return { m, ch };
}

r.patch('/messages/:id', async (c) => {
  const o = await ownMessage(c);
  if (o instanceof Response) return o;
  const b = await c.req.json().catch(() => ({}));
  const t = checkText(b.text);
  if ('error' in t) return c.json({ error: t.error }, 400);
  if (!t.text && !o.m.file_key) return c.json({ error: 'Mesaj boş olamaz' }, 400);
  if (t.text === o.m.text) return c.json(messageView(o.m));
  await c.env.DB.prepare(`UPDATE messages SET text = ?, edited_at = ${nowSql} WHERE id = ?`).bind(t.text, o.m.id).run();
  const row = (await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(o.m.id).first<MessageRow>())!;
  const view = messageView(row);
  publish(c, o.ch, { action: 'edit', message: view });
  return c.json(view);
});

r.delete('/messages/:id', async (c) => {
  const o = await ownMessage(c);
  if (o instanceof Response) return o;
  await c.env.DB.prepare("UPDATE messages SET deleted = 1, text = '', file_key = NULL, file_name = NULL, file_type = NULL, file_size = NULL WHERE id = ?").bind(o.m.id).run();
  if (o.m.file_key) c.executionCtx.waitUntil(c.env.FILES.delete(o.m.file_key).catch(() => {}));
  publish(c, o.ch, { action: 'delete', message: messageView({ ...o.m, deleted: 1 }) });
  return c.json({ ok: true });
});

// ---------- okundu ----------
r.post('/read', async (c) => {
  const u = c.get('user');
  const b = await c.req.json().catch(() => ({}));
  if (typeof b.channelId !== 'string' || !b.channelId) return c.json({ error: 'Kanal belirtilmedi' }, 400);
  const ch = await channelFor(c, b.channelId);
  if (ch instanceof Response) return ch;
  await c.env.DB.prepare(
    `INSERT INTO channel_reads (user_id, channel_id, last_read_at)
     VALUES (?1, ?2, MAX(${nowSql}, COALESCE((SELECT MAX(created_at) FROM messages WHERE channel_id = ?2), '')))
     ON CONFLICT(user_id, channel_id) DO UPDATE SET last_read_at = MAX(last_read_at, excluded.last_read_at)`,
  ).bind(u.id, ch.id).run();
  // aynı kişinin diğer ekranları (Mac uygulaması, telefon) sayıyı güncellesin
  c.executionCtx.waitUntil(broadcast(c.env, { type: 'chat', channelId: ch.id, action: 'read' }, { to: u.id }));
  return c.json({ ok: true });
});

// ---------- dosya indirme ----------
r.get('/files/:id', async (c) => {
  const m = await c.env.DB.prepare('SELECT * FROM messages WHERE id = ?').bind(c.req.param('id')).first<MessageRow>();
  if (!m || m.deleted || !m.file_key) return c.json({ error: 'Dosya bulunamadı' }, 404);
  const ch = await channelFor(c, m.channel_id);
  if (ch instanceof Response) return ch;
  const obj = await c.env.FILES.get(m.file_key);
  if (!obj) return c.json({ error: 'Dosya bulunamadı' }, 404);
  const type = m.file_type || 'application/octet-stream';
  const inline = INLINE_TYPES.has(type) && c.req.query('download') === undefined;
  const name = m.file_name || 'dosya';
  return new Response(obj.body, {
    headers: {
      'Content-Type': inline ? type : 'application/octet-stream',
      'Content-Length': String(obj.size),
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'private, max-age=86400',
    },
  });
});
