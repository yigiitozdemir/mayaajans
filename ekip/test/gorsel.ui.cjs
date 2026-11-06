// Görsel iyileştirmeler: müşteri işareti + renk şeridi, çevrimiçi noktası, kişi durumu, geçişler (konsol hatası yok)
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const { t, ok, eq, done, loginAs, sql, BASE } = await import('./lib.mjs');
  const UI = process.env.UI || BASE; const OUT = process.argv[2] || '.'; const LOGO = process.argv[3];
  const y = await loginAs('u_yigit', 'Yiğit'); await loginAs('u_pelin', 'Pelin');
  sql("UPDATE users SET last_name = 'Özdemir' WHERE id = 'u_yigit'"); sql("UPDATE users SET last_name = 'Yılmaz' WHERE id = 'u_pelin'");
  // Vatan Hastanesi: logo · Nevvital: marka rengi
  const vatan = sql("SELECT id FROM clients WHERE name = 'Vatan Hastanesi'")[0].id;
  const nev = sql("SELECT id FROM clients WHERE name = 'Nevvital'")[0].id;
  await y.patch('/api/clients/' + nev, { colors: [{ hex: '#2F55B8', name: 'Mavi' }] });
  if (LOGO) { const fd = new FormData(); fd.append('variant', 'Renkli'); fd.append('file', new Blob([fs.readFileSync(LOGO)], { type: 'image/png' }), 'vatan.png'); const r = await y.req('POST', '/api/clients/' + vatan + '/files', fd); ok(r.status === 201, 'logo yüklenemedi ' + r.status); }
  const b = await chromium.launch();
  const mk = async (email) => {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 860 } }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(UI + '/giris'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
    await p.waitForURL((u) => !u.pathname.startsWith('/giris')); return { p, errs, ctx };
  };
  const Y = await mk('yigiitozdemir@gmail.com');
  await t('İş Planı: müşteri logosu ve renk şeridi', async () => {
    await Y.p.goto(UI + '/isler'); await Y.p.locator('.tcard').first().waitFor();
    ok(await Y.p.locator('.tcard .cmark.img img').count() > 0, 'Vatan logosu görünmeli');
    ok(await Y.p.locator('.tcard.stripe').count() > 0, 'Nevvital kartlarında renk şeridi olmalı');
    const c = await Y.p.locator('.tcard.stripe').first().evaluate((e) => getComputedStyle(e).borderLeftColor); eq(c, 'rgb(47, 85, 184)');
    await Y.p.screenshot({ path: OUT + '/gorsel-isplani.png' });
  });
  const P = await mk('pelin@mayaajans.net');
  await t('çevrimiçi noktası: Pelin girince Yiğit\'in ekranında yeşil nokta', async () => {
    await Y.p.goto(UI + '/durt'); await Y.p.waitForTimeout(800);
    ok(await Y.p.locator('.av-dot').count() >= 2, 'en az iki çevrimiçi nokta (Yiğit + Pelin)');
    await P.ctx.close(); await Y.p.waitForTimeout(1500);
    const n = await Y.p.locator('.av-dot').count(); ok(n >= 1, 'kendisi kalmalı');
  });
  await t('durum: 🎬 Çekimde, 1 saat → avatar ve kartta görünür; kaldırılır', async () => {
    await Y.p.getByRole('button', { name: 'Durum ekle' }).click();
    await Y.p.getByRole('button', { name: /Çekimde/ }).click(); await Y.p.getByRole('button', { name: '1 saat' }).click();
    await Y.p.getByRole('button', { name: 'Kaydet' }).click(); await Y.p.locator('.snack', { hasText: 'Durumun güncellendi' }).waitFor();
    await Y.p.locator('.moodbtn.on', { hasText: 'Çekimde' }).waitFor(); ok(await Y.p.locator('.av-mood', { hasText: '🎬' }).count() > 0, 'emoji avatarda');
    const st = JSON.parse(sql("SELECT settings FROM users WHERE id = 'u_yigit'")[0].settings).mood; eq(st.text, 'Çekimde'); ok(st.until, 'bitiş saati');
    const team = (await y.get('/api/team')).data; eq(team.find((m) => m.id === 'u_yigit').mood.emoji, '🎬');
    await Y.p.screenshot({ path: OUT + '/gorsel-durum.png' });
  });
  await t('Odaklanıyorum dürtmeleri sessize alır (gönderen "sessizce iletildi" görür)', async () => {
    await y.patch('/api/me', { settings: { mood: { emoji: '🎧', text: 'Odaklanıyorum', until: null, focus: true } } });
    const p2 = await loginAs('u_emre', 'Emre'); const r = await p2.post('/api/nudge', { to: 'u_yigit' }); eq(r.status, 201); eq(r.data.dnd, true);
    await y.patch('/api/me', { settings: { mood: null } });
  });
  await t('süresi dolan durum görünmez', async () => {
    await y.patch('/api/me', { settings: { mood: { emoji: '🍽', text: 'Öğle arası', until: new Date(Date.now() - 60000).toISOString() } } });
    eq((await y.get('/api/team')).data.find((m) => m.id === 'u_yigit').mood, null);
  });
  await t('Bugün, Çekim, Özel Günler, Sohbet: müşteri işaretleri', async () => {
    await Y.p.goto(UI + '/'); await Y.p.waitForTimeout(600); ok(await Y.p.locator('.cmark').count() > 0, 'Bugün');
    await Y.p.screenshot({ path: OUT + '/gorsel-bugun.png' });
    await Y.p.goto(UI + '/cekim'); await Y.p.waitForTimeout(600); ok(await Y.p.locator('.ck-card .cmark').count() > 0, 'Çekim');
    await Y.p.screenshot({ path: OUT + '/gorsel-cekim.png' });
    await Y.p.goto(UI + '/sohbet'); await Y.p.waitForTimeout(800); ok(await Y.p.locator('.cmark').count() > 5, 'Sohbet müşteri kanalları');
  });
  await t('geçişler: drawer/dialog animasyonlu, hareketi azaltta kapalı', async () => {
    await Y.p.goto(UI + '/isler'); await Y.p.locator('.tcard').first().click(); await Y.p.locator('.drawer').waitFor();
    ok((await Y.p.locator('.drawer').evaluate((e) => getComputedStyle(e).animationName)).includes('m-drawer'), 'drawer animasyonu');
    await Y.p.keyboard.press('Escape');
    await Y.p.emulateMedia({ reducedMotion: 'reduce' }); await Y.p.locator('.tcard').first().click(); await Y.p.locator('.drawer').waitFor();
    eq(await Y.p.locator('.drawer').evaluate((e) => getComputedStyle(e).animationName), 'none');
    await Y.p.keyboard.press('Escape');
  });
  await t('koyu tema görünümü', async () => {
    await Y.p.getByRole('radio', { name: 'Koyu' }).click(); await Y.p.goto(UI + '/isler'); await Y.p.waitForTimeout(500);
    await Y.p.screenshot({ path: OUT + '/gorsel-isplani-koyu.png' }); await Y.p.getByRole('radio', { name: 'Açık' }).click();
  });
  await t('konsol hatası yok', async () => eq(Y.errs.length + P.errs.length, 0, Y.errs.concat(P.errs).join(' | ')));
  await b.close(); done();
})();
