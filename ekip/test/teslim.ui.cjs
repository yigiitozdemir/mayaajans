// İş tamamlanınca teslim linki: Tamamlandı → link kutusu açılır (isteğe bağlı) → kaydet / geç → başkası kopyalar
// Çalıştırma: BASE=http://127.0.0.1:8787 NODE_PATH=$(npm root -g) node test/teslim.ui.cjs
const { chromium } = require('playwright');
(async () => {
  const lib = await import('./lib.mjs');
  const { t, ok, eq, done, loginAs, sql, BASE } = lib;
  await loginAs('u_yigit', 'Yiğit'); await loginAs('u_pelin', 'Pelin');
  sql("INSERT INTO tasks (id, title, client, assignee_id, due_date, status) VALUES ('t_ui1', 'Teslim testi işi', 'Nevvital', 'u_pelin', '2026-12-01', 1), ('t_ui2', 'Linksiz iş', 'Nevvital', 'u_pelin', '2026-12-02', 1)");
  const b = await chromium.launch();
  const login = async (email) => {
    const ctx = await b.newContext({ permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE + '/giris'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
    await p.waitForURL((u) => !u.pathname.startsWith('/giris')); return { p, errs };
  };
  const Y = await login('yigiitozdemir@gmail.com'), P = await login('pelin@mayaajans.net');
  const openTask = async (pg, title) => { await pg.goto(BASE + '/isler'); await pg.locator('.tcard', { hasText: title }).first().click(); await pg.locator('.drawer').waitFor(); };

  await t('Tamamlandı → link kutusu açılır, kaydedilir', async () => {
    await openTask(P.p, 'Teslim testi işi');
    await P.p.locator('.drawer .seg button', { hasText: 'Tamamlandı' }).click();
    const inp = P.p.getByLabel('Bitmiş çalışmanın Drive linki'); await inp.waitFor();
    ok(await inp.evaluate((e) => e === document.activeElement), 'kutu odakta değil');
    await inp.fill('drive.google.com/drive/folders/teslim123'); await inp.press('Enter');
    await P.p.locator('.snack', { hasText: 'Teslim linki kaydedildi' }).waitFor();
    eq(sql("SELECT done_link FROM tasks WHERE id='t_ui1'")[0].done_link, 'https://drive.google.com/drive/folders/teslim123');
    eq(sql("SELECT status FROM tasks WHERE id='t_ui1'")[0].status, 2);
    await P.p.locator('.donelink .donelink-url', { hasText: 'drive.google.com/drive/folders/teslim123' }).waitFor();
  });
  await t('Yiğit yenilemeden görür ve kopyalar', async () => {
    await Y.p.goto(BASE + '/isler');
    await Y.p.locator('.tcard.done', { hasText: 'Teslim testi işi' }).locator('.donechip').waitFor();
    await Y.p.locator('.tcard', { hasText: 'Teslim testi işi' }).first().click();
    await Y.p.locator('.drawer .donelink').getByRole('button', { name: 'Kopyala' }).click();
    eq(await Y.p.evaluate(() => navigator.clipboard.readText()), 'https://drive.google.com/drive/folders/teslim123');
    await Y.p.keyboard.press('Escape');
  });
  await t('zorunlu değil: "Şimdilik geç" ile boş kalır, sonra eklenebilir', async () => {
    await openTask(P.p, 'Linksiz iş');
    await P.p.locator('.drawer .seg button', { hasText: 'Tamamlandı' }).click();
    await P.p.getByRole('button', { name: 'Şimdilik geç' }).click();
    eq(sql("SELECT status, done_link FROM tasks WHERE id='t_ui2'")[0].status, 2);
    eq(sql("SELECT done_link FROM tasks WHERE id='t_ui2'")[0].done_link, '');
    await P.p.getByRole('button', { name: 'Teslim linki ekle' }).waitFor();
  });
  await t('geçersiz link reddedilir', async () => {
    await P.p.getByRole('button', { name: 'Teslim linki ekle' }).click();
    await P.p.getByLabel('Bitmiş çalışmanın Drive linki').fill('javascript:alert(1)');
    await P.p.getByRole('button', { name: 'Linki kaydet' }).click();
    await P.p.locator('.snack', { hasText: 'http' }).waitFor();
    eq(sql("SELECT done_link FROM tasks WHERE id='t_ui2'")[0].done_link, '');
  });
  await t('liste görünümünde "Linki kopyala"', async () => {
    await Y.p.goto(BASE + '/isler');
    await Y.p.getByRole('button', { name: 'Liste', exact: true }).click();
    await Y.p.getByRole('button', { name: 'Göster', exact: true }).click();
    await Y.p.getByRole('button', { name: 'Teslim linkini kopyala: Teslim testi işi' }).click();
    eq(await Y.p.evaluate(() => navigator.clipboard.readText()), 'https://drive.google.com/drive/folders/teslim123');
    await Y.p.screenshot({ path: '/tmp/claude-0/-workspace/7539e9e2-d3d4-5cef-ae86-ba86fa5875af/scratchpad/teslim-liste.png' });
  });
  await t('konsol hatası yok', async () => eq(Y.errs.length + P.errs.length, 0, Y.errs.concat(P.errs).join(' | ')));
  await openTask(P.p, 'Teslim testi işi');
  await P.p.screenshot({ path: '/tmp/claude-0/-workspace/7539e9e2-d3d4-5cef-ae86-ba86fa5875af/scratchpad/teslim-detay.png' });
  await b.close(); done();
})();
