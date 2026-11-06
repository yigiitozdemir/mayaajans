// Uçtan uca API testi — yerel `wrangler dev --local --test-scheduled` sunucusuna karşı çalışır.
// Kullanım: node test/api.e2e.mjs [http://127.0.0.1:8787]
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

const BASE = process.argv[2] || 'http://127.0.0.1:8787';
let pass = 0, fail = 0; const fails = [];
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (s) => b64url(createHash('sha256').update(s).digest());

function sql(q) {
  return execSync(`npx wrangler d1 execute maya-ekip --local --json --command ${JSON.stringify(q)}`, { env: { ...process.env, CLOUDFLARE_API_TOKEN: 'proxy-injected' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}
function bootstrapLink(userId) {
  const token = b64url(randomBytes(24));
  sql(`INSERT INTO invites (id, user_id, kind, expires_at) VALUES ('${sha(token)}', '${userId}', 'invite', datetime('now', '+1 day'))`);
  return token;
}

class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body, headers = {}) {
    const r = await fetch(BASE + path, {
      method, headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) { const m = /maya_s=([^;]*)/.exec(sc); if (m) this.cookie = m[1] ? 'maya_s=' + m[1] : ''; }
    let data = null; try { data = await r.json(); } catch { /* */ }
    return { status: r.status, data, setCookie: sc };
  }
  get(p) { return this.req('GET', p); } post(p, b) { return this.req('POST', p, b ?? {}); }
  patch(p, b) { return this.req('PATCH', p, b); } del(p) { return this.req('DELETE', p); }
}

async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message); console.log('  ✗ ' + name + ' → ' + e.message); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} beklenen ${JSON.stringify(b)}, gelen ${JSON.stringify(a)}`); };

function openLive(client) {
  const msgs = [];
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/api/live', { headers: { Cookie: client.cookie } });
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = (e) => rej(new Error('ws açılamadı')); });
  ws.onmessage = (e) => { if (e.data !== 'pong') msgs.push(JSON.parse(e.data)); };
  ws.closed = new Promise((res) => { ws.onclose = (e) => res(e.code); });
  return { ws, msgs, ready };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(100); } return false; }

const admin = new Client(), pelin = new Client(), anon = new Client();
let adminToken, createdTaskId, pelinTaskId;

console.log('\nGiriş ve oturum');
await t('sağlık kontrolü', async () => eq((await anon.get('/api/health')).status, 200));
await t('girişsiz istek reddedilir', async () => eq((await anon.get('/api/me')).status, 401));
await t('kurulum bağlantısı bilgisi', async () => {
  adminToken = bootstrapLink('u_yigit');
  const r = await anon.get('/api/auth/invite/' + adminToken); eq(r.status, 200); eq(r.data.email, 'yigiitozdemir@gmail.com');
});
await t('kısa şifre reddedilir', async () => eq((await anon.post('/api/auth/accept', { token: adminToken, firstName: 'Yiğit', password: 'kisa' })).status, 400));
await t('yönetici şifresini belirler ve giriş yapar', async () => {
  const r = await admin.post('/api/auth/accept', { token: adminToken, firstName: 'Yiğit', lastName: 'Özdemir', password: 'GucluSifre123' });
  eq(r.status, 200); ok(admin.cookie, 'çerez yok'); ok(/HttpOnly/i.test(r.setCookie) && /Secure/i.test(r.setCookie) && /Max-Age=31536000/.test(r.setCookie), 'çerez ayarları: ' + r.setCookie);
});
await t('aynı bağlantı ikinci kez kullanılamaz', async () => eq((await anon.get('/api/auth/invite/' + adminToken)).status, 404));
await t('yönetici bilgisi', async () => { const r = await admin.get('/api/me'); eq(r.data.role, 'admin'); eq(r.data.lastName, 'Özdemir'); });
await t('çıkış ve tekrar giriş (oturum açık kalsın)', async () => {
  await admin.post('/api/auth/logout'); eq((await admin.get('/api/me')).status, 401);
  eq((await admin.post('/api/auth/login', { email: 'YIGIITOZDEMIR@gmail.com', password: 'yanlis-sifre' })).status, 401);
  const r = await admin.post('/api/auth/login', { email: 'yigiitozdemir@gmail.com', password: 'GucluSifre123', remember: true });
  eq(r.status, 200); eq((await admin.get('/api/me')).status, 200);
});
await t('8 hatalı denemeden sonra geçici kilit', async () => {
  const x = new Client(); let last;
  for (let i = 0; i < 9; i++) last = await x.post('/api/auth/login', { email: 'kilit@deneme.com', password: 'yanlis' });
  eq(last.status, 429);
});
await t('başka siteden gelen istek reddedilir', async () => eq((await admin.req('POST', '/api/tasks', { title: 'x', dueDate: '2026-12-01' }, { Origin: 'https://kotu-site.com' })).status, 403));

console.log('\nEkip yönetimi');
await t('ekip listesi Slack üyeleriyle gelir', async () => { const r = await admin.get('/api/team'); eq(r.data.length, 6); });
await t('bekleyen üyeye davet bağlantısı', async () => {
  const r = await admin.post('/api/admin/users/u_pelin/link'); eq(r.status, 200); eq(r.data.kind, 'invite');
  const token = r.data.link.split('/davet/')[1];
  const a = await pelin.post('/api/auth/accept', { token, firstName: 'Pelin', lastName: 'Yılmaz', password: 'PelinSifre9' }); eq(a.status, 200);
  const me = await pelin.get('/api/me'); eq(me.data.role, 'member'); eq(me.data.canEditClients, false);
});
await t('yeni üye davet + aynı e-posta tekrar edilemez', async () => {
  const r = await admin.post('/api/admin/invite', { email: 'yeni@mayaajans.net' }); eq(r.status, 200); ok(r.data.link.includes('/davet/'));
  eq((await admin.post('/api/admin/invite', { email: 'pelin@mayaajans.net' })).status, 409);
  eq((await admin.post('/api/admin/invite', { email: 'gecersiz' })).status, 400);
});
await t('üye yönetici işlemi yapamaz', async () => {
  eq((await pelin.get('/api/admin/users')).status, 403);
  eq((await pelin.post('/api/admin/invite', { email: 'x@y.co' })).status, 403);
  eq((await pelin.del('/api/admin/users/u_esra')).status, 403);
});
await t('müşteri kartı düzenleme yetkisi', async () => {
  eq((await admin.patch('/api/admin/users/u_pelin', { canEditClients: true })).status, 200);
  eq((await pelin.get('/api/me')).data.canEditClients, true);
});
await t('yönetici kendini çıkaramaz', async () => eq((await admin.del('/api/admin/users/u_yigit')).status, 400));
await t('üye ekipten çıkarılır', async () => {
  eq((await admin.del('/api/admin/users/u_esra')).status, 200);
  ok(!(await admin.get('/api/team')).data.some((u) => u.id === 'u_esra'));
});

console.log('\nProfil (tek profil)');
await t('profil güncelleme herkese yansır', async () => {
  const r = await pelin.patch('/api/me', { firstName: 'Pelin', lastName: 'Kaya', settings: { quietHours: false, bilinmeyen: 1 } }); eq(r.status, 200);
  const team = (await admin.get('/api/team')).data; ok(team.some((u) => u.name === 'Pelin Kaya'), 'yönetici yeni adı görmüyor');
  const me = (await pelin.get('/api/me')).data; eq(me.settings.quietHours, false); ok(!('bilinmeyen' in me.settings), 'izin verilmeyen ayar kaydedildi');
});
await t('boş ad ve geçersiz fotoğraf reddedilir', async () => {
  eq((await pelin.patch('/api/me', { firstName: '  ' })).status, 400);
  eq((await pelin.patch('/api/me', { photo: 'javascript:alert(1)' })).status, 400);
  eq((await pelin.patch('/api/me', { photo: 'data:image/png;base64,iVBORw0KGgo=' })).status, 200);
});

console.log('\nİş Planı');
await t('Slack işleri aktarılmış (85 iş, 36 açık)', async () => {
  const r = await admin.get('/api/tasks'); eq(r.data.length, 85); eq(r.data.filter((x) => x.status !== 2).length, 36);
});
await t('teslim tarihi olmadan iş eklenemez', async () => {
  eq((await admin.post('/api/tasks', { title: 'Tarihsiz' })).status, 400);
  eq((await admin.post('/api/tasks', { title: 'Yanlış tarih', dueDate: '2026-02-30' })).status, 400);
  eq((await admin.post('/api/tasks', { title: '', dueDate: '2026-12-01' })).status, 400);
});
await t('canlı bağlantı: atanan kişiye anında bildirim + herkese liste güncellemesi', async () => {
  const live = openLive(pelin); await live.ready;
  const r = await admin.post('/api/tasks', { title: 'Vatan Aralık postları', client: 'Vatan Hastanesi', assigneeId: 'u_pelin', dueDate: '2026-11-20', items: ['TR', 'BG'], link: 'https://drive.google.com/x' });
  eq(r.status, 201); createdTaskId = r.data.id;
  ok(await until(() => live.msgs.some((m) => m.type === 'notify' && m.notification.taskId === createdTaskId)), 'bildirim gelmedi: ' + JSON.stringify(live.msgs));
  ok(await until(() => live.msgs.some((m) => m.type === 'tasks')), 'liste güncellemesi gelmedi');
  live.ws.close();
});
await t('okunmamış atama işi açınca okunur', async () => {
  let n = (await pelin.get('/api/notifications')).data; const mine = n.find((x) => x.taskId === createdTaskId); ok(mine && !mine.readAt, 'okunmamış bildirim yok');
  eq((await pelin.post('/api/notifications/read', { taskId: createdTaskId })).status, 200);
  n = (await pelin.get('/api/notifications')).data; ok(n.find((x) => x.taskId === createdTaskId).readAt, 'okundu olmadı');
});
await t('kendine atadığın işte bildirim oluşmaz', async () => {
  const r = await pelin.post('/api/tasks', { title: 'Kendi işim', assigneeId: 'u_pelin', dueDate: '2026-11-25' }); eq(r.status, 201); pelinTaskId = r.data.id;
  ok(!(await pelin.get('/api/notifications')).data.some((x) => x.taskId === pelinTaskId));
});
await t('durum değişimi ve tamamlanma zamanı', async () => {
  const r = await pelin.patch('/api/tasks/' + createdTaskId, { status: 2 }); eq(r.data.status, 2); ok(r.data.completedAt);
  const r2 = await pelin.patch('/api/tasks/' + createdTaskId, { status: 1 }); eq(r2.data.completedAt, null);
});
await t('teslim tarihi silinemez, sadece değiştirilir', async () => {
  eq((await pelin.patch('/api/tasks/' + createdTaskId, { dueDate: null })).status, 400);
  eq((await pelin.patch('/api/tasks/' + createdTaskId, { dueDate: '2026-11-22' })).data.dueDate, '2026-11-22');
});
await t('Slack\'ten gelen tarihsiz işe tarih verilebilir', async () => {
  const noDate = (await pelin.get('/api/tasks')).data.find((x) => !x.dueDate && x.status !== 2);
  eq((await pelin.patch('/api/tasks/' + noDate.id, { dueDate: '2026-11-30' })).data.dueDate, '2026-11-30');
});
await t('güvensiz link reddedilir', async () => eq((await pelin.patch('/api/tasks/' + createdTaskId, { link: 'javascript:alert(1)' })).status, 400));
await t('silme: sadece ekleyen ya da yönetici', async () => {
  eq((await pelin.del('/api/tasks/' + createdTaskId)).status, 403);
  eq((await pelin.del('/api/tasks/' + pelinTaskId)).status, 200);
});
await t('başkasına yeniden atama bildirim üretir', async () => {
  const r = await pelin.patch('/api/tasks/' + createdTaskId, { assigneeId: 'u_yigit' }); eq(r.status, 200);
  ok((await admin.get('/api/notifications')).data.some((x) => x.taskId === createdTaskId && !x.readAt));
});

console.log('\nSaatlik hatırlatma');
await t('okunmamış atama 1 saat sonra hatırlatılır', async () => {
  // Pelin'e yeni atama, 2 saat önce oluşturulmuş gibi
  const r = await admin.post('/api/tasks', { title: 'Hatırlatma testi', assigneeId: 'u_pelin', dueDate: '2026-11-21' });
  sql(`UPDATE notifications SET created_at = datetime('now', '-2 hours') WHERE task_id = '${r.data.id}'`);
  const live = openLive(pelin); await live.ready;
  const s = await fetch(BASE + '/cdn-cgi/local/explorer/api/local/scheduled?worker=maya-ekip', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cron: '5 * * * *' }) });
  ok(s.ok, 'zamanlanmış görev tetiklenemedi: ' + s.status + ' ' + (await s.text()).slice(0, 200));
  ok(await until(() => live.msgs.some((m) => m.type === 'remind' && m.notification.taskId === r.data.id)), 'hatırlatma gelmedi');
  const n = (await pelin.get('/api/notifications')).data.find((x) => x.taskId === r.data.id); eq(n.reminders, 1);
  live.ws.close();
});

console.log('\nOturum kapatma');
await t('yönetici üyenin bütün oturumlarını kapatır → anında çıkış', async () => {
  const live = openLive(pelin); await live.ready;
  eq((await admin.del('/api/admin/users/u_pelin/sessions')).status, 200);
  ok(await until(() => live.msgs.some((m) => m.type === 'session-revoked')), 'oturum kapatma mesajı gelmedi');
  eq((await pelin.get('/api/me')).status, 401);
});

console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
fails.forEach((f) => console.log('  ✗ ' + f));
process.exit(fail ? 1 : 0);
