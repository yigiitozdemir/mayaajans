// Tema kontrolü: her ekranı Açık ve Koyu temada açar, ekran görüntüsü alır ve yazı/zemin kontrastını ölçer.
// Çalıştırma: BASE=http://127.0.0.1:8787 NODE_PATH=$(npm root -g) node test/tema.ui.cjs <klasör>
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
(async () => {
  const lib = await import('./lib.mjs');
  const { t, ok, eq, done, loginAs, sql, BASE } = lib;
  await loginAs('u_yigit', 'Yiğit'); await loginAs('u_pelin', 'Pelin');
  // örnek veri: özel gün satırları, mesaj, müşteri kiti, tamamlanmış iş
  sql("INSERT INTO special_day_rows (day_id, client, format, assignee_id, status, done_by, done_at) SELECT id, 'Nevvital', 'Post', 'u_pelin', 2, 'u_pelin', datetime('now') FROM special_days ORDER BY date LIMIT 3");
  sql("INSERT INTO special_day_rows (day_id, client, format, assignee_id) SELECT id, 'Arslandent', 'Story', 'u_yigit' FROM special_days ORDER BY date LIMIT 3");
  sql("INSERT INTO messages (id, channel_id, user_id, text) VALUES ('m_t1','ch_genel','u_pelin','Günaydın ekip! @Yiğit görselleri onaya attım https://mayaajans.net'), ('m_t2','ch_genel','u_yigit','Süper, bakıyorum.')");
  sql(`UPDATE clients SET kit = '{"sector":"Diş kliniği","colors":[{"hex":"#0E5E6F","name":"Petrol"},{"hex":"#000000","name":"Siyah"},{"hex":"#FFFFFF","name":"Beyaz"}],"fonts":[{"name":"Inter","use":"Başlık"}],"tone":["Samimi"],"banned":["ucuz"],"tagSets":[{"name":"Genel","tags":"#dis #gulus"}],"links":{},"notes":[]}' WHERE id = 'c_01'`);
  sql("UPDATE tasks SET status = 2, done_link = 'https://drive.google.com/x', completed_at = datetime('now') WHERE id IN (SELECT id FROM tasks WHERE status != 2 LIMIT 2)");
  sql("INSERT INTO notifications (id, user_id, kind, title, body) VALUES ('n_t1','u_yigit','shoot','Çekim ekibine eklendin','Nevvital Davet')");

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, colorScheme: 'light' });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/giris');
  await p.fill('input[type=email]', 'yigiitozdemir@gmail.com'); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
  await p.waitForURL((u) => !u.pathname.startsWith('/giris'));

  const PAGES = [['/', 'bugun'], ['/isler', 'isler'], ['/ozel-gunler', 'ozelgunler'], ['/cekim', 'cekim'], ['/musteriler?id=c_01', 'musteriler'], ['/sohbet?c=ch_genel', 'sohbet'], ['/durt', 'durt'], ['/ekip', 'ekip']];
  // görünen her yazının rengini, arkasındaki gerçek zemin rengiyle karşılaştır (WCAG oranı)
  const audit = () => p.evaluate(() => {
    const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(',').map((x) => parseFloat(x)); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; };
    const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
    const bgOf = (el) => {
      const stack = [];
      for (let e = el; e; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('gradient')) return null; // resim üstü: ölçme
        const c = parse(cs.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
      }
      let base = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
      return base;
    };
    const bad = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      const fg0 = parse(cs.color); const bg = bgOf(el); if (!fg0 || !bg) continue;
      const fg = blend({ ...fg0, a: fg0.a * op }, bg);
      const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < need) bad.push(`${ratio.toFixed(2)} <${need} "${n.textContent.trim().slice(0, 40)}" ${cs.color} / ${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName}`);
    }
    return bad;
  });

  const report = {};
  for (const theme of ['light', 'dark']) {
    await t(`menüden ${theme === 'dark' ? 'Koyu' : 'Açık'} seçilir`, async () => {
      await p.getByRole('radio', { name: theme === 'dark' ? 'Koyu' : 'Açık' }).click();
      eq(await p.evaluate(() => document.documentElement.dataset.theme), theme);
    });
    for (const [path, name] of PAGES) {
      await p.goto(BASE + path); await p.waitForTimeout(900);
      eq(await p.evaluate(() => document.documentElement.dataset.theme), theme, 'yenilemeden sonra tema korunmalı');
      await p.screenshot({ path: `${OUT}/${theme}-${name}.png` });
      report[`${theme} ${name}`] = await audit();
    }
  }
  await t('seçim hesaba kaydedildi', async () => eq(JSON.parse(sql("SELECT settings FROM users WHERE id='u_yigit'")[0].settings).theme, 'dark'));
  await t('Sistem: Mac koyuysa koyu, açıksa açık', async () => {
    await p.getByRole('radio', { name: 'Sistem' }).click();
    await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(200);
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await p.emulateMedia({ colorScheme: 'light' }); await p.waitForTimeout(200);
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'light');
  });
  await t('başka cihaza yansır (aynı hesap, ikinci tarayıcı)', async () => {
    await p.getByRole('radio', { name: 'Koyu' }).click(); await p.waitForTimeout(500);
    const c2 = await b.newContext({ colorScheme: 'light' }); const p2 = await c2.newPage();
    await p2.goto(BASE + '/giris'); await p2.fill('input[type=email]', 'yigiitozdemir@gmail.com'); await p2.fill('input[type=password]', 'TestSifre123'); await p2.keyboard.press('Enter');
    await p2.waitForURL((u) => !u.pathname.startsWith('/giris')); await p2.waitForTimeout(800);
    eq(await p2.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await p.getByRole('radio', { name: 'Açık' }).click();
    ok(await (async () => { for (let i = 0; i < 40; i++) { if (await p2.evaluate(() => document.documentElement.dataset.theme) === 'light') return true; await p2.waitForTimeout(100); } return false; })(), 'canlı yansımadı');
    await c2.close();
  });
  await t('açılışta beyaz parlama yok (koyu kayıtlıyken ilk çizim koyu)', async () => {
    await p.getByRole('radio', { name: 'Koyu' }).click();
    const c3 = await b.newContext(); const p3 = await c3.newPage();
    await p3.addInitScript(() => { try { localStorage.setItem('maya.theme', 'dark'); } catch (e) {} });
    await p3.goto(BASE + '/giris', { waitUntil: 'commit' });
    await p3.waitForSelector('html[data-theme]', { timeout: 3000 });
    eq(await p3.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await p3.waitForTimeout(500); await p3.screenshot({ path: `${OUT}/dark-giris.png` });
    await c3.close();
  });
  await t('konsol hatası yok', async () => eq(errs.length, 0, errs.join(' | ')));
  for (const [k, v] of Object.entries(report)) if (v.length) console.log(`\nKONTRAST ${k}: ${v.length}\n  ` + v.slice(0, 12).join('\n  '));
  await b.close(); done();
})();
