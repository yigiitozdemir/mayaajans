// Hava durumu (Paket B): dış çekim işareti, Open-Meteo özeti (HAVA_SAHTE ile), kart rozeti + detay, 17:00 uyarısı.
// Sunucu: wrangler dev ... --var HAVA_SAHTE:'{"now":"<bugün>T14:05:00Z","konumlar":{"Kumsal":{"pop":75,"wind":20,"temp":14,"code":63},
//   "Tepe":{"pop":10,"wind":45,"temp":12,"code":3},"Park":{"pop":5,"wind":10,"temp":18,"code":1}},"hata":["Ağsız"],"bulunamaz":["Bilinmeyen"]}'
// Çalıştırma: BASE=http://127.0.0.1:8812 WEB=http://127.0.0.1:8912 PERSIST=<db> NODE_PATH=$(npm root -g) node test/hava.ui.cjs [ekran klasörü]
// SAAT_DISI=1 ile (HAVA_SAHTE.now 17:00 dışında başlatılmış sunucuda) yalnızca "17:00 dışında uyarı gitmez" denetlenir.
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
const WEB = process.env.WEB || 'http://127.0.0.1:8912';

(async () => {
  const lib = await import('./lib.mjs');
  const { t, ok, eq, done, loginAs, sql, runCron, openLive, until } = lib;
  const yigit = await loginAs('u_yigit', 'Yiğit');
  const pelin = await loginAs('u_pelin', 'Pelin');
  const emre = await loginAs('u_emre', 'Emre');
  const istDate = (n = 0) => new Date(Date.now() + 3 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  const TOM = istDate(1);
  const havaN = (uid) => sql(`SELECT COUNT(*) n FROM notifications WHERE kind='hava' AND user_id='${uid}'`)[0].n;

  if (process.env.SAAT_DISI) {
    await t('17:00 dışında hava uyarısı gönderilmez', async () => {
      const r = await yigit.post('/api/shoots', { title: 'Saat dışı deneme', client: 'Saatdent', date: TOM, time: '14:00', location: 'Kumsal', outdoor: true, crew: ['u_pelin'] });
      eq(r.status, 201);
      const before = havaN('u_pelin');
      await runCron('5 * * * *'); await new Promise((r) => setTimeout(r, 800));
      eq(havaN('u_pelin'), before);
      eq(sql(`SELECT COUNT(*) n FROM weather_alerts WHERE shoot_id='${r.data.id}'`)[0].n, 0);
      await yigit.del('/api/shoots/' + r.data.id);
    });
    return done();
  }

  sql("DELETE FROM notifications WHERE kind='hava'"); sql('DELETE FROM weather_alerts');
  // önceki çalıştırmadan kalanlar (test yeniden çalıştırılabilsin)
  sql("DELETE FROM shoots WHERE outdoor = 1 OR title IN ('Stüdyo çekimi','Uzak çekim')");
  const mk = async (body) => { const r = await yigit.post('/api/shoots', { crew: ['u_pelin', 'u_emre'], ...body }); if (r.status !== 201) throw new Error(JSON.stringify(r.data)); return r.data; };
  let S = {};
  await t('dış çekim işareti: ekle / düzenle / doğrulama', async () => {
    S.rain = await mk({ title: 'Sahil reels çekimi', client: 'Çavuşdent', date: TOM, time: '14:00', location: 'Kumsal, Marmara Ereğlisi', outdoor: true });
    eq(S.rain.outdoor, true);
    S.wind = await mk({ title: 'Tepe drone çekimi', client: 'Nevvital', date: TOM, time: 'Tam gün', location: 'Tepe', outdoor: true });
    S.fine = await mk({ title: 'Park çekimi', client: 'Arslandent', date: TOM, time: '10:00', location: 'Park', outdoor: true });
    S.indoor = await mk({ title: 'Stüdyo çekimi', client: 'Çavuşdent', date: TOM, time: '14:00', location: 'Kumsal stüdyo' });
    eq(S.indoor.outdoor, false);
    S.net = await mk({ title: 'Ağsız çekim', client: 'Deneme', date: TOM, time: '14:00', location: 'Ağsız köy', outdoor: true });
    S.unknown = await mk({ title: 'Bilinmeyen yer çekimi', client: 'Deneme', date: istDate(3), time: 'Sabah', location: 'Bilinmeyen yer', outdoor: true });
    S.far = await mk({ title: 'Uzak çekim', client: 'Deneme', date: istDate(20), time: '10:00', location: 'Kumsal', outdoor: true });
    eq((await yigit.patch('/api/shoots/' + S.indoor.id, { outdoor: 'evet' })).status, 400);
    const r = await yigit.patch('/api/shoots/' + S.indoor.id, { outdoor: true }); eq(r.data.outdoor, true);
    eq((await yigit.patch('/api/shoots/' + S.indoor.id, { outdoor: false })).data.outdoor, false);
    const list = (await pelin.get('/api/shoots')).data;
    eq(list.find((x) => x.id === S.rain.id).outdoor, true);
  });
  let H = {};
  await t('GET /shoots/hava: yalnızca 16 gün içindeki planlı dış çekimler', async () => {
    const r = await pelin.get('/api/shoots/hava'); eq(r.status, 200); H = r.data;
    ok(H[S.rain.id] && H[S.wind.id] && H[S.fine.id] && H[S.unknown.id], Object.keys(H).join());
    ok(!H[S.indoor.id], 'iç çekimde hava olmamalı'); ok(!H[S.far.id], '16 günden uzak');
    ok(!H[S.net.id], 'ağ hatasında hava gösterilmemeli');
  });
  await t('özet: çekim saatine göre, risk eşikleri (%50 yağış / 35 km/sa rüzgâr)', async () => {
    const a = H[S.rain.id];
    eq(a.pop, 75); eq(a.hour, '14:00'); eq(a.risk, true); eq(a.icon, '🌧️'); eq(a.temp, 14); eq(a.range, '14:00–16:00');
    ok(a.reason.includes('%75'), a.reason);
    const w = H[S.wind.id]; eq(w.risk, true); eq(w.wind, 45); eq(w.range, '08:00–18:00'); ok(w.reason.includes('Rüzgâr 45 km/sa'));
    const f = H[S.fine.id]; eq(f.risk, false); eq(f.reason, '');
    eq(H[S.unknown.id].place, 'Çorlu (varsayılan)'); eq(H[S.unknown.id].range, '08:00–11:00');
  });
  await t('17:00 cron: riskli yarınki dış çekimler için ekip + yöneticiye bildirim; ayarı kapalı olana gitmez', async () => {
    eq((await emre.patch('/api/me', { settings: { havaUyarisi: false } })).status, 200);
    const live = openLive(pelin); await live.ready;
    await runCron('5 * * * *');
    ok(await until(() => live.msgs.some((m) => m.type === 'notify' && m.notification.kind === 'hava'), 5000), 'canlı bildirim gelmedi');
    live.ws.close();
    const rows = sql(`SELECT user_id, title, link FROM notifications WHERE kind='hava' ORDER BY user_id, title`);
    const p = rows.filter((x) => x.user_id === 'u_pelin');
    eq(p.length, 2, JSON.stringify(rows));
    const rain = p.find((x) => x.link === '/cekim?id=' + S.rain.id);
    eq(rain && rain.title, '🌧️ Yarın Çavuşdent dış çekiminde yağmur bekleniyor (%75, 14:00)');
    ok(p.some((x) => x.link === '/cekim?id=' + S.wind.id && x.title.startsWith('💨 Yarın Nevvital dış çekiminde kuvvetli rüzgâr')), JSON.stringify(p));
    eq(rows.filter((x) => x.user_id === 'u_yigit').length, 2, 'yönetici de almalı');
    eq(rows.filter((x) => x.user_id === 'u_emre').length, 0, 'ayarı kapalı olana gitmemeli');
    ok(!rows.some((x) => x.link === '/cekim?id=' + S.fine.id || x.link === '/cekim?id=' + S.indoor.id), 'risksiz / iç çekim');
  });
  await t('aynı gün ikinci kez çalışınca tekrar göndermez', async () => {
    const n = havaN('u_pelin');
    await runCron('5 * * * *'); await new Promise((r) => setTimeout(r, 600));
    eq(havaN('u_pelin'), n);
    eq(sql("SELECT COUNT(*) n FROM weather_alerts")[0].n, 2);
  });
  await emre.patch('/api/me', { settings: { havaUyarisi: true } });

  // ---------- arayüz ----------
  const b = await chromium.launch();
  const errs = [];
  const open = async (theme, w, h, path) => {
    await yigit.patch('/api/me', { settings: { theme } });
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900 });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await p.goto(WEB + '/giris');
    await p.fill('input[type=email]', 'yigiitozdemir@gmail.com'); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
    await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
    await p.goto(WEB + path); await p.waitForTimeout(1200);
    return { p, ctx };
  };
  await t('kartlarda hava rozeti; riskli kartta uyarı', async () => {
    const { p, ctx } = await open('dark', 1360, 900, '/cekim');
    const card = p.locator('.ck-card', { hasText: 'Sahil reels çekimi' });
    await card.locator('.ck-hava.risk').waitFor();
    ok((await card.locator('.ck-hava').textContent()).includes('14°'), 'sıcaklık');
    ok((await card.locator('.ck-hava').textContent()).includes('%75'));
    ok((await card.locator('.ck-hava-w').textContent()).includes('Yağış olasılığı %75'));
    const fine = p.locator('.ck-card', { hasText: 'Park çekimi' });
    ok(await fine.locator('.ck-hava:not(.risk)').isVisible(), 'risksiz rozet');
    ok(!(await fine.locator('.ck-hava-w').count()));
    ok(!(await p.locator('.ck-card', { hasText: 'Stüdyo çekimi' }).locator('.ck-hava').count()), 'iç çekimde rozet olmamalı');
    ok(!(await p.locator('.ck-card', { hasText: 'Ağsız çekim' }).locator('.ck-hava').count()), 'ağ hatasında rozet olmamalı');
    await p.locator('.ck-card', { hasText: 'Sahil reels çekimi' }).scrollIntoViewIfNeeded();
    await p.screenshot({ path: OUT + '/hava-koyu-masaustu.png' });
    const rep = await audit(p, '.ck-main'); eq(rep.length, 0, rep.slice(0, 6).join(' | '));
    await ctx.close();
  });
  await t('bildirim bağlantısı detayı açar; hava kutusu ve açıklama', async () => {
    const { p, ctx } = await open('dark', 1360, 900, '/cekim?id=' + S.rain.id);
    await p.waitForSelector('.drawer .ck-hv.risk');
    const txt = await p.textContent('.drawer .ck-hv');
    ok(txt.includes('Yağış olasılığı %75') && txt.includes('yedek plan'), txt);
    ok(await p.getByRole('switch', { name: /Dış çekim/ }).getAttribute('aria-checked') === 'true');
    await p.waitForTimeout(600); await p.screenshot({ path: OUT + '/hava-koyu-detay.png' });
    const rep = await audit(p, '.drawer'); eq(rep.length, 0, rep.slice(0, 6).join(' | '));
    await ctx.close();
  });
  await t('uzak dış çekimde "16 gün kala" notu; anahtarla dış çekim kapatılır', async () => {
    const { p, ctx } = await open('light', 1360, 900, '/cekim?id=' + S.far.id);
    await p.waitForSelector('.drawer .ck-hv.soon');
    await p.getByRole('switch', { name: /Dış çekim/ }).click();
    ok(await until(() => true));
    await p.waitForFunction(() => !document.querySelector('.drawer .ck-hv'));
    eq((await yigit.get('/api/shoots/' + S.far.id)).data.outdoor, false);
    await ctx.close();
  });
  await t('formda "Dış çekim" anahtarı', async () => {
    const { p, ctx } = await open('light', 1360, 900, '/cekim');
    await p.getByRole('button', { name: 'Yeni çekim' }).click();
    await p.fill('.dialog input.input >> nth=0', 'Form dış çekim');
    await p.fill('.dialog input[type=date]', istDate(2));
    await p.fill('.dialog input[placeholder^="Örn. Klinik"]', 'Kumsal');
    await p.locator('.dialog').getByRole('switch', { name: /Dış çekim/ }).click();
    await p.locator('.dialog').screenshot({ path: OUT + '/hava-acik-form.png' });
    await p.getByRole('button', { name: 'Çekimi ekle' }).click();
    await p.locator('.ck-card', { hasText: 'Form dış çekim' }).locator('.ck-hava').waitFor();
    const list = (await yigit.get('/api/shoots')).data;
    eq(list.find((x) => x.title === 'Form dış çekim').outdoor, true);
    await p.locator('.ck-card', { hasText: 'Sahil reels çekimi' }).scrollIntoViewIfNeeded();
    await p.screenshot({ path: OUT + '/hava-acik-masaustu.png' });
    const rep = await audit(p, '.ck-main'); eq(rep.length, 0, rep.slice(0, 6).join(' | '));
    await ctx.close();
  });
  await t('telefon: koyu + açık, yatay taşma yok', async () => {
    for (const theme of ['dark', 'light']) {
      const { p, ctx } = await open(theme, 390, 844, '/cekim');
      await p.locator('.ck-card', { hasText: 'Sahil reels çekimi' }).scrollIntoViewIfNeeded();
      await p.waitForTimeout(200);
      await p.screenshot({ path: OUT + '/hava-' + (theme === 'dark' ? 'koyu' : 'acik') + '-telefon.png' });
      const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(sw <= 0, 'yatay taşma ' + sw);
      const rep = await audit(p, '.ck-main'); eq(rep.length, 0, theme + ': ' + rep.slice(0, 6).join(' | '));
      await p.goto(WEB + '/cekim?id=' + S.rain.id); await p.waitForSelector('.drawer .ck-hv'); await p.waitForTimeout(900);
      await p.screenshot({ path: OUT + '/hava-' + (theme === 'dark' ? 'koyu' : 'acik') + '-telefon-detay.png' });
      await ctx.close();
    }
  });
  await t('konsol hatası yok', async () => eq(errs.length, 0, errs.join(' | ')));
  await b.close();
  done();
})();

function audit(p, sel) {
  return p.evaluate((sel) => {
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
      let base = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
      return base;
    };
    const root = document.querySelector(sel) || document.body;
    const bad = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      if (el.closest('[aria-hidden="true"]') || el.closest('.av')) continue;
      if (/^\p{Extended_Pictographic}/u.test(n.textContent.trim())) continue; // emoji
      let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      const fg0 = parse(cs.color); const bg = bgOf(el); if (!fg0 || !bg) continue;
      const fg = blend({ ...fg0, a: fg0.a * op }, bg);
      const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < need) bad.push(`${ratio.toFixed(2)} <${need} "${n.textContent.trim().slice(0, 40)}" ${cs.color}`);
    }
    return bad;
  }, sel);
}
