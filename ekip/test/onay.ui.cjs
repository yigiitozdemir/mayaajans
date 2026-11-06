// İçerik onay takibi — arayüz: drawer şeridi (gönder → revize notu → geri al → onay → paylaşıldı), İş Planı kutusu/süzme/liste,
// Bugün "Onay bekleyenler" bloğu, iki kullanıcıda canlı, açık/koyu tema kontrastı, mobil, konsol hatası.
// Çalıştırma: BASE=http://127.0.0.1:8921 PERSIST=.wrangler/state-onay NODE_PATH=$(npm root -g) node test/onay.ui.cjs
const { chromium } = require('playwright');
const OUT = process.env.OUT || '/tmp/claude-0/-workspace/7539e9e2-d3d4-5cef-ae86-ba86fa5875af/scratchpad/ekran';
(async () => {
  const lib = await import('./lib.mjs');
  const { t, ok, eq, done, loginAs, sql, BASE } = lib;
  await loginAs('u_yigit', 'Yiğit'); await loginAs('u_pelin', 'Pelin');
  sql(`INSERT INTO tasks (id, title, client, assignee_id, created_by, due_date, status) VALUES ('t_on1', 'Kasım kampanya carousel', 'Nevvital', 'u_pelin', 'u_yigit', date('now', '+5 days'), 1), ('t_on2', 'Diş Hekimleri Günü postu', 'Arslandent', 'u_pelin', 'u_yigit', date('now', '+2 days'), 1), ('t_on3', 'Aralık reels kurgusu', 'Miradent', 'u_yigit', 'u_yigit', date('now', '+8 days'), 1), ('t_on4', 'Yılbaşı story seti', 'Nevvital', 'u_pelin', 'u_pelin', date('now', '+9 days'), 0)`);
  sql(`UPDATE tasks SET approval = 'sent', sent_at = datetime('now', '-5 days'), approval_at = datetime('now', '-5 days') WHERE id = 't_on2'`);
  sql(`UPDATE tasks SET approval = 'sent', sent_at = datetime('now', '-1 days'), approval_at = datetime('now', '-1 days'), revisions = 1 WHERE id = 't_on3'`);
  sql(`UPDATE tasks SET approval = 'revision', revisions = 2, approval_at = datetime('now', '-2 hours') WHERE id = 't_on4'`);

  const b = await chromium.launch();
  const errs = [];
  const login = async (email, viewport = { width: 1360, height: 860 }, extra = {}) => {
    const ctx = await b.newContext({ viewport, deviceScaleFactor: 1, ...extra }); const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(email + ' pageerror: ' + e.message));
    let in_ = false; // giriş sayfasındaki beklenen 401 (/api/me) sayılmaz
    p.on('console', (m) => { if (in_ && m.type() === 'error') errs.push(email + ' console: ' + m.text()); });
    await p.goto(BASE + '/giris'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
    await p.waitForURL((u) => !u.pathname.startsWith('/giris')); in_ = true; return p;
  };
  const P = await login('pelin@mayaajans.net'), Y = await login('yigiitozdemir@gmail.com');
  const shot = (pg, n) => pg.screenshot({ path: `${OUT}/onay-${n}.png` });
  const db = (id) => sql(`SELECT approval, status, revisions, completed_at, sent_at FROM tasks WHERE id='${id}'`)[0];
  const strip = (pg) => pg.locator('.drawer .onay');
  const cur = (pg) => strip(pg).locator('.onay-steps li[aria-current="step"] .l').innerText();
  const step = (pg, name) => strip(pg).getByRole('button', { name, exact: true });

  await P.goto(BASE + '/isler'); await Y.goto(BASE + '/isler');
  await t('işi aç: onay şeridi Hazırlanıyor\'da', async () => {
    await P.locator('.tcard', { hasText: 'Kasım kampanya carousel' }).click();
    await strip(P).waitFor();
    eq(await cur(P), 'Hazırlanıyor'); eq(await strip(P).locator('.onay-steps li').count(), 5);
  });
  await t('Onaya gönderildi → adım vurgulu, DB sent/status 1; Yiğit\'te kart rozeti canlı', async () => {
    await step(P, 'Onaya gönderildi').click();
    await P.locator('.snack', { hasText: 'Onaya gönderildi' }).waitFor();
    eq(await cur(P), 'Onaya gönderildi'); eq(db('t_on1').approval, 'sent'); eq(db('t_on1').status, 1);
    await Y.locator('.tcard', { hasText: 'Kasım kampanya carousel' }).locator('.onay-badge', { hasText: 'Onayda · bugün gönderildi' }).waitFor({ timeout: 5000 });
  });
  await t('Revize istendi: not alanı açılır, kaydedilir; geçmişte not ve kişi', async () => {
    await step(P, 'Revize istendi').click();
    const ta = P.getByRole('textbox', { name: /Müşteri ne dedi/ }); await ta.waitFor();
    ok(await ta.evaluate((e) => e === document.activeElement), 'not alanı odakta değil');
    await ta.fill('Logo biraz daha büyük olsun, fiyat yazmayalım');
    await P.getByRole('button', { name: 'Revizeyi kaydet' }).click();
    await strip(P).locator('.onay-note', { hasText: 'Logo biraz daha büyük olsun' }).waitFor();
    ok((await cur(P)).startsWith('Revize istendi'), 'adım revize değil');
    eq(db('t_on1').approval, 'revision'); eq(db('t_on1').revisions, 1);
    ok((await strip(P).locator('.onay-log li').first().innerText()).includes('Pelin'), 'kişi adı yok');
    await Y.locator('.tcard', { hasText: 'Kasım kampanya carousel' }).locator('.onay-badge', { hasText: 'Revize ×1' }).waitFor({ timeout: 5000 });
    await shot(P, 'drawer-revize');
  });
  await t('yanlış tık → Geri al', async () => {
    await step(P, 'Onaylandı').click(); await P.waitForFunction(() => document.querySelector('.drawer .onay-steps li[aria-current="step"]')?.textContent.includes('Onaylandı'));
    eq(db('t_on1').approval, 'approved');
    await strip(P).getByRole('button', { name: 'Geri al' }).click();
    await P.locator('.snack', { hasText: 'Geri alındı' }).waitFor();
    eq(db('t_on1').approval, 'revision'); eq(db('t_on1').revisions, 1);
  });
  await t('Tekrar onaya gönderildi → Onaylandı → Paylaşıldı: status 2, teslim linki sorulur', async () => {
    await step(P, 'Tekrar onaya gönderildi').click(); await P.waitForFunction(() => document.querySelector('.drawer .onay-steps li[aria-current="step"]')?.textContent.includes('Onaya gönderildi'));
    await step(P, 'Onaylandı').click(); await P.waitForFunction(() => document.querySelector('.drawer .onay-steps li[aria-current="step"]')?.textContent.includes('Onaylandı'));
    eq(db('t_on1').status, 1, 'Onaylandı status değiştirmemeli');
    await step(P, 'Paylaşıldı').click();
    await P.locator('.snack', { hasText: 'Paylaşıldı' }).waitFor();
    eq(db('t_on1').approval, 'published'); eq(db('t_on1').status, 2); ok(db('t_on1').completed_at);
    await P.getByLabel('Bitmiş çalışmanın Drive linki').waitFor();
    eq(await P.locator('.drawer .seg[aria-label="Durum"] button.on').innerText().then((s) => s.trim()), 'Tamamlandı');
    await strip(P).getByRole('button', { name: 'Tüm geçmiş (5)' }).click();
    eq(await strip(P).locator('.onay-log li').count(), 5);
    ok((await strip(P).locator('.onay-log li').first().innerText()).includes('Paylaşıldı'), 'son adım geçmişte değil');
    await shot(P, 'drawer-paylasildi');
    await P.getByRole('button', { name: 'Şimdilik geç' }).click();
    await P.keyboard.press('Escape');
    await Y.locator('.tcard.done', { hasText: 'Kasım kampanya carousel' }).waitFor({ timeout: 5000 });
  });
  await t('İş Planı: "Onay bekleyen" kutusu sayısı ve süzme', async () => {
    const box = Y.locator('.stat', { hasText: 'Onay bekleyen' });
    eq(await box.locator('.v').innerText(), '2');
    await box.click(); eq(await box.getAttribute('aria-pressed'), 'true');
    const titles = await Y.locator('.board .tcard .title').allInnerTexts();
    eq(JSON.stringify(titles.sort()), JSON.stringify(['Aralık reels kurgusu', 'Diş Hekimleri Günü postu']));
    ok(await Y.locator('.tcard', { hasText: 'Diş Hekimleri Günü postu' }).locator('.onay-badge.late', { hasText: '5 gündür' }).count() === 1, '5 günlük kırmızı değil');
    await shot(Y, 'isplani-suz');
  });
  await t('liste görünümü: Onay sütunu, en eski gönderilen üstte; Revize ×2 etiketi', async () => {
    await Y.getByRole('button', { name: 'Liste', exact: true }).click();
    eq(await Y.locator('.table thead th').nth(4).innerText(), 'Onay');
    const first = await Y.locator('.table tbody tr').first().innerText(); ok(first.includes('Diş Hekimleri Günü postu') && first.includes('Onayda · 5 gündür'), first);
    await Y.locator('.stat', { hasText: 'Onay bekleyen' }).click();
    await Y.locator('.table tbody tr', { hasText: 'Yılbaşı story seti' }).locator('.onay-badge', { hasText: 'Revize ×2' }).waitFor();
    await shot(Y, 'isplani-liste');
    await Y.getByRole('button', { name: 'Pano', exact: true }).click();
  });
  await t('Bugün · Benim günüm: Onay bekleyenler (en eski üstte, 3 günü geçen kırmızı)', async () => {
    await P.goto(BASE + '/');
    const blk = P.locator('section.card', { has: P.getByRole('heading', { name: /Onay bekleyenler/ }) });
    await blk.waitFor();
    const items = blk.locator('button:has(.tag)');
    eq(await items.count(), 1);
    ok((await items.first().innerText()).includes('Diş Hekimleri Günü postu'));
    eq(await items.first().locator('.tag.late').innerText(), 'Onayda · 5 gündür');
    await shot(P, 'bugun-benim');
  });
  await t('Bugün · Tüm ekip: iki iş, en eski üstte, canlı güncellenir', async () => {
    await P.getByRole('button', { name: 'Tüm ekip' }).click();
    const blk = P.locator('section.card', { has: P.getByRole('heading', { name: /Onay bekleyenler/ }) });
    const items = blk.locator('button:has(.tag)');
    eq(await items.count(), 2);
    ok((await items.nth(0).innerText()).includes('Diş Hekimleri'), 'sıra'); ok((await items.nth(1).innerText()).includes('Aralık reels'));
    eq(await items.nth(1).locator('.tag').getAttribute('class'), 'tag soon');
    // Yiğit başka sekmede Onaylandı işaretler → Pelin'in Bugün ekranından düşer
    await Y.locator('.tcard', { hasText: 'Aralık reels kurgusu' }).click();
    await step(Y, 'Onaylandı').click();
    await P.waitForFunction(() => [...document.querySelectorAll('section.card')].find((s) => s.textContent.includes('Onay bekleyenler'))?.querySelectorAll('button .tag').length === 1, null, { timeout: 5000 });
    await Y.keyboard.press('Escape');
    await shot(P, 'bugun-ekip');
  });

  // tema: açık / koyu ekran görüntüsü + kontrast
  const audit = (pg) => pg.evaluate(() => {
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
    const bad = []; const seen = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      if (!el.closest('.onay, .onay-badge, .stat, section.card')) continue; // bu bölümün ekledikleri
      if (el.closest('.avatar, [aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      const fg0 = parse(cs.color); const bg = bgOf(el); if (!fg0 || !bg) continue;
      const fg = blend({ ...fg0, a: fg0.a * op }, bg);
      const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < need) bad.push(`${ratio.toFixed(2)} "${n.textContent.trim().slice(0, 40)}" ${cs.color}`);
    }
    return bad;
  });
  for (const theme of ['light', 'dark']) {
    await t(`${theme === 'dark' ? 'Koyu' : 'Açık'} tema: ekran görüntüsü + kontrast ≥ 4.5`, async () => {
      await Y.getByRole('radio', { name: theme === 'dark' ? 'Koyu' : 'Açık' }).click();
      eq(await Y.evaluate(() => document.documentElement.dataset.theme), theme);
      const bad = [];
      await Y.goto(BASE + '/isler'); await Y.locator('.stat', { hasText: 'Onay bekleyen' }).waitFor(); await Y.waitForTimeout(300);
      await shot(Y, `${theme}-isplani`); bad.push(...(await audit(Y)).map((x) => 'İş Planı ' + x));
      await Y.locator('.tcard', { hasText: 'Diş Hekimleri Günü postu' }).click(); await strip(Y).waitFor(); await Y.waitForTimeout(300);
      await shot(Y, `${theme}-drawer`); bad.push(...(await audit(Y)).map((x) => 'Detay ' + x));
      await step(Y, 'Revize istendi').click(); await Y.getByRole('textbox', { name: /Müşteri ne dedi/ }).waitFor();
      bad.push(...(await audit(Y)).map((x) => 'Revize formu ' + x));
      await Y.getByRole('button', { name: 'Vazgeç' }).click();
      await Y.keyboard.press('Escape');
      await Y.goto(BASE + '/'); await Y.getByRole('button', { name: 'Tüm ekip' }).click(); await Y.waitForTimeout(300);
      await shot(Y, `${theme}-bugun`); bad.push(...(await audit(Y)).map((x) => 'Bugün ' + x));
      eq(bad.length, 0, bad.join(' | '));
    });
  }
  await Y.getByRole('radio', { name: 'Açık' }).click();

  await t('mobil (iPhone): drawer şeridi ve Bugün bloğu taşmadan', async () => {
    const M = await login('pelin@mayaajans.net', { width: 390, height: 844 }, { isMobile: true, hasTouch: true });
    await M.goto(BASE + '/isler?is=t_on2'); await strip(M).waitFor(); await M.waitForTimeout(300);
    const over = await M.evaluate(() => { const s = document.querySelector('.drawer .onay'); return s.scrollWidth - s.clientWidth; });
    ok(over <= 1, 'şerit yatay taşıyor: ' + over);
    for (const n of await strip(M).locator('.onay-actions button').all()) { const bb = await n.boundingBox(); ok(bb.height >= 32, 'düğme küçük'); }
    await shot(M, 'mobil-drawer');
    await M.keyboard.press('Escape'); await M.goto(BASE + '/'); await M.getByRole('heading', { name: /Onay bekleyenler/ }).scrollIntoViewIfNeeded(); await M.waitForTimeout(200);
    eq(await M.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'sayfa yatay taşıyor');
    await shot(M, 'mobil-bugun');
  });
  await t('hızlı ekleme değişmeden çalışır', async () => {
    await Y.goto(BASE + '/isler');
    await Y.getByPlaceholder(/Yeni iş ekle/).fill('Hızlı onay dışı iş');
    await Y.getByLabel('Teslim tarihi').fill('2026-12-20');
    await Y.getByRole('button', { name: 'Ekle', exact: true }).click();
    await Y.locator('.tcard', { hasText: 'Hızlı onay dışı iş' }).waitFor();
    eq(await Y.locator('.tcard', { hasText: 'Hızlı onay dışı iş' }).locator('.onay-badge').count(), 0);
  });
  await t('konsol hatası yok', async () => eq(errs.length, 0, errs.join(' | ')));
  await b.close();
  done();
})().catch((e) => { console.error(e); process.exit(1); });
