// Yeni web sürümü: boştaki sayfa kendiliğinden yenilenir; pencere açıkken "Yenile" bandı çıkar
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const { t, ok, eq, done, loginAs, BASE } = await import('./lib.mjs');
  await loginAs('u_pelin', 'Pelin');
  const GEN = __dirname + '/../src/static.gen.ts';
  const orig = fs.readFileSync(GEN, 'utf8');
  const bump = async (id) => { fs.writeFileSync(GEN, orig.replace(/export const BUILD_ID = '[^']+';/, `export const BUILD_ID = '${id}';`)); for (let i = 0; i < 60; i++) { try { const r = await (await fetch(BASE + '/api/version')).json(); if (r.build === id) return; } catch { /* yeniden yükleniyor */ } await new Promise((r) => setTimeout(r, 500)); } throw new Error('sunucu yeni sürümü vermedi'); };
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(BASE + '/giris'); await p.fill('input[type=email]', 'pelin@mayaajans.net'); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
  await p.waitForURL((u) => !u.pathname.startsWith('/giris')); await p.waitForTimeout(1500);
  const poke = () => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  try {
    await t('boştaki sayfa yeni sürümü görünce kendiliğinden yenilenir', async () => {
      await p.evaluate(() => { window.__eski = true; });
      await bump('test-yeni-1'); await poke();
      await p.waitForFunction(() => !window.__eski, null, { timeout: 15000 });
    });
    await t('pencere açıkken zorla yenilemez, "Yenile" bandı çıkar; banda basınca yenilenir', async () => {
      await p.waitForTimeout(1500);
      await p.getByRole('button', { name: 'Profilimi düzenle' }).click(); await p.locator('.dialog').waitFor();
      await p.evaluate(() => { window.__eski = true; });
      await bump('test-yeni-2'); await poke();
      await p.locator('.surum-band', { hasText: 'yeni sürümü hazır' }).waitFor({ timeout: 15000 });
      ok(await p.evaluate(() => window.__eski === true), 'pencere açıkken yenilenmemeli');
      await p.locator('.surum-band').getByRole('button', { name: 'Yenile' }).click();
      await p.waitForFunction(() => !window.__eski, null, { timeout: 15000 });
    });
  } finally { fs.writeFileSync(GEN, orig); }
  await b.close(); done();
})();
