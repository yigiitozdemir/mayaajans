// Bölüm testleri için ortak yardımcılar.
// Ortam: BASE=http://127.0.0.1:<port>  PERSIST=.wrangler/state-<bölüm> (wrangler dev --persist-to ile aynı)
import { execSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

export const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const PERSIST = process.env.PERSIST ? ` --persist-to ${process.env.PERSIST}` : '';
let pass = 0, fail = 0; const fails = [];
const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const sha = (s) => b64url(createHash('sha256').update(s).digest());

export function sql(q) {
  const out = execSync(`npx wrangler d1 execute maya-ekip --local${PERSIST} --json --command ${JSON.stringify(q)}`, { env: { ...process.env, CLOUDFLARE_API_TOKEN: 'proxy-injected' }, stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  try { return JSON.parse(out)[0]?.results ?? []; } catch { return []; }
}

export class Client {
  constructor() { this.cookie = ''; this.id = null; }
  async req(method, path, body, headers = {}) {
    const isForm = body instanceof FormData;
    const r = await fetch(BASE + path, {
      method, headers: { ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) { const m = /maya_s=([^;]*)/.exec(sc); if (m) this.cookie = m[1] ? 'maya_s=' + m[1] : ''; }
    const ct = r.headers.get('content-type') || '';
    let data = null;
    if (ct.includes('json')) { try { data = await r.json(); } catch { /* */ } } else { data = new Uint8Array(await r.arrayBuffer()); }
    return { status: r.status, data, headers: r.headers };
  }
  get(p) { return this.req('GET', p); } post(p, b) { return this.req('POST', p, b ?? {}); }
  patch(p, b) { return this.req('PATCH', p, b); } put(p, b) { return this.req('PUT', p, b); } del(p) { return this.req('DELETE', p); }
}

/** Başlangıç verisindeki bir kullanıcıyı (u_yigit admin, u_pelin, u_ilayda, u_emre, u_volkan, u_esra) etkinleştirip giriş yapar. */
export async function loginAs(userId, firstName = userId.slice(2)) {
  const token = b64url(randomBytes(24));
  sql(`INSERT INTO invites (id, user_id, kind, expires_at) VALUES ('${sha(token)}', '${userId}', 'invite', datetime('now', '+1 day'))`);
  const c = new Client();
  const r = await c.post('/api/auth/accept', { token, firstName, lastName: 'Test', password: 'TestSifre123' });
  if (r.status !== 200) throw new Error('giriş yapılamadı: ' + userId + ' ' + JSON.stringify(r.data));
  c.id = userId;
  return c;
}

export async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message); console.log('  ✗ ' + name + ' → ' + e.message); }
}
export const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };
export const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} beklenen ${JSON.stringify(b)}, gelen ${JSON.stringify(a)}`); };
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await wait(100); } return false; }

export function openLive(client) {
  const msgs = [];
  const ws = new WebSocket(BASE.replace('http', 'ws') + '/api/live', { headers: { Cookie: client.cookie } });
  const ready = new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws açılamadı')); });
  ws.onmessage = (e) => { if (e.data !== 'pong') msgs.push(JSON.parse(e.data)); };
  return { ws, msgs, ready };
}

/** Zamanlanmış görevi tetikler: cron '5 * * * *' (saatlik) ya da '30 13 * * *' (16:30). */
export async function runCron(cron) {
  // --test-scheduled ile gelen uç (en güvenilir); olmazsa yerel gezgin ucu
  try {
    const r = await fetch(`${BASE}/__scheduled?cron=${encodeURIComponent(cron)}`);
    if (r.ok) { await r.text(); await new Promise((res) => setTimeout(res, 300)); return 200; }
  } catch { /* */ }
  const r = await fetch(`${BASE}/cdn-cgi/local/explorer/api/local/scheduled?worker=maya-ekip`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cron }) });
  return r.status;
}

export function done() {
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
}
