// Telefon ve katlanır telefonlar (Galaxy Z Fold / iPhone Fold kapalı ve açık): düzen, alt sekmeler, menü çekmecesi, taşma yok.
const { chromium } = require('playwright');
(async () => {
  const { t, ok, eq, done, loginAs, BASE } = await import('./lib.mjs');
  await loginAs('u_pelin', 'Pelin');
  const b = await chromium.launch();
  const c0 = await b.newContext(); const p0 = await c0.newPage();
  await p0.goto(BASE + '/giris'); await p0.fill('input[type=email]', 'pelin@mayaajans.net'); await p0.fill('input[type=password]', 'TestSifre123'); await p0.keyboard.press('Enter');
  await p0.waitForURL((u) => !u.pathname.startsWith('/giris')); const st = await c0.storageState(); await c0.close();
  const PAGES = ['/', '/ajanda', '/isler', '/ozel-gunler', '/cekim', '/musteriler', '/sohbet', '/durt'];
  const mk = async (w, h) => { const ctx = await b.newContext({ storageState: st, viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: true }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message)); return { p, ctx, errs }; };
  const vis = (p, sel) => p.locator(sel).first().isVisible();

  for (const [ad, w, h] of [['telefon', 390, 844], ['Fold kapalı', 412, 968], ['iPhone Fold kapalı', 376, 668]]) {
    const { p, ctx, errs } = await mk(w, h);
    await t(ad + ': üst başlık + alt sekmeler, sol menü gizli, yatay taşma yok', async () => {
      for (const pg of PAGES) {
        await p.goto(BASE + pg); await p.waitForTimeout(350);
        ok(await vis(p, '.mtabs'), pg + ' alt sekmeler görünmeli');
        ok(!(await p.locator('.side').isVisible()), pg + ' sol menü kapalı olmalı');
        const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        ok(ov <= 0, pg + ' yatay taşma: ' + ov + 'px');
      }
    });
    await t(ad + ': Menü çekmecesi açılır, bölüme geçince kapanır', async () => {
      await p.goto(BASE + '/'); await p.locator('.mtabs button').click(); await p.waitForTimeout(350);
      ok(await p.locator('.side').isVisible(), 'menü açılmalı');
      await p.locator('.side .nav a[href="/cekim"]').click(); await p.waitForTimeout(400);
      eq(new URL(p.url()).pathname, '/cekim'); ok(!(await p.locator('.shell.menu-open').count()), 'menü kapanmalı');
      ok(await p.locator('.mtabs button.on').count() === 1, 'Çekim sekmede yok → Menü seçili görünmeli');
    });
    await t(ad + ': alt sekmeyle geçiş', async () => {
      await p.locator('.mtabs a[href="/isler"]').click(); await p.waitForTimeout(300);
      eq(new URL(p.url()).pathname, '/isler'); ok(await p.locator('.mtabs a.on[href="/isler"]').count() === 1, 'seçili');
    });
    await t(ad + ': konsol hatası yok', async () => eq(errs.length, 0, errs.join(' | ')));
    await ctx.close();
  }
  for (const [ad, w, h] of [['iPhone Fold açık (dik)', 768, 1000], ['iPhone Fold açık', 800, 1000], ['iPad dik', 834, 1112], ['dar pencere', 870, 700], ['Fold açık', 884, 1104], ['iPhone Fold açık (yatay)', 1024, 760], ['masaüstü', 1320, 840]]) {
    const { p, ctx } = await mk(w, h);
    await t(ad + ': sol menü yerinde, telefon çubukları yok, taşma yok', async () => {
      for (const pg of PAGES) {
        await p.goto(BASE + pg); await p.waitForTimeout(300);
        ok(await p.locator('.side').isVisible() && !(await vis(p, '.mtabs')) && !(await vis(p, '.mtop')), pg);
        const sb = await p.locator('.side').boundingBox(), mb = await p.locator('.main').boundingBox();
        ok(mb.x >= sb.x + sb.width - 1 && Math.abs(mb.y - sb.y) < 2 && sb.width < 260, pg + ' menü ve içerik yan yana olmalı: menü ' + JSON.stringify(sb) + ' içerik ' + JSON.stringify(mb));
        const ov = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
        ok(ov <= 0, pg + ' yatay taşma: ' + ov + 'px');
      }
    });
    await ctx.close();
  }
  await b.close(); done();
})();
