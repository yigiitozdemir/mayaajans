// Dürtme arayüz testi: iki tarayıcı bağlamı (Pelin ve Emre) aynı anda, gerçek Chromium ile.
// Kullanım: BASE=http://127.0.0.1:8805 PERSIST=.wrangler/state-durt UI=http://localhost:8905 \
//   NODE_PATH=$(npm root -g) node test/durt.ui.cjs <ekran görüntüsü klasörü>
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const UI = process.env.UI || 'http://localhost:8905';
const OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message.split('\n')[0]); console.log('  ✗ ' + name + ' → ' + e.message.split('\n')[0]); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Tarayıcıya önceden: bildirim, ses ve titreme sayaçları
const INIT = () => {
  window.__notes = []; window.__osc = 0; window.__shakes = 0;
  window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); }
    constructor(title, o) { window.__notes.push({ title, body: o && o.body }); } close() {} };
  const C = window.AudioContext;
  if (C) { const orig = C.prototype.createOscillator; C.prototype.createOscillator = function () { window.__osc++; return orig.call(this); }; }
  document.addEventListener('DOMContentLoaded', () => {
    const app = document.getElementById('app');
    new MutationObserver(() => { if (app.classList.contains('durt-shake')) window.__shakes++; }).observe(app, { attributes: true, attributeFilter: ['class'] });
  });
};

(async () => {
  const { loginAs, sql } = await import('./lib.mjs');
  await loginAs('u_pelin', 'Pelin'); await loginAs('u_emre', 'Emre');
  sql("DELETE FROM nudges; DELETE FROM notifications WHERE kind = 'nudge'; UPDATE users SET settings = '{}' WHERE id IN ('u_pelin','u_emre')");
  const ageNudges = () => sql("UPDATE nudges SET created_at = strftime('%Y-%m-%d %H:%M:%f', 'now', '-30 seconds')");

  const browser = await chromium.launch();
  const errors = [];
  const mk = async (email, who) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(who + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(who + ': ' + m.text()); });
    await page.goto(UI + '/giris');
    await page.getByLabel('E-posta').fill(email);
    await page.getByLabel('Şifre', { exact: true }).fill('TestSifre123');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.locator('.shell').waitFor({ timeout: 10000 });
    return { ctx, page };
  };
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'durt-' + n + '.png') });
  const P = await mk('pelin@mayaajans.net', 'Pelin');
  const E = await mk('emre@mayaajans.net', 'Emre');
  const emreCard = () => P.page.locator('[data-person="u_emre"]');
  const counters = (p) => p.evaluate(() => ({ notes: window.__notes.slice(), osc: window.__osc, shakes: window.__shakes }));

  console.log('\nDürtme sayfası');
  await t('Pelin: sayfa, ekip kartları, çevrimiçi durum, ayarlar', async () => {
    await P.page.getByRole('link', { name: /Dürtme/ }).first().click();
    await P.page.getByRole('heading', { name: 'Dürtme', exact: true }).waitFor();
    await emreCard().waitFor();
    ok(!(await P.page.locator('[data-person="u_pelin"]').count()), 'kendisi listede olmamalı');
    await emreCard().getByText('Çevrimiçi').waitFor({ timeout: 6000 });
    for (const l of ['Ses çalsın', 'Ekran titresin', 'Mac bildirimi', 'Rahatsız etme']) ok(await P.page.getByRole('switch', { name: new RegExp(l) }).count(), l + ' yok');
    ok(await P.page.getByRole('switch', { name: /Ses çalsın/ }).getAttribute('aria-checked') === 'true', 'ses varsayılan açık değil');
    ok(await P.page.getByRole('switch', { name: /Rahatsız etme/ }).getAttribute('aria-checked') === 'false', 'dnd varsayılan kapalı değil');
    await shot(P.page, '01-sayfa');
  });

  console.log('\nDürt → karşı tarafta balon + titreme + bildirim + ses');
  await t('Emre İş Planı\'nda bir şey yazarken…', async () => {
    await E.page.getByRole('link', { name: /İş Planı/ }).first().click();
    await E.page.getByRole('heading', { name: 'İş Planı' }).waitFor();
    // hiçbir şeyi engellemesin: Emre bir alana yazıyor
    const inp = E.page.locator('input[type="search"], input[placeholder*="Ara"], input').first();
    await inp.click(); await inp.fill("Gizem"); // tıklama: ses için ilk etkileşim
  });
  await t('Pelin hazır mesajla Emre\'yi dürter → düğmede geri sayım, kendi ekranı titremez', async () => {
    await P.page.getByRole('button', { name: 'Bakar mısın? 👀' }).click();
    await emreCard().getByRole('button', { name: /dürt/i }).click();
    await P.page.locator('.snack', { hasText: 'dürtüldü' }).waitFor({ timeout: 5000 });
    await emreCard().getByRole('button', { name: /saniye sonra/ }).waitFor({ timeout: 3000 });
    ok(await emreCard().getByRole('button').isDisabled(), 'düğme kilitlenmedi');
    await wait(800);
    const c = await counters(P.page); ok(c.shakes === 0, 'gönderen titredi');
    await shot(P.page, '02-gonderildi');
  });
  await t('Emre: sağ altta balon, #app titredi, Mac/sistem bildirimi, ses, yazı ve odak korunur', async () => {
    const b = E.page.locator('.durt-balloon', { hasText: 'Pelin seni dürttü!' });
    await b.waitFor({ timeout: 6000 });
    ok(await b.getByText('Bakar mısın? 👀').count(), 'mesaj yok');
    await E.page.waitForFunction(() => window.__shakes > 0, null, { timeout: 2000 });
    const c = await counters(E.page);
    ok(c.notes.some((n) => n.title === 'Pelin seni dürttü' && n.body === 'Bakar mısın? 👀'), 'sistem bildirimi yok ' + JSON.stringify(c.notes));
    ok(c.osc >= 3, 'ses çalmadı (osc ' + c.osc + ')');
    const st = await E.page.evaluate(() => ({ v: document.activeElement && document.activeElement.value, tag: document.activeElement && document.activeElement.tagName }));
    ok(st.tag === 'INPUT' && st.v === 'Gizem', 'odak/yazı kayboldu ' + JSON.stringify(st));
    // engellemez: balon dışındaki sayfa hâlâ tıklanabilir
    const box = await b.boundingBox(); ok(box && box.x > 900 && box.y > 500, 'balon sağ altta değil ' + JSON.stringify(box));
    await shot(E.page, '03-balon');
    // zil kaydı
    await E.page.locator('[aria-label*="ildirim"]').first().waitFor();
  });
  await t('titreme sınıfı ~600 ms sonra kalkar', async () => {
    await wait(700);
    ok(!(await E.page.evaluate(() => document.getElementById('app').classList.contains('durt-shake'))), 'sınıf kalmış');
  });
  await t('Emre balondan "Geri dürt" → Pelin\'de balon ve titreme', async () => {
    await E.page.locator('.durt-balloon').getByRole('button', { name: 'Geri dürt' }).click();
    await E.page.locator('.snack', { hasText: 'dürtüldü' }).waitFor({ timeout: 5000 });
    await P.page.locator('.durt-balloon', { hasText: 'Emre seni dürttü!' }).waitFor({ timeout: 6000 });
    await P.page.waitForFunction(() => window.__shakes > 0, null, { timeout: 2000 });
    await shot(P.page, '04-geri-durt');
  });
  await t('Pelin\'in sayfasında geçmiş canlı güncellenir (gelen + giden)', async () => {
    await P.page.locator('.durt-log-item', { hasText: /Emre.* seni dürttü/ }).waitFor({ timeout: 5000 });
    await P.page.locator('.durt-log-item', { hasText: 'kişisini dürttün' }).waitFor({ timeout: 5000 });
  });
  await t('balon 6 sn sonra kendiliğinden kaybolur', async () => {
    await P.page.locator('.durt-balloon').first().waitFor({ state: 'detached', timeout: 8000 });
  });

  console.log('\nAyarlar kapalıyken');
  await t('Emre ses/titreme/Mac kapatır → dürtmede yalnızca balon', async () => {
    await E.page.getByRole('link', { name: /Dürtme/ }).first().click();
    await E.page.getByRole('heading', { name: 'Dürtme', exact: true }).waitFor();
    for (const l of ['Ses çalsın', 'Ekran titresin', 'Mac bildirimi']) {
      const sw = E.page.getByRole('switch', { name: new RegExp(l) });
      await sw.click(); await E.page.waitForFunction((el) => el.getAttribute('aria-checked') === 'false', await sw.elementHandle());
    }
    await wait(500);
    const s = sql("SELECT settings FROM users WHERE id = 'u_emre'")[0].settings;
    const j = JSON.parse(s); ok(j.nudgeSound === false && j.nudgeShake === false && j.nudgeMac === false, 'kaydedilmedi ' + s);
    await E.page.evaluate(() => { window.__notes = []; window.__osc = 0; window.__shakes = 0; });
    ageNudges(); await P.page.reload(); await emreCard().waitFor();
    await emreCard().getByRole('button', { name: /dürt/i }).click();
    await E.page.locator('.durt-balloon', { hasText: 'Pelin seni dürttü!' }).waitFor({ timeout: 6000 });
    await wait(900);
    const c = await counters(E.page);
    ok(c.shakes === 0, 'titredi'); ok(c.osc === 0, 'ses çaldı'); ok(c.notes.length === 0, 'sistem bildirimi geldi');
    await shot(E.page, '05-ayarlar-kapali');
  });

  console.log('\nRahatsız etme');
  await t('Emre dnd açar → Pelin "sessizce iletildi" görür, Emre\'de balon yok', async () => {
    await E.page.getByRole('switch', { name: /Rahatsız etme/ }).click();
    await wait(600);
    ok(JSON.parse(sql("SELECT settings FROM users WHERE id = 'u_emre'")[0].settings).dnd === true, 'dnd kaydedilmedi');
    await E.page.locator('.durt-balloon').first().waitFor({ state: 'detached', timeout: 8000 }).catch(() => {});
    ageNudges(); await P.page.reload(); await emreCard().waitFor();
    await P.page.getByLabel('Kendi mesajın').fill('Sunum dosyası hazır mı?');
    await P.page.getByLabel('Kendi mesajın').press('Tab');
    await emreCard().getByRole('button', { name: /dürt/i }).click();
    await P.page.locator('.snack', { hasText: 'Rahatsız etme açık, sessizce iletildi' }).waitFor({ timeout: 5000 });
    await wait(1200);
    ok(!(await E.page.locator('.durt-balloon').count()), 'dnd açıkken balon çıktı');
    await E.page.locator('.durt-log-item', { hasText: 'Sunum dosyası hazır mı?' }).waitFor({ timeout: 5000 });
    await shot(E.page, '06-dnd');
  });

  await t('mobil genişlik (iPhone): yatay kaydırma yok', async () => {
    await P.page.setViewportSize({ width: 390, height: 844 });
    await wait(300);
    const over = await P.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(over <= 1, 'yatay taşma ' + over);
    await shot(P.page, '07-mobil');
  });

  await t('konsol hatası yok', async () => { ok(!errors.length, errors.join(' | ')); });

  await browser.close();
  sql("UPDATE users SET settings = '{}' WHERE id IN ('u_pelin','u_emre')");
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
