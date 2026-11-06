// Tarayıcı testi: iki kullanıcı (yönetici + Pelin) aynı anda, gerçek Chromium ile.
// Kullanım: node test/ui.e2e.cjs <çıktı klasörü>   (yerel wrangler dev :8787 açık olmalı)
const { chromium } = require('playwright');
const { execSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const path = require('node:path');

const BASE = 'http://localhost:8787';
const OUT = process.argv[2] || '.';
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (s) => b64url(createHash('sha256').update(s).digest());
function link(userId) {
  const token = b64url(randomBytes(24));
  execSync(`npx wrangler d1 execute maya-ekip --local --command "INSERT INTO invites (id, user_id, kind, expires_at) VALUES ('${sha(token)}', '${userId}', 'invite', datetime('now', '+1 day'))"`, { cwd: path.join(__dirname, '..'), env: { ...process.env, CLOUDFLARE_API_TOKEN: 'proxy-injected' }, stdio: 'ignore' });
  return BASE + '/davet/' + token;
}

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message.split('\n')[0]); console.log('  ✗ ' + name + ' → ' + e.message.split('\n')[0]); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mk = async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    return { ctx, page };
  };
  const A = await mk();
  const P = await mk();
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, n), fullPage: false });

  console.log('\nYönetici kurulumu ve giriş');
  await t('davet bağlantısıyla hesap açma → Bugün ekranı', async () => {
    await A.page.goto(link('u_yigit'));
    await A.page.getByLabel('Ad *').fill('Yiğit');
    await A.page.getByLabel('Soyad').fill('Özdemir');
    await A.page.getByLabel('Şifre (en az 8 karakter)').fill('GucluSifre123');
    await A.page.getByLabel('Şifre tekrar').fill('GucluSifre123');
    await A.page.getByRole('button', { name: 'Hesabımı aç' }).click();
    await A.page.getByRole('heading', { name: 'Günaydın, Yiğit' }).waitFor({ timeout: 8000 });
    await shot(A.page, '01-bugun.png');
  });
  await t('sayfa yenilenince tekrar giriş istemez', async () => {
    await A.page.reload(); await A.page.getByRole('heading', { name: 'Günaydın, Yiğit' }).waitFor({ timeout: 8000 });
  });

  console.log('\nİş Planı');
  await t('pano: Slack işleri sütunlarda', async () => {
    await A.page.getByRole('link', { name: /İş Planı/ }).first().click();
    await A.page.getByRole('heading', { name: 'İş Planı' }).waitFor();
    const cards = await A.page.locator('.tcard').count(); ok(cards >= 30, 'kart sayısı ' + cards);
    await shot(A.page, '02-is-plani-pano.png');
  });
  await t('hızlı eklemede tarih zorunlu', async () => {
    await A.page.getByLabel('Yeni iş', { exact: true }).fill('Tarayıcı testi işi');
    await A.page.getByRole('button', { name: 'Ekle', exact: true }).click();
    await A.page.getByText('Teslim tarihi seç').waitFor({ timeout: 3000 });
  });
  await t('tarihle hızlı ekleme', async () => {
    const d = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    await A.page.getByLabel('Teslim tarihi', { exact: true }).fill(d);
    await A.page.getByRole('button', { name: 'Ekle', exact: true }).click();
    await A.page.locator('.tcard', { hasText: 'Tarayıcı testi işi' }).waitFor({ timeout: 5000 });
  });
  await t('liste görünümü: tamamlananlar ayrı bölümde', async () => {
    await A.page.getByRole('button', { name: 'Liste' }).click();
    await A.page.getByText('Tamamlanan', { exact: false }).first().waitFor();
    await shot(A.page, '03-is-plani-liste.png');
    await A.page.getByRole('button', { name: 'Pano' }).click();
  });

  console.log('\nEkip yönetimi ve ikinci kullanıcı');
  let pelinLink;
  await t('yönetici Pelin için davet bağlantısı üretir', async () => {
    await A.page.getByRole('link', { name: 'Ekip yönetimi' }).click();
    await A.page.getByRole('heading', { name: 'Ekip yönetimi' }).waitFor();
    const card = A.page.locator('article', { hasText: 'pelin@mayaajans.net' });
    await card.getByRole('button', { name: 'Davet bağlantısını yenile' }).click();
    pelinLink = await A.page.locator('input[readonly]').inputValue(); ok(pelinLink.includes('/davet/'));
    // yerel wrangler adresleri canlı alan adına çevirir; yolu yerel sunucuya uygula
    pelinLink = BASE + new URL(pelinLink).pathname;
    await shot(A.page, '04-ekip.png');
  });
  await t('Pelin davetle katılır', async () => {
    await P.page.goto(pelinLink);
    await P.page.getByLabel('Soyad').fill('Kaya');
    await P.page.getByLabel('Şifre (en az 8 karakter)').fill('PelinSifre9');
    await P.page.getByLabel('Şifre tekrar').fill('PelinSifre9');
    await P.page.getByRole('button', { name: 'Hesabımı aç' }).click();
    await P.page.getByRole('heading', { name: 'Günaydın, Pelin' }).waitFor({ timeout: 8000 });
  });
  await t('Pelin yönetim menüsünü görmez', async () => ok(!(await P.page.getByRole('link', { name: 'Ekip yönetimi' }).count())));

  console.log('\nCanlı atama bildirimi');
  await t('yönetici detaylı formla Pelin\'e iş atar → Pelin\'de köşe bildirimi + zil', async () => {
    await A.page.getByRole('link', { name: /İş Planı/ }).first().click();
    await A.page.getByRole('button', { name: 'Detaylı ekle' }).click();
    const dlg = A.page.getByRole('dialog', { name: 'Yeni iş' });
    await dlg.getByLabel('İş *').fill('Aralık kampanya görselleri');
    await dlg.locator('input[list=maya-firmalar]').fill('Vatan Hastanesi');
    await dlg.getByLabel('Sorumlu').selectOption({ label: 'Pelin Kaya' });
    await dlg.getByLabel('Teslim tarihi *').fill(new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 10));
    await dlg.getByRole('button', { name: 'İşi ekle' }).click();
    await P.page.locator('.toast', { hasText: 'Aralık kampanya görselleri' }).waitFor({ timeout: 8000 });
    await P.page.locator('.bell .n').waitFor({ timeout: 5000 });
    await shot(P.page, '05-pelin-bildirim.png');
  });
  await t('Pelin bildirimden işi açar → okundu sayılır', async () => {
    await P.page.locator('.toast').getByRole('button', { name: 'İşi aç' }).click();
    await P.page.getByRole('dialog', { name: 'İş detayı' }).waitFor();
    await shot(P.page, '06-is-detay.png');
    await P.page.waitForFunction(() => !document.querySelector('.bell .n'), null, { timeout: 5000 });
    await P.page.keyboard.press('Escape');
  });
  await t('Pelin durumu değiştirir → yöneticide anında görünür', async () => {
    await P.page.getByRole('link', { name: /İş Planı/ }).first().click();
    await P.page.locator('.tcard', { hasText: 'Aralık kampanya görselleri' }).click();
    await P.page.getByRole('dialog', { name: 'İş detayı' }).getByRole('button', { name: /Devam ediyor/ }).click();
    await P.page.keyboard.press('Escape');
    await A.page.locator('section[aria-label="Devam ediyor"] .tcard', { hasText: 'Aralık kampanya görselleri' }).waitFor({ timeout: 8000 });
  });

  console.log('\nTek profil');
  await t('Pelin profilini değiştirir → yöneticide anında yeni ad (yenilemeden)', async () => {
    await A.page.getByRole('link', { name: 'Ekip yönetimi' }).click();
    await A.page.getByRole('heading', { name: 'Ekip yönetimi' }).waitFor();
    await P.page.getByRole('button', { name: 'Profilimi düzenle' }).click();
    await P.page.getByRole('dialog', { name: 'Profilim' }).getByLabel('Soyad').fill('Kaya Demir');
    await shot(P.page, '07-profil.png');
    await P.page.getByRole('button', { name: 'Kaydet' }).click();
    await A.page.locator('article', { hasText: 'Pelin Kaya Demir' }).waitFor({ timeout: 8000 });
    await P.page.locator('.side', { hasText: 'Pelin Kaya Demir' }).waitFor({ timeout: 5000 });
  });

  console.log('\nOturum kapatma');
  await t('yönetici Pelin\'in oturumlarını kapatır → Pelin giriş ekranına düşer', async () => {
    await A.page.getByRole('link', { name: 'Ekip yönetimi' }).click();
    const card = A.page.locator('article', { hasText: 'pelin@mayaajans.net' });
    await card.getByRole('button', { name: 'Tüm cihazlardan çıkış yaptır' }).click();
    await P.page.getByRole('button', { name: 'Giriş yap' }).waitFor({ timeout: 8000 });
    await shot(P.page, '08-giris.png');
  });
  await t('Pelin tekrar giriş yapar', async () => {
    await P.page.getByLabel('E-posta').fill('pelin@mayaajans.net');
    await P.page.locator('input[type=password]').fill('PelinSifre9');
    await P.page.getByRole('button', { name: 'Giriş yap' }).click();
    await P.page.getByRole('heading', { name: 'Günaydın, Pelin' }).waitFor({ timeout: 8000 });
  });

  console.log('\nTelefon genişliği');
  await t('390 px genişlikte yatay taşma yok', async () => {
    const m = await browser.newContext({ viewport: { width: 390, height: 844 }, storageState: await P.ctx.storageState() });
    const pg = await m.newPage(); await pg.goto(BASE + '/isler'); await pg.getByRole('heading', { name: 'İş Planı' }).waitFor();
    const over = await pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(over <= 1, 'taşma ' + over + 'px');
    await pg.screenshot({ path: path.join(OUT, '09-telefon.png') });
  });

  await t('tarayıcı konsolunda hata yok', async () => ok(errors.length === 0, errors.slice(0, 3).join(' | ')));
  await browser.close();
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(fail ? 1 : 0);
})();
