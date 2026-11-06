// Müşteriler bölümü API testi
// BASE=http://127.0.0.1:8801 PERSIST=.wrangler/state-musteriler node test/musteriler.e2e.mjs
import { BASE, loginAs, t, ok, eq, until, openLive, sql, done, Client } from './lib.mjs';

const yigit = await loginAs('u_yigit', 'Yiğit');
const pelin = await loginAs('u_pelin', 'Pelin');
const emre = await loginAs('u_emre', 'Emre');
sql("UPDATE users SET can_edit_clients = 0 WHERE id IN ('u_pelin','u_emre')");
sql("DELETE FROM client_files WHERE client_id IN ('c_01','c_04')"); // önceki koşulardan kalanlar

const uniq = 'Test Firma ' + Date.now().toString(36);
let newId = '';
const live = openLive(pelin);
await live.ready;

console.log('Liste');
await t('giriş yapmadan liste 401', async () => { eq((await new Client().get('/api/clients')).status, 401); });
await t('liste dizi ve en az {id,name,slack_channel}', async () => {
  const r = await pelin.get('/api/clients');
  eq(r.status, 200); ok(Array.isArray(r.data), 'dizi değil');
  ok(r.data.length >= 26, 'en az 26 müşteri olmalı: ' + r.data.length);
  const a = r.data.find((x) => x.id === 'c_01');
  ok(a && a.name === 'Arslandent' && a.slack_channel === 'arslandent', 'c_01 şekli');
  ok(r.data.every((x) => typeof x.id === 'string' && typeof x.name === 'string' && 'slack_channel' in x), 'alanlar');
});
await t('tek müşteri detayı: kit + dosyalar + kanal', async () => {
  const r = await pelin.get('/api/clients/c_01');
  eq(r.status, 200); ok(r.data.kit && Array.isArray(r.data.kit.colors) && Array.isArray(r.data.files), 'kit/dosyalar');
  eq(r.data.channel?.id, 'ch_c_01', 'kanal');
});
await t('olmayan müşteri 404', async () => { eq((await pelin.get('/api/clients/c_yok')).status, 404); });

console.log('Ekle / kaldır (yönetici)');
await t('üye müşteri ekleyemez (403)', async () => { eq((await pelin.post('/api/clients', { name: uniq })).status, 403); });
await t('boş ad 400', async () => { eq((await yigit.post('/api/clients', { name: '  ' })).status, 400); });
await t('yönetici ekler → 201, kanal açılır, canlı yayın', async () => {
  live.msgs.length = 0;
  const r = await yigit.post('/api/clients', { name: uniq + ' Çiçekçi' });
  eq(r.status, 201, JSON.stringify(r.data)); newId = r.data.id;
  ok(r.data.slack_channel && /^[a-z0-9-]+$/.test(r.data.slack_channel), 'kanal adı tireli küçük harf: ' + r.data.slack_channel);
  ok(r.data.slack_channel.endsWith('-cicekci'), 'Türkçe karakterler sadeleşmeli: ' + r.data.slack_channel);
  const ch = sql(`SELECT * FROM channels WHERE id = 'ch_${newId}'`)[0];
  ok(ch, 'kanal yok'); eq(ch.kind, 'client'); eq(ch.client_id, newId); eq(ch.topic, uniq + ' Çiçekçi'); eq(ch.archived, 0);
  ok(await until(() => live.msgs.some((m) => m.type === 'clients' && m.id === newId && m.action === 'added')), 'canlı yayın gelmedi');
});
await t('listede görünür', async () => { ok((await pelin.get('/api/clients')).data.some((x) => x.id === newId)); });
await t('aynı isim (büyük/küçük harf farklı) 409', async () => {
  const r = await yigit.post('/api/clients', { name: (uniq + ' çiçekçi').toLocaleUpperCase('tr') });
  eq(r.status, 409); eq(r.data.id, newId);
});
await t('üye kaldıramaz (403)', async () => { eq((await pelin.del('/api/clients/' + newId)).status, 403); });
await t('yönetici kaldırır → archived=1, kanal arşiv, listeden düşer', async () => {
  live.msgs.length = 0;
  eq((await yigit.del('/api/clients/' + newId)).status, 200);
  eq(sql(`SELECT archived FROM clients WHERE id = '${newId}'`)[0].archived, 1);
  eq(sql(`SELECT archived FROM channels WHERE id = 'ch_${newId}'`)[0].archived, 1);
  ok(!(await pelin.get('/api/clients')).data.some((x) => x.id === newId), 'hâlâ listede');
  ok((await yigit.get('/api/clients?archived=1')).data.some((x) => x.id === newId && x.archived), 'arşiv listesinde yok');
  ok(await until(() => live.msgs.some((m) => m.type === 'clients' && m.id === newId && m.action === 'archived')), 'canlı yayın');
});
await t('arşivliyle aynı adla ekleme → geri getirir, kanal açılır', async () => {
  const r = await yigit.post('/api/clients', { name: uniq + ' çiçekçi' });
  eq(r.status, 200); eq(r.data.id, newId); eq(r.data.reactivated, true);
  eq(sql(`SELECT archived FROM clients WHERE id = '${newId}'`)[0].archived, 0);
  eq(sql(`SELECT archived FROM channels WHERE id = 'ch_${newId}'`)[0].archived, 0);
});

console.log('Marka kiti düzenleme yetkisi');
await t('yetkisiz üye PATCH 403', async () => { eq((await pelin.patch('/api/clients/c_01', { sector: 'Diş kliniği' })).status, 403); });
await t('yetkisiz üye not ekleyemez 403', async () => { eq((await pelin.post('/api/clients/c_01/notes', { text: 'x' })).status, 403); });
await t('yönetici kısmi güncelleme (sektör, sorumlu, renkler, fontlar)', async () => {
  live.msgs.length = 0;
  const r = await yigit.patch('/api/clients/c_01', {
    sector: ' Diş kliniği ', owner: 'u_pelin',
    colors: [{ hex: '0e5e6f', name: 'Petrol' }, { hex: '#fff', name: 'Beyaz' }],
    fonts: [{ name: 'Poppins', use: 'Başlık' }, { name: 'Inter', use: 'Metin' }],
  });
  eq(r.status, 200, JSON.stringify(r.data));
  eq(r.data.kit.sector, 'Diş kliniği'); eq(r.data.kit.owner, 'u_pelin');
  eq(r.data.kit.colors[0].hex, '#0E5E6F'); eq(r.data.kit.colors[1].hex, '#FFFFFF');
  eq(r.data.kit.fonts[1].use, 'Gövde');
  ok(await until(() => live.msgs.some((m) => m.type === 'clients' && m.id === 'c_01' && m.action === 'kit')), 'canlı yayın');
});
await t('kısmi: sadece ton gönderince diğerleri korunur', async () => {
  const r = await yigit.patch('/api/clients/c_01', { tone: ['Samimi', 'samimi', ' Güven veren '], banned: ['garanti'] });
  eq(r.status, 200); eq(r.data.kit.tone.length, 2); eq(r.data.kit.sector, 'Diş kliniği'); eq(r.data.kit.colors.length, 2);
});
await t('hashtag setleri ve bağlantılar', async () => {
  const r = await yigit.patch('/api/clients/c_01', { tagSets: [{ name: 'Genel', tags: 'dis, #gulus  tekirdag' }], links: { instagram: 'instagram.com/arslandent', web: 'https://arslandent.com' } });
  eq(r.status, 200); eq(r.data.kit.tagSets[0].tags, '#dis #gulus #tekirdag');
  eq(r.data.kit.links.instagram, 'https://instagram.com/arslandent');
  const r2 = await yigit.patch('/api/clients/c_01', { links: { web: '' } });
  ok(!r2.data.kit.links.web && r2.data.kit.links.instagram, 'boş bağlantı silinir, diğeri kalır');
});
await t('doğrulama: kötü hex, kötü url, bilinmeyen sorumlu, uzun sektör, çok renk, kötü kullanım', async () => {
  eq((await yigit.patch('/api/clients/c_01', { colors: [{ hex: 'zzz' }] })).status, 400);
  eq((await yigit.patch('/api/clients/c_01', { links: { web: 'javascript:alert(1)' } })).status, 400);
  eq((await yigit.patch('/api/clients/c_01', { links: { myspace: 'https://a.com' } })).status, 400);
  eq((await yigit.patch('/api/clients/c_01', { owner: 'u_yok' })).status, 400);
  eq((await yigit.patch('/api/clients/c_01', { sector: 'x'.repeat(81) })).status, 400);
  eq((await yigit.patch('/api/clients/c_01', { colors: Array.from({ length: 31 }, () => ({ hex: '#000000' })) })).status, 400);
  eq((await yigit.patch('/api/clients/c_01', { fonts: [{ name: 'A', use: 'Süs' }] })).status, 400);
  eq((await yigit.patch('/api/clients/c_01', {})).status, 400);
});
await t('notlar: ekle (by/at sunucuda), sil', async () => {
  const r = await yigit.post('/api/clients/c_01/notes', { text: 'Hekim fotoğrafları onaysız paylaşılmaz.' });
  eq(r.status, 201); const n = r.data.kit.notes[0]; eq(n.by, 'u_yigit'); ok(n.id && n.at);
  eq((await yigit.post('/api/clients/c_01/notes', { text: 'x'.repeat(2001) })).status, 400);
  const d = await yigit.del('/api/clients/c_01/notes/' + n.id); eq(d.status, 200);
  ok(!d.data.kit.notes.some((x) => x.id === n.id));
});
await t('yetki verilen üye (yönetici PATCH /admin/users) düzenleyebilir', async () => {
  eq((await emre.patch('/api/clients/c_02', { sector: 'Şemsiye' })).status, 403);
  eq((await yigit.patch('/api/admin/users/u_emre', { canEditClients: true })).status, 200);
  const r = await emre.patch('/api/clients/c_02', { sector: 'Şemsiye üretimi' });
  eq(r.status, 200); eq(r.data.kit.sector, 'Şemsiye üretimi');
  eq((await emre.post('/api/clients', { name: 'Emre Firma' })).status, 403, 'yetki ekleme hakkı vermez');
  eq((await emre.del('/api/clients/c_02')).status, 403, 'yetki kaldırma hakkı vermez');
});
await t('sql ile yetki verilen üye düzenleyebilir, geri alınca 403', async () => {
  sql("UPDATE users SET can_edit_clients = 1 WHERE id = 'u_pelin'");
  eq((await pelin.patch('/api/clients/c_03', { sector: 'Mimarlık' })).status, 200);
  sql("UPDATE users SET can_edit_clients = 0 WHERE id = 'u_pelin'");
  eq((await pelin.patch('/api/clients/c_03', { sector: 'X' })).status, 403);
});

console.log('Logolar / dosyalar');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f0005000201a5f4d6e10000000049454e44ae426082', 'hex');
const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script><rect width="10" height="10"/></svg>');
const form = (buf, name, variant, type = 'application/octet-stream') => { const f = new FormData(); f.append('file', new Blob([buf], { type }), name); if (variant) f.append('variant', variant); return f; };
let pngId = '', svgId = '';
await t('yetkisiz üye yükleyemez 403', async () => { eq((await pelin.req('POST', '/api/clients/c_01/files', form(png, 'logo.png', 'Renkli'))).status, 403); });
await t('renkli PNG yükle (Türkçe ad)', async () => {
  live.msgs.length = 0;
  const r = await yigit.req('POST', '/api/clients/c_01/files', form(png, 'Arslandent Renkli Logo Ş.png', 'Renkli'));
  eq(r.status, 201, JSON.stringify(r.data)); pngId = r.data.id;
  eq(r.data.variant, 'Renkli'); eq(r.data.contentType, 'image/png'); eq(r.data.size, png.length); eq(r.data.isImage, true);
  const row = sql(`SELECT r2_key FROM client_files WHERE id = '${pngId}'`)[0];
  ok(row.r2_key.startsWith(`clients/c_01/${pngId}/`) && /^[A-Za-z0-9/_.-]+$/.test(row.r2_key), 'R2 anahtarı: ' + row.r2_key);
  ok(await until(() => live.msgs.some((m) => m.type === 'clients' && m.id === 'c_01' && m.action === 'files')), 'canlı yayın');
});
await t('aynı varyanta ikinci dosya (SVG) ve beyaz varyant', async () => {
  const r = await emre.req('POST', '/api/clients/c_01/files', form(svg, 'logo.svg', 'Renkli', 'text/html'));
  eq(r.status, 201); svgId = r.data.id; eq(r.data.contentType, 'image/svg+xml', 'tür uzantıdan, istemciye güvenilmez');
  eq((await yigit.req('POST', '/api/clients/c_01/files', form(png, 'beyaz.png', 'Beyaz'))).status, 201);
  const d = await pelin.get('/api/clients/c_01');
  eq(d.data.files.filter((f) => f.variant === 'Renkli').length, 2); eq(d.data.files.filter((f) => f.variant === 'Beyaz').length, 1);
  eq(d.data.logoFileId, pngId, 'liste önizlemesi renkli (beyaz değil)');
  const l = (await pelin.get('/api/clients')).data.find((x) => x.id === 'c_01');
  eq(l.logoFileId, pngId); eq(l.fileCount, 3);
});
await t('üye indirir: baytlar aynı, Content-Disposition attachment + orijinal ad', async () => {
  const r = await pelin.get(`/api/clients/c_01/files/${pngId}?download=1`);
  eq(r.status, 200); ok(Buffer.from(r.data).equals(png), 'içerik farklı');
  const cd = r.headers.get('content-disposition');
  ok(cd.startsWith('attachment;'), cd);
  ok(cd.includes("filename*=UTF-8''" + encodeURIComponent('Arslandent Renkli Logo Ş.png')), cd);
  ok(/filename="[A-Za-z0-9._-]+"/.test(cd), 'ascii yedek ad: ' + cd);
  eq(r.headers.get('content-type'), 'image/png'); eq(r.headers.get('x-content-type-options'), 'nosniff');
});
await t('önizleme satır içi; SVG sandbox CSP ile', async () => {
  const r = await pelin.get(`/api/clients/c_01/files/${pngId}`);
  ok(r.headers.get('content-disposition').startsWith('inline'));
  const s = await pelin.get(`/api/clients/c_01/files/${svgId}`);
  eq(s.headers.get('content-type'), 'image/svg+xml'); ok(/sandbox/.test(s.headers.get('content-security-policy')));
  ok(Buffer.from(s.data).equals(svg));
});
await t('başka müşterinin yoluyla dosya alınamaz 404', async () => { eq((await pelin.get(`/api/clients/c_02/files/${pngId}`)).status, 404); });
await t('izinsiz tür reddi (415): html, exe, uzantısız', async () => {
  eq((await yigit.req('POST', '/api/clients/c_01/files', form(Buffer.from('<h1>x</h1>'), 'a.html', 'Diğer'))).status, 415);
  eq((await yigit.req('POST', '/api/clients/c_01/files', form(Buffer.from('MZ'), 'kur.exe', 'Diğer'))).status, 415);
  eq((await yigit.req('POST', '/api/clients/c_01/files', form(Buffer.from('x'), 'dosya', 'Diğer'))).status, 415);
});
await t('geçersiz varyant 400, dosyasız 400', async () => {
  eq((await yigit.req('POST', '/api/clients/c_01/files', form(png, 'a.png', 'Mor'))).status, 400);
  const f = new FormData(); f.append('variant', 'Renkli');
  eq((await yigit.req('POST', '/api/clients/c_01/files', f)).status, 400);
});
await t('pdf/ai/eps/zip kabul, indirmede attachment', async () => {
  for (const n of ['kit.pdf', 'logo.ai', 'logo.eps', 'paket.zip']) {
    const r = await yigit.req('POST', '/api/clients/c_04/files', form(Buffer.from('%PDF-1.4 test ' + n), n, 'Diğer'));
    eq(r.status, 201, n);
    const g = await pelin.get(`/api/clients/c_04/files/${r.data.id}`);
    ok(g.headers.get('content-disposition').startsWith('attachment'), n + ' satır içi açılmamalı');
  }
});
await t('boyut sınırı 25 MB (413)', async () => {
  const big = Buffer.alloc(25 * 1024 * 1024 + 10, 1);
  eq((await yigit.req('POST', '/api/clients/c_01/files', form(big, 'buyuk.png', 'Renkli'))).status, 413);
});
await t('silme: yetkisiz 403, yetkili siler (R2 dahil)', async () => {
  eq((await pelin.del(`/api/clients/c_01/files/${svgId}`)).status, 403);
  const key = sql(`SELECT r2_key FROM client_files WHERE id = '${svgId}'`)[0].r2_key;
  ok(key);
  eq((await emre.del(`/api/clients/c_01/files/${svgId}`)).status, 200);
  eq(sql(`SELECT COUNT(*) AS n FROM client_files WHERE id = '${svgId}'`)[0].n, 0);
  eq((await pelin.get(`/api/clients/c_01/files/${svgId}`)).status, 404);
  eq((await emre.del(`/api/clients/c_01/files/${svgId}`)).status, 404);
});
await t('yetki geri alınınca emre yükleyemez', async () => {
  eq((await yigit.patch('/api/admin/users/u_emre', { canEditClients: false })).status, 200);
  eq((await emre.req('POST', '/api/clients/c_01/files', form(png, 'x.png', 'Siyah'))).status, 403);
});
await t('başka siteden istek reddedilir', async () => {
  eq((await yigit.req('POST', '/api/clients', { name: 'Kötü' }, { Origin: 'https://kotu.example' })).status, 403);
});

// temizlik
await yigit.del('/api/clients/' + newId);
live.ws.close();
console.log('BASE ' + BASE);
done();
