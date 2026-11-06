// Gömülü web arayüzünü sunar. Bilinmeyen yollar tek sayfa uygulamasına (index.html) düşer.
import { STATIC } from './static.gen';

const cache = new Map<string, Uint8Array>();
function bytes(path: string): Uint8Array {
  let b = cache.get(path);
  if (!b) {
    const bin = atob(STATIC[path].b64);
    b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    cache.set(path, b);
  }
  return b;
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function serveStatic(req: Request): Response {
  const url = new URL(req.url);
  let path = decodeURIComponent(url.pathname);
  if (path === '/') path = '/index.html';
  let file = STATIC[path];
  if (!file && !/\.[a-z0-9]+$/i.test(path)) { path = '/index.html'; file = STATIC[path]; }
  if (!file) return new Response('Bulunamadı', { status: 404, headers: SECURITY_HEADERS });
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    'Content-Type': file.ct,
    'Cache-Control': file.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  };
  return new Response(req.method === 'HEAD' ? null : (bytes(path) as unknown as BodyInit), { headers });
}
