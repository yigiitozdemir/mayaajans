#!/usr/bin/env node
// Haftalık yedekten (yedek/YYYY-MM-DD-HHmm.json.gz) geri yükleme SQL'i üretir.
// GÜVENLİ: veritabanına kendisi DOKUNMAZ. SQL'i dosyaya yazar ve çalıştırılacak wrangler komutunu ekrana basar.
//
//   node scripts/yedekten-don.mjs <yedek.json.gz> [--local|--remote] [--cikti dosya.sql] --evet
//
// --evet olmadan yalnızca özet gösterir, dosya yazmaz.
// Üretilen SQL, yedekteki her tablonun hedefteki TÜM satırlarını siler ve yedekteki satırları yazar.
// Yedekte olmayan tablolara (sessions, invites, login_attempts, d1_migrations) dokunmaz;
// ancak users silinip yeniden yazıldığı için oturumlar (ON DELETE CASCADE) kapanır, herkes yeniden giriş yapar.
// Önerilen sıra: 1) hedefe migration'ları uygula (şema güncel olsun)  2) bu betikle SQL üret  3) ekrandaki komutu çalıştır.
// R2'deki dosyalar (logolar, sohbet dosyaları) bu yedekte yoktur; yalnızca veritabanı geri gelir.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { basename, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--cikti');

if (!file || flag('--yardim') || flag('-h')) {
  console.log('Kullanım: node scripts/yedekten-don.mjs <yedek.json.gz> [--local|--remote] [--cikti dosya.sql] --evet');
  process.exit(file ? 0 : 1);
}
if (flag('--local') && flag('--remote')) { console.error('Hata: --local ve --remote birlikte verilemez.'); process.exit(1); }
const remote = flag('--remote');
if (!existsSync(file)) { console.error('Hata: dosya bulunamadı: ' + file); process.exit(1); }

let doc;
try {
  const raw = readFileSync(file);
  const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8');
  doc = JSON.parse(text);
} catch (e) { console.error('Hata: yedek okunamadı (gzip/JSON değil?): ' + e.message); process.exit(1); }
if (doc?.version !== 1 || !doc.tables || typeof doc.tables !== 'object') { console.error('Hata: tanınmayan yedek biçimi (version 1 bekleniyordu).'); process.exit(1); }

const ATLA = new Set(['sessions', 'invites', 'login_attempts']);
const names = Object.keys(doc.tables).filter((n) => !ATLA.has(n) && !/^(_cf_|d1_|sqlite_)/i.test(n));
const q = (n) => '"' + String(n).replace(/"/g, '""') + '"';
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'object' && typeof v.$b64 === 'string') return "X'" + Buffer.from(v.$b64, 'base64').toString('hex') + "'";
  return "'" + String(v).replace(/'/g, "''") + "'";
};

// Yabancı anahtarlara göre sırala: önce ebeveyn tablolar yazılır, silme ters sırada
const deps = new Map(names.map((n) => {
  const sql = doc.tables[n].sql || '';
  const refs = [...sql.matchAll(/REFERENCES\s+["`[]?([A-Za-z0-9_]+)/gi)].map((m) => m[1]).filter((x) => x !== n && names.includes(x));
  return [n, new Set(refs)];
}));
const order = []; const seen = new Set();
const visit = (n, stack = new Set()) => {
  if (seen.has(n) || stack.has(n)) return; stack.add(n);
  for (const d of deps.get(n) || []) visit(d, stack);
  seen.add(n); order.push(n);
};
[...names].sort().forEach((n) => visit(n));

let total = 0;
const summary = order.map((n) => { const c = doc.tables[n].rows.length; total += c; return [n, c]; });
console.log(`Yedek: ${basename(file)} · oluşturulma ${doc.createdAt} · ${order.length} tablo · ${total} satır`);
for (const [n, c] of summary) console.log(`  ${n.padEnd(22)} ${String(c).padStart(7)} satır`);
console.log(`\nHedef: ${remote ? 'CANLI (uzak) veritabanı maya-ekip' : 'yerel veritabanı maya-ekip'}`);
console.log('Bu SQL, yukarıdaki tabloların hedefteki TÜM satırlarını silip yedektekilerle değiştirir. Oturumlar kapanır.');

if (!flag('--evet')) {
  console.log('\nOnay verilmedi: dosya YAZILMADI. Emin isen aynı komutu --evet ile yeniden çalıştır.');
  process.exit(2);
}

const MAX = 90_000; // D1 tek ifade sınırı ~100 KB
const out = [];
out.push(`-- Maya Ekip geri yükleme · kaynak ${basename(file)} · yedek ${doc.createdAt} · üretildi ${new Date().toISOString()}`);
out.push('PRAGMA defer_foreign_keys = true;');
for (const n of order) {
  const s = doc.tables[n].sql;
  if (s && /^CREATE TABLE/i.test(s)) out.push(s.replace(/^CREATE TABLE\s+(IF NOT EXISTS\s+)?/i, 'CREATE TABLE IF NOT EXISTS ') + ';');
}
for (const n of [...order].reverse()) out.push(`DELETE FROM ${q(n)};`);
for (const n of order) {
  const { columns, rows } = doc.tables[n];
  if (!rows.length) continue;
  const head = `INSERT INTO ${q(n)} (${columns.map(q).join(', ')}) VALUES `;
  let buf = [];
  let len = head.length;
  const flush = () => { if (buf.length) out.push(head + buf.join(',\n  ') + ';'); buf = []; len = head.length; };
  for (const r of rows) {
    const tuple = '(' + r.map(lit).join(', ') + ')';
    if (buf.length && len + tuple.length > MAX) flush();
    buf.push(tuple); len += tuple.length + 4;
  }
  flush();
}
const target = resolve(val('--cikti') || basename(file).replace(/\.json(\.gz)?$/, '') + '.geri-yukle.sql');
writeFileSync(target, out.join('\n') + '\n');
console.log(`\nSQL yazıldı: ${target}`);
console.log('Veritabanına HİÇBİR ŞEY uygulanmadı. Uygulamak için:');
console.log(`  npx wrangler d1 execute maya-ekip ${remote ? '--remote' : '--local'} --file ${JSON.stringify(target)}`);
if (remote) console.log('DİKKAT: bu komut CANLI veriyi değiştirir. Önce o anki hâlin yedeğini al (Yönetici özeti → Şimdi yedek al).');
