// Özel Günler API testi
// BASE=http://127.0.0.1:8802 PERSIST=.wrangler/state-ozelgunler node test/ozelgunler.e2e.mjs
import { Client, loginAs, t, ok, eq, until, openLive, sql, done } from './lib.mjs';

const anon = new Client();
const yigit = await loginAs('u_yigit', 'Yiğit');
const pelin = await loginAs('u_pelin', 'Pelin');
const esra = await loginAs('u_esra', 'Esra');
const enc = encodeURIComponent;
let dayId;

console.log('\nGiriş');
await t('girişsiz liste 401', async () => eq((await anon.get('/api/days')).status, 401));
await t('girişsiz ekleme 401', async () => eq((await anon.post('/api/days', { name: 'X', date: '2026-12-01' })).status, 401));

console.log('\nGünler');
await t('başlangıç verisi: 57 gün, hiçbirinde firma yok', async () => {
  const r = await pelin.get('/api/days');
  eq(r.status, 200);
  ok(r.data.length >= 57, 'gün sayısı ' + r.data.length);
  eq(r.data.filter((d) => d.rows.length).length, 0, 'firmalı gün');
  const d = r.data.find((x) => x.id === 'd_e10');
  eq(d.prepDate, '2026-11-06', '10 Kas Salı → hazırlık 6 Kas Cuma');
  eq(d.star, true);
});
await t('gün ekle (üye ekleyebilir)', async () => {
  const r = await pelin.post('/api/days', { name: 'Firma kuruluş yıl dönümü', date: '2026-12-15', tone: 'kutlama', star: true, note: 'Konfetili', rangeLabel: '15 Aralık' });
  eq(r.status, 201, JSON.stringify(r.data));
  dayId = r.data.id;
  eq(r.data.name, 'Firma kuruluş yıl dönümü'); eq(r.data.tone, 'kutlama'); eq(r.data.star, true); eq(r.data.rangeLabel, '15 Aralık');
  eq(r.data.rows.length, 0);
});
await t('geçersiz tarih reddedilir', async () => {
  for (const date of ['2026-02-30', '15.12.2026', '', null]) {
    const r = await pelin.post('/api/days', { name: 'Hatalı', date });
    eq(r.status, 400, String(date)); ok(r.data.error);
  }
  eq((await pelin.patch('/api/days/' + dayId, { date: '2026-13-01' })).status, 400);
});
await t('boş ad ve geçersiz tür reddedilir', async () => {
  eq((await pelin.post('/api/days', { name: '  ', date: '2026-12-01' })).status, 400);
  eq((await pelin.patch('/api/days/' + dayId, { tone: 'parti' })).status, 400);
  eq((await pelin.patch('/api/days/' + dayId, { name: '' })).status, 400);
});
await t('ad ve tarih düzenle', async () => {
  const r = await esra.patch('/api/days/' + dayId, { name: 'Kuruluş yıl dönümü', date: '2026-12-16', star: false, tone: 'bilgi', note: '', rangeLabel: '' });
  eq(r.status, 200, JSON.stringify(r.data));
  eq(r.data.name, 'Kuruluş yıl dönümü'); eq(r.data.date, '2026-12-16'); eq(r.data.star, false); eq(r.data.rangeLabel, '');
  eq(r.data.prepDate, '2026-12-14', '16 Ara Çar → 14 Ara Pzt');
});
await t('olmayan gün 404', async () => eq((await pelin.patch('/api/days/d_yok', { name: 'a' })).status, 404));

console.log('\nFirmalar ve atama');
await t('müşteri listesinde olmayan firma reddedilir', async () => {
  const r = await pelin.post(`/api/days/${dayId}/rows`, { rows: [{ client: 'Uydurma Firma' }] });
  eq(r.status, 400);
});
await t('firma ekle (sorumlusuz, otomatik atama yok)', async () => {
  const r = await pelin.post(`/api/days/${dayId}/rows`, { rows: [{ client: 'Arslandent', format: 'Post', lang: 'tr+bg' }, { client: 'Craft Mimarlık' }] });
  eq(r.status, 201, JSON.stringify(r.data));
  eq(r.data.rows.length, 2);
  eq(r.data.rows[0].client, 'Arslandent'); eq(r.data.rows[0].lang, 'TR+BG'); eq(r.data.rows[0].format, 'Post');
  eq(r.data.rows[1].format, 'Story'); eq(r.data.rows[1].lang, 'TR');
  ok(r.data.rows.every((x) => x.assigneeId === null), 'atama yapılmamalı');
});
await t('aynı firma iki kez eklenemez', async () => eq((await pelin.post(`/api/days/${dayId}/rows`, { client: 'arslandent' })).status, 409));
await t('geçersiz biçim / dil / kişi reddedilir', async () => {
  eq((await pelin.patch(`/api/days/${dayId}/rows/${enc('Arslandent')}`, { format: 'Afiş' })).status, 400);
  eq((await pelin.patch(`/api/days/${dayId}/rows/${enc('Arslandent')}`, { lang: 'Türkçe çok uzun' })).status, 400);
  eq((await pelin.patch(`/api/days/${dayId}/rows/${enc('Arslandent')}`, { assigneeId: 'u_yok' })).status, 400);
});
await t('sorumlu atanınca bildirim atanana gider, başkasına gitmez', async () => {
  const le = openLive(esra), lp = openLive(pelin), ly = openLive(yigit);
  await Promise.all([le.ready, lp.ready, ly.ready]);
  const r = await pelin.patch(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}`, { assigneeId: 'u_esra' });
  eq(r.status, 200, JSON.stringify(r.data));
  eq(r.data.rows.find((x) => x.client === 'Craft Mimarlık').assigneeId, 'u_esra');
  ok(await until(() => le.msgs.some((m) => m.type === 'notify')), 'Esra bildirim almadı');
  const n = le.msgs.find((m) => m.type === 'notify').notification;
  eq(n.kind, 'special'); eq(n.title, 'Özel gün görevi');
  eq(n.body, 'Kuruluş yıl dönümü · Craft Mimarlık · Story');
  eq(n.link, '/ozel-gunler?id=' + dayId); eq(n.actorId, 'u_pelin');
  ok(await until(() => ly.msgs.some((m) => m.type === 'days' && m.id === dayId)), 'days yayını gelmedi');
  ok(!ly.msgs.some((m) => m.type === 'notify'), 'Yiğit bildirim almamalı');
  ok(!lp.msgs.some((m) => m.type === 'notify'), 'atayan bildirim almamalı');
  const list = await esra.get('/api/notifications');
  ok(list.data.some((x) => x.kind === 'special' && x.body.includes('Craft Mimarlık')), 'zilde yok');
  le.ws.close(); lp.ws.close(); ly.ws.close();
});
await t('kendine atayınca bildirim yok', async () => {
  const before = sql("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_pelin'")[0].n;
  eq((await pelin.patch(`/api/days/${dayId}/rows/${enc('Arslandent')}`, { assigneeId: 'u_pelin' })).status, 200);
  eq(sql("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_pelin'")[0].n, before);
});
await t('aynı kişiyi yeniden seçmek ikinci bildirim üretmez', async () => {
  const before = sql("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_esra' AND kind = 'special'")[0].n;
  eq((await yigit.patch(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}`, { assigneeId: 'u_esra', lang: 'TR+EN' })).status, 200);
  eq(sql("SELECT COUNT(*) AS n FROM notifications WHERE user_id = 'u_esra' AND kind = 'special'")[0].n, before);
});
await t('eklerken sorumlu seçilirse bildirim gider', async () => {
  const r = await yigit.post(`/api/days/${dayId}/rows`, { rows: [{ client: 'Miradent', format: 'Reels', assigneeId: 'u_pelin' }] });
  eq(r.status, 201);
  const rows = sql("SELECT body, link FROM notifications WHERE user_id = 'u_pelin' AND kind = 'special'");
  ok(rows.some((x) => x.body === 'Kuruluş yıl dönümü · Miradent · Reels'), JSON.stringify(rows));
});

console.log('\nHazırladım');
await t('Başladım → Hazırlanıyor', async () => {
  const r = await esra.patch(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}`, { status: 1 });
  const row = r.data.rows.find((x) => x.client === 'Craft Mimarlık');
  eq(row.status, 1); eq(row.doneBy, null);
});
await t('Hazırladım: yapan kişi ve zaman kaydedilir (atanan değil, basan)', async () => {
  const r = await yigit.patch(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}`, { status: 2 });
  const row = r.data.rows.find((x) => x.client === 'Craft Mimarlık');
  eq(row.status, 2); eq(row.doneBy, 'u_yigit'); ok(row.doneAt, 'done_at boş');
});
await t('Hazır olanı tekrar Hazırladım saymak yapanı değiştirmez', async () => {
  const r = await pelin.patch(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}`, { status: 2 });
  eq(r.data.rows.find((x) => x.client === 'Craft Mimarlık').doneBy, 'u_yigit');
});
await t('geri al', async () => {
  const r = await pelin.patch(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}`, { status: 0 });
  const row = r.data.rows.find((x) => x.client === 'Craft Mimarlık');
  eq(row.status, 0); eq(row.doneBy, null); eq(row.doneAt, null);
});
await t('geçersiz durum reddedilir', async () => eq((await pelin.patch(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}`, { status: 5 })).status, 400));

console.log("\nİş Planı'na gönder");
let taskId;
await t('iş oluşur, atanana iş bildirimi gider', async () => {
  const le = openLive(esra), lp = openLive(pelin);
  await Promise.all([le.ready, lp.ready]);
  const r = await pelin.post(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}/task`);
  eq(r.status, 201, JSON.stringify(r.data));
  taskId = r.data.taskId;
  eq(r.data.day.rows.find((x) => x.client === 'Craft Mimarlık').taskId, taskId);
  const task = sql(`SELECT * FROM tasks WHERE id = '${taskId}'`)[0];
  eq(task.title, 'Kuruluş yıl dönümü – Story'); eq(task.client, 'Craft Mimarlık'); eq(task.assignee_id, 'u_esra');
  eq(task.due_date, '2026-12-14'); eq(task.source, 'ozel-gun'); eq(task.created_by, 'u_pelin');
  ok(await until(() => le.msgs.some((m) => m.type === 'notify' && m.notification.kind === 'assign')), 'iş bildirimi gelmedi');
  eq(le.msgs.find((m) => m.type === 'notify' && m.notification.kind === 'assign').notification.taskId, taskId);
  ok(await until(() => lp.msgs.some((m) => m.type === 'tasks')), 'tasks yayını gelmedi');
  ok(lp.msgs.some((m) => m.type === 'days'), 'days yayını gelmedi');
  const tasks = await esra.get('/api/tasks');
  ok(tasks.data.some((x) => x.id === taskId), 'İş Planı listesinde yok');
  le.ws.close(); lp.ws.close();
});
await t('aynı satır ikinci kez gönderilemez', async () => {
  const before = sql("SELECT COUNT(*) AS n FROM tasks WHERE source = 'ozel-gun'")[0].n;
  const r = await yigit.post(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}/task`);
  eq(r.status, 409); eq(r.data.taskId, taskId);
  eq(sql("SELECT COUNT(*) AS n FROM tasks WHERE source = 'ozel-gun'")[0].n, before);
});
await t('Hazırladım gönderilmiş işi de tamamlar', async () => {
  await esra.patch(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}`, { status: 2 });
  eq(sql(`SELECT status FROM tasks WHERE id = '${taskId}'`)[0].status, 2);
  await esra.patch(`/api/days/${dayId}/rows/${enc('Craft Mimarlık')}`, { status: 0 });
  eq(sql(`SELECT status FROM tasks WHERE id = '${taskId}'`)[0].status, 0);
});
await t('sorumlusuz satır da gönderilebilir (bildirim yok)', async () => {
  await pelin.patch(`/api/days/${dayId}/rows/${enc('Arslandent')}`, { assigneeId: null });
  const r = await pelin.post(`/api/days/${dayId}/rows/${enc('Arslandent')}/task`);
  eq(r.status, 201);
  eq(sql(`SELECT assignee_id FROM tasks WHERE id = '${r.data.taskId}'`)[0].assignee_id, null);
});

console.log('\nKaldırma, silme, canlı');
await t('firma kaldır', async () => {
  const r = await esra.del(`/api/days/${dayId}/rows/${enc('Miradent')}`);
  eq(r.status, 200); ok(!r.data.rows.some((x) => x.client === 'Miradent'));
  eq((await esra.del(`/api/days/${dayId}/rows/${enc('Miradent')}`)).status, 404);
});
await t("canlı 'days' yayını (gün düzenleme)", async () => {
  const l = openLive(esra); await l.ready;
  await pelin.patch('/api/days/' + dayId, { note: 'canlı deneme' });
  ok(await until(() => l.msgs.some((m) => m.type === 'days' && m.id === dayId)), 'yayın gelmedi');
  l.ws.close();
});
await t('gün sil (firmaları da gider, iş yerinde kalır)', async () => {
  const l = openLive(yigit); await l.ready;
  const r = await esra.del('/api/days/' + dayId);
  eq(r.status, 200);
  eq((await esra.get('/api/days/' + dayId)).status, 404);
  eq(sql(`SELECT COUNT(*) AS n FROM special_day_rows WHERE day_id = '${dayId}'`)[0].n, 0);
  eq(sql(`SELECT COUNT(*) AS n FROM tasks WHERE id = '${taskId}'`)[0].n, 1);
  ok(await until(() => l.msgs.some((m) => m.type === 'days' && m.id === dayId)), 'silme yayını gelmedi');
  l.ws.close();
  eq((await esra.del('/api/days/' + dayId)).status, 404);
});

done();
