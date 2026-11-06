// Ekran Görüntüleri (Mac): Mac köprüsü taklit edilir (dosyalar bellekte), Ajandam / Sohbet gerçek sunucuya gider.
const { chromium } = require('playwright');
(async () => {
  const { t, ok, eq, done, loginAs, sql, BASE } = await import('./lib.mjs');
  await loginAs('u_pelin', 'Pelin'); await loginAs('u_emre', 'Emre');
  const OUT = process.argv[2] || '.';
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1320, height: 840 } }); const p = await ctx.newPage();
  await p.addInitScript(() => {
    // 4x3 kırmızı PNG
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEklEQVR4nGP4z8DwHwwYGBgYADvMBf1yCJ+cAAAAAElFTkSuQmCC';
    const st = { enabled: false, active: false, cleanup: false, cleanupDays: 30, folder: '/Users/pelin/Pictures/Maya Ekran Görüntüleri', systemLocation: 'Masaüstü' };
    window.__files = []; window.__calls = [];
    window.__addShot = (name, kind = 'image') => { window.__files.unshift({ name, size: 245000, at: Date.now(), kind }); window.dispatchEvent(new CustomEvent('maya-desktop', { detail: { action: 'shot', name } })); };
    const H = {
      shots_status: () => ({ ...st }),
      shots_enable: (a) => { st.enabled = a.on; st.active = a.on; return { ...st }; },
      shots_set_cleanup: (a) => { st.cleanup = a.on; return { ...st }; },
      shots_list: () => window.__files.slice(),
      shots_thumb: () => PNG, shots_read: () => PNG,
      shots_copy: () => null, shots_reveal: () => null, shots_open: () => null, shots_save_as: () => true,
      shots_trash: (a) => { window.__files = window.__files.filter((f) => f.name !== a.name); return null; },
    };
    window.__TAURI__ = { core: { invoke: (cmd, args) => { window.__calls.push([cmd, args || {}]); return H[cmd] ? Promise.resolve(H[cmd](args || {})) : Promise.resolve(null); } } };
  });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/giris'); await p.fill('input[type=email]', 'pelin@mayaajans.net'); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
  await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
  const called = (cmd) => p.evaluate((c) => window.__calls.filter((x) => x[0] === c).length, cmd);

  await t('menüde (yalnızca Mac) Ekran Görüntüleri → kapalı hâl ve açma', async () => {
    await p.getByRole('link', { name: 'Ekran Görüntüleri' }).click();
    await p.getByText('Masaüstün ekran görüntüleriyle dolmasın').waitFor();
    await p.screenshot({ path: OUT + '/ekran-01-kapali.png' });
    await p.getByRole('button', { name: 'Aç', exact: true }).click();
    await p.getByText('Henüz ekran görüntüsü yok').waitFor();
    eq(await called('shots_enable'), 1);
  });
  await t('yeni ekran görüntüsü anında listeye düşer', async () => {
    await p.evaluate(() => { window.__addShot('Ekran Resmi 2026-11-06 10.12.03.png'); window.__addShot('Ekran Resmi 2026-11-06 10.14.40.png'); window.__addShot('Ekran Kaydı 2026-11-06 10.20.11.mov', 'video'); });
    await p.locator('.shot').nth(2).waitFor(); eq(await p.locator('.shot').count(), 3);
    ok(await p.locator('.shot-dayh', { hasText: 'Bugün' }).count() === 1, 'Bugün grubu');
    await p.waitForFunction(() => document.querySelectorAll('.shot-img img').length === 3, null, { timeout: 5000 }); // küçük resimler yüklendi
    await p.screenshot({ path: OUT + '/ekran-02-liste.png' });
  });
  await t('önizleme: kopyala, ok tuşları', async () => {
    await p.locator('.shot').nth(1).click(); await p.locator('.shot-viewer').waitFor();
    await p.getByRole('button', { name: 'Kopyala' }).click(); await p.locator('.snack', { hasText: 'Panoya kopyalandı' }).waitFor({ timeout: 5000 });
    await p.keyboard.press('ArrowRight');
    await p.getByText('3 / 3').waitFor({ timeout: 5000 });
    await p.keyboard.press('ArrowLeft'); await p.keyboard.press('ArrowLeft'); await p.getByText('1 / 3').waitFor({ timeout: 5000 });
    await p.getByRole('button', { name: 'Oynat' }).waitFor({ timeout: 5000 }); // en yeni: ekran kaydı
    await p.keyboard.press('ArrowRight'); await p.getByText('2 / 3').waitFor({ timeout: 5000 });
    await p.screenshot({ path: OUT + '/ekran-03-onizleme.png' });
  });
  await t('Sohbette paylaş → gerçek mesaj + dosya', async () => {
    await p.getByRole('button', { name: 'Sohbette paylaş' }).click();
    await p.getByRole('option', { name: '# genel' }).click();
    await p.getByLabel('Mesaj (isteğe bağlı)').fill('Bakar mısınız?');
    await p.getByRole('button', { name: 'Gönder' }).click(); await p.locator('.snack', { hasText: 'Sohbette paylaşıldı' }).waitFor();
    const m = sql("SELECT text, file_name, file_type FROM messages WHERE channel_id = 'ch_genel' ORDER BY created_at DESC LIMIT 1")[0];
    eq(m.text, 'Bakar mısınız?'); eq(m.file_type, 'image/png'); ok(m.file_name.endsWith('.png'), m.file_name);
  });
  await t('Ajandama ekle → gerçek not + ek, Ajandam açılır', async () => {
    await p.getByRole('button', { name: 'Ajandama ekle' }).click();
    await p.waitForURL((u) => u.pathname === '/ajanda');
    const n = sql("SELECT n.title, (SELECT COUNT(*) FROM agenda_files f WHERE f.note_id = n.id) files FROM agenda_notes n WHERE n.user_id = 'u_pelin' ORDER BY n.created_at DESC LIMIT 1")[0];
    ok(n.title.startsWith('Ekran görüntüsü'), n.title); eq(n.files, 1);
  });
  await t('başka sayfadayken yeni ekran görüntüsü → köşe bildirimi, Aç ile önizleme', async () => {
    await p.getByRole('link', { name: /İş Planı/ }).click(); await p.waitForTimeout(300);
    await p.evaluate(() => window.__addShot('Ekran Resmi 2026-11-06 11.00.00.png'));
    await p.locator('.toast', { hasText: 'Yeni ekran görüntüsü' }).waitFor();
    await p.locator('.toast').getByRole('button', { name: 'Aç' }).click();
    await p.locator('.shot-viewer').waitFor(); await p.getByText('Ekran Resmi 2026-11-06 11.00.00.png').first().waitFor();
  });
  await t('sil (onaylı) → çöp kutusu', async () => {
    await p.getByRole('button', { name: 'Sil' }).click(); await p.getByRole('button', { name: /Emin misin/ }).click();
    await p.locator('.snack', { hasText: 'Çöp kutusuna' }).waitFor(); eq(await called('shots_trash'), 1);
  });
  await t('otomatik temizlik anahtarı, koyu tema görünümü', async () => {
    await p.keyboard.press('Escape'); await p.waitForTimeout(200); eq(await p.locator('.shot-viewer').count(), 0, 'Escape önizlemeyi kapatmalı');
    await p.getByRole('switch', { name: /günden eski olanları/ }).click(); await p.waitForTimeout(200); eq(await called('shots_set_cleanup'), 1);
    await p.getByRole('radio', { name: 'Koyu' }).click(); await p.waitForTimeout(300); await p.screenshot({ path: OUT + '/ekran-04-koyu.png' });
    await p.getByRole('radio', { name: 'Açık' }).click();
  });
  await t('konsol hatası yok', async () => eq(errs.length, 0, errs.join(' | ')));
  // tarayıcıda (Mac değil) menüde görünmez
  const c2 = await b.newContext(); const p2 = await c2.newPage();
  await p2.goto(BASE + '/giris'); await p2.fill('input[type=email]', 'emre@mayaajans.net'); await p2.fill('input[type=password]', 'TestSifre123'); await p2.keyboard.press('Enter');
  await p2.waitForURL((u) => !u.pathname.startsWith('/giris'));
  await t('web sitesinde menüde görünmez', async () => eq(await p2.getByRole('link', { name: 'Ekran Görüntüleri' }).count(), 0));
  await b.close(); done();
})();
