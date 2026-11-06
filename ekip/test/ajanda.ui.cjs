// Ajandam arayüz testi (gerçek Chromium): notlar + ekran görüntüsü yapıştırma, yapılacaklar, takvim, anımsatıcı bildirimi,
// koyu/açık tema kontrastı, mobil.
// Çalıştırma: BASE=http://127.0.0.1:8807 PERSIST=.wrangler/state-ajanda UI=http://127.0.0.1:8907 \
//   NODE_PATH=$(npm root -g) node test/ajanda.ui.cjs [ekran-görüntüsü-klasörü]
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const UI = process.env.UI || 'http://127.0.0.1:8907';
const OUT = process.argv[2] || '/tmp/claude-0/-workspace/7539e9e2-d3d4-5cef-ae86-ba86fa5875af/scratchpad/ekran';
fs.mkdirSync(OUT, { recursive: true });
const istDate = (n) => new Date(Date.now() + 3 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const toSql = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const shot = (p, name) => p.screenshot({ path: path.join(OUT, 'ajanda-' + name + '.png') });

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message.split('\n')[0]); console.log('  ✗ ' + name + ' → ' + e.message.split('\n').slice(0, 8).join(' / ')); if (global.__p) { await global.__p.screenshot({ path: path.join(OUT, 'ajanda-hata-' + fail + '.png') }).catch(() => {}); for (let i = 0; i < 3; i++) await global.__p.keyboard.press('Escape').catch(() => {}); } }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };

// görünen her yazının rengini arkasındaki gerçek zeminle karşılaştırır (test/tema.ui.cjs ile aynı ölçüm; avatar baş harfleri hariç)
const audit = (p) => p.evaluate(() => {
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
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
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
});

// sayfada PNG üretir (gerçek görsel)
const makePng = (p, color, name) => p.evaluateHandle(async ([color, name]) => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 200;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 320, 200); g.fillStyle = '#fff'; g.font = 'bold 28px sans-serif'; g.fillText(name, 20, 110);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  return new File([blob], name, { type: 'image/png' });
}, [color, name]);

(async () => {
  const lib = await import(path.join(__dirname, 'lib.mjs'));
  await lib.loginAs('u_yigit', 'Yiğit');
  await lib.loginAs('u_pelin', 'Pelin');
  const sql = lib.sql;
  sql("DELETE FROM agenda_files; DELETE FROM agenda_notes; DELETE FROM agenda_todos; DELETE FROM agenda_events; DELETE FROM notifications WHERE kind = 'reminder'");
  sql("DELETE FROM tasks WHERE title LIKE 'UI Ajanda%' OR source = 'ajanda'; DELETE FROM shoots WHERE title LIKE 'UI Ajanda%'; DELETE FROM special_day_rows WHERE day_id = 'd_ajui'; DELETE FROM special_days WHERE id = 'd_ajui'");
  sql(`INSERT INTO tasks (id, title, client, assignee_id, due_date, status, created_by) VALUES ('t_ajui', 'UI Ajanda İşi', 'Gizem Eczane', 'u_pelin', '${istDate(2)}', 0, 'u_yigit')`);
  sql(`INSERT INTO shoots (id, title, client, date, time, crew, status) VALUES ('s_ajui', 'UI Ajanda Çekimi', 'Nevvital', '${istDate(3)}', '10:30', '["u_pelin"]', 0)`);
  sql(`INSERT INTO special_days (id, name, date) VALUES ('d_ajui', 'UI Ajanda Özel Günü', '${istDate(4)}')`);
  sql(`INSERT INTO special_day_rows (day_id, client, assignee_id) VALUES ('d_ajui', 'Arslandent', 'u_pelin')`);
  // ayın içinde kalsın diye takvimde ileri gerekirse "Sonraki ay"
  const sameMonth = (d) => d.slice(0, 7) === istDate(0).slice(0, 7);

  const browser = await chromium.launch();
  const errors = [];
  const mk = async (email, viewport = { width: 1440, height: 950 }, theme = 'light') => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', colorScheme: theme });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: UI });
    const page = await ctx.newPage(); page.setDefaultTimeout(10000);
    page.on('pageerror', (e) => errors.push(email + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(email + ': ' + m.text()); });
    await page.goto(UI + '/giris');
    await page.getByLabel('E-posta').fill(email);
    await page.locator('input[autocomplete=current-password]').fill('TestSifre123');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.waitForURL((u) => !u.pathname.startsWith('/giris'), { timeout: 10000 });
    return { ctx, page };
  };

  const { page: p } = await mk('pelin@mayaajans.net'); global.__p = p;
  // açık tema ile başla
  await p.getByRole('radio', { name: 'Açık' }).click();
  await p.goto(UI + '/ajanda');
  await p.getByRole('heading', { name: 'Ajandam' }).waitFor();
  await p.evaluate(() => { try { localStorage.removeItem('maya.ajanda.tab'); } catch (e) {} });

  console.log('Ajandam arayüzü');
  await t('menüde "Ajandam", sayfa başlığı ve zil', async () => {
    ok(await p.locator('.nav a[href="/ajanda"]').isVisible(), 'menü');
    ok(await p.locator('.bell').isVisible(), 'zil');
    ok(await p.getByText('Yalnızca sen görürsün').isVisible(), 'gizlilik notu');
  });

  await t('takvimde salt okunur: atanan iş, ekip olduğun çekim, özel gün görevi', async () => {
    const goTo = async (d) => { if (!sameMonth(d)) await p.getByRole('button', { name: 'Sonraki ay' }).click(); };
    await goTo(istDate(2));
    await p.locator('.aj-chip.k-task', { hasText: 'UI Ajanda İşi' }).first().waitFor({ timeout: 5000 });
    if (sameMonth(istDate(3))) ok(await p.locator('.aj-chip.k-shoot', { hasText: 'UI Ajanda Çekimi' }).count() >= 1, 'çekim');
    await p.getByRole('region', { name: 'Takvim' }).getByRole('button', { name: 'Bugün', exact: true }).click();
  });

  await t('T ile yapılacak ekle (Enter), yıldızla, işaretle → Tamamlanan bölümüne iner', async () => {
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    await p.keyboard.press('t');
    await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute('aria-label') === 'Yeni yapılacak');
    await p.keyboard.type('Fatura kes'); await p.keyboard.press('Enter');
    await p.locator('.aj-todo', { hasText: 'Fatura kes' }).waitFor();
    await p.getByLabel('Yeni yapılacak').fill('Raporu gönder'); await p.keyboard.press('Enter');
    await p.getByLabel('Yeni yapılacak').fill('Logo dosyalarını iste'); await p.keyboard.press('Enter');
    await p.locator('.aj-todo', { hasText: 'Raporu gönder' }).getByRole('button', { name: 'Önemli olarak işaretle' }).click();
    await p.waitForTimeout(300);
    const order = await p.locator('.aj-left .aj-todos').first().locator('.aj-todo-t').allTextContents();
    ok(order[0] === 'Raporu gönder', 'yıldızlı üstte: ' + order.join(', '));
    await p.getByRole('checkbox', { name: 'Tamamla: Logo dosyalarını iste' }).click();
    await p.waitForTimeout(400);
    ok(!(await p.locator('.aj-left .aj-todos').first().getByText('Logo dosyalarını iste').isVisible()), 'açık listeden çıktı');
    const btn = p.getByRole('button', { name: /Tamamlanan/ });
    if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
    await p.locator('.aj-todo.done', { hasText: 'Logo dosyalarını iste' }).waitFor();
    const rows = await p.locator('.aj-todo').allTextContents();
    ok(rows[rows.length - 1].includes('Logo dosyalarını iste'), 'tamamlanan en altta');
    await shot(p, '01-yapilacaklar');
  });

  await t('yapılacak düzenle: tarih + saat + "Belirli zamanda" hatırlatma; listede zil simgesi', async () => {
    await p.locator('.aj-todo', { hasText: 'Fatura kes' }).locator('.aj-todo-b').click();
    await p.getByRole('dialog', { name: 'Yapılacak' }).waitFor();
    await p.locator('#td-date').fill(istDate(0));
    await p.locator('#td-time').fill('23:30');
    await p.locator('#td-rm').selectOption('at');
    ok((await p.locator('#td-at').inputValue()) === istDate(0) + 'T23:30', 'varsayılan zaman tarihten gelir');
    await p.locator('#td-at').fill(istDate(1) + 'T09:15');
    await shot(p, '02-yapilacak-duzenle');
    await p.getByRole('button', { name: 'Kaydet' }).click();
    await p.getByRole('dialog', { name: 'Yapılacak' }).waitFor({ state: 'detached' });
    await p.locator('.aj-todo', { hasText: 'Fatura kes' }).locator('.aj-mi', { hasText: '09:15' }).waitFor();
    await p.locator('.aj-rem', { hasText: 'Fatura kes' }).waitFor();
  });

  await t('anımsatıcı zamanı gelince (cron) köşe bildirimi + zil; "Çaldı" listesi, ertele', async () => {
    const id = sql("SELECT id FROM agenda_todos WHERE title = 'Fatura kes'")[0].id;
    sql(`UPDATE agenda_todos SET remind_at = '${toSql(Date.now() - 20_000)}', remind_base = '${toSql(Date.now() - 20_000)}' WHERE id = '${id}'`);
    await lib.runCron('* * * * *');
    const toast = p.locator('.toast', { hasText: '⏰ Fatura kes' });
    await toast.waitFor({ timeout: 8000 });
    await shot(p, '03-bildirim');
    await p.locator('.aj-rem.fired', { hasText: 'Fatura kes' }).waitFor({ timeout: 5000 });
    ok(await p.locator('.bell .n').isVisible(), 'zilde sayı');
    await p.locator('.aj-rem.fired', { hasText: 'Fatura kes' }).getByRole('button', { name: 'Ertele' }).click();
    await p.getByRole('menuitem', { name: '10 dakika' }).click();
    await p.locator('.snack', { hasText: '10 dakika ertelendi' }).waitFor();
    await p.locator('.aj-rem:not(.fired)', { hasText: 'Fatura kes' }).waitFor();
    // köşe bildirimindeki "Aç" ajandaya ve kayda götürür
    if (await toast.isVisible()) { await toast.getByRole('button', { name: 'Aç' }).click(); await p.getByRole('dialog', { name: 'Yapılacak' }).waitFor(); await p.keyboard.press('Escape'); }
  });

  await t('takvim: güne tıkla → günün listesi, hızlı etkinlik ekle; "Yeni etkinlik" formu (renk, hatırlat)', async () => {
    const d1 = istDate(1);
    if (!sameMonth(d1)) await p.getByRole('button', { name: 'Sonraki ay' }).click();
    await p.locator('.aj-day:not(.out)[aria-label^="' + (+d1.slice(8, 10)) + ' "]').click();
    await p.getByLabel('Bu güne etkinlik ekle').fill('Diş randevusu');
    await p.getByLabel('Başlangıç saati').fill('15:00');
    await p.getByLabel('Bu güne etkinlik ekle').press('Enter');
    await p.locator('.aj-ditem', { hasText: 'Diş randevusu' }).waitFor();
    ok(/\d+ kayıt/.test(await p.locator('.aj-day.sel').getAttribute('aria-label')), 'gün hücresinde sayı');
    await p.getByRole('button', { name: 'Yeni etkinlik' }).click();
    await p.getByRole('dialog', { name: 'Yeni etkinlik' }).waitFor();
    await p.getByLabel('Başlık').fill('Müşteri toplantısı');
    await p.locator('#ev-start').fill('10:00'); await p.locator('#ev-end').fill('11:00');
    await p.locator('#ev-rm').selectOption('10');
    await p.getByRole('radio', { name: 'Yeşil' }).click();
    await shot(p, '04-etkinlik-formu');
    await p.getByRole('dialog', { name: 'Yeni etkinlik' }).getByRole('button', { name: 'Ekle', exact: true }).click();
    await p.locator('.aj-ditem.k-event.c-green', { hasText: 'Müşteri toplantısı' }).waitFor();
    await p.locator('.aj-rem', { hasText: 'Müşteri toplantısı' }).waitFor();
    // iş teslim gününe git, iş kartı İş Planı ayrıntısını açar
    const d2 = istDate(2);
    if (d2.slice(0, 7) !== d1.slice(0, 7)) await p.getByRole('button', { name: 'Sonraki ay' }).click();
    await p.locator('.aj-day:not(.out)[aria-label^="' + (+d2.slice(8, 10)) + ' "]').click();
    await p.locator('.aj-ditem.k-task', { hasText: 'UI Ajanda İşi' }).click();
    await p.locator('.drawer').waitFor();
    await shot(p, '05-takvim-is');
    await p.keyboard.press('Escape');
    await p.locator('.drawer').waitFor({ state: 'detached' }).catch(() => p.locator('.drawer-wrap .scrim').click());
    await p.getByRole('region', { name: 'Takvim' }).getByRole('button', { name: 'Bugün', exact: true }).click();
    await shot(p, '06-ajanda');
  });

  await t("İş Planı'na dönüştür: tarih sorulur, iş oluşur", async () => {
    await p.locator('.aj-todo', { hasText: 'Raporu gönder' }).locator('.aj-todo-b').click();
    await p.getByRole('button', { name: 'İş Planı’na dönüştür' }).click();
    await p.getByRole('dialog', { name: 'İş Planı’na dönüştür' }).waitFor();
    await p.getByRole('button', { name: 'İş Planı’na ekle' }).click();
    await p.getByText('Teslim tarihi seç').waitFor();
    await p.locator('#cv-due').fill(istDate(5));
    await p.getByRole('button', { name: 'İş Planı’na ekle' }).click();
    await p.locator('.drawer').waitFor();
    ok(sql("SELECT COUNT(*) n FROM tasks WHERE title = 'Raporu gönder' AND assignee_id = 'u_pelin' AND source = 'ajanda'")[0].n === 1, 'iş oluştu');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
  });

  await t('N ile yeni not; yaz → otomatik kaydedildi', async () => {
    await p.locator('body').click({ position: { x: 5, y: 5 } });
    await p.keyboard.press('n');
    await p.getByLabel('Not başlığı').waitFor();
    await p.getByLabel('Not başlığı').fill('Gizem Eczane toplantı');
    await p.getByLabel('Not metni').fill('Kampanya fikirleri:\n- Kış vitamini\n- Hediye çeki');
    await p.locator('.aj-save.saved').waitFor({ timeout: 6000 });
    const r = sql("SELECT body, kind FROM agenda_notes WHERE title = 'Gizem Eczane toplantı'");
    ok(r[0] && r[0].body.includes('Hediye çeki'), 'veritabanına yazıldı');
    ok(/[?&]not=nt_/.test(p.url()), 'adres ?not= içeriyor');
  });

  await t('panodan ekran görüntüsü yapıştır (⌘V), dosya seç, sürükle-bırak → küçük resimler', async () => {
    const f1 = await makePng(p, '#9B573F', 'image.png');
    await p.evaluate((file) => {
      const dt = new DataTransfer(); dt.items.add(file);
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, f1);
    await p.locator('.aj-thumb').first().waitFor({ timeout: 8000 });
    ok(/Ekran görüntüsü/.test(await p.locator('.aj-thumb-n').first().textContent()), 'ad: Ekran görüntüsü …');
    // dosya seç
    const tmp = path.join(OUT, '..', 'aj-secilen.png');
    fs.writeFileSync(tmp, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    await p.locator('.aj-files input[type=file]').setInputFiles(tmp);
    await p.locator('.aj-thumb').nth(1).waitFor({ timeout: 8000 });
    // sürükle-bırak
    const f3 = await makePng(p, '#2F55B8', 'surukle.png');
    await p.evaluate((file) => {
      const dt = new DataTransfer(); dt.items.add(file);
      const el = document.querySelector('.aj-editor');
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, f3);
    await p.locator('.aj-thumb').nth(2).waitFor({ timeout: 8000 });
    ok(await p.locator('.aj-thumb-n', { hasText: 'surukle.png' }).isVisible(), 'sürüklenen dosya');
    ok(sql("SELECT COUNT(*) n FROM agenda_files WHERE user_id = 'u_pelin'")[0].n === 3, '3 dosya kaydı');
    // gerçek görsel yüklendi mi (küçük resim çizildi)
    ok(await p.locator('.aj-thumb img').first().evaluate((i) => i.complete && i.naturalWidth === 320), 'küçük resim görüntüleniyor');
    await shot(p, '07-not-gorseller');
  });

  await t('büyük önizleme: tıkla aç, ok tuşlarıyla geç, Escape kapatır', async () => {
    await p.locator('.aj-thumb-b').first().click();
    await p.locator('.aj-lb').waitFor();
    const seen = (x) => p.locator('.aj-lb-n', { hasText: x }).waitFor({ timeout: 3000 });
    await seen('1/3');
    await p.keyboard.press('ArrowRight'); await seen('2/3');
    await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await seen('3/3'); // başa sarar
    await p.locator('.aj-lb-body img').evaluate((i) => new Promise((r) => (i.complete ? r() : (i.onload = r))));
    await shot(p, '08-onizleme');
    await p.keyboard.press('Escape');
    await p.locator('.aj-lb').waitFor({ state: 'detached' });
  });

  await t('kontrol listesi, sabitle, Kişisel tür, renk, müşteri bağlantısı; filtre ve arama', async () => {
    await p.getByRole('button', { name: 'Kontrol listesi' }).click();
    await p.getByLabel('Madde', { exact: true }).first().fill('Brief gönder'); await p.keyboard.press('Enter');
    await p.keyboard.type('Teklif hazırla');
    await p.getByRole('checkbox', { name: 'İşaretle: Brief gönder' }).click();
    await p.getByRole('button', { name: 'Üste sabitle' }).click();
    await p.getByRole('radio', { name: 'Mavi' }).click();
    await p.locator('.aj-client select').selectOption({ index: 1 });
    await p.locator('.aj-save.saved').waitFor({ timeout: 6000 });
    await p.waitForTimeout(500);
    const r = sql("SELECT pinned, color, client_id, checks FROM agenda_notes WHERE title = 'Gizem Eczane toplantı'")[0];
    ok(r.pinned === 1 && r.color === 'blue' && r.client_id, 'sabit/renk/müşteri');
    const ch = JSON.parse(r.checks);
    ok(ch.map((c) => c.text).join('|') === 'Brief gönder|Teklif hazırla' && ch[0].done && !ch[1].done, 'kontrol listesi: ' + JSON.stringify(ch));
    // ikinci not (Kişisel)
    const before = await p.evaluate(() => location.search);
    await p.getByRole('button', { name: 'Yeni not' }).first().click();
    await p.waitForFunction((b) => location.search !== b && document.querySelector('.aj-etitle') && document.querySelector('.aj-etitle').value === '', before);
    await p.getByLabel('Not başlığı').fill('Spor salonu');
    await p.locator('.aj-editor').getByRole('button', { name: 'Kişisel' }).click();
    await p.getByLabel('Not metni').fill('Salı ve perşembe 19:00');
    await p.getByLabel('Not metni').blur();
    await p.locator('.aj-save.saved').waitFor();
    await p.waitForTimeout(400);
    await p.locator('.aj-nlist').getByRole('button', { name: /^İş/ }).click();
    ok(!(await p.locator('.aj-nitem', { hasText: 'Spor salonu' }).isVisible()), 'İş filtresinde kişisel yok');
    await p.locator('.aj-nlist').getByRole('button', { name: /^Tümü/ }).click();
    const first = await p.locator('.aj-nitem-t').first().textContent();
    ok(first.includes('Gizem Eczane toplantı'), 'sabitlenen en üstte: ' + first);
    await p.getByPlaceholder('Notlarda ara…').fill('perşembe');
    ok((await p.locator('.aj-nitem').count()) === 1, 'arama');
    await p.getByPlaceholder('Notlarda ara…').fill('');
    await shot(p, '09-notlar');
  });

  await t('aynı kişinin ikinci penceresi canlı güncellenir; başkası (yönetici) hiçbir şey görmez', async () => {
    const { page: p2, ctx: c2 } = await mk('pelin@mayaajans.net', { width: 1200, height: 900 });
    await p2.goto(UI + '/ajanda'); await p2.getByRole('tab', { name: 'Ajanda' }).click();
    await p2.locator('.aj-todo', { hasText: 'Fatura kes' }).waitFor();
    await p.getByRole('tab', { name: 'Ajanda' }).click();
    await p.getByLabel('Yeni yapılacak').fill('Canlı görünür mü'); await p.keyboard.press('Enter');
    await p2.locator('.aj-todo', { hasText: 'Canlı görünür mü' }).waitFor({ timeout: 6000 });
    await c2.close();
    const { page: y, ctx: c3 } = await mk('yigiitozdemir@gmail.com', { width: 1200, height: 900 });
    await y.goto(UI + '/ajanda'); await y.getByRole('heading', { name: 'Ajandam' }).waitFor(); await y.waitForTimeout(800);
    ok((await y.locator('.aj-todo').count()) === 0, 'yöneticide yapılacak yok');
    ok((await y.locator('.aj-chip.k-todo, .aj-chip.k-event').count()) === 0, 'yöneticide etkinlik yok');
    await y.getByRole('tab', { name: 'Notlar' }).click();
    ok((await y.locator('.aj-nitem').count()) === 0, 'yöneticide not yok');
    const fid = sql("SELECT id FROM agenda_files LIMIT 1")[0].id;
    const st = await y.evaluate((u) => fetch(u).then((r) => r.status), '/api/agenda/files/' + fid);
    ok(st === 404, 'yönetici dosyayı indiremez: ' + st);
    await c3.close();
  });

  await t('silme onaylı (not)', async () => {
    await p.getByRole('tab', { name: 'Notlar' }).click();
    await p.locator('.aj-nitem', { hasText: 'Spor salonu' }).click();
    await p.locator('.aj-editor').getByRole('button', { name: 'Sil', exact: true }).click();
    ok(await p.getByRole('button', { name: 'Eminim, sil' }).isVisible(), 'onay istenir');
    await p.getByRole('button', { name: 'Eminim, sil' }).click();
    await p.locator('.aj-nitem', { hasText: 'Spor salonu' }).waitFor({ state: 'detached' });
  });

  const report = {};
  for (const theme of ['light', 'dark']) {
    await t(`${theme === 'dark' ? 'koyu' : 'açık'} tema: ekran görüntüsü ve kontrast (≥4.5)`, async () => {
      await p.getByRole('radio', { name: theme === 'dark' ? 'Koyu' : 'Açık' }).click();
      await p.goto(UI + '/ajanda'); await p.getByRole('tab', { name: 'Ajanda' }).click(); await p.waitForTimeout(700);
      await p.locator('.aj-day.today').click();
      await shot(p, `10-${theme}-ajanda`);
      const a1 = await audit(p);
      const btn = p.getByRole('button', { name: /Tamamlanan/ });
      if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click();
      await p.locator('.aj-left').scrollIntoViewIfNeeded();
      const a1b = await audit(p);
      await p.getByRole('tab', { name: 'Notlar' }).click();
      await p.locator('.aj-nitem').first().click(); await p.waitForTimeout(500);
      await shot(p, `11-${theme}-notlar`);
      const a2 = await audit(p);
      await p.locator('.aj-thumb-b').first().click(); await p.locator('.aj-lb').waitFor(); await p.waitForTimeout(300);
      const a3 = await audit(p);
      await p.keyboard.press('Escape');
      await p.getByRole('tab', { name: 'Ajanda' }).click();
      await p.locator('.aj-todo', { hasText: 'Fatura kes' }).locator('.aj-todo-b').click(); await p.waitForTimeout(300);
      const a4 = await audit(p);
      await shot(p, `12-${theme}-form`);
      await p.keyboard.press('Escape');
      const all = [...new Set([...a1, ...a1b, ...a2, ...a3, ...a4])];
      report[theme] = all;
      ok(all.length === 0, all.length + ' düşük kontrast: ' + all.slice(0, 6).join(' | '));
    });
  }

  await t('mobil (390px): tek sütun, sekmeler, yatay taşma yok', async () => {
    const { page: m, ctx } = await mk('pelin@mayaajans.net', { width: 390, height: 844 });
    await m.goto(UI + '/ajanda'); await m.getByRole('heading', { name: 'Ajandam' }).waitFor(); await m.waitForTimeout(600);
    const over = async () => m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    await m.getByRole('tab', { name: 'Yapılacaklar' }).click(); await m.waitForTimeout(200);
    ok((await over()) <= 0, 'yapılacaklar taşıyor: ' + (await over()));
    await shot(m, '13-mobil-yapilacaklar');
    await m.getByRole('tab', { name: 'Takvim' }).click(); await m.waitForTimeout(200);
    ok(await m.locator('.aj-cal').isVisible(), 'takvim'); ok(!(await m.locator('.aj-left').isVisible()), 'tek sütun');
    ok((await over()) <= 0, 'takvim taşıyor: ' + (await over()));
    await shot(m, '14-mobil-takvim');
    await m.getByRole('tab', { name: 'Notlar' }).click(); await m.locator('.aj-nitem').first().click(); await m.waitForTimeout(300);
    ok(!(await m.locator('.aj-nlist').isVisible()), 'not açıkken liste gizli');
    ok((await over()) <= 0, 'not taşıyor: ' + (await over()));
    await shot(m, '15-mobil-not');
    await m.getByRole('button', { name: 'Not listesine dön' }).click();
    ok(await m.locator('.aj-nlist').isVisible(), 'listeye dönüldü');
    await ctx.close();
  });

  await t('konsol hatası yok', async () => { ok(errors.length === 0, errors.join(' | ')); });

  for (const [k, v] of Object.entries(report)) if (v.length) console.log(`\nKONTRAST ${k}: ${v.length}\n  ` + v.slice(0, 20).join('\n  '));
  await browser.close();
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})();
