// Toplantılar: API (yetki, doğrulama, katılımcı bildirimi, 30 dk hatırlatma, aksiyon → iş, ses/dosya yükleme ve
// erişim, takvim aboneliği, arama, misafir engeli) + arayüz (liste, takvim, form, detay, ses kaydı, telefon, iki tema, kontrast).
// Kullanım (wrangler dev açıkken; isteğe bağlı SIMDI_SAHTE hem sunucuya hem teste aynı verilir):
//   BASE=http://127.0.0.1:8899 UI=http://127.0.0.1:8899 PERSIST=<db klasörü> NODE_PATH=$(npm root -g) node test/toplanti.ui.cjs <ekran klasörü>
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const UI = process.env.UI || 'http://127.0.0.1:8899';
const OUT = process.argv[2] || '.';
// zamanlanmış görevlerin "şimdi"si (sunucu SIMDI_SAHTE ile başlatıldıysa aynısı)
const SIMDI = () => (process.env.SIMDI_SAHTE ? Date.parse(process.env.SIMDI_SAHTE) : Date.now());
const ist = (ms) => new Date(ms + 3 * 3600_000).toISOString(); // İstanbul yerel ISO (UTC+3)
const istDate = (ms) => ist(ms).slice(0, 10);
const istTime = (ms) => ist(ms).slice(11, 16);
const realToday = () => istDate(Date.now());
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

/** WCAG kontrast denetimi (test/rozet.ui.cjs · kriz.ui.cjs ile aynı yöntem) */
const AUDIT = () => {
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
  const bad = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const n = walker.currentNode; if (!n.textContent.trim()) continue;
    const el = n.parentElement; if (!el || seen.has(el)) continue; seen.add(el);
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || r.bottom < 0 || r.top > innerHeight) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) continue;
    if (el.closest('[aria-hidden="true"]') || el.closest('.av') || el.closest('.snack') || el.closest('option')) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const fg0 = parse(cs.color); const bg = bgOf(el); if (!fg0 || !bg) continue;
    const fg = blend({ ...fg0, a: fg0.a * op }, bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    if (ratio < need) bad.push(`${ratio.toFixed(2)} <${need} "${n.textContent.trim().slice(0, 40)}" ${cs.color} / ${typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : el.tagName}`);
  }
  return bad;
};

// Sahte ses dosyaları: başlık baytları gerçek biçimlerle aynı (sunucu içerikten tanır)
const WEBM = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81]), Buffer.alloc(4000, 7)]);
const M4A = () => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypM4A '), Buffer.alloc(3000, 3)]);
const PDF = () => Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n' + 'x'.repeat(500));

(async () => {
  const lib = await import('./lib.mjs');
  const { t, ok, eq, done, loginAs, sql, openLive, until, Client, BASE, runCron, wait } = lib;
  fs.mkdirSync(OUT, { recursive: true });
  sql("DELETE FROM meeting_files; DELETE FROM meeting_actions; DELETE FROM meetings; DELETE FROM notifications WHERE kind = 'toplanti'");
  const yigit = await loginAs('u_yigit', 'Yiğit');
  const pelin = await loginAs('u_pelin', 'Pelin');
  const emre = await loginAs('u_emre', 'Emre');
  const volkan = await loginAs('u_volkan', 'Volkan');
  const ilayda = await loginAs('u_ilayda', 'İlayda');
  const esra = await loginAs('u_esra', 'Esra');
  const notifs = (uid, extra = '') => sql(`SELECT * FROM notifications WHERE user_id = '${uid}' AND kind = 'toplanti' ${extra} ORDER BY created_at`);
  const raw = async (cl, method, p, body, headers = {}) => {
    const r = await fetch(BASE + p, { method, headers: { ...(cl && cl.cookie ? { Cookie: cl.cookie } : {}), ...headers }, body });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, data: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
  const up = (cl, id, kind, buf, type, name = '', sure = '') => raw(cl, 'POST', `/api/toplantilar/${id}/files?kind=${kind}&name=${encodeURIComponent(name)}${sure ? '&sure=' + sure : ''}`, buf, { 'Content-Type': type });
  const future = addDays(realToday(), 3);

  console.log('API');
  await t('doğrulama: başlık, tarih, saat, bitiş, tür, bağlantı, katılımcı; girişsiz 401', async () => {
    const base = { title: 'Deneme', date: future, startTime: '10:00' };
    eq((await pelin.post('/api/toplantilar', { ...base, title: '  ' })).data.error, 'Toplantı başlığını yaz');
    eq((await pelin.post('/api/toplantilar', { ...base, date: '2026-13-40' })).data.error, 'Toplantı tarihi seç');
    eq((await pelin.post('/api/toplantilar', { ...base, startTime: '25:00' })).data.error, 'Başlangıç saatini seç');
    eq((await pelin.post('/api/toplantilar', { ...base, endTime: '09:30' })).data.error, 'Bitiş saati başlangıçtan sonra olmalı');
    eq((await pelin.post('/api/toplantilar', { ...base, type: 'video' })).status, 400);
    eq((await pelin.post('/api/toplantilar', { ...base, type: 'online', link: 'javascript:alert(1)' })).status, 400);
    eq((await pelin.post('/api/toplantilar', { ...base, type: 'online', link: 'ftp://x.com/a' })).status, 400);
    eq((await pelin.post('/api/toplantilar', { ...base, participants: ['u_yok'] })).status, 400);
    eq((await pelin.post('/api/toplantilar', { ...base, status: 'bitti' })).status, 400);
    eq(sql('SELECT COUNT(*) n FROM meetings')[0].n, 0);
    const anon = new Client();
    eq((await anon.get('/api/toplantilar')).status, 401);
    eq((await anon.post('/api/toplantilar', base)).status, 401);
  });

  const liveV = openLive(volkan); await liveV.ready;
  let m1;
  await t('ekle: firma adı kayıttaki gibi, bağlantı düzelir; katılımcılara bildirim (ekleyene değil), canlı yayın', async () => {
    const r = await pelin.post('/api/toplantilar', {
      title: 'Aralık içerik planı sunumu', client: 'arslandent', date: future, startTime: '14:00', endTime: '15:00', type: 'online', link: 'meet.google.com/abc-defg-hij',
      participants: ['u_pelin', 'u_emre', 'u_volkan'], clientAttendees: 'Dr. Ayşe Arslan', agenda: ['Kasım raporu', { text: 'Aralık kampanyaları', done: false }],
    });
    eq(r.status, 201, JSON.stringify(r.data)); m1 = r.data;
    eq(m1.client, 'Arslandent'); eq(m1.link, 'https://meet.google.com/abc-defg-hij'); eq(m1.status, 'planlandi'); eq(m1.agenda.length, 2); eq(m1.agenda[0].text, 'Kasım raporu');
    eq(notifs('u_emre').length, 1); eq(notifs('u_volkan').length, 1); eq(notifs('u_pelin').length, 0); eq(notifs('u_yigit').length, 0);
    const n = notifs('u_emre')[0]; eq(n.title, 'Toplantıya eklendin'); eq(n.link, '/toplantilar?id=' + m1.id); ok(n.body.includes('Arslandent'), n.body);
    ok(await until(() => liveV.msgs.some((x) => x.type === 'toplanti' && x.id === m1.id)), 'canlı yayın gelmedi');
    ok(liveV.msgs.some((x) => x.type === 'notify' && x.notification.kind === 'toplanti'), 'Volkan canlı bildirim almadı');
    // serbest metin firma da olur
    const r2 = await emre.post('/api/toplantilar', { title: 'Yeni aday firma tanışma', client: 'Deniz Kafe', date: future, startTime: '09:30', type: 'yuzyuze', location: 'Kadıköy' });
    eq(r2.status, 201); eq(r2.data.client, 'Deniz Kafe'); eq(r2.data.participants.length, 0);
  });
  await t('düzenle: ekipten herkes; yeni katılımcıya bildirim, saat değişince diğerlerine', async () => {
    const r = await ilayda.patch('/api/toplantilar/' + m1.id, { participants: [...m1.participants, 'u_yigit'], notes: 'İlk notlar' });
    eq(r.status, 200, JSON.stringify(r.data)); eq(r.data.notes, 'İlk notlar');
    eq(notifs('u_yigit').length, 1); eq(notifs('u_emre').length, 1, 'eski katılımcı yeniden bildirim almamalı');
    const r2 = await ilayda.patch('/api/toplantilar/' + m1.id, { startTime: '15:00', endTime: '16:00' });
    eq(r2.status, 200);
    eq(notifs('u_emre').length, 2); ok(notifs('u_emre').at(-1).title.includes('zamanı değişti'), notifs('u_emre').at(-1).title);
    eq(notifs('u_ilayda').length, 0);
    eq((await ilayda.patch('/api/toplantilar/' + m1.id, { endTime: '14:00' })).status, 400);
    eq((await ilayda.patch('/api/toplantilar/' + m1.id, { notes: 'x'.repeat(20001) })).status, 400);
    eq((await ilayda.patch('/api/toplantilar/' + m1.id, { decisions: ['Bütçe onaylandı', '  ', 'Reels ağırlıklı'] })).data.decisions.length, 2);
    eq((await ilayda.patch('/api/toplantilar/' + m1.id, { agenda: 'bozuk' })).status, 400);
  });
  await t('sil: yalnızca ekleyen ya da yönetici', async () => {
    const r = await pelin.post('/api/toplantilar', { title: 'Silinecek', date: future, startTime: '11:00', participants: ['u_emre'] });
    eq((await emre.del('/api/toplantilar/' + r.data.id)).status, 403);
    eq((await pelin.del('/api/toplantilar/' + r.data.id)).status, 200);
    eq((await pelin.get('/api/toplantilar/' + r.data.id)).status, 404);
    eq(sql(`SELECT COUNT(*) n FROM notifications WHERE link = '/toplantilar?id=${r.data.id}'`)[0].n, 0, 'bildirimleri de silinmeli');
    const r2 = await pelin.post('/api/toplantilar', { title: 'Yönetici siler', date: future, startTime: '11:00' });
    eq((await yigit.del('/api/toplantilar/' + r2.data.id)).status, 200);
  });

  await t('30 dk önce hatırlatma: pencere içinde bir kez; saat değişince yeniden; iptal / uzak toplantıya gitmez', async () => {
    const now = SIMDI();
    const s1 = now + 20 * 60_000, s2 = now + 2 * 3600_000, s3 = now + 10 * 60_000;
    const a = (await pelin.post('/api/toplantilar', { title: 'Yakın toplantı', client: 'Craft Mimarlık', date: istDate(s1), startTime: istTime(s1), type: 'yuzyuze', location: 'Ofis', participants: ['u_emre', 'u_volkan'] })).data;
    const b = (await pelin.post('/api/toplantilar', { title: 'Uzak toplantı', date: istDate(s2), startTime: istTime(s2), participants: ['u_emre'] })).data;
    const c = (await pelin.post('/api/toplantilar', { title: 'İptal toplantı', date: istDate(s3), startTime: istTime(s3), participants: ['u_emre'], status: 'iptal' })).data;
    const rem = (uid, id) => notifs(uid, `AND link = '/toplantilar?id=${id}' AND title LIKE '%dk sonra toplantı'`);
    eq(await runCron('* * * * *'), 200);
    await wait(500);
    eq(rem('u_emre', a.id).length, 1, 'Emre hatırlatma'); eq(rem('u_volkan', a.id).length, 1); eq(rem('u_pelin', a.id).length, 0);
    ok(/^(19|20|21) dk sonra toplantı$/.test(rem('u_emre', a.id)[0].title), rem('u_emre', a.id)[0].title);
    eq(rem('u_emre', b.id).length, 0, 'uzak toplantı'); eq(rem('u_emre', c.id).length, 0, 'iptal');
    eq(sql(`SELECT reminded_for r FROM meetings WHERE id = '${a.id}'`)[0].r, istDate(s1) + ' ' + istTime(s1));
    await runCron('* * * * *'); await wait(500);
    eq(rem('u_emre', a.id).length, 1, 'ikinci kez gitmemeli');
    const s4 = now + 25 * 60_000;
    await pelin.patch('/api/toplantilar/' + a.id, { date: istDate(s4), startTime: istTime(s4) });
    eq(sql(`SELECT reminded_for r FROM meetings WHERE id = '${a.id}'`)[0].r, null, 'saat değişince sıfırlanmalı');
    await runCron('* * * * *'); await wait(500);
    eq(rem('u_emre', a.id).length, 2, 'yeni saat için yeniden');
    // katılımcısı yoksa ekleyene
    const d = (await volkan.post('/api/toplantilar', { title: 'Tek başına', date: istDate(s3), startTime: istTime(s3) })).data;
    await runCron('* * * * *'); await wait(500);
    eq(rem('u_volkan', d.id).length, 1);
    for (const x of [b, c, d]) await pelin.del('/api/toplantilar/' + x.id).catch(() => {});
    await yigit.del('/api/toplantilar/' + d.id);
  });

  let act;
  await t("aksiyon maddeleri: ekle / işaretle / sorumlu; İş Planı'na ekle → gerçek iş (sorumluya atama bildirimi), bağlantı geri döner", async () => {
    eq((await emre.post(`/api/toplantilar/${m1.id}/actions`, { text: ' ' })).status, 400);
    eq((await emre.post(`/api/toplantilar/${m1.id}/actions`, { text: 'x', assigneeId: 'u_yok' })).status, 400);
    eq((await emre.post(`/api/toplantilar/${m1.id}/actions`, { text: 'x', dueDate: '2026-02-31' })).status, 400);
    let r = await emre.post(`/api/toplantilar/${m1.id}/actions`, { text: 'Aralık takvimini müşteriye gönder', assigneeId: 'u_volkan', dueDate: addDays(future, 2) });
    eq(r.status, 201); act = r.data.actions[0]; eq(act.assigneeId, 'u_volkan'); eq(act.done, false);
    r = await emre.patch(`/api/toplantilar/${m1.id}/actions/${act.id}`, { done: true }); eq(r.data.actions[0].done, true);
    eq((await emre.patch(`/api/toplantilar/${m1.id}/actions/${act.id}`, { taskId: 't_yok' })).status, 400);
    const task = await emre.post('/api/tasks', { title: act.text, client: m1.client, assigneeId: act.assigneeId, dueDate: act.dueDate, link: BASE + '/toplantilar?id=' + m1.id });
    eq(task.status, 201);
    r = await emre.patch(`/api/toplantilar/${m1.id}/actions/${act.id}`, { taskId: task.data.id });
    eq(r.status, 200); eq(r.data.actions[0].taskId, task.data.id);
    eq(sql(`SELECT COUNT(*) n FROM notifications WHERE user_id = 'u_volkan' AND kind = 'assign' AND task_id = '${task.data.id}'`)[0].n, 1);
    const r2 = await emre.post(`/api/toplantilar/${m1.id}/actions`, { text: 'Silinecek madde' });
    eq((await emre.del(`/api/toplantilar/${m1.id}/actions/${r2.data.actions[1].id}`)).data.actions.length, 1);
  });

  let au, doc;
  await t('ses kaydı: webm / m4a yüklenir (içerikten tanınır); ses olmayan 415; belge PDF; 25 MB üstü 413', async () => {
    let r = await up(volkan, m1.id, 'ses', WEBM(), 'audio/webm;codecs=opus', 'blob', 754);
    eq(r.status, 201, JSON.stringify(r.data)); au = r.data;
    eq(au.kind, 'ses'); eq(au.contentType, 'audio/webm'); eq(au.durationS, 754); ok(au.name.startsWith('Ses kaydı'), au.name);
    r = await up(volkan, m1.id, 'ses', M4A(), 'audio/x-m4a', 'Telefon kaydı.m4a'); eq(r.status, 201); eq(r.data.contentType, 'audio/mp4'); eq(r.data.name, 'Telefon kaydı.m4a');
    eq((await up(volkan, m1.id, 'ses', Buffer.from('<script>alert(1)</script>'.repeat(20)), 'audio/webm')).status, 415, 'içerik ses değil');
    eq((await up(volkan, m1.id, 'ses', WEBM(), 'text/html')).status, 415, 'tür ses değil');
    eq((await up(volkan, m1.id, 'ses', Buffer.alloc(0), 'audio/webm')).status >= 400, true);
    eq((await up(volkan, m1.id, 'dosya', WEBM(), 'application/octet-stream', 'x.exe')).status, 415);
    r = await up(volkan, m1.id, 'dosya', PDF(), 'application/pdf', 'Teklif.pdf'); eq(r.status, 201); doc = r.data; eq(doc.contentType, 'application/pdf');
    eq((await up(volkan, m1.id, 'dosya', Buffer.concat([PDF(), Buffer.alloc(25 * 1024 * 1024)]), 'application/pdf', 'buyuk.pdf')).status, 413);
    eq((await up(volkan, 'tp_yok', 'ses', WEBM(), 'audio/webm')).status, 404);
    const d = (await pelin.get('/api/toplantilar/' + m1.id)).data; eq(d.files.length, 3);
  });
  await t('dinleme / indirme: yalnızca ekip; bayt aralığı (Range) desteklenir', async () => {
    eq((await raw(null, 'GET', au.url)).status, 401);
    let r = await raw(ilayda, 'GET', au.url);
    eq(r.status, 200); eq(r.headers.get('content-type'), 'audio/webm'); eq(r.data.length, WEBM().length); eq(r.headers.get('accept-ranges'), 'bytes');
    ok(r.headers.get('cache-control').includes('private'));
    r = await raw(ilayda, 'GET', au.url, undefined, { Range: 'bytes=0-99' });
    eq(r.status, 206); eq(r.data.length, 100); eq(r.headers.get('content-range'), 'bytes 0-99/' + WEBM().length);
    eq(r.data[0], 0x1a);
    r = await raw(ilayda, 'GET', au.url, undefined, { Range: 'bytes=999999-' }); eq(r.status, 416);
    r = await raw(ilayda, 'GET', doc.url + '?download'); eq(r.status, 200); ok(r.headers.get('content-disposition').startsWith('attachment'));
  });
  await t('misafir (müşteri portalı) toplantılara ve kayıtlara erişemez', async () => {
    const g = await yigit.post('/api/portal/vatan/guests', { firstName: 'Misafir', lastName: 'Test', email: 'misafir.toplanti@ornek.com' });
    eq(g.status, 200, JSON.stringify(g.data));
    const token = g.data.link.split('/davet/')[1];
    const acc = await fetch(BASE + '/api/auth/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, firstName: 'Misafir', lastName: 'Test', password: 'MisafirSifre1' }) });
    eq(acc.status, 200);
    const cookie = 'maya_g=' + /maya_g=([^;]*)/.exec(acc.headers.get('set-cookie'))[1];
    const G = { cookie };
    eq((await raw(G, 'GET', '/api/misafir/me')).status, 200, 'misafir oturumu');
    eq((await raw(G, 'GET', '/api/toplantilar')).status, 401);
    eq((await raw(G, 'GET', '/api/toplantilar/' + m1.id)).status, 401);
    eq((await raw(G, 'GET', au.url)).status, 401);
    eq((await raw(G, 'POST', '/api/toplantilar', JSON.stringify({ title: 'x', date: future, startTime: '10:00' }), { 'Content-Type': 'application/json' })).status, 401);
  });
  await t('ad değiştir; silme yalnızca yükleyen ya da yönetici', async () => {
    let r = await pelin.patch(`/api/toplantilar/${m1.id}/files/${au.id}`, { name: 'Sunum kaydı' });
    eq(r.status, 200); eq(r.data.files.find((f) => f.id === au.id).name, 'Sunum kaydı');
    eq((await pelin.patch(`/api/toplantilar/${m1.id}/files/${au.id}`, { name: '  ' })).status, 400);
    eq((await pelin.del(`/api/toplantilar/${m1.id}/files/${doc.id}`)).status, 403);
    eq((await volkan.del(`/api/toplantilar/${m1.id}/files/${doc.id}`)).status, 200);
    eq((await raw(volkan, 'GET', doc.url)).status, 404);
  });
  await t('takvim aboneliği: katılımcı / ekleyen görür, diğerleri görmez; grup kapatılabilir', async () => {
    const feedOf = async (cl) => { const r = await cl.post('/api/takvim/yenile'); eq(r.status, 200); return (await fetch(BASE + new URL(r.data.url).pathname)).text(); };
    const unfold = (s) => s.replace(/\r\n[ \t]/g, '');
    const vt = unfold(await feedOf(volkan));
    const ev = vt.split('BEGIN:VEVENT').find((e) => e.includes('UID:toplanti-' + m1.id + '@'));
    ok(ev, 'Volkan takviminde toplantı yok');
    ok(ev.includes('SUMMARY:🤝 Aralık içerik planı sunumu · Arslandent'), ev);
    ok(ev.includes('DTSTART;TZID=Europe/Istanbul:' + future.replace(/-/g, '') + 'T150000'), 'DTSTART');
    ok(ev.includes('DTEND;TZID=Europe/Istanbul:' + future.replace(/-/g, '') + 'T160000'), 'DTEND');
    ok(ev.includes('LOCATION:https://meet.google.com/abc-defg-hij'), 'LOCATION');
    ok(ev.includes('Gündem:\\n• Kasım raporu'), 'gündem açıklamada');
    ok(ev.includes('CATEGORIES:Toplantı'));
    const pt = unfold(await feedOf(pelin)); ok(pt.includes('UID:toplanti-' + m1.id + '@'), 'ekleyen (Pelin) görmeli');
    const et = unfold(await feedOf(esra)); ok(!et.includes('UID:toplanti-' + m1.id), 'katılımcı olmayan görmemeli');
    eq((await volkan.patch('/api/takvim', { groups: { meetings: false } })).data.groups.meetings, false);
    const r = await volkan.post('/api/takvim/yenile');
    ok(!(await (await fetch(BASE + new URL(r.data.url).pathname)).text()).includes('UID:toplanti-'), 'grup kapalıyken çıkmamalı');
    await volkan.patch('/api/takvim', { groups: { meetings: true } });
  });
  await t('hızlı arama toplantıları bulur (Türkçe harf duyarsız)', async () => {
    const r = await emre.get('/api/search?q=' + encodeURIComponent('aralik icerik'));
    eq(r.status, 200); ok(r.data.meetings.some((x) => x.id === m1.id), JSON.stringify(r.data.meetings));
    eq(r.data.meetings.find((x) => x.id === m1.id).link, '/toplantilar?id=' + m1.id);
  });
  liveV.ws.close();

  // ---------- arayüz için veri ----------
  const today = realToday();
  const nowIst = istTime(Date.now());
  const hh = (ms) => istTime(ms);
  // bugün: saati geçmiş (notları bekleyen) + yaklaşan; dün: yapıldı; geçen hafta: notu eklenmemiş
  const later = Date.now() + 3 * 3600_000;
  const laterDate = istDate(later) === today ? today : addDays(today, 1);
  await emre.post('/api/toplantilar', { title: 'Haftalık durum toplantısı', client: 'Büyüksoy Şemsiye', date: laterDate, startTime: istDate(later) === today ? hh(later) : '10:00', type: 'online', link: 'https://zoom.us/j/123', participants: ['u_yigit', 'u_emre'] });
  await pelin.post('/api/toplantilar', { title: 'Çekim öncesi brif', client: 'Çavuşdent', date: addDays(today, -1), startTime: '11:00', endTime: '12:00', type: 'yuzyuze', location: 'Klinik', participants: ['u_pelin', 'u_yigit'], status: 'yapildi', notes: 'Çekim akışı konuşuldu.' });
  const pastWait = (await pelin.post('/api/toplantilar', { title: 'Sosyal medya raporu görüşmesi', client: 'Doğa Dent', date: addDays(today, -5), startTime: '16:00', type: 'telefon', participants: ['u_yigit'] })).data;
  await yigit.post('/api/toplantilar', { title: 'Yıllık sözleşme yenileme', client: 'Craft Mimarlık', date: addDays(today, 9), startTime: '10:30', endTime: '11:30', type: 'yuzyuze', location: 'Craft ofis, Nişantaşı', participants: ['u_yigit', 'u_pelin'], agenda: ['Fiyat güncellemesi', 'Kapsam'] });
  await yigit.post('/api/toplantilar', { title: 'Ertelenen tanıtım', client: 'Arslandent', date: addDays(today, 4), startTime: '13:00', status: 'ertelendi' });

  console.log('Arayüz');
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
  const errors = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toplanti-'));
  const pdfFile = path.join(tmp, 'Sunum.pdf'); fs.writeFileSync(pdfFile, PDF());
  const audioFile = path.join(tmp, 'Musteri telefon kaydi.m4a'); fs.writeFileSync(audioFile, M4A());
  async function open(email, viewport = { width: 1400, height: 900 }) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', permissions: ['microphone'] });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(email + ': ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(email + ': ' + m.text()); });
    await p.goto(UI + '/giris');
    await p.fill('input[type=email]', email); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
    await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
    return p;
  }
  const theme = async (p, th) => { await p.evaluate((th) => fetch('/api/me', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: { theme: th } }) }), th); };
  const audit = async (p) => { await p.waitForTimeout(700); return p.evaluate(AUDIT); };
  const noOverflow = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

  const p = await open('yigiitozdemir@gmail.com');
  await theme(p, 'dark');
  await p.evaluate(() => localStorage.removeItem('maya.toplanti.ui'));

  await t('menü: Planlama altında Çekim Planı\'ndan hemen sonra "Toplantılar"', async () => {
    await p.goto(UI + '/'); await p.waitForSelector('.side .nav');
    const hrefs = await p.$$eval('.side .nav a', (as) => as.map((a) => a.getAttribute('href')));
    const i = hrefs.indexOf('/cekim'); ok(i >= 0); eq(hrefs[i + 1], '/toplantilar');
    await p.click('.side .nav a[href="/toplantilar"]');
    await p.waitForSelector('.tp-page h1:has-text("Toplantılar")');
  });
  await t('Bugün sayfası: bugünkü toplantılar kısa kartta (yalnızca varsa)', async () => {
    await p.goto(UI + '/'); await p.waitForSelector('.h1');
    if (laterDate === today) {
      await p.waitForSelector('.tp-today .tp-today-it:has-text("Haftalık durum toplantısı")');
      ok((await p.textContent('.tp-today h2')).startsWith('Bugün'), await p.textContent('.tp-today h2'));
    }
    const e = await open('esra@mayaajans.net', { width: 1200, height: 800 });
    await e.goto(UI + '/'); await e.waitForSelector('.h1'); await e.waitForTimeout(900);
    eq(await e.$$eval('.tp-today', (x) => x.length), laterDate === today ? 1 : 0); // ekip görünürlüğü: herkes görür
    await e.context().close();
  });
  await t('liste: Yaklaşan gün gruplu, firma işareti; notu bekleyen uyarısı; Geçmiş sekmesi', async () => {
    await p.goto(UI + '/toplantilar'); await p.waitForSelector('.tp-card');
    ok(await p.isVisible('.tp-when-tabs button[aria-selected=true]:has-text("Yaklaşan")'));
    ok(await p.isVisible('.tp-card:has-text("Yıllık sözleşme yenileme") .cmark'), 'firma işareti');
    ok(await p.isVisible('.tp-alert:has-text("notları bekleniyor")'), 'notu bekleyen uyarısı');
    const titles = await p.$$eval('.ck-sec .tp-card .ck-title', (e) => e.map((x) => x.textContent));
    ok(titles.indexOf('Yıllık sözleşme yenileme') > titles.indexOf('Aralık içerik planı sunumu'), titles.join(' | '));
    await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/toplanti-liste-koyu.png` });
    const bad = await audit(p); ok(bad.length === 0, bad.join(' | '));
    await p.click('.tp-when-tabs button:has-text("Geçmiş")');
    await p.waitForSelector('.tp-card:has-text("Sosyal medya raporu görüşmesi") .tp-addnotes');
    ok(await p.isVisible('.tp-card:has-text("Çekim öncesi brif") .tp-st.yapildi'));
  });
  await t('takvim görünümü: ay takvimi, toplantılar günlerinde; tıklayınca detay açılır', async () => {
    await p.click('.seg button:has-text("Takvim")');
    await p.waitForSelector('.tp-cal.big');
    if (addDays(today, 9).slice(0, 7) !== today.slice(0, 7)) await p.click('.tp-cal.big button[aria-label="Sonraki ay"]');
    await p.waitForSelector('.tp-ev:has-text("Yıllık sözleşme")');
    await p.click('.tp-cal.big .ck-cal-h .btn');
    if (laterDate === today) await p.waitForSelector('.tp-ev:has-text("Haftalık durum")');
    await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/toplanti-takvim-koyu.png` });
    const bad = await audit(p); ok(bad.length === 0, bad.join(' | '));
    await p.click('.seg button:has-text("Liste")');
  });

  let newId;
  await t('yeni toplantı formu: zorunlu alanlar, tür seçimi, katılımcı, gündem; kaydedince detay açılır', async () => {
    await p.click('button:has-text("Yeni toplantı") >> nth=0');
    await p.waitForSelector('.tp-form');
    await p.click('.tp-form button:has-text("Toplantıyı ekle")');
    await p.waitForSelector('.tp-form .errtext:has-text("başlığını yaz")');
    await p.fill('.tp-form input[maxlength="200"]', 'Ocak kampanya fikirleri');
    await p.fill('.tp-form input[list=toplanti-firmalar]', 'Arslandent');
    await p.fill('.tp-form input[type=date]', addDays(today, 2));
    await p.fill('.tp-form input[type=time] >> nth=0', '11:00');
    await p.fill('.tp-form input[type=time] >> nth=1', '12:00');
    await p.click('.tp-typeseg button:has-text("Online")');
    await p.fill('.tp-form input[inputmode=url]', 'meet.google.com/xyz-abcd-efg');
    await p.click('.tp-form .ck-chip:has-text("Pelin")');
    await p.fill('.tp-form .ck-add input', 'Ocak indirim kampanyası'); await p.keyboard.press('Enter');
    await p.fill('.tp-form .ck-add input', 'Influencer iş birliği'); await p.keyboard.press('Enter');
    eq(await p.$$eval('.tp-form .tp-item', (x) => x.length), 2);
    await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/toplanti-form-koyu.png` });
    await p.click('.tp-form button:has-text("Toplantıyı ekle")');
    await p.waitForSelector('.tp-drawer h2:has-text("Ocak kampanya fikirleri")');
    newId = new URL(p.url()).searchParams.get('id'); ok(newId, 'adres ?id= almadı');
    const row = sql(`SELECT * FROM meetings WHERE id = '${newId}'`)[0];
    eq(row.type, 'online'); eq(row.link, 'https://meet.google.com/xyz-abcd-efg'); eq(row.end_time, '12:00');
    ok(JSON.parse(row.participants).includes('u_pelin'));
    eq(sql(`SELECT COUNT(*) n FROM notifications WHERE user_id='u_pelin' AND link='/toplantilar?id=${newId}'`)[0].n, 1);
    ok(await p.isVisible('.tp-join:has-text("Toplantıya katıl")'));
  });
  await t('detay: notlar otomatik kaydedilir, kararlar, aksiyon → İş Planı\'na ekle', async () => {
    await p.click('.tp-tabs button:has-text("Notlar")');
    await p.fill('.tp-notes textarea', 'Müşteri Ocak için %20 indirim istiyor.\nReels ağırlıklı ilerlenecek.');
    await p.waitForSelector('.tp-save.saved:has-text("Kaydedildi")', { timeout: 6000 });
    ok(sql(`SELECT notes FROM meetings WHERE id='${newId}'`)[0].notes.includes('%20 indirim'));
    await p.click('.tp-tabs button:has-text("Kararlar")');
    await p.fill('.tp-panel .ck-add input', 'Bütçe 40.000 TL olarak onaylandı'); await p.keyboard.press('Enter');
    await p.waitForSelector('.tp-panel .tp-item:has-text("Bütçe 40.000")');
    await p.click('.tp-tabs button:has-text("Aksiyonlar")');
    await p.fill('.tp-act-add input[maxlength="300"]', 'Kampanya görsellerini hazırla');
    await p.selectOption('.tp-act-add select', 'u_pelin');
    await p.keyboard.press('Enter');
    await p.waitForSelector('.tp-act:has-text("Kampanya görsellerini hazırla")');
    await p.click('.tp-act button:has-text("İş Planı\'na ekle")');
    await p.waitForSelector('.snack:has-text("teslim tarihi seç")');
    await p.fill('.tp-act input[type=date]', addDays(today, 5)); await p.dispatchEvent('.tp-act input[type=date]', 'change');
    await p.waitForTimeout(500);
    await p.click('.tp-act button:has-text("İş Planı\'na ekle")');
    await p.waitForSelector('.tp-act .tp-tasklink');
    const a = sql(`SELECT * FROM meeting_actions WHERE meeting_id='${newId}'`)[0]; ok(a.task_id, 'task_id yok');
    const task = sql(`SELECT * FROM tasks WHERE id='${a.task_id}'`)[0];
    eq(task.title, 'Kampanya görsellerini hazırla'); eq(task.client, 'Arslandent'); eq(task.assignee_id, 'u_pelin'); eq(task.due_date, addDays(today, 5));
    ok(task.link.endsWith('/toplantilar?id=' + newId), task.link);
    await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/toplanti-detay-aksiyon-koyu.png` });
  });
  await t('ses kaydı: tarayıcıda kaydet (zamanlayıcı, gösterge, duraklat), yüklenir ve oynatıcıda görünür', async () => {
    await p.click('.tp-tabs button:has-text("Ses kaydı")');
    await p.click('.tp-rec-start');
    await p.waitForSelector('.tp-rec.on .tp-rec-time', { timeout: 8000 });
    await p.waitForTimeout(1600);
    await p.click('.tp-rec-b button:has-text("Duraklat")');
    await p.waitForSelector('.tp-rec.paused');
    await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/toplanti-kayit-koyu.png` });
    await p.click('.tp-rec-b button:has-text("Devam et")');
    await p.waitForTimeout(1200);
    const tm = await p.textContent('.tp-rec-time'); ok(/^0:0[2-9]$/.test(tm), 'süre ' + tm);
    // kayıt sürerken panel kapanmaz
    await p.keyboard.press('Escape'); await p.waitForSelector('.snack:has-text("önce kaydı bitir")'); ok(await p.isVisible('.tp-drawer'));
    await p.click('.tp-rec-b button:has-text("Bitir ve kaydet")');
    await p.waitForSelector('.tp-file.ses audio', { timeout: 10000 });
    const f = sql(`SELECT * FROM meeting_files WHERE meeting_id='${newId}' AND kind='ses'`);
    eq(f.length, 1); ok(/^audio\/(webm|ogg|mp4)$/.test(f[0].content_type), f[0].content_type); ok(f[0].size > 500, 'boyut ' + f[0].size); ok(f[0].duration_s >= 2, 'süre ' + f[0].duration_s);
    ok(f[0].name.startsWith('Toplantı kaydı'), f[0].name);
    // oynatıcı sunucudan okuyabiliyor
    const dur = await p.$eval('.tp-file.ses audio', (a) => new Promise((res) => { if (a.readyState >= 1) res(a.duration); a.onloadedmetadata = () => res(a.duration); a.onerror = () => res(-1); setTimeout(() => res(-2), 4000); }));
    ok(dur !== -1, 'ses oynatıcı hata verdi');
    // dosya yükleme yolu (iPhone sesli not vb.)
    await p.setInputFiles('.tp-upbtn input[type=file]', audioFile);
    await p.waitForSelector('.tp-file.ses .nm:has-text("Musteri telefon kaydi")');
    // yeniden adlandır
    await p.click('.tp-file.ses >> nth=0 >> button[aria-label$="adını değiştir"]');
    await p.fill('.tp-file.ses .tp-inline', 'Ocak toplantısı kaydı'); await p.keyboard.press('Enter');
    await p.waitForSelector('.tp-file.ses .nm:has-text("Ocak toplantısı kaydı")');
    await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/toplanti-detay-ses-koyu.png` });
    const bad = await audit(p); ok(bad.length === 0, bad.join(' | '));
  });
  await t('dosyalar: PDF yüklenir ve listelenir', async () => {
    await p.click('.tp-tabs button:has-text("Dosyalar")');
    await p.setInputFiles('.tp-drop input[type=file]', pdfFile);
    await p.waitForSelector('.tp-file.dosya .nm:has-text("Sunum.pdf")');
    await p.click('.tp-tabs button:has-text("Notlar")');
    await p.waitForTimeout(400); await p.screenshot({ path: `${OUT}/toplanti-detay-notlar-koyu.png` });
    const bad = await audit(p); ok(bad.length === 0, bad.join(' | '));
    await p.keyboard.press('Escape'); await p.waitForSelector('.tp-drawer', { state: 'detached' });
  });
  await t('geçmiş toplantı: "Toplantı notlarını ekle" notlar sekmesini açar; Yapıldı işaretlenir', async () => {
    await p.click('.tp-when-tabs button:has-text("Geçmiş")');
    await p.click('.tp-card:has-text("Sosyal medya raporu görüşmesi") .tp-addnotes');
    await p.waitForSelector('.tp-drawer .tp-prompt:has-text("Toplantı notlarını ekle")');
    ok(await p.isVisible('.tp-tabs button[aria-selected=true]:has-text("Notlar")'));
    await p.click('.tp-prompt button:has-text("Yapıldı")');
    await p.waitForSelector('.tp-drawer .tp-prompt', { state: 'detached' });
    eq(sql(`SELECT status FROM meetings WHERE id='${pastWait.id}'`)[0].status, 'yapildi');
    await p.keyboard.press('Escape');
  });
  await t('bildirim bağlantısı (/toplantilar?id=) detayı açar; başkasının toplantısında Sil yok', async () => {
    const pp = await open('pelin@mayaajans.net');
    await pp.goto(UI + '/toplantilar?id=' + newId);
    await pp.waitForSelector('.tp-drawer h2:has-text("Ocak kampanya fikirleri")');
    ok(!(await pp.isVisible('.tp-drawer button:has-text("Toplantıyı sil")')), 'Pelin silememeli');
    ok(await pp.isVisible('.tp-drawer button:has-text("Düzenle")'));
    // canlı: Yiğit başlığı değiştirir, Pelin'in ekranına düşer
    await yigit.patch('/api/toplantilar/' + newId, { title: 'Ocak kampanya fikirleri (güncel)' });
    await pp.waitForSelector('.tp-drawer h2:has-text("(güncel)")', { timeout: 6000 });
    await pp.context().close();
  });
  await t('müşteri kartı: "Toplantılar" sekmesi o firmanın toplantılarını gösterir', async () => {
    await p.goto(UI + '/musteriler?id=c_01&sekme=toplanti'); // Arslandent
    await p.waitForSelector('.tp-mk .tp-card:has-text("Ocak kampanya fikirleri")');
    ok(await p.isVisible('.mu-tabs button[aria-selected=true]:has-text("Toplantılar")'));
    await p.click('.tp-mk .tp-card:has-text("Ocak kampanya") .ck-body');
    await p.waitForURL((u) => u.pathname === '/toplantilar');
    await p.waitForSelector('.tp-drawer h2:has-text("Ocak kampanya")');
    await p.keyboard.press('Escape');
  });
  await t('hızlı arama paletinde toplantılar', async () => {
    await p.keyboard.press('Control+k');
    await p.waitForSelector('input[placeholder*="toplantı, mesaj ara"]', { timeout: 4000 });
    await p.keyboard.type('sözleşme yenileme');
    await p.waitForSelector('text=Yıllık sözleşme yenileme', { timeout: 5000 });
    await p.keyboard.press('Escape');
  });
  await t('açık tema (Premium cam): liste + detay kontrast', async () => {
    await theme(p, 'light');
    await p.goto(UI + '/toplantilar'); await p.waitForSelector('.tp-card');
    await p.click('.tp-when-tabs button:has-text("Yaklaşan")');
    await p.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 8000 }).catch(() => {});
    await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/toplanti-liste-acik.png` });
    let bad = await audit(p); ok(bad.length === 0, 'liste ' + bad.join(' | '));
    await p.click('.tp-card:has-text("Ocak kampanya") .ck-body'); await p.waitForSelector('.tp-drawer h2');
    await p.click('.tp-tabs button:has-text("Ses kaydı")'); await p.waitForSelector('.tp-file.ses');
    await p.waitForTimeout(500); await p.screenshot({ path: `${OUT}/toplanti-detay-acik.png` });
    bad = await audit(p); ok(bad.length === 0, 'detay ' + bad.join(' | '));
    await p.click('.tp-tabs button:has-text("Aksiyonlar")');
    bad = await audit(p); ok(bad.length === 0, 'aksiyon ' + bad.join(' | '));
    await p.keyboard.press('Escape');
    await p.click('.seg button:has-text("Takvim")'); await p.waitForSelector('.tp-cal.big');
    bad = await audit(p); ok(bad.length === 0, 'takvim ' + bad.join(' | '));
    await p.click('.seg button:has-text("Liste")');
  });
  await t('telefon (390 px): liste, takvim, detay ve form taşmaz; iki tema kontrast', async () => {
    const m = await open('emre@mayaajans.net', { width: 390, height: 844 });
    for (const th of ['dark', 'light']) {
      await theme(m, th);
      await m.goto(UI + '/toplantilar'); await m.waitForSelector('.tp-card');
      eq(await noOverflow(m), true, 'liste yatay taşma ' + th);
      await m.waitForTimeout(500); await m.screenshot({ path: `${OUT}/toplanti-telefon-${th === 'dark' ? 'koyu' : 'acik'}.png` });
      let bad = await audit(m); ok(bad.length === 0, 'telefon liste ' + th + ' ' + bad.join(' | '));
      await m.click('.tp-card:has-text("Aralık içerik planı") .ck-body'); await m.waitForSelector('.tp-drawer h2');
      for (const tab of ['Aksiyonlar', 'Ses kaydı', 'Notlar']) {
        await m.click(`.tp-tabs button:has-text("${tab}")`); await m.waitForTimeout(250);
        eq(await m.evaluate(() => { const d = document.querySelector('.tp-drawer'); return d.scrollWidth <= d.clientWidth + 1; }), true, 'çekmece taşıyor: ' + tab);
      }
      await m.click('.tp-tabs button:has-text("Ses kaydı")');
      await m.waitForTimeout(500); await m.screenshot({ path: `${OUT}/toplanti-telefon-detay-${th === 'dark' ? 'koyu' : 'acik'}.png` });
      bad = await audit(m); ok(bad.length === 0, 'telefon detay ' + th + ' ' + bad.join(' | '));
      await m.keyboard.press('Escape');
      await m.click('.seg button:has-text("Takvim")'); await m.waitForSelector('.tp-cal.big');
      eq(await noOverflow(m), true, 'takvim yatay taşma');
      await m.click('.seg button:has-text("Liste")');
      await m.click('button:has-text("Yeni toplantı") >> nth=0'); await m.waitForSelector('.tp-form');
      eq(await m.evaluate(() => { const d = document.querySelector('.dialog'); return d.scrollWidth <= d.clientWidth + 1; }), true, 'form taşıyor');
      await m.keyboard.press('Escape'); await m.waitForSelector('.tp-form', { state: 'detached' });
    }
    await theme(m, 'dark');
    await m.context().close();
  });
  await t('konsol hatası yok', async () => ok(errors.length === 0, errors.join(' | ')));
  await theme(p, 'dark');
  await browser.close();
  void nowIst;
  done();
})().catch((e) => { console.error(e); process.exit(1); });
