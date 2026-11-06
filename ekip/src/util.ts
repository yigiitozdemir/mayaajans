// Ortak yardımcılar: kimlik üretimi, özet (hash), şifre, tarih

const enc = new TextEncoder();

export function randomToken(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return b64url(a);
}

export function newId(prefix: string): string {
  return prefix + '_' + randomToken(12);
}

export function b64url(buf: ArrayBuffer | Uint8Array): string {
  const a = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(text: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

// PBKDF2-SHA256 (Workers'ın izin verdiği en yüksek tur sayısı 100.000)
const PBKDF2_ITER = 100_000;

export async function hashPassword(password: string, saltB64?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltB64 ?? randomToken(16);
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PBKDF2_ITER },
    key,
    256,
  );
  return { hash: b64url(bits), salt };
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// SQLite 'YYYY-MM-DD HH:MM:SS' (UTC)
export function sqlNow(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString().replace('T', ' ').slice(0, 19);
}

export const DAY = 86_400_000;

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function isEmail(s: unknown): s is string {
  return typeof s === 'string' && s.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function clean(s: unknown, max = 500): string {
  return typeof s === 'string' ? s.trim().slice(0, max) : '';
}

// İstanbul saati (UTC+3, yaz saati yok)
export function istanbulHour(d = new Date()): number {
  return (d.getUTCHours() + 3) % 24;
}
