// Bugün sayfasında küçük çekim takvimi: yalnızca Yiğit, Emre, Volkan'da; gün seçimi; çekime tıklayınca Çekim Planı.
// Çalıştırma: BASE=http://127.0.0.1:8899 PERSIST=<db> node test/bugun-cekim.ui.cjs [ekran klasörü]
const { chromium } = require('playwright');
(async () => {
  const { t, ok, eq, done, loginAs, BASE, sql } = await import('./lib.mjs');
  const OUT = process.argv[2] || '.';
  const ist = (n) => new Date(Date.now() + 3 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  await loginAs('u_emre', 'Emre'); await loginAs('u_pelin', 'Pelin'); await loginAs('u_yigit', 'Yiğit');
  sql(`INSERT INTO shoots (id, title, client, date, time, location, crew, status) VALUES ('s_b1', 'Bugün çekimi', 'Nevvital', '${ist(0)}', '14:00', 'Stüdyo', '["u_emre","u_volkan"]', 0), ('s_b2', 'Yarın dış çekim', 'Vatan Hastanesi', '${ist(1)}', '10:00', 'Kapaklı', '["u_emre"]', 0), ('s_b3', 'İptal olan', 'Nevvital', '${ist(2)}', '11:00', '', '[]', 2)`);
  const b = await chromium.launch();
  const ac = async (email, vp, tema) => {
    const ctx = await b.newContext({ viewport: vp, isMobile: vp.width < 600, hasTouch: vp.width < 600 }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/giris'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
    await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
    await p.evaluate((th) => fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { theme: th } }) }), tema);
    await p.reload(); await p.waitForSelector('.page h1'); return { p, ctx, errs };
  };
  await t('Emre: Bugün sayfasında küçük takvim + yaklaşan çekimler (iptal yok)', async () => {
    const { p, ctx, errs } = await ac('emre@mayaajans.net', { width: 1360, height: 900 }, 'dark');
    const k = p.locator('section.bct'); await k.waitFor({ timeout: 8000 });
    ok(await k.locator('.ck-cal').count() === 1, 'takvim');
    const txt = await k.innerText();
    ok(txt.includes('Bugün çekimi') && txt.includes('Yarın dış çekim') && !txt.includes('İptal olan'), txt);
    await k.scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
    await k.screenshot({ path: `${OUT}/bugun-cekim-takvimi-koyu.png` });
    // gün seç → o günün çekimleri
    await k.locator('.ck-day.has').nth(1).click();
    ok((await k.locator('.bct-it').count()) >= 1);
    await k.getByRole('button', { name: 'Yaklaşanlar' }).click();
    await k.locator('.bct-it', { hasText: 'Yarın dış çekim' }).click();
    await p.waitForURL((u) => u.pathname === '/cekim' && u.search.includes('s_b2'));
    eq(errs.length, 0, errs.join(' | ')); await ctx.close();
  });
  await t('Pelin: Bugün sayfasında çekim takvimi yok', async () => {
    const { p, ctx } = await ac('pelin@mayaajans.net', { width: 1360, height: 900 }, 'dark');
    await p.waitForTimeout(1500); eq(await p.locator('section.bct').count(), 0); await ctx.close();
  });
  await t('Yiğit telefonda (açık tema): alt alta, yatay taşma yok', async () => {
    const { p, ctx, errs } = await ac('yigiitozdemir@gmail.com', { width: 390, height: 844 }, 'light');
    const k = p.locator('section.bct'); await k.waitFor({ timeout: 8000 });
    eq(await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, true, 'taşma');
    await k.scrollIntoViewIfNeeded(); await p.waitForTimeout(500);
    await k.screenshot({ path: `${OUT}/bugun-cekim-takvimi-telefon-acik.png` });
    eq(errs.length, 0, errs.join(' | ')); await ctx.close();
  });
  await b.close(); done();
})();
