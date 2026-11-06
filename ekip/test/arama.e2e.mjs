// ⌘K hızlı arama API testi: BASE=http://127.0.0.1:8823 PERSIST=.wrangler/state-arama node test/arama.e2e.mjs
import { BASE, Client, loginAs, sql as sql0, t, ok, eq, done } from './lib.mjs';
const sql = (q) => sql0(q.replace(/\s+/g, ' '));

const S = (c, q) => c.get('/api/search?q=' + encodeURIComponent(q));
const ids = (l) => l.map((x) => x.id);

// örnek veri
sql(`DELETE FROM tasks WHERE id LIKE 't_ara%'; DELETE FROM shoots WHERE id LIKE 's_ara%'; DELETE FROM special_days WHERE id LIKE 'd_ara%';
  DELETE FROM agenda_notes WHERE id LIKE 'an_ara%'; DELETE FROM agenda_todos WHERE id LIKE 'at_ara%'; DELETE FROM agenda_events WHERE id LIKE 'ae_ara%'`);
sql(`INSERT INTO tasks (id, title, client, due_date, status, note) VALUES
  ('t_ara1', 'İSTANBUL Boğaz tanıtım filmi', 'Nevvital', '2026-12-01', 0, ''),
  ('t_ara2', 'Kurgu revizyonu', 'Nevvital', '2026-11-20', 2, 'istanbul ofisinde teslim'),
  ('t_ara3', 'Şube açılış görselleri', 'Arslandent', '2026-11-25', 1, 'Işıklı vitrin çekimi')`);
sql(`INSERT INTO shoots (id, title, client, date, location) VALUES ('s_ara1', 'Ürün çekimi', 'Nevvital', '2026-12-03', 'Kadıköy, İstanbul')`);
sql(`INSERT INTO special_days (id, name, date) VALUES ('d_ara1', 'Öğretmenler Günü Özel', '2026-11-24')`);
sql(`INSERT INTO agenda_notes (id, user_id, title, body) VALUES ('an_ara1', 'u_pelin', 'Pelinin gizli notu', 'zümrütkelime burada')`);
sql(`INSERT INTO agenda_todos (id, user_id, title) VALUES ('at_ara1', 'u_pelin', 'Zümrüt fatura öde'), ('at_ara2', 'u_yigit', 'Yiğit zümrüt işi')`);
sql(`INSERT INTO agenda_events (id, user_id, title, date) VALUES ('ae_ara1', 'u_pelin', 'Zümrüt toplantı', '2026-12-10')`);

sql("DELETE FROM messages WHERE text LIKE '%Çağlayan%' OR text LIKE '%DMKELİME%' OR text LIKE '%silinecekkelime%' OR text LIKE '%şıkışmış revizyon%'");
const clientCh = sql("SELECT id FROM channels WHERE kind = 'client' LIMIT 1")[0].id;
const yigit = await loginAs('u_yigit', 'Yiğit');
const pelin = await loginAs('u_pelin', 'Pelin');
const emre = await loginAs('u_emre', 'Emre');
// sohbet: genel kanal, müşteri kanalı, Yiğit↔Pelin birebir, silinen mesaj
const post = async (c, ch, text) => { const r = await c.post(`/api/chat/channels/${ch}/messages`, { text }); if (r.status !== 200 && r.status !== 201) throw new Error('mesaj gönderilemedi ' + r.status + JSON.stringify(r.data)); return r.data.message?.id || r.data.id; };
await post(pelin, 'ch_genel', 'Günaydın, Çağlayan çekimi yarın saat onda');
const dm = (await yigit.post('/api/chat/dm', { userId: 'u_pelin' })).data;
await post(yigit, dm.id, 'Gizli fiyat teklifi: ÖZELDMKELİME on bin');
const delId = await post(pelin, 'ch_genel', 'silinecekkelime bu mesaj');
await post(emre, clientCh, 'Müşteri kanalında şıkışmış revizyon');

console.log('Erişim ve doğrulama');
await t('girişsiz 401', async () => { const r = await new Client().get('/api/search?q=cavus'); eq(r.status, 401); });
await t('boş sorgu: boş gruplar', async () => {
  const r = await S(yigit, ''); eq(r.status, 200);
  for (const k of ['tasks', 'clients', 'shoots', 'days', 'agenda', 'messages', 'people']) eq(r.data[k].length, 0, k);
});
await t('tek harf ve boşluk: boş', async () => {
  for (const q of ['a', ' ', '  ç  ']) { const r = await S(yigit, q); eq(r.status, 200); eq(r.data.tasks.length + r.data.clients.length, 0, q); }
});
await t('SQL/LIKE özel karakterleri güvenli', async () => {
  for (const q of ["%' OR 1=1 --", '%%', '__', "'; DROP TABLE tasks; --"]) { const r = await S(yigit, q); eq(r.status, 200, q); eq(r.data.tasks.length, 0, q); }
  ok(sql('SELECT COUNT(*) AS n FROM tasks')[0].n > 0);
});
await t('çok uzun sorgu kısaltılır', async () => { const r = await S(yigit, 'x'.repeat(5000)); eq(r.status, 200); ok(r.data.q.length <= 80); });

console.log('Gruplar ve Türkçe karakter duyarsızlığı');
await t('"cavus" → Çavuşdent işleri ve müşterisi', async () => {
  const r = await S(yigit, 'cavus');
  ok(r.data.tasks.length > 0 && r.data.tasks.every((x) => /Çavuş/i.test(x.title + x.client)), 'iş yok');
  ok(r.data.clients.some((c) => c.name === 'Çavuşdent'), 'müşteri yok');
  ok(r.data.clients[0].link.startsWith('/musteriler?id='));
});
await t('"ÇAVUŞ" ve "çavuş" aynı sonuç', async () => {
  const a = await S(yigit, 'ÇAVUŞ'), b = await S(yigit, 'çavuş'), c = await S(yigit, 'CAVUS');
  eq(JSON.stringify(ids(a.data.tasks)), JSON.stringify(ids(b.data.tasks))); eq(JSON.stringify(ids(a.data.tasks)), JSON.stringify(ids(c.data.tasks)));
});
await t('"İSTANBUL" / "istanbul" / "ıstanbul": iş başlığı, iş notu, çekim lokasyonu', async () => {
  for (const q of ['İSTANBUL', 'istanbul', 'ıstanbul', 'ISTANBUL']) {
    const r = await S(yigit, q);
    ok(ids(r.data.tasks).includes('t_ara1'), q + ' başlık'); ok(ids(r.data.tasks).includes('t_ara2'), q + ' not');
    ok(ids(r.data.shoots).includes('s_ara1'), q + ' çekim'); eq(r.data.shoots[0].link, '/cekim?id=s_ara1');
  }
});
await t('tamamlanan işler altta ve işaretli', async () => {
  const r = await S(yigit, 'istanbul');
  const i1 = ids(r.data.tasks).indexOf('t_ara1'), i2 = ids(r.data.tasks).indexOf('t_ara2');
  ok(i1 < i2, 'sıra'); eq(r.data.tasks[i2].done, true); eq(r.data.tasks[i1].done, false);
  const all = await S(yigit, 'cavus'); const d = all.data.tasks.map((x) => x.done);
  ok(d.indexOf(true) === -1 || d.slice(d.indexOf(true)).every(Boolean), 'tamamlananlar arada');
});
await t('"isikli" → Işıklı (not alanı), birden çok kelime', async () => {
  ok(ids((await S(yigit, 'isikli')).data.tasks).includes('t_ara3'));
  ok(ids((await S(yigit, 'sube vitrin')).data.tasks).includes('t_ara3'), 'iki kelime');
  eq((await S(yigit, 'sube olmayankelime')).data.tasks.length, 0, 'tüm kelimeler gerekli');
});
await t('grup başına en fazla 6', async () => {
  const r = await S(yigit, 'an');
  for (const k of ['tasks', 'clients', 'shoots', 'days', 'agenda', 'messages', 'people']) ok(r.data[k].length <= 6, k);
});
await t('özel gün: "ogretmenler"', async () => {
  const r = await S(yigit, 'ogretmenler'); ok(ids(r.data.days).includes('d_ara1')); eq(r.data.days.find((d) => d.id === 'd_ara1').link, '/ozel-gunler?id=d_ara1');
});
await t('kişiler: "pelin" (kendisi değil, aktif)', async () => {
  const r = await S(yigit, 'pelin'); ok(ids(r.data.people).includes('u_pelin'));
  ok(!ids((await S(yigit, 'yigit')).data.people).includes('u_yigit'), 'kendisi dönmemeli');
  ok(ids((await S(pelin, 'yigit')).data.people).includes('u_yigit'), 'ğ duyarsız');
  ok(!ids((await S(yigit, 'volkan')).data.people).includes('u_volkan'), 'etkin olmayan dönmemeli');
});

console.log('Ajandam gizliliği');
await t('Pelin kendi notunu/yapılacağını/etkinliğini bulur', async () => {
  const r = await S(pelin, 'zumrut'); const a = r.data.agenda;
  ok(a.some((x) => x.id === 'an_ara1' && x.link === '/ajanda?not=an_ara1'), 'not');
  ok(a.some((x) => x.id === 'at_ara1' && x.link === '/ajanda?r=at_ara1'), 'yapılacak');
  ok(a.some((x) => x.id === 'ae_ara1' && x.link === '/ajanda?r=ae_ara1'), 'etkinlik');
  ok(!a.some((x) => x.id === 'at_ara2'), 'Yiğit’inki dönmemeli');
});
await t('Yiğit başkasının Ajandam’ını bulamaz', async () => {
  const a = (await S(yigit, 'zümrüt')).data.agenda;
  ok(a.some((x) => x.id === 'at_ara2'), 'kendi'); ok(!a.some((x) => x.id.endsWith('ara1')), 'Pelin’inki döndü');
  eq((await S(emre, 'zumrutkelime')).data.agenda.length, 0);
});

console.log('Sohbet gizliliği');
await t('genel kanal mesajı herkes bulur (Ç/ğ duyarsız)', async () => {
  const r = await S(emre, 'caglayan'); ok(r.data.messages.length === 1, JSON.stringify(r.data.messages));
  eq(r.data.messages[0].link, '/sohbet?c=ch_genel'); eq(r.data.messages[0].channel, 'genel'); ok(r.data.messages[0].text.includes('Çağlayan'));
});
await t('müşteri kanalı mesajı bulunur', async () => { const r = await S(yigit, 'sikismis'); eq(r.data.messages.length, 1); eq(r.data.messages[0].channelId, clientCh); });
await t('DM: iki taraf bulur, üçüncü kişi bulamaz', async () => {
  const y = await S(yigit, 'ozeldmkelime'), p = await S(pelin, 'ÖZELDMKELİME'), e = await S(emre, 'ozeldmkelime');
  eq(y.data.messages.length, 1); eq(p.data.messages.length, 1); eq(e.data.messages.length, 0, 'Emre DM’i gördü');
  eq(p.data.messages[0].dmWith, 'u_yigit'); eq(p.data.messages[0].kind, 'dm'); eq(p.data.messages[0].link, '/sohbet?c=' + dm.id);
  eq((await S(emre, 'gizli fiyat')).data.messages.length, 0);
});
await t('silinen mesaj dönmez', async () => {
  eq((await S(yigit, 'silinecekkelime')).data.messages.length, 1, 'silmeden önce');
  const d = await pelin.del('/api/chat/messages/' + delId); ok(d.status === 200 || d.status === 204, 'silme ' + d.status);
  eq((await S(yigit, 'silinecekkelime')).data.messages.length, 0);
});

console.log('Performans');
await t('sunucu süresi ≤ 150 ms', async () => {
  let worst = 0;
  for (const q of ['cavus', 'istanbul', 'an', 'post story', 'zümrüt']) { const r = await S(yigit, q); worst = Math.max(worst, r.data.ms); }
  ok(worst <= 150, 'en kötü ' + worst + ' ms');
  console.log('    (en kötü sunucu süresi ' + worst + ' ms)');
});

void BASE;
done();
