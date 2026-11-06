// Yönetici özeti arayüz testi (Playwright)
// BASE=http://127.0.0.1:8924 PERSIST=.wrangler/state-yonetim NODE_PATH=$(npm root -g) node test/yonetim.ui.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp/claude-0/-workspace/7539e9e2-d3d4-5cef-ae86-ba86fa5875af/scratchpad/ekran';

// görünen her yazının rengini arkasındaki gerçek zeminle karşılaştırır (test/tema.ui.cjs'teki audit ile aynı)
const auditFn = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(',').map((x) => parseFloat(x)); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('gradient')) return null;
      const c = parse(cs.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  const bad = [];
  const root = document.querySelector('.yo') || document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode; if (!n.textContent.trim()) continue;
    const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (el.closest('.av') || el.closest('.sr')) continue; // avatar baş harfleri, ekran okuyucu tablosu
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    if (el.closest('[aria-hidden="true"]')) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const isSvg = el instanceof SVGElement;
    const fg0 = parse(isSvg ? cs.fill : cs.color); const bg = bgOf(isSvg ? el.closest('div') : el); if (!fg0 || !bg) continue;
    const fg = blend({ ...fg0, a: fg0.a * op }, bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) bad.push(`${ratio.toFixed(2)} <${need} "${n.textContent.trim().slice(0, 40)}" ${isSvg ? cs.fill : cs.color}`);
  }
  return bad;
};

(async () => {
  const lib = await import('./lib.mjs');
  const { t, ok, eq, done, loginAs, sql } = lib;
  const BASE = process.env.BASE || 'http://127.0.0.1:8924';
  await loginAs('u_yigit', 'Yiğit'); const pelinApi = await loginAs('u_pelin', 'Pelin');
  const d = (n) => new Date(Date.now() + 3 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  sql(`DELETE FROM tasks WHERE id LIKE 'yu_%'`); sql(`DELETE FROM shoots WHERE id LIKE 'yu_%'`);
  sql(`INSERT INTO tasks (id, title, client, assignee_id, due_date, status) VALUES ('yu_late', 'UI çok geciken iş', 'Nevvital', 'u_pelin', '${d(-12)}', 0), ('yu_free', 'UI sorumsuz iş', 'Nevvital', NULL, '${d(3)}', 0)`);
  sql(`INSERT INTO tasks (id, title, client, assignee_id, due_date, status, completed_at) VALUES ('yu_d1', 'UI biten 1', 'Nevvital', 'u_ilayda', '${d(-1)}', 2, datetime('now','-1 hour')), ('yu_d2', 'UI biten 2', 'Nevvital', 'u_emre', '${d(-10)}', 2, datetime('now','-8 days')), ('yu_d3', 'UI biten 3', 'Arslandent', 'u_esra', '${d(-20)}', 2, datetime('now','-15 days'))`);
  sql(`INSERT INTO shoots (id, title, client, date, status) VALUES ('yu_s1', 'UI unutulmuş çekim', 'Nevvital', '${d(-3)}', 0), ('yu_s2', 'UI yapılan çekim', 'Nevvital', '${d(0)}', 1)`);

  const b = await chromium.launch();
  const errs = [];
  async function mk(email, viewport = { width: 1360, height: 900 }) {
    const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'light', acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errs.push(email + ': ' + e.message));
    // girişten önceki /api/me 401'i beklenen bir durum; diğer bütün konsol hataları sayılır
    page.on('console', (m) => { if (m.type() === 'error' && !/status of 401/.test(m.text())) errs.push(email + ' console: ' + m.text()); });
    await page.goto(BASE + '/giris');
    await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'TestSifre123'); await page.keyboard.press('Enter');
    await page.waitForURL((u) => !u.pathname.startsWith('/giris'));
    await page.waitForTimeout(600);
    return { ctx, page };
  }

  const { page: p } = await mk('yigiitozdemir@gmail.com');
  await t('yönetici menüde "Yönetici özeti"ni görür ve açar', async () => {
    const link = p.getByRole('link', { name: 'Yönetici özeti' });
    ok(await link.isVisible(), 'menü bağlantısı');
    await link.click(); await p.waitForSelector('.yo-stats');
    eq(new URL(p.url()).pathname, '/yonetici');
    eq(await p.locator('h1').first().textContent(), 'Yönetici özeti');
  });
  await t('kutular, kişi tablosu, müşteri tablosu, grafik', async () => {
    const keys = await p.locator('.yo-stats .stat').evaluateAll((els) => els.map((e) => e.dataset.k));
    const hasAppr = sql('PRAGMA table_info(tasks)').some((c) => c.name === 'approval');
    eq(keys.join(','), hasAppr ? 'open,late,done,approval,shoots,special' : 'open,late,done,shoots,special', 'onay kutusu yalnızca approval sütunu varsa');
    const open = Number(await p.locator('.stat[data-k=open] .v').textContent());
    eq(open, Number(sql('SELECT COUNT(*) n FROM tasks WHERE status != 2')[0].n), 'açık iş');
    ok(await p.locator('.yo-people tbody tr').count() >= 6, 'kişi satırları');
    ok(await p.locator('.yo-clients tbody tr').count() >= 1, 'müşteri satırları');
    eq(await p.locator('.yo-trend svg .yo-col-g').count(), 8, '8 hafta');
    ok(await p.locator('.yo-trend .yo-barm').count() >= 1, 'çubuk var');
    ok((await p.locator('.yo-trend svg').getAttribute('aria-label')).includes('Son 8 haftada'), 'grafik etiketi');
    await p.screenshot({ path: OUT + '/yonetici-genel.png', fullPage: true });
  });
  await t('dönem seçimi', async () => {
    await p.locator('.yo-donem').getByRole('button', { name: 'Geçen hafta' }).click();
    await p.waitForFunction(() => document.querySelector('.yo header .sub')?.textContent.startsWith('Geçen hafta'));
    eq(await p.locator('.yo-donem').getByRole('button', { name: 'Geçen hafta' }).getAttribute('aria-pressed'), 'true');
    await p.locator('.yo-donem').getByRole('button', { name: 'Son 30 gün' }).click();
    await p.waitForFunction(() => document.querySelector('.yo header .sub')?.textContent.startsWith('Son 30 gün'));
    await p.locator('.yo-donem').getByRole('button', { name: 'Bu hafta' }).click();
    await p.waitForFunction(() => document.querySelector('.yo header .sub')?.textContent.startsWith('Bu hafta'));
  });
  await t('dikkat listesi: geciken iş tıklanınca iş detayı açılır', async () => {
    await p.locator('.yo-att', { hasText: 'UI çok geciken iş' }).click();
    await p.waitForSelector('.drawer');
    ok((await p.locator('.drawer').textContent()).includes('UI çok geciken iş'));
    await p.screenshot({ path: OUT + '/yonetici-is-detayi.png' });
    await p.keyboard.press('Escape'); await p.waitForSelector('.drawer', { state: 'detached' });
    await p.locator('.yo-att', { hasText: 'UI sorumsuz iş' }).click();
    await p.waitForSelector('.drawer'); await p.keyboard.press('Escape'); await p.waitForSelector('.drawer', { state: 'detached' });
  });
  await t('dikkat listesi: unutulmuş çekim → /cekim?id=', async () => {
    await p.locator('.yo-att', { hasText: 'UI unutulmuş çekim' }).click();
    await p.waitForURL((u) => u.pathname === '/cekim');
    await p.waitForTimeout(500);
    ok(p.url().includes('id=yu_s1') || (await p.locator('body').textContent()).includes('UI unutulmuş çekim'), 'çekim açıldı');
    await p.goBack(); await p.waitForSelector('.yo-stats');
  });
  await t('kişi satırı → İş Planı', async () => {
    await p.locator('.yo-people tbody tr').first().click();
    await p.waitForURL((u) => u.pathname === '/isler');
    await p.goto(BASE + '/yonetici'); await p.waitForSelector('.yo-stats');
  });
  await t('Şimdi yedek al', async () => {
    await p.waitForSelector('.yo-bk');
    const before = await p.locator('.yo-bklist li').count();
    await p.getByRole('button', { name: 'Şimdi yedek al' }).click();
    await p.waitForSelector('.snack:has-text("Yedek alındı")');
    await p.waitForFunction((n) => document.querySelectorAll('.yo-bklist li').length === Math.min(12, n + 1), before);
    ok(!(await p.locator('.yo-bk').textContent()).includes('Henüz yok'), 'son yedek gösteriliyor');
    const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('.yo-bklist li a').first().click()]);
    ok(/^maya-ekip-\d{4}-\d{2}-\d{2}-\d{4}.*\.json\.gz$/.test(dl.suggestedFilename()), 'indirme adı ' + dl.suggestedFilename());
    await p.locator('#yo-yedek').scrollIntoViewIfNeeded();
    await p.screenshot({ path: OUT + '/yonetici-yedek.png' });
  });
  await t('canlı: başkası iş ekleyince sayı yenilemeden artar', async () => {
    const before = Number(await p.locator('.stat[data-k=open] .v').textContent());
    const r = await pelinApi.post('/api/tasks', { title: 'UI canlı iş', dueDate: d(2), client: 'Nevvital' });
    ok(r.status === 200 || r.status === 201, 'iş eklendi ' + r.status);
    await p.waitForFunction((n) => Number(document.querySelector('.stat[data-k=open] .v').textContent) === n + 1, before, { timeout: 5000 });
  });
  for (const theme of ['dark', 'light']) {
    await t(`${theme === 'dark' ? 'koyu' : 'açık'} tema kontrastı`, async () => {
      await p.getByRole('radio', { name: theme === 'dark' ? 'Koyu' : 'Açık' }).click(); await p.waitForTimeout(300);
      eq(await p.evaluate(() => document.documentElement.dataset.theme), theme);
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.screenshot({ path: `${OUT}/yonetici-${theme === 'dark' ? 'koyu' : 'acik'}.png`, fullPage: true });
      const bad = await p.evaluate(auditFn);
      eq(bad.length, 0, bad.slice(0, 8).join(' | '));
    });
  }
  await t('mobil 390px: yatay taşma yok', async () => {
    const { page: m } = await mk('yigiitozdemir@gmail.com', { width: 390, height: 844 });
    await m.goto(BASE + '/yonetici'); await m.waitForSelector('.yo-stats'); await m.waitForTimeout(400);
    const sw = await m.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 390, 'scrollWidth ' + sw);
    const wide = await m.evaluate(() => [...document.querySelectorAll('.yo *')].filter((e) => { const r = e.getBoundingClientRect(); return r.right > 391 && !e.closest('.yo-scroll') && !e.closest('.sr'); }).map((e) => e.className || e.tagName).slice(0, 5));
    eq(wide.length, 0, 'taşan: ' + wide.join(','));
    await m.screenshot({ path: OUT + '/yonetici-mobil.png', fullPage: true });
    await m.locator('.mtabs button').click(); await m.waitForTimeout(350); // telefonda tema seçici Menü'de
    await m.getByRole('radio', { name: 'Açık' }).click(); await m.waitForTimeout(300);
    await m.getByRole('radio', { name: 'Koyu' }).click(); await m.waitForTimeout(300);
    await m.screenshot({ path: OUT + '/yonetici-mobil-koyu.png', fullPage: true });
    await m.getByRole('radio', { name: 'Açık' }).click(); await m.waitForTimeout(300);
  });
  await t('üye menüde görmez, /yonetici ana sayfaya düşer', async () => {
    const { page: u } = await mk('pelin@mayaajans.net');
    eq(await u.getByRole('link', { name: 'Yönetici özeti' }).count(), 0, 'menüde yok');
    await u.goto(BASE + '/yonetici'); await u.waitForTimeout(800);
    eq(await u.locator('.yo-stats').count(), 0, 'özet gösterilmedi');
    ok((await u.locator('h1').first().textContent()).startsWith('Günaydın'), 'Bugün sayfası');
    await u.screenshot({ path: OUT + '/yonetici-uye.png' });
  });
  await t('konsol hatası yok', async () => eq(errs.length, 0, errs.join(' | ')));

  sql(`DELETE FROM tasks WHERE id LIKE 'yu_%' OR title = 'UI canlı iş'`); sql(`DELETE FROM shoots WHERE id LIKE 'yu_%'`);
  await b.close(); done();
})();
