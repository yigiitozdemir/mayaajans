// Ses ve titreşim (Paket D): web/src/ses.ts + SesAyari. Sahte AudioContext ve navigator.vibrate ile.
// Kullanım: BASE=http://127.0.0.1:8814 PERSIST=<db-d> UI=http://127.0.0.1:8914 \
//   NODE_PATH=$(npm root -g) node test/ses.ui.cjs <ekran görüntüsü klasörü>
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');

const UI = process.env.UI || 'http://127.0.0.1:8914';
const OUT = process.argv[2] || '.';
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) {
  try { await fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; fails.push(name + ' → ' + e.message.split('\n')[0]); console.log('  ✗ ' + name + ' → ' + e.message.split('\n')[0]); }
}
const ok = (c, m) => { if (!c) throw new Error(m || 'koşul sağlanmadı'); };
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m || ''} beklenen ${JSON.stringify(b)}, gelen ${JSON.stringify(a)}`); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Sahte AudioContext: örnek sayısı, osilatörler, en geç bitiş anı; sahte titreşim; odak denetimi; maya-ses olayları
const INIT = ({ vibrate }) => {
  window.__ctx = 0; window.__osc = 0; window.__stops = []; window.__vib = []; window.__ses = []; window.__focus = true;
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ connect() {}, disconnect() {} });
  class FakeCtx {
    constructor() { window.__ctx++; this.state = 'running'; this.currentTime = 0; this.destination = node(); }
    resume() { return Promise.resolve(); }
    createGain() { return { ...node(), gain: param() }; }
    createBiquadFilter() { return { ...node(), type: '', frequency: param(), Q: param() }; }
    createOscillator() { window.__osc++; return { ...node(), type: 'sine', frequency: param(), start() {}, stop(t) { window.__stops.push(t); } }; }
  }
  window.AudioContext = FakeCtx; window.webkitAudioContext = FakeCtx;
  if (vibrate) navigator.vibrate = (p) => { window.__vib.push(p); return true; };
  else { try { delete Navigator.prototype.vibrate; } catch { /* */ } navigator.vibrate = undefined; }
  document.hasFocus = () => window.__focus;
  window.addEventListener('maya-ses', (e) => window.__ses.push(e.detail));
};

(async () => {
  const { loginAs, sql: sql0 } = await import('./lib.mjs');
  const sql = (q) => sql0(q.replace(/\s+/g, ' '));
  const Y = await loginAs('u_yigit', 'Yiğit'); await loginAs('u_pelin', 'Pelin'); await loginAs('u_emre', 'Emre');
  sql("UPDATE users SET settings = '{\"theme\":\"dark\"}' WHERE id IN ('u_pelin','u_emre')");
  const settingsOf = (id) => JSON.parse(sql(`SELECT settings FROM users WHERE id = '${id}'`)[0].settings);

  const browser = await chromium.launch();
  const errors = [];
  const mk = async (email, who, opts = {}) => {
    const ctx = await browser.newContext({ viewport: opts.vp || { width: 1440, height: 900 }, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', isMobile: !!opts.mobile, hasTouch: !!opts.mobile });
    await ctx.addInitScript(INIT, { vibrate: opts.vibrate !== false });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(who + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(who + ': ' + m.text()); });
    await page.goto(UI + '/giris');
    await page.getByLabel('E-posta').fill(email);
    await page.getByLabel('Şifre', { exact: true }).fill('TestSifre123');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.locator('.shell').waitFor({ timeout: 15000 });
    await wait(500);
    return { ctx, page };
  };
  const C = (p) => p.evaluate(() => ({ ctx: window.__ctx, osc: window.__osc, vib: window.__vib.slice(), ses: window.__ses.slice(), stops: window.__stops.slice() }));
  const assign = (title) => Y.post('/api/tasks', { title, client: 'Gizem Eczane', assigneeId: 'u_pelin', dueDate: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) });
  const setSettings = (p, s) => p.evaluate(async (s) => {
    await fetch('/api/me', { method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings: s }) });
    await (await import('/src/api.ts')).loadMe();
  }, s);

  console.log('\nAudioContext ve bildirim sesleri');
  const P = await mk('pelin@mayaajans.net', 'Pelin');
  // girişten sonra sayfayı yeniden yükle: henüz hiçbir etkileşim yok
  await P.page.reload(); await P.page.locator('.shell').waitFor(); await wait(800);
  await t('ilk etkileşimden önce AudioContext açılmaz (bildirim gelse de)', async () => {
    const r = await assign('Ses testi 0'); ok(r.status === 200 || r.status === 201, 'iş oluşturulamadı ' + r.status);
    await P.page.waitForFunction(() => window.__ses.length >= 1, null, { timeout: 6000 });
    const c = await C(P.page); eq(c.ctx, 0, 'AudioContext'); eq(c.osc, 0);
  });
  let n0 = 0;
  await t('ilk tıklamada tek AudioContext; sonraki seslerde yenisi açılmaz', async () => {
    await P.page.mouse.click(700, 20); await wait(200);
    n0 = (await C(P.page)).ctx; ok(n0 >= 1 && n0 <= 2, 'örnek sayısı ' + n0 + ' (ses.ts + Dürtme)');
    await P.page.evaluate(async () => { const m = await import('/src/ses.ts'); for (const x of ['tamam', 'onay', 'mesaj', 'atama', 'hata', 'tamam']) m.sesCal(x); });
    eq((await C(P.page)).ctx, n0);
  });
  await t('atama bildirimi → "atama" sesi + titreşim', async () => {
    const before = await C(P.page);
    await assign('Ses testi 1');
    await P.page.waitForFunction((n) => window.__ses.length > n, before.ses.length, { timeout: 6000 });
    const c = await C(P.page);
    eq(c.ses[c.ses.length - 1], 'atama'); ok(c.osc > before.osc, 'osilatör çalışmadı');
    eq(JSON.stringify(c.vib[c.vib.length - 1]), JSON.stringify([28, 60, 40]));
  });
  await t('bildirim türü → ses eşlemesi', async () => {
    const m = await P.page.evaluate(async () => { const s = await import('/src/ses.ts'); return ['assign', 'remind', 'chat', 'portal', 'approval', 'rozet', 'kriz', 'duyuru', 'hava', 'morning', 'nudge', 'shoot'].map((k) => s.bildirimTuru(k)); });
    eq(JSON.stringify(m), JSON.stringify(['atama', 'atama', 'mesaj', 'onay', 'onay', 'tamam', 'hata', 'mesaj', 'mesaj', null, null, 'atama']));
  });
  await t('her ses ≤ 400 ms', async () => {
    for (const tur of ['tamam', 'onay', 'mesaj', 'atama', 'durt', 'hata']) {
      const max = await P.page.evaluate(async (tur) => { window.__stops = []; (await import('/src/ses.ts')).sesDinle(tur); return Math.max(...window.__stops); }, tur);
      ok(max > 0 && max <= 0.4, `${tur}: ${max}s`);
    }
  });
  const quiet = async (label, prep, undo) => {
    await t(label, async () => {
      await prep();
      const before = await C(P.page);
      await assign('Ses testi ' + label);
      await wait(2500);
      const c = await C(P.page);
      eq(c.ses.length, before.ses.length, 'ses olayı'); eq(c.osc, before.osc, 'osilatör'); eq(c.vib.length, before.vib.length, 'titreşim');
      await undo();
    });
  };
  await quiet('sayfa odakta değilken sessiz (cihaz kendi sesini çalıyor)', () => P.page.evaluate(() => { window.__focus = false; }), () => P.page.evaluate(() => { window.__focus = true; }));
  await quiet('"odaklanıyorum" durumunda sessiz', () => setSettings(P.page, { mood: { emoji: '🎧', text: 'Odaklanıyorum', until: null, focus: true } }), () => setSettings(P.page, { mood: null }));
  await quiet('Rahatsız etme açıkken sessiz', () => setSettings(P.page, { dnd: true }), () => setSettings(P.page, { dnd: false }));
  await t('sesler kapalı: ses yok ama titreşim var', async () => {
    await setSettings(P.page, { sesler: false });
    const before = await C(P.page);
    await assign('Ses testi sessiz');
    await P.page.waitForFunction((n) => window.__vib.length > n, before.vib.length, { timeout: 6000 });
    eq((await C(P.page)).osc, before.osc, 'osilatör çalmamalı');
  });
  await quiet('sesler ve titreşim kapalı: hiçbir şey', () => setSettings(P.page, { titresim: false }), () => setSettings(P.page, { sesler: true, titresim: true }));
  await t('kutla() (iş tamamlama) "tamam" sesini çalar', async () => {
    const before = await C(P.page);
    await P.page.evaluate(async () => (await import('/src/ui.tsx')).kutla(document.body));
    const c = await C(P.page); eq(c.ses[c.ses.length - 1], 'tamam'); ok(c.osc > before.osc);
  });

  console.log('\nProfil · SesAyari');
  const openProfile = async (p) => { await p.getByRole('button', { name: 'Profilimi düzenle' }).first().click(); await p.locator('.dialog').waitFor(); };
  await t('Sesler ve Titreşim anahtarları + dinle düğmeleri', async () => {
    await openProfile(P.page);
    const box = P.page.locator('.dialog .ses-ayari');
    await box.getByRole('switch', { name: /^Sesler/ }).waitFor();
    eq(await box.getByRole('switch', { name: /^Sesler/ }).getAttribute('aria-checked'), 'true');
    eq(await box.getByRole('switch', { name: /Titreşim/ }).count(), 1);
    eq(await box.locator('.ses-chip').count(), 5);
    await box.scrollIntoViewIfNeeded();
    await P.page.screenshot({ path: path.join(OUT, 'ses-profil-koyu.png') });
  });
  await t('dinle düğmesi sesi çalar (titreşmez)', async () => {
    const before = await C(P.page);
    await P.page.getByRole('button', { name: 'Onay sesini dinle' }).click();
    const c = await C(P.page); eq(c.ses[c.ses.length - 1], 'onay'); ok(c.osc > before.osc); eq(c.vib.length, before.vib.length);
  });
  await t('Sesler kapatılınca hesaba kaydedilir; Kaydet geri almaz', async () => {
    await P.page.locator('.dialog .ses-ayari').getByRole('switch', { name: /^Sesler/ }).click();
    await P.page.waitForFunction(() => document.querySelector('.dialog .ses-ayari [role=switch]')?.getAttribute('aria-checked') === 'false');
    await wait(600);
    eq(settingsOf('u_pelin').sesler, false);
    await P.page.locator('.dialog').getByRole('button', { name: 'Kaydet' }).click();
    await P.page.locator('.dialog').waitFor({ state: 'detached' }); await wait(500);
    eq(settingsOf('u_pelin').sesler, false, 'Kaydet sonrası');
    eq(await P.page.evaluate(async () => (await import('/src/api.ts')).store.get().me.settings.sesler), false);
  });
  await t('Titreşim kapatılır, Sesler yeniden açılır', async () => {
    await openProfile(P.page);
    const box = P.page.locator('.dialog .ses-ayari');
    eq(await box.getByRole('switch', { name: /^Sesler/ }).getAttribute('aria-checked'), 'false');
    await box.getByRole('switch', { name: /Titreşim/ }).click(); await wait(500);
    await box.getByRole('switch', { name: /^Sesler/ }).click(); await wait(800);
    const s = settingsOf('u_pelin'); eq(s.sesler, true); eq(s.titresim, false);
    await P.page.keyboard.press('Escape');
    await setSettings(P.page, { titresim: true });
  });

  console.log('\nTitreşimi desteklemeyen cihaz (iPhone)');
  await (async () => {
    sql("UPDATE users SET settings = '{\"theme\":\"light\"}' WHERE id = 'u_emre'");
    const E = await mk('emre@mayaajans.net', 'Emre', { vibrate: false, vp: { width: 390, height: 844 }, mobile: true });
    await t('titreşim anahtarı görünmez; sesler var', async () => {
      await E.page.getByRole('button', { name: 'Menü' }).click();
      await openProfile(E.page);
      const box = E.page.locator('.dialog .ses-ayari');
      await box.getByRole('switch', { name: /^Sesler/ }).waitFor();
      eq(await box.getByRole('switch', { name: /Titreşim/ }).count(), 0);
      const over = await E.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(over <= 0, 'yatay taşma ' + over);
      await box.scrollIntoViewIfNeeded(); await wait(200);
      await E.page.screenshot({ path: path.join(OUT, 'ses-telefon-acik.png') });
    });
    await E.ctx.close();
  })();

  await t('konsol hatası yok', async () => eq(errors.length, 0, errors.join(' | ')));
  await browser.close();
  sql("DELETE FROM tasks WHERE title LIKE 'Ses testi%'");
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
