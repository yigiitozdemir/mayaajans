// Müşteriler arayüz testi (Playwright, gerçek Chromium). Yönetici + Pelin (yetkisiz üye) aynı anda.
// Kullanım: API_PORT=8801 vite :8901 ve wrangler dev :8801 açıkken
//   NODE_PATH=$(npm root -g) PERSIST=.wrangler/state-musteriler UI=http://localhost:8901 node test/musteriler.ui.cjs <ekran klasörü>
const { chromium } = require('playwright');
const { execSync } = require('node:child_process');
const { createHash, randomBytes } = require('node:crypto');
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const UI = process.env.UI || 'http://localhost:8901';
const PERSIST = process.env.PERSIST ? ` --persist-to ${process.env.PERSIST}` : '';
const OUT = process.argv[2] || '.';
const ROOT = path.join(__dirname, '..');
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (s) => b64url(createHash('sha256').update(s).digest());
const sql = (q) => execSync(`npx wrangler d1 execute maya-ekip --local${PERSIST} --command ${JSON.stringify(q)}`, { cwd: ROOT, env: { ...process.env, CLOUDFLARE_API_TOKEN: 'proxy-injected' }, stdio: 'ignore' });

// basit PNG üretici (düz renkli dikdörtgen + ortada şerit)
function png(w, h, [r, g, b], [r2, g2, b2]) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 4 + 1) + 1 + x * 4;
      const band = y > h * 0.35 && y < h * 0.65 && x > w * 0.15 && x < w * 0.85;
      const bg = !(x > w * 0.08 && x < w * 0.92 && y > h * 0.12 && y < h * 0.88);
      raw[o] = band ? r2 : r; raw[o + 1] = band ? g2 : g; raw[o + 2] = band ? b2 : b; raw[o + 3] = bg ? 0 : 255;
    }
  }
  const crc = (buf) => { let c, crcT = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; } let x = 0xffffffff; for (const v of buf) x = crcT[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6; ih[10] = 0; ih[11] = 0; ih[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { const m = e.message.split('\n').filter((l) => l.trim()).slice(0, 3).join(' / '); fail++; fails.push(name + ' → ' + m); console.log('  ✗ ' + name + ' → ' + m); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'mus-'));
  const colorPng = path.join(tmp, 'UI Klinik Renkli.png'); fs.writeFileSync(colorPng, png(240, 120, [155, 87, 63], [255, 255, 255]));
  const whitePng = path.join(tmp, 'UI Klinik Beyaz.png'); fs.writeFileSync(whitePng, png(240, 120, [255, 255, 255], [220, 220, 220]));
  const badFile = path.join(tmp, 'zararli.html'); fs.writeFileSync(badFile, '<script>alert(1)</script>');
  sql("UPDATE users SET can_edit_clients = 0 WHERE id = 'u_pelin'");
  sql("UPDATE clients SET archived = 1 WHERE name LIKE 'UI Test Klinik%'");

  const browser = await chromium.launch();
  const errors = [];
  const mk = async (userId, first, viewport = { width: 1440, height: 950 }) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', acceptDownloads: true });
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: UI });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(userId + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(userId + ': ' + m.text()); });
    const token = b64url(randomBytes(24));
    sql(`INSERT INTO invites (id, user_id, kind, expires_at) VALUES ('${sha(token)}', '${userId}', 'invite', datetime('now', '+1 day'))`);
    const r = await ctx.request.post(UI + '/api/auth/accept', { data: { token, firstName: first, lastName: 'Test', password: 'TestSifre123' } });
    if (r.status() !== 200) throw new Error('giriş olmadı ' + userId + ' ' + r.status());
    return { ctx, page };
  };
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'musteriler-' + n + '.png') });
  const A = await mk('u_yigit', 'Yiğit');
  const P = await mk('u_pelin', 'Pelin');
  const NAME = 'UI Test Klinik ' + Date.now().toString(36).slice(-4);
  let cid = '';

  console.log('Yönetici');
  await t('liste + ilk müşteri açılır', async () => {
    await A.page.goto(UI + '/musteriler');
    await A.page.getByRole('heading', { name: /^Müşteriler/ }).waitFor();
    await A.page.locator('.mu-item').nth(20).waitFor();
    ok((await A.page.locator('.mu-item').count()) >= 26, 'en az 26 müşteri');
    await A.page.locator('.mu-head h2').waitFor();
    ok(/id=c_/.test(A.page.url()), 'adres ?id= olmalı');
    await shot(A.page, '01-liste');
  });
  await t('arama süzer', async () => {
    await A.page.getByPlaceholder('Müşteri ara…').fill('dent');
    const n = await A.page.locator('.mu-item').count();
    ok(n >= 3 && n < 10, 'dent araması: ' + n);
    await A.page.getByPlaceholder('Müşteri ara…').fill('');
  });
  await t('müşteri ekle → seçilir, kanal mesajı', async () => {
    await A.page.getByRole('button', { name: 'Müşteri ekle' }).click();
    await A.page.getByLabel('Firma adı').fill(NAME);
    await A.page.keyboard.press('Enter');
    await A.page.locator('.mu-head h2', { hasText: NAME }).waitFor();
    await A.page.locator('.snack', { hasText: 'kanalı açıldı' }).waitFor();
    cid = new URL(A.page.url()).searchParams.get('id');
    ok(cid && cid.startsWith('c_'), 'id: ' + cid);
    await A.page.getByRole('link', { name: /# ui-test-klinik/ }).waitFor();
  });
  await t('aynı adla tekrar eklemede hata', async () => {
    await A.page.getByRole('button', { name: 'Müşteri ekle' }).click();
    await A.page.getByLabel('Firma adı').fill(NAME.toLocaleLowerCase('tr'));
    await A.page.getByRole('button', { name: 'Müşteriyi ekle' }).click();
    await A.page.getByRole('alert').filter({ hasText: 'zaten var' }).waitFor();
    await A.page.getByRole('button', { name: 'Vazgeç' }).click();
  });
  await t('marka kiti: sektör, renk, yazı tipi; renge tıklayınca HEX kopyalanır', async () => {
    const sector = A.page.locator('.mu-pill', { hasText: 'Sektör' }).locator('input');
    await sector.fill('Diş kliniği'); await sector.press('Enter');
    await A.page.locator('.snack', { hasText: 'Sektör kaydedildi' }).waitFor();
    await A.page.getByLabel('HEX kodu').fill('#0E5E6F');
    await A.page.getByLabel('Renk adı').fill('Petrol');
    await A.page.getByRole('button', { name: 'Renk ekle' }).click();
    await A.page.locator('.mu-color', { hasText: '#0E5E6F' }).waitFor();
    await A.page.getByRole('button', { name: 'Petrol #0E5E6F kopyala' }).click();
    await A.page.locator('.snack', { hasText: 'Kopyalandı: #0E5E6F' }).waitFor();
    const clip = await A.page.evaluate(() => navigator.clipboard.readText());
    ok(clip === '#0E5E6F', 'pano: ' + clip);
    await A.page.getByLabel('Yazı tipi adı').fill('Poppins');
    await A.page.getByRole('button', { name: 'Ekle', exact: true }).click();
    await A.page.locator('.mu-font', { hasText: 'Poppins' }).waitFor();
  });
  await t('logolar: renkli + beyaz yükle, beyaz koyu zeminde, izinsiz tür reddi', async () => {
    await A.page.getByRole('tab', { name: /Logolar/ }).click();
    await A.page.getByLabel('Renkli logo dosyası yükle').setInputFiles(colorPng);
    await A.page.locator('.snack', { hasText: '1 dosya yüklendi (Renkli)' }).waitFor();
    await A.page.getByLabel('Beyaz logo dosyası yükle').setInputFiles(whitePng);
    await A.page.locator('.snack', { hasText: '1 dosya yüklendi (Beyaz)' }).waitFor();
    const beyaz = A.page.locator('.mu-vcard[aria-label="Beyaz logo"] .mu-prev');
    ok(await beyaz.evaluate((e) => e.classList.contains('dark')), 'beyaz koyu zeminde olmalı');
    await A.page.locator('.mu-vcard[aria-label="Beyaz logo"] img').evaluate((img) => img.decode());
    await A.page.getByLabel('Siyah logo dosyası yükle').setInputFiles(badFile);
    await A.page.locator('.snack', { hasText: 'bu tür yüklenemez' }).waitFor();
    await A.page.locator('.mu-quick .mu-dl').nth(1).waitFor();
    await shot(A.page, '02-logolar');
  });
  await t('marka sesi: hashtag seti tek tıkla kopyalanır', async () => {
    await A.page.getByRole('tab', { name: 'Marka sesi' }).click();
    await A.page.getByLabel('Ses tonu ekle').fill('Samimi'); await A.page.getByLabel('Ses tonu ekle').press('Enter');
    await A.page.locator('.mu-chip', { hasText: 'Samimi' }).waitFor();
    await A.page.getByLabel('Set adı').fill('Genel');
    await A.page.getByLabel('Hashtagler').fill('#gulus #tekirdag');
    await A.page.getByRole('button', { name: 'Set ekle' }).click();
    await A.page.locator('.mu-tagset', { hasText: '#gulus #tekirdag' }).waitFor();
    await A.page.locator('.mu-tagset').getByRole('button', { name: 'Kopyala' }).click();
    ok((await A.page.evaluate(() => navigator.clipboard.readText())) === '#gulus #tekirdag', 'pano');
    await shot(A.page, '03-marka-sesi');
  });
  await t('bağlantılar ve notlar', async () => {
    await A.page.getByRole('tab', { name: 'Bağlantılar' }).click();
    await A.page.getByLabel('Instagram', { exact: true }).fill('instagram.com/uiklinik');
    await A.page.getByLabel('Instagram', { exact: true }).press('Enter');
    await A.page.locator('.snack', { hasText: 'Instagram kaydedildi' }).waitFor();
    await A.page.getByRole('link', { name: 'Aç' }).first().waitFor();
    await A.page.getByRole('tab', { name: /Notlar/ }).click();
    await A.page.getByLabel('Yeni not').fill('Onaysız paylaşım yok.');
    await A.page.getByRole('button', { name: 'Notu ekle' }).click();
    await A.page.locator('.mu-note-it', { hasText: 'Onaysız paylaşım yok.' }).waitFor();
    await A.page.getByRole('tab', { name: 'Marka kiti' }).click();
  });

  console.log('Yetkisiz üye (Pelin)');
  await t('sadece görüntüler: not var, düzenleme düğmeleri yok', async () => {
    await P.page.goto(UI + '/musteriler?id=' + cid);
    await P.page.locator('.mu-head h2', { hasText: NAME }).waitFor();
    await P.page.getByText('Düzenleme yetkisi yöneticide').waitFor();
    ok((await P.page.getByRole('button', { name: 'Renk ekle' }).count()) === 0, 'renk ekle görünmemeli');
    ok((await P.page.getByRole('button', { name: 'Müşteri ekle' }).count()) === 0, 'müşteri ekle görünmemeli');
    ok((await P.page.getByRole('button', { name: 'Kaldır', exact: true }).count()) === 0, 'kaldır görünmemeli');
    ok((await P.page.locator('.mu-pill input').count()) === 0, 'sektör kutusu olmamalı');
    await P.page.getByRole('tab', { name: /Logolar/ }).click();
    ok((await P.page.locator('.mu-up').count()) === 0, 'yükleme düğmesi olmamalı');
    ok((await P.page.locator('.mu-vcard').count()) === 2, 'sadece dolu varyantlar');
    await shot(P.page, '04-uye-logolar');
  });
  await t('beyaz logoyu tek tıkla indirir (orijinal ad, aynı bayt)', async () => {
    const [dl] = await Promise.all([
      P.page.waitForEvent('download'),
      P.page.locator('.mu-vcard[aria-label="Beyaz logo"]').getByRole('link', { name: 'Beyaz PNG indir' }).click(),
    ]);
    ok(dl.suggestedFilename() === 'UI Klinik Beyaz.png', 'ad: ' + dl.suggestedFilename());
    const p = await dl.path();
    ok(fs.readFileSync(p).equals(fs.readFileSync(whitePng)), 'içerik farklı');
  });
  await t('canlı: yönetici renk ekler → Pelin yenilemeden görür', async () => {
    await P.page.getByRole('tab', { name: 'Marka kiti' }).click();
    await A.page.getByLabel('HEX kodu').fill('#F2C14E');
    await A.page.getByLabel('Renk adı').fill('Hardal');
    await A.page.getByRole('button', { name: 'Renk ekle' }).click();
    await P.page.locator('.mu-color', { hasText: '#F2C14E' }).waitFor({ timeout: 6000 });
  });
  await t('canlı: yönetici yetki verir → Pelin düzenleyebilir', async () => {
    await A.page.locator('.mu-box').getByRole('button', { name: /Pelin/ }).click();
    await P.page.getByRole('button', { name: 'Renk ekle' }).waitFor({ timeout: 6000 });
    await P.page.getByLabel('Yazı tipi adı').fill('Inter');
    await P.page.getByRole('button', { name: 'Ekle', exact: true }).click();
    await A.page.locator('.mu-font', { hasText: 'Inter' }).waitFor({ timeout: 6000 });
    await A.page.locator('.mu-box').getByRole('button', { name: /Pelin/ }).click();
    await P.page.getByText('Düzenleme yetkisi yöneticide').waitFor({ timeout: 6000 });
  });
  await t('yönetici logoyu siler (onaylı)', async () => {
    await A.page.getByRole('tab', { name: /Logolar/ }).click();
    await A.page.getByLabel('UI Klinik Renkli.png dosyasını sil').click();
    await A.page.getByRole('dialog', { name: 'Dosyayı sil' }).getByRole('button', { name: 'Sil' }).click();
    await A.page.locator('.snack', { hasText: 'Dosya silindi' }).waitFor();
    ok((await A.page.locator('.mu-vcard[aria-label="Renkli logo"] .mu-frow').count()) === 0);
  });
  await t('yönetici kaldırır (onaylı) → Pelin listesinden canlı düşer', async () => {
    await P.page.locator('.mu-item', { hasText: NAME }).waitFor();
    await A.page.getByRole('button', { name: 'Kaldır', exact: true }).click();
    await A.page.getByRole('dialog', { name: 'Müşteriyi kaldır' }).getByRole('button', { name: 'Kaldır', exact: true }).click();
    await A.page.locator('.snack', { hasText: 'kaldırıldı' }).waitFor();
    await P.page.locator('.mu-item', { hasText: NAME }).waitFor({ state: 'detached', timeout: 6000 });
    await A.page.locator('.mu-item', { hasText: NAME }).waitFor({ state: 'detached', timeout: 4000 });
    await A.page.getByRole('button', { name: /Kaldırılan müşteriler/ }).click();
    await A.page.locator('.mu-archived', { hasText: NAME }).waitFor();
  });
  await t('İş Planı firma listesi güncel (reloadClients)', async () => {
    await A.page.locator('nav a[href="/isler"]').first().click(); // sayfa yenilemeden (SPA)
    await A.page.getByRole('heading', { name: 'İş Planı' }).waitFor();
    await A.page.locator('option', { hasText: 'Arslandent' }).first().waitFor({ state: 'attached' });
    const opts = await A.page.locator('select').filter({ hasText: 'Tüm firmalar' }).locator('option').allTextContents();
    ok(opts.includes('Arslandent') && !opts.includes(NAME), 'firma listesi: ' + opts.length + ' ' + opts.slice(0, 5).join(','));
  });

  console.log('Mobil');
  await t('iPhone: liste → detay → geri', async () => {
    const M = await mk('u_emre', 'Emre', { width: 390, height: 844 });
    await M.page.goto(UI + '/musteriler');
    await M.page.locator('.mu-item').first().waitFor();
    ok(!(await M.page.locator('.mu-detail').isVisible()), 'önce liste');
    await shot(M.page, '05-mobil-liste');
    await M.page.locator('.mu-item', { hasText: 'Arslandent' }).click();
    await M.page.locator('.mu-head h2', { hasText: 'Arslandent' }).waitFor();
    ok(!(await M.page.locator('.mu-list').isVisible()), 'detayda liste gizli');
    const sw = await M.page.evaluate(() => document.documentElement.scrollWidth);
    ok(sw <= 392, 'yatay kaydırma olmamalı: ' + sw);
    await shot(M.page, '06-mobil-detay');
    await M.page.getByRole('button', { name: '← Müşteriler' }).click();
    await M.page.locator('.mu-list').waitFor();
    await M.ctx.close();
  });

  await t('konsol hatası yok', async () => { ok(errors.length === 0, errors.join(' | ')); });
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})();
