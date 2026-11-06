// Paket A — Duyuru panosu + Geri bildirim: API (yetkiler, doğrulama, bildirim, canlı yayın) + arayüz (gerçek Chromium).
// Kullanım:
//   BASE=http://127.0.0.1:8811 PERSIST=<db-a> UI=http://127.0.0.1:8911 NODE_PATH=$(npm root -g) node test/duyuru.ui.cjs <ekran klasörü>
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const UI = process.env.UI || 'http://127.0.0.1:8911';
const OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + String(e.message).split('\n')[0]); console.log('  ✗ ' + name + ' → ' + String(e.message).split('\n')[0]); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} beklenen ${JSON.stringify(b)}, gelen ${JSON.stringify(a)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Gerçek, küçük bir PNG (w×h, düz renk)
function png(w = 40, h = 24, rgb = [194, 78, 58]) {
  const crc = (buf) => { let c, cr = ~0; for (const b of buf) { c = (cr ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; cr = (cr >>> 8) ^ c; } return ~cr >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// tema.ui.cjs'teki kontrast denetimi (aynı mantık)
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
  const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode; if (!n.textContent.trim()) continue;
    const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (el.closest('.av')) continue; // avatar baş harfleri hariç
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const fg0 = parse(cs.color); const bg = bgOf(el); if (!fg0 || !bg) continue;
    const fg = blend({ ...fg0, a: fg0.a * op }, bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) bad.push(`${ratio.toFixed(2)} <${need} "${n.textContent.trim().slice(0, 40)}" ${cs.color} / ${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName}`);
  }
  return bad;
};

(async () => {
  const { loginAs, sql, openLive, until } = await import('./lib.mjs');
  const Y = await loginAs('u_yigit', 'Yiğit');
  const Pe = await loginAs('u_pelin', 'Pelin');
  const E = await loginAs('u_emre', 'Emre');
  sql("DELETE FROM duyuru_okumalar; DELETE FROM duyurular; DELETE FROM geri_bildirimler; DELETE FROM notifications WHERE kind IN ('duyuru','geribildirim'); UPDATE users SET settings = '{}' WHERE id IN ('u_yigit','u_pelin','u_emre')");
  const activeN = sql("SELECT COUNT(*) AS n FROM users WHERE status='active'")[0].n;
  const notes = (uid, kind) => sql(`SELECT title, body, link, actor_id FROM notifications WHERE user_id='${uid}' AND kind='${kind}' ORDER BY created_at`);

  // =========================== API: duyuru ===========================
  console.log('\nAPI · Duyuru panosu');
  const liveE = openLive(E); await liveE.ready;
  let d1;
  await t('doğrulama: başlık zorunlu / ≤120, metin ≤4000, yönetici olmayan sabitleyemez', async () => {
    eq((await Pe.post('/api/duyurular', { title: '  ' })).status, 400);
    eq((await Pe.post('/api/duyurular', { title: 'x'.repeat(121) })).status, 400);
    eq((await Pe.post('/api/duyurular', { title: 'Uzun', body: 'y'.repeat(4001) })).status, 400);
    eq((await Pe.post('/api/duyurular', { title: 'Sabit', pinned: true })).status, 403);
    eq((await Pe.post('/api/duyurular', { title: 'x', important: 'evet' })).status, 400);
  });
  await t('Pelin önemli duyuru yazar → 201, satır sonları korunur, yazan okumuş sayılır', async () => {
    const r = await Pe.post('/api/duyurular', { title: 'Cuma ofis erken kapanıyor', body: 'Saat 14:00\nDetay: https://ekip.mayaajans.net/takvim', important: true });
    eq(r.status, 201); d1 = r.data;
    eq(d1.body, 'Saat 14:00\nDetay: https://ekip.mayaajans.net/takvim'); eq(d1.important, true); eq(d1.readByMe, true);
    eq(d1.readCount, 1); eq(d1.total, activeN); ok(Array.isArray(d1.unread) && d1.unread.includes('u_emre'), 'yazan okumayanları görmeli');
  });
  await t('bütün aktif ekibe bildirim: "📣 Önemli duyuru: …", link /duyurular?id=, yazana gitmez', async () => {
    for (const u of ['u_yigit', 'u_emre']) {
      const n = notes(u, 'duyuru'); eq(n.length, 1, u);
      eq(n[0].title, '📣 Önemli duyuru: Cuma ofis erken kapanıyor'); eq(n[0].link, '/duyurular?id=' + d1.id);
    }
    eq(notes('u_pelin', 'duyuru').length, 0);
  });
  await t('canlı yayın: Emre "duyuru" mesajı alır', async () => ok(await until(() => liveE.msgs.some((m) => m.type === 'duyuru' && m.id === d1.id)), 'yayın gelmedi'));
  await t('okunmamış sayısı: Emre 1, Pelin 0', async () => {
    eq((await E.get('/api/duyurular/okunmamis')).data.sayi, 1); eq((await Pe.get('/api/duyurular/okunmamis')).data.sayi, 0);
  });
  await t('Emre (yazan değil) kimlerin okumadığını görmez; düzenleyemez/silemez/sabitleyemez/hatırlatamaz → 403', async () => {
    const it = (await E.get('/api/duyurular')).data.items.find((x) => x.id === d1.id);
    eq(it.unread, null); eq(it.canEdit, false); eq(it.readByMe, false);
    eq((await E.patch('/api/duyurular/' + d1.id, { title: 'hack' })).status, 403);
    eq((await E.patch('/api/duyurular/' + d1.id, { pinned: true })).status, 403);
    eq((await E.del('/api/duyurular/' + d1.id)).status, 403);
    eq((await E.post('/api/duyurular/' + d1.id + '/hatirlat')).status, 403);
    eq((await E.get('/api/duyurular/yok_bu')).status, 404);
  });
  await t('Emre "Okudum" → 2 kişi okudu (tekrar basmak sayıyı değiştirmez), canlı yayın', async () => {
    liveE.msgs.length = 0;
    const r = await E.post('/api/duyurular/' + d1.id + '/okudum'); eq(r.status, 200); eq(r.data.readCount, 2); eq(r.data.readByMe, true);
    eq((await E.post('/api/duyurular/' + d1.id + '/okudum')).data.readCount, 2);
    eq((await E.get('/api/duyurular/okunmamis')).data.sayi, 0);
    ok(await until(() => liveE.msgs.some((m) => m.type === 'duyuru' && m.action === 'read')), 'okuma yayını yok');
  });
  await t('Pelin okumayanlara hatırlatır → yalnızca okumayanlara bildirim; hemen tekrar → 429', async () => {
    const before = notes('u_emre', 'duyuru').length;
    const r = await Pe.post('/api/duyurular/' + d1.id + '/hatirlat'); eq(r.status, 200);
    eq(r.data.sent, activeN - 2);
    const yn = notes('u_yigit', 'duyuru'); eq(yn.length, 2); eq(yn[1].title, 'Hatırlatma: Cuma ofis erken kapanıyor');
    eq(notes('u_emre', 'duyuru').length, before, 'okuyana hatırlatma gitmemeli');
    eq((await Pe.post('/api/duyurular/' + d1.id + '/hatirlat')).status, 429);
  });
  let d2;
  await t('sıralama: sabitlenen en üstte, sonra yeniye göre; yalnızca yönetici sabitler', async () => {
    d2 = (await E.post('/api/duyurular', { title: 'Yeni çekim stüdyosu', body: '' })).data;
    eq(notes('u_pelin', 'duyuru').slice(-1)[0].title, 'Yeni duyuru: Yeni çekim stüdyosu');
    let items = (await Pe.get('/api/duyurular')).data.items; eq(items[0].id, d2.id, 'yeni olan üstte');
    const p = await Y.patch('/api/duyurular/' + d1.id, { pinned: true }); eq(p.status, 200); eq(p.data.pinned, true); eq(p.data.editedAt, null, 'sabitleme düzenleme sayılmaz');
    items = (await Pe.get('/api/duyurular')).data.items; eq(items[0].id, d1.id, 'sabit üstte');
  });
  await t('yönetici herkesinkini düzenler (düzenlendi işareti), yazan kendininkini düzenler', async () => {
    const r = await Y.patch('/api/duyurular/' + d2.id, { title: 'Yeni çekim stüdyosu (Kadıköy)' }); eq(r.status, 200); ok(r.data.editedAt, 'editedAt yok');
    ok(Array.isArray(r.data.unread), 'yönetici okumayanları görmeli');
    eq((await E.patch('/api/duyurular/' + d2.id, { body: 'Adres: Moda Cd.' })).data.body, 'Adres: Moda Cd.');
    eq((await E.patch('/api/duyurular/' + d2.id, { title: '' })).status, 400);
  });
  await t('arşiv: 30 günden eski + okunmuş + sabit değil → archived (okumayan için değil)', async () => {
    const d3 = (await Pe.post('/api/duyurular', { title: 'Eski duyuru' })).data;
    sql(`UPDATE duyurular SET created_at = strftime('%Y-%m-%d %H:%M:%f', 'now', '-40 days') WHERE id = '${d3.id}'`);
    eq((await Pe.get('/api/duyurular/' + d3.id)).data.archived, true);
    eq((await E.get('/api/duyurular/' + d3.id)).data.archived, false);
    await E.post('/api/duyurular/' + d3.id + '/okudum');
    eq((await E.get('/api/duyurular/' + d3.id)).data.archived, true);
    sql(`UPDATE duyurular SET created_at = strftime('%Y-%m-%d %H:%M:%f', 'now', '-40 days') WHERE id = '${d1.id}'`);
    eq((await E.get('/api/duyurular/' + d1.id)).data.archived, false, 'sabit olan arşive inmez');
    sql(`UPDATE duyurular SET created_at = strftime('%Y-%m-%d %H:%M:%f', 'now') WHERE id = '${d1.id}'`);
    eq((await Y.del('/api/duyurular/' + d3.id)).status, 200, 'yönetici başkasınınkini siler');
  });
  await t('yazan siler → 404 sonra; okumalar da silinir', async () => {
    eq((await E.del('/api/duyurular/' + d2.id)).status, 200);
    eq((await E.get('/api/duyurular/' + d2.id)).status, 404);
    eq(sql(`SELECT COUNT(*) AS n FROM duyuru_okumalar WHERE duyuru_id='${d2.id}'`)[0].n, 0);
  });

  // =========================== API: geri bildirim ===========================
  console.log('\nAPI · Geri bildirim');
  const liveP = openLive(Pe); await liveP.ready; liveE.msgs.length = 0;
  const form = (o, file) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); if (file) f.set('file', new Blob([file.buf], { type: file.type }), file.name); return f; };
  let g1;
  await t('doğrulama: tür ve mesaj zorunlu', async () => {
    eq((await E.req('POST', '/api/geri-bildirim', form({ kind: 'hata', message: '  ' }))).status, 400);
    eq((await E.req('POST', '/api/geri-bildirim', form({ kind: 'sikayet', message: 'x' }))).status, 400);
  });
  await t('görsel: yalnızca png/jpg/webp (içerik kontrolü), ≤ 8 MB', async () => {
    eq((await E.req('POST', '/api/geri-bildirim', form({ kind: 'hata', message: 'x' }, { buf: Buffer.from('merhaba'), type: 'image/png', name: 'a.png' }))).status, 415);
    eq((await E.req('POST', '/api/geri-bildirim', form({ kind: 'hata', message: 'x' }, { buf: Buffer.alloc(8 * 1024 * 1024 + 10, 1), type: 'image/png', name: 'b.png' }))).status, 413);
    eq(sql('SELECT COUNT(*) AS n FROM geri_bildirimler')[0].n, 0);
  });
  const img = png();
  await t('Emre görselli hata bildirir → 201, sayfa/cihaz kaydedilir, yöneticiye bildirim', async () => {
    const r = await E.req('POST', '/api/geri-bildirim', form({ kind: 'hata', message: 'Takvimde gün kayıyor\nPazartesi görünmüyor', page: '/takvim?ay=11', device: '1440×900 px · Mac uygulaması' }, { buf: img, type: 'image/png', name: 'ekran.png' }));
    eq(r.status, 201); g1 = r.data; eq(g1.hasImage, true); eq(g1.status, 'yeni'); eq(g1.page, '/takvim?ay=11');
    const n = notes('u_yigit', 'geribildirim'); eq(n.length, 1); eq(n[0].link, '/geri-bildirim?id=' + g1.id); ok(n[0].title.includes('Hata'), n[0].title);
  });
  await t('yönetici olmayan: liste/detay/güncelle/sil → 403; kendi gönderdiklerini görür', async () => {
    eq((await E.get('/api/geri-bildirim')).status, 403);
    eq((await E.get('/api/geri-bildirim/' + g1.id)).status, 403);
    eq((await E.patch('/api/geri-bildirim/' + g1.id, { status: 'yapildi' })).status, 403);
    eq((await E.del('/api/geri-bildirim/' + g1.id)).status, 403);
    const mine = (await E.get('/api/geri-bildirim/benim')).data; eq(mine.length, 1); eq(mine[0].id, g1.id);
    eq((await Pe.get('/api/geri-bildirim/benim')).data.length, 0);
  });
  await t('görsel yalnızca gönderene ve yöneticiye açık', async () => {
    const a = await E.get('/api/geri-bildirim/' + g1.id + '/gorsel'); eq(a.status, 200); eq(a.headers.get('content-type'), 'image/png'); eq(Buffer.compare(Buffer.from(a.data), img), 0);
    eq((await Y.get('/api/geri-bildirim/' + g1.id + '/gorsel')).status, 200);
    eq((await Pe.get('/api/geri-bildirim/' + g1.id + '/gorsel')).status, 403);
  });
  await t('canlı: gönderen yayını alır, başkası almaz', async () => {
    ok(await until(() => liveE.msgs.some((m) => m.type === 'geribildirim')), 'Emre almadı');
    await wait(300); ok(!liveP.msgs.some((m) => m.type === 'geribildirim'), 'Pelin almamalı');
  });
  await t('yönetici listesi + filtreler (tür, durum), geçersiz filtre 400', async () => {
    await Pe.req('POST', '/api/geri-bildirim', form({ kind: 'fikir', message: 'Karanlık tema harika olur' }));
    const all = (await Y.get('/api/geri-bildirim')).data; eq(all.items.length, 2); eq(all.items[0].kind, 'fikir', 'yeni olan üstte'); eq(all.counts.yeni, 2);
    eq((await Y.get('/api/geri-bildirim?tur=hata')).data.items.length, 1);
    eq((await Y.get('/api/geri-bildirim?durum=yapildi')).data.items.length, 0);
    eq((await Y.get('/api/geri-bildirim?tur=xx')).status, 400);
  });
  await t('yönetici durum + yanıt notu → gönderene "Geri bildirimine yanıt: …" bildirimi', async () => {
    eq((await Y.patch('/api/geri-bildirim/' + g1.id, { status: 'olmaz' })).status, 400);
    const r = await Y.patch('/api/geri-bildirim/' + g1.id, { status: 'inceleniyor', reply: 'Baktım, yarın düzeliyor.' });
    eq(r.status, 200); eq(r.data.status, 'inceleniyor'); eq(r.data.reply, 'Baktım, yarın düzeliyor.'); ok(r.data.repliedAt);
    const n = notes('u_emre', 'geribildirim'); eq(n.length, 1); eq(n[0].title, 'Geri bildirimine yanıt: Baktım, yarın düzeliyor.'); eq(n[0].link, '/?gb=' + g1.id);
    eq((await E.get('/api/geri-bildirim/benim')).data[0].reply, 'Baktım, yarın düzeliyor.');
  });
  liveE.ws.close(); liveP.ws.close();

  // =========================== Arayüz ===========================
  console.log('\nArayüz');
  sql("DELETE FROM duyuru_okumalar; DELETE FROM duyurular; DELETE FROM notifications WHERE kind IN ('duyuru','geribildirim')");
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (email, who, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', ...opts });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(who + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(who + ': ' + m.text()); });
    await page.goto(UI + '/giris');
    await page.getByLabel('E-posta').fill(email);
    await page.getByLabel('Şifre', { exact: true }).fill('TestSifre123');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.locator('.shell').waitFor({ timeout: 15000 });
    return { ctx, page };
  };
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'a-' + n + '.png') });
  const go = async (p, url) => { await p.evaluate((u) => { history.pushState({}, '', u); window.dispatchEvent(new Event('maya-nav')); }, url); await wait(250); };
  const setTheme = async (client, p, theme) => { await client.patch('/api/me', { settings: { theme } }); await p.reload(); await p.locator('.shell').waitFor(); await wait(400); };
  const noHScroll = (p) => p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1);
  const contrast = {};

  const P = await mk('pelin@mayaajans.net', 'Pelin');
  const M = await mk('emre@mayaajans.net', 'Emre');

  await t('Pelin: menüden Duyurular → boş durum', async () => {
    await P.page.getByRole('link', { name: 'Duyurular' }).first().click();
    await P.page.getByRole('heading', { name: 'Duyurular', exact: true }).waitFor();
    await P.page.getByText('Henüz duyuru yok').waitFor();
  });
  await t('Pelin: Yeni duyuru (Önemli) yayınlar; Enter ile kaydeder; boş başlık uyarısı', async () => {
    await P.page.getByRole('button', { name: 'Yeni duyuru' }).click();
    const dlg = P.page.getByRole('dialog', { name: 'Yeni duyuru' });
    await dlg.getByRole('button', { name: 'Yayınla' }).click();
    await dlg.getByRole('alert').getByText('Başlık boş olamaz').waitFor();
    ok(!(await dlg.getByRole('switch', { name: /Sabitle/ }).count()), 'üye sabitleme görmemeli');
    await dlg.getByLabel('Metin').fill('Yarın 10:00 müşteri toplantısı.\nSunum: https://ornek.com/sunum');
    await dlg.getByRole('switch', { name: /Önemli/ }).click();
    await dlg.getByLabel('Başlık').fill('Vatan sunumu yarın');
    await dlg.getByLabel('Başlık').press('Enter');
    await dlg.waitFor({ state: 'detached' });
    const card = P.page.locator('.dy-card').first();
    await card.getByText('Vatan sunumu yarın').waitFor();
    ok(await card.locator('.dy-flag.imp').count(), 'Önemli işareti yok');
    eq(await card.locator('.dy-body a').getAttribute('href'), 'https://ornek.com/sunum');
    ok((await card.locator('.dy-body').innerText()).includes('\n'), 'satır sonu korunmadı');
    await card.getByText(`1/${activeN}`).waitFor();
  });
  await t('Emre: Bugün ekranında bant canlı belirir (yenilemeden); "Okudum" → bant kaybolur', async () => {
    await M.page.locator('.dyb').getByText('Vatan sunumu yarın').waitFor({ timeout: 6000 });
    await shot(M.page, 'bugun-bant-koyu');
    await M.page.locator('.dyb').getByRole('button', { name: 'Okudum' }).click();
    await M.page.locator('.dyb').waitFor({ state: 'detached', timeout: 5000 });
  });
  await t('Pelin: okuma sayısı canlı güncellenir (2/N), "Kimler okumadı" + hatırlat', async () => {
    const card = P.page.locator('.dy-card').first();
    await card.getByText(`2/${activeN}`).waitFor({ timeout: 6000 });
    await card.getByRole('button', { name: /Kimler okumadı/ }).click();
    await card.locator('.dy-unread').getByText(/Yiğit/).waitFor();
    await card.getByRole('button', { name: 'Okumayanlara hatırlat' }).click();
    await P.page.locator('.snack, [role=status]').getByText(/hatırlatma gönderildi/).first().waitFor({ timeout: 4000 }).catch(() => {});
    ok(await until(() => sql("SELECT COUNT(*) AS n FROM notifications WHERE user_id='u_yigit' AND title LIKE 'Hatırlatma:%'")[0].n === 1), 'hatırlatma bildirimi yok');
    await shot(P.page, 'duyurular-koyu');
  });
  await t('Emre: kartında düzenle/sil yok, "Okudun" görünür', async () => {
    await M.page.getByRole('link', { name: 'Duyurular' }).first().click();
    const card = M.page.locator('.dy-card').first(); await card.waitFor();
    ok(!(await card.getByRole('button', { name: 'Düzenle' }).count()), 'Emre düzenleyememeli');
    await card.getByText('Okudun').waitFor();
  });
  await t('Pelin: düzenle → "düzenlendi"; Emre\'de canlı güncellenir', async () => {
    const card = P.page.locator('.dy-card').first();
    await card.getByRole('button', { name: 'Düzenle' }).click();
    const dlg = P.page.getByRole('dialog', { name: 'Duyuruyu düzenle' });
    await dlg.getByLabel('Başlık').fill('Vatan sunumu yarın 10:00');
    await dlg.getByRole('button', { name: 'Kaydet' }).click(); await dlg.waitFor({ state: 'detached' });
    await card.getByText('düzenlendi', { exact: false }).waitFor();
    await M.page.locator('.dy-card').getByText('Vatan sunumu yarın 10:00').waitFor({ timeout: 6000 });
  });

  const Yg = await mk('yigiitozdemir@gmail.com', 'Yiğit');
  await t('Yiğit: bildirim linkiyle açılır (?id=), kart vurgulanır; sabitler', async () => {
    const id = sql("SELECT id FROM duyurular LIMIT 1")[0].id;
    await go(Yg.page, '/duyurular?id=' + id);
    await Yg.page.locator(`#dy-${id}.flash`).waitFor({ timeout: 4000 });
    await Yg.page.locator(`#dy-${id}`).getByRole('button', { name: 'Sabitle' }).click();
    await Yg.page.locator(`#dy-${id} .dy-flag.pin`).waitFor();
    await Yg.page.locator(`#dy-${id}`).getByRole('button', { name: 'Okudum' }).click();
    await Yg.page.locator(`#dy-${id}`).getByText('Okudun').waitFor();
  });
  await t('Bugün bandı: yalnızca okunmamışlar (okunmuş sabit duyuru banttan kalkar), en çok 2 + "Tümü"', async () => {
    await Pe.post('/api/duyurular', { title: 'Kahve makinesi tamirde', body: 'Cuma gelecek.' });
    await Pe.post('/api/duyurular', { title: 'Yeni müşteri: Gizem Eczane', body: 'Hoş geldin postu perşembe.' });
    await go(Yg.page, '/');
    const band = Yg.page.locator('.dyb'); await band.waitFor();
    await band.locator('.dyb-item').nth(1).waitFor({ timeout: 6000 });
    eq(await band.locator('.dyb-item').count(), 2);
    await band.getByRole('link', { name: /^Tümü/ }).waitFor();
    eq(await band.locator('.dyb-item:not(.unread)').count(), 0, 'okunmuş duyuru bantta');
    await shot(Yg.page, 'bugun-bant-iki-koyu');
  });
  await t('Pelin: sil → onay penceresi → kaldırılır', async () => {
    await P.page.reload(); await P.page.locator('.shell').waitFor();
    const card = P.page.locator('.dy-card', { hasText: 'Kahve makinesi tamirde' });
    await card.getByRole('button', { name: 'Sil' }).click();
    const dlg = P.page.getByRole('dialog', { name: 'Silinsin mi?' });
    await dlg.getByRole('button', { name: 'Vazgeç' }).click(); await dlg.waitFor({ state: 'detached' });
    await card.getByRole('button', { name: 'Sil' }).click();
    await P.page.getByRole('dialog', { name: 'Silinsin mi?' }).getByRole('button', { name: 'Sil', exact: true }).click();
    await card.waitFor({ state: 'detached' });
  });
  await t('Arşiv: eski + okunmuş duyuru en altta kapalı "Arşiv" bölümünde', async () => {
    const r = await Pe.post('/api/duyurular', { title: 'Geçen ayın duyurusu' });
    sql(`UPDATE duyurular SET created_at = strftime('%Y-%m-%d %H:%M:%f', 'now', '-45 days') WHERE id = '${r.data.id}'`);
    await P.page.reload(); await P.page.locator('.shell').waitFor();
    const h = P.page.locator('.dy-archive-h'); await h.waitFor();
    ok(!(await P.page.getByText('Geçen ayın duyurusu').count()), 'arşiv kapalı başlamalı');
    await h.click(); await P.page.getByText('Geçen ayın duyurusu').waitFor();
  });

  // ---------- geri bildirim ----------
  await t('Emre: sol menüde "Geri bildirim" (Uygulamalar ile Görünüm arası) → modal', async () => {
    await M.page.goto(UI + '/isler'); await M.page.locator('.shell').waitFor();
    const order = await M.page.evaluate(() => { const side = document.querySelector('.side'); const kids = [...side.children]; return [kids.findIndex((k) => k.classList.contains('aiquick')), kids.findIndex((k) => k.classList.contains('gbd')), kids.findIndex((k) => k.classList.contains('themepick'))]; });
    ok(order[0] < order[1] && order[1] < order[2], 'sıra yanlış: ' + order);
    await M.page.locator('.gbd').click();
    await M.page.getByRole('dialog', { name: 'Geri bildirim' }).waitFor();
  });
  await t('Emre: tür İstek, mesaj, Ctrl+V ile görsel yapıştırır; sayfa/cihaz otomatik; gönderir → teşekkür', async () => {
    const dlg = M.page.getByRole('dialog', { name: 'Geri bildirim' });
    await dlg.getByRole('button', { name: 'Gönder' }).click();
    await dlg.getByRole('alert').getByText('Ne olduğunu kısaca yaz').waitFor();
    await dlg.getByRole('radio', { name: 'İstek' }).click();
    eq(await dlg.getByRole('radio', { name: 'İstek' }).getAttribute('aria-checked'), 'true');
    await dlg.getByLabel('Mesaj').fill('İş Planı\'nda müşteriye göre filtre olsa çok iyi olur.');
    const b64 = png(320, 180, [80, 120, 220]).toString('base64');
    await M.page.evaluate((b) => {
      const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      const dt = new DataTransfer(); dt.items.add(new File([u], 'image.png', { type: 'image/png' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }, b64);
    await dlg.locator('.gb-preview img').waitFor();
    ok((await dlg.locator('.gb-auto').innerText()).includes('/isler'), 'sayfa adresi yok');
    ok(/\d+×\d+ px/.test(await dlg.locator('.gb-auto').innerText()), 'cihaz bilgisi yok');
    await shot(M.page, 'geribildirim-modal-koyu');
    await dlg.getByRole('button', { name: 'Gönder' }).click();
    await dlg.getByText('Teşekkürler!').waitFor();
    const row = sql("SELECT * FROM geri_bildirimler WHERE kind='istek' AND user_id='u_emre'")[0];
    ok(row && row.image_key && row.page === '/isler' && row.device.includes('px'), JSON.stringify(row));
  });
  await t('Emre: "Gönderdiklerim" listesinde durumlarını ve yanıtı görür', async () => {
    const dlg = M.page.getByRole('dialog', { name: 'Geri bildirim' });
    await dlg.getByRole('button', { name: 'Gönderdiklerim' }).first().click();
    await dlg.locator('.gb-mine-i').nth(1).waitFor();
    await dlg.getByText('Baktım, yarın düzeliyor.').waitFor();
    await dlg.locator('.gb-mine-i').first().locator('.gb-durum', { hasText: 'Yeni' }).waitFor();
    await shot(M.page, 'geribildirim-gonderdiklerim-koyu');
    await M.page.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' });
  });
  await t('Emre (üye): /geri-bildirim sayfası açılmaz, menüde Yönetim yok', async () => {
    await go(M.page, '/geri-bildirim');
    ok(!(await M.page.getByRole('heading', { name: 'Geri bildirimler' }).count()), 'üye yönetici sayfasını görmemeli');
    ok(!(await M.page.locator('.nav').getByText('Geri bildirimler').count()), 'menüde olmamalı');
  });
  await t('Yiğit: Yönetim → Geri bildirimler; liste, sayılar, filtre', async () => {
    await Yg.page.locator('.nav').getByRole('link', { name: 'Geri bildirimler' }).click();
    await Yg.page.getByRole('heading', { name: 'Geri bildirimler' }).waitFor();
    await Yg.page.locator('.gb-row').nth(2).waitFor();
    eq(await Yg.page.locator('.gb-stat.yeni .gb-stat-n').innerText(), '2');
    await Yg.page.getByRole('radiogroup', { name: 'Tür' }).getByRole('radio', { name: 'Fikir' }).click();
    eq(await Yg.page.locator('.gb-row').count(), 1);
    await Yg.page.getByRole('radiogroup', { name: 'Tür' }).getByRole('radio', { name: 'Tümü' }).click();
    await shot(Yg.page, 'geribildirimler-koyu');
  });
  await t('Yiğit: detay — büyük görsel, sayfa/cihaz; durum "Yapıldı" + yanıt → Emre\'ye bildirim, canlı', async () => {
    await Yg.page.locator('.gb-row', { hasText: 'filtre olsa' }).click();
    const dlg = Yg.page.getByRole('dialog', { name: 'Geri bildirim' });
    await dlg.locator('.gb-big img').waitFor();
    ok(await dlg.locator('.gb-big img').evaluate((i) => i.complete && i.naturalWidth === 320), 'görsel yüklenmedi');
    await dlg.getByText('/isler').first().waitFor();
    await shot(Yg.page, 'geribildirim-detay-koyu');
    await dlg.getByRole('radio', { name: 'Yapıldı' }).click();
    await until(() => sql("SELECT status FROM geri_bildirimler WHERE kind='istek'")[0].status === 'yapildi');
    await dlg.getByLabel(/Yanıt notu/).fill('Ekledim, İş Planı\'nın üstünde.');
    await dlg.getByRole('button', { name: 'Yanıtı gönder' }).click();
    ok(await until(() => sql("SELECT COUNT(*) AS n FROM notifications WHERE user_id='u_emre' AND title LIKE 'Geri bildirimine yanıt: Ekledim%'")[0].n === 1), 'yanıt bildirimi yok');
    await Yg.page.keyboard.press('Escape');
    await Yg.page.locator('.dy-archive-h', { hasText: 'Tamamlanan' }).waitFor();
  });
  await t('Emre: bildirim linki (/?gb=) "Gönderdiklerim"i açar, yanıt görünür', async () => {
    const id = sql("SELECT id FROM geri_bildirimler WHERE kind='istek'")[0].id;
    await go(M.page, '/?gb=' + id);
    const dlg = M.page.getByRole('dialog', { name: 'Geri bildirim' }); await dlg.waitFor();
    await dlg.getByText('Ekledim, İş Planı\'nın üstünde.').waitFor();
    await dlg.locator('.gb-durum', { hasText: 'Yapıldı' }).first().waitFor();
    await M.page.keyboard.press('Escape');
  });
  await t('koyu tema kontrast ≥ 4.5 (Duyurular, Bugün bandı, Geri bildirimler, modal)', async () => {
    await go(Yg.page, '/duyurular'); await wait(400); contrast['koyu duyurular'] = await Yg.page.evaluate(AUDIT);
    await go(Yg.page, '/'); await wait(400); contrast['koyu bugün'] = await Yg.page.evaluate(AUDIT);
    await go(Yg.page, '/geri-bildirim'); await wait(400); contrast['koyu geri-bildirim'] = await Yg.page.evaluate(AUDIT);
    await Yg.page.locator('.gbd').click(); await wait(300); contrast['koyu modal'] = await Yg.page.evaluate(AUDIT); await Yg.page.keyboard.press('Escape');
    const bad = Object.entries(contrast).filter(([, v]) => v.length); ok(!bad.length, JSON.stringify(bad).slice(0, 400));
  });
  await t('açık tema: ekran görüntüleri + kontrast ≥ 4.5', async () => {
    await setTheme(Y, Yg.page, 'light');
    const out = {};
    await go(Yg.page, '/duyurular'); await wait(500); out.duyurular = await Yg.page.evaluate(AUDIT); await shot(Yg.page, 'duyurular-acik');
    await go(Yg.page, '/'); await wait(500); out.bugun = await Yg.page.evaluate(AUDIT); await shot(Yg.page, 'bugun-bant-acik');
    await go(Yg.page, '/geri-bildirim'); await wait(500); out.gb = await Yg.page.evaluate(AUDIT); await shot(Yg.page, 'geribildirimler-acik');
    await Yg.page.locator('.gb-row').first().click(); await wait(400); out.detay = await Yg.page.evaluate(AUDIT); await shot(Yg.page, 'geribildirim-detay-acik'); await Yg.page.keyboard.press('Escape');
    await Yg.page.locator('.gbd').click(); await wait(300); out.modal = await Yg.page.evaluate(AUDIT); await shot(Yg.page, 'geribildirim-modal-acik'); await Yg.page.keyboard.press('Escape');
    const bad = Object.entries(out).filter(([, v]) => v.length); ok(!bad.length, JSON.stringify(bad).slice(0, 400));
    await setTheme(Y, Yg.page, 'dark');
  });

  // ---------- telefon ----------
  const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
  const T = await mk('pelin@mayaajans.net', 'Pelin-tel', phone);
  await t('telefon (koyu): Duyurular, Bugün bandı — yatay taşma yok', async () => {
    await Pe.post('/api/duyurular', { title: 'Telefonda da okunuyor mu?', body: 'Uzun bir bağlantı: https://ekip.mayaajans.net/duyurular/cok/uzun/bir/adres/ornegi/burada' });
    await sql("UPDATE duyurular SET pinned = 0");
    await go(T.page, '/duyurular'); await T.page.locator('.dy-card').first().waitFor(); await wait(300);
    ok(await noHScroll(T.page), 'Duyurular yatay taşıyor'); await shot(T.page, 'tel-duyurular-koyu');
    await Y.post('/api/duyurular', { title: 'Önemli: Pazartesi toplantı 09:30', important: true });
    await go(T.page, '/'); await T.page.locator('.dyb').waitFor({ timeout: 6000 }); await wait(300);
    ok(await noHScroll(T.page), 'Bugün yatay taşıyor'); await shot(T.page, 'tel-bugun-bant-koyu');
  });
  await t('telefon: menü çekmecesinde "Geri bildirim" görünür, modal sığar', async () => {
    await T.page.getByRole('button', { name: 'Menü', exact: true }).click(); await wait(400);
    const btn = T.page.locator('.side .gbd'); await btn.scrollIntoViewIfNeeded(); ok(await btn.isVisible(), 'çekmecede görünmüyor');
    await shot(T.page, 'tel-menu-koyu');
    await btn.click(); const dlg = T.page.getByRole('dialog', { name: 'Geri bildirim' }); await dlg.waitFor(); await wait(300);
    const box = await dlg.boundingBox(); ok(box.x >= 0 && box.x + box.width <= 390, 'modal taşıyor');
    await shot(T.page, 'tel-geribildirim-koyu'); await T.page.keyboard.press('Escape');
  });
  await t('telefon (açık): Duyurular + Bugün + Geri bildirim modalı', async () => {
    await setTheme(Pe, T.page, 'light');
    await go(T.page, '/duyurular'); await T.page.locator('.dy-card').first().waitFor(); await wait(300);
    ok(await noHScroll(T.page)); await shot(T.page, 'tel-duyurular-acik');
    const a1 = await T.page.evaluate(AUDIT);
    await go(T.page, '/'); await T.page.locator('.dyb').waitFor(); await wait(300); await shot(T.page, 'tel-bugun-bant-acik');
    const a2 = await T.page.evaluate(AUDIT);
    await T.page.getByRole('button', { name: 'Menü', exact: true }).click(); await wait(300);
    await T.page.locator('.side .gbd').click(); await T.page.getByRole('dialog', { name: 'Geri bildirim' }).waitFor(); await wait(300);
    await shot(T.page, 'tel-geribildirim-acik');
    const a3 = await T.page.evaluate(AUDIT);
    ok(![...a1, ...a2, ...a3].length, JSON.stringify([...a1, ...a2, ...a3]).slice(0, 400));
    await setTheme(Pe, T.page, 'dark');
  });
  const Tg = await mk('yigiitozdemir@gmail.com', 'Yiğit-tel', phone);
  await t('telefon: yönetici Geri bildirimler sayfası taşmaz', async () => {
    await go(Tg.page, '/geri-bildirim'); await Tg.page.locator('.gb-row').first().waitFor(); await wait(300);
    ok(await noHScroll(Tg.page), 'taşıyor'); await shot(Tg.page, 'tel-geribildirimler-koyu');
    await Tg.page.locator('.gb-row').first().click(); await wait(400); await shot(Tg.page, 'tel-geribildirim-detay-koyu');
  });

  await t('konsol hatası yok', async () => ok(!errors.length, errors.slice(0, 5).join(' | ')));
  await browser.close();
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
