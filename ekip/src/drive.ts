// Drive önizlemeleri: işlere / içeriklere eklenen Google Drive linkinin içindeki görsel ve videoların küçük resimleri.
// Google Drive API v3 + API anahtarı (env.DRIVE_API_KEY, gizli). Yalnızca "bağlantıya sahip herkes görebilir" paylaşılan
// klasör/dosyalar görülebilir. Anahtar yoksa özellik kapalıdır ({ aktif: false }); hiçbir şey bozulmaz.
import { Hono } from 'hono';
import type { Env, Vars } from './types';

export type DriveDosya = { id: string; ad: string; tur: 'gorsel' | 'video' | 'pdf' | 'klasor' | 'belge' | 'diger'; kucuk: string | null; link: string };
export type DriveOnizleme =
  | { aktif: false }
  | { aktif: true; tur: 'klasor' | 'dosya'; ad: string; toplam: number; fazlasi: boolean; dosyalar: DriveDosya[]; link: string }
  | { aktif: true; hata: 'erisim' | 'bulunamadi' | 'gecici' };

const TTL_MS = 20 * 60_000;      // başarılı sonuç
const HATA_TTL_MS = 5 * 60_000;  // erişim yok / bulunamadı
const SAYFA = 50;                // klasörde sayılan en çok dosya

/** Drive linkinden tür + kimlik çıkar. Drive değilse null. */
export function driveKimlik(link: string): { tur: 'klasor' | 'dosya'; id: string } | null {
  let u: URL;
  try { u = new URL(link.trim()); } catch { return null; }
  if (!/(^|\.)(drive|docs)\.google\.com$/.test(u.hostname)) return null;
  const idOk = (s: string | null | undefined) => (s && /^[A-Za-z0-9_-]{10,120}$/.test(s) ? s : null);
  let m = u.pathname.match(/\/folders\/([^/?#]+)/);
  if (m && idOk(m[1])) return { tur: 'klasor', id: m[1] };
  m = u.pathname.match(/\/d\/([^/?#]+)/); // file/d/<id>, document/d/<id> …
  if (m && idOk(m[1])) return { tur: 'dosya', id: m[1] };
  const q = idOk(u.searchParams.get('id'));
  if (q) return { tur: u.pathname.includes('folder') ? 'klasor' : 'dosya', id: q };
  return null;
}

function turOf(mime: string): DriveDosya['tur'] {
  if (mime === 'application/vnd.google-apps.folder') return 'klasor';
  if (mime.startsWith('image/')) return 'gorsel';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('application/vnd.google-apps.')) return 'belge';
  return 'diger';
}

type ApiFile = { id: string; name: string; mimeType: string; thumbnailLink?: string; webViewLink?: string };
const dosyaOf = (f: ApiFile): DriveDosya => {
  const tur = turOf(f.mimeType || '');
  // küçük resim: API'nin verdiği (paylaşılan dosyada herkese açık) ya da Drive'ın küçük resim adresi
  const kucuk = tur === 'klasor' ? null
    : f.thumbnailLink ? f.thumbnailLink.replace(/=s\d+$/, '=s400')
    : (tur === 'gorsel' || tur === 'video' || tur === 'pdf') ? `https://drive.google.com/thumbnail?id=${encodeURIComponent(f.id)}&sz=w400` : null;
  return { id: f.id, ad: f.name || '', tur, kucuk, link: f.webViewLink || `https://drive.google.com/file/d/${f.id}/view` };
};

/** Drive API çağrısı (ya da testte sahte yanıt). */
async function driveGet(env: Env, path: string, params: Record<string, string>): Promise<{ status: number; body: any }> {
  if (env.DRIVE_SAHTE) {
    const sahte = JSON.parse(env.DRIVE_SAHTE) as Record<string, any>;
    const key = path === 'files' ? 'liste:' + (params.q.match(/'([^']+)' in parents/)?.[1] || '') : 'meta:' + path.replace('files/', '');
    const v = sahte[key];
    if (v === undefined) return { status: 404, body: { error: { code: 404 } } };
    if (typeof v === 'number') return { status: v, body: { error: { code: v } } };
    return { status: 200, body: v };
  }
  const qs = new URLSearchParams({ ...params, key: env.DRIVE_API_KEY!, supportsAllDrives: 'true' });
  const r = await fetch(`https://www.googleapis.com/drive/v3/${path}?${qs}`, { cf: { cacheTtl: 0 } } as RequestInit);
  let body: any = null; try { body = await r.json(); } catch { /* */ }
  return { status: r.status, body };
}

export async function driveOnizleme(env: Env, link: string): Promise<DriveOnizleme> {
  if (!env.DRIVE_API_KEY && !env.DRIVE_SAHTE) return { aktif: false };
  const k = driveKimlik(link);
  if (!k) return { aktif: false };
  const anahtar = k.tur + ':' + k.id;
  const c = await env.DB.prepare('SELECT veri, at FROM drive_cache WHERE anahtar = ?').bind(anahtar).first<{ veri: string; at: string }>();
  if (c) {
    const v = JSON.parse(c.veri) as DriveOnizleme;
    const yas = Date.now() - Date.parse(c.at.replace(' ', 'T') + 'Z');
    if (yas < ('hata' in v ? HATA_TTL_MS : TTL_MS)) return v;
  }
  let sonuc: DriveOnizleme;
  try {
    const meta = await driveGet(env, 'files/' + k.id, { fields: 'id,name,mimeType,thumbnailLink,webViewLink' });
    if (meta.status === 404 || meta.status === 403) sonuc = { aktif: true, hata: meta.status === 404 ? 'bulunamadi' : 'erisim' };
    else if (meta.status !== 200) sonuc = { aktif: true, hata: 'gecici' };
    else if (meta.body.mimeType === 'application/vnd.google-apps.folder') {
      const l = await driveGet(env, 'files', {
        q: `'${k.id}' in parents and trashed = false`, pageSize: String(SAYFA), orderBy: 'folder,modifiedTime desc',
        fields: 'nextPageToken,files(id,name,mimeType,thumbnailLink,webViewLink)', includeItemsFromAllDrives: 'true',
      });
      if (l.status !== 200) sonuc = { aktif: true, hata: l.status === 403 ? 'erisim' : 'gecici' };
      else {
        const files = ((l.body.files || []) as ApiFile[]).map(dosyaOf);
        // önce görsel/videolar (önizlemesi olanlar), sonra diğerleri
        files.sort((a, b) => Number(!!b.kucuk) - Number(!!a.kucuk));
        sonuc = { aktif: true, tur: 'klasor', ad: meta.body.name || 'Klasör', toplam: files.length, fazlasi: !!l.body.nextPageToken, dosyalar: files.slice(0, 12), link };
      }
    } else {
      sonuc = { aktif: true, tur: 'dosya', ad: meta.body.name || 'Dosya', toplam: 1, fazlasi: false, dosyalar: [dosyaOf(meta.body as ApiFile)], link };
    }
  } catch {
    sonuc = { aktif: true, hata: 'gecici' };
  }
  if (!('hata' in sonuc && sonuc.hata === 'gecici')) {
    await env.DB.prepare("INSERT INTO drive_cache (anahtar, veri, at) VALUES (?, ?, datetime('now')) ON CONFLICT(anahtar) DO UPDATE SET veri = excluded.veri, at = excluded.at")
      .bind(anahtar, JSON.stringify(sonuc)).run();
  }
  return sonuc;
}

// ---- ekip: /api/drive ----
export const r = new Hono<{ Bindings: Env; Variables: Vars }>();
r.get('/onizleme', async (c) => {
  const link = c.req.query('url') || '';
  if (link.length > 1000) return c.json({ error: 'Bağlantı çok uzun' }, 400);
  return c.json(await driveOnizleme(c.env, link), 200, { 'Cache-Control': 'private, max-age=300' });
});
