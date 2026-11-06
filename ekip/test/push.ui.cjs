// iPhone / tarayıcı bildirimleri arayüz testi (gerçek Chromium + service worker).
// Kullanım: BASE=http://127.0.0.1:8822 PERSIST=.wrangler/state-push UI=http://localhost:8922 \
//   NODE_PATH=$(npm root -g) node test/push.ui.cjs <ekran görüntüsü klasörü>
// Not: headless Chromium'da gerçek push servisi (FCM) yoksa pushManager.subscribe sayfa içinde taklit edilir;
// taklit abonelik, test içindeki sahte push sunucusuna (127.0.0.1) gerçek ECDH anahtarlarıyla bağlanır,
// böylece "Deneme bildirimi" düğmesinden gelen şifreli bildirim yine uçtan uca çözülerek doğrulanır.
const { chromium } = require('playwright');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { createECDH, createHmac, createDecipheriv, randomBytes } = require('node:crypto');

const UI = process.env.UI || 'http://localhost:8922';
const OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message.split('\n')[0]); console.log('  ✗ ' + name + ' → ' + (process.env.DEBUG ? e.message : e.message.split('\n')[0])); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await wait(100); } return false; }

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';

// ---------- sahte push sunucusu + alıcı anahtarları ----------
const got = [];
const srv = http.createServer((req, res) => { const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => { got.push({ url: req.url, headers: req.headers, body: Buffer.concat(ch) }); res.writeHead(201); res.end(); }); });
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const authSecret = randomBytes(16);
const KEYS = { p256dh: ecdh.getPublicKey().toString('base64url'), auth: authSecret.toString('base64url') };
const hm = (k, d) => createHmac('sha256', k).update(d).digest();
function decrypt(body) {
  const salt = body.subarray(0, 16), idlen = body[20], asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const ikm = hm(hm(authSecret, ecdh.computeSecret(asPub)), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPub, Buffer.from([1])])).subarray(0, 32);
  const prk = hm(salt, ikm);
  const cek = hm(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16);
  const nonce = hm(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(pt.subarray(0, pt.lastIndexOf(2)).toString('utf8'));
}

// sayfa içinde push aboneliği taklidi (yalnızca gerçek push servisi yoksa)
const STUB = ({ endpoint, keys }) => {
  const make = (appKey) => ({
    endpoint, expirationTime: null, options: { userVisibleOnly: true, applicationServerKey: appKey },
    toJSON() { return { endpoint, expirationTime: null, keys }; },
    async unsubscribe() { try { localStorage.removeItem('__stubsub'); } catch (e) {} window.__stubsub = null; return true; },
  });
  const keyFrom = (k) => (k instanceof ArrayBuffer ? k : k.buffer.slice(k.byteOffset, k.byteOffset + k.byteLength));
  if (typeof PushManager === 'undefined') return;
  PushManager.prototype.subscribe = async function (o) { window.__subscribeCalls = (window.__subscribeCalls || 0) + 1; const k = keyFrom(o.applicationServerKey); try { localStorage.setItem('__stubsub', JSON.stringify(Array.from(new Uint8Array(k)))); } catch (e) {} return (window.__stubsub = make(k)); };
  PushManager.prototype.getSubscription = async function () {
    if (window.__stubsub) return window.__stubsub;
    try { const s = localStorage.getItem('__stubsub'); if (s) return (window.__stubsub = make(new Uint8Array(JSON.parse(s)).buffer)); } catch (e) {}
    return null;
  };
};

(async () => {
  const { loginAs, sql } = await import('./lib.mjs');
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const ENDPOINT = `http://127.0.0.1:${srv.address().port}/push/ui`;
  await loginAs('u_pelin', 'Pelin');
  sql("DELETE FROM push_subscriptions; UPDATE users SET settings = '{}' WHERE id = 'u_pelin'");
  // push.e2e'nin 300 harflik bölünmez başlığı telefon düzenini taşırıyor (Bugün sayfası) — bu testte kaldır
  sql("DELETE FROM tasks WHERE title LIKE 'ÇÇÇÇÇÇÇÇÇÇ%'");
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'push-' + n + '.png') });
  const errors = [];

  // Eski headless kabuk (varsayılan) bildirim iznini her zaman 'denied' gösterir ve showNotification çalışmaz;
  // yeni headless ('chromium' kanalı) gerçek tarayıcı gibi davranır. Yoksa varsayılana düşer.
  const browser = await chromium.launch({ channel: 'chromium' }).catch(() => chromium.launch());
  async function mk(name, { ua, viewport = { width: 1360, height: 860 }, grant = true, init = [], color = 'light' } = {}) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', userAgent: ua, colorScheme: color, ...(ua === IPHONE_UA ? { isMobile: true, hasTouch: true } : {}) });
    if (grant) await ctx.grantPermissions(['notifications'], { origin: UI });
    for (const [fn, arg] of init) await ctx.addInitScript(fn, arg);
    const page = await ctx.newPage();
    page.on('crash', () => errors.push(name + ': SAYFA ÇÖKTÜ'));
    page.on('close', () => process.env.DEBUG && console.log('    [kapandı] ' + name));
    page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|status of 401|Push API in incognito/.test(m.text())) errors.push(name + ': ' + m.text()); });
    await page.goto(UI + '/giris');
    await page.getByLabel('E-posta').fill('pelin@mayaajans.net');
    await page.getByLabel('Şifre', { exact: true }).fill('TestSifre123');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.locator('.shell').waitFor({ timeout: 10000 });
    return { ctx, page };
  }
  const openProfile = async (p) => { await p.getByRole('button', { name: 'Profilimi düzenle' }).click(); await p.getByRole('dialog').or(p.locator('.dialog')).first().waitFor(); };
  const subCount = () => sql("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 'u_pelin'")[0].n;

  // ---------- 0) gerçek push servisi var mı? ----------
  let realPush = false, realErr = '';
  {
    const { ctx, page } = await mk('probe');
    const r = await page.evaluate(async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
        const k = (await (await fetch('/api/push/key')).json()).key;
        const b = Uint8Array.from(atob(k.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
        const s = await Promise.race([reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b }), new Promise((_, j) => setTimeout(() => j(new Error('zaman aşımı')), 8000))]);
        const ep = s.endpoint; await s.unsubscribe(); return { ok: true, ep };
      } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
    });
    realPush = r.ok; realErr = r.err || r.ep;
    console.log(`\n(headless Chromium push servisi: ${r.ok ? 'VAR → ' + r.ep.slice(0, 50) : 'YOK → ' + r.err}; ${r.ok ? 'gerçek abonelik' : 'abonelik taklit edilecek'})`);
    await ctx.close();
  }
  const stubInit = [[STUB, { endpoint: ENDPOINT, keys: KEYS }]];

  // ---------- 1) masaüstü Chromium ----------
  console.log('\nMasaüstü tarayıcı (Chromium)');
  const D = await mk('masaüstü', { init: stubInit });
  const dp = D.page;
  await t('service worker kaydoldu (/sw.js, kapsam /)', async () => {
    ok(await until(() => dp.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration('/'); return !!(r && r.active && r.active.scriptURL.endsWith('/sw.js')); })), 'kayıt yok');
  });
  await t('masaüstünde öneri bandı görünmez (yalnızca iPhone ana ekran)', async () => { ok(!(await dp.locator('.push-banner').isVisible())); });
  await openProfile(dp);
  const sw = () => dp.getByRole('switch', { name: /Bu cihaza bildirim gönder/ });
  await t('Profilim: "Bu cihaza bildirim gönder" kapalı görünür', async () => {
    await sw().waitFor(); ok((await sw().getAttribute('aria-checked')) === 'false');
    ok(await dp.getByText('Atama, hatırlatma, dürtme… bu cihaza da gelsin').isVisible());
  });
  await shot(dp, 'profil-kapali');
  await t('anahtar açılınca abone olur ve sunucuya kaydedilir', async () => {
    await sw().click();
    ok(await until(() => sw().getAttribute('aria-checked').then((v) => v === 'true')), 'açılmadı');
    ok(await until(() => subCount() === 1, 4000), 'kayıt yok');
    const row = sql("SELECT endpoint, device FROM push_subscriptions WHERE user_id = 'u_pelin'")[0];
    if (!realPush) ok(row.endpoint === ENDPOINT, row.endpoint);
    ok(/Chrome|Chromium|Tarayıcı/.test(row.device) || row.device.length > 0, 'cihaz adı: ' + row.device);
    ok(await dp.getByText(/bildirim alıyor/).isVisible(), 'durum metni');
  });
  await t('"Deneme bildirimi gönder" → şifreli bildirim cihaza ulaşır', async () => {
    const n0 = got.length;
    await dp.getByRole('button', { name: 'Deneme bildirimi gönder' }).click();
    if (realPush) { ok(await dp.getByText(/Deneme bildirimi gönderildi|gönderilemedi/).isVisible()); return; }
    ok(await until(() => got.length > n0), 'push gelmedi');
    const p = decrypt(got[got.length - 1].body);
    ok(p.title === 'Deneme bildirimi' && /Pelin/.test(p.body), JSON.stringify(p));
    ok(await until(() => dp.locator('.snack').filter({ hasText: 'Deneme bildirimi gönderildi' }).isVisible()), 'snack');
    await dp.locator('.snack').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {});
  });
  await shot(dp, 'profil-acik');
  // kontrast (açık + koyu) — Profilim penceresi
  const audit = (pg = dp) => pg.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(',').map((x) => parseFloat(x)); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
    const bgOf = (el) => { const st = []; for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('gradient')) return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) { st.push(c); if (c.a >= 1) break; } } let base = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 }; for (let i = st.length - 1; i >= 0; i--) base = blend(st[i], base); return base; };
    const bad = []; const root = document.querySelector('.push-toggle, .push-note, .push-banner')?.closest('.dialog') || document.querySelector('.push-banner') || document.body;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const seen = new Set();
    while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim()) continue; const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue; const cs = getComputedStyle(el); if (cs.visibility === 'hidden') continue; if (el.closest('[aria-hidden="true"]')) continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      const fg0 = parse(cs.color); const bg = bgOf(el); if (!fg0 || !bg) continue; const fg = blend({ ...fg0, a: fg0.a * op }, bg);
      const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05); const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5; if (ratio < need) bad.push(`${ratio.toFixed(2)} "${n.textContent.trim().slice(0, 30)}"`); }
    return bad;
  });
  const setTheme = async (p, name) => { await p.evaluate((n) => { document.documentElement.setAttribute('data-theme', n); }, name); await p.waitForTimeout(700); };
  await t('kontrast: Profilim (açık tema) 4.5 üstü', async () => { const b = await audit(); ok(!b.length, b.join(' | ')); });
  await setTheme(dp, 'dark');
  await t('kontrast: Profilim (koyu tema) 4.5 üstü', async () => { const b = await audit(); ok(!b.length, b.join(' | ')); });
  await shot(dp, 'profil-koyu');
  await setTheme(dp, 'light');

  // service worker push olayı → bildirim gösterimi (CDP ile gerçek push olayı)
  await t('service worker: push olayı bildirimi doğru başlık/ikon/link ile gösterir (sekme arka plandayken)', async () => {
    const cdp = await D.ctx.newCDPSession(dp);
    const regs = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations));
    await cdp.send('ServiceWorker.enable');
    ok(await until(() => regs.some((r) => r.scopeURL.startsWith(UI)), 3000), 'kayıt kimliği yok');
    const reg = regs.find((r) => r.scopeURL.startsWith(UI));
    // uygulama önde değilken: başka bir sekme öne gelsin
    const other = await D.ctx.newPage(); await other.goto('about:blank'); await other.bringToFront();
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(UI).origin, registrationId: reg.registrationId, data: JSON.stringify({ title: 'Sana yeni iş atandı', body: 'Reels kurgusu · Gizem', link: '/isler?is=t_x', tag: 'assign' }) });
    let notes = [];
    ok(await until(async () => { notes = await dp.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ title: n.title, body: n.body, icon: n.icon, tag: n.tag, data: n.data }))); return notes.length > 0; }, 4000), 'bildirim gösterilmedi');
    const n = notes[0];
    ok(n.title === 'Sana yeni iş atandı' && n.body === 'Reels kurgusu · Gizem', JSON.stringify(n));
    ok(n.icon.endsWith('/icon-192.png') && n.data.link === '/isler?is=t_x' && n.tag === 'assign:/isler?is=t_x', JSON.stringify(n));
    await other.close(); await dp.bringToFront();
  });
  await t('bildirime tıklayınca açık pencere o sayfaya gider (notificationclick → postMessage)', async () => {
    const [w] = D.ctx.serviceWorkers();
    ok(w, 'service worker yok');
    await w.evaluate(async () => {
      const [n] = await self.registration.getNotifications();
      self.dispatchEvent(new NotificationEvent('notificationclick', { notification: n }));
    });
    ok(await until(() => dp.evaluate(() => location.pathname + location.search === '/isler?is=t_x')), 'yönlenmedi: ' + await dp.evaluate(() => location.href));
    ok(await until(() => dp.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length === 0)), 'bildirim kapanmadı');
  });
  await t('uygulama öndeyken (odaklı) push ekranda tekrar gösterilmez (açılır bildirim yeter)', async () => {
    const [w] = D.ctx.serviceWorkers();
    const focused = await w.evaluate(async () => (await self.clients.matchAll({ type: 'window' })).some((c) => c.focused && c.visibilityState === 'visible'));
    if (!focused) { console.log('    (headless sekme odaklı sayılmadı; bu kontrol atlandı)'); return; }
    const cdp = await D.ctx.newCDPSession(dp); const regs = [];
    cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => regs.push(...e.registrations)); await cdp.send('ServiceWorker.enable');
    await until(() => regs.length > 0, 2000);
    await cdp.send('ServiceWorker.deliverPushMessage', { origin: new URL(UI).origin, registrationId: regs[0].registrationId, data: JSON.stringify({ title: 'x', body: 'y', link: '/', tag: 'test' }) });
    await wait(800);
    ok((await dp.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length)) === 0);
  });
  await t('anahtar kapatılınca abonelik silinir', async () => {
    await dp.goto(UI + '/'); await dp.locator('.shell').waitFor();
    await openProfile(dp);
    ok(await until(() => sw().getAttribute('aria-checked').then((v) => v === 'true')), 'yeniden açılışta açık görünmeli');
    await sw().click();
    ok(await until(() => sw().getAttribute('aria-checked').then((v) => v === 'false')));
    ok(await until(() => subCount() === 0, 4000), 'silinmedi');
  });
  await D.ctx.close();

  // ---------- 2) izin reddedilmiş ----------
  console.log('\nİzin reddedilmiş');
  {
    const { ctx, page } = await mk('reddedildi', { grant: false, init: [...stubInit, [() => { Object.defineProperty(Notification, 'permission', { get: () => 'denied' }); Notification.requestPermission = async () => 'denied'; }, null]] });
    await openProfile(page);
    await t('izin verilmemiş notu ve nasıl açılacağı', async () => {
      await page.getByText('İzin verilmemiş').waitFor();
      ok(await page.getByText(/kilit simgesine tıkla → Bildirimler → İzin ver/).isVisible());
    });
    await shot(page, 'izin-yok');
    await ctx.close();
  }

  // ---------- 3) iPhone Safari (ana ekrana eklenmemiş) ----------
  console.log('\niPhone Safari (ana ekrana eklenmemiş)');
  {
    const { ctx, page } = await mk('iphone-safari', { ua: IPHONE_UA, viewport: { width: 390, height: 844 }, grant: false, init: [[() => { delete window.PushManager; Object.defineProperty(navigator, 'standalone', { get: () => false }); }, null]] });
    await t('öneri bandı görünmez', async () => { await wait(800); ok(!(await page.locator('.push-banner').isVisible())); });
    await openProfile(page);
    await t('Profilim: "Paylaş → Ana Ekrana Ekle" yönlendirmesi', async () => {
      const note = page.locator('.push-note');
      await note.waitFor();
      ok(/Paylaş.*Ana Ekrana Ekle/.test(await note.innerText()), await note.innerText());
      ok(!(await page.getByRole('switch', { name: /bildirim gönder/ }).count()), 'anahtar görünmemeli');
    });
    await t('kontrast: iPhone notu (açık/koyu)', async () => {
      await page.waitForTimeout(700); let b = await audit(page); ok(!b.length, 'açık ' + b.join(' | '));
      await setTheme(page, 'dark'); b = await audit(page); ok(!b.length, 'koyu ' + b.join(' | '));
    });
    await shot(page, 'iphone-safari-koyu');
    await setTheme(page, 'light');
    await page.locator('.push-note').scrollIntoViewIfNeeded();
    await shot(page, 'iphone-safari');
    await ctx.close();
  }

  // ---------- 4) iPhone ana ekran uygulaması ----------
  console.log('\niPhone ana ekran uygulaması');
  const standalone = [() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); }, null];
  {
    sql("DELETE FROM push_subscriptions");
    const { ctx, page } = await mk('iphone-app', { ua: IPHONE_UA, viewport: { width: 390, height: 844 }, init: [...stubInit, standalone] });
    const banner = page.locator('.push-banner');
    await t('abone değilken "Telefonuna bildirim gelsin mi?" bandı görünür', async () => {
      await banner.waitFor({ timeout: 5000 });
      ok((await banner.innerText()).includes('Telefonuna bildirim gelsin mi?'));
    });
    await shot(page, 'iphone-bant');
    await t('kontrast: bant (açık/koyu)', async () => {
      await page.waitForTimeout(700); let b = await audit(page); ok(!b.length, 'açık ' + b.join(' | '));
      await setTheme(page, 'dark'); b = await audit(page); ok(!b.length, 'koyu ' + b.join(' | '));
    });
    await shot(page, 'iphone-bant-koyu');
    await setTheme(page, 'light');
    await t('kapatınca gizlenir ve yeniden açılışta bir daha görünmez', async () => {
      await banner.getByRole('button', { name: 'Kapat' }).click();
      ok(!(await banner.isVisible()));
      await page.reload(); await page.locator('.shell').waitFor(); await wait(1200);
      ok(!(await banner.isVisible()), 'yeniden göründü');
    });
    await openProfile(page);
    await t('Profilim: "Bu iPhone’a bildirim gönder" anahtarı', async () => {
      await page.getByRole('switch', { name: 'Bu iPhone’a bildirim gönder' }).waitFor();
    });
    await shot(page, 'iphone-profil');
    await ctx.close();
  }
  {
    sql("DELETE FROM push_subscriptions");
    const { ctx, page } = await mk('iphone-app2', { ua: IPHONE_UA, viewport: { width: 390, height: 844 }, init: [...stubInit, standalone] });
    await t('bantta "Aç" → izin + abonelik, bant kaybolur', async () => {
      const banner = page.locator('.push-banner');
      await banner.waitFor({ timeout: 5000 });
      await banner.getByRole('button', { name: 'Aç' }).click();
      ok(await until(() => subCount() === 1, 5000), 'abonelik yok');
      ok(sql("SELECT device FROM push_subscriptions")[0].device === 'iPhone', 'cihaz adı iPhone olmalı');
      ok(await until(async () => !(await banner.isVisible())), 'bant kaybolmadı');
    });
    await ctx.close();
  }

  // ---------- 5) Mac programı taklidi ----------
  console.log('\nMac programı (window.__TAURI__)');
  {
    sql("DELETE FROM push_subscriptions");
    const tauri = [() => { window.__TAURI__ = { core: { invoke: async () => undefined } }; }, null];
    const { ctx, page } = await mk('mac', { ua: IPHONE_UA, viewport: { width: 1200, height: 800 }, init: [tauri, standalone] });
    await t('bant yok, service worker kaydı yok', async () => {
      await wait(1200);
      ok(!(await page.locator('.push-banner').count()), 'bant var');
      ok((await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)) === 0, 'kayıt var');
    });
    await openProfile(page);
    await t('Profilim\'de push önerisi yok', async () => {
      await page.getByText('Okumadığım atamaları saatte bir hatırlat').waitFor();
      ok(!(await page.locator('.push-toggle, .push-note').count()), 'push öğesi var');
    });
    await shot(page, 'mac-profil');
    await ctx.close();
  }

  await t('konsol hatası yok', async () => ok(!errors.length, errors.join(' | ')));
  await browser.close(); srv.close();
  console.log(`\n(push servisi: ${realPush ? 'gerçek' : 'taklit — ' + realErr})`);
  console.log(`GEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
