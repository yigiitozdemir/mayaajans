// web/dist içindeki dosyaları Worker'a gömülü bir modüle çevirir (src/static.gen.ts).
// Böylece ayrı "assets" yüklemesine gerek kalmaz; Worker sayfayı kendisi sunar.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'web', 'dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const files = {};
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const rel = '/' + relative(dist, p).split('\\').join('/');
    const ct = TYPES[extname(name)] || 'application/octet-stream';
    files[rel] = { ct, b64: readFileSync(p).toString('base64'), immutable: rel.startsWith('/assets/') };
  }
})(dist);
if (!files['/index.html']) throw new Error('web/dist/index.html yok — önce npm run build:web');
// sürüm kimliği: index.html değişince (yeni JS/CSS) değişir; açık sayfalar bunu görüp kendini yeniler
const BUILD_ID = createHash('sha256').update(files['/index.html'].b64).digest('hex').slice(0, 12);
const out = `// Otomatik üretildi (scripts/embed-static.mjs). Elle düzenleme.
export const BUILD_ID = '${BUILD_ID}';
export interface StaticFile { ct: string; b64: string; immutable: boolean }
export const STATIC: Record<string, StaticFile> = ${JSON.stringify(files)};
`;
writeFileSync(join(root, 'src', 'static.gen.ts'), out);
const kb = Math.round(out.length / 1024);
console.log(`gömülü dosya: ${Object.keys(files).length} · ${kb} KB · sürüm ${BUILD_ID}`);
