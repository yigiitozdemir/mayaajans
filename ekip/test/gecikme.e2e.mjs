// Akıllı geç kalma uyarısı — birim testi (sunucu gerekmez): gecikmeUyarisi(env, now) bellekte SQLite ile.
// Çalıştırma: node test/gecikme.e2e.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

let gecen = 0, kalan = 0;
const t = async (ad, f) => { try { await f(); gecen++; console.log('  ✓ ' + ad); } catch (e) { kalan++; console.log('  ✗ ' + ad + ' → ' + e.message); } };
const eq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} beklenen ${JSON.stringify(b)}, gelen ${JSON.stringify(a)}`); };

const ROOT = new URL('..', import.meta.url).pathname;
const calls = []; globalThis.__gNotify = calls;
const bundle = await build({
  entryPoints: [ROOT + 'src/gecikme.ts'], bundle: true, format: 'esm', write: false, platform: 'neutral', logLevel: 'silent',
  plugins: [{ name: 'notify-stub', setup(b) {
    b.onResolve({ filter: /\/notify$/ }, () => ({ path: 'notify-stub', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export async function notify(env, n) { globalThis.__gNotify.push(n); return "n"; }', loader: 'js' }));
  } }],
});
const mod = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const db = new DatabaseSync(':memory:');
for (const f of readdirSync(ROOT + 'migrations').filter((f) => f.endsWith('.sql')).sort()) db.exec(readFileSync(ROOT + 'migrations/' + f, 'utf8'));
db.exec("DELETE FROM tasks; UPDATE users SET status = 'active', role = 'member'; UPDATE users SET role = 'admin' WHERE id = 'u_yigit'; UPDATE users SET status = 'removed' WHERE id = 'u_emre'");
const D1 = { prepare(q) { let a = []; const st = { bind(...x) { a = x; return st; }, async all() { return { results: db.prepare(q).all(...a) }; }, async run() { db.prepare(q).run(...a); return {}; }, async first() { return db.prepare(q).get(...a) ?? null; } }; return st; } };
const env = { DB: D1 };
const ins = (id, due, o = {}) => db.prepare('INSERT INTO tasks (id, title, client, assignee_id, created_by, due_date, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
  .run(id, o.title || id, o.client ?? 'Firma', o.assignee === undefined ? 'u_pelin' : o.assignee, o.by || 'u_yigit', due, o.status ?? 0);
// Pazartesi 9 Kasım 2026, İstanbul 10:00 = 07:00Z
const PZT = '2026-11-09T07:00:00Z', SALI = '2026-11-10T07:00:00Z', CUMA = '2026-11-13T07:00:00Z';
const run = async (iso) => { calls.length = 0; const n = await mod.gecikmeUyarisi(env, new Date(iso)); return { n, c: calls.map((x) => x.taskId + '>' + x.userId).sort() }; };

console.log('Geç kalma uyarısı');
await t('kalanIsGunu: cumartesi iş günü, pazar sayılmaz', () => {
  eq(mod.kalanIsGunu('2026-11-09', '2026-11-09'), 0); eq(mod.kalanIsGunu('2026-11-09', '2026-11-11'), 2);
  eq(mod.kalanIsGunu('2026-11-13', '2026-11-16'), 2, 'Cuma→Pzt (Cmt + Pzt)'); eq(mod.kalanIsGunu('2026-11-14', '2026-11-16'), 1, 'Cmt→Pzt');
  eq(mod.kalanIsGunu('2026-11-09', '2026-11-08'), -1);
});
ins('g1', '2026-11-11', { title: 'Vatan reels', client: 'Vatan' }); // 2 iş günü → sorumlu
ins('g2', '2026-11-10');                                              // yarın → sorumlu + yönetici
ins('g3', '2026-11-09');                                              // bugün → sorumlu + yönetici
ins('g4', '2026-11-11', { status: 1 });                               // başlanmış → yok
ins('g5', '2026-11-05');                                              // geçmiş → yok
ins('g6', '2026-11-20');                                              // uzak → yok
ins('g7', '2026-11-11', { assignee: null, by: 'u_pelin' });           // sorumlusuz → ekleyen
ins('g8', '2026-11-11', { assignee: 'u_emre', by: 'u_pelin' });       // sorumlu ayrılmış → ekleyen
ins('g9', '2026-11-10', { assignee: 'u_yigit' });                     // yönetici kendi işi → tek bildirim
await t('saat 10 dışında ve pazar çalışmaz', async () => {
  eq((await run('2026-11-09T08:00:00Z')).n, 0, '11:00'); eq((await run('2026-11-15T07:00:00Z')).n, 0, 'Pazar');
  eq(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE gecikme_uyari IS NOT NULL').get().n, 0);
});
await t('pazartesi 10:00: doğru kişilere doğru aşama', async () => {
  const r = await run(PZT);
  eq(r.c, ['g1>u_pelin', 'g2>u_pelin', 'g2>u_yigit', 'g3>u_pelin', 'g3>u_yigit', 'g7>u_pelin', 'g8>u_pelin', 'g9>u_yigit']);
  const g1 = calls.find((x) => x.taskId === 'g1'); eq(g1.kind, 'gecikme'); eq(g1.body, 'Vatan reels · Vatan · teslime 2 iş günü'); eq(g1.link, '/isler?is=g1');
  eq(calls.find((x) => x.taskId === 'g3' && x.userId === 'u_yigit').title, 'Başlanmamış iş: teslim yaklaştı');
});
await t('aynı gün tekrar çalışınca bir daha göndermez', async () => { eq((await run(PZT)).n, 0); });
await t('ertesi gün: 2. aşamaya geçen iş yönetici ile birlikte bir kez daha', async () => {
  const r = await run(SALI);
  eq(r.c, ['g1>u_pelin', 'g1>u_yigit', 'g7>u_pelin', 'g7>u_yigit', 'g8>u_pelin', 'g8>u_yigit']);
});
await t('teslim tarihi ertelenirse uyarı baştan başlar', async () => {
  db.exec("UPDATE tasks SET due_date = '2026-11-16' WHERE id = 'g1'");
  eq((await run(CUMA)).c.filter((x) => x.startsWith('g1')), ['g1>u_pelin'], 'Cuma→Pzt 2 iş günü (cumartesi dahil)');
});
await t('cumartesi de çalışır; kimse kapatamaz (eski ayar yok sayılır)', async () => {
  db.exec(`UPDATE users SET settings = '{"gecikmeUyari":false}' WHERE id = 'u_pelin'`);
  ins('h1', '2026-11-16');
  eq((await run('2026-11-14T07:00:00Z')).c.filter((x) => x.startsWith('h1')), ['h1>u_pelin', 'h1>u_yigit'], 'Cmt→Pzt 1 iş günü');
});
console.log(`GEÇEN: ${gecen}  KALAN: ${kalan}`);
process.exit(kalan ? 1 : 0);
