// Yapay Zekâ: Mac programı köprüsü taklit edilerek (window.__TAURI__) panel içi görünümün komutları test edilir.
const { chromium } = require('playwright');
(async () => {
  const { t, ok, eq, done, loginAs, BASE } = await import('./lib.mjs');
  await loginAs('u_pelin', 'Pelin');
  const b = await chromium.launch();
  const mk = async (failEmbed) => {
    const ctx = await b.newContext({ viewport: { width: 1300, height: 820 } }); const p = await ctx.newPage();
    await p.addInitScript((fail) => {
      window.__calls = [];
      window.__TAURI__ = { core: { invoke: (cmd, args) => { window.__calls.push([cmd, args || {}]); if (fail && cmd === 'ai_show') return Promise.reject(new Error('yok')); return Promise.resolve(cmd === 'app_info' ? { version: '1.0.5' } : null); } } };
    }, failEmbed);
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/giris'); await p.fill('input[type=email]', 'pelin@mayaajans.net'); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
    await p.waitForURL((u) => !u.pathname.startsWith('/giris')); return { p, ctx, errs };
  };
  const last = (p, cmd) => p.evaluate((c) => [...window.__calls].reverse().find((x) => x[0] === c), cmd);
  const clear = (p) => p.evaluate(() => { window.__calls = []; });

  const { p, ctx, errs } = await mk(false);
  await t('menüden ChatGPT → panelin içinde, içerik alanına yerleşir', async () => {
    await p.locator('.aiq.gpt').click(); await p.waitForTimeout(400);
    eq(new URL(p.url()).pathname + new URL(p.url()).search, '/yapay-zeka?ai=chatgpt');
    const c = await last(p, 'ai_show'); ok(c, 'ai_show çağrılmadı');
    eq(c[1].which, 'chatgpt');
    const side = await p.locator('.side').boundingBox(); const host = await p.locator('.ai-host').boundingBox();
    ok(c[1].x >= side.width, 'x sol menünün sağında olmalı: ' + c[1].x + ' / ' + side.width);
    ok(Math.abs(c[1].y - host.y) < 2 && Math.abs(c[1].h - host.height) < 2 && c[1].w > 900, JSON.stringify(c[1]));
    const top = await p.locator('.ai-top').boundingBox();
    ok(c[1].y >= top.y + top.height, 'uygulama üst çubuğun ALTINDAN başlamalı (y=' + c[1].y + ')');
    ok(c[1].x > side.width + 4, 'sol menüden boşluklu olmalı');
    const vw = await p.evaluate(() => innerWidth), vh = await p.evaluate(() => innerHeight);
    ok(c[1].x + c[1].w < vw - 4 && c[1].y + c[1].h < vh - 4, 'sağ ve altta kart boşluğu olmalı');
    ok(await p.locator('.aiq.gpt.on').count() === 1, 'menüde seçili görünmeli');
    ok(await p.locator('.shell.rail').count() === 1 && side.width < 80, 'uygulama açıkken sol menü simge şeridi olmalı: ' + side.width);
    await p.screenshot({ path: (process.argv[2] || '.') + '/yz-serit.png' });
  });
  await t('Claude sekmesi → Claude gösterilir', async () => {
    await clear(p); await p.locator('.aiq.cld').click(); await p.waitForTimeout(300);
    eq((await last(p, 'ai_show'))[1].which, 'claude');
  });
  await t('profil penceresi açılınca gizlenir, kapanınca geri gelir', async () => {
    await clear(p); await p.getByRole('button', { name: 'Profilim' }).click(); await p.waitForTimeout(300);
    ok(await last(p, 'ai_hide'), 'gizlenmedi');
    await clear(p); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok(await last(p, 'ai_show'), 'geri gelmedi');
  });
  await t('bildirim paneli açılınca gizlenir', async () => {
    await clear(p); await p.locator('.ai-top .bell').click(); await p.waitForTimeout(300);
    ok(await last(p, 'ai_hide'), 'gizlenmedi'); await p.locator('.ai-top .bell').click(); await p.waitForTimeout(300);
    ok(await last(p, 'ai_show'), 'panel kapanınca geri gelmeli');
  });
  await t('pencere boyutu değişince yeni ölçü gönderilir', async () => {
    await clear(p); await p.setViewportSize({ width: 1100, height: 700 }); await p.waitForTimeout(400);
    const c = await last(p, 'ai_show'); ok(c && c[1].w <= 1100 - 60 && c[1].h <= 700, JSON.stringify(c && c[1]));
  });
  await t('başka sayfaya geçince gizlenir', async () => {
    await clear(p); await p.getByRole('link', { name: /İş Planı/ }).click(); await p.waitForTimeout(300);
    ok(await last(p, 'ai_hide'), 'gizlenmedi'); ok(!(await last(p, 'ai_show')), 'tekrar gösterilmemeli');
    eq(await p.locator('.shell.rail').count(), 0, 'başka sayfada geniş menü geri gelmeli');
  });
  await t('"Ayrı pencere" düğmesi', async () => {
    await p.locator('.aiq.cld').click(); await p.waitForTimeout(300); await clear(p);
    await p.getByRole('button', { name: 'Ayrı pencerede aç' }).click(); await p.waitForTimeout(200);
    eq((await last(p, 'open_ai'))[1].which, 'claude');
  });
  await t('yardım (?) bilgi sayfası ve geri dönüş', async () => {
    await clear(p); await p.getByRole('link', { name: 'Uygulamalar: nasıl kullanılır' }).click(); await p.waitForTimeout(300);
    ok(await last(p, 'ai_hide'), 'yardımda gizlenmeli'); await p.getByText('Nasıl kullanılır?').first().waitFor();
    await clear(p); await p.getByRole('button', { name: 'Sohbete dön' }).click(); await p.waitForTimeout(300);
    ok(await last(p, 'ai_show'), 'dönünce gösterilmeli');
  });
  await t('tema ile uyumlu açılış rengi (koyu/açık bilgisi gönderilir)', async () => {
    await p.locator('.aiq.gpt').click(); await p.waitForTimeout(300);
    const theme = async (name) => { await p.keyboard.press('Control+k'); await p.locator('.ap-root input').fill(name); await p.waitForTimeout(250); await p.keyboard.press('Enter'); await p.waitForTimeout(400); };
    await theme('Açık tema'); // varsayılan artık Koyu: önce Açık'a geç
    await clear(p); await theme('Koyu tema');
    eq((await last(p, 'ai_show'))[1].dark, true); eq((await last(p, 'set_theme'))[1].theme, 'dark');
    await clear(p); await theme('Açık tema');
    eq((await last(p, 'ai_show'))[1].dark, false);
  });
  await t('WhatsApp: menüde, panelde açılır, okunmamış sayısı görünür', async () => {
    await clear(p); await p.locator('.aiq.wa').click(); await p.waitForTimeout(300);
    eq((await last(p, 'ai_show'))[1].which, 'whatsapp');
    eq(await p.getByRole('button', { name: 'Ayrı pencerede aç' }).count(), 0, 'WhatsApp için ayrı pencere yok');
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('maya-desktop', { detail: { action: 'app-unread', app: 'whatsapp', count: 4 } })));
    await p.locator('.aiq.wa .aiq-badge', { hasText: '4' }).waitFor();
    await p.evaluate(() => window.dispatchEvent(new CustomEvent('maya-desktop', { detail: { action: 'app-unread', app: 'whatsapp', count: 0 } })));
    await p.waitForTimeout(150); eq(await p.locator('.aiq.wa .aiq-badge').count(), 0);
    await p.getByRole('link', { name: 'Uygulamalar: nasıl kullanılır' }).waitFor();
  });
  await t('konsol hatası yok', async () => eq(errs.length, 0, errs.join(' | ')));
  await p.screenshot({ path: (process.argv[2] || '.') + '/yz-gomulu.png' });
  await ctx.close();

  const F = await mk(true);
  await t('eski Mac sürümü (gömme yok) → bilgi sayfası ve ayrı pencere', async () => {
    await F.p.locator('.aiq.gpt').click(); await F.p.waitForTimeout(500);
    await F.p.getByRole('heading', { name: 'Uygulamalar' }).waitFor();
    await F.p.locator('.ai-old', { hasText: 'Şu anki sürüm' }).waitFor(); // güncelleme uyarısı
    await F.p.getByRole('button', { name: "ChatGPT'yi aç" }).click(); await F.p.waitForTimeout(200);
    eq((await last(F.p, 'open_ai'))[1].which, 'chatgpt');
  });
  await F.ctx.close(); await b.close(); done();
})();
