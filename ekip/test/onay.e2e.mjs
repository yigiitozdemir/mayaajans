// İçerik onay takibi — API + hatırlatma testi.
// Çalıştırma: BASE=http://127.0.0.1:8821 PERSIST=.wrangler/state-onay node test/onay.e2e.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { t, ok, eq, done, loginAs, openLive, until, sql, wait, Client, BASE } from './lib.mjs';
// lib.mjs'teki runCron (/cdn-cgi/local/explorer/…) bu wrangler sürümünde işleyiciyi çalıştırmıyor (workerd "failed to lookup address");
// --test-scheduled ile gelen /__scheduled ucu güvenilir.
const runCron = async (cron) => (await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent(cron)}`)).status;

const ROOT = new URL('..', import.meta.url).pathname;
const Y = await loginAs('u_yigit', 'Yiğit');
const P = await loginAs('u_pelin', 'Pelin');
const anon = new Client();

console.log('Yetki ve doğrulama');
const mk = async (body) => (await Y.post('/api/tasks', { title: 'Onay testi', client: 'Nevvital', dueDate: '2026-12-01', assigneeId: 'u_pelin', ...body })).data;
const task = await mk({ title: 'Kasım kampanya postu' });

await t('girişsiz: onay adımı ve geçmiş 401', async () => {
  eq((await anon.post(`/api/tasks/${task.id}/approval`, { approval: 'sent' })).status, 401);
  eq((await anon.get(`/api/tasks/${task.id}/approval`)).status, 401);
  eq((await anon.post(`/api/tasks/${task.id}/approval/undo`)).status, 401);
});
await t('yeni iş takipte değil (Hazırlanıyor), alanlar var', async () => {
  eq(task.approval, ''); eq(task.revisions, 0); eq(task.sentAt, null); eq(task.approvalAt, null);
  const list = (await P.get('/api/tasks')).data; ok(list.find((x) => x.id === task.id && x.approval === ''));
});
await t('geçersiz adım 400, yanlış not 400, olmayan iş 404', async () => {
  eq((await P.post(`/api/tasks/${task.id}/approval`, { approval: 'bitti' })).status, 400);
  eq((await P.post(`/api/tasks/${task.id}/approval`, { approval: 3 })).status, 400);
  eq((await P.post(`/api/tasks/${task.id}/approval`, {})).status, 400);
  eq((await P.post(`/api/tasks/${task.id}/approval`, { approval: 'revision', note: 42 })).status, 400);
  eq((await P.post(`/api/tasks/${task.id}/approval`, { approval: 'revision', note: 'x'.repeat(2001) })).status, 400);
  eq((await P.post('/api/tasks/t_yok/approval', { approval: 'sent' })).status, 404);
  eq((await P.get('/api/tasks/t_yok/approval')).status, 404);
  eq((await P.post('/api/tasks/t_yok/approval/undo')).status, 404);
  eq(sql(`SELECT approval FROM tasks WHERE id='${task.id}'`)[0].approval, '');
});
await t('geri alınacak adım yokken 409', async () => eq((await P.post(`/api/tasks/${task.id}/approval/undo`)).status, 409));

console.log('Durum geçişleri');
const live = openLive(Y); await live.ready;
await t('Onaya gönderildi → status 1, sentAt, canlı yayın', async () => {
  live.msgs.length = 0;
  const r = await P.post(`/api/tasks/${task.id}/approval`, { approval: 'sent' });
  eq(r.status, 200); eq(r.data.approval, 'sent'); eq(r.data.status, 1); ok(r.data.sentAt, 'sentAt yok'); ok(r.data.approvalAt);
  ok(await until(() => live.msgs.some((m) => m.type === 'tasks')), 'tasks yayını gelmedi');
});
await t('aynı adım tekrar 409', async () => eq((await P.post(`/api/tasks/${task.id}/approval`, { approval: 'sent' })).status, 409));
await t('Revize istendi (notlu) → revisions 1, status 1, not geçmişte', async () => {
  const r = await P.post(`/api/tasks/${task.id}/approval`, { approval: 'revision', note: '  Logo büyüsün, tarih 22 Kasım  ' });
  eq(r.data.approval, 'revision'); eq(r.data.revisions, 1); eq(r.data.status, 1);
  const log = (await Y.get(`/api/tasks/${task.id}/approval`)).data;
  eq(log.length, 2); eq(log[0].step, 'revision'); eq(log[0].note, 'Logo büyüsün, tarih 22 Kasım'); eq(log[0].by, 'u_pelin'); eq(log[1].step, 'sent');
});
await t('tekrar gönder + notsuz revize → revisions 2', async () => {
  await P.post(`/api/tasks/${task.id}/approval`, { approval: 'sent' });
  const r = await Y.post(`/api/tasks/${task.id}/approval`, { approval: 'revision' });
  eq(r.data.revisions, 2);
  const log = (await P.get(`/api/tasks/${task.id}/approval`)).data;
  eq(log[0].note, ''); eq(log[0].by, 'u_yigit'); eq(log.filter((x) => x.step === 'revision').length, 2);
});
await t('Onaylandı → status değişmez (paylaşım bekliyor)', async () => {
  await P.post(`/api/tasks/${task.id}/approval`, { approval: 'sent' });
  const r = await P.post(`/api/tasks/${task.id}/approval`, { approval: 'approved' });
  eq(r.data.approval, 'approved'); eq(r.data.status, 1); eq(r.data.completedAt, null); eq(r.data.revisions, 2);
  const t0 = await mk({ title: 'Beklemedeki iş' });
  const r0 = await P.post(`/api/tasks/${t0.id}/approval`, { approval: 'approved' });
  eq(r0.data.status, 0, 'beklemede kalmalı');
});
await t('Paylaşıldı → status 2 + completedAt', async () => {
  const r = await P.post(`/api/tasks/${task.id}/approval`, { approval: 'published' });
  eq(r.data.approval, 'published'); eq(r.data.status, 2); ok(r.data.completedAt, 'completedAt yok');
});
await t('Geri al: Paylaşıldı → Onaylandı, status 1, completedAt boş', async () => {
  const r = await Y.post(`/api/tasks/${task.id}/approval/undo`);
  eq(r.status, 200); eq(r.data.approval, 'approved'); eq(r.data.status, 1); eq(r.data.completedAt, null);
  eq((await P.get(`/api/tasks/${task.id}/approval`)).data[0].step, 'approved');
});
await t('Geri al iki kez: revize sayısı ve notu geri gider', async () => {
  await P.post(`/api/tasks/${task.id}/approval/undo`); // approved → sent
  const r = await P.post(`/api/tasks/${task.id}/approval/undo`); // sent → revision (2)
  eq(r.data.approval, 'revision'); eq(r.data.revisions, 2);
  const r2 = await P.post(`/api/tasks/${task.id}/approval/undo`); // revision → sent, revisions 1
  eq(r2.data.approval, 'sent'); eq(r2.data.revisions, 1);
  eq((await P.get(`/api/tasks/${task.id}/approval`)).data.filter((x) => x.step === 'revision').length, 1);
});
await t('tamamlanmış işi onaya göndermek işi yeniden açar', async () => {
  const d = await mk({ title: 'Bitmiş iş', status: 2 });
  const r = await P.post(`/api/tasks/${d.id}/approval`, { approval: 'sent' });
  eq(r.data.status, 1); eq(r.data.completedAt, null);
  const u = await P.post(`/api/tasks/${d.id}/approval/undo`);
  eq(u.data.status, 2); ok(u.data.completedAt, 'geri alınca tamamlanma tarihi dönmeli'); eq(u.data.approval, '');
});
await t('Hazırlanıyor\'a (takipten çıkar) dönülebilir; null kabul', async () => {
  const x = await mk({ title: 'Takipten çıkacak' });
  await P.post(`/api/tasks/${x.id}/approval`, { approval: 'sent' });
  const r = await P.post(`/api/tasks/${x.id}/approval`, { approval: null });
  eq(r.data.approval, ''); eq(r.data.status, 1);
});
await t('mevcut PATCH ve hızlı ekleme bozulmadı', async () => {
  const q = await Y.post('/api/tasks', { title: 'Hızlı iş', dueDate: '2026-12-03' });
  eq(q.status, 201); eq(q.data.approval, '');
  const p = await P.patch(`/api/tasks/${task.id}`, { note: 'not', status: 0 });
  eq(p.status, 200); eq(p.data.approval, 'sent'); eq(p.data.note, 'not');
  await P.patch(`/api/tasks/${task.id}`, { status: 1 });
});
await t('iş silinince onay geçmişi de silinir', async () => {
  const x = await mk({ title: 'Silinecek' });
  await P.post(`/api/tasks/${x.id}/approval`, { approval: 'sent' });
  eq((await Y.del(`/api/tasks/${x.id}`)).status, 200);
  eq(sql(`SELECT COUNT(*) AS n FROM task_revisions WHERE task_id='${x.id}'`)[0].n, 0);
});

console.log('Hatırlatma (cron, gerçek saat)');
const ist = new Date(Date.now() + 3 * 3600e3); const mesai = ist.getUTCDay() >= 1 && ist.getUTCDay() <= 5 && ist.getUTCHours() >= 9 && ist.getUTCHours() < 18;
const noAssignee = await mk({ title: 'Sorumlusuz onay işi', assigneeId: null });
await P.post(`/api/tasks/${noAssignee.id}/approval`, { approval: 'sent' });
sql(`UPDATE tasks SET sent_at = datetime('now', '-4 days') WHERE id IN ('${task.id}', '${noAssignee.id}')`);
const fresh = await mk({ title: 'Yeni gönderilen' });
await P.post(`/api/tasks/${fresh.id}/approval`, { approval: 'sent' });
sql(`UPDATE tasks SET sent_at = datetime('now', '-71 hours') WHERE id = '${fresh.id}'`);
const pl = openLive(P); await pl.ready;
const notif = (uid, id) => sql(`SELECT * FROM notifications WHERE user_id='${uid}' AND kind='approval' AND task_id='${id}'`);
await t(mesai ? 'mesaide: 3 günü geçen iş için sorumluya bildirim (canlı, kind approval)' : 'mesai dışı/hafta sonu: bildirim gitmez', async () => {
  pl.msgs.length = 0; live.msgs.length = 0;
  eq(await runCron('5 * * * *'), 200);
  if (mesai) {
    ok(await until(() => pl.msgs.some((m) => m.type === 'notify' && m.notification.kind === 'approval' && m.notification.taskId === task.id), 6000), 'canlı bildirim gelmedi');
    const n = pl.msgs.find((m) => m.type === 'notify' && m.notification.kind === 'approval').notification;
    eq(n.title, 'Müşteri onayı bekleniyor'); eq(n.link, '/?is=' + task.id); eq(n.body, 'Kasım kampanya postu · Nevvital · 4 gündür');
    eq(notif('u_pelin', task.id).length, 1);
    ok(await until(() => live.msgs.some((m) => m.type === 'notify' && m.notification.taskId === noAssignee.id), 6000), 'sorumlusuz iş ekleyene (Yiğit) gitmedi');
    eq(notif('u_pelin', fresh.id).length, 0, '71 saatlik işe gitmemeli');
    ok(sql(`SELECT approval_reminded_at FROM tasks WHERE id='${task.id}'`)[0].approval_reminded_at, 'hatırlatma zamanı yazılmadı');
  } else {
    await wait(1500);
    eq(notif('u_pelin', task.id).length, 0);
  }
});
await t('ikinci çalıştırmada tekrar yok (günde en fazla bir)', async () => {
  eq(await runCron('5 * * * *'), 200); await wait(1500);
  eq(notif('u_pelin', task.id).length, mesai ? 1 : 0); eq(notif('u_yigit', noAssignee.id).length, mesai ? 1 : 0);
});
await t('yeniden "Onaya gönderildi" sayacı sıfırlar (hatırlatma zamanı temizlenir)', async () => {
  await P.post(`/api/tasks/${task.id}/approval`, { approval: 'revision', note: 'renk' });
  await P.post(`/api/tasks/${task.id}/approval`, { approval: 'sent' });
  eq(sql(`SELECT approval_reminded_at FROM tasks WHERE id='${task.id}'`)[0].approval_reminded_at, null);
});
live.ws.close(); pl.ws.close();

console.log('Hatırlatma mantığı (birim: onayHatirlatma(env, now) bellekte SQLite ile)');
const calls = [];
globalThis.__onayNotify = calls;
const bundle = await build({
  entryPoints: [ROOT + 'src/onay.ts'], bundle: true, format: 'esm', write: false, platform: 'neutral', logLevel: 'silent',
  plugins: [{ name: 'notify-stub', setup(b) {
    b.onResolve({ filter: /\/notify$/ }, () => ({ path: 'notify-stub', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export async function notify(env, n) { globalThis.__onayNotify.push(n); return "n"; }', loader: 'js' }));
  } }],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const db = new DatabaseSync(':memory:');
for (const f of readdirSync(ROOT + 'migrations').filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(ROOT + 'migrations/' + f, 'utf8'));
db.exec("UPDATE users SET status = 'active' WHERE id IN ('u_pelin', 'u_yigit'); UPDATE users SET status = 'removed' WHERE id = 'u_emre'");
const D1 = { prepare(q) { let a = []; const st = { bind(...x) { a = x; return st; }, async all() { return { results: db.prepare(q).all(...a) }; }, async run() { db.prepare(q).run(...a); return {}; }, async first() { return db.prepare(q).get(...a) ?? null; } }; return st; } };
const env = { DB: D1 };
const S = (d) => d.toISOString().replace('T', ' ').slice(0, 19);
const FRI = new Date('2026-11-06T10:00:00Z'); // Cuma 13:00 İstanbul
const ins = (id, o = {}) => db.prepare("INSERT INTO tasks (id, title, client, assignee_id, created_by, due_date, status, approval, sent_at) VALUES (?, ?, ?, ?, ?, '2026-12-01', ?, ?, ?)")
  .run(id, o.title || id, o.client ?? 'Firma', o.assignee === undefined ? 'u_pelin' : o.assignee, o.by || 'u_yigit', o.status ?? 1, o.approval || 'sent', o.sent || S(new Date(FRI - 4 * 864e5)));
ins('a1', { title: 'Post', client: 'Nevvital' });
ins('a2', { sent: S(new Date(FRI - 72 * 3600e3 + 60e3)) });        // 72 saat dolmadı
ins('a3', { sent: S(new Date(FRI - 72 * 3600e3)) });               // tam 72 saat
ins('a4', { status: 2 });                                         // tamamlanmış
ins('a5', { approval: 'revision' });                              // revizede (bizde)
ins('a6', { assignee: null });                                    // sorumlusuz → ekleyen
ins('a7', { assignee: 'u_emre', by: 'u_pelin' });                 // sorumlu ekipten çıkmış → ekleyen
ins('a8', { approval: 'approved' });
const run = async (iso) => { calls.length = 0; const n = await mod.onayHatirlatma(env, new Date(iso)); return { n, ids: calls.map((c) => c.taskId).sort() }; };

await t('onayMesaide: hafta içi 09:00–17:59 İstanbul', async () => {
  const m = (iso) => mod.onayMesaide(new Date(iso));
  eq(m('2026-11-06T05:59:00Z'), false, '08:59'); eq(m('2026-11-06T06:00:00Z'), true, '09:00');
  eq(m('2026-11-06T14:59:00Z'), true, '17:59'); eq(m('2026-11-06T15:00:00Z'), false, '18:00');
  eq(m('2026-11-07T10:00:00Z'), false, 'Cumartesi'); eq(m('2026-11-08T10:00:00Z'), false, 'Pazar');
  eq(m('2026-11-09T06:30:00Z'), true, 'Pazartesi'); eq(m('2026-11-06T22:00:00Z'), false, 'Cumartesi 01:00 İst');
});
await t('hafta sonu ve mesai dışı hiçbir şey göndermez, işaretlemez', async () => {
  eq((await run('2026-11-07T10:00:00Z')).n, 0); eq((await run('2026-11-06T16:00:00Z')).n, 0); eq((await run('2026-11-06T05:00:00Z')).n, 0);
  eq(db.prepare("SELECT COUNT(*) AS n FROM tasks WHERE approval_reminded_at IS NOT NULL").get().n, 0);
});
await t('mesaide: yalnız sent + 72 saati geçmiş + açık işler; sorumlu yoksa ekleyen', async () => {
  const r = await run(FRI.toISOString());
  eq(JSON.stringify(r.ids), JSON.stringify(['a1', 'a3', 'a6', 'a7']));
  const c1 = calls.find((c) => c.taskId === 'a1');
  eq(c1.userId, 'u_pelin'); eq(c1.kind, 'approval'); eq(c1.title, 'Müşteri onayı bekleniyor'); eq(c1.body, 'Post · Nevvital · 4 gündür'); eq(c1.link, '/?is=a1');
  eq(calls.find((c) => c.taskId === 'a3').body, 'a3 · Firma · 3 gündür');
  eq(calls.find((c) => c.taskId === 'a6').userId, 'u_yigit'); eq(calls.find((c) => c.taskId === 'a7').userId, 'u_pelin');
});
await t('aynı gün tekrar yok; ertesi iş günü yeniden', async () => {
  eq(JSON.stringify((await run('2026-11-06T14:30:00Z')).ids), '["a2"]', 'aynı gün yalnız 72 saati yeni dolan a2');
  eq((await run('2026-11-09T06:05:00Z')).n, 5, 'Pazartesi (a2 de artık 72 saati geçti)');
  eq((await run('2026-11-09T07:05:00Z')).n, 0, 'Pazartesi ikinci saat');
});
await t('İstanbul gün sınırına göre "günde bir"', async () => {
  db.exec("UPDATE tasks SET approval_reminded_at = '2026-11-09 21:30:00' WHERE id = 'a1'"); // Salı 00:30 İstanbul
  eq((await run('2026-11-10T06:00:00Z')).ids.includes('a1'), false, 'aynı İstanbul günü (Salı 09:00)');
  db.exec("UPDATE tasks SET approval_reminded_at = '2026-11-09 20:59:00' WHERE id = 'a1'"); // Pazartesi 23:59 İstanbul
  eq((await run('2026-11-10T06:00:00Z')).ids.includes('a1'), true, 'ertesi gün (Salı 09:00)');
});

done();
