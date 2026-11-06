// Sohbet API testi. Çalıştırma: BASE=http://127.0.0.1:8804 PERSIST=.wrangler/state-sohbet node test/sohbet.e2e.mjs
import { BASE, loginAs, t, ok, eq, until, wait, openLive, sql, done, Client } from './lib.mjs';

console.log('\nSohbet');
const Y = await loginAs('u_yigit', 'Yiğit');
const P = await loginAs('u_pelin', 'Pelin');
const E = await loginAs('u_emre', 'Emre');
const lY = openLive(Y), lP = openLive(P), lE = openLive(E);
await Promise.all([lY.ready, lP.ready, lE.ready]);
const chatMsgs = (l, pred = () => true) => l.msgs.filter((m) => m.type === 'chat' && pred(m));
const unreadOf = async (c, id) => (await c.get('/api/chat/channels')).data.find((x) => x.id === id);

await t('giriş yapmadan erişilemez', async () => {
  const r = await new Client().get('/api/chat/channels');
  eq(r.status, 401);
});

await t('kanal listesi: genel + müşteri kanalları, arşivliler yok', async () => {
  const r = await P.get('/api/chat/channels');
  eq(r.status, 200);
  const ids = r.data.map((c) => c.id);
  for (const id of ['ch_genel', 'ch_onay', 'ch_cekim', 'ch_ozel']) ok(ids.includes(id), id + ' yok');
  ok(r.data.filter((c) => c.kind === 'client').length > 10, 'müşteri kanalları az');
  const cl = r.data.find((c) => c.kind === 'client');
  ok(cl.clientId && cl.topic, 'müşteri kanalı bilgisi eksik');
  sql(`UPDATE channels SET archived = 1 WHERE id = '${cl.id}'`);
  const r2 = await P.get('/api/chat/channels');
  ok(!r2.data.some((c) => c.id === cl.id), 'arşivli kanal listede');
  const w = await P.post(`/api/chat/channels/${cl.id}/messages`, { text: 'merhaba' });
  eq(w.status, 400, 'arşivli kanala yazılmamalı');
  sql(`UPDATE channels SET archived = 0 WHERE id = '${cl.id}'`);
});

let m1;
await t('mesaj gönder → herkese canlı düşer (iki kullanıcı)', async () => {
  const r = await Y.post('/api/chat/channels/ch_genel/messages', { text: '  Günaydın ekip\nyeni hafta  ' });
  eq(r.status, 201);
  m1 = r.data;
  eq(m1.text, 'Günaydın ekip\nyeni hafta');
  eq(m1.userId, 'u_yigit');
  ok(/Z$/.test(m1.createdAt), 'ISO zaman yok');
  ok(await until(() => chatMsgs(lP, (m) => m.message?.id === m1.id && m.action === 'new').length === 1), 'Pelin canlı almadı');
  ok(await until(() => chatMsgs(lE, (m) => m.message?.id === m1.id).length === 1), 'Emre canlı almadı');
  const g = await P.get('/api/chat/channels/ch_genel/messages');
  eq(g.status, 200);
  ok(g.data.messages.some((m) => m.id === m1.id), 'listede yok');
});

await t('her mesaj için zil bildirimi oluşmaz', async () => {
  const n = await P.get('/api/notifications');
  ok(!n.data.some((x) => x.kind === 'chat'), 'chat bildirimi oluşmuş');
  ok(!lP.msgs.some((m) => m.type === 'notify'), 'notify yayını gelmiş');
});

await t('boş mesaj reddedilir', async () => {
  eq((await P.post('/api/chat/channels/ch_genel/messages', { text: '   \n ' })).status, 400);
  eq((await P.post('/api/chat/channels/ch_genel/messages', {})).status, 400);
  eq((await P.post('/api/chat/channels/ch_genel/messages', { text: 42 })).status, 400);
});

await t('uzunluk sınırı (4000)', async () => {
  eq((await P.post('/api/chat/channels/ch_genel/messages', { text: 'a'.repeat(4001) })).status, 400);
  eq((await P.post('/api/chat/channels/ch_genel/messages', { text: 'a'.repeat(4000) })).status, 201);
});

await t('olmayan kanal 404', async () => {
  eq((await P.get('/api/chat/channels/ch_yok/messages')).status, 404);
  eq((await P.post('/api/chat/channels/ch_yok/messages', { text: 'x' })).status, 404);
});

await t('düzenle: yalnızca sahibi, canlı yayın', async () => {
  eq((await P.patch('/api/chat/messages/' + m1.id, { text: 'hack' })).status, 403);
  const r = await Y.patch('/api/chat/messages/' + m1.id, { text: 'Günaydın ekip (düzeltildi)' });
  eq(r.status, 200);
  eq(r.data.text, 'Günaydın ekip (düzeltildi)');
  ok(r.data.editedAt, 'editedAt yok');
  ok(await until(() => chatMsgs(lP, (m) => m.action === 'edit' && m.message?.id === m1.id).length === 1), 'düzenleme canlı gelmedi');
  eq((await Y.patch('/api/chat/messages/' + m1.id, { text: '' })).status, 400, 'boş düzenleme');
  eq((await Y.patch('/api/chat/messages/' + m1.id, { text: 'b'.repeat(4001) })).status, 400, 'uzun düzenleme');
});

await t('sil: yalnızca sahibi, "silindi" olarak kalır', async () => {
  const r = await P.post('/api/chat/channels/ch_genel/messages', { text: 'silinecek' });
  eq((await Y.del('/api/chat/messages/' + r.data.id)).status, 403, 'yönetici de başkasının mesajını silemez');
  eq((await P.del('/api/chat/messages/' + r.data.id)).status, 200);
  ok(await until(() => chatMsgs(lY, (m) => m.action === 'delete' && m.message?.id === r.data.id).length === 1), 'silme canlı gelmedi');
  const g = await Y.get('/api/chat/channels/ch_genel/messages');
  const m = g.data.messages.find((x) => x.id === r.data.id);
  ok(m && m.deleted && m.text === '', 'silindi gösterimi yok');
  eq((await P.patch('/api/chat/messages/' + r.data.id, { text: 'geri' })).status, 400, 'silineni düzenleme');
});

let dm;
await t('DM: aç (idempotent), yalnızca iki üye görür', async () => {
  const r = await Y.post('/api/chat/dm', { userId: 'u_pelin' });
  eq(r.status, 200);
  dm = r.data;
  eq(dm.kind, 'dm'); eq(dm.dmWith, 'u_pelin');
  const r2 = await P.post('/api/chat/dm', { userId: 'u_yigit' });
  eq(r2.data.id, dm.id, 'aynı kanal değil');
  eq(r2.data.dmWith, 'u_yigit');
  eq((await Y.post('/api/chat/dm', { userId: 'u_yigit' })).status, 400, 'kendine');
  eq((await Y.post('/api/chat/dm', { userId: 'u_yok' })).status, 404, 'olmayan kişi');
  eq((await Y.post('/api/chat/dm', {})).status, 400);
  ok((await P.get('/api/chat/channels')).data.some((c) => c.id === dm.id), 'Pelin listesinde yok');
  ok(!(await E.get('/api/chat/channels')).data.some((c) => c.id === dm.id), 'Emre listesinde var');
});

let dmMsg;
await t('DM gizliliği: üçüncü kişi okuyamaz/yazamaz (403), canlı yayın ona gitmez', async () => {
  const before = lE.msgs.length;
  const r = await Y.post(`/api/chat/channels/${dm.id}/messages`, { text: 'Pelin, gizli konu' });
  eq(r.status, 201); dmMsg = r.data;
  ok(await until(() => chatMsgs(lP, (m) => m.message?.id === dmMsg.id).length === 1), 'Pelin almadı');
  ok(await until(() => chatMsgs(lY, (m) => m.message?.id === dmMsg.id).length === 1), 'Yiğit (gönderen) almadı');
  await wait(600);
  ok(!lE.msgs.slice(before).some((m) => m.channelId === dm.id), 'Emre yayını aldı');
  eq((await E.get(`/api/chat/channels/${dm.id}/messages`)).status, 403);
  eq((await E.post(`/api/chat/channels/${dm.id}/messages`, { text: 'ben de' })).status, 403);
  eq((await E.post('/api/chat/read', { channelId: dm.id })).status, 403);
  eq((await E.patch('/api/chat/messages/' + dmMsg.id, { text: 'x' })).status, 403);
  eq((await E.del('/api/chat/messages/' + dmMsg.id)).status, 403);
  eq((await P.get(`/api/chat/channels/${dm.id}/messages`)).status, 200);
});

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
const form = (bytes, name, type, text = '') => { const f = new FormData(); f.append('file', new Blob([bytes], { type }), name); if (text) f.append('text', text); return f; };

let fileMsg;
await t('dosya yükle (görsel) → R2 anahtarı ve indirme', async () => {
  const r = await P.post('/api/chat/channels/ch_onay/messages', form(png, 'Taslak görsel ş.png', 'image/png', 'onaya hazır'));
  eq(r.status, 201, JSON.stringify(r.data));
  fileMsg = r.data;
  eq(fileMsg.text, 'onaya hazır');
  eq(fileMsg.file.name, 'Taslak görsel ş.png');
  eq(fileMsg.file.size, png.length);
  const key = sql(`SELECT file_key FROM messages WHERE id = '${fileMsg.id}'`)[0].file_key;
  eq(key, `chat/ch_onay/${fileMsg.id}/Taslak_gorsel_s.png`);
  const d = await Y.get(fileMsg.file.url);
  eq(d.status, 200);
  eq(d.headers.get('content-type'), 'image/png');
  ok(d.headers.get('content-disposition').startsWith('inline'), 'görsel satır içi değil');
  eq(Buffer.from(d.data).compare(png), 0, 'içerik farklı');
  const dl = await Y.get(fileMsg.file.url + '?download=1');
  ok(dl.headers.get('content-disposition').startsWith('attachment'), 'indirme attachment değil');
  eq((await new Client().get(fileMsg.file.url)).status, 401);
});

await t('SVG/HTML satır içi gösterilmez (attachment)', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
  const r = await P.post('/api/chat/channels/ch_genel/messages', form(svg, 'logo.svg', 'image/svg+xml'));
  eq(r.status, 201);
  const d = await Y.get(r.data.file.url);
  eq(d.status, 200);
  ok(d.headers.get('content-disposition').startsWith('attachment'), 'svg inline');
  eq(d.headers.get('content-type'), 'application/octet-stream');
  eq(d.headers.get('x-content-type-options'), 'nosniff');
  const h = await P.post('/api/chat/channels/ch_genel/messages', form('<h1>x</h1>', '../../kötü.html', 'text/html'));
  eq(h.status, 201);
  const key = sql(`SELECT file_key FROM messages WHERE id = '${h.data.id}'`)[0].file_key;
  eq(key, `chat/ch_genel/${h.data.id}/kotu.html`);
  ok((await Y.get(h.data.file.url)).headers.get('content-disposition').startsWith('attachment'), 'html inline');
});

await t('dosya en fazla 25 MB', async () => {
  const big = new Uint8Array(25 * 1024 * 1024 + 10);
  const r = await P.post('/api/chat/channels/ch_genel/messages', form(big, 'buyuk.mov', 'video/quicktime'));
  eq(r.status, 413);
});

await t('DM dosya gizliliği: üçüncü kişi indiremez', async () => {
  const r = await P.post(`/api/chat/channels/${dm.id}/messages`, form('gizli sözleşme', 'sozlesme.pdf', 'application/pdf'));
  eq(r.status, 201);
  eq((await E.get(r.data.file.url)).status, 403);
  const y = await Y.get(r.data.file.url);
  eq(y.status, 200);
  eq(Buffer.from(y.data).toString(), 'gizli sözleşme');
  ok(y.headers.get('content-disposition').startsWith('attachment'), 'pdf attachment değil');
});

await t('silinen dosyalı mesajın dosyası artık inmez', async () => {
  const r = await P.post('/api/chat/channels/ch_genel/messages', form(png, 'a.png', 'image/png'));
  eq((await P.del('/api/chat/messages/' + r.data.id)).status, 200);
  eq((await P.get(r.data.file.url)).status, 404);
});

await t('sayfalama: son 50, before imleciyle öncekiler', async () => {
  const ch = 'ch_ozel';
  sql(`DELETE FROM messages WHERE channel_id = '${ch}'`);
  const run = Math.random().toString(36).slice(2, 8);
  const vals = [];
  for (let i = 0; i < 120; i++) vals.push(`('m_pg${run}${String(i).padStart(3, '0')}', '${ch}', 'u_emre', 'mesaj ${i}', strftime('%Y-%m-%d %H:%M:%f', 'now', '-${200 - i} seconds'))`);
  sql(`INSERT INTO messages (id, channel_id, user_id, text, created_at) VALUES ${vals.join(',')}`);
  const a = await P.get(`/api/chat/channels/${ch}/messages`);
  eq(a.data.messages.length, 50); eq(a.data.hasMore, true);
  eq(a.data.messages[0].text, 'mesaj 70'); eq(a.data.messages[49].text, 'mesaj 119');
  const b = await P.get(`/api/chat/channels/${ch}/messages?before=${a.data.messages[0].id}`);
  eq(b.data.messages.length, 50); eq(b.data.hasMore, true);
  eq(b.data.messages[0].text, 'mesaj 20'); eq(b.data.messages[49].text, 'mesaj 69');
  const c = await P.get(`/api/chat/channels/${ch}/messages?before=${b.data.messages[0].id}`);
  eq(c.data.messages.length, 20); eq(c.data.hasMore, false);
  eq(c.data.messages[0].text, 'mesaj 0');
  eq((await P.get(`/api/chat/channels/${ch}/messages?before=m_yok`)).status, 400);
  eq((await P.get(`/api/chat/channels/ch_genel/messages?before=m_pg${run}010`)).status, 400, 'başka kanalın imleci');
});

await t('okunmamış sayıları, bahsetme ve read', async () => {
  await P.post('/api/chat/read', { channelId: 'ch_cekim' });
  await E.post('/api/chat/read', { channelId: 'ch_cekim' });
  let p = await unreadOf(P, 'ch_cekim');
  eq(p.unread, 0); eq(p.mentions, 0);
  await Y.post('/api/chat/channels/ch_cekim/messages', { text: 'yarın çekim var' });
  await Y.post('/api/chat/channels/ch_cekim/messages', { text: '@pelin batarya sende mi?' });
  await Y.post('/api/chat/channels/ch_cekim/messages', { text: '@herkes 9:30 ofiste' });
  p = await unreadOf(P, 'ch_cekim');
  eq(p.unread, 3, 'unread'); eq(p.mentions, 2, 'mentions');
  ok(p.lastAt, 'lastAt yok');
  const e = await unreadOf(E, 'ch_cekim');
  eq(e.unread, 3); eq(e.mentions, 1, 'Emre yalnızca @herkes');
  const y = await unreadOf(Y, 'ch_cekim');
  eq(y.unread, 0, 'kendi mesajı okunmamış sayılmaz');
  eq((await P.post('/api/chat/read', { channelId: 'ch_cekim' })).status, 200);
  ok(await until(() => chatMsgs(lP, (m) => m.action === 'read' && m.channelId === 'ch_cekim').length > 0), 'read yayını kendine gelmedi');
  p = await unreadOf(P, 'ch_cekim');
  eq(p.unread, 0); eq(p.mentions, 0);
  eq((await unreadOf(E, 'ch_cekim')).unread, 3, 'Emre etkilenmemeli');
  eq((await P.post('/api/chat/read', {})).status, 400);
  eq((await P.post('/api/chat/read', { channelId: 'ch_yok' })).status, 404);
  // DM okunmamış
  // DM: Pelin'in dosyası Yiğit için okunmamış; Pelin kendi yazdığı için okumuş sayılır
  eq((await unreadOf(Y, dm.id)).unread, 1, 'Yiğit DM okunmamış');
  eq((await unreadOf(P, dm.id)).unread, 0, 'Pelin DM okunmamış');
});

await t('başka sitenin isteği reddedilir', async () => {
  const r = await P.req('POST', '/api/chat/channels/ch_genel/messages', { text: 'x' }, { Origin: 'https://kotu.example' });
  eq(r.status, 403);
});

for (const l of [lY, lP, lE]) l.ws.close();
void BASE;
done();
