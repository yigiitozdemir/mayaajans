// ⌘K hızlı arama arayüz testi (gerçek Chromium): açma kısayolları, yazdıkça arama, ok tuşları + Enter, komutlar,
// dar ekran düğmesi, açık/koyu kontrast, konsol hatası.
// Çalıştırma: BASE=http://127.0.0.1:8823 PERSIST=.wrangler/state-arama UI=http://127.0.0.1:8923 \
//   NODE_PATH=$(npm root -g) node test/arama.ui.cjs [ekran-görüntüsü-klasörü]
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const UI = process.env.UI || 'http://127.0.0.1:8923';
const OUT = process.argv[2] || '/tmp/claude-0/-workspace/7539e9e2-d3d4-5cef-ae86-ba86fa5875af/scratchpad/ekran';
fs.mkdirSync(OUT, { recursive: true });
const shot = (p, name) => p.screenshot({ path: path.join(OUT, 'arama-' + name + '.png') });

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message.split('\n')[0]); console.log('  ✗ ' + name + ' → ' + e.message.split('\n').slice(0, 6).join(' / ')); if (global.__p) { await global.__p.screenshot({ path: path.join(OUT, 'arama-hata-' + fail + '.png') }).catch(() => {}); for (let i = 0; i < 3; i++) await global.__p.keyboard.press('Escape').catch(() => {}); } }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };
const eq = (a, b, m) => { if (a !== b) throw new Error((m ? m + ': ' : '') + 'beklenen ' + JSON.stringify(b) + ', gelen ' + JSON.stringify(a)); };

// test/tema.ui.cjs ile aynı kontrast ölçümü (avatar baş harfleri hariç)
const audit = (p, root) => p.evaluate((root) => {
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
  const walker = document.createTreeWalker(document.querySelector(root) || document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  while (walker.nextNode()) {
    const n = walker.currentNode; if (!n.textContent.trim()) continue;
    const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    if (el.closest('.av')) continue;
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
}, root);

(async () => {
  const lib = await import(path.join(__dirname, 'lib.mjs'));
  const sql = (q) => lib.sql(q.replace(/\s+/g, ' '));
  sql("DELETE FROM tasks WHERE id LIKE 't_araui%'; DELETE FROM agenda_todos WHERE id = 'at_araui'");
  sql(`INSERT INTO tasks (id, title, client, due_date, status, assignee_id) VALUES
    ('t_araui1', 'Kestane reels kurgusu', 'Nevvital', '2026-12-02', 0, 'u_pelin'),
    ('t_araui2', 'Kestane story seti', 'Nevvital', '2026-11-28', 1, 'u_yigit'),
    ('t_araui3', 'Kestane eski kampanya', 'Nevvital', '2026-10-01', 2, 'u_pelin')`);
  sql("INSERT INTO agenda_todos (id, user_id, title) VALUES ('at_araui', 'u_yigit', 'Kestane faturasını kontrol et')");
  sql("UPDATE users SET settings = json_set(settings, '$.theme', 'light') WHERE id = 'u_yigit'");
  await lib.loginAs('u_pelin', 'Pelin');
  await lib.loginAs('u_yigit', 'Yiğit');

  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1360, height: 860 }, deviceScaleFactor: 1, colorScheme: 'light' });
  const p = await ctx.newPage(); global.__p = p;
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await p.goto(UI + '/giris');
  await p.fill('input[type=email]', 'yigiitozdemir@gmail.com'); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
  await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
  await p.getByRole('radio', { name: 'Açık' }).click();
  await p.waitForTimeout(600);

  const pal = p.locator('.ap-root');
  const input = p.getByRole('combobox', { name: 'Ara' });

  console.log('Açma / kapama');
  await t('Ctrl+K açar, arama kutusu odakta, komutlar listelenir', async () => {
    await p.keyboard.press('Control+k');
    await pal.waitFor();
    ok(await input.evaluate((el) => el === document.activeElement), 'odak');
    ok(await p.getByRole('option', { name: /Yeni iş ekle/ }).isVisible(), 'komut yok');
    ok(await p.getByRole('option', { name: /Koyu tema/ }).isVisible(), 'tema komutu yok');
    await shot(p, 'bos-acik');
  });
  await t('Escape kapatır', async () => {
    await p.keyboard.press('Escape'); await pal.waitFor({ state: 'detached' });
  });
  await t('Meta+K (⌘K) açar, tekrar basınca kapanır', async () => {
    await p.keyboard.press('Meta+k'); await pal.waitFor();
    await p.keyboard.press('Meta+k'); await pal.waitFor({ state: 'detached' });
  });
  await t('"/" kısayolu açar; yazı alanındayken açmaz', async () => {
    await p.goto(UI + '/isler'); await p.waitForTimeout(600);
    await p.locator('body').click({ position: { x: 700, y: 10 } });
    await p.keyboard.press('/'); await pal.waitFor();
    eq(await input.inputValue(), '', '"/" kutuya yazılmamalı');
    await p.keyboard.press('Escape'); await pal.waitFor({ state: 'detached' });
    const box = p.locator('.quick input[type=text]').first();
    if (await box.count()) {
      await box.click(); await p.keyboard.press('/'); await p.waitForTimeout(200);
      eq(await pal.count(), 0, 'yazı alanında açıldı');
      await box.fill('');
    }
  });

  console.log('Arama');
  await t('yazdıkça arar, gruplar ve vurgulama', async () => {
    await p.keyboard.press('Control+k'); await pal.waitFor();
    await input.fill('kestane');
    await p.getByRole('group', { name: 'İşler' }).waitFor();
    ok(await p.getByRole('group', { name: 'Ajandam' }).isVisible(), 'Ajandam grubu');
    ok((await p.locator('.ap-it mark').count()) >= 3, 'vurgu yok');
    eq((await p.locator('.ap-it mark').first().textContent()).toLowerCase(), 'kestane');
    const titles = await p.getByRole('group', { name: 'İşler' }).locator('.ap-t').allTextContents();
    ok(titles[titles.length - 1].includes('eski kampanya'), 'tamamlanan en altta değil: ' + titles.join(' | '));
    ok(await p.getByRole('group', { name: 'İşler' }).locator('.ap-it.done .ap-tag', { hasText: 'Tamamlandı' }).isVisible(), 'Tamamlandı etiketi');
    await shot(p, 'sonuclar-acik');
  });
  await t('Türkçe duyarsız: "ÇAVUŞ" → Çavuşdent', async () => {
    await input.fill('ÇAVUŞ');
    await p.getByRole('group', { name: 'Müşteriler' }).getByRole('option', { name: /Çavuşdent/ }).waitFor();
  });
  await t('ok tuşları + Enter ile iş açılır (drawer)', async () => {
    await input.fill('kestane reels');
    await p.locator('[role=option][aria-selected=true] .ap-t', { hasText: 'Kestane reels' }).waitFor();
    // ilk seçili öğe: ilk sonuç; ↓ ve ↑ ile gez
    const selText = () => p.locator('[role=option][aria-selected=true] .ap-t').textContent();
    const first = await selText();
    await p.keyboard.press('ArrowDown'); const second = await selText();
    await p.keyboard.press('ArrowUp'); eq(await selText(), first, '↑');
    ok(first !== second || (await p.locator('[role=option]').count()) === 1, '↓ hareket etmedi');
    ok(first.includes('Kestane reels'), 'ilk sonuç: ' + first);
    await p.keyboard.press('Enter');
    await pal.waitFor({ state: 'detached' });
    await p.locator('.drawer').waitFor();
    ok((await p.locator('.drawer').textContent()).includes('Kestane reels kurgusu'), 'yanlış iş');
    await shot(p, 'is-drawer');
    await p.waitForTimeout(150); await p.keyboard.press('Escape'); await p.locator('.drawer').waitFor({ state: 'detached' });
  });
  await t('yazıp hemen Enter: sonuç gelince ilk sonuç açılır (eski sonuç değil)', async () => {
    await p.keyboard.press('Control+k'); await input.fill('cavus'); await p.getByRole('group', { name: 'İşler' }).waitFor();
    await input.fill('kestane story'); await p.keyboard.press('Enter');
    await p.locator('.drawer').waitFor();
    ok((await p.locator('.drawer').textContent()).includes('Kestane story seti'), 'yanlış iş açıldı');
    await p.waitForTimeout(150); await p.keyboard.press('Escape'); await p.locator('.drawer').waitFor({ state: 'detached' });
  });
  await t('müşteriye gider (/musteriler?id=)', async () => {
    await p.keyboard.press('Control+k'); await input.fill('cavusdent');
    const opt = p.getByRole('group', { name: 'Müşteriler' }).getByRole('option').first();
    await opt.waitFor(); await opt.click();
    await p.waitForURL((u) => u.pathname === '/musteriler' && u.searchParams.get('id'));
    await p.waitForTimeout(700);
    ok((await p.locator('.main').textContent()).includes('Çavuşdent'));
  });
  await t('sonuç yoksa "… için sonuç yok"', async () => {
    await p.keyboard.press('Control+k'); await input.fill('zzqqxxyy');
    await p.locator('.ap-empty', { hasText: '“zzqqxxyy” için sonuç yok' }).waitFor();
    await shot(p, 'sonuc-yok');
  });
  await t('son kullanılanlar (boş aramada)', async () => {
    await input.fill('');
    await p.getByRole('group', { name: 'Son kullanılanlar' }).waitFor();
    const l = await p.getByRole('group', { name: 'Son kullanılanlar' }).locator('.ap-t').allTextContents();
    eq(l[0], 'Çavuşdent', l.join('|')); ok(l.includes('Kestane reels kurgusu') && l.includes('Kestane story seti'), l.join('|'));
  });
  await t('kişi: birebir sohbet açar', async () => {
    await input.fill('pelin');
    const opt = p.getByRole('group', { name: 'Kişiler' }).getByRole('option').first();
    await opt.waitFor(); await opt.click();
    await p.waitForURL((u) => u.pathname === '/sohbet' && (u.searchParams.get('c') || '').length > 0);
  });

  console.log('Komutlar');
  await t('"Yeni iş ekle" komutu modalı açar', async () => {
    await p.keyboard.press('Control+k'); await input.fill('yeni iş');
    await p.getByRole('option', { name: /Yeni iş ekle/ }).waitFor();
    await p.keyboard.press('Enter');
    await p.getByRole('dialog', { name: 'Yeni iş' }).waitFor();
    await p.keyboard.press('Escape'); await p.getByRole('dialog', { name: 'Yeni iş' }).waitFor({ state: 'detached' });
  });
  await t('gezinme komutu: "cekim plani" → /cekim', async () => {
    await p.keyboard.press('Control+k'); await input.fill('cekim plani');
    await p.getByRole('option', { name: /Çekim Planı/ }).first().waitFor();
    await p.keyboard.press('Enter'); await p.waitForURL((u) => u.pathname === '/cekim');
  });
  await t('"Dürt: <kişi>" komutu dürtme gönderir', async () => {
    await p.keyboard.press('Control+k'); await input.fill('dürt pelin');
    await p.getByRole('option', { name: /Dürt: Pelin/ }).waitFor();
    await p.keyboard.press('Enter');
    await p.locator('.snack', { hasText: 'dürtüldü' }).waitFor();
    ok(lib.sql("SELECT COUNT(*) AS n FROM nudges WHERE from_id = 'u_yigit' AND to_id = 'u_pelin'")[0].n >= 1, 'kayıt yok');
  });
  await t('drawer açıkken palet: Escape yalnızca paleti kapatır', async () => {
    await p.keyboard.press('Control+k'); await input.fill('kestane reels');
    await p.locator('[role=option][aria-selected=true] .ap-t', { hasText: 'Kestane reels' }).waitFor();
    await p.keyboard.press('Enter'); await p.locator('.drawer').waitFor(); await p.waitForTimeout(150);
    await p.keyboard.press('Control+k'); await pal.waitFor();
    await p.keyboard.press('Escape'); await pal.waitFor({ state: 'detached' });
    ok(await p.locator('.drawer').isVisible(), 'drawer da kapandı');
    await p.waitForTimeout(150); await p.keyboard.press('Escape'); await p.locator('.drawer').waitFor({ state: 'detached' });
  });
  await t('kontrast (açık tema, sonuç listesi)', async () => {
    await p.keyboard.press('Control+k'); await input.fill('kestane');
    await p.getByRole('group', { name: 'İşler' }).waitFor(); await p.waitForTimeout(200);
    const bad = await audit(p, '.ap'); ok(bad.length === 0, bad.join(' ; '));
  });
  await t('komutla koyu tema (hesaba da kaydedilir)', async () => {
    await input.fill('koyu');
    await p.getByRole('option', { name: /Koyu tema/ }).waitFor();
    await p.keyboard.press('Enter');
    await pal.waitFor({ state: 'detached' });
    eq(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
    await p.waitForTimeout(400);
    eq(JSON.parse(lib.sql("SELECT settings FROM users WHERE id='u_yigit'")[0].settings).theme, 'dark');
  });
  await t('kontrast (koyu tema, sonuç listesi)', async () => {
    await p.keyboard.press('Control+k'); await input.fill('kestane');
    await p.getByRole('group', { name: 'İşler' }).waitFor(); await p.waitForTimeout(200);
    await shot(p, 'sonuclar-koyu');
    const bad = await audit(p, '.ap'); ok(bad.length === 0, bad.join(' ; '));
    await input.fill(''); await p.waitForTimeout(100);
    ok(await p.getByRole('option', { name: /Açık tema/ }).isVisible(), 'koyu temada "Açık tema" komutu');
    await p.keyboard.press('Escape');
  });
  await t('palet .overlay sınıfı taşır (Mac’te gömülü uygulama görünümü gizlensin)', async () => {
    await p.keyboard.press('Control+k'); await pal.waitFor();
    ok(await p.evaluate(() => !!document.querySelector('.overlay.ap-root')));
    await p.keyboard.press('Escape');
    ok(await p.evaluate(() => !document.querySelector('.overlay')), 'kapalıyken .overlay kalmamalı');
  });
  await t('geniş ekranda arama düğmesi görünmez', async () => {
    ok(!(await p.locator('.ap-fab').isVisible()));
  });
  await p.getByRole('radio', { name: 'Açık' }).click();

  console.log('Dar ekran');
  await t('dar ekranda (iPhone) arama düğmesi; dokununca açılır', async () => {
    const m = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true, colorScheme: 'light' });
    const mp = await m.newPage(); mp.on('pageerror', (e) => errs.push('mobil: ' + e.message));
    await mp.goto(UI + '/giris');
    await mp.fill('input[type=email]', 'yigiitozdemir@gmail.com'); await mp.fill('input[type=password]', 'TestSifre123'); await mp.keyboard.press('Enter');
    await mp.waitForURL((u) => !u.pathname.startsWith('/giris')); await mp.waitForTimeout(700);
    const fab = mp.getByRole('button', { name: 'Ara (komut paleti)' });
    ok(await fab.isVisible(), 'düğme yok');
    const bb = await fab.boundingBox(); ok(bb.height >= 44 && bb.x + bb.width <= 390 && bb.y + bb.height <= 844, 'boyut/konum ' + JSON.stringify(bb));
    await shot(mp, 'mobil-dugme');
    await fab.tap();
    await mp.locator('.ap-root').waitFor();
    await mp.getByRole('combobox', { name: 'Ara' }).fill('kestane');
    await mp.getByRole('group', { name: 'İşler' }).waitFor(); await mp.waitForTimeout(150);
    const w = await mp.evaluate(() => document.querySelector('.ap').getBoundingClientRect().width);
    ok(w <= 390, 'taşma ' + w);
    ok(await mp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'yatay kayma');
    await shot(mp, 'mobil-sonuclar');
    await mp.getByRole('group', { name: 'İşler' }).getByRole('option').first().tap();
    await mp.locator('.drawer').waitFor();
    await m.close();
  });

  await t('konsol hatası yok', async () => ok(errs.length === 0, errs.join(' | ')));
  await b.close();
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})();
