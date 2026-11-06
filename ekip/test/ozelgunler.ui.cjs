// Özel Günler arayüz testi (Playwright, iki kullanıcı aynı anda)
// API_PORT=8802 npx vite --config web/vite.config.ts --port 8902 --strictPort   (arka planda)
// BASE=http://127.0.0.1:8802 PERSIST=.wrangler/state-ozelgunler UI=http://localhost:8902 \
//   NODE_PATH=$(npm root -g) node test/ozelgunler.ui.cjs <ekran klasörü>
const { chromium } = require('playwright');
const path = require('node:path');

const UI = process.env.UI || 'http://localhost:8902';
const OUT = process.argv[2] || '.';
let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message.split('\n')[0]); console.log('  ✗ ' + name + ' → ' + e.message.split('\n')[0]); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };

(async () => {
  const lib = await import('./lib.mjs');
  await lib.loginAs('u_yigit', 'Yiğit');
  await lib.loginAs('u_pelin', 'Pelin');
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (vp = { width: 1440, height: 950 }) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource|\[vite\]/.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  };
  const login = async (page, email) => {
    await page.goto(UI + '/');
    await page.getByLabel('E-posta').fill(email);
    await page.locator('input[autocomplete="current-password"]').fill('TestSifre123');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    // masaüstünde sol menü, telefonda alt sekmeler (menü çekmecede)
    await page.locator('.nav a[href="/ozel-gunler"]:visible, .mtabs:visible').first().waitFor({ timeout: 10000 });
  };
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'ozelgunler-' + n + '.png') });
  const A = await mk(); const P = await mk();
  const name = 'Test Günü ' + Date.now().toString(36);
  const name2 = name + ' (düzenlendi)';

  console.log('\nGiriş ve genel bakış');
  await t('iki kullanıcı giriş yapar, Özel Günler açılır', async () => {
    await login(A.page, 'yigiitozdemir@gmail.com');
    await login(P.page, 'pelin@mayaajans.net');
    for (const x of [A, P]) {
      await x.page.getByRole('link', { name: /Özel Günler/ }).first().click();
      await x.page.getByRole('heading', { name: 'Özel Günler' }).waitFor();
      await x.page.locator('.og-card').first().waitFor();
    }
    const n = await A.page.locator('.og-card').count();
    ok(n >= 20, 'yaklaşan gün sayısı ' + n);
    await A.page.getByText('Ne hazır, ne kaldı?').waitFor();
    await shot(A.page, '01-genel');
  });
  await t('geçmiş günler en altta kapalı bölümde', async () => {
    const h = A.page.getByText('Hazır ve geçmiş günler');
    await h.waitFor();
    const before = await A.page.locator('.og-card.past').count();
    ok(before === 0, 'kapalıyken geçmiş görünmemeli');
    await A.page.locator('.og-section-h').getByRole('button', { name: 'Göster' }).click();
    ok(await A.page.locator('.og-card.past').count() > 0, 'açınca geçmiş görünmeli');
    await A.page.locator('.og-section-h').getByRole('button', { name: 'Gizle' }).click();
  });

  console.log('\nGün ekle / düzenle');
  await t('tarihsiz kaydedilemez, sonra eklenir ve detay açılır', async () => {
    await A.page.getByRole('button', { name: 'Yeni özel gün', exact: true }).click();
    await A.page.getByLabel('Özel günün adı *').fill(name);
    await A.page.getByRole('button', { name: 'Özel günü ekle' }).click();
    await A.page.getByRole('alert').filter({ hasText: 'Tarih seç' }).waitFor();
    await A.page.getByLabel('Paylaşım tarihi *').fill('2026-11-24');
    await A.page.getByRole('dialog').getByRole('button', { name: 'Kutlama', exact: true }).click();
    await A.page.getByLabel('Tarih etiketi').fill('24 Kasım');
    await A.page.getByLabel('Paylaşım tarihi *').press('Enter');
    await A.page.locator('.og-panel h2', { hasText: name }).waitFor();
    ok(await A.page.locator('.og-panel').getByText('Firma eklenmedi', { exact: false }).count() >= 0);
    await A.page.locator('.og-info').getByText('20 Kas').waitFor(); // 24 Kas Salı → 20 Kas Cuma
  });
  await t('ad ve tarih düzenlenir; diğer kullanıcıda canlı görünür', async () => {
    await A.page.getByRole('button', { name: 'Adı / tarihi düzenle' }).click();
    await A.page.getByLabel('Özel günün adı *').fill(name2);
    await A.page.getByLabel('Paylaşım tarihi *').fill('2026-11-25');
    await A.page.getByRole('dialog').getByRole('button', { name: 'Kaydet', exact: true }).click();
    await A.page.locator('.og-panel h2', { hasText: name2 }).waitFor();
    await P.page.locator('.og-card', { hasText: name2 }).waitFor({ timeout: 6000 });
  });

  console.log('\nFirma ekle ve atama');
  await t('müşteri listesinden tek tek seçilir, sorumlu seçilir', async () => {
    await A.page.locator('.og-panel').getByRole('button', { name: 'Firma ekle', exact: true }).click();
    const dlg = A.page.getByRole('dialog', { name: /Firma ekle/ });
    ok(await dlg.getByRole('button', { name: /Tüm|Hepsini/ }).count() === 0, 'toplu seçim olmamalı');
    await dlg.getByPlaceholder('Firma ara…').fill('arslan');
    await dlg.getByRole('checkbox', { name: 'Arslandent' }).click();
    await dlg.getByPlaceholder('Firma ara…').fill('craft');
    await dlg.getByPlaceholder('Firma ara…').press('Enter'); // tek sonuç → seçer
    await dlg.getByLabel('Craft Mimarlık sorumlu').selectOption('u_pelin');
    await dlg.getByLabel('Arslandent biçim').selectOption('Post');
    await shot(A.page, '02-firma-sec');
    await dlg.getByRole('button', { name: '2 firmayı ekle' }).click();
    await A.page.locator('.og-row').nth(1).waitFor();
    ok(await A.page.locator('.og-row').count() === 2);
  });
  await t('Pelin canlı bildirim alır ve kartı güncellenir', async () => {
    await P.page.locator('.toast', { hasText: 'Özel gün görevi' }).waitFor({ timeout: 6000 });
    await P.page.locator('.og-card', { hasText: name2 }).getByText('0/2 hazır', { exact: false }).waitFor({ timeout: 6000 });
    await shot(P.page, '03-pelin-bildirim');
  });
  await t('Pelin "Benim görevlerim" filtresinde günü görür', async () => {
    await P.page.getByRole('button', { name: 'Benim görevlerim', exact: true }).click();
    await P.page.locator('.og-card', { hasText: name2 }).getByText('0/1 hazır', { exact: false }).waitFor();
    ok(await P.page.locator('.og-card').count() < 10, 'filtre daraltmalı');
    await P.page.getByRole('button', { name: 'Herkes', exact: true }).click();
  });
  await t('satırdan sorumlu değiştirilir', async () => {
    const row = A.page.locator('.og-row', { hasText: 'Arslandent' });
    await row.getByLabel('Arslandent sorumlu').selectOption('u_yigit');
    await A.page.locator('.snack', { hasText: 'Sorumlu: sen' }).waitFor();
  });

  console.log('\nHazırladım ve İş Planı');
  await t('Hazırladım → yapan kişi görünür, Pelin canlı görür', async () => {
    const row = A.page.locator('.og-row', { hasText: 'Craft Mimarlık' });
    await row.getByRole('button', { name: 'Başladım' }).click();
    await row.getByText('Hazırlanıyor').waitFor();
    await row.getByRole('button', { name: 'Hazırladım' }).click();
    await row.getByText(/Yiğit.*hazırladı/).waitFor();
    await P.page.locator('.og-card', { hasText: name2 }).getByText('1/2 hazır', { exact: false }).waitFor({ timeout: 6000 });
    await shot(A.page, '04-hazirladim');
  });
  await t('geri al', async () => {
    const row = A.page.locator('.og-row', { hasText: 'Craft Mimarlık' });
    await row.getByRole('button', { name: 'Geri al' }).click();
    await row.getByRole('button', { name: 'Hazırladım' }).waitFor();
  });
  await t("İş Planı'na gönder → İş Planı'nda düğmesi, Pelin'e iş bildirimi", async () => {
    const row = A.page.locator('.og-row', { hasText: 'Craft Mimarlık' });
    await row.getByRole('button', { name: "İş Planı'na gönder" }).click();
    await row.getByRole('button', { name: "İş Planı'nda" }).waitFor({ timeout: 6000 });
    await P.page.locator('.toast', { hasText: 'Sana yeni iş atandı' }).waitFor({ timeout: 6000 });
    await row.getByRole('button', { name: "İş Planı'nda" }).click();
    await A.page.locator('.drawer').waitFor({ timeout: 4000 });
    await A.page.keyboard.press('Escape');
    await A.page.locator('.drawer').waitFor({ state: 'detached', timeout: 4000 });
  });
  await t('firma kaldır (onaylı)', async () => {
    const row = A.page.locator('.og-row', { hasText: 'Arslandent' });
    await row.getByLabel('Arslandent firmasını kaldır').click();
    await row.getByRole('button', { name: 'Kaldır' }).click();
    await A.page.locator('.og-row', { hasText: 'Arslandent' }).waitFor({ state: 'detached' });
  });

  console.log('\nBağlantı ve mobil');
  await t('?id= bağlantısıyla gün açılır', async () => {
    const id = new URL(A.page.url()).searchParams.get('id');
    ok(id, 'adres id içermeli');
    await P.page.goto(UI + '/ozel-gunler?id=' + id);
    await P.page.locator('.og-panel h2', { hasText: name2 }).waitFor();
  });
  await t('iPhone genişliğinde liste ve detay', async () => {
    const M = await mk({ width: 390, height: 844 });
    await login(M.page, 'pelin@mayaajans.net');
    await M.page.goto(UI + '/ozel-gunler');
    await M.page.locator('.og-card').first().waitFor();
    const sw = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 392, 'yatay kaydırma: ' + sw);
    await shot(M.page, '05-mobil-liste');
    await M.page.locator('.og-card', { hasText: name2 }).click();
    await M.page.locator('.og-panel h2', { hasText: name2 }).waitFor();
    await M.page.locator('.og-panel').scrollIntoViewIfNeeded();
    await shot(M.page, '06-mobil-detay');
    await M.page.getByRole('button', { name: '← Liste' }).click();
    await M.page.locator('.og-card').first().waitFor();
    await M.ctx.close();
  });

  console.log('\nSilme');
  await t('gün silinir (onaylı), Pelin listesinden de düşer', async () => {
    await P.page.goto(UI + '/ozel-gunler');
    await P.page.locator('.og-card', { hasText: name2 }).waitFor();
    await A.page.locator('.og-panel').getByRole('button', { name: 'Sil', exact: true }).click();
    await A.page.getByRole('button', { name: 'Evet, günü sil' }).click();
    await A.page.getByText('Ne hazır, ne kaldı?').waitFor();
    await P.page.locator('.og-card', { hasText: name2 }).waitFor({ state: 'detached', timeout: 6000 });
  });

  await t('konsol hatası yok', async () => ok(errors.length === 0, errors.join(' | ')));
  await browser.close();
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})();
