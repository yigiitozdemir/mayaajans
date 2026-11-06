// Takvim eşitleme (Paket B): gizli abonelik adresi, iCalendar geçerliliği, kişiye özel Ajandam, yenile/kapat, profil arayüzü.
// Çalıştırma: BASE=http://127.0.0.1:8812 WEB=http://127.0.0.1:8912 PERSIST=<db> NODE_PATH=$(npm root -g) node test/takvim.ui.cjs [ekran klasörü]
const { chromium } = require('playwright');
const OUT = process.argv[2] || '.';
const WEB = process.env.WEB || 'http://127.0.0.1:8912';

const unfold = (s) => s.replace(/\r\n[ \t]/g, '');
function icsCheck(txt) {
  const errs = [];
  if (!txt.endsWith('\r\n')) errs.push('CRLF ile bitmiyor');
  if (/[^\r]\n/.test(txt)) errs.push('yalın LF var');
  const lines = txt.split('\r\n'); lines.pop();
  for (const l of lines) if (Buffer.byteLength(l, 'utf8') > 75) errs.push('75 sekizliyi aşan satır: ' + l.slice(0, 40));
  const stack = [];
  for (const l of unfold(txt).split('\r\n')) {
    const b = /^BEGIN:(\w+)$/.exec(l), e = /^END:(\w+)$/.exec(l);
    if (b) stack.push(b[1]);
    if (e) { if (stack.pop() !== e[1]) errs.push('BEGIN/END dengesiz: ' + e[1]); }
  }
  if (stack.length) errs.push('kapanmamış: ' + stack.join(','));
  if (!/^BEGIN:VCALENDAR\r\nVERSION:2.0\r\n/.test(txt)) errs.push('başlık hatalı');
  // her VEVENT'te UID, DTSTAMP, DTSTART
  const evs = unfold(txt).split('BEGIN:VEVENT').slice(1);
  for (const ev of evs) for (const k of ['UID:', 'DTSTAMP:', 'DTSTART']) if (!ev.includes('\r\n' + k)) errs.push('VEVENT içinde ' + k + ' yok');
  return errs;
}
const events = (txt) => unfold(txt).split('BEGIN:VEVENT').slice(1).map((e) => e.split('END:VEVENT')[0]);
const prop = (ev, name) => { const m = new RegExp('\\r\\n' + name + '([;:][^\\r\\n]*)').exec('\r\n' + ev); return m ? m[1] : null; };

(async () => {
  const lib = await import('./lib.mjs');
  const { t, ok, eq, done, loginAs, sql, BASE, Client } = lib;
  const pelin = await loginAs('u_pelin', 'Pelin');
  const yigit = await loginAs('u_yigit', 'Yiğit');
  const istDate = (n = 0) => new Date(Date.now() + 3 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
  const D1 = istDate(2), D2 = istDate(3), D3 = istDate(5);
  const ymd = (d) => d.replace(/-/g, '');

  // örnek veri (komut tek satır olmalı: kabuk \n'i çevirmez)
  const sql1 = (q) => sql(q.replace(/\s*\n\s*/g, ' '));
  sql('DELETE FROM calendar_feeds');
  sql1(`DELETE FROM shoots WHERE id LIKE 's_tk%'; DELETE FROM agenda_events WHERE id LIKE 'ae_tk%'; DELETE FROM tasks WHERE id LIKE 't_tk%'`);
  sql1(`INSERT INTO shoots (id, title, client, date, time, location, status, note, crew) VALUES
    ('s_tk1', 'Hasta memnuniyet çekimi', 'Çavuşdent', '${D1}', '10:00', 'Klinik, Çorlu', 0, 'Yedek önlük getir; ışık, reflektör', '["u_pelin","u_yigit"]'),
    ('s_tk2', 'Ürün çekimi', 'Nevvital', '${D2}', 'Sabah', 'Stüdyo', 0, '', '["u_pelin"]'),
    ('s_tk3', 'İPTAL-EDİLEN-ÇEKİM', 'Nevvital', '${D2}', '11:00', '', 2, '', '["u_pelin"]'),
    ('s_tk4', 'BAŞKASININ-ÇEKİMİ', 'Arslandent', '${D2}', '12:00', '', 0, '', '["u_emre"]')`);
  sql1(`INSERT INTO tasks (id, title, client, assignee_id, due_date, status) VALUES
    ('t_tk1', 'Kasım reels kurgusu', 'Çavuşdent', 'u_pelin', '${D3}', 1),
    ('t_tk2', 'BITMIS-IS', 'Çavuşdent', 'u_pelin', '${D3}', 2),
    ('t_tk3', 'BASKASININ-ISI', 'Çavuşdent', 'u_emre', '${D3}', 0)`);
  const longTitle = "Toplantı; A, B ' || char(92) || ' sunum — çok uzun bir başlık 🎯 ile satır katlamasını denemek için yazıldı ve uzadıkça uzadı";
  sql1(`INSERT INTO agenda_events (id, user_id, title, date, start_time, end_time, note, repeat) VALUES
    ('ae_tk1', 'u_pelin', '${longTitle}', '${D1}', '15:30', '16:15', 'Satır 1' || char(10) || 'Satır 2', 'weekly'),
    ('ae_tk2', 'u_pelin', 'Diş hekimi', '${D2}', '', '', '', 'none'),
    ('ae_tk3', 'u_yigit', 'GIZLI-YIGIT-AJANDA', '${D1}', '09:00', '', '', 'none')`);

  let url = '', firstIcs = '';
  await t('girişsiz /api/takvim → 401', async () => eq((await new Client().get('/api/takvim')).status, 401));
  await t('başlangıçta abonelik kapalı, gruplar açık', async () => {
    const r = await pelin.get('/api/takvim'); eq(r.status, 200);
    eq(r.data.active, false); eq(r.data.groups.shoots && r.data.groups.tasks && r.data.groups.agenda && r.data.groups.special, true);
  });
  await t('uydurma adres → 404', async () => {
    eq((await fetch(BASE + '/takvim/' + 'A'.repeat(43) + '.ics')).status, 404);
    eq((await fetch(BASE + '/takvim/kisa.ics')).status, 404);
  });
  await t('bağlantı oluşturulur; veritabanında yalnızca özeti', async () => {
    const r = await pelin.post('/api/takvim/yenile'); eq(r.status, 200);
    url = r.data.url; ok(/\/takvim\/[A-Za-z0-9_-]{40,}\.ics$/.test(url), url);
    ok(r.data.webcal.startsWith('webcal://'), r.data.webcal);
    ok(r.data.google.startsWith('https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2F'), r.data.google);
    const token = /\/takvim\/(.+)\.ics$/.exec(url)[1];
    const row = sql("SELECT token_hash FROM calendar_feeds WHERE user_id = 'u_pelin'")[0];
    ok(row.token_hash && row.token_hash !== token && !row.token_hash.includes(token), 'token düz saklanmış');
    eq(r.data.hint, row.token_hash.slice(0, 10));
  });
  const feedPath = () => BASE + new URL(url).pathname;
  await t('feed: text/calendar, geçerli iCalendar (CRLF, ≤75 sekizli, BEGIN/END dengesi)', async () => {
    const r = await fetch(feedPath()); eq(r.status, 200);
    eq(r.headers.get('content-type'), 'text/calendar; charset=utf-8');
    firstIcs = await r.text();
    const errs = icsCheck(firstIcs); eq(errs.length, 0, errs.slice(0, 5).join(' | '));
    const u = unfold(firstIcs);
    ok(u.includes('\r\nX-WR-CALNAME:Maya Ekip · Pelin\r\n'), 'X-WR-CALNAME');
    ok(u.includes('\r\nX-WR-TIMEZONE:Europe/Istanbul\r\n'), 'X-WR-TIMEZONE');
    ok(u.includes('\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n'), 'REFRESH-INTERVAL');
    ok(u.includes('BEGIN:VTIMEZONE\r\nTZID:Europe/Istanbul') && u.includes('TZOFFSETTO:+0300'), 'VTIMEZONE');
  });
  await t('çekim: saatli (İstanbul saati, 2 saat), konum, ekip, not', async () => {
    const ev = events(firstIcs).find((e) => e.includes('UID:cekim-s_tk1@'));
    ok(ev, 'çekim yok');
    eq(prop(ev, 'DTSTART'), ';TZID=Europe/Istanbul:' + ymd(D1) + 'T100000');
    eq(prop(ev, 'DTEND'), ';TZID=Europe/Istanbul:' + ymd(D1) + 'T120000');
    eq(prop(ev, 'LOCATION'), ':Klinik\\, Çorlu');
    ok(prop(ev, 'SUMMARY').includes('Hasta memnuniyet çekimi · Çavuşdent'), prop(ev, 'SUMMARY'));
    const desc = prop(ev, 'DESCRIPTION');
    ok(desc.includes('Ekip: Pelin Test\\, Yiğit Test') && desc.includes('Yedek önlük getir\\; ışık\\, reflektör'), desc);
  });
  await t('çekim: "Sabah" → tüm gün; iptal ve başkasının çekimi yok', async () => {
    const ev = events(firstIcs).find((e) => e.includes('UID:cekim-s_tk2@'));
    eq(prop(ev, 'DTSTART'), ';VALUE=DATE:' + ymd(D2));
    eq(prop(ev, 'DTEND'), ';VALUE=DATE:' + ymd(istDate(4)));
    ok(prop(ev, 'SUMMARY').includes('(Sabah)'));
    ok(!firstIcs.includes('İPTAL-EDİLEN') && !unfold(firstIcs).includes('BAŞKASININ-ÇEKİMİ'), 'sızıntı');
  });
  await t('teslim: tüm gün "Teslim: <iş> · <müşteri>"; biten ve başkasının işi yok', async () => {
    const ev = events(firstIcs).find((e) => e.includes('UID:teslim-t_tk1@'));
    eq(prop(ev, 'SUMMARY'), ':Teslim: Kasım reels kurgusu · Çavuşdent');
    eq(prop(ev, 'DTSTART'), ';VALUE=DATE:' + ymd(D3));
    const u = unfold(firstIcs);
    ok(!u.includes('BITMIS-IS') && !u.includes('BASKASININ-ISI'));
  });
  await t('Ajandam: kendi etkinlikleri (kaçış, katlama, tekrar); başkasınınki SIZMAZ', async () => {
    const ev = events(firstIcs).find((e) => e.includes('UID:ajanda-ae_tk1@'));
    ok(prop(ev, 'SUMMARY').startsWith(':Toplantı\\; A\\, B \\\\ sunum'), prop(ev, 'SUMMARY'));
    eq(prop(ev, 'DESCRIPTION'), ':Satır 1\\nSatır 2');
    eq(prop(ev, 'RRULE'), ':FREQ=WEEKLY');
    eq(prop(ev, 'DTEND'), ';TZID=Europe/Istanbul:' + ymd(D1) + 'T161500');
    ok(firstIcs.split('\r\n').some((l) => l.startsWith(' ')), 'uzun satır katlanmamış');
    ok(events(firstIcs).some((e) => e.includes('UID:ajanda-ae_tk2@') && prop(e, 'DTSTART') === ';VALUE=DATE:' + ymd(D2)));
    ok(!unfold(firstIcs).includes('GIZLI-YIGIT'), 'Yiğit\'in Ajandam etkinliği Pelin\'in takviminde!');
  });
  await t('özel günler tüm gün', async () => {
    const ev = events(firstIcs).find((e) => e.includes('UID:ozelgun-'));
    ok(ev, 'özel gün yok'); ok(/;VALUE=DATE:\d{8}/.test(prop(ev, 'DTSTART')));
  });
  await t('UID\'ler kalıcı (ikinci çekişte aynı)', async () => {
    const again = await (await fetch(feedPath())).text();
    const uids = (s) => unfold(s).match(/\r\nUID:[^\r]+/g).sort().join();
    eq(uids(again), uids(firstIcs));
    ok(sql("SELECT last_fetched_at FROM calendar_feeds WHERE user_id='u_pelin'")[0].last_fetched_at, 'son çekilme zamanı yazılmadı');
  });
  await t('Yiğit\'in takviminde Yiğit\'in Ajandam\'ı var, Pelin\'inki yok', async () => {
    const r = await yigit.post('/api/takvim/yenile');
    const txt = await (await fetch(BASE + new URL(r.data.url).pathname)).text();
    eq(icsCheck(txt).length, 0);
    ok(unfold(txt).includes('GIZLI-YIGIT-AJANDA') && !unfold(txt).includes('Toplantı\\; A'));
    ok(unfold(txt).includes('X-WR-CALNAME:Maya Ekip · Yiğit'));
  });
  await t('grup seçimi: Ajandam kapatılınca takvimden çıkar; geçersiz grup 400', async () => {
    const r = await pelin.patch('/api/takvim', { groups: { agenda: false } }); eq(r.status, 200); eq(r.data.groups.agenda, false); eq(r.data.groups.shoots, true);
    const txt = await (await fetch(feedPath())).text();
    ok(!txt.includes('UID:ajanda-') && txt.includes('UID:cekim-'));
    eq((await pelin.patch('/api/takvim', { groups: { hack: true } })).status, 400);
    eq((await pelin.patch('/api/takvim', { groups: { tasks: 'evet' } })).status, 400);
    eq((await pelin.patch('/api/takvim', {})).status, 400);
    await pelin.patch('/api/takvim', { groups: { agenda: true } });
  });
  await t('yenileyince eski adres anında 404, yenisi çalışır', async () => {
    const old = feedPath();
    const r = await pelin.post('/api/takvim/yenile'); url = r.data.url;
    eq((await fetch(old)).status, 404);
    eq((await fetch(feedPath())).status, 200);
  });
  await t('kapatınca adres 404, durum kapalı', async () => {
    const r = await pelin.del('/api/takvim'); eq(r.data.active, false);
    eq((await fetch(feedPath())).status, 404);
  });

  // ---------- arayüz ----------
  const b = await chromium.launch();
  const errs = [];
  const shots = async (theme, w, h, name) => {
    await pelin.patch('/api/me', { settings: { theme } });
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900, permissions: ['clipboard-read', 'clipboard-write'] });
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(WEB + '/giris');
    await p.fill('input[type=email]', 'pelin@mayaajans.net'); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
    await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
    await p.waitForTimeout(600);
    if (w < 900) { await p.getByRole('button', { name: 'Menü' }).click(); await p.waitForTimeout(300); }
    await p.getByRole('button', { name: 'Profilimi düzenle' }).click();
    await p.waitForSelector('.tk-head');
    return { p, ctx };
  };

  await t('profil: Takvim eşitleme kapalı görünür, açılınca bağlantı oluşturulur', async () => {
    const { p, ctx } = await shots('dark', 1360, 900);
    ok((await p.textContent('.tk-sub')).includes('Kapalı'));
    await p.click('.tk-head');
    await p.getByRole('button', { name: 'Takvim bağlantımı oluştur' }).click();
    await p.waitForSelector('.tk-url input');
    const g = await p.getAttribute('a:has-text("Google Takvim\'e ekle")', 'href');
    ok(g.startsWith('https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2F'), g);
    const wc = await p.getAttribute('a:has-text("iPhone / Mac Takvim\'e ekle")', 'href');
    ok(wc.startsWith('webcal://') && wc.endsWith('.ics'), wc);
    const v = await p.inputValue('.tk-url input');
    ok(/\/takvim\/[A-Za-z0-9_-]{40,}\.ics$/.test(v));
    // gerçekten çalışan bağlantı (vite yerine API portundan)
    eq((await fetch(BASE + new URL(v).pathname)).status, 200);
    await p.getByRole('button', { name: 'Bağlantıyı kopyala' }).click();
    await p.waitForTimeout(200);
    eq(await p.evaluate(() => navigator.clipboard.readText()), v);
    ok((await p.textContent('.tk-hint')).includes('birkaç saatte bir'), 'Google gecikmesi belirtilmeli');
    // grup anahtarı
    await p.getByRole('button', { name: 'Özel günler' }).click(); await p.waitForTimeout(300);
    eq(JSON.parse(sql("SELECT groups FROM calendar_feeds WHERE user_id='u_pelin'")[0].groups).special, false);
    await p.getByRole('button', { name: 'Özel günler' }).click(); await p.waitForTimeout(300);
    await p.locator('.dialog').screenshot({ path: OUT + '/takvim-koyu-masaustu.png' }).catch(() => p.screenshot({ path: OUT + '/takvim-koyu-masaustu.png' }));
    await p.screenshot({ path: OUT + '/takvim-koyu-masaustu-tam.png' });
    // yeniden açılınca (aynı cihaz) bağlantı hâlâ görünür
    await p.reload(); await p.waitForTimeout(600);
    await p.getByRole('button', { name: 'Profilimi düzenle' }).click(); await p.click('.tk-head');
    eq(await p.inputValue('.tk-url input'), v);
    // yenile: onay ister, eskisi 404
    await p.getByRole('button', { name: 'Bağlantıyı yenile' }).click();
    await p.getByRole('button', { name: /Eski bağlantı çalışmaz olacak/ }).click();
    await p.waitForFunction((old) => document.querySelector('.tk-url input')?.value !== old, v);
    eq((await fetch(BASE + new URL(v).pathname)).status, 404);
    const report = await audit(p);
    eq(report.length, 0, report.slice(0, 6).join(' | '));
    await ctx.close();
  });
  await t('başka cihazda bağlantı gösterilmez, açıklama çıkar', async () => {
    const { p, ctx } = await shots('light', 1360, 900);
    await p.click('.tk-head');
    ok(await p.isVisible('.tk-note'), 'açıklama yok');
    ok(!(await p.isVisible('.tk-url')));
    await ctx.close();
  });
  await t('açık tema + telefon ekran görüntüleri, kontrast', async () => {
    for (const [theme, w, h, name] of [['light', 1360, 900, 'acik-masaustu'], ['dark', 390, 844, 'koyu-telefon'], ['light', 390, 844, 'acik-telefon']]) {
      const { p, ctx } = await shots(theme, w, h);
      await p.click('.tk-head');
      if (await p.isVisible('.tk-note')) { await p.getByRole('button', { name: 'Bağlantıyı yenile' }).click(); await p.getByRole('button', { name: /Eski bağlantı/ }).click(); await p.waitForSelector('.tk-url input'); }
      await p.locator('.tk').scrollIntoViewIfNeeded();
      await p.waitForTimeout(250);
      await p.screenshot({ path: OUT + '/takvim-' + name + '.png' });
      const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(sw <= 0, name + ' yatay taşma ' + sw);
      const report = await audit(p);
      eq(report.length, 0, name + ': ' + report.slice(0, 6).join(' | '));
      await ctx.close();
    }
  });
  await t('hava uyarısı anahtarı ayarı kaydeder (Kaydet ile de ezilmez)', async () => {
    const { p, ctx } = await shots('dark', 1360, 900);
    await p.getByRole('switch', { name: /Dış çekimlerde hava uyarısı/ }).click(); await p.waitForTimeout(400);
    eq(JSON.parse(sql("SELECT settings FROM users WHERE id='u_pelin'")[0].settings).havaUyarisi, false);
    await p.getByRole('button', { name: 'Kaydet', exact: true }).click(); await p.waitForTimeout(500);
    eq(JSON.parse(sql("SELECT settings FROM users WHERE id='u_pelin'")[0].settings).havaUyarisi, false, 'Kaydet sonrası');
    await p.getByRole('button', { name: 'Profilimi düzenle' }).click();
    await p.getByRole('switch', { name: /Dış çekimlerde hava uyarısı/ }).click(); await p.waitForTimeout(400);
    eq(JSON.parse(sql("SELECT settings FROM users WHERE id='u_pelin'")[0].settings).havaUyarisi, true);
    await ctx.close();
  });
  await t('konsol hatası yok', async () => eq(errs.length, 0, errs.join(' | ')));
  await b.close();
  done();
})();

// test/tema.ui.cjs'teki kontrast denetimi (yazı rengi / gerçek zemin, WCAG)
function audit(p) {
  return p.evaluate(() => {
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
    const root = document.querySelector('.tk') || document.body;
    const bad = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
      if (el.closest('[aria-hidden="true"]')) continue;
      let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      const fg0 = parse(cs.color); const bg = bgOf(el); if (!fg0 || !bg) continue;
      const fg = blend({ ...fg0, a: fg0.a * op }, bg);
      const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < need) bad.push(`${ratio.toFixed(2)} <${need} "${n.textContent.trim().slice(0, 40)}" ${cs.color}`);
    }
    return bad;
  });
}
