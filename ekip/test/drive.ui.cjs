// Drive önizlemeleri: sahte Drive yanıtlarıyla (DRIVE_SAHTE) — klasör, dosya, erişim yok, misafir sınırı, iş detayı arayüzü.
// Sunucu: wrangler dev ... --var DRIVE_SAHTE:'{"meta:<id>":{…},"liste:<id>":{files:[…]},"meta:<id>":403}'  (bkz. scratchpad srv-drive.sh)
// Çalıştırma: BASE=http://127.0.0.1:8899 PERSIST=<db> node test/drive.ui.cjs [ekran klasörü]
const { chromium } = require('playwright');
(async () => {
  const { t, ok, eq, done, loginAs, BASE, sql } = await import('./lib.mjs');
  const OUT = process.argv[2] || '.';
  const pelin = await loginAs('u_pelin', 'Pelin');
  const K = 'https://drive.google.com/drive/folders/KLASOR1abcdef?usp=sharing';
  const KAPALI = 'https://drive.google.com/drive/folders/KAPALIabcdef';
  const DOSYA = 'https://drive.google.com/file/d/DOSYA1abcdef/view';
  const onz = async (u) => (await pelin.get('/api/drive/onizleme?url=' + encodeURIComponent(u))).data;

  await t('klasör: ad, toplam, önizlemesi olanlar önce, en çok 12', async () => {
    const v = await onz(K);
    ok(v.aktif && v.tur === 'klasor' && v.ad === 'Vatan Kasım içerikleri', JSON.stringify(v).slice(0, 200));
    eq(v.toplam, 9); ok(v.dosyalar[0].kucuk, 'ilk dosyada küçük resim olmalı');
    ok(v.dosyalar.some((d) => d.tur === 'video') && v.dosyalar.some((d) => d.tur === 'belge'));
    eq(v.dosyalar.find((d) => d.tur === 'belge').kucuk, null);
  });
  await t('tek dosya linki', async () => { const v = await onz(DOSYA); ok(v.tur === 'dosya' && v.dosyalar.length === 1 && v.dosyalar[0].tur === 'gorsel'); });
  await t('paylaşıma kapalı klasör → erişim uyarısı; sonuç önbelleğe yazılır', async () => {
    eq((await onz(KAPALI)).hata, 'erisim');
    ok(JSON.stringify(sql("SELECT anahtar FROM drive_cache")).includes('klasor:KAPALIabcdef'), 'önbellek');
  });
  await t('Drive olmayan link ve bozuk link → kapalı', async () => {
    eq((await onz('https://example.com/x')).aktif, false);
    eq((await onz('javascript:alert(1)')).aktif, false);
    eq((await pelin.get('/api/drive/onizleme?url=' + 'a'.repeat(1200))).status, 400);
  });
  await t('girişsiz erişilemez', async () => { eq((await fetch(BASE + '/api/drive/onizleme?url=' + encodeURIComponent(K))).status, 401); });

  // arayüz: iş detayında
  sql(`UPDATE tasks SET link = '${K}' WHERE id = 't_004'`);
  sql(`UPDATE tasks SET link = '${KAPALI}' WHERE id = 't_003'`);
  const b = await chromium.launch();
  for (const [ad, vp, tema] of [['masaustu-koyu', { width: 1320, height: 900 }, 'dark'], ['telefon-acik', { width: 390, height: 844 }, 'light']]) {
    await t(`arayüz (${ad}): iş detayında Drive önizlemesi; kapalı klasörde açıklama`, async () => {
      const ctx = await b.newContext({ viewport: vp, isMobile: vp.width < 600, hasTouch: vp.width < 600 }); const p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(BASE + '/giris'); await p.fill('input[type=email]', 'pelin@mayaajans.net'); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
      await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
      await p.evaluate((th) => fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { theme: th } }) }), tema);
      await p.goto(BASE + '/isler?is=t_004'); await p.waitForSelector('.dv .dv-kare img');
      eq(await p.locator('.dv .dv-kare img').count(), 6); ok(await p.locator('.dv-fazla').isVisible(), '+N kutusu');
      ok((await p.locator('.dv-say').textContent()).includes('9 dosya'));
      ok(await p.locator('.dv-oynat').count() >= 1, 'video işareti');
      await p.waitForTimeout(400); await p.locator('.drawer').screenshot({ path: `${OUT}/drive-${ad}.png` });
      eq(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, true, 'yatay taşma');
      await p.goto(BASE + '/isler?is=t_003'); await p.waitForSelector('.dv-uyari');
      ok((await p.locator('.dv-uyari').textContent()).includes('paylaşıma kapalı'));
      eq(errs.length, 0, errs.join(' | '));
      await ctx.close();
    });
  }
  await b.close(); done();
})();
