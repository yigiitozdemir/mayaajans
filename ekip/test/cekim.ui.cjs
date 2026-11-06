// Çekim Planı arayüz testi (iki kullanıcı: Yiğit + Pelin, gerçek Chromium)
// Çalıştırma: BASE=http://127.0.0.1:8803 PERSIST=.wrangler/state-cekim UI=http://127.0.0.1:8903 \
//   NODE_PATH=$(npm root -g) node test/cekim.ui.cjs [ekran-görüntüsü-klasörü]
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const UI = process.env.UI || 'http://127.0.0.1:8903';
const OUT = process.argv[2] || '/tmp/claude-0/-workspace/7539e9e2-d3d4-5cef-ae86-ba86fa5875af/scratchpad/ekran';
fs.mkdirSync(OUT, { recursive: true });
const istDate = (n) => new Date(Date.now() + 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message.split('\n')[0]); console.log('  ✗ ' + name + ' → ' + e.message.split('\n').slice(0, 8).join(' / ')); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };

(async () => {
  const lib = await import(path.join(__dirname, 'lib.mjs'));
  await lib.loginAs('u_yigit', 'Yiğit');
  await lib.loginAs('u_pelin', 'Pelin');
  const api = await lib.loginAs('u_emre', 'Emre');
  // önceki koşulardan kalan test çekimleri
  lib.sql("DELETE FROM shoots WHERE title LIKE 'UI Test%'");

  const browser = await chromium.launch();
  const errors = [];
  const mk = async (email, viewport = { width: 1440, height: 950 }) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(email + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(email + ': ' + m.text()); });
    await page.goto(UI + '/giris');
    await page.getByLabel('E-posta').fill(email);
    await page.locator('input[autocomplete=current-password]').fill('TestSifre123');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/giris'), { timeout: 10000 });
    await page.goto(UI + '/cekim');
    await page.getByRole('heading', { name: 'Çekim Planı' }).waitFor({ timeout: 10000 });
    return { ctx, page };
  };
  const shot = (p, n, full = false) => p.screenshot({ path: path.join(OUT, 'cekim-' + n + '.png'), fullPage: full });

  const A = await mk('yigiitozdemir@gmail.com');
  const P = await mk('pelin@mayaajans.net');
  const a = A.page, p = P.page;
  const tomorrow = istDate(1);

  console.log('Çekim Planı · arayüz');
  await t('liste: Planlanan üstte, Tamamlanan / İptal kapalı bölümler, geçmiş çekim kırmızı uyarılı', async () => {
    await a.locator('.ck-card').first().waitFor();
    ok(await a.getByRole('region', { name: 'Planlanan' }).locator('.ck-card').count() >= 1, 'planlanan kart yok');
    const done = a.getByRole('region', { name: 'Tamamlanan' });
    ok(await done.locator('.ck-card').count() === 0, 'tamamlanan açık olmamalı');
    ok(await a.getByText('Geçti, durumu güncelle').count() >= 1, 'geçti etiketi yok');
    ok(await a.getByText("Her gün 16:30'da yarın çekimi olan ekibe").count() >= 1, 'hatırlatma bilgi notu yok');
    await shot(a, '01-liste');
    await done.getByRole('button', { name: 'Göster' }).click();
    ok(await done.locator('.ck-card').count() >= 10, 'tamamlananlar açılmadı');
    // tamamlananlar en yeni üstte
    const heads = await done.locator('.ck-group h3').allTextContents();
    ok(heads.length > 2, 'grup yok');
    await shot(a, '02-tamamlanan', true);
    await done.getByRole('button', { name: 'Gizle' }).click();
  });

  await t('yeni çekim: tarihsiz kaydedilemez, ekip + hazırlık listesiyle eklenir', async () => {
    await a.getByRole('button', { name: 'Yeni çekim' }).click();
    const dlg = a.getByRole('dialog', { name: 'Yeni çekim' });
    await dlg.getByLabel('Çekim / İçerik *').fill('UI Test Çekimi');
    await dlg.getByRole('button', { name: 'Çekimi ekle' }).click();
    await dlg.getByRole('alert').filter({ hasText: 'tarih' }).waitFor();
    ok(await dlg.getByText('Gimbal').count() === 1, 'varsayılan şablon yok');
    await dlg.getByLabel('Firma', { exact: true }).fill('Furkan Biçer');
    await dlg.getByLabel('Lokasyon', { exact: true }).fill('Kapaklı');
    await dlg.getByLabel(/Tarih \*/).fill(tomorrow);
    await dlg.getByRole('button', { name: 'Sabah', exact: true }).click();
    await dlg.getByRole('button', { name: /Pelin/ }).click();
    await dlg.getByLabel('Hazırlık maddesi ekle').fill('Yaka mikrofonu');
    await dlg.getByLabel('Hazırlık maddesi ekle').press('Enter');
    ok(await dlg.getByText('Yaka mikrofonu').count() === 1, 'madde eklenmedi');
    ok(await dlg.isVisible(), 'Enter formu kaydetmemeli');
    await shot(a, '03-form');
    await dlg.getByRole('button', { name: 'Çekimi ekle' }).click();
    await dlg.waitFor({ state: 'detached' });
    await a.locator('.ck-card', { hasText: 'UI Test Çekimi' }).waitFor();
    ok(await a.getByText('Yarın · ', { exact: false }).count() >= 1, 'Yarın grubu yok');
  });

  await t('Pelin: sayfa yenilemeden listede görür + "Çekim ekibine eklendin" açılır bildirimi → Aç → detay', async () => {
    await p.locator('.ck-card', { hasText: 'UI Test Çekimi' }).waitFor({ timeout: 6000 });
    const toast = p.locator('.toast', { hasText: 'Çekim ekibine eklendin' });
    await toast.waitFor({ timeout: 6000 });
    ok((await toast.textContent()).includes('UI Test Çekimi · Furkan Biçer'), 'bildirim gövdesi');
    await shot(p, '04-bildirim');
    await toast.getByRole('button', { name: 'Aç' }).click();
    const dr = p.getByRole('dialog', { name: 'Çekim detayı' });
    await dr.waitFor();
    ok(p.url().includes('/cekim?id=s_'), 'adres ?id= değil: ' + p.url());
    ok(await dr.getByRole('heading', { name: 'UI Test Çekimi' }).count() === 1, 'detay başlığı');
    ok(await dr.getByText('Kapaklı').count() >= 1, 'lokasyon');
    await shot(p, '05-detay');
  });

  await t('detay: hazırlık maddesi işaretlenince Yiğit\'in ekranında canlı güncellenir', async () => {
    const dr = p.getByRole('dialog', { name: 'Çekim detayı' });
    await dr.getByRole('checkbox', { name: 'Gimbal' }).check();
    await dr.getByText('1/5 hazır').waitFor();
    await a.locator('.ck-card', { hasText: 'UI Test Çekimi' }).getByText('Hazırlık 1/5').waitFor({ timeout: 6000 });
    await dr.getByLabel('Hazırlık maddesi ekle').fill('Tripod');
    await dr.getByLabel('Hazırlık maddesi ekle').press('Enter');
    await dr.getByText('1/6 hazır').waitFor();
    await dr.getByRole('button', { name: 'Tripod maddesini sil' }).click();
    await dr.getByText('1/5 hazır').waitFor();
  });

  await t('Benim çekimlerim filtresi', async () => {
    await p.getByRole('button', { name: 'Kapat' }).first().click();
    await p.getByRole('dialog', { name: 'Çekim detayı' }).waitFor({ state: 'detached' });
    ok(!p.url().includes('?id='), 'adres temizlenmedi');
    await p.getByRole('button', { name: /Benim çekimlerim/ }).click();
    const n = await p.locator('.ck-card').count();
    ok(n >= 1, 'benim çekimim yok');
    ok(await p.locator('.ck-card', { hasText: 'Kapaklı Programı' }).count() === 0, 'ekipte olmadığım çekim görünüyor');
    await shot(p, '06-benim');
    await p.getByRole('button', { name: /Benim çekimlerim/ }).click();
  });

  await t('arama ve firma filtresi', async () => {
    await a.getByPlaceholder('Çekim, firma veya lokasyon ara…').fill('aromaterapi');
    await a.locator('.ck-card', { hasText: 'Aromaterapi' }).first().waitFor();
    ok(await a.locator('.ck-card', { hasText: 'UI Test Çekimi' }).count() === 0, 'arama süzmedi');
    await a.getByRole('button', { name: 'Filtreleri temizle' }).click();
    await a.getByLabel('Firma').selectOption('Nevvital');
    ok(await a.locator('.ck-card', { hasText: 'UI Test Çekimi' }).count() === 0, 'firma süzmedi');
    ok(await a.locator('.ck-card', { hasText: 'Nevvital' }).count() >= 1, 'nevvital yok');
    await a.getByRole('button', { name: 'Filtreleri temizle' }).click();
  });

  await t('takvim görünümü: güne tıklayınca o gün süzülür', async () => {
    await a.getByRole('button', { name: 'Takvim', exact: true }).click();
    const d = new Date(tomorrow + 'T00:00:00');
    const cell = a.locator('.ck-cal.big .ck-day', { hasText: 'UI Test Çekimi' });
    await cell.waitFor();
    await shot(a, '07-takvim');
    await cell.click();
    await a.locator('.ck-daybar').waitFor();
    ok((await a.locator('.ck-daybar').textContent()).includes(String(d.getDate())), 'gün etiketi');
    const titles = await a.locator('.ck-main .ck-card .ck-title').allTextContents();
    ok(titles.includes('UI Test Çekimi'), 'çekim yok');
    await shot(a, '08-takvim-gun', true);
    await a.locator('.ck-daybar').getByRole('button', { name: 'Temizle' }).click();
    await a.getByRole('button', { name: 'Liste', exact: true }).click();
  });

  await t('düzenle: saat/lokasyon değişince ekibe "Çekim güncellendi"', async () => {
    await a.locator('.ck-card', { hasText: 'UI Test Çekimi' }).locator('.ck-body').click();
    const dr = a.getByRole('dialog', { name: 'Çekim detayı' });
    await dr.getByRole('button', { name: 'Düzenle' }).click();
    const dlg = a.getByRole('dialog', { name: 'Çekimi düzenle' });
    await dlg.getByLabel('Saat', { exact: true }).fill('11:30');
    await dlg.getByLabel('Lokasyon', { exact: true }).fill('Kapaklı Meydan');
    await dlg.getByLabel('Saat', { exact: true }).press('Enter');
    await dlg.waitFor({ state: 'detached' });
    await dr.getByText('Kapaklı Meydan').waitFor();
    await p.locator('.toast', { hasText: 'Çekim güncellendi' }).waitFor({ timeout: 6000 });
  });

  await t('durum: Tamamlandı → Tamamlanan bölümüne düşer; İptal; geri al', async () => {
    const dr = a.getByRole('dialog', { name: 'Çekim detayı' });
    await dr.getByRole('group', { name: 'Durum' }).getByRole('button', { name: 'Tamamlandı' }).click();
    await a.getByRole('region', { name: 'Planlanan' }).locator('.ck-card', { hasText: 'UI Test Çekimi' }).waitFor({ state: 'detached' });
    await a.keyboard.press('Escape');
    await dr.waitFor({ state: 'detached' });
    const done = a.getByRole('region', { name: 'Tamamlanan' });
    if (await done.getByRole('button', { name: 'Göster' }).count()) await done.getByRole('button', { name: 'Göster' }).click();
    await done.locator('.ck-card', { hasText: 'UI Test Çekimi' }).waitFor();
    // Pelin'de de canlı
    await p.getByRole('region', { name: 'Planlanan' }).locator('.ck-card', { hasText: 'UI Test Çekimi' }).waitFor({ state: 'detached', timeout: 6000 });
    await done.locator('.ck-card', { hasText: 'UI Test Çekimi' }).locator('.ck-body').click();
    await dr.getByRole('group', { name: 'Durum' }).getByRole('button', { name: 'İptal' }).click();
    await done.locator('.ck-card', { hasText: 'UI Test Çekimi' }).waitFor({ state: 'detached' });
    await a.keyboard.press('Escape');
    await dr.waitFor({ state: 'detached' });
    const cancel = a.getByRole('region', { name: 'İptal' });
    if (await cancel.getByRole('button', { name: 'Göster' }).count()) await cancel.getByRole('button', { name: 'Göster' }).click();
    await cancel.locator('.ck-card', { hasText: 'UI Test Çekimi' }).waitFor();
    await shot(a, '09-iptal', true);
    await cancel.locator('.ck-card', { hasText: 'UI Test Çekimi' }).locator('.ck-body').click();
    await dr.getByRole('group', { name: 'Durum' }).getByRole('button', { name: 'Planlandı' }).click();
    await a.getByRole('region', { name: 'Planlanan' }).locator('.ck-card', { hasText: 'UI Test Çekimi' }).waitFor();
    await a.keyboard.press('Escape');
    await dr.waitFor({ state: 'detached' });
  });

  await t('geçmiş çekimde "Çekildi" düğmesi tamamlar', async () => {
    const card = a.locator('.ck-card', { hasText: 'Kapaklı Programı' });
    await card.getByRole('button', { name: 'Çekildi' }).click();
    await a.getByRole('region', { name: 'Planlanan' }).locator('.ck-card', { hasText: 'Kapaklı Programı' }).waitFor({ state: 'detached' });
    await api.patch('/api/shoots/s_001', { status: 0 }); // eski haline getir
    await a.getByRole('region', { name: 'Planlanan' }).locator('.ck-card', { hasText: 'Kapaklı Programı' }).waitFor({ timeout: 6000 });
  });

  await t('sil: onaylı', async () => {
    const dr = a.getByRole('dialog', { name: 'Çekim detayı' });
    if (!(await dr.count())) await a.locator('.ck-card', { hasText: 'UI Test Çekimi' }).locator('.ck-body').click();
    await dr.getByRole('button', { name: 'Çekimi sil' }).click();
    await dr.getByRole('button', { name: 'Emin misin? Sil' }).click();
    await dr.waitFor({ state: 'detached' });
    await a.locator('.ck-card', { hasText: 'UI Test Çekimi' }).waitFor({ state: 'detached' });
    await p.locator('.ck-card', { hasText: 'UI Test Çekimi' }).waitFor({ state: 'detached', timeout: 6000 });
  });

  await t('mobil (iPhone) genişliği', async () => {
    const M = await mk('pelin@mayaajans.net', { width: 390, height: 844 });
    const w = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(w <= 392, 'yatay taşma: ' + w);
    await shot(M.page, '10-mobil');
    await M.page.getByRole('button', { name: 'Yeni çekim' }).click();
    await shot(M.page, '11-mobil-form');
    await M.page.keyboard.press('Escape');
    await M.page.getByRole('dialog', { name: 'Yeni çekim' }).waitFor({ state: 'detached' });
    await M.ctx.close();
  });

  await t('konsol hatası yok', async () => { ok(errors.length === 0, errors.join(' | ')); });

  await browser.close();
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
