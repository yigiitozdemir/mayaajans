// Sohbet arayüz testi: iki tarayıcı bağlamı (Pelin ve Emre) aynı anda, gerçek Chromium ile.
// Kullanım: BASE=http://127.0.0.1:8804 PERSIST=.wrangler/state-sohbet UI=http://localhost:8904 \
//   NODE_PATH=$(npm root -g) node test/sohbet.ui.cjs <ekran görüntüsü klasörü>
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const UI = process.env.UI || 'http://localhost:8904';
const OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message.split('\n')[0]); console.log('  ✗ ' + name + ' → ' + e.message.split('\n')[0]); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000010000000100802000000909168360000001c49444154789c63f8cfc0f09f8102c6a9fd1f0350c534f00f0300ff2bf00d6d01a8e40000000049454e44ae426082', 'hex');

(async () => {
  const { loginAs, sql, BASE } = await import('./lib.mjs');
  // wrangler dev --test-scheduled: zamanlanmış görevi tetikler
  const runCron = async (cron) => (await fetch(BASE + '/__scheduled?cron=' + encodeURIComponent(cron))).status;
  await loginAs('u_pelin', 'Pelin'); await loginAs('u_emre', 'Emre');
  sql('DELETE FROM messages; DELETE FROM channel_reads');

  const browser = await chromium.launch();
  const errors = [];
  const mk = async (email, who, viewport = { width: 1440, height: 900 }) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(who + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(who + ': ' + m.text()); });
    await page.goto(UI + '/giris');
    await page.getByLabel('E-posta').fill(email);
    await page.getByLabel('Şifre', { exact: true }).fill('TestSifre123');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.locator('.shell').waitFor({ timeout: 10000 });
    return { ctx, page };
  };
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'sohbet-' + n + '.png') });
  const P = await mk('pelin@mayaajans.net', 'Pelin');
  const E = await mk('emre@mayaajans.net', 'Emre');
  const box = (p) => p.getByLabel('Mesaj yaz');
  const msg = (p, text) => p.locator('.ch-msg', { hasText: text });
  const row = (p, name) => p.locator('.ch-side .ch-row', { hasText: name }).first();

  console.log('\nSohbet sayfası');
  await t('Sohbet açılır: kanallar, müşteri kanalları, birebir mesajlar', async () => {
    for (const x of [P, E]) {
      await x.page.getByRole('link', { name: /Sohbet/ }).first().click();
      await x.page.getByRole('heading', { name: '# genel' }).waitFor({ timeout: 8000 });
    }
    for (const h of ['Kanallar', 'Müşteri kanalları', 'Birebir mesajlar']) ok(await P.page.locator('.ch-group h2', { hasText: h }).count(), h + ' yok');
    ok((await P.page.locator('.ch-group').nth(1).locator('.ch-row').count()) > 10, 'müşteri kanalı az');
    ok(await row(P.page, 'Emre Test').count(), 'DM listesinde Emre yok');
    ok(!(await row(P.page, 'Pelin Test').count()), 'kendisi DM listesinde');
    ok(new URL(P.page.url()).search === '?c=ch_genel', 'adres güncellenmedi: ' + P.page.url());
  });

  await t('Enter gönderir, Shift+Enter yeni satır; karşı tarafa canlı düşer', async () => {
    await box(P.page).click();
    await box(P.page).type('Günaydın ekip');
    await box(P.page).press('Shift+Enter');
    await box(P.page).type('bugün toplantı 11:00');
    await box(P.page).press('Enter');
    await msg(P.page, 'Günaydın ekip').waitFor();
    ok((await box(P.page).inputValue()) === '', 'yazma alanı temizlenmedi');
    const m = msg(E.page, 'Günaydın ekip');
    await m.waitFor({ timeout: 6000 });
    ok((await m.locator('.ch-text').innerText()).includes('Günaydın ekip\nbugün toplantı'), 'satır sonu korunmadı');
  });

  await t('arka arkaya mesajlar gruplanır, gün ayırıcısı "Bugün"', async () => {
    await box(P.page).fill('ikinci mesaj');
    await box(P.page).press('Enter');
    await msg(E.page, 'ikinci mesaj').waitFor({ timeout: 6000 });
    ok(await msg(E.page, 'ikinci mesaj').evaluate((el) => el.classList.contains('compact')), 'gruplanmadı');
    ok(await E.page.locator('.ch-day', { hasText: 'Bugün' }).count(), 'Bugün ayırıcısı yok');
  });

  await t('bağlantılar güvenli tıklanabilir (yalnızca http/https)', async () => {
    await box(P.page).fill('bak https://mayaajans.net/ornek. ve javascript:alert(1) burada');
    await box(P.page).press('Enter');
    const m = msg(E.page, 'ornek');
    await m.waitFor({ timeout: 6000 });
    const links = await m.locator('a').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href'), rel: a.getAttribute('rel'), target: a.getAttribute('target') })));
    ok(links.length === 1, 'bağlantı sayısı ' + links.length);
    ok(links[0].href === 'https://mayaajans.net/ornek', 'href ' + links[0].href);
    ok(links[0].rel.includes('noopener') && links[0].target === '_blank', 'rel/target');
  });

  await t('@ yazınca öneri; seçince bahsetme; Pelin\'de vurgulu', async () => {
    await box(E.page).click();
    await box(E.page).type('@Pe');
    await E.page.locator('.ch-sugg', { hasText: '@Pelin' }).waitFor({ timeout: 3000 });
    await shot(E.page, '03-bahsetme-oneri');
    await box(E.page).press('Enter');
    ok((await box(E.page).inputValue()) === '@Pelin ', 'öneri eklenmedi: ' + (await box(E.page).inputValue()));
    await box(E.page).type('görselleri onaya atar mısın?');
    await box(E.page).press('Enter');
    await P.page.locator('.ch-msg.hit .ch-mention.me', { hasText: '@Pelin' }).waitFor({ timeout: 6000 });
  });

  await t('kendi mesajını düzenler → karşıda "(düzenlendi)"', async () => {
    const id = await msg(P.page, 'ikinci mesaj').getAttribute('data-id');
    const m = P.page.locator(`.ch-msg[data-id="${id}"]`);
    await m.hover();
    await m.getByRole('button', { name: 'Düzenle' }).click();
    const ta = m.getByLabel('Mesajı düzenle');
    await ta.fill('ikinci mesaj (güncel)');
    await ta.press('Enter');
    await msg(E.page, 'ikinci mesaj (güncel)').locator('.ch-edited').waitFor({ timeout: 6000 });
  });

  await t('başkasının mesajında düzenle/sil yok', async () => {
    const m = msg(E.page, 'Günaydın ekip');
    await m.hover();
    ok(!(await m.getByRole('button', { name: 'Düzenle' }).count()), 'Emre düzenleyebiliyor');
  });

  await t('kendi mesajını siler (onaylı) → "Bu mesaj silindi"', async () => {
    await box(P.page).fill('yanlış kanala yazdım');
    await box(P.page).press('Enter');
    await msg(E.page, 'yanlış kanala yazdım').waitFor({ timeout: 6000 });
    const m = msg(P.page, 'yanlış kanala yazdım');
    await m.hover();
    await m.getByRole('button', { name: 'Sil' }).click();
    await m.getByText('Silinsin mi?').waitFor();
    await m.getByRole('button', { name: 'Sil' }).click();
    await E.page.getByText('Bu mesaj silindi').waitFor({ timeout: 6000 });
    ok(!(await msg(E.page, 'yanlış kanala yazdım').count()), 'metin hâlâ görünüyor');
    await shot(E.page, '01-genel');
  });

  await t('dosya: görsel önizleme ve diğer dosya ad+boyut+indir', async () => {
    await P.page.locator('.ch-compose input[type=file]').setInputFiles({ name: 'kampanya.png', mimeType: 'image/png', buffer: PNG });
    await P.page.locator('.ch-pending', { hasText: 'kampanya.png' }).waitFor();
    await box(P.page).fill('taslak görsel');
    await box(P.page).press('Enter');
    const img = E.page.locator('.ch-img img[alt="kampanya.png"]');
    await img.waitFor({ timeout: 8000 });
    await E.page.waitForFunction(() => { const i = document.querySelector('.ch-img img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 });
    await P.page.locator('.ch-compose input[type=file]').setInputFiles({ name: 'brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 deneme') });
    await P.page.getByRole('button', { name: 'Gönder' }).click();
    const f = E.page.locator('.ch-file', { hasText: 'brief.pdf' });
    await f.waitFor({ timeout: 8000 });
    ok((await f.innerText()).includes('B'), 'boyut yok');
    const [dl] = await Promise.all([E.page.waitForEvent('download'), f.getByRole('link', { name: 'İndir' }).click()]);
    ok(dl.suggestedFilename() === 'brief.pdf', 'indirilen ad ' + dl.suggestedFilename());
    await shot(E.page, '02-dosyalar');
  });

  await t('başka kanala gelen mesaj: kalın + sayı, açınca okundu', async () => {
    await row(P.page, 'onay-bekleyenler').click();
    await P.page.getByRole('heading', { name: '# onay-bekleyenler' }).waitFor();
    await box(P.page).fill('Vatan reels onayda');
    await box(P.page).press('Enter');
    const r = row(E.page, 'onay-bekleyenler');
    await E.page.waitForFunction(() => [...document.querySelectorAll('.ch-row.unread')].some((b) => b.textContent.includes('onay-bekleyenler') && b.querySelector('.ch-badge')), null, { timeout: 6000 });
    await r.click();
    await msg(E.page, 'Vatan reels onayda').waitFor();
    await E.page.waitForFunction(() => ![...document.querySelectorAll('.ch-row.unread')].some((b) => b.textContent.includes('onay-bekleyenler')), null, { timeout: 5000 });
  });

  await t('DM: Emre başka sayfadayken → köşe bildirimi + menü sayısı; "Aç" ile konuşma açılır', async () => {
    await E.page.getByRole('link', { name: /Bugün/ }).first().click();
    await wait(300);
    await row(P.page, 'Emre Test').click();
    await P.page.getByRole('heading', { name: 'Emre Test' }).waitFor();
    await P.page.getByText('Birebir mesaj · sadece ikiniz görürsünüz').waitFor();
    await box(P.page).fill('Emre, yarınki çekimi konuşalım mı?');
    await box(P.page).press('Enter');
    const toast = E.page.locator('.toast', { hasText: 'Pelin Test sana yazdı' });
    await toast.waitFor({ timeout: 8000 });
    await E.page.locator('.nav a[href="/sohbet"] .count', { hasText: '1' }).waitFor({ timeout: 5000 });
    await shot(E.page, '04-dm-bildirim');
    await toast.getByRole('button', { name: 'Aç' }).click();
    await E.page.getByRole('heading', { name: 'Pelin Test' }).waitFor({ timeout: 6000 });
    await msg(E.page, 'yarınki çekimi').waitFor();
    ok(/\/sohbet\?c=dm_/.test(E.page.url()), 'adres ' + E.page.url());
    await E.page.waitForFunction(() => !document.querySelector('.nav a[href="/sohbet"] .count'), null, { timeout: 5000 });
  });

  await t('sayfalama: yukarı kaydırınca eski mesajlar yüklenir', async () => {
    const vals = [];
    for (let i = 0; i < 80; i++) vals.push(`('m_ui${String(i).padStart(3, '0')}', 'ch_ozel', 'u_emre', 'eski mesaj ${i}', strftime('%Y-%m-%d %H:%M:%f', 'now', '-${3 * 86400 - i * 60} seconds'))`);
    sql(`INSERT INTO messages (id, channel_id, user_id, text, created_at) VALUES ${vals.join(',')}`);
    await row(P.page, 'özel-günler').click();
    await msg(P.page, 'eski mesaj 79').waitFor();
    ok((await P.page.locator('.ch-msg').count()) === 50, 'ilk sayfa 50 değil');
    ok(!(await msg(P.page, 'eski mesaj 29').count()), 'eski mesaj erken geldi');
    await P.page.locator('.ch-list').evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    await msg(P.page, 'eski mesaj 0').waitFor({ timeout: 6000 });
    ok((await P.page.locator('.ch-msg').count()) === 80, 'toplam ' + (await P.page.locator('.ch-msg').count()));
    ok(!(await P.page.getByRole('button', { name: 'Daha eski mesajlar' }).count()), 'Daha eski düğmesi kalmış');
  });

  await t('müşteri kanalı arama ile süzülür, sağda müşteri özeti', async () => {
    await P.page.getByPlaceholder('Kanal veya kişi ara…').fill('vatan');
    const rows = P.page.locator('.ch-group').filter({ hasText: 'Müşteri kanalları' }).locator('.ch-row');
    ok((await rows.count()) === 1, 'süzme ' + (await rows.count()));
    await rows.first().click();
    await P.page.locator('.ch-aside', { hasText: 'Vatan Hastanesi' }).waitFor();
    await P.page.getByText('ile ilgili revizyonları').waitFor();
    await shot(P.page, '05-musteri-kanali');
    await P.page.getByPlaceholder('Kanal veya kişi ara…').fill('');
  });

  await t('/sohbet?c=<kanal> doğrudan açılır', async () => {
    await P.page.goto(UI + '/sohbet?c=ch_cekim');
    await P.page.getByRole('heading', { name: '# çekim-planı' }).waitFor({ timeout: 8000 });
  });

  await t('Çekim hatırlatması (16:30) #çekim-planı kanalına canlı düşer', async () => {
    const tomorrow = new Date(Date.now() + 3 * 3600e3 + 864e5).toISOString().slice(0, 10);
    sql(`DELETE FROM shoots WHERE id = 's_sohbetui'; INSERT INTO shoots (id, title, client, date, time, location, status) VALUES ('s_sohbetui', 'Sohbet testi çekimi', 'Vatan Hastanesi', '${tomorrow}', '10:00', 'Hastane', 0)`);
    const st = await runCron('30 13 * * *');
    ok(st < 400, 'cron ' + st);
    try { await msg(P.page, 'Sohbet testi çekimi').waitFor({ timeout: 8000 }); }
    finally { sql("DELETE FROM shoots WHERE id = 's_sohbetui'"); }
  });

  await t('telefon genişliği: liste → konuşma → geri', async () => {
    const M = await mk('pelin@mayaajans.net', 'Pelin-mobil', { width: 390, height: 844 });
    await M.page.goto(UI + '/sohbet');
    await M.page.locator('.ch-side').waitFor();
    ok(!(await M.page.locator('.ch-main').isVisible()), 'konuşma görünmemeli');
    await shot(M.page, '06-mobil-liste');
    await row(M.page, 'genel').click();
    await M.page.getByRole('heading', { name: '# genel' }).waitFor();
    ok(!(await M.page.locator('.ch-side').isVisible()), 'liste gizlenmedi');
    const w = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(w <= 390, 'yatay taşma ' + w);
    await shot(M.page, '07-mobil-konusma');
    await M.page.getByRole('button', { name: 'Kanallara dön' }).click();
    await M.page.locator('.ch-side').waitFor();
    await M.ctx.close();
  });

  await t('konsol hatası yok', async () => ok(errors.length === 0, errors.join(' | ')));

  await browser.close();
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})();
