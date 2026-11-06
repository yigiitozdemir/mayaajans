// Müşteri portalı (Vatan onay): yetki ayrımı, misafir daveti/girişi, onay/revize, talep, bildirim ve arayüz.
const { chromium } = require('playwright');
(async () => {
  const { t, ok, eq, done, loginAs, BASE, sql } = await import('./lib.mjs');
  const OUT = process.argv[2] || '.';
  const pelin = await loginAs('u_pelin', 'Pelin');
  const yigit = await loginAs('u_yigit', 'Yiğit');
  const volkan = await loginAs('u_volkan', 'Volkan');

  // misafir için çerez (maya_g) tutan basit istemci
  const guestReq = (jar) => async (method, path, body) => {
    const r = await fetch(BASE + path, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(jar.c ? { Cookie: jar.c } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = /maya_g=([^;]*)/.exec(sc); if (m) jar.c = 'maya_g=' + m[1]; }
    let data = null; try { data = await r.json(); } catch { /* */ }
    return { status: r.status, data };
  };

  let all;
  await t('Pelin: Vatan portalını görür, Slack verisi aktarılmış (15 içerik + 26 talep)', async () => {
    const me = await pelin.get('/api/me'); ok(me.data.portals.includes('vatan'), 'portals');
    const r = await pelin.get('/api/portal/vatan/all'); eq(r.status, 200);
    all = r.data;
    eq(all.items.filter((i) => i.kind === 'content').length, 15, 'içerik');
    eq(all.items.filter((i) => i.kind === 'request').length, 26, 'talep');
    const c3 = all.items.find((i) => i.kind === 'content' && i.no === 3);
    ok(c3.link.startsWith('https://drive.google.com/') && c3.planDate === '2026-10-28' && c3.status === 'revize', JSON.stringify(c3));
    ok(all.notes.some((n) => n.itemId === c3.id && n.action === 'revise'), 'Vatan revize notu aktarılmalı');
  });
  await t('Yönetici (Yiğit) görür; diğer ekip (Volkan) göremez, menüde de yok', async () => {
    eq((await yigit.get('/api/portal/vatan/all')).status, 200);
    eq((await volkan.get('/api/portal/vatan/all')).status, 403);
    eq((await volkan.post('/api/portal/vatan/items', { title: 'x' })).status, 403);
    const me = await volkan.get('/api/me'); eq(me.data.portals.length, 0);
  });

  let invite, item;
  await t('Pelin içerik ekler ve misafir (Vatan yetkilisi) davet eder', async () => {
    const r = await pelin.post('/api/portal/vatan/items', { kind: 'content', title: 'Test içerik — Dr. Deneme vizit', link: 'https://drive.google.com/drive/folders/TEST', planDate: '2026-11-20', status: 'onay_bekliyor' });
    eq(r.status, 200); item = r.data.id;
    const bad = await pelin.post('/api/portal/vatan/items', { kind: 'content', title: 'kötü link', link: 'javascript:alert(1)' });
    eq(bad.status, 200);
    const b = (await pelin.get('/api/portal/vatan/all')).data.items.find((i) => i.id === bad.data.id); eq(b.link, '', 'javascript: link kabul edilmemeli');
    await pelin.del('/api/portal/vatan/items/' + bad.data.id);
    const g = await pelin.post('/api/portal/vatan/guests', { firstName: 'Fatma', lastName: 'Arda', email: 'fatma.test@corluvatan.com' });
    eq(g.status, 200, JSON.stringify(g.data)); invite = g.data.link; ok(/\/davet\//.test(invite));
    eq((await pelin.post('/api/portal/vatan/guests', { firstName: 'X', email: 'pelin@mayaajans.net' })).status, 400, 'ekip e-postası misafir olamaz');
  });

  const jar = {}; const G = guestReq(jar);
  await t('Misafir davet bağlantısıyla şifre belirler, giriş yapar', async () => {
    const token = invite.split('/davet/')[1];
    const info = await G('GET', '/api/auth/invite/' + token); eq(info.data.kind, 'guest');
    const r = await G('POST', '/api/auth/accept', { token, firstName: 'Fatma', lastName: 'Arda', password: 'VatanSifre1' });
    eq(r.status, 200); ok(r.data.guest, 'guest');
    const me = await G('GET', '/api/misafir/me'); eq(me.data.client.id, 'vatan');
    // tekrar giriş
    jar.c = '';
    const l = await G('POST', '/api/auth/login', { email: 'fatma.test@corluvatan.com', password: 'VatanSifre1' });
    eq(l.status, 200); ok(l.data.guest);
  });
  await t('Misafir ekip verisine ERİŞEMEZ (işler, ekip, sohbet, portal yönetimi)', async () => {
    for (const p of ['/api/me', '/api/tasks', '/api/team', '/api/chat/channels', '/api/portal/vatan/all', '/api/clients']) {
      eq((await G('GET', p)).status, 401, p);
    }
  });
  await t('Misafir içerikleri ve Drive linklerini görür; onaylar, revize ister, not yazar', async () => {
    const r = await G('GET', '/api/misafir/items'); eq(r.status, 200);
    ok(r.data.items.some((i) => i.id === item && i.link.includes('drive.google.com')));
    eq((await G('POST', `/api/misafir/items/${item}/revise`, { body: '' })).status, 400, 'boş revize olmaz');
    eq((await G('POST', `/api/misafir/items/${item}/revise`, { body: 'Alt yazıda doktorun adı yanlış' })).status, 200);
    let it = (await G('GET', '/api/misafir/items')).data.items.find((i) => i.id === item); eq(it.status, 'revize');
    eq((await G('POST', `/api/misafir/items/${item}/approve`, {})).status, 200);
    it = (await G('GET', '/api/misafir/items')).data.items.find((i) => i.id === item); eq(it.status, 'onaylandi');
    eq((await G('POST', `/api/misafir/items/${item}/note`, { body: 'Teşekkürler' })).status, 200);
    eq((await G('POST', `/api/misafir/items/nope/approve`, {})).status, 404);
  });
  await t('Misafir yeni talep iletir; Pelin ve Yiğit bildirim alır, Volkan almaz', async () => {
    const r = await G('POST', '/api/misafir/requests', { title: 'Nöroloji bilgilendirme postu', link: 'https://drive.google.com/x', dueDate: '2026-11-25', description: 'Metin Drive’da' });
    eq(r.status, 200);
    const req = (await pelin.get('/api/portal/vatan/all')).data.items.find((i) => i.id === r.data.id);
    ok(req && req.kind === 'request' && req.createdByKind === 'guest' && req.status === 'bekliyor', JSON.stringify(req));
    const pn = (await pelin.get('/api/notifications')).data.filter((n) => n.kind === 'portal');
    ok(pn.some((n) => /revize istedi/.test(n.title)) && pn.some((n) => /onayladı/.test(n.title)) && pn.some((n) => /Yeni talep/.test(n.title)), JSON.stringify(pn.map((n) => n.title)));
    ok(pn.every((n) => n.link && n.link.startsWith('/vatan')), 'link');
    ok((await yigit.get('/api/notifications')).data.some((n) => n.kind === 'portal'), 'yönetici de almalı');
    ok(!(await volkan.get('/api/notifications')).data.some((n) => n.kind === 'portal'), 'Volkan almamalı');
  });
  await t('Pelin durumu değiştirir → misafir görür; yazışma iki tarafta aynı', async () => {
    eq((await pelin.patch('/api/portal/vatan/items/' + item, { status: 'paylasildi' })).status, 200);
    eq((await pelin.post(`/api/portal/vatan/items/${item}/notes`, { body: 'Yarın 10:00 paylaşılacak' })).status, 200);
    const g = (await G('GET', '/api/misafir/items')).data;
    eq(g.items.find((i) => i.id === item).status, 'paylasildi');
    const ns = g.notes.filter((n) => n.itemId === item).map((n) => n.action + ':' + n.body);
    ok(ns.includes('revise:Alt yazıda doktorun adı yanlış') && ns.includes('note:Yarın 10:00 paylaşılacak') && ns.some((x) => x.startsWith('status:')), ns.join(' | '));
  });

  // ---------------- arayüz ----------------
  const b = await chromium.launch();
  const login = async (p, email, pw) => { await p.goto(BASE + '/giris'); await p.fill('input[type=email]', email); await p.fill('input[type=password]', pw); await p.keyboard.press('Enter'); };
  await t('Arayüz (Pelin): menüde "Vatan Onay", sekmeler, kayıt penceresi', async () => {
    const ctx = await b.newContext({ viewport: { width: 1320, height: 900 } }); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await login(p, 'pelin@mayaajans.net', 'TestSifre123'); await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
    await p.locator('.nav a[href="/vatan"]').click(); await p.waitForSelector('.pt-row');
    ok(await p.locator('.pt-row').count() >= 10, 'liste');
    await p.screenshot({ path: OUT + '/portal-ekip.png' });
    await p.locator('.pt-chips button', { hasText: 'Hepsi' }).click();
    await p.locator('.pt-row', { hasText: 'ASSIA LYNNE BALOU' }).first().click(); await p.waitForSelector('.pt-thread');
    ok(await p.locator('.pt-note.revise').count() >= 1, 'revize notu görünmeli');
    await p.screenshot({ path: OUT + '/portal-kayit.png' });
    await p.keyboard.press('Escape');
    await p.locator('[role=tab]', { hasText: 'Talepler' }).click(); await p.waitForTimeout(200);
    ok(await p.locator('.pt-row.request').count() >= 10, 'talepler');
    await p.locator('[role=tab]', { hasText: 'Misafirler' }).click(); await p.waitForSelector('.pt-g');
    await p.screenshot({ path: OUT + '/portal-misafir-yonetim.png' });
    eq(errs.length, 0, errs.join(' | '));
    await ctx.close();
  });
  await t('Arayüz (Volkan): menüde Vatan Onay yok, /vatan açılmaz', async () => {
    const ctx = await b.newContext(); const p = await ctx.newPage();
    await login(p, 'volkan@mayaajans.net', 'TestSifre123'); await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
    eq(await p.locator('.nav a[href="/vatan"]').count(), 0);
    await p.goto(BASE + '/vatan'); await p.waitForTimeout(500);
    eq(await p.locator('.pt-page').count(), 0);
    await ctx.close();
  });
  for (const [ad, vp] of [['masaüstü', { width: 1280, height: 900 }], ['telefon', { width: 390, height: 844 }]]) {
    await t(`Arayüz (misafir, ${ad}): girişte doğrudan onay sayfası, onay ve revize`, async () => {
      const ctx = await b.newContext({ viewport: vp, isMobile: vp.width < 600, hasTouch: true }); const p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await login(p, 'fatma.test@corluvatan.com', 'VatanSifre1'); await p.waitForURL((u) => u.pathname === '/misafir');
      await p.waitForSelector('.ms-card');
      eq(await p.locator('.side, .mtabs:visible').count(), 0, 'ekip menüsü görünmemeli');
      ok(await p.locator('.ms-card a.pt-drive').count() > 0, 'Drive düğmesi');
      eq(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, true, 'yatay taşma');
      await p.screenshot({ path: `${OUT}/portal-misafir-${ad}.png` });
      if (ad === 'masaüstü') {
        const first = p.locator('.ms-card').first(); const title = await first.locator('h2').textContent();
        await first.click(); await p.waitForSelector('.ms-actions');
        await p.fill('.ms-actions textarea', 'Kapak görseli değişsin');
        await p.locator('.ms-actions button', { hasText: 'Revize iste' }).click(); await p.waitForTimeout(500);
        await p.screenshot({ path: `${OUT}/portal-misafir-detay.png` });
        const st = sql(`SELECT status FROM portal_items WHERE title = '${title.replace(/'/g, "''")}' AND deleted_at IS NULL`);
        ok(JSON.stringify(st).includes('revize'), 'revize kaydedilmeli: ' + JSON.stringify(st));
        await p.keyboard.press('Escape');
        await p.locator('[role=tab]', { hasText: 'Talepler' }).click();
        await p.locator('button', { hasText: 'Yeni talep' }).click();
        await p.fill('.pt-form input >> nth=0', 'Arayüzden talep');
        await p.locator('button', { hasText: 'Talebi gönder' }).click(); await p.waitForTimeout(500);
        ok(await p.locator('.ms-card', { hasText: 'Arayüzden talep' }).count() === 1, 'talep listede');
        // ekip adresine gitmeye çalışınca: ekip programı açılmaz, giriş → tekrar onay sayfası
        await p.goto(BASE + '/isler'); await p.waitForURL((u) => u.pathname === '/misafir', { timeout: 5000 });
        await p.locator('button', { hasText: 'Çıkış' }).click(); await p.waitForURL((u) => u.pathname === '/giris');
      }
      eq(errs.length, 0, errs.join(' | '));
      await ctx.close();
    });
  }
  await t('Misafir kaldırılınca oturumu kapanır', async () => {
    const g = (await pelin.get('/api/portal/vatan/all')).data.guests.find((x) => x.email === 'fatma.test@corluvatan.com');
    eq((await pelin.del('/api/portal/vatan/guests/' + g.id)).status, 200);
    eq((await G('GET', '/api/misafir/me')).status, 401);
    eq((await G('POST', '/api/auth/login', { email: 'fatma.test@corluvatan.com', password: 'VatanSifre1' })).status, 401);
  });
  await b.close(); done();
})();
