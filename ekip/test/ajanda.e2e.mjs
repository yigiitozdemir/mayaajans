// Ajandam API testleri
// BASE=http://127.0.0.1:8807 PERSIST=.wrangler/state-ajanda node test/ajanda.e2e.mjs
import { loginAs, Client, t, ok, eq, done, openLive, until, runCron, sql, wait } from './lib.mjs';

const TZ = 3 * 3600_000;
const istToday = () => new Date(Date.now() + TZ).toISOString().slice(0, 10);
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const toSql = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const istLocal = (ms) => new Date(ms + TZ).toISOString().slice(0, 16);

// 1x1 PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const form = (bytes, name, type) => { const f = new FormData(); f.append('file', new Blob([bytes], { type }), name); return f; };

const pelin = await loginAs('u_pelin', 'Pelin');
const emre = await loginAs('u_emre', 'Emre');
const yigit = await loginAs('u_yigit', 'Yiğit'); // yönetici
const anon = new Client();
sql("DELETE FROM agenda_files; DELETE FROM agenda_notes; DELETE FROM agenda_todos; DELETE FROM agenda_events; DELETE FROM notifications WHERE kind = 'reminder'");

console.log('Ajandam');

await t('girişsiz erişim 401', async () => {
  eq((await anon.get('/api/agenda')).status, 401);
  eq((await anon.post('/api/agenda/notes', { title: 'x' })).status, 401);
});

// ---------- notlar ----------
let noteId;
await t('not oluştur: başlık, çok satırlı metin, tür, renk, sabitle, müşteri, kontrol listesi', async () => {
  const client = sql('SELECT id FROM clients WHERE archived = 0 LIMIT 1')[0].id;
  const r = await pelin.post('/api/agenda/notes', {
    title: 'Toplantı notları', body: 'Satır 1\nSatır 2\n\nSatır 4', kind: 'work', color: 'blue', pinned: true, clientId: client,
    checks: [{ text: 'Logo iste', done: false }, { text: 'Fiyat gönder', done: true }],
  });
  eq(r.status, 201); noteId = r.data.id;
  eq(r.data.body, 'Satır 1\nSatır 2\n\nSatır 4'); eq(r.data.kind, 'work'); eq(r.data.color, 'blue'); eq(r.data.pinned, true); eq(r.data.clientId, client);
  eq(r.data.checks.length, 2); ok(r.data.checks[0].id, 'madde kimliği'); eq(r.data.checks[1].done, true);
  eq(r.data.files.length, 0);
});

await t('not doğrulama: geçersiz tür/renk/müşteri, çok uzun metin', async () => {
  eq((await pelin.post('/api/agenda/notes', { kind: 'gizli' })).status, 400);
  eq((await pelin.post('/api/agenda/notes', { color: '#fff' })).status, 400);
  const r = await pelin.post('/api/agenda/notes', { clientId: 'c_yok' }); eq(r.status, 400); ok(/Müşteri/.test(r.data.error), r.data.error);
  eq((await pelin.post('/api/agenda/notes', { body: 'x'.repeat(20001) })).status, 400);
  eq((await pelin.patch('/api/agenda/notes/' + noteId, {})).status, 400, 'boş değişiklik');
});

await t('not güncelle (otomatik kaydetme) ve listede sabitlenen üstte', async () => {
  const r = await pelin.patch('/api/agenda/notes/' + noteId, { body: 'Güncel metin', kind: 'personal' });
  eq(r.status, 200); eq(r.data.body, 'Güncel metin'); eq(r.data.kind, 'personal');
  const n2 = await pelin.post('/api/agenda/notes', { title: 'Sonraki not' });
  eq(n2.status, 201); eq(n2.data.kind, 'work', 'varsayılan tür İş');
  const l = await pelin.get('/api/agenda');
  eq(l.status, 200); eq(l.data.notes[0].id, noteId, 'sabitlenen önce');
  await pelin.del('/api/agenda/notes/' + n2.data.id);
});

// ---------- dosyalar ----------
let fileId, pdfId;
await t('ekran görüntüsü yükle (panodan gelen ad "image.png" → Ekran görüntüsü …) ve baytlar aynı iner', async () => {
  const r = await pelin.req('POST', `/api/agenda/notes/${noteId}/files`, form(PNG, 'image.png', 'image/png'));
  eq(r.status, 201, JSON.stringify(r.data)); fileId = r.data.id;
  ok(/^Ekran görüntüsü \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.png$/.test(r.data.name), r.data.name);
  eq(r.data.type, 'image/png'); eq(r.data.inline, true);
  const key = sql(`SELECT r2_key FROM agenda_files WHERE id = '${fileId}'`)[0].r2_key;
  ok(key.startsWith(`personal/u_pelin/${noteId}/${fileId}-`), key);
  ok(/^[\w./-]+$/.test(key), 'güvenli anahtar: ' + key);
  const g = await pelin.get('/api/agenda/files/' + fileId);
  eq(g.status, 200); eq(g.headers.get('content-type'), 'image/png'); eq(g.headers.get('x-content-type-options'), 'nosniff');
  ok(g.headers.get('content-disposition').startsWith('inline'), 'satır içi');
  eq(Buffer.compare(Buffer.from(g.data), Buffer.from(PNG)), 0, 'baytlar aynı');
  const d = await pelin.get('/api/agenda/files/' + fileId + '?download');
  ok(d.headers.get('content-disposition').startsWith('attachment'), 'indir: attachment');
});

await t('PDF yüklenir ama hep indirilir (attachment, octet-stream)', async () => {
  const r = await pelin.req('POST', `/api/agenda/notes/${noteId}/files`, form(PDF, 'Teklif Şubat.pdf', 'application/pdf'));
  eq(r.status, 201); pdfId = r.data.id; eq(r.data.type, 'application/pdf'); eq(r.data.inline, false); eq(r.data.name, 'Teklif Şubat.pdf');
  const g = await pelin.get('/api/agenda/files/' + pdfId);
  ok(g.headers.get('content-disposition').startsWith('attachment'), 'attachment');
  eq(g.headers.get('content-type'), 'application/octet-stream');
  eq(Buffer.compare(Buffer.from(g.data), Buffer.from(PDF)), 0, 'baytlar aynı');
});

await t('tür sınırı: HTML/SVG/metin reddedilir (uzantı ya da tür taklidi işe yaramaz) — 415', async () => {
  const html = new TextEncoder().encode('<html><script>alert(1)</script></html>');
  eq((await pelin.req('POST', `/api/agenda/notes/${noteId}/files`, form(html, 'x.png', 'image/png'))).status, 415, 'png gibi görünen html');
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  eq((await pelin.req('POST', `/api/agenda/notes/${noteId}/files`, form(svg, 'a.svg', 'image/svg+xml'))).status, 415, 'svg');
  eq((await pelin.req('POST', `/api/agenda/notes/${noteId}/files`, form(new Uint8Array(0), 'bos.png', 'image/png'))).status, 400, 'boş dosya');
});

await t('HEIC kabul edilir, satır içi değil (indirilir)', async () => {
  const heic = new Uint8Array(64); heic.set(new TextEncoder().encode('\0\0\0\x18ftypheic'), 0);
  const r = await pelin.req('POST', `/api/agenda/notes/${noteId}/files`, form(heic, 'IMG_1.HEIC', ''));
  eq(r.status, 201); eq(r.data.type, 'image/heic'); eq(r.data.inline, false);
  const g = await pelin.get('/api/agenda/files/' + r.data.id);
  ok(g.headers.get('content-disposition').startsWith('attachment'), 'attachment');
  await pelin.del('/api/agenda/files/' + r.data.id);
});

await t('boyut sınırı: 15 MB üstü 413', async () => {
  const big = new Uint8Array(15 * 1024 * 1024 + 10); big.set(PNG, 0);
  const r = await pelin.req('POST', `/api/agenda/notes/${noteId}/files`, form(big, 'buyuk.png', 'image/png'));
  eq(r.status, 413); ok(/15 MB/.test(r.data.error), r.data.error);
});

// ---------- yapılacaklar ----------
const today = istToday();
let todoId, todoB;
await t('yapılacak ekle: tarih + saat + yıldız; doğrulama', async () => {
  eq((await pelin.post('/api/agenda/todos', { title: '  ' })).status, 400, 'boş başlık');
  eq((await pelin.post('/api/agenda/todos', { title: 'x', dueDate: '2026-02-30' })).status, 400, 'geçersiz tarih');
  eq((await pelin.post('/api/agenda/todos', { title: 'x', dueDate: today, dueTime: '25:00' })).status, 400, 'geçersiz saat');
  eq((await pelin.post('/api/agenda/todos', { title: 'x', dueTime: '10:00' })).status, 400, 'tarihsiz saat');
  eq((await pelin.post('/api/agenda/todos', { title: 'x', remind: { offset: 60 } })).status, 400, 'tarihsiz göreli anımsatıcı');
  eq((await pelin.post('/api/agenda/todos', { title: 'x', dueDate: today, remind: { offset: 7 } })).status, 400, 'geçersiz seçenek');
  eq((await pelin.post('/api/agenda/todos', { title: 'x', repeat: 'yearly' })).status, 400, 'geçersiz tekrar');
  const r = await pelin.post('/api/agenda/todos', { title: 'Faturayı öde', dueDate: addDays(today, 2), dueTime: '14:00', star: true });
  eq(r.status, 201); todoId = r.data.id; eq(r.data.star, true); eq(r.data.done, false); eq(r.data.dueTime, '14:00'); eq(r.data.remind, null);
  todoB = (await pelin.post('/api/agenda/todos', { title: 'Tarihsiz iş' })).data.id;
});

await t('göreli anımsatıcı İstanbul saatiyle hesaplanır (14:00 − 1 saat = 10:00 UTC)', async () => {
  const r = await pelin.patch('/api/agenda/todos/' + todoId, { remind: { offset: 60 } });
  eq(r.status, 200); eq(r.data.remind.offset, 60);
  eq(r.data.nextAt, addDays(today, 2) + 'T10:00:00Z');
  const r2 = await pelin.patch('/api/agenda/todos/' + todoId, { dueTime: '16:30' });
  eq(r2.data.nextAt, addDays(today, 2) + 'T12:30:00Z', 'saat değişince yeniden hesaplanır');
  const r3 = await pelin.patch('/api/agenda/todos/' + todoId, { remind: { at: addDays(today, 1) + 'T08:15' } });
  eq(r3.data.nextAt, addDays(today, 1) + 'T05:15:00Z', 'tam zaman'); eq(r3.data.remind.at, addDays(today, 1) + 'T08:15');
});

await t('tamamla → anımsatıcı durur; geri al → yeniden kurulur', async () => {
  let r = await pelin.patch('/api/agenda/todos/' + todoId, { done: true });
  eq(r.data.done, true); ok(r.data.doneAt, 'doneAt'); eq(r.data.nextAt, null);
  r = await pelin.patch('/api/agenda/todos/' + todoId, { done: false });
  eq(r.data.done, false); eq(r.data.doneAt, null); eq(r.data.nextAt, addDays(today, 1) + 'T05:15:00Z');
});

// ---------- etkinlikler ----------
let eventId;
await t('etkinlik ekle/düzenle; doğrulama', async () => {
  eq((await pelin.post('/api/agenda/events', { title: 'Toplantı' })).status, 400, 'tarihsiz');
  eq((await pelin.post('/api/agenda/events', { title: 'T', date: today, start: '10:00', end: '09:00' })).status, 400, 'bitiş önce');
  eq((await pelin.post('/api/agenda/events', { title: 'T', date: today, end: '09:00' })).status, 400, 'başlangıçsız bitiş');
  const r = await pelin.post('/api/agenda/events', { title: 'Müşteri toplantısı', date: addDays(today, 3), start: '10:00', end: '11:30', note: 'Zoom', color: 'green', remind: { offset: 10 } });
  eq(r.status, 201); eventId = r.data.id; eq(r.data.start, '10:00'); eq(r.data.end, '11:30'); eq(r.data.color, 'green');
  eq(r.data.nextAt, addDays(today, 3) + 'T06:50:00Z');
  const u = await pelin.patch('/api/agenda/events/' + eventId, { start: '13:00', end: '14:00' });
  eq(u.status, 200); eq(u.data.nextAt, addDays(today, 3) + 'T09:50:00Z', 'saat değişince anımsatıcı kayar');
});

// ---------- gizlilik ----------
await t('GİZLİLİK: başka kullanıcı ve yönetici listeleyemez / okuyamaz / değiştiremez / indiremez — hep 404', async () => {
  for (const other of [emre, yigit]) {
    const l = await other.get('/api/agenda');
    eq(l.status, 200);
    eq(l.data.notes.length + l.data.todos.length + l.data.events.length, 0, other.id + ' listesinde başkasının kaydı görünmemeli');
    const checks = [
      ['PATCH', '/api/agenda/notes/' + noteId, { title: 'hack' }],
      ['DELETE', '/api/agenda/notes/' + noteId],
      ['POST', `/api/agenda/notes/${noteId}/files`, form(PNG, 'a.png', 'image/png')],
      ['GET', '/api/agenda/files/' + fileId],
      ['GET', '/api/agenda/files/' + fileId + '?download'],
      ['DELETE', '/api/agenda/files/' + fileId],
      ['PATCH', '/api/agenda/todos/' + todoId, { done: true }],
      ['DELETE', '/api/agenda/todos/' + todoId],
      ['POST', `/api/agenda/todos/${todoId}/task`, { dueDate: today }],
      ['PATCH', '/api/agenda/events/' + eventId, { title: 'hack' }],
      ['DELETE', '/api/agenda/events/' + eventId],
      ['POST', '/api/agenda/remind/' + todoId, { action: 'dismiss' }],
      ['POST', '/api/agenda/remind/' + eventId, { action: 'snooze', minutes: 10 }],
    ];
    for (const [m, p, b] of checks) {
      const r = await other.req(m, p, b);
      eq(r.status, 404, `${other.id} ${m} ${p}`);
    }
    // var olmayan kimlikle aynı yanıt (varlık sızmaz)
    const fake = await other.get('/api/agenda/files/af_yokboyle');
    const real = await other.get('/api/agenda/files/' + fileId);
    eq(JSON.stringify(real.data), JSON.stringify(fake.data), 'yanıt gövdeleri aynı');
  }
  // hiçbir şey değişmedi
  const l = await pelin.get('/api/agenda');
  const n = l.data.notes.find((x) => x.id === noteId);
  ok(n && n.title === 'Toplantı notları' && n.files.length === 2, 'not ve dosyalar yerinde');
  ok(l.data.todos.find((x) => x.id === todoId && !x.done), 'yapılacak yerinde');
  ok(l.data.events.find((x) => x.id === eventId && x.title === 'Müşteri toplantısı'), 'etkinlik yerinde');
  eq((await pelin.get('/api/agenda/files/' + fileId)).status, 200, 'sahibi hâlâ indirebilir');
});

// ---------- canlı yayın ----------
await t("canlı 'agenda' yayını yalnızca sahibine (diğer cihazı) gider", async () => {
  const mine = openLive(pelin), mine2 = openLive(pelin), other = openLive(emre), adm = openLive(yigit);
  await Promise.all([mine.ready, mine2.ready, other.ready, adm.ready]);
  await pelin.patch('/api/agenda/notes/' + noteId, { title: 'Toplantı notları' });
  await pelin.post('/api/agenda/todos', { title: 'Canlı test' });
  ok(await until(() => mine.msgs.filter((m) => m.type === 'agenda').length >= 2 && mine2.msgs.some((m) => m.type === 'agenda')), 'sahibe gelmeli (iki pencere)');
  await wait(600);
  eq(other.msgs.filter((m) => m.type === 'agenda').length, 0, 'başka üyeye gitmemeli');
  eq(adm.msgs.filter((m) => m.type === 'agenda').length, 0, 'yöneticiye gitmemeli');
  for (const x of [mine, mine2, other, adm]) x.ws.close();
});

// ---------- anımsatıcı (cron) ----------
await t("anımsatıcı: zamanı gelince cron bildirim gönderir (kind 'reminder', link), tekrar göndermez", async () => {
  const live = openLive(pelin); await live.ready;
  const r = await pelin.post('/api/agenda/todos', { title: 'Ali Bey’i ara', dueDate: today, dueTime: '23:59', note: 'Teklif hakkında', remind: { at: istLocal(Date.now() + 3600_000) } });
  const id = r.data.id;
  sql(`UPDATE agenda_todos SET remind_at = '${toSql(Date.now() - 30_000)}', remind_base = '${toSql(Date.now() - 30_000)}' WHERE id = '${id}'`);
  eq(await runCron('* * * * *'), 200);
  ok(await until(() => live.msgs.some((m) => m.type === 'notify' && m.notification.kind === 'reminder')), 'canlı bildirim gelmeli');
  const n = live.msgs.find((m) => m.type === 'notify' && m.notification.kind === 'reminder').notification;
  eq(n.title, '⏰ Ali Bey’i ara'); eq(n.link, '/ajanda?r=' + id); ok(/Teklif hakkında/.test(n.body), n.body); ok(/Bugün 23:59/.test(n.body), n.body);
  const rows = sql(`SELECT * FROM notifications WHERE user_id = 'u_pelin' AND kind = 'reminder' AND link = '/ajanda?r=${id}'`);
  eq(rows.length, 1, 'zile yazıldı');
  const t1 = sql(`SELECT remind_at, fired_at FROM agenda_todos WHERE id = '${id}'`)[0];
  eq(t1.remind_at, null, 'tekrarsız → bitti'); ok(t1.fired_at, 'fired_at');
  const l = await pelin.get('/api/agenda'); ok(l.data.todos.find((x) => x.id === id).firedAt, 'sayfada "çaldı" bilgisi');
  await runCron('* * * * *'); await wait(800);
  eq(sql(`SELECT COUNT(*) n FROM notifications WHERE kind = 'reminder' AND link = '/ajanda?r=${id}'`)[0].n, 1, 'ikinci kez gönderilmemeli');
  live.ws.close();
});

await t('kaçırılmış (5 dakikadan eski) anımsatıcı yine bir kez gönderilir; başkasına gitmez', async () => {
  const emreLive = openLive(emre); await emreLive.ready;
  const r = await pelin.post('/api/agenda/todos', { title: 'Kaçırılan', remind: { at: istLocal(Date.now() + 7200_000) } });
  sql(`UPDATE agenda_todos SET remind_at = '${toSql(Date.now() - 3 * 3600_000)}', remind_base = '${toSql(Date.now() - 3 * 3600_000)}' WHERE id = '${r.data.id}'`);
  await runCron('* * * * *');
  ok(await until(() => sql(`SELECT COUNT(*) n FROM notifications WHERE kind = 'reminder' AND link = '/ajanda?r=${r.data.id}'`)[0].n === 1), 'gönderilmeli');
  eq(sql(`SELECT user_id FROM notifications WHERE link = '/ajanda?r=${r.data.id}'`)[0].user_id, 'u_pelin');
  await wait(300);
  eq(emreLive.msgs.filter((m) => m.type === 'notify' || m.type === 'agenda').length, 0, 'Emre hiçbir şey almamalı');
  emreLive.ws.close();
});

await t('tamamlanan yapılacağın anımsatıcısı gönderilmez', async () => {
  const r = await pelin.post('/api/agenda/todos', { title: 'Bitmiş', remind: { at: istLocal(Date.now() + 3600_000) } });
  await pelin.patch('/api/agenda/todos/' + r.data.id, { done: true });
  sql(`UPDATE agenda_todos SET remind_at = '${toSql(Date.now() - 60_000)}' WHERE id = '${r.data.id}'`); // elle zorla
  await runCron('* * * * *'); await wait(800);
  eq(sql(`SELECT COUNT(*) n FROM notifications WHERE link = '/ajanda?r=${r.data.id}'`)[0].n, 0);
});

await t('tekrarlı anımsatıcı (her gün) gönderilir ve bir sonraki güne kayar; etkinlikte de', async () => {
  const at = Date.now() + 3600_000;
  const r = await pelin.post('/api/agenda/todos', { title: 'Su iç', repeat: 'daily', remind: { at: istLocal(at) } });
  const base = Date.parse(r.data.nextAt);
  const past = base - 86_400_000; // dünkü aynı saat
  sql(`UPDATE agenda_todos SET remind_at = '${toSql(past)}', remind_base = '${toSql(past)}' WHERE id = '${r.data.id}'`);
  await runCron('* * * * *');
  ok(await until(() => sql(`SELECT COUNT(*) n FROM notifications WHERE link = '/ajanda?r=${r.data.id}'`)[0].n === 1), 'gönderilmeli');
  const row = sql(`SELECT remind_at, remind_base FROM agenda_todos WHERE id = '${r.data.id}'`)[0];
  eq(row.remind_at, toSql(base), 'bir sonraki gün aynı saate kaydı'); eq(row.remind_base, toSql(base));
  // haftalık etkinlik, 10 dk önce
  const e = await pelin.post('/api/agenda/events', { title: 'Haftalık rapor', date: addDays(today, -7), start: '23:50', repeat: 'weekly', remind: { offset: 10 } });
  eq(e.status, 201);
  const expected = Date.parse(today + 'T23:40:00Z') - TZ; // bu haftaki seferin 10 dk öncesi
  eq(e.data.nextAt, new Date(expected).toISOString().slice(0, 19) + 'Z', 'geçmiş seferler atlanır, bugünkü kurulur');
  const ePast = expected - 7 * 86_400_000;
  sql(`UPDATE agenda_events SET remind_at = '${toSql(ePast)}', remind_base = '${toSql(ePast)}' WHERE id = '${e.data.id}'`);
  await runCron('* * * * *');
  ok(await until(() => sql(`SELECT COUNT(*) n FROM notifications WHERE link = '/ajanda?r=${e.data.id}'`)[0].n === 1), 'etkinlik bildirimi');
  eq(sql(`SELECT remind_at FROM agenda_events WHERE id = '${e.data.id}'`)[0].remind_at, toSql(expected), 'bir sonraki haftaya kaydı');
});

await t('ertele (10 dk / 1 saat / yarın 09:00) ve kapat', async () => {
  const r = await pelin.post('/api/agenda/todos', { title: 'Ertelenecek', remind: { at: istLocal(Date.now() + 3600_000) } });
  const id = r.data.id;
  let s = await pelin.post('/api/agenda/remind/' + id, { action: 'snooze', minutes: 10 });
  eq(s.status, 200); ok(Math.abs(Date.parse(s.data.nextAt) - (Date.now() + 600_000)) < 90_000, '10 dk sonra: ' + s.data.nextAt);
  s = await pelin.post('/api/agenda/remind/' + id, { action: 'snooze', until: 'tomorrow9' });
  eq(s.data.nextAt, addDays(today, 1) + 'T06:00:00Z', 'yarın 09:00 İstanbul');
  eq((await pelin.post('/api/agenda/remind/' + id, { action: 'snooze', minutes: 3 })).status, 400);
  s = await pelin.post('/api/agenda/remind/' + id, { action: 'dismiss' });
  eq(s.data.nextAt, null); eq(s.data.remind, null);
  eq((await pelin.post('/api/agenda/remind/nt_x', { action: 'dismiss' })).status, 404);
});

// ---------- İş Planı'na dönüştür ----------
await t("İş Planı'na dönüştür: tarih zorunlu, kendine atanır, yapılacak bağlantılı + tamamlandı, 'tasks' yayını", async () => {
  const r0 = await pelin.post(`/api/agenda/todos/${todoB}/task`, {});
  eq(r0.status, 400); ok(/Teslim tarihi/.test(r0.data.error), r0.data.error);
  const live = openLive(emre); await live.ready;
  const r = await pelin.post(`/api/agenda/todos/${todoB}/task`, { dueDate: addDays(today, 5), client: 'Gizem Eczane' });
  eq(r.status, 201); ok(r.data.taskId, 'taskId');
  eq(r.data.todo.done, true); eq(r.data.todo.taskId, r.data.taskId);
  const task = (await pelin.get('/api/tasks')).data.find((x) => x.id === r.data.taskId);
  ok(task, 'iş oluştu'); eq(task.assigneeId, 'u_pelin'); eq(task.dueDate, addDays(today, 5)); eq(task.title, 'Tarihsiz iş'); eq(task.client, 'Gizem Eczane'); eq(task.createdBy, 'u_pelin');
  ok(await until(() => live.msgs.some((m) => m.type === 'tasks')), 'tasks yayını');
  eq((await pelin.post(`/api/agenda/todos/${todoB}/task`, { dueDate: today })).status, 409, 'ikinci kez dönüştürülemez');
  live.ws.close();
  sql(`DELETE FROM tasks WHERE id = '${r.data.taskId}'`);
});

// ---------- silme ----------
await t('dosya ve not silinir (R2 dahil); etkinlik/yapılacak silinir', async () => {
  eq((await pelin.del('/api/agenda/files/' + pdfId)).status, 200);
  eq((await pelin.get('/api/agenda/files/' + pdfId)).status, 404);
  eq((await pelin.del('/api/agenda/notes/' + noteId)).status, 200);
  eq((await pelin.get('/api/agenda/files/' + fileId)).status, 404, 'notla birlikte dosyası da gider');
  eq(sql(`SELECT COUNT(*) n FROM agenda_files WHERE note_id = '${noteId}'`)[0].n, 0);
  eq((await pelin.del('/api/agenda/events/' + eventId)).status, 200);
  eq((await pelin.del('/api/agenda/todos/' + todoId)).status, 200);
  eq((await pelin.del('/api/agenda/todos/' + todoId)).status, 404);
});

done();
