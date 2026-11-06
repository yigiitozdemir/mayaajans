// Web Push gönderimi (VAPID, aes128gcm) — Workers'ta WebCrypto ile, dış kütüphane yok.
// RFC 8291 (ileti şifreleme), RFC 8188 (aes128gcm içerik kodlaması), RFC 8292 (VAPID).
import type { Env } from './types';

export interface PushPayload { title: string; body: string; link?: string | null; tag?: string }

const SUBJECT = 'https://ekip.mayaajans.net';
const TTL = 86400;           // bir gün: telefon kapalıysa bu süre içinde açılınca gelir
const MAX_FAILS = 15;        // art arda bu kadar başarısız denemeden sonra abonelik bırakılır
const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;

// ---------- base64url ----------
export function b64uDecode(s: string): Bytes {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
export function b64uEncode(u: Uint8Array | ArrayBuffer): string {
  const a = u instanceof Uint8Array ? u : new Uint8Array(u);
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- uç nokta denetimi (yalnızca bilinen push servisleri) ----------
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /(^|\.)googleapis\.com$/, /(^|\.)mozilla\.com$/, /(^|\.)mozaws\.net$/, /(^|\.)notify\.windows\.com$/];
export function endpointAllowed(env: Env, endpoint: string): boolean {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  // yerel test (yalnızca .dev.vars içindeki PUSH_ALLOW_LOCAL=1 ile): sahte push sunucusu
  if ((env as unknown as Record<string, string>).PUSH_ALLOW_LOCAL === '1' && u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')) return true;
  return u.protocol === 'https:' && PUSH_HOSTS.some((r) => r.test(u.hostname));
}

// ---------- VAPID (ES256 JWT) ----------
let vapidKey: { pub: string; priv: string; key: CryptoKey } | null = null;
async function signingKey(env: Env): Promise<CryptoKey | null> {
  const pub = env.VAPID_PUBLIC, priv = env.VAPID_PRIVATE;
  if (!pub || !priv) return null;
  if (vapidKey && vapidKey.pub === pub && vapidKey.priv === priv) return vapidKey.key;
  const p = b64uDecode(pub);
  if (p.length !== 65 || p[0] !== 4) return null;
  const jwk: JsonWebKey = priv.trim().startsWith('{')
    ? JSON.parse(priv)
    : { kty: 'EC', crv: 'P-256', d: priv.trim(), x: b64uEncode(p.slice(1, 33)), y: b64uEncode(p.slice(33, 65)) };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  vapidKey = { pub, priv, key };
  return key;
}
export function vapidReady(env: Env): boolean { return !!env.VAPID_PUBLIC && !!env.VAPID_PRIVATE; }

async function vapidHeader(env: Env, key: CryptoKey, endpoint: string): Promise<string> {
  const aud = new URL(endpoint).origin;
  const head = b64uEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64uEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: SUBJECT })));
  const input = head + '.' + claims;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, concat(enc.encode(input)));
  return `vapid t=${input}.${b64uEncode(sig)}, k=${env.VAPID_PUBLIC}`;
}

// ---------- RFC 8291 şifreleme ----------
async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

/** İçeriği alıcının p256dh/auth anahtarlarıyla aes128gcm olarak şifreler (tek kayıt). */
export async function encryptPayload(plain: Uint8Array, p256dh: string, auth: string): Promise<Bytes> {
  const uaPub = b64uDecode(p256dh), secret = b64uDecode(auth);
  if (uaPub.length !== 65 || uaPub[0] !== 4 || secret.length !== 16) throw new Error('geçersiz abonelik anahtarı');
  const uaKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as CryptoKeyPair;
  const asPub = new Uint8Array((await crypto.subtle.exportKey('raw', as.publicKey)) as ArrayBuffer);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm, as.privateKey, 256));
  // IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info\0" || ua_public || as_public, 32)
  const prkKey = await hmac(secret, ecdh);
  const ikm = (await hmac(prkKey, concat(enc.encode('WebPush: info\0'), uaPub, asPub, new Uint8Array([1])))).slice(0, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // tek (son) kayıt: içerik || 0x02 ayırıcı, dolgu yok
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(plain, new Uint8Array([2]))));
  const rs = 4096;
  const header = concat(salt, new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255, asPub.length]), asPub);
  return concat(header, ct);
}

// ---------- gönderim ----------
interface SubRow { id: string; endpoint: string; p256dh: string; auth: string; fail_count: number }

function cut(s: string, n: number): string { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/** Bildirim içeriği (JSON, ≤ 3 KB). */
export function payloadBytes(p: PushPayload): Bytes {
  const link = typeof p.link === 'string' && p.link.startsWith('/') && !p.link.startsWith('//') ? cut(p.link, 400) : '/';
  const title = cut(String(p.title || 'Maya Ekip'), 120);
  const tag = cut(String(p.tag || 'maya'), 40);
  let body = cut(String(p.body || ''), 600);
  let out: Uint8Array = enc.encode(JSON.stringify({ title, body, link, tag }));
  while (out.length > 3000 && body.length > 20) { body = cut(body, Math.floor(body.length / 2)); out = enc.encode(JSON.stringify({ title, body, link, tag })); }
  return concat(out);
}

export interface PushResult { ready: boolean; devices: number; delivered: number; removed: number; failed: number }

/** Kişinin bütün cihazlarına gönderir ve sonucu döndürür (deneme bildirimi bunu kullanır). */
export async function pushToUser(env: Env, userId: string, p: PushPayload): Promise<PushResult> {
  const res: PushResult = { ready: false, devices: 0, delivered: 0, removed: 0, failed: 0 };
  const key = await signingKey(env).catch((e) => { console.error('vapid anahtarı', e); return null; });
  if (!key) return res;
  res.ready = true;
  const { results } = await env.DB.prepare('SELECT id, endpoint, p256dh, auth, fail_count FROM push_subscriptions WHERE user_id = ?').bind(userId).all<SubRow>();
  res.devices = results.length;
  if (!results.length) return res;
  const plain = payloadBytes(p);
  const urgency = p.tag === 'nudge' ? 'high' : 'normal';
  await Promise.all(results.map(async (s) => {
    let status = 0;
    try {
      if (!endpointAllowed(env, s.endpoint)) status = 410;
      else {
        const body = await encryptPayload(plain, s.p256dh, s.auth);
        const r = await fetch(s.endpoint, {
          method: 'POST',
          headers: {
            Authorization: await vapidHeader(env, key, s.endpoint),
            'Content-Encoding': 'aes128gcm',
            'Content-Type': 'application/octet-stream',
            TTL: String(TTL),
            Urgency: urgency,
          },
          body,
          signal: AbortSignal.timeout(10000),
        });
        status = r.status;
        await r.body?.cancel().catch(() => {});
      }
    } catch (e) { status = 0; console.error("push gönderilemedi", String(e)); }
    try {
      if (status >= 200 && status < 300) {
        res.delivered++;
        await env.DB.prepare("UPDATE push_subscriptions SET last_ok_at = datetime('now'), fail_count = 0 WHERE id = ?").bind(s.id).run();
      } else if (status === 404 || status === 410 || s.fail_count + 1 >= MAX_FAILS) {
        res.removed++;
        await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(s.id).run();
      } else {
        res.failed++;
        await env.DB.prepare('UPDATE push_subscriptions SET fail_count = fail_count + 1 WHERE id = ?').bind(s.id).run();
      }
    } catch { /* veritabanı hatası bildirimi engellemesin */ }
  }));
  return res;
}

/** Kişinin kayıtlı bütün cihazlarına bildirim gönderir. Hata vermez (bildirim isteğe bağlı). */
export async function sendPush(env: Env, userId: string, p: PushPayload): Promise<void> {
  try { await pushToUser(env, userId, p); } catch (e) { console.error('push', e); }
}
