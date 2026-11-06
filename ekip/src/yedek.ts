// Haftalık otomatik yedek: bütün tablolar JSON olarak R2 'maya-ekip-yedek' deposuna (son 12 yedek tutulur).
// Biçim: { version:1, createdAt, tables: { <ad>: { columns:[…], rows:[[…]], sql } } } → gzip → yedek/YYYY-MM-DD-HHmm.json.gz
// Yalnızca veritabanı yedeklenir; R2'deki dosya içerikleri (logolar, sohbet dosyaları, ajanda görselleri) bu yedekte YOKTUR.
// Geri yükleme: scripts/yedekten-don.mjs
import type { Env } from './types';
import { notify } from './notify';

export const YEDEK_ONEK = 'yedek/';
export const YEDEK_SAKLA = 12;
const SAYFA = 500;
/** Yedeklenmeyen tablolar: oturumlar, davet/şifre bağlantıları ve hatalı giriş denemeleri geçici ve güvenlik amaçlı. */
export const YEDEK_DISI = new Set(['sessions', 'invites', 'login_attempts']);
const IC_ONEK = /^(_cf_|d1_|sqlite_)/i;

export interface YedekBilgi {
  key: string;        // yedek/2026-11-09-0317.json.gz
  name: string;       // 2026-11-09-0317.json.gz
  size: number;       // bayt (sıkıştırılmış)
  uploaded: string;   // ISO
  tables: number;
  rows: number;
}

const q = (name: string) => '"' + name.replace(/"/g, '""') + '"';

/** İstanbul saatiyle YYYY-MM-DD-HHmm (UTC+3, yaz saati yok). */
function damga(d = new Date()) {
  const t = new Date(d.getTime() + 3 * 3600_000).toISOString();
  return t.slice(0, 10) + '-' + t.slice(11, 13) + t.slice(14, 16);
}

function b64(a: Uint8Array) {
  let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s);
}
/** D1'den gelen değeri JSON'a uygun hâle getirir (BLOB → { $b64 }). */
function jsonDeger(v: unknown): unknown {
  if (v instanceof ArrayBuffer) return { $b64: b64(new Uint8Array(v)) };
  if (ArrayBuffer.isView(v)) return { $b64: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (Array.isArray(v)) return { $b64: b64(Uint8Array.from(v as number[])) };
  return v;
}

export async function tabloListesi(env: Env): Promise<{ name: string; sql: string }[]> {
  const { results } = await env.DB.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string; sql: string }>();
  return results.filter((t) => !IC_ONEK.test(t.name) && !YEDEK_DISI.has(t.name));
}

/** Veritabanının yedeğini çıkarır (R2'ye yazmadan). Büyük tablolar rowid ile sayfa sayfa okunur. */
export async function yedekVerisi(env: Env) {
  const tables: Record<string, { columns: string[]; rows: unknown[][]; sql: string }> = {};
  let rows = 0;
  for (const t of await tabloListesi(env)) {
    const info = await env.DB.prepare(`PRAGMA table_info(${q(t.name)})`).all<{ name: string }>();
    const columns = info.results.map((c) => c.name);
    const colList = columns.map(q).join(', ');
    const out: unknown[][] = [];
    const withoutRowid = /WITHOUT\s+ROWID/i.test(t.sql || '');
    if (!withoutRowid) {
      let last: number | null = null;
      for (;;) {
        const stmt: D1PreparedStatement = last === null
          ? env.DB.prepare(`SELECT rowid AS __r, ${colList} FROM ${q(t.name)} ORDER BY rowid LIMIT ?`).bind(SAYFA)
          : env.DB.prepare(`SELECT rowid AS __r, ${colList} FROM ${q(t.name)} WHERE rowid > ? ORDER BY rowid LIMIT ?`).bind(last, SAYFA);
        const page = await stmt.raw<unknown[]>();
        for (const r of page) out.push(r.slice(1).map(jsonDeger));
        if (page.length < SAYFA) break;
        last = page[page.length - 1][0] as number;
      }
    } else {
      for (let off = 0; ; off += SAYFA) {
        const page = await env.DB.prepare(`SELECT ${colList} FROM ${q(t.name)} LIMIT ? OFFSET ?`).bind(SAYFA, off).raw<unknown[]>();
        for (const r of page) out.push(r.map(jsonDeger));
        if (page.length < SAYFA) break;
      }
    }
    tables[t.name] = { columns, rows: out, sql: t.sql };
    rows += out.length;
  }
  return { doc: { version: 1 as const, createdAt: new Date().toISOString(), tables }, tableCount: Object.keys(tables).length, rowCount: rows };
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

/** R2'deki yedekler, en yeni başta. */
export async function yedekListesi(env: Env): Promise<YedekBilgi[]> {
  const all: R2Object[] = [];
  let cursor: string | undefined;
  do {
    const l = await env.BACKUP.list({ prefix: YEDEK_ONEK, cursor, include: ['customMetadata'] });
    all.push(...l.objects);
    cursor = l.truncated ? l.cursor : undefined;
  } while (cursor);
  return all
    .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime() || (a.key < b.key ? 1 : -1))
    .map((o) => ({
      key: o.key, name: o.key.slice(YEDEK_ONEK.length), size: o.size, uploaded: o.uploaded.toISOString(),
      tables: Number(o.customMetadata?.tables || 0), rows: Number(o.customMetadata?.rows || 0),
    }));
}

/** Yedek alır, R2'ye yazar, en yeni 12 yedeği bırakıp eskileri siler. Hata olursa fırlatır. */
export async function yedekAl(env: Env): Promise<YedekBilgi> {
  const { doc, tableCount, rowCount } = await yedekVerisi(env);
  const body = await gzip(JSON.stringify(doc));
  // aynı dakikada ikinci yedek: üzerine yazma, sonuna sıra ekle
  const base = YEDEK_ONEK + damga();
  let key = base + '.json.gz';
  for (let i = 2; await env.BACKUP.head(key); i++) key = `${base}-${i}.json.gz`;
  const obj = await env.BACKUP.put(key, body, {
    httpMetadata: { contentType: 'application/gzip' },
    customMetadata: { tables: String(tableCount), rows: String(rowCount), createdAt: doc.createdAt, version: '1' },
  });
  const list = await yedekListesi(env);
  const eski = list.slice(YEDEK_SAKLA).map((o) => o.key);
  if (eski.length) await env.BACKUP.delete(eski);
  return { key, name: key.slice(YEDEK_ONEK.length), size: obj?.size ?? body.byteLength, uploaded: (obj?.uploaded ?? new Date()).toISOString(), tables: tableCount, rows: rowCount };
}

/**
 * Pazartesi 03:17 (İstanbul) cron'u ve yönetici özetindeki "Şimdi yedek al" düğmesi bunu çağırır.
 * Hata olursa yöneticilere "Haftalık yedek alınamadı" bildirimi gider (düğmeye basan yöneticinin kendisine gitmez) ve hata fırlatılır.
 */
export async function haftalikYedek(env: Env, opts: { actorId?: string; waitUntil?: (p: Promise<unknown>) => void } = {}): Promise<YedekBilgi> {
  try {
    return await yedekAl(env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('yedek alınamadı', msg);
    try {
      const { results } = await env.DB.prepare("SELECT id FROM users WHERE role = 'admin' AND status = 'active'").all<{ id: string }>();
      for (const a of results) {
        await notify(env, {
          userId: a.id, kind: 'backup', title: 'Haftalık yedek alınamadı', body: msg.slice(0, 300),
          actorId: opts.actorId ?? null, link: '/yonetici', meta: 'Veritabanı yedeği',
        }, opts.waitUntil);
      }
    } catch { /* bildirim de gönderilemedi */ }
    throw e;
  }
}
