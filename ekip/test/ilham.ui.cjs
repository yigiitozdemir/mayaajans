// İlham panosu: API (yetki, sınırlar, bağlantı türleri, canlı yayın, dosya sunumu) + arayüz (Playwright).
// Kullanım (wrangler dev :8813 ve API_PORT=8813 vite :8913 açıkken):
//   BASE=http://127.0.0.1:8813 UI=http://127.0.0.1:8913 PERSIST=<db klasörü> NODE_PATH=$(npm root -g) node test/ilham.ui.cjs <ekran klasörü>
const { chromium } = require('playwright');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const UI = process.env.UI || 'http://127.0.0.1:8913';
const OUT = process.argv[2] || '.';

function png(w, h, f) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const [r, g, b] = f(x, y); raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (buf) => { let x = 0xffffffff; for (const v of buf) x = T[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
/** Moodboard'a yakışan renk geçişli örnek görseller */
const grad = (w, h, c1, c2, c3) => png(w, h, (x, y) => { const t = (x / w + y / h) / 2; const d = Math.hypot(x - w * 0.7, y - h * 0.3) / Math.max(w, h); return mix(mix(c1, c2, t), c3, Math.max(0, 0.6 - d)); });
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

const AUDIT = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(',').map((x) => parseFloat(x)); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('gradient')) return null;
      const c = parse(cs.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  const bad = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode; if (!n.textContent.trim()) continue;
    const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    if (el.closest('[aria-hidden="true"]') || el.closest('.av') || el.closest('.snack') || el.closest('.mu-logo')) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const fg0 = parse(cs.color); const bg = bgOf(el); if (!fg0 || !bg) continue;
    const fg = blend({ ...fg0, a: fg0.a * op }, bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) bad.push(`${ratio.toFixed(2)} <${need} "${n.textContent.trim().slice(0, 40)}" ${cs.color} / ${typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : el.tagName}`);
  }
  return bad;
};

(async () => {
  const lib = await import('./lib.mjs');
  const { t, ok, eq, done, loginAs, sql, openLive, until, Client } = lib;
  fs.mkdirSync(OUT, { recursive: true });
  sql('DELETE FROM inspirations');
  const yigit = await loginAs('u_yigit', 'Yiğit');
  const pelin = await loginAs('u_pelin', 'Pelin');
  const emre = await loginAs('u_emre', 'Emre');
  const up = (who, buf, name, type, fields = {}) => { const fd = new FormData(); fd.append('file', new Blob([buf], { type }), name); for (const [k, v] of Object.entries(fields)) fd.append(k, v); return who.req('POST', '/api/ilham/files', fd); };
  const IMG = grad(600, 800, [255, 150, 120], [120, 90, 255], [255, 220, 180]);

  console.log('API');
  const live = openLive(emre); await live.ready;
  let a;
  await t('görsel ekle: müşteri panosu, etiketler küçük harf/tekil, ölçüler; canlı yayın tip ilham', async () => {
    const r = await up(pelin, IMG, 'ref.png', 'image/png', { client: 'arslandent', note: 'Sıcak renk geçişi', tags: '#Renk, Tipografi, renk', width: '600', height: '800' });
    eq(r.status, 201, JSON.stringify(r.data)); a = r.data;
    eq(a.client, 'Arslandent'); eq(a.kind, 'image'); eq(a.tags.join(','), 'renk,tipografi'); eq(a.width, 600); eq(a.height, 800); ok(a.url.startsWith('/api/ilham/'));
    ok(await until(() => live.msgs.some((m) => m.type === 'ilham' && m.client === 'Arslandent' && m.id === a.id)), 'canlı yayın yok');
  });
  await t('sınırlar: 8 MB üstü 413, görsel olmayan 415, GIF kabul, bilinmeyen müşteri 404, etiket/not sınırları', async () => {
    const big = Buffer.concat([IMG, Buffer.alloc(8 * 1024 * 1024)]);
    eq((await up(pelin, big, 'b.png', 'image/png', { client: 'Arslandent' })).status, 413);
    eq((await up(pelin, Buffer.from('%PDF-1.4 sahte'), 'x.pdf', 'application/pdf', { client: 'Arslandent' })).status, 415);
    eq((await up(pelin, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'x.svg', 'image/svg+xml', { client: 'Arslandent' })).status, 415);
    eq((await up(pelin, GIF, 'a.gif', 'image/gif', { client: 'Arslandent' })).status, 201);
    eq((await up(pelin, IMG, 'a.png', 'image/png', { client: 'Olmayan' })).status, 404);
    eq((await up(pelin, IMG, 'a.png', 'image/png', { client: 'Arslandent', tags: 'a,b,c,d,e,f,g,h,i' })).status, 400);
    eq((await up(pelin, IMG, 'a.png', 'image/png', { client: 'Arslandent', tags: 'x'.repeat(25) })).status, 400);
    eq((await up(pelin, IMG, 'a.png', 'image/png', { client: 'Arslandent', note: 'n'.repeat(281) })).status, 400);
    const fd = new FormData(); fd.append('client', 'Arslandent');
    eq((await pelin.req('POST', '/api/ilham/files', fd)).status, 400);
  });
  await t('bağlantı: türü tanınır (Instagram/Pinterest/Behance/web), yalnızca http/https', async () => {
    const add = (url) => pelin.post('/api/ilham/links', { client: 'Arslandent', url, note: 'Bak', tags: ['reels fikri'] });
    eq((await add('instagram.com/p/abc')).data.site, 'instagram');
    eq((await add('https://pin.it/x1')).data.site, 'pinterest');
    eq((await add('https://tr.pinterest.com/pin/1')).data.site, 'pinterest');
    eq((await add('https://www.behance.net/gallery/1')).data.site, 'behance');
    const w = (await add('dribbble.com/shots/1')).data; eq(w.site, 'web'); eq(w.url, 'https://dribbble.com/shots/1');
    eq((await add('javascript:alert(1)')).status, 400);
    eq((await add('')).status, 400);
  });
  await t('Genel pano müşteriden ayrı', async () => {
    eq((await up(emre, IMG, 'g.png', 'image/png', { client: '', tags: 'kampanya' })).status, 201);
    const g = (await pelin.get('/api/ilham')).data; eq(g.client, ''); eq(g.items.length, 1);
    const c = (await pelin.get('/api/ilham?client=Arslandent')).data; eq(c.items.length, 7); ok(c.items.every((x) => x.client === 'Arslandent'));
    eq((await pelin.get('/api/ilham?client=Yok')).status, 404);
  });
  await t('görseller yalnızca giriş yapmış ekibe açık', async () => {
    eq((await new Client().get(a.url)).status, 401);
    eq((await new Client().get('/api/ilham?client=Arslandent')).status, 401);
    const r = await emre.get(a.url); eq(r.status, 200); eq(r.headers.get('content-type'), 'image/png'); ok(r.headers.get('cache-control').includes('private')); eq(r.data.length, IMG.length);
  });
  await t('not/etiket düzenleme ve silme: ekleyen ya da yönetici', async () => {
    eq((await emre.patch('/api/ilham/' + a.id, { note: 'x' })).status, 403);
    eq((await emre.del('/api/ilham/' + a.id)).status, 403);
    let r = await pelin.patch('/api/ilham/' + a.id, { note: 'Sıcak geçiş, yumuşak gölge', tags: ['renk', 'ışık'] }); eq(r.status, 200); eq(r.data.tags.join(','), 'renk,ışık');
    r = await yigit.patch('/api/ilham/' + a.id, { tags: 'renk, ışık, kompozisyon' }); eq(r.status, 200); eq(r.data.tags.length, 3);
    const gif = (await pelin.get('/api/ilham?client=Arslandent')).data.items.find((x) => x.contentType === 'image/gif');
    eq((await yigit.del('/api/ilham/' + gif.id)).status, 200);
    eq((await pelin.get(gif.url)).status, 404);
  });
  live.ws.close();

  // ---------- arayüz ----------
  console.log('Arayüz');
  sql("DELETE FROM inspirations WHERE kind = 'link' AND url LIKE '%pin.it%'");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ilham-'));
  const files = [
    ['dalga.png', grad(800, 1000, [20, 40, 90], [40, 160, 170], [250, 200, 150])],
    ['gun-batimi.png', grad(1000, 700, [255, 120, 80], [255, 200, 120], [120, 60, 160])],
    ['pastel.png', grad(700, 700, [250, 220, 230], [200, 220, 255], [255, 255, 255])],
  ].map(([n, b]) => { const p = path.join(tmp, n); fs.writeFileSync(p, b); return p; });
  const big = path.join(tmp, 'buyuk.png'); fs.writeFileSync(big, Buffer.concat([IMG, Buffer.alloc(8.1 * 1024 * 1024)]));

  const browser = await chromium.launch();
  const errors = [];
  async function open(email, viewport = { width: 1400, height: 900 }) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(email + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(email + ': ' + m.text()); });
    await p.goto(UI + '/giris');
    await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
    await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
    return p;
  }
  const theme = (p, th) => p.evaluate((th) => fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { theme: th } }) }), th);
  const count = (p) => p.$$eval('.il-it', (e) => e.length);

  const p = await open('yigiitozdemir@gmail.com');
  const pp = await open('pelin@mayaajans.net');
  await theme(p, 'dark');
  await pp.goto(UI + '/musteriler?id=c_02&sekme=ilham'); await pp.waitForSelector('.il-empty');

  await t('İlham sekmesi: boş pano, dosya seçerek birden çok görsel + not + etiket; 8 MB üstü uyarı', async () => {
    await p.goto(UI + '/musteriler?id=c_02'); // Büyüksoy Şemsiye
    await p.waitForSelector('.mu-head h2');
    await p.click('.mu-tabs button:has-text("İlham")');
    await p.waitForSelector('.il-empty');
    await p.setInputFiles('.il input[type=file]', big);
    await p.waitForSelector('.snack:has-text("8 MB")');
    await p.setInputFiles('.il input[type=file]', files);
    await p.waitForSelector('.dialog:has-text("3 görsel ekleniyor")');
    await p.fill('.dialog input[maxlength="280"]', 'Kampanya için renk ve ışık');
    await p.click('.il-sugg button:has-text("renk")');
    await p.fill('.il-tagbox input', 'yaz kampanyası'); await p.keyboard.press('Enter');
    eq(await p.$$eval('.il-tagbox .il-tag', (e) => e.length), 2);
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/ilham-ekle-koyu.png` });
    await p.click('.dialog button[type=submit]');
    await p.waitForSelector('.il-grid .il-it.image >> nth=2');
    eq(await count(p), 3);
    eq(sql("SELECT COUNT(*) n FROM inspirations WHERE client = 'Büyüksoy Şemsiye' AND tags LIKE '%yaz kampanyası%' AND width > 0")[0].n, 3);
  });
  await t('canlı: Pelin’in ekranına sayfa yenilemeden düşer; Pelin başkasının öğesini düzenleyemez', async () => {
    await pp.waitForSelector('.il-grid .il-it >> nth=2', { timeout: 6000 });
    eq(await pp.$$eval('.il-acts', (e) => e.length), 0);
    eq(await p.$$eval('.il-acts', (e) => e.length), 3, 'yönetici hepsini düzenleyebilir');
  });
  await t('⌘V yapıştır ve sürükle-bırak', async () => {
    const b64 = grad(500, 900, [30, 30, 40], [255, 90, 110], [255, 200, 200]).toString('base64');
    await p.evaluate((b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], 'image.png', { type: 'image/png' }));
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, b64);
    await p.waitForSelector('.dialog:has-text("1 görsel ekleniyor")');
    eq(await p.$$eval('.il-tagbox .il-tag', (e) => e.length), 0);
    await p.fill('.il-tagbox input', 'reels fikri'); await p.keyboard.press('Enter');
    await p.click('.dialog button[type=submit]');
    await p.waitForFunction(() => document.querySelectorAll('.il-it').length === 4);
    await p.evaluate((b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer(); dt.items.add(new File([bin], 'surukle.png', { type: 'image/png' }));
      const el = document.querySelector('.il');
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, b64);
    await p.waitForSelector('.dialog:has-text("1 görsel ekleniyor")');
    await p.click('.dialog button[type=submit]');
    await p.waitForFunction(() => document.querySelectorAll('.il-it').length === 5);
  });
  await t('bağlantı kartı yeni sekmede açılır', async () => {
    await p.click('.il-bar button:has-text("Bağlantı ekle")');
    await p.fill('.dialog input[inputmode=url]', 'javascript:alert(1)'); await p.keyboard.press('Enter');
    await p.waitForSelector('.dialog .errtext');
    await p.fill('.dialog input[inputmode=url]', 'https://www.instagram.com/p/C0abc/');
    await p.fill('.dialog input[maxlength="280"]', 'Karusel kapak düzeni');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.il-link.s-instagram');
    eq(await p.getAttribute('.il-link.s-instagram', 'target'), '_blank');
    ok((await p.getAttribute('.il-link.s-instagram', 'rel')).includes('noopener'));
  });
  await t('etikete göre süz', async () => {
    await p.click('.il-filter button:has-text("#reels fikri")');
    eq(await count(p), 1);
    await p.click('.il-filter button:has-text("Tümü")');
    eq(await count(p), 6);
  });
  await t('büyük önizleme: ok tuşları, Escape', async () => {
    await p.click('.il-it.image >> nth=0 >> .il-img');
    await p.waitForSelector('.il-lb img');
    const n0 = await p.textContent('.il-lb-n'); ok(n0.startsWith('1 / 5'), n0);
    await p.keyboard.press('ArrowRight'); eq((await p.textContent('.il-lb-n')).trim(), '2 / 5');
    await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); eq((await p.textContent('.il-lb-n')).trim(), '5 / 5');
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/ilham-onizleme-koyu.png` });
    await p.keyboard.press('Escape');
    await p.waitForSelector('.il-lb', { state: 'detached' });
    ok(await p.isVisible('.il-grid'), 'pano açık kalmalı');
  });
  await t('düzenle ve sil (onaylı)', async () => {
    await p.hover('.il-it >> nth=0');
    await p.click('.il-it >> nth=0 >> button[aria-label="Not ve etiketi düzenle"]');
    await p.fill('.dialog input[maxlength="280"]', 'Düzenlendi: gece mavisi');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.il-note:has-text("Düzenlendi: gece mavisi")');
    await p.hover('.il-it >> nth=0');
    await p.click('.il-it >> nth=0 >> button[aria-label="Sil"]');
    await p.click('.dialog button:has-text("Sil")');
    await p.waitForFunction(() => document.querySelectorAll('.il-it').length === 5);
  });
  const report = {};
  await t('koyu/açık tema, masaüstü ekran görüntüsü + kontrast', async () => {
    await p.mouse.move(5, 5);
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/ilham-pano-koyu.png` });
    report['pano koyu'] = await p.evaluate(AUDIT);
    await theme(p, 'light'); await p.goto(UI + '/musteriler?id=c_02&sekme=ilham'); await p.waitForSelector('.il-it');
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/ilham-pano-acik.png` });
    report['pano açık'] = await p.evaluate(AUDIT);
    for (const [k, v] of Object.entries(report)) ok(v.length === 0, k + ': ' + v.join(' | '));
  });
  await t('Genel pano: Müşteriler sayfasından ulaşılır, müşteri panosundan ayrı', async () => {
    await p.goto(UI + '/musteriler'); await p.waitForSelector('.mu-genel');
    await p.click('.mu-genel');
    await p.waitForSelector('.mu-detail h2:has-text("Genel ilham panosu")');
    eq(new URL(p.url()).searchParams.get('pano'), 'genel');
    await p.waitForSelector('.il-it');
    eq(await count(p), 1);
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/ilham-genel-acik.png` });
    const bad = await p.evaluate(AUDIT); ok(bad.length === 0, bad.join(' | '));
  });
  await t('telefon: yatay taşma yok, iki sütun, kontrast (koyu + açık)', async () => {
    const m = await open('emre@mayaajans.net', { width: 390, height: 844 });
    for (const th of ['dark', 'light']) {
      await theme(m, th);
      await m.goto(UI + '/musteriler?id=c_02&sekme=ilham'); await m.waitForSelector('.il-it');
      await m.waitForTimeout(400);
      eq(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'yatay taşma');
      const lefts = await m.$$eval('.il-it', (e) => [...new Set(e.map((x) => Math.round(x.getBoundingClientRect().left)))].length);
      eq(lefts, 2, 'iki sütun');
      await m.waitForTimeout(600); await m.screenshot({ path: `${OUT}/ilham-telefon-${th === 'dark' ? 'koyu' : 'acik'}.png` });
      const bad = await m.evaluate(AUDIT); ok(bad.length === 0, th + ': ' + bad.join(' | '));
    }
    await m.goto(UI + '/musteriler?pano=genel'); await m.waitForSelector('.mu-detail h2:has-text("Genel")');
    await m.waitForTimeout(600); await m.screenshot({ path: `${OUT}/ilham-telefon-genel-acik.png` });
    await theme(m, 'dark');
  });
  await t('konsol hatası yok', async () => ok(errors.length === 0, errors.join(' | ')));
  await theme(p, 'dark');
  await browser.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
