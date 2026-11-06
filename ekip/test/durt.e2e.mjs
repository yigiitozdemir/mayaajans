// Dürtme API testi. Kullanım: BASE=http://127.0.0.1:8805 PERSIST=.wrangler/state-durt node test/durt.e2e.mjs
import { loginAs, openLive, t, ok, eq, until, wait, sql, done } from './lib.mjs';

const pelin = await loginAs('u_pelin', 'Pelin');
const emre = await loginAs('u_emre', 'Emre');
const ilayda = await loginAs('u_ilayda', 'İlayda');
// temiz başlangıç
sql("DELETE FROM nudges; DELETE FROM notifications WHERE kind = 'nudge'; UPDATE users SET settings = '{}' WHERE id IN ('u_pelin','u_emre','u_ilayda')");

const livePelin = openLive(pelin);
const liveEmre = openLive(emre);
await Promise.all([livePelin.ready, liveEmre.ready]);
await wait(200);

console.log('\nDürtme gönderme');
let firstId;
await t('Pelin → Emre dürtme (mesajlı) 201', async () => {
  const r = await pelin.post('/api/nudge', { to: 'u_emre', message: '  Bakar mısın? 👀  ' });
  eq(r.status, 201, JSON.stringify(r.data));
  eq(r.data.ok, true); ok(r.data.id, 'id yok'); ok(!r.data.dnd, 'dnd olmamalı'); eq(r.data.wait, 15);
  firstId = r.data.id;
});
await t('hedef canlı "nudge" alır (gönderen, mesaj, zaman)', async () => {
  ok(await until(() => liveEmre.msgs.some((m) => m.type === 'nudge')), 'nudge gelmedi');
  const m = liveEmre.msgs.find((x) => x.type === 'nudge');
  eq(m.nudge.id, firstId); eq(m.nudge.fromId, 'u_pelin'); eq(m.nudge.message, 'Bakar mısın? 👀'); ok(/^\d{4}-\d\d-\d\dT/.test(m.nudge.at), 'at ' + m.nudge.at);
});
await t('hedef canlı "notify" (kind nudge, başlık, bağlantı) alır', async () => {
  ok(await until(() => liveEmre.msgs.some((m) => m.type === 'notify' && m.notification.kind === 'nudge')), 'notify gelmedi');
  const n = liveEmre.msgs.find((m) => m.type === 'notify').notification;
  eq(n.title, 'Pelin seni dürttü'); eq(n.body, 'Bakar mısın? 👀'); eq(n.link, '/durt'); eq(n.actorId, 'u_pelin');
});
await t('gönderen ne nudge ne notify alır', async () => {
  await wait(400);
  ok(!livePelin.msgs.some((m) => m.type === 'nudge' || m.type === 'notify'), JSON.stringify(livePelin.msgs));
});
await t('zil kaydı veritabanında (Emre)', async () => {
  const r = await emre.get('/api/notifications');
  ok(r.data.some((n) => n.kind === 'nudge' && n.title === 'Pelin seni dürttü' && !n.readAt), 'zilde yok');
});
await t('mesajsız dürtme: zil gövdesi 👋', async () => {
  const before = liveEmre.msgs.length;
  const r = await ilayda.post('/api/nudge', { to: 'u_emre' });
  eq(r.status, 201);
  ok(await until(() => liveEmre.msgs.slice(before).some((m) => m.type === 'notify' && m.notification.body === '👋')), 'gövde 👋 değil');
  ok(liveEmre.msgs.slice(before).some((m) => m.type === 'nudge' && m.nudge.message === '' && m.nudge.fromId === 'u_ilayda'), 'nudge mesajı boş değil');
});

console.log('\nKurallar');
await t('15 sn kuralı: aynı kişiye hemen tekrar → 429 + kalan saniye', async () => {
  const r = await pelin.post('/api/nudge', { to: 'u_emre' });
  eq(r.status, 429);
  ok(r.data.wait >= 1 && r.data.wait <= 15, 'wait ' + r.data.wait);
  ok(/saniye/.test(r.data.error), r.data.error);
  ok(r.headers.get('retry-after'), 'Retry-After yok');
});
await t('bekleme kişiye özel: Pelin → İlayda serbest', async () => {
  const r = await pelin.post('/api/nudge', { to: 'u_ilayda', message: 'Çay? ☕' });
  eq(r.status, 201);
});
await t('bekleme yöne özel: Emre → Pelin serbest', async () => {
  const r = await emre.post('/api/nudge', { to: 'u_pelin' });
  eq(r.status, 201);
});
await t('15 sn dolunca tekrar dürtülebilir', async () => {
  sql("UPDATE nudges SET created_at = strftime('%Y-%m-%d %H:%M:%f', 'now', '-16 seconds') WHERE from_id = 'u_pelin' AND to_id = 'u_emre'");
  const r = await pelin.post('/api/nudge', { to: 'u_emre', message: 'Toplantı başlıyor' });
  eq(r.status, 201, JSON.stringify(r.data));
});
await t('kendini dürtemezsin → 400', async () => {
  const r = await pelin.post('/api/nudge', { to: 'u_pelin' });
  eq(r.status, 400); eq(r.data.error, 'Kendini dürtemezsin');
});
await t('hedef yok → 400', async () => {
  eq((await pelin.post('/api/nudge', {})).status, 400);
});
await t('olmayan kişi → 404', async () => {
  eq((await pelin.post('/api/nudge', { to: 'u_yok' })).status, 404);
});
const volkanStatus = sql("SELECT status FROM users WHERE id = 'u_volkan'")[0]?.status || 'pending';
await t('aktif olmayan (bekleyen) kişi → 404', async () => {
  sql("UPDATE users SET status = 'pending' WHERE id = 'u_volkan'");
  const r = await pelin.post('/api/nudge', { to: 'u_volkan' });
  eq(r.status, 404);
});
await t('mesaj 80 karakter → kabul, 81 → 400', async () => {
  const r81 = await ilayda.post('/api/nudge', { to: 'u_pelin', message: 'x'.repeat(81) });
  eq(r81.status, 400); ok(/80/.test(r81.data.error), r81.data.error);
  const r80 = await ilayda.post('/api/nudge', { to: 'u_pelin', message: 'y'.repeat(80) });
  eq(r80.status, 201, JSON.stringify(r80.data));
});
await t('mesaj metin değilse → 400', async () => {
  eq((await emre.post('/api/nudge', { to: 'u_ilayda', message: 42 })).status, 400);
});
await t('giriş yapmadan → 401', async () => {
  const { Client } = await import('./lib.mjs');
  eq((await new Client().post('/api/nudge', { to: 'u_emre' })).status, 401);
});

console.log('\nRahatsız etme');
await t('ayarlar PATCH /api/me ile kaydedilir', async () => {
  const r = await emre.patch('/api/me', { settings: { dnd: true, nudgeSound: false, nudgeShake: false, nudgeMac: false } });
  eq(r.status, 200);
  const me = (await emre.get('/api/me')).data;
  eq(me.settings.dnd, true); eq(me.settings.nudgeSound, false); eq(me.settings.nudgeShake, false); eq(me.settings.nudgeMac, false);
});
await t('dnd açık hedef: { ok, dnd:true }, yine kaydedilir ve zil kaydı oluşur', async () => {
  sql("UPDATE nudges SET created_at = strftime('%Y-%m-%d %H:%M:%f', 'now', '-20 seconds')");
  const before = liveEmre.msgs.length;
  const r = await ilayda.post('/api/nudge', { to: 'u_emre', message: 'Onay bekliyorum' });
  eq(r.status, 201); eq(r.data.ok, true); eq(r.data.dnd, true);
  ok(sql(`SELECT id FROM nudges WHERE id = '${r.data.id}'`).length === 1, 'kayıt yok');
  ok(await until(() => liveEmre.msgs.slice(before).some((m) => m.type === 'notify' && m.notification.kind === 'nudge')), 'zil yayını yok');
});
await t('dnd kapanınca yanıtta dnd yok', async () => {
  await emre.patch('/api/me', { settings: { dnd: false } });
  sql("UPDATE nudges SET created_at = strftime('%Y-%m-%d %H:%M:%f', 'now', '-20 seconds')");
  const r = await ilayda.post('/api/nudge', { to: 'u_emre' });
  eq(r.status, 201); ok(!('dnd' in r.data), JSON.stringify(r.data));
});

console.log('\nGeçmiş');
await t('GET /api/nudge/log: gelen + giden, yeniden eskiye', async () => {
  const r = await emre.get('/api/nudge/log');
  eq(r.status, 200);
  const l = r.data;
  ok(l.some((x) => x.dir === 'in' && x.fromId === 'u_pelin' && x.message === 'Bakar mısın? 👀'), 'gelen yok');
  ok(l.some((x) => x.dir === 'out' && x.toId === 'u_pelin'), 'giden yok');
  ok(l.every((x) => x.fromId === 'u_emre' || x.toId === 'u_emre'), 'başkasının dürtmesi sızdı');
  for (let i = 1; i < l.length; i++) ok(l[i - 1].at >= l[i].at, 'sıra bozuk');
  ok(l.every((x) => /Z$/.test(x.at)), 'ISO değil');
});
await t('log en fazla 30 kayıt', async () => {
  const vals = Array.from({ length: 35 }, (_, i) => `('nd_bulk${i}', 'u_ilayda', 'u_pelin', 'eski ${i}', strftime('%Y-%m-%d %H:%M:%f', 'now', '-${i + 60} minutes'))`).join(',');
  sql(`INSERT INTO nudges (id, from_id, to_id, message, created_at) VALUES ${vals}`);
  const r = await pelin.get('/api/nudge/log');
  eq(r.data.length, 30);
});
await t('İlayda Pelin↔Emre arasını görmez', async () => {
  const r = await ilayda.get('/api/nudge/log');
  ok(!r.data.some((x) => x.fromId === 'u_pelin' && x.toId === 'u_emre'), 'sızıntı');
});
await t('GET /api/online çevrimiçi id dizisi', async () => {
  const r = await pelin.get('/api/online');
  ok(Array.isArray(r.data) && r.data.includes('u_pelin') && r.data.includes('u_emre'), JSON.stringify(r.data));
});

sql(`UPDATE users SET status = '${volkanStatus}' WHERE id = 'u_volkan'`);
livePelin.ws.close(); liveEmre.ws.close();
done();
