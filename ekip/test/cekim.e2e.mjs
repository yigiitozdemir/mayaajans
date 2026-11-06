// Çekim Planı API testleri
// BASE=http://127.0.0.1:8803 PERSIST=.wrangler/state-cekim node test/cekim.e2e.mjs
import { loginAs, Client, t, ok, eq, done, openLive, until, runCron, sql, wait } from './lib.mjs';

// Sunucu SIMDI_SAHTE ile başlatıldıysa testler de aynı 'şimdi'yi kullanır (bildirimler Pzt–Cmt 09–18 arası gider)
const SIMDI = () => (process.env.SIMDI_SAHTE ? Date.parse(process.env.SIMDI_SAHTE) : Date.now());
const istTomorrow = () => new Date(SIMDI() + 3 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
const istToday = () => new Date(SIMDI() + 3 * 3600_000).toISOString().slice(0, 10);
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);

const yigit = await loginAs('u_yigit', 'Yiğit');
const pelin = await loginAs('u_pelin', 'Pelin');
const emre = await loginAs('u_emre', 'Emre');
const anon = new Client();
const created = [];

console.log('Çekim Planı');

await t('girişsiz erişim 401', async () => {
  eq((await anon.get('/api/shoots')).status, 401);
});

await t('Slack listesinden 29 çekim gelir, alanlar tam', async () => {
  const r = await yigit.get('/api/shoots');
  eq(r.status, 200);
  const slack = r.data.filter((s) => s.source === 'slack');
  eq(slack.length, 29, 'slack kayıt sayısı');
  const k = slack.find((s) => s.id === 's_001');
  ok(k && k.title === 'Kapaklı Programı' && k.client === 'Furkan Biçer' && k.date === '2026-11-05' && k.time === '10:00' && k.location === 'Kapaklı', 'alanlar');
  ok(Array.isArray(k.crew) && Array.isArray(k.checks), 'crew/checks dizi');
});

await t('tarihsiz çekim reddedilir (boş, yanlış biçim, olmayan gün)', async () => {
  for (const date of [undefined, '', '2026-13-01', '2026-02-30', '06.11.2026']) {
    const r = await pelin.post('/api/shoots', { title: 'Tarihsiz', date });
    eq(r.status, 400, 'tarih ' + date);
    ok(/tarih/i.test(r.data.error), 'hata mesajı Türkçe: ' + r.data.error);
  }
  eq((await pelin.post('/api/shoots', { title: '  ', date: '2026-12-01' })).status, 400, 'başlıksız');
});

let sid;
await t('ekle: varsayılan hazırlık şablonu, oluşturan, kaynak', async () => {
  const r = await pelin.post('/api/shoots', { title: 'Test Çekimi', client: 'Gizem Eczane', date: '2026-12-10', time: '10:00', location: 'Ofis', note: 'Not 1' });
  eq(r.status, 201);
  sid = r.data.id; created.push(sid);
  eq(r.data.createdBy, 'u_pelin'); eq(r.data.source, 'app'); eq(r.data.status, 0);
  eq(r.data.checks.map((c) => c.text).join('|'), 'Yedek batarya ve kart|Gimbal|Hava durumu kontrolü|Lokasyon / izin teyidi');
  ok(r.data.checks.every((c) => c.done === false), 'işaretsiz');
  const g = await emre.get('/api/shoots/' + sid);
  eq(g.data.title, 'Test Çekimi');
});

await t('ekle: özel hazırlık listesi ve serbest firma metni', async () => {
  const r = await pelin.post('/api/shoots', { title: 'Özel liste', client: 'Yeni Müşteri Ltd', date: '2026-12-11', time: 'Sabah', checks: [{ text: 'Mikrofon', done: true }, 'Işık', { text: '' }] });
  eq(r.status, 201); created.push(r.data.id);
  eq(r.data.client, 'Yeni Müşteri Ltd');
  eq(JSON.stringify(r.data.checks), JSON.stringify([{ text: 'Mikrofon', done: true }, { text: 'Işık', done: false }]));
});

await t('doğrulama: geçersiz ekip, geçersiz durum, uzun metinler kırpılır', async () => {
  eq((await pelin.post('/api/shoots', { title: 'X', date: '2026-12-12', crew: ['u_yok'] })).status, 400, 'olmayan kişi');
  eq((await pelin.post('/api/shoots', { title: 'X', date: '2026-12-12', crew: 'u_emre' })).status, 400, 'dizi değil');
  eq((await pelin.patch('/api/shoots/' + sid, { status: 5 })).status, 400, 'durum');
  eq((await pelin.patch('/api/shoots/' + sid, { date: '' })).status, 400, 'düzenlemede tarih boş olamaz');
  eq((await pelin.patch('/api/shoots/' + sid, {})).status, 400, 'boş değişiklik');
  eq((await pelin.patch('/api/shoots/s_yok', { title: 'a' })).status, 404, 'olmayan');
  const r = await pelin.post('/api/shoots', { title: 'a'.repeat(500), date: '2026-12-12', time: 't'.repeat(100) });
  eq(r.status, 201); created.push(r.data.id);
  eq(r.data.title.length, 200); eq(r.data.time.length, 40);
});

await t('ekip bildirimi: yeni eklenen kişiye "Çekim ekibine eklendin" (canlı)', async () => {
  const live = openLive(emre); await live.ready;
  const r = await pelin.patch('/api/shoots/' + sid, { crew: ['u_emre', 'u_pelin'] });
  eq(r.status, 200);
  eq(r.data.crew.join(','), 'u_emre,u_pelin');
  ok(await until(() => live.msgs.some((m) => m.type === 'notify' && m.notification.link === '/cekim?id=' + sid)), 'bildirim gelmedi: ' + JSON.stringify(live.msgs));
  const n = live.msgs.find((m) => m.type === 'notify').notification;
  eq(n.kind, 'shoot'); eq(n.title, 'Çekim ekibine eklendin'); eq(n.body, 'Test Çekimi · Gizem Eczane');
  eq(n.meta, '10 Aralık Perşembe 10:00 · Ofis'); eq(n.actorId, 'u_pelin');
  ok(await until(() => live.msgs.some((m) => m.type === 'shoots')), 'shoots yayını gelmedi');
  live.ws.close();
  // kendine bildirim gitmez
  eq(sql(`SELECT COUNT(*) AS n FROM notifications WHERE user_id='u_pelin' AND link='/cekim?id=${sid}'`)[0].n, 0, 'kendine bildirim');
});

await t('aynı ekibi tekrar kaydetmek yeni bildirim üretmez; yeni kişi eklenince yalnız ona gider', async () => {
  const before = sql(`SELECT COUNT(*) AS n FROM notifications WHERE user_id='u_emre' AND link='/cekim?id=${sid}'`)[0].n;
  await pelin.patch('/api/shoots/' + sid, { crew: ['u_emre', 'u_pelin'], note: 'Not 2' });
  eq(sql(`SELECT COUNT(*) AS n FROM notifications WHERE user_id='u_emre' AND link='/cekim?id=${sid}'`)[0].n, before, 'tekrar bildirim');
  await pelin.patch('/api/shoots/' + sid, { crew: ['u_emre', 'u_pelin', 'u_yigit'] });
  eq(sql(`SELECT COUNT(*) AS n FROM notifications WHERE user_id='u_emre' AND link='/cekim?id=${sid}'`)[0].n, before, 'emre tekrar');
  eq(sql(`SELECT COUNT(*) AS n FROM notifications WHERE user_id='u_yigit' AND link='/cekim?id=${sid}' AND title='Çekim ekibine eklendin'`)[0].n, 1, 'yiğit');
});

await t('yeni çekimde seçilen ekibe bildirim gider', async () => {
  const r = await yigit.post('/api/shoots', { title: 'Ekipli çekim', client: 'Nevvital', date: '2026-12-20', time: 'Tam gün', crew: ['u_pelin', 'u_yigit'] });
  eq(r.status, 201); created.push(r.data.id);
  const rows = sql(`SELECT user_id, kind, title, body FROM notifications WHERE link='/cekim?id=${r.data.id}'`);
  eq(rows.length, 1); eq(rows[0].user_id, 'u_pelin'); eq(rows[0].kind, 'shoot'); eq(rows[0].body, 'Ekipli çekim · Nevvital');
});

await t('tarih/saat/lokasyon değişince ekibe "Çekim güncellendi"', async () => {
  const live = openLive(emre); await live.ready;
  const r = await yigit.patch('/api/shoots/' + sid, { date: '2026-12-15', time: '14:00', location: 'Stüdyo' });
  eq(r.status, 200);
  ok(await until(() => live.msgs.some((m) => m.type === 'notify' && m.notification.title === 'Çekim güncellendi')), 'güncelleme bildirimi yok');
  const n = live.msgs.find((m) => m.type === 'notify' && m.notification.title === 'Çekim güncellendi').notification;
  eq(n.meta, '15 Aralık Salı 14:00 · Stüdyo');
  live.ws.close();
  eq(sql(`SELECT COUNT(*) AS n FROM notifications WHERE user_id='u_pelin' AND title='Çekim güncellendi' AND link='/cekim?id=${sid}'`)[0].n, 1, 'pelin');
  eq(sql(`SELECT COUNT(*) AS n FROM notifications WHERE user_id='u_yigit' AND title='Çekim güncellendi' AND link='/cekim?id=${sid}'`)[0].n, 0, 'değiştiren kendisi');
  // sadece not değişince güncelleme bildirimi yok
  await yigit.patch('/api/shoots/' + sid, { note: 'Sadece not' });
  eq(sql(`SELECT COUNT(*) AS n FROM notifications WHERE user_id='u_pelin' AND title='Çekim güncellendi' AND link='/cekim?id=${sid}'`)[0].n, 1, 'not değişikliği');
});

await t('hazırlık listesi: ekle, işaretle, yeniden adlandır, sil', async () => {
  let r = await emre.post(`/api/shoots/${sid}/checks`, { text: 'Drone izni' });
  eq(r.status, 200); eq(r.data.checks.length, 5); eq(r.data.checks[4].text, 'Drone izni');
  eq((await emre.post(`/api/shoots/${sid}/checks`, { text: '  ' })).status, 400, 'boş madde');
  r = await emre.patch(`/api/shoots/${sid}/checks/1`, { done: true });
  eq(r.data.checks[1].done, true); eq(r.data.checks[1].text, 'Gimbal');
  r = await emre.patch(`/api/shoots/${sid}/checks/4`, { text: 'Drone uçuş izni' });
  eq(r.data.checks[4].text, 'Drone uçuş izni');
  eq((await emre.patch(`/api/shoots/${sid}/checks/9`, { done: true })).status, 400, 'olmayan madde');
  r = await emre.del(`/api/shoots/${sid}/checks/0`);
  eq(r.data.checks.length, 4); eq(r.data.checks[0].text, 'Gimbal'); eq(r.data.checks[0].done, true);
  r = await emre.patch('/api/shoots/' + sid, { checks: [{ text: 'Tek madde', done: false }] });
  eq(r.data.checks.length, 1);
  eq((await emre.patch('/api/shoots/' + sid, { checks: 'x' })).status, 400, 'geçersiz liste');
});

await t('durum geçişleri: Tamamlandı → completed_at, geri alınca temizlenir, İptal', async () => {
  let r = await pelin.patch('/api/shoots/' + sid, { status: 1 });
  eq(r.data.status, 1); ok(r.data.completedAt, 'completed_at dolu');
  r = await pelin.patch('/api/shoots/' + sid, { status: 0 });
  eq(r.data.status, 0); eq(r.data.completedAt, null);
  r = await pelin.patch('/api/shoots/' + sid, { status: 2 });
  eq(r.data.status, 2); eq(r.data.completedAt, null);
  r = await pelin.patch('/api/shoots/' + sid, { status: 0 });
  eq(r.data.status, 0);
});

await t('sıralama: planlanan (tarih+saat artan) → tamamlanan (yeni üstte) → iptal', async () => {
  const a = (await pelin.post('/api/shoots', { title: 'Sıra B', date: '2027-01-05', time: '14:00' })).data;
  const b = (await pelin.post('/api/shoots', { title: 'Sıra A', date: '2027-01-05', time: 'Sabah' })).data;
  const c2 = (await pelin.post('/api/shoots', { title: 'Sıra C', date: '2027-01-04', time: '' })).data;
  created.push(a.id, b.id, c2.id);
  const list = (await pelin.get('/api/shoots')).data;
  const st = list.map((s) => s.status);
  const firstDone = st.indexOf(1), firstCancel = st.indexOf(2);
  ok(st.slice(0, firstDone).every((x) => x === 0), 'planlananlar üstte');
  ok(st.slice(firstDone, firstCancel).every((x) => x === 1), 'sonra tamamlananlar');
  ok(st.slice(firstCancel).every((x) => x === 2), 'en altta iptal');
  const planned = list.filter((s) => s.status === 0).map((s) => s.date);
  ok(planned.every((d, i) => i === 0 || planned[i - 1] <= d), 'planlanan tarih artan');
  const doneD = list.filter((s) => s.status === 1).map((s) => s.date);
  ok(doneD.every((d, i) => i === 0 || doneD[i - 1] >= d), 'tamamlanan tarih azalan');
  const ids = list.map((s) => s.id);
  ok(ids.indexOf(c2.id) < ids.indexOf(b.id) && ids.indexOf(b.id) < ids.indexOf(a.id), 'aynı gün saat sırası (Sabah < 14:00)');
  // tarihi geçmiş ama planlandı olan en üstte
  eq(list[0].id, list.filter((s) => s.status === 0).sort((x, y) => (x.date < y.date ? -1 : 1))[0].id);
});

await t('canlı yayın: başka kullanıcı ekleyince shoots olayı gelir', async () => {
  const live = openLive(yigit); await live.ready;
  const r = await emre.post('/api/shoots', { title: 'Canlı', date: '2026-12-30' });
  created.push(r.data.id);
  ok(await until(() => live.msgs.some((m) => m.type === 'shoots' && m.id === r.data.id)), 'yayın yok');
  live.msgs.length = 0;
  await emre.del('/api/shoots/' + r.data.id);
  ok(await until(() => live.msgs.some((m) => m.type === 'shoots' && m.id === r.data.id)), 'silme yayını yok');
  live.ws.close();
});

await t('sil: herkes silebilir, ikinci kez 404', async () => {
  const r = await pelin.post('/api/shoots', { title: 'Silinecek', date: '2026-12-31' });
  eq((await emre.del('/api/shoots/' + r.data.id)).status, 200);
  eq((await emre.del('/api/shoots/' + r.data.id)).status, 404);
  eq((await emre.get('/api/shoots/' + r.data.id)).status, 404);
});

await t('16:30 hatırlatması: yarınki çekim için ekibe bildirim + #çekim-planı mesajı, tekrar yok', async () => {
  const tom = istTomorrow();
  // eski kalıntılar karışmasın
  sql(`UPDATE shoots SET status = 1 WHERE date = '${tom}'`);
  const s1 = (await yigit.post('/api/shoots', { title: 'Yarınki Program', client: 'Furkan Biçer', date: tom, time: '10:00', location: 'Kapaklı', crew: ['u_pelin', 'u_emre'] })).data;
  const s2 = (await pelin.post('/api/shoots', { title: 'İptal olan', client: 'Nevvital', date: tom, status: 2, crew: ['u_emre'] })).data;
  const s3 = (await pelin.post('/api/shoots', { title: 'Öbür gün', date: addDays(tom, 1), crew: ['u_emre'] })).data;
  const s4 = (await pelin.post('/api/shoots', { title: 'Bugünkü', date: istToday(), crew: ['u_emre'] })).data;
  created.push(s1.id, s2.id, s3.id, s4.id);
  await emre.patch(`/api/shoots/${s1.id}/checks/0`, { done: true });
  const msgBefore = sql("SELECT COUNT(*) AS n FROM messages WHERE channel_id='ch_cekim'")[0].n;
  const livePelin = openLive(pelin); const liveYigit = openLive(yigit);
  await livePelin.ready; await liveYigit.ready;

  eq(await runCron('30 13 * * *'), 200, 'cron');
  ok(await until(() => livePelin.msgs.some((m) => m.type === 'notify' && m.notification.title === 'Yarın çekim var')), 'canlı bildirim yok');
  const n = livePelin.msgs.find((m) => m.type === 'notify' && m.notification.title === 'Yarın çekim var').notification;
  eq(n.kind, 'shoot'); eq(n.link, '/cekim?id=' + s1.id); eq(n.body, 'Yarınki Program · Furkan Biçer');
  ok(await until(() => liveYigit.msgs.some((m) => m.type === 'chat' && m.channelId === 'ch_cekim')), 'sohbet yayını yok');
  await wait(300);
  const remOf = (id) => sql(`SELECT user_id FROM notifications WHERE title='Yarın çekim var' AND link='/cekim?id=${id}' ORDER BY user_id`).map((x) => x.user_id).join(',');
  eq(remOf(s1.id), 'u_emre,u_pelin', 'yarınki planlanan çekimin ekibi');
  const cmt = false; // her gün yalnızca yarın (pazar dahil)
  eq(remOf(s2.id) + remOf(s4.id), '', 'iptal / bugün hatırlatılmaz');
  if (cmt) ok(sql(`SELECT title FROM notifications WHERE link='/cekim?id=${s3.id}'`).some((x) => x.title === 'Pazartesi çekim var'), 'cumartesi → pazartesi');
  else eq(remOf(s3.id), '', 'öbür gün hatırlatılmaz');
  const msgs = sql("SELECT user_id, text FROM messages WHERE channel_id='ch_cekim' ORDER BY created_at DESC");
  eq(msgs.length, msgBefore + (cmt ? 2 : 1), 'gün başına tek özet mesajı');
  const m = msgs.find((x) => x.text.startsWith('Yarınki'));
  if (cmt) ok(msgs.some((x) => x.text.startsWith('Pazartesi çekimleri – ') && x.text.includes('Öbür gün')), 'pazartesi özeti');
  eq(m.user_id, 'u_yigit', 'mesaj yazarı çekimi ekleyen');
  ok(m.text.startsWith('Yarınki çekimler – '), m.text);
  ok(m.text.includes('• 10:00 – Furkan Biçer: Yarınki Program'), m.text);
  ok(m.text.includes('Konum: Kapaklı'), m.text);
  ok(m.text.includes('Hazırlık: Gimbal, Hava durumu kontrolü, Lokasyon / izin teyidi (1/4)'), m.text);
  ok(!m.text.includes('İptal olan') && !m.text.includes('Öbür gün'), 'iptal/öbür gün yok');
  eq(sql(`SELECT reminded_for FROM shoots WHERE id='${s1.id}'`)[0].reminded_for, tom);

  // ikinci tetikleme: tekrar yok
  eq(await runCron('30 13 * * *'), 200);
  await wait(1500);
  eq(remOf(s1.id), 'u_emre,u_pelin', 'tekrar bildirim');
  eq(sql("SELECT COUNT(*) AS n FROM messages WHERE channel_id='ch_cekim'")[0].n, msgBefore + (cmt ? 2 : 1), 'tekrar mesaj');

  // tarihi başka güne alıp geri getirince yeniden hatırlatılabilir
  await yigit.patch('/api/shoots/' + s1.id, { date: addDays(tom, 2) });
  eq(sql(`SELECT reminded_for FROM shoots WHERE id='${s1.id}'`)[0].reminded_for, null, 'tarih değişince sıfırlanır');
  livePelin.ws.close(); liveYigit.ws.close();
});

await t('oluşturanı olmayan (Slack) çekimde mesaj yöneticinin adına', async () => {
  const tom = istTomorrow();
  sql(`UPDATE shoots SET date='${tom}', status=0, reminded_for=NULL WHERE id='s_002'`);
  const before = sql("SELECT COUNT(*) AS n FROM messages WHERE channel_id='ch_cekim'")[0].n;
  eq(await runCron('30 13 * * *'), 200);
  ok(await until(() => sql("SELECT COUNT(*) AS n FROM messages WHERE channel_id='ch_cekim'")[0].n === before + 1, 6000), 'mesaj yok');
  const m = sql("SELECT user_id, text FROM messages WHERE channel_id='ch_cekim' ORDER BY created_at DESC LIMIT 1")[0];
  eq(m.user_id, 'u_yigit'); ok(m.text.includes('Nevvital: Nevvital Davet'), m.text);
  sql("UPDATE shoots SET date='2026-11-08', reminded_for=NULL WHERE id='s_002'");
});

// temizlik
for (const id of created) await yigit.del('/api/shoots/' + id);
done();
