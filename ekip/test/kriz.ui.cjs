// Kriz kayıtları: API (yetki, doğrulama, bildirim, canlı yayın, yükleme sınırları) + arayüz (Playwright).
// Kullanım (wrangler dev :8813 ve API_PORT=8813 vite :8913 açıkken):
//   BASE=http://127.0.0.1:8813 UI=http://127.0.0.1:8913 PERSIST=<db klasörü> NODE_PATH=$(npm root -g) node test/kriz.ui.cjs <ekran klasörü>
const { chromium } = require('playwright');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const UI = process.env.UI || 'http://127.0.0.1:8913';
const OUT = process.argv[2] || '.';

/** Renk geçişli PNG (f(x,y) → [r,g,b]) */
function png(w, h, f) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const [r, g, b] = f(x, y); raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; } }
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = (buf) => { let x = 0xffffffff; for (const v of buf) x = T[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');
const shot = () => png(360, 640, (x, y) => (y < 60 ? [245, 245, 247] : y % 90 < 70 && x > 20 && x < 340 ? [255, 255, 255] : [228, 230, 236]));

/** WCAG kontrast denetimi (test/tema.ui.cjs ile aynı yöntem) */
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
    if (el.closest('[aria-hidden="true"]') || el.closest('.av') || el.closest('.snack')) continue;
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
  const { t, ok, eq, done, loginAs, sql, openLive, until, Client, BASE, wait } = lib;
  fs.mkdirSync(OUT, { recursive: true });
  sql("DELETE FROM crisis_events; DELETE FROM crisis_files; DELETE FROM crises; DELETE FROM notifications WHERE kind = 'kriz'");
  const yigit = await loginAs('u_yigit', 'Yiğit');
  const pelin = await loginAs('u_pelin', 'Pelin');
  const emre = await loginAs('u_emre', 'Emre');
  const volkan = await loginAs('u_volkan', 'Volkan');
  const notifs = (uid) => sql(`SELECT * FROM notifications WHERE user_id = '${uid}' AND kind = 'kriz' ORDER BY created_at`);
  const form = (buf, name, type) => { const fd = new FormData(); fd.append('file', new Blob([buf], { type }), name); return fd; };

  console.log('API');
  await t('doğrulama: müşteri, başlık, öncelik, kaynak, bağlantı', async () => {
    eq((await pelin.post('/api/krizler', { title: 'x' })).data.error, 'Müşteri seç');
    eq((await pelin.post('/api/krizler', { client: 'Olmayan Firma', title: 'x' })).status, 400);
    eq((await pelin.post('/api/krizler', { client: 'Arslandent', title: '  ' })).data.error, 'Kısa bir başlık yaz');
    eq((await pelin.post('/api/krizler', { client: 'Arslandent', title: 'x'.repeat(141) })).status, 400);
    eq((await pelin.post('/api/krizler', { client: 'Arslandent', title: 'x', priority: 'kritik' })).status, 400);
    eq((await pelin.post('/api/krizler', { client: 'Arslandent', title: 'x', source: 'tiktok' })).status, 400);
    eq((await pelin.post('/api/krizler', { client: 'Arslandent', title: 'x', link: 'javascript:alert(1)' })).status, 400);
    eq((await pelin.post('/api/krizler', { client: 'Arslandent', title: 'x', link: 'ftp://a.com/x' })).status, 400);
    eq((await pelin.post('/api/krizler', { client: 'Arslandent', title: 'x', ownerId: 'u_yok' })).status, 400);
    eq(sql('SELECT COUNT(*) n FROM crises')[0].n, 0);
  });
  await t('giriş yapmadan erişilemez', async () => {
    const anon = new Client();
    eq((await anon.get('/api/krizler')).status, 401);
    eq((await anon.post('/api/krizler', { client: 'Arslandent', title: 'x' })).status, 401);
  });

  const liveV = openLive(volkan); await liveV.ready;
  let k1;
  await t('Orta öncelik: sorumluya + yöneticiye bildirim, ad müşteri kaydındaki gibi, canlı yayın', async () => {
    const r = await pelin.post('/api/krizler', { client: 'arslandent', title: 'Google’da 1 yıldızlı yorum', source: 'google', link: 'g.page/r/abc', priority: 'orta', ownerId: 'u_emre', description: 'Randevu iptali şikâyeti' });
    eq(r.status, 201, JSON.stringify(r.data)); k1 = r.data;
    eq(k1.client, 'Arslandent'); eq(k1.status, 'acik'); eq(k1.link, 'https://g.page/r/abc'); eq(k1.events.length, 1); eq(k1.events[0].kind, 'created');
    eq(notifs('u_emre').length, 1); eq(notifs('u_yigit').length, 1); eq(notifs('u_volkan').length, 0); eq(notifs('u_pelin').length, 0);
    const n = notifs('u_emre')[0]; eq(n.link, '/krizler?id=' + k1.id); ok(n.title.startsWith('🟠 Orta kriz · Arslandent'), n.title);
    ok(await until(() => liveV.msgs.some((m) => m.type === 'kriz' && m.id === k1.id)), 'kriz yayını gelmedi');
  });
  let k2;
  await t('Acil öncelik: bütün aktif ekibe 🚨 bildirim (kaydı açan hariç)', async () => {
    const r = await emre.post('/api/krizler', { client: 'Çavuşdent', title: 'Yanlış fiyatla paylaşım yapıldı', source: 'paylasim', priority: 'acil' });
    eq(r.status, 201); k2 = r.data;
    for (const u of ['u_yigit', 'u_pelin', 'u_volkan']) { const l = notifs(u).filter((x) => x.link === '/krizler?id=' + k2.id); eq(l.length, 1, u); ok(l[0].title.startsWith('🚨 Acil kriz'), l[0].title); }
    eq(notifs('u_emre').filter((x) => x.link === '/krizler?id=' + k2.id).length, 0);
    ok(liveV.msgs.some((m) => m.type === 'notify' && m.notification.kind === 'kriz'), 'Volkan canlı bildirim almadı');
  });
  await t('Yüksek öncelik de bütün ekibe gider', async () => {
    const r = await volkan.post('/api/krizler', { client: 'Doğa Dent', title: 'DM’de hakaret içerikli mesaj', source: 'dm', priority: 'yuksek', ownerId: 'u_pelin' });
    eq(r.status, 201);
    for (const u of ['u_yigit', 'u_pelin', 'u_emre']) eq(notifs(u).filter((x) => x.link === '/krizler?id=' + r.data.id).length, 1, u);
  });
  await t('durum: herkes değiştirebilir; Çözüldü için çözüm notu zorunlu; sorumlu ve açana bildirim', async () => {
    const before = { emre: notifs('u_emre').length, pelin: notifs('u_pelin').length, yigit: notifs('u_yigit').length };
    let r = await volkan.post(`/api/krizler/${k1.id}/status`, { status: 'mudahale' });
    eq(r.status, 200); eq(r.data.status, 'mudahale');
    eq(notifs('u_emre').length, before.emre + 1); eq(notifs('u_pelin').length, before.pelin + 1); eq(notifs('u_yigit').length, before.yigit);
    ok(notifs('u_pelin').at(-1).title.includes('müdahale'), notifs('u_pelin').at(-1).title);
    eq((await volkan.post(`/api/krizler/${k1.id}/status`, { status: 'mudahale' })).status, 409);
    eq((await volkan.post(`/api/krizler/${k1.id}/status`, { status: 'bitti' })).status, 400);
    r = await volkan.post(`/api/krizler/${k1.id}/status`, { status: 'cozuldu', note: '   ' });
    eq(r.status, 400); ok(/çözüm notu/.test(r.data.error));
    r = await volkan.post(`/api/krizler/${k1.id}/status`, { status: 'cozuldu', note: 'Yoruma kibarca yanıt verildi, müşteri aradı ve yorumu güncelledi.' });
    eq(r.status, 200); eq(r.data.status, 'cozuldu'); ok(r.data.resolvedAt); eq(r.data.resolvedBy, 'u_volkan'); ok(r.data.resolution.startsWith('Yoruma'));
    ok(notifs('u_emre').at(-1).title.startsWith('✅ Kriz çözüldü'), notifs('u_emre').at(-1).title);
    const ev = r.data.events.map((e) => e.kind); eq(ev.join(','), 'created,status,status');
  });
  await t('adım notu: herkes ekler, boş not olmaz; zaman çizelgesinde kim/ne', async () => {
    eq((await volkan.post(`/api/krizler/${k2.id}/notes`, { text: ' ' })).status, 400);
    const r = await volkan.post(`/api/krizler/${k2.id}/notes`, { text: 'Paylaşım arşive alındı, düzeltilmiş görsel hazırlanıyor.' });
    eq(r.status, 201); const last = r.data.events.at(-1); eq(last.kind, 'note'); eq(last.userId, 'u_volkan');
  });
  await t('düzenleme yetkisi: yalnızca açan / sorumlu / yönetici', async () => {
    eq((await volkan.patch(`/api/krizler/${k2.id}`, { title: 'Değişti' })).status, 403);
    // k1'in sorumlusu Emre: önceliği değiştirebilir; yönetici sorumluyu Volkan yapar → Volkan bildirim alır
    eq((await emre.patch(`/api/krizler/${k1.id}`, { priority: 'dusuk' })).status, 200);
    const nv = notifs('u_volkan').length;
    const r = await yigit.patch(`/api/krizler/${k2.id}`, { ownerId: 'u_volkan', title: 'Yanlış fiyatla paylaşım (kampanya görseli)' });
    eq(r.status, 200); eq(r.data.ownerId, 'u_volkan'); eq(r.data.title, 'Yanlış fiyatla paylaşım (kampanya görseli)');
    eq(notifs('u_volkan').length, nv + 1); ok(notifs('u_volkan').at(-1).title.includes('sorumlusu sensin'));
    eq((await volkan.patch(`/api/krizler/${k2.id}`, { description: 'Sorumlu olunca düzenleyebilir' })).status, 200);
    eq((await yigit.patch(`/api/krizler/${k2.id}`, { link: 'mailto:a@b.com' })).status, 400);
    eq((await yigit.patch(`/api/krizler/${k2.id}`, { priority: 'x' })).status, 400);
  });
  let f1;
  await t('ekran görüntüsü: PNG yüklenir; GIF/metin 415, 8 MB üstü 413, 12 sınırı', async () => {
    let r = await volkan.req('POST', `/api/krizler/${k2.id}/files`, form(shot(), 'image.png', 'image/png'));
    eq(r.status, 201, JSON.stringify(r.data)); f1 = r.data; ok(f1.name.startsWith('Ekran görüntüsü'), f1.name);
    eq((await volkan.req('POST', `/api/krizler/${k2.id}/files`, form(GIF, 'a.gif', 'image/gif'))).status, 415);
    eq((await volkan.req('POST', `/api/krizler/${k2.id}/files`, form(Buffer.from('<script>alert(1)</script>'), 'x.png', 'image/png'))).status, 415);
    const big = Buffer.concat([shot(), Buffer.alloc(8 * 1024 * 1024)]);
    eq((await volkan.req('POST', `/api/krizler/${k2.id}/files`, form(big, 'big.png', 'image/png'))).status, 413);
    const d = (await volkan.get(`/api/krizler/${k2.id}`)).data; eq(d.files.length, 1); eq(d.events.at(-1).kind, 'file');
  });
  await t('görsel yalnızca giriş yapmış ekibe sunulur', async () => {
    eq((await new Client().get(f1.url)).status, 401);
    const r = await pelin.get(f1.url); eq(r.status, 200); eq(r.headers.get('content-type'), 'image/png'); ok(r.headers.get('cache-control').includes('private'));
    ok(r.data.length > 100);
  });
  await t('ekran görüntüsünü yalnızca ekleyen ya da yönetici siler', async () => {
    eq((await pelin.del(`/api/krizler/${k2.id}/files/${f1.id}`)).status, 403);
    eq((await volkan.del(`/api/krizler/${k2.id}/files/${f1.id}`)).status, 200);
    eq((await volkan.get(`/api/krizler/${k2.id}`)).data.files.length, 0);
  });
  await t('müşteri rozeti: çözülmemiş kriz sayısı ve en yüksek öncelik', async () => {
    const m = (await pelin.get('/api/krizler/acik')).data;
    eq(m['Çavuşdent'].count, 1); eq(m['Çavuşdent'].priority, 'acil'); eq(m['Doğa Dent'].priority, 'yuksek'); eq(m['Arslandent'], undefined);
    const l = (await pelin.get('/api/krizler?client=' + encodeURIComponent('arslandent'))).data; eq(l.length, 1); eq(l[0].status, 'cozuldu');
  });
  await t('silme: yalnızca açan ya da yönetici', async () => {
    const r = await pelin.post('/api/krizler', { client: 'Arslandent', title: 'Silinecek deneme', priority: 'dusuk' });
    eq((await volkan.del('/api/krizler/' + r.data.id)).status, 403);
    eq((await pelin.del('/api/krizler/' + r.data.id)).status, 200);
    eq((await pelin.get('/api/krizler/' + r.data.id)).status, 404);
    eq(sql(`SELECT COUNT(*) n FROM notifications WHERE link = '/krizler?id=${r.data.id}'`)[0].n, 0);
  });
  liveV.ws.close();

  // ---------- arayüz ----------
  console.log('Arayüz');
  // görünüm için birkaç kayıt daha
  const extra = await pelin.post('/api/krizler', { client: 'Büyüksoy Şemsiye', title: 'Instagram’da ürün kalitesi şikâyeti, 40+ beğeni aldı', source: 'instagram', priority: 'yuksek', ownerId: 'u_pelin' });
  await volkan.req('POST', `/api/krizler/${extra.data.id}/files`, form(shot(), 'yorum.png', 'image/png'));
  sql(`UPDATE crises SET created_at = datetime('now', '-3 hours', '-12 minutes') WHERE id = '${extra.data.id}'`);
  sql(`UPDATE crises SET created_at = datetime('now', '-26 hours') WHERE id = '${k2.id}'`);
  await yigit.post('/api/krizler', { client: 'Craft Mimarlık', title: 'Telefonda yanlış bilgi verildi', source: 'telefon', priority: 'dusuk' });

  const browser = await chromium.launch();
  const errors = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kriz-'));
  const shotFile = path.join(tmp, 'yorum-ekran.png'); fs.writeFileSync(shotFile, shot());
  const bigFile = path.join(tmp, 'cok-buyuk.png'); fs.writeFileSync(bigFile, Buffer.concat([shot(), Buffer.alloc(8.2 * 1024 * 1024)]));
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
  const theme = async (p, th) => { await p.evaluate((th) => fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { theme: th } }) }), th); };
  const audits = {};
  const audit = async (p, name) => { await p.waitForTimeout(700); const bad = await p.evaluate(AUDIT); audits[name] = bad; return bad; };

  const p = await open('yigiitozdemir@gmail.com');
  const pp = await open('pelin@mayaajans.net');
  await theme(p, 'dark');
  await pp.goto(UI + '/krizler'); await pp.waitForSelector('.kr-card');

  await t('sayfa: açık krizler öncelik sırasıyla, sayaç, çözülenler kapalı', async () => {
    await p.goto(UI + '/krizler'); await p.waitForSelector('.kr-card');
    const pris = await p.$$eval('.kr-list .kr-card', (els) => els.map((e) => [...e.classList].find((c) => c.startsWith('p-'))));
    eq(pris.join(','), 'p-acil,p-yuksek,p-yuksek,p-dusuk', 'sıra');
    // aynı öncelikte eski olan önce
    const firstHigh = await p.$eval('.kr-list .kr-card.p-yuksek', (e) => e.textContent);
    ok(firstHigh.includes('Büyüksoy'), firstHigh);
    ok((await p.textContent('.kr-card.p-acil .kr-age')).includes('1 gün 2 sa'), await p.textContent('.kr-card.p-acil .kr-age'));
    ok((await p.textContent('.kr-card.p-yuksek .kr-age')).includes('3 sa 12 dk'));
    ok(await p.isVisible('text=Çözülenler'));
    eq(await p.$$eval('.kr-donebox .kr-card', (e) => e.length), 0, 'çözülenler kapalı başlamalı');
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/kriz-liste-koyu.png` });
    const bad = await audit(p, 'liste koyu'); ok(bad.length === 0, bad.join(' | '));
  });
  let newId;
  await t('yeni kayıt: zorunlu alanlar, ekran görüntüsü, Acil → bütün ekip; başkasının ekranına canlı düşer', async () => {
    await p.click('button:has-text("Kriz kaydı aç")');
    await p.waitForSelector('.kr-form');
    await p.click('.kr-form button[type=submit]');
    ok(await p.isVisible('.kr-form .errtext:has-text("Müşteri seç")'), 'müşteri hatası'); ok(await p.isVisible('.kr-form .errtext:has-text("Kısa bir başlık yaz")'));
    await p.selectOption('.kr-form select >> nth=0', { label: 'Furkan Biçer' });
    await p.fill('.kr-form input[maxlength="140"]', 'Reels altında hakaret içerikli yorumlar');
    await p.click('.kr-prisel button:has-text("Acil")');
    ok(await p.isVisible('text=Bütün ekibe bildirim gider'));
    await p.click('.kr-chips button:has-text("Instagram yorumu")');
    await p.fill('.kr-form input[inputmode=url]', 'instagram.com/reel/xyz');
    await p.setInputFiles('.kr-form input[type=file]', bigFile);
    await p.waitForSelector('.snack:has-text("8 MB")');
    await p.setInputFiles('.kr-form input[type=file]', shotFile);
    await p.waitForSelector('.kr-form .kr-thumb');
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/kriz-yeni-koyu.png` });
    await p.focus('.kr-form input[maxlength="140"]'); await p.keyboard.press('Enter'); // Enter ile kaydeder
    await p.waitForSelector('.kr-drawer h2:has-text("Reels altında")');
    newId = new URL(p.url()).searchParams.get('id'); ok(newId, 'adres ?id= almadı');
    await p.waitForSelector('.kr-drawer .kr-thumb img');
    const n = sql(`SELECT COUNT(*) n FROM notifications WHERE kind='kriz' AND link='/krizler?id=${newId}'`)[0].n; eq(n, 3, 'Acil: kaydı açan hariç bütün aktif ekip (3 kişi)');
    await pp.waitForSelector('.kr-card:has-text("Reels altında")', { timeout: 6000 });
  });
  await t('detay: Müdahale → Çözüldü (çözüm notu zorunlu), zaman çizelgesi, Escape kapatır', async () => {
    await p.click('.kr-steps button:has-text("Müdahale ediliyor")');
    await p.waitForSelector('.kr-sta.s-mudahale');
    await p.fill('.kr-noteform textarea', 'Yorumlar gizlendi, müşteriye bilgi verildi.');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.kr-ev-x:has-text("Yorumlar gizlendi")');
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/kriz-detay-koyu.png` });
    const bad = await audit(p, 'detay koyu'); ok(bad.length === 0, bad.join(' | '));
    await p.click('.kr-steps button:has-text("Çözüldü")');
    await p.click('.kr-resolve button[type=submit]');
    ok(await p.isVisible('.kr-resolve >> text=Kısa bir çözüm notu yaz'));
    await p.fill('.kr-resolve textarea', 'Hesap engellendi, açıklama paylaşıldı.');
    await p.click('.kr-resolve button[type=submit]');
    await p.waitForSelector('.kr-resbox:has-text("Hesap engellendi")');
    ok(await p.isVisible('.kr-ev.st-cozuldu'));
    await p.keyboard.press('Escape');
    await p.waitForSelector('.kr-drawer', { state: 'detached' });
    eq(new URL(p.url()).searchParams.get('id'), null);
    await p.click('.kr-donebtn');
    await p.waitForSelector('.kr-donebox .kr-card:has-text("Reels altında")');
  });
  await t('bildirim bağlantısı (/krizler?id=) çekmeceyi açar', async () => {
    await pp.evaluate((id) => { history.pushState({}, '', '/krizler?id=' + id); window.dispatchEvent(new Event('maya-nav')); }, k2.id);
    await pp.waitForSelector('.kr-drawer h2:has-text("Yanlış fiyatla")');
    ok(!(await pp.isVisible('.kr-drawer button:has-text("Düzenle")')), 'Pelin bu kaydı düzenleyememeli');
    ok(!(await pp.isVisible('.kr-drawer button:has-text("Kaydı sil")')));
    await pp.keyboard.press('Escape');
  });
  await t('müşteri kartı: adında uyarı rozeti ve "Kriz kayıtları" sekmesi', async () => {
    await p.goto(UI + '/musteriler?id=c_05'); // Çavuşdent (açık Acil)
    await p.waitForSelector('.mu-head h2:has-text("Çavuşdent")');
    ok(await p.isVisible('.mu-item.on .kr-rozet.p-acil'), 'listede rozet yok');
    await p.click('.mu-head .kr-rozet');
    await p.waitForSelector('.kr-mk .kr-card:has-text("Yanlış fiyatla")');
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/kriz-musteri-koyu.png` });
    await p.click('.kr-mk button:has-text("Kriz kaydı aç")');
    eq(await p.$eval('.kr-form select', (s) => s.value), 'Çavuşdent');
    await p.keyboard.press('Escape');
    await p.waitForSelector('.kr-form', { state: 'detached' });
  });
  await t('açık tema + telefon görünümü (yatay taşma yok, kontrast)', async () => {
    await theme(p, 'light');
    await p.goto(UI + '/krizler'); await p.waitForSelector('.kr-card');
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/kriz-liste-acik.png` });
    let bad = await audit(p, 'liste açık'); ok(bad.length === 0, bad.join(' | '));
    await p.click('.kr-card.p-acil'); await p.waitForSelector('.kr-drawer h2');
    await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/kriz-detay-acik.png` });
    bad = await audit(p, 'detay açık'); ok(bad.length === 0, bad.join(' | '));
    const m = await open('emre@mayaajans.net', { width: 390, height: 844 });
    for (const th of ['dark', 'light']) {
      await theme(m, th);
      await m.goto(UI + '/krizler'); await m.waitForSelector('.kr-card');
      eq(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'yatay taşma');
      await m.waitForTimeout(600); await m.screenshot({ path: `${OUT}/kriz-telefon-${th === 'dark' ? 'koyu' : 'acik'}.png` });
      bad = await audit(m, 'telefon ' + th); ok(bad.length === 0, bad.join(' | '));
      await m.click('.kr-card.p-yuksek'); await m.waitForSelector('.kr-drawer h2');
      eq(await m.evaluate(() => document.querySelector('.kr-drawer').scrollWidth <= document.querySelector('.kr-drawer').clientWidth + 1), true, 'çekmece taşıyor');
      await m.waitForTimeout(600); await m.screenshot({ path: `${OUT}/kriz-telefon-detay-${th === 'dark' ? 'koyu' : 'acik'}.png` });
      await m.keyboard.press('Escape');
    }
    await theme(m, 'dark');
  });
  await t('konsol hatası yok', async () => ok(errors.length === 0, errors.join(' | ')));
  await theme(p, 'dark');
  await browser.close();
  void wait; void BASE;
  done();
})().catch((e) => { console.error(e); process.exit(1); });
