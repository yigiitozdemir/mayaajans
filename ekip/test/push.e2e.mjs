// Web Push uçtan uca: abonelik API'si + sahte push servisi üzerinden VAPID imzası ve RFC 8291 şifre çözme.
// Çalıştırma: BASE=http://127.0.0.1:8822 PERSIST=.wrangler/state-push node test/push.e2e.mjs
// (.dev.vars: VAPID_PRIVATE=… ve PUSH_ALLOW_LOCAL=1 gerekli)
import http from 'node:http';
import { createECDH, createHmac, createDecipheriv, createPublicKey, verify, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { BASE, loginAs, Client, t, ok, eq, until, sql, runCron, done } from './lib.mjs';

const b64u = (b) => Buffer.from(b).toString('base64url');
const VAPID_PUBLIC = /"VAPID_PUBLIC":\s*"([^"]+)"/.exec(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'))[1];

// ---------- sahte push servisi ----------
const got = [];
let reply = 201;
const srv = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => { got.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(reply); res.end(); });
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const PORT = srv.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;

// ---------- alıcı (tarayıcı) anahtarları ----------
function receiver() {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
}
const hm = (k, d) => createHmac('sha256', k).update(d).digest();
/** RFC 8291 / 8188 çözme */
function decrypt(rcv, body) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  ok(rs === 4096, 'rs 4096 olmalı: ' + rs);
  ok(idlen === 65 && asPub[0] === 4, 'keyid sunucu açık anahtarı olmalı');
  ok(ct.length <= rs, 'tek kayıt');
  const uaPub = rcv.ecdh.getPublicKey();
  const secret = rcv.ecdh.computeSecret(asPub);
  const prkKey = hm(rcv.auth, secret);
  const ikm = hm(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub, Buffer.from([1])])).subarray(0, 32);
  const prk = hm(salt, ikm);
  const cek = hm(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hm(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  let pt = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  let i = pt.length - 1; while (i >= 0 && pt[i] === 0) i--;
  ok(pt[i] === 2, 'son kayıt ayırıcısı 0x02 olmalı');
  return JSON.parse(pt.subarray(0, i).toString('utf8'));
}
/** Authorization: vapid t=…, k=… doğrula */
function checkVapid(h) {
  const m = /^vapid t=([^,\s]+),\s*k=([A-Za-z0-9_-]+)$/.exec(h.authorization || '');
  ok(m, 'vapid başlığı: ' + h.authorization);
  eq(m[2], VAPID_PUBLIC, 'k');
  const [hd, cl, sg] = m[1].split('.');
  const header = JSON.parse(Buffer.from(hd, 'base64url'));
  eq(header.alg, 'ES256'); eq(header.typ, 'JWT');
  const claims = JSON.parse(Buffer.from(cl, 'base64url'));
  eq(claims.aud, ORIGIN, 'aud');
  eq(claims.sub, 'https://ekip.mayaajans.net', 'sub');
  const now = Date.now() / 1000;
  ok(claims.exp > now && claims.exp <= now + 24 * 3600, 'exp 24 saatten kısa olmalı');
  const pk = Buffer.from(VAPID_PUBLIC, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pk.subarray(1, 33)), y: b64u(pk.subarray(33)) }, format: 'jwk' });
  ok(verify('sha256', Buffer.from(hd + '.' + cl), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sg, 'base64url')), 'JWT imzası doğrulanmalı');
  return claims;
}
async function nextPush(path, ms = 6000) {
  const start = got.length;
  return async () => {
    const found = await until(() => got.slice(start).some((g) => g.url === path), ms);
    ok(found, 'push isteği gelmedi: ' + path);
    return got.slice(start).find((g) => g.url === path);
  };
}

sql("DELETE FROM push_subscriptions");
const yigit = await loginAs('u_yigit', 'Yiğit');
const pelin = await loginAs('u_pelin', 'Pelin');
const emre = await loginAs('u_emre', 'Emre');
sql(`UPDATE users SET settings = '{"quietHours":false}' WHERE id = 'u_pelin'`);
const rp = receiver(), re = receiver();
const subP = { endpoint: `${ORIGIN}/push/pelin`, keys: rp.keys };
const subE = { endpoint: `${ORIGIN}/push/emre`, keys: re.keys };

console.log('Push API');
await t('girişsiz erişim 401', async () => {
  const c = new Client();
  eq((await c.get('/api/push/key')).status, 401);
  eq((await c.post('/api/push/subscribe', { subscription: subP })).status, 401);
});
await t('GET /key açık anahtarı ve hazır durumunu verir', async () => {
  const r = await pelin.get('/api/push/key');
  eq(r.status, 200); eq(r.data.key, VAPID_PUBLIC); eq(r.data.ready, true); eq(r.data.devices.length, 0);
});
await t('subscribe doğrulama: bilinmeyen sunucu, bozuk anahtar', async () => {
  eq((await pelin.post('/api/push/subscribe', { subscription: { endpoint: 'https://kotu.example.com/x', keys: rp.keys } })).status, 400);
  eq((await pelin.post('/api/push/subscribe', { subscription: { endpoint: 'http://10.0.0.1/x', keys: rp.keys } })).status, 400);
  eq((await pelin.post('/api/push/subscribe', { subscription: { endpoint: subP.endpoint, keys: { p256dh: 'abc', auth: rp.keys.auth } } })).status, 400);
  eq((await pelin.post('/api/push/subscribe', { subscription: { endpoint: subP.endpoint, keys: { p256dh: rp.keys.p256dh, auth: b64u(randomBytes(8)) } } })).status, 400);
  eq((await pelin.post('/api/push/subscribe', {})).status, 400);
});
await t('Apple/Google uç noktaları kabul edilir (ve sonra silinir)', async () => {
  const r = await emre.post('/api/push/subscribe', { subscription: { endpoint: 'https://web.push.apple.com/QAbc', keys: re.keys }, device: 'iPhone' });
  eq(r.status, 200);
  eq((await emre.post('/api/push/unsubscribe', { endpoint: 'https://web.push.apple.com/QAbc' })).status, 200);
  eq(sql("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 'u_emre'")[0].n, 0);
});
await t('subscribe kaydeder; cihaz adı listede', async () => {
  eq((await pelin.post('/api/push/subscribe', { subscription: subP, device: 'iPhone' })).status, 200);
  eq((await emre.post('/api/push/subscribe', { subscription: subE, device: 'Chrome · Mac' })).status, 200);
  const r = await pelin.get('/api/push/key');
  eq(r.data.devices.length, 1); eq(r.data.devices[0].device, 'iPhone');
  // aynı uç nokta tekrar → kopya oluşmaz
  eq((await pelin.post('/api/push/subscribe', { subscription: subP, device: 'iPhone' })).status, 200);
  eq(sql("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 'u_pelin'")[0].n, 1);
});

console.log('Gönderim (sahte push servisi)');
await t('deneme bildirimi: VAPID imzası, başlıklar, şifre çözme', async () => {
  const wait = await nextPush('/push/pelin');
  const r = await pelin.post('/api/push/test');
  eq(r.status, 200, JSON.stringify(r.data)); eq(r.data.delivered, 1);
  const g = await wait();
  eq(g.method, 'POST');
  checkVapid(g.headers);
  eq(g.headers['content-encoding'], 'aes128gcm');
  eq(g.headers['ttl'], '86400');
  eq(g.headers['urgency'], 'normal');
  const p = decrypt(rp, g.body);
  eq(p.title, 'Deneme bildirimi'); ok(p.body.includes('Pelin'), p.body); eq(p.link, '/'); eq(p.tag, 'test');
  ok(g.body.length < 3200, 'payload ≤ 3KB');
  ok(sql("SELECT last_ok_at FROM push_subscriptions WHERE user_id = 'u_pelin'")[0].last_ok_at, 'last_ok_at yazılmalı');
});
await t('aboneliği olmayan kişi deneme → 404', async () => {
  eq((await yigit.post('/api/push/test')).status, 404);
});
let assignTask = '';
await t('iş ataması telefona düşer (assign)', async () => {
  const wait = await nextPush('/push/pelin');
  const r = await yigit.post('/api/tasks', { title: 'Gizem Eczane reels kurgusu', client: 'Gizem Eczane', dueDate: '2026-12-01', assigneeId: 'u_pelin' });
  ok(r.status < 300, JSON.stringify(r.data));
  const g = await wait();
  checkVapid(g.headers);
  const p = decrypt(rp, g.body);
  assignTask = r.data.id;
  eq(p.title, 'Sana yeni iş atandı'); eq(p.body, 'Gizem Eczane reels kurgusu · Gizem Eczane'); eq(p.link, '/isler?is=' + r.data.id); eq(p.tag, 'assign');
});
await t('notify() ile giden dürtme: Urgency high, doğru içerik', async () => {
  const wait = await nextPush('/push/pelin');
  const r = await emre.post('/api/nudge', { to: 'u_pelin', message: 'Bakar mısın?' });
  ok(r.status < 300, JSON.stringify(r.data));
  const g = await wait();
  eq(g.headers['urgency'], 'high');
  const p = decrypt(rp, g.body);
  ok(/dürttü/.test(p.title), p.title); eq(p.body, 'Bakar mısın?'); eq(p.link, '/durt'); eq(p.tag, 'nudge');
});
await t('kendine dürtme/atama push göndermez; başkasının cihazına gitmez', async () => {
  const start = got.length;
  await pelin.post('/api/tasks', { title: 'Kendime iş', dueDate: '2026-12-02', assigneeId: 'u_pelin' });
  await new Promise((r) => setTimeout(r, 1200));
  eq(got.slice(start).length, 0);
});
await t('saatlik hatırlatma push (remind)', async () => {
  // yalnızca bir okunmamış atama kalsın (yoksa birden çok hatırlatma sonraki testlere karışır)
  sql(`UPDATE notifications SET read_at = datetime('now') WHERE user_id = 'u_pelin' AND kind = 'assign' AND task_id != '${assignTask}'`);
  sql(`UPDATE notifications SET created_at = datetime('now', '-2 hours'), last_reminded_at = NULL WHERE user_id = 'u_pelin' AND kind = 'assign' AND task_id = '${assignTask}'`);
  const wait = await nextPush('/push/pelin', 10000);
  // (runCron'un explorer ucu bu wrangler sürümünde bazen çalışmıyor; --test-scheduled ucunu da dene)
  const n0 = got.length;
  await runCron('5 * * * *');
  if (!(await until(() => got.length > n0, 1500))) eq((await fetch(BASE + '/__scheduled?cron=' + encodeURIComponent('5 * * * *'))).status, 200, 'cron');
  const g = await wait();
  const p = decrypt(rp, g.body);
  eq(p.title, 'Hatırlatma: bu iş seni bekliyor'); eq(p.tag, 'remind'); eq(p.link, '/isler?is=' + assignTask);
  eq(p.body, 'Gizem Eczane reels kurgusu');
});
await t('uzun içerik 3KB altında kalır', async () => {
  const wait = await nextPush('/push/pelin');
  const r = await yigit.post('/api/tasks', { title: 'Ç'.repeat(300), dueDate: '2026-12-03', assigneeId: 'u_pelin' });
  ok(r.status < 300);
  const g = await wait();
  ok(g.body.length <= 3100, 'gövde ' + g.body.length);
  const p = decrypt(rp, g.body);
  ok(p.body.startsWith('ÇÇÇ'), 'içerik');
});

console.log('Hata durumları');
await t('500 → fail_count artar, abonelik kalır', async () => {
  reply = 500;
  const r = await pelin.post('/api/push/test');
  eq(r.status, 502);
  eq(sql("SELECT fail_count FROM push_subscriptions WHERE user_id = 'u_pelin'")[0].fail_count, 1);
  reply = 201;
  eq((await pelin.post('/api/push/test')).status, 200);
  eq(sql("SELECT fail_count FROM push_subscriptions WHERE user_id = 'u_pelin'")[0].fail_count, 0, 'başarıda sıfırlanır');
});
await t('410 → abonelik silinir', async () => {
  reply = 410;
  const r = await emre.post('/api/push/test');
  eq(r.status, 502); eq(r.data.removed, 1);
  eq(sql("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 'u_emre'")[0].n, 0);
  reply = 201;
});
await t('404 → abonelik silinir (atama sırasında, istek yavaşlamaz)', async () => {
  eq((await emre.post('/api/push/subscribe', { subscription: subE, device: 'x' })).status, 200);
  reply = 404;
  const t0 = Date.now();
  const r = await yigit.post('/api/tasks', { title: 'Emre işi', dueDate: '2026-12-04', assigneeId: 'u_emre' });
  ok(r.status < 300);
  ok(Date.now() - t0 < 3000, 'atama isteği bekletilmemeli');
  ok(await until(() => sql("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 'u_emre'")[0].n === 0, 6000), 'silinmeli');
  reply = 201;
});
await t('push servisine ulaşılamazsa iş akışı bozulmaz', async () => {
  sql(`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, device) VALUES ('ps_dead', 'u_emre', 'http://127.0.0.1:1/dead', '${re.keys.p256dh}', '${re.keys.auth}', 'ölü')`);
  const r = await yigit.post('/api/tasks', { title: 'Emre işi 2', dueDate: '2026-12-04', assigneeId: 'u_emre' });
  ok(r.status < 300);
  ok(await until(() => (sql("SELECT fail_count FROM push_subscriptions WHERE id = 'ps_dead'")[0] || {}).fail_count === 1, 6000), 'fail_count 1');
  sql("DELETE FROM push_subscriptions WHERE id = 'ps_dead'");
});

console.log('Abonelik sahipliği');
await t('başkası benim aboneliğimi silemez', async () => {
  eq((await emre.post('/api/push/unsubscribe', { endpoint: subP.endpoint })).status, 200);
  eq(sql("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 'u_pelin'")[0].n, 1);
});
await t('aynı tarayıcıda başka kişi oturum açınca abonelik ona geçer', async () => {
  eq((await yigit.post('/api/push/subscribe', { subscription: subP, device: 'iPhone' })).status, 200);
  eq(sql(`SELECT user_id FROM push_subscriptions WHERE endpoint = '${subP.endpoint}'`)[0].user_id, 'u_yigit');
  eq((await pelin.post('/api/push/test')).status, 404, 'Pelin artık cihazsız');
  eq((await pelin.post('/api/push/subscribe', { subscription: subP, device: 'iPhone' })).status, 200);
});
await t('unsubscribe kendi aboneliğini siler', async () => {
  eq((await pelin.post('/api/push/unsubscribe', { endpoint: subP.endpoint })).status, 200);
  eq(sql("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 'u_pelin'")[0].n, 0);
  eq((await pelin.post('/api/push/unsubscribe', {})).status, 400);
});
await t('kişi başına en fazla 10 cihaz', async () => {
  for (let i = 0; i < 12; i++) await emre.post('/api/push/subscribe', { subscription: { endpoint: `${ORIGIN}/push/e${i}`, keys: re.keys }, device: 'd' + i });
  eq(sql("SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = 'u_emre'")[0].n, 10);
  sql("DELETE FROM push_subscriptions WHERE user_id = 'u_emre'");
});

srv.close();
done();
