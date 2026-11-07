// iPhone iyileştirmeleri: ana ekran simgesindeki sayı (setAppBadge) ve "aşağı çek, yenile".
// Çalıştırma: BASE=http://127.0.0.1:8899 PERSIST=<db> node test/iphone.ui.cjs [ekran klasörü]
const { chromium, devices } = require('playwright');
(async () => {
  const { t, ok, eq, done, loginAs, BASE, sql } = await import('./lib.mjs');
  const OUT = process.argv[2] || '.';
  const pelin = await loginAs('u_pelin', 'Pelin');
  sql("UPDATE notifications SET read_at = datetime('now') WHERE user_id = 'u_pelin'");
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 15 Pro'] });
  await ctx.addInitScript(() => {
    window.__rozet = [];
    navigator.setAppBadge = (n) => { window.__rozet.push(n ?? 0); return Promise.resolve(); };
    navigator.clearAppBadge = () => { window.__rozet.push(0); return Promise.resolve(); };
  });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/giris'); await p.fill('input[type=email]', 'pelin@mayaajans.net'); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
  await p.waitForURL((u) => !u.pathname.startsWith('/giris')); await p.waitForSelector('.mtop');

  const son = () => p.evaluate(() => window.__rozet[window.__rozet.length - 1]);
  await t('simge sayısı: okunmamış yokken temizlenir', async () => {
    await p.waitForFunction(() => window.__rozet.length > 0, null, { timeout: 8000 });
    const chat = await p.evaluate(() => 0);
    eq(await son(), chat, 'başlangıç');
  });
  await t('simge sayısı: yeni bildirim gelince artar, okununca azalır', async () => {
    const yigit = await loginAs('u_yigit', 'Yiğit');
    const r = await yigit.post('/api/tasks', { title: 'Rozet deneme işi', client: 'Nevvital', assigneeId: 'u_pelin', dueDate: '2026-12-20' });
    eq(r.status, 201);
    await p.waitForFunction(() => window.__rozet[window.__rozet.length - 1] >= 1, null, { timeout: 8000 });
    const n = await son(); ok(n >= 1, 'sayı ' + n);
    await p.evaluate(() => fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true }) }));
    await p.reload(); await p.waitForSelector('.mtop');
    await p.waitForFunction(() => window.__rozet[window.__rozet.length - 1] === 0, null, { timeout: 8000 });
  });

  const cdp = await ctx.newCDPSession(p);
  const dokun = async (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: 195, y }] });
  await t('aşağı çek, yenile: gösterge çıkar, veriler yeniden alınır', async () => {
    await p.evaluate(() => window.scrollTo(0, 0));
    let istek = 0; const say = (req) => { if (/\/api\/tasks(\?|$)/.test(req.url())) istek++; };
    p.on('request', say);
    await dokun('touchStart', 200);
    for (let y = 210; y <= 420; y += 15) await dokun('touchMove', y);
    await p.locator('.cy.hazir').waitFor({ timeout: 3000 });
    await p.screenshot({ path: `${OUT}/iphone-cek-yenile.png` });
    await dokun('touchEnd', 420);
    await p.locator('.cy.don').waitFor({ timeout: 3000 });
    await p.locator('.cy').waitFor({ state: 'detached', timeout: 6000 });
    ok(istek >= 1, 'işler yeniden alınmadı');
    p.off('request', say);
  });
  await t('kısa çekişte yenilemez; sayfa aşağıdayken çalışmaz', async () => {
    let istek = 0; const say = (req) => { if (/\/api\/tasks(\?|$)/.test(req.url())) istek++; };
    p.on('request', say);
    await dokun('touchStart', 200); for (let y = 205; y <= 260; y += 10) await dokun('touchMove', y); await dokun('touchEnd', 260);
    await p.waitForTimeout(900); eq(istek, 0, 'kısa çekiş');
    await p.goto(BASE + '/isler'); await p.waitForSelector('.mtop'); await p.waitForTimeout(600);
    istek = 0;
    await p.evaluate(() => { document.body.style.minHeight = '3000px'; window.scrollTo(0, 400); });
    await dokun('touchStart', 200); for (let y = 210; y <= 420; y += 15) await dokun('touchMove', y); await dokun('touchEnd', 420);
    await p.waitForTimeout(900); eq(await p.locator('.cy').count(), 0); eq(istek, 0, 'aşağıdayken');
    p.off('request', say);
  });
  await t('pencere açıkken çalışmaz', async () => {
    await p.evaluate(() => { document.body.style.minHeight = ''; window.scrollTo(0, 0); });
    await p.click('.mtop-btn[aria-label="Menü"]'); await p.waitForTimeout(400);
    await dokun('touchStart', 300); for (let y = 310; y <= 520; y += 15) await dokun('touchMove', y); await dokun('touchEnd', 520);
    await p.waitForTimeout(500); eq(await p.locator('.cy').count(), 0);
  });
  await t('sayfa hatası yok', async () => { eq(errs.length, 0, errs.join(' | ')); });
  await b.close(); done();
})();
