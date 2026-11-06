// Yönetici özeti + haftalık yedek API testi
// BASE=http://127.0.0.1:8824 PERSIST=.wrangler/state-yonetim node test/yonetim.e2e.mjs
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client, loginAs, t, ok, eq, done, sql, runCron, until, openLive, wait, BASE } from './lib.mjs';

// Diğer ekipler src/ altında dosya yazdıkça wrangler dev yeniden yükleniyor: ağ hatasında kısa bekleyip yeniden dene
const _req = Client.prototype.req;
Client.prototype.req = async function (...a) {
  for (let i = 0; ; i++) {
    try { return await _req.apply(this, a); } catch (e) { if (i >= 20) throw e; await new Promise((r) => setTimeout(r, 750)); }
  }
};
async function liveReady(c) {
  for (let i = 0; ; i++) {
    const l = openLive(c);
    try { await l.ready; return l; } catch (e) { if (i >= 20) throw e; await new Promise((r) => setTimeout(r, 750)); }
  }
}
const ENV = { ...process.env, CLOUDFLARE_API_TOKEN: 'proxy-injected' };
const PERSIST = process.env.PERSIST || '.wrangler/state';
const TMP = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'yonetim-'));
const DAYMS = 864e5;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const today = iso(Date.now() + 3 * 3600e3);              // İstanbul
const add = (d, n) => iso(Date.parse(d + 'T00:00:00Z') + n * DAYMS);
const mon = (d) => add(d, -((new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7));
const sq = (q) => sql(q.replace(/\s*\n\s*/g, ' '));
const one = (q) => Object.values(sq(q)[0] || {})[0];
const DONE = "date(completed_at, '+3 hours')";
const ranges = {
  'bu-hafta': [mon(today), add(mon(today), 6)],
  'gecen-hafta': [add(mon(today), -7), add(mon(today), -1)],
  'bu-ay': [today.slice(0, 8) + '01', iso(Date.UTC(+today.slice(0, 4), +today.slice(5, 7), 0))],
  'son-30': [add(today, -29), today],
};
// UTC zaman damgası: İstanbul günü d, saat 12:00
const utcNoon = (d) => d + ' 09:00:00';

console.log('Yönetici özeti · yedek');
const admin = await loginAs('u_yigit', 'Yiğit');
const pelin = await loginAs('u_pelin', 'Pelin');
const anon = new Client();

// ---------- test verisi ----------
const F = 'YO Test Firma';
sql(`DELETE FROM tasks WHERE id LIKE 'yo_%'`); sql(`DELETE FROM shoots WHERE id LIKE 'yo_%'`);
sq(`INSERT INTO tasks (id, title, client, assignee_id, due_date, status) VALUES
  ('yo_late10', 'YO 10 gün geciken', '${F}', 'u_pelin', '${add(today, -10)}', 0),
  ('yo_late3',  'YO 3 gün geciken',  '${F}', 'u_pelin', '${add(today, -3)}', 1),
  ('yo_noone',  'YO sorumsuz',       '${F}', NULL,      '${add(today, 2)}', 0),
  ('yo_noone_late', 'YO sorumsuz ve eski', '${F}', NULL, '${add(today, -20)}', 0),
  ('yo_up',     'YO yaklaşan',       '${F}', 'u_pelin', '${add(today, 3)}', 1)`);
sq(`INSERT INTO tasks (id, title, client, assignee_id, due_date, status, completed_at) VALUES
  ('yo_d1', 'YO bugün bitti', '${F}', 'u_pelin', '${add(today, -2)}', 2, '${utcNoon(today)}'),
  ('yo_d2', 'YO geçen hafta bitti', '${F}', 'u_pelin', '${add(mon(today), -6)}', 2, '${utcNoon(add(mon(today), -3))}'),
  ('yo_d3', 'YO 3 hafta önce bitti', '${F}', 'u_emre', NULL, 2, '${utcNoon(add(mon(today), -20))}'),
  ('yo_d4', 'YO 25 gün önce', '${F}', 'u_emre', '${add(today, -25)}', 2, '${utcNoon(add(today, -25))}')`);
sq(`INSERT INTO shoots (id, title, client, date, status) VALUES
  ('yo_s_old', 'YO unutulmuş çekim', '${F}', '${add(today, -4)}', 0),
  ('yo_s_done', 'YO yapılan çekim', '${F}', '${add(today, -1) < mon(today) ? today : add(today, -1)}', 1),
  ('yo_s_done2', 'YO eski çekim', '${F}', '${add(today, -40)}', 1)`);
sq(`INSERT OR REPLACE INTO special_days (id, name, date) VALUES ('yo_day', 'YO özel gün', '${add(mon(today), 3)}')`);
sql(`DELETE FROM special_day_rows WHERE day_id = 'yo_day'`);
sq(`INSERT INTO special_day_rows (day_id, client, assignee_id, status) VALUES ('yo_day', 'A', 'u_pelin', 0), ('yo_day', 'B', 'u_pelin', 2), ('yo_day', 'C', NULL, 1)`);

await t('girişsiz 401', async () => {
  for (const [m, p] of [['GET', '/api/admin-summary'], ['GET', '/api/admin-summary/backups'], ['POST', '/api/admin-summary/backup'], ['GET', '/api/admin-summary/backup/2026-01-01-0000.json.gz']]) {
    eq((await anon.req(m, p, m === 'POST' ? {} : undefined)).status, 401, m + ' ' + p);
  }
});
await t('yönetici olmayan 403', async () => {
  for (const [m, p] of [['GET', '/api/admin-summary'], ['GET', '/api/admin-summary/backups'], ['POST', '/api/admin-summary/backup'], ['GET', '/api/admin-summary/backup/2026-01-01-0000.json.gz']]) {
    const r = await pelin.req(m, p, m === 'POST' ? {} : undefined);
    eq(r.status, 403, m + ' ' + p); ok(/yönetici/i.test(r.data?.error || ''), 'Türkçe hata');
  }
});
await t('geçersiz dönem 400', async () => { const r = await admin.get('/api/admin-summary?donem=yil'); eq(r.status, 400); ok(r.data.error); });

let S;
await t('özet kutuları sql ile tutuyor (bu hafta)', async () => {
  const r = await admin.get('/api/admin-summary'); eq(r.status, 200); S = r.data;
  eq(S.today, today, 'bugün');
  eq(S.period.key, 'bu-hafta'); eq(S.period.start, ranges['bu-hafta'][0]); eq(S.period.end, ranges['bu-hafta'][1]);
  eq(S.totals.open, one('SELECT COUNT(*) FROM tasks WHERE status != 2'), 'açık');
  eq(S.totals.late, one(`SELECT COUNT(*) FROM tasks WHERE status != 2 AND due_date < '${today}'`), 'geciken');
  const [a, b] = ranges['bu-hafta'];
  eq(S.totals.done, one(`SELECT COUNT(*) FROM tasks WHERE status = 2 AND ${DONE} BETWEEN '${a}' AND '${b}'`), 'tamamlanan');
  eq(S.totals.shoots, one(`SELECT COUNT(*) FROM shoots WHERE status = 1 AND date BETWEEN '${a}' AND '${b}'`), 'çekim');
  ok(S.totals.shoots >= 1, 'test çekimi sayıldı');
  eq(S.totals.special.total, one(`SELECT COUNT(*) FROM special_day_rows r JOIN special_days d ON d.id = r.day_id WHERE d.date BETWEEN '${a}' AND '${b}'`));
  eq(S.totals.special.pending, one(`SELECT COUNT(*) FROM special_day_rows r JOIN special_days d ON d.id = r.day_id WHERE r.status != 2 AND d.date BETWEEN '${a}' AND '${b}'`));
  ok(S.totals.special.pending >= 2, 'özel gün bekleyen ≥ 2');
  const hasAppr = sql('PRAGMA table_info(tasks)').some((c) => c.name === 'approval');
  eq(S.approvalEnabled, hasAppr, 'approval sütunu varlığı');
  eq(S.totals.approval, hasAppr ? one("SELECT COUNT(*) FROM tasks WHERE approval = 'sent'") : null, 'onay bekleyen');
});

await t('dönem filtreleri: tamamlanan ve çekim', async () => {
  for (const [k, [a, b]] of Object.entries(ranges)) {
    const r = await admin.get('/api/admin-summary?donem=' + k); eq(r.status, 200, k);
    eq(r.data.period.start, a, k + ' başlangıç'); eq(r.data.period.end, b, k + ' bitiş');
    eq(r.data.totals.done, one(`SELECT COUNT(*) FROM tasks WHERE status = 2 AND ${DONE} BETWEEN '${a}' AND '${b}'`), k + ' tamamlanan');
    eq(r.data.totals.shoots, one(`SELECT COUNT(*) FROM shoots WHERE status = 1 AND date BETWEEN '${a}' AND '${b}'`), k + ' çekim');
    const p = r.data.people.find((x) => x.id === 'u_pelin');
    eq(p.done, one(`SELECT COUNT(*) FROM tasks WHERE assignee_id = 'u_pelin' AND status = 2 AND ${DONE} BETWEEN '${a}' AND '${b}'`), k + ' Pelin biten');
  }
  const gh = (await admin.get('/api/admin-summary?donem=gecen-hafta')).data;
  ok(gh.totals.done >= 1, 'geçen hafta biten iş sayıldı');
});

await t('kişi tablosu (Pelin) sql ile tutuyor', async () => {
  const p = S.people.find((x) => x.id === 'u_pelin'); ok(p, 'Pelin var');
  eq(p.open, one("SELECT COUNT(*) FROM tasks WHERE assignee_id = 'u_pelin' AND status != 2"), 'açık');
  eq(p.late, one(`SELECT COUNT(*) FROM tasks WHERE assignee_id = 'u_pelin' AND status != 2 AND due_date < '${today}'`), 'geciken');
  eq(p.doing, one("SELECT COUNT(*) FROM tasks WHERE assignee_id = 'u_pelin' AND status = 1"), 'devam');
  eq(p.upcoming, one(`SELECT COUNT(*) FROM tasks WHERE assignee_id = 'u_pelin' AND status != 2 AND due_date BETWEEN '${today}' AND '${add(today, 7)}'`), '7 gün');
  const [a, b] = ranges['bu-hafta'];
  const avg = one(`SELECT AVG(MAX(0, julianday(${DONE}) - julianday(due_date))) FROM tasks WHERE assignee_id = 'u_pelin' AND status = 2 AND due_date IS NOT NULL AND ${DONE} BETWEEN '${a}' AND '${b}'`);
  eq(p.avgDelay, avg === null ? null : Math.round(avg * 10) / 10, 'ortalama gecikme');
  ok(p.avgDelay >= 2, 'bugün biten iş 2 gün gecikmeli');
  const all = S.people.reduce((n, x) => n + x.open, 0);
  eq(all, S.totals.open, 'kişi açıkları toplamı = açık iş (atanmamış satırı dahil)');
  ok(S.people.some((x) => x.id === null && x.open >= 2), 'Atanmamış satırı');
  ok(S.people.every((x, i, arr) => x.id === null || i === 0 || arr[i - 1].open >= x.open || arr[i - 1].id === null), 'açık işe göre sıralı');
});

await t('müşteri tablosu', async () => {
  const c = S.clients.find((x) => x.name === F); ok(c, 'test firması ilk 10da');
  eq(c.open, 5); eq(c.late, 3);
  eq(c.done, one(`SELECT COUNT(*) FROM tasks WHERE client = '${F}' AND status = 2 AND ${DONE} BETWEEN '${ranges['bu-hafta'][0]}' AND '${ranges['bu-hafta'][1]}'`));
  eq(c.lastShoot, one(`SELECT MAX(date) FROM shoots WHERE client = '${F}' AND status = 1`), 'son çekim');
  ok(S.clients.length <= 10);
  ok(S.clients.every((x, i, arr) => i === 0 || arr[i - 1].open >= x.open), 'açık işe göre sıralı');
});

await t('haftalık trend: 8 hafta, sql ile tutuyor', async () => {
  eq(S.trend.length, 8); eq(S.trend[7].start, mon(today)); eq(S.trend[0].start, add(mon(today), -49));
  for (const w of S.trend) eq(w.count, one(`SELECT COUNT(*) FROM tasks WHERE status = 2 AND ${DONE} BETWEEN '${w.start}' AND '${w.end}'`), w.start);
  ok(S.trend[4].count >= 1 || S.trend.some((w) => w.count > 0), 'veri var');
});

await t('dikkat listesi', async () => {
  const L = S.attention.late.map((x) => x.id);
  ok(L.includes('yo_late10') && L.includes('yo_noone_late'), '7 günden fazla gecikenler');
  ok(!L.includes('yo_late3'), '3 gün geciken listede yok');
  ok(S.attention.late.every((x) => x.days > 7), 'hepsi > 7 gün');
  ok(S.attention.late.every((x, i, a) => i === 0 || a[i - 1].dueDate <= x.dueDate), 'en eski üstte');
  eq(S.attention.late.find((x) => x.id === 'yo_late10').days, 10);
  const U = S.attention.unassigned.map((x) => x.id);
  ok(U.includes('yo_noone') && U.includes('yo_noone_late') && !U.includes('yo_late10'), 'sorumsuz');
  eq(S.attention.unassigned.length, Math.min(50, one("SELECT COUNT(*) FROM tasks WHERE status != 2 AND assignee_id IS NULL")));
  const SH = S.attention.shoots.map((x) => x.id);
  ok(SH.includes('yo_s_old') && !SH.includes('yo_s_done'), 'tarihi geçmiş planlı çekim');
  eq(S.attention.shoots.length, one(`SELECT COUNT(*) FROM shoots WHERE status = 0 AND date < '${today}'`));
});

await t('canlı: iş eklenince tasks yayını gelir (sayfa yeniden yükler)', async () => {
  const live = await liveReady(admin);
  const r = await pelin.post('/api/tasks', { title: 'YO canlı', dueDate: add(today, 1), client: F });
  ok(r.status === 200 || r.status === 201, JSON.stringify(r.data));
  ok(await until(() => live.msgs.some((m) => m.type === 'tasks')), 'tasks mesajı');
  live.ws.close();
  const s2 = (await admin.get('/api/admin-summary')).data;
  eq(s2.totals.open, S.totals.open + 1, 'açık iş arttı');
});

// ---------- yedek ----------
const r2get = (key, out) => spawnSync('npx', ['wrangler', 'r2', 'object', 'get', 'maya-ekip-yedek/' + key, '--local', '--persist-to', PERSIST, '--file', out], { env: ENV, encoding: 'utf8' });
let B, gzFile;
await t('Şimdi yedek al → R2 anahtarı, gzip JSON, satır sayıları tutuyor, oturumlar yok', async () => {
  const r = await admin.post('/api/admin-summary/backup'); eq(r.status, 200, JSON.stringify(r.data)); B = r.data;
  ok(/^yedek\/\d{4}-\d{2}-\d{2}-\d{4}(-\d+)?\.json\.gz$/.test(B.key), 'anahtar biçimi ' + B.key);
  const stamp = new Date(Date.now() + 3 * 3600e3).toISOString();
  ok(B.name.startsWith(stamp.slice(0, 10)), 'İstanbul tarihi');
  const out = join(TMP, 'r2.json.gz'); const g = r2get(B.key, out);
  ok(g.status === 0 && existsSync(out), 'wrangler r2 object get: ' + (g.stderr || '').slice(-200));
  const doc = JSON.parse(gunzipSync(readFileSync(out)).toString('utf8'));
  eq(doc.version, 1); ok(doc.createdAt);
  for (const x of ['sessions', 'invites', 'login_attempts', 'd1_migrations', 'sqlite_sequence']) ok(!doc.tables[x], x + ' yedekte olmamalı');
  const names = sql("SELECT name FROM sqlite_master WHERE type = 'table'").map((x) => x.name).filter((n) => !/^(_cf_|d1_|sqlite_)/i.test(n) && !['sessions', 'invites', 'login_attempts'].includes(n)).sort();
  eq(Object.keys(doc.tables).sort().join(','), names.join(','), 'tablo listesi');
  let rows = 0;
  for (const n of names) {
    const c = one(`SELECT COUNT(*) FROM "${n}"`); rows += c;
    eq(doc.tables[n].rows.length, c, n + ' satır sayısı');
    eq(doc.tables[n].columns.length, sql(`PRAGMA table_info("${n}")`).length, n + ' sütun');
  }
  eq(B.rows, rows, 'meta satır'); eq(B.tables, names.length, 'meta tablo');
  const ti = doc.tables.tasks; const row = ti.rows.find((x) => x[ti.columns.indexOf('id')] === 'yo_late10');
  eq(row[ti.columns.indexOf('title')], 'YO 10 gün geciken', 'içerik');
  ok(doc.tables.users.rows.length > 0, 'users var');
  gzFile = out;
});

await t('yedek listesi ve indirme', async () => {
  const l = (await admin.get('/api/admin-summary/backups')).data;
  ok(l.count >= 1); eq(l.last.key, B.key); ok(l.items.length <= 12);
  const d = await admin.get('/api/admin-summary/backup/' + B.name);
  eq(d.status, 200); ok(/attachment/.test(d.headers.get('content-disposition')), 'attachment');
  ok(/gzip/.test(d.headers.get('content-type')));
  const doc = JSON.parse(gunzipSync(Buffer.from(d.data)).toString('utf8'));
  ok(doc.tables.tasks, 'indirilen yedek açılıyor');
  eq((await admin.get('/api/admin-summary/backup/..%2Fbaska.json.gz')).status, 400, 'geçersiz ad');
  eq((await admin.get('/api/admin-summary/backup/2001-01-01-0000.json.gz')).status, 404, 'yok');
  eq((await pelin.get('/api/admin-summary/backup/' + B.name)).status, 403, 'üye indiremez');
});

await t("cron '17 0 * * 1' yedek alır", async () => {
  const before = (await admin.get('/api/admin-summary/backups')).data.count;
  eq(await runCron('17 0 * * 1'), 200);
  ok(await until(() => false, 1) || true);
  let after = before;
  for (let i = 0; i < 40 && after === before; i++) { await wait(250); after = (await admin.get('/api/admin-summary/backups')).data.count; }
  eq(after, Math.min(12, before + 1), 'cron sonrası yedek sayısı');
});

await t('13 yedek sonrası 12 kalır, en eskiler silinir', async () => {
  const keys = [];
  for (let i = 0; i < 13; i++) { const r = await admin.post('/api/admin-summary/backup'); eq(r.status, 200); keys.push(r.data.key); }
  const l = (await admin.get('/api/admin-summary/backups')).data;
  eq(l.count, 12, 'kalan'); eq(l.items.length, 12);
  eq(l.last.key, keys[12], 'en yeni başta');
  ok(!l.items.some((x) => x.key === keys[0]), 'en eski 13. yedek silindi');
  ok(!l.items.some((x) => x.key === B.key), 'ilk yedek silindi');
  eq(new Set(l.items.map((x) => x.key)).size, 12, 'anahtarlar benzersiz (aynı dakika → -2, -3 eki)');
  const g = r2get(B.key, join(TMP, 'silinen.gz')); ok(g.status !== 0 || !existsSync(join(TMP, 'silinen.gz')), 'R2de de yok');
});

await t('yedekten-don.mjs: onaysız dosya yazmaz', async () => {
  const out = join(TMP, 'onaysiz.sql');
  const r = spawnSync('node', ['scripts/yedekten-don.mjs', gzFile, '--local', '--cikti', out], { encoding: 'utf8' });
  eq(r.status, 2, 'çıkış kodu'); ok(!existsSync(out), 'dosya yok'); ok(/--evet/.test(r.stdout), 'onay istiyor');
  const r2 = spawnSync('node', ['scripts/yedekten-don.mjs', join(TMP, 'yok.gz'), '--evet'], { encoding: 'utf8' });
  eq(r2.status, 1, 'olmayan dosya');
  const r3 = spawnSync('node', ['scripts/yedekten-don.mjs', gzFile, '--local', '--remote', '--evet'], { encoding: 'utf8' });
  eq(r3.status, 1, '--local ve --remote birlikte');
});

await t('yedekten-don.mjs: boş yerel veritabanına uygulanınca satır sayıları tutuyor', async () => {
  const out = join(TMP, 'geri.sql');
  const r = spawnSync('node', ['scripts/yedekten-don.mjs', gzFile, '--local', '--cikti', out, '--evet'], { encoding: 'utf8' });
  eq(r.status, 0, r.stderr); ok(existsSync(out)); ok(r.stdout.includes('wrangler d1 execute maya-ekip --local --file'), 'komutu yazdı');
  ok(!/DELETE FROM "sessions"/.test(readFileSync(out, 'utf8')), 'oturum tablosuna dokunmuyor');
  const P2 = join(TMP, 'bos-db');
  execSync(`npx wrangler d1 migrations apply maya-ekip --local --persist-to ${P2}`, { env: ENV, stdio: 'pipe' });
  execSync(`npx wrangler d1 execute maya-ekip --local --persist-to ${P2} --file ${out} --yes`, { env: ENV, stdio: 'pipe' });
  const doc = JSON.parse(gunzipSync(readFileSync(gzFile)).toString('utf8'));
  for (const [n, tb] of Object.entries(doc.tables)) {
    const res = JSON.parse(execSync(`npx wrangler d1 execute maya-ekip --local --persist-to ${P2} --json --command ${JSON.stringify(`SELECT COUNT(*) AS n FROM "${n}"`)}`, { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString());
    eq(res[0].results[0].n, tb.rows.length, n);
  }
  const t1 = JSON.parse(execSync(`npx wrangler d1 execute maya-ekip --local --persist-to ${P2} --json --command "SELECT title, assignee_id FROM tasks WHERE id = 'yo_late10'"`, { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).toString());
  eq(t1[0].results[0].title, 'YO 10 gün geciken'); eq(t1[0].results[0].assignee_id, 'u_pelin');
});

await t('onay bekleyen kutusu: approval sütunu varsa sayılır, yoksa gizli', async () => {
  const has = sql('PRAGMA table_info(tasks)').some((c) => c.name === 'approval');
  if (!has) {
    eq((await admin.get('/api/admin-summary')).data.approvalEnabled, false, 'sütun yok → gizli');
    sql("ALTER TABLE tasks ADD COLUMN approval TEXT NOT NULL DEFAULT ''");
  }
  try {
    const base = one("SELECT COUNT(*) FROM tasks WHERE approval = 'sent'");
    sql("UPDATE tasks SET approval = 'sent' WHERE id IN ('yo_late3', 'yo_up')");
    sql("UPDATE tasks SET approval = 'approved' WHERE id = 'yo_d1'");
    const r = (await admin.get('/api/admin-summary')).data;
    eq(r.approvalEnabled, true); eq(r.totals.approval, base + 2, 'yalnızca sent sayılır');
  } finally { if (!has) sql('ALTER TABLE tasks DROP COLUMN approval'); }
});

// temizlik
sql(`DELETE FROM tasks WHERE id LIKE 'yo_%' OR title = 'YO canlı'`); sql(`DELETE FROM shoots WHERE id LIKE 'yo_%'`);
sql(`DELETE FROM special_day_rows WHERE day_id = 'yo_day'`); sql(`DELETE FROM special_days WHERE id = 'yo_day'`);
try { rmSync(TMP, { recursive: true, force: true }); } catch { /* */ }
void BASE; void writeFileSync;
done();
