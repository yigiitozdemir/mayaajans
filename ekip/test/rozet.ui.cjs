// Haftanın yıldızı ve rozetler (Paket D): saf kurallar + API + cron + arayüz (Bugün kartı, profil rozet rafı).
// Kullanım: BASE=http://127.0.0.1:8814 PERSIST=<db-d> UI=http://127.0.0.1:8914 \
//   NODE_PATH=$(npm root -g) node test/rozet.ui.cjs <ekran görüntüsü klasörü>
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

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

// src/rozet.ts'i esbuild ile derleyip saf fonksiyonlarını doğrudan dene (cloudflare:workers sahte)
function loadRozet() {
  const esbuild = require(path.join(__dirname, '..', 'node_modules', 'esbuild'));
  const out = esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'rozet.ts')], bundle: true, format: 'cjs', platform: 'node', write: false, external: ['cloudflare:workers'] });
  const origLoad = Module._load;
  Module._load = function (req, ...rest) { return req === 'cloudflare:workers' ? { DurableObject: class {} } : origLoad.call(this, req, ...rest); };
  const m = new Module('rozet-bundle'); m.paths = module.paths; m._compile(out.outputFiles[0].text, 'rozet-bundle.js');
  Module._load = origLoad;
  return m.exports;
}

// arayüzde yalnızca bizim bileşenlerde kontrast denetimi (test/tema.ui.cjs ile aynı hesap)
const audit = (p, sel) => p.evaluate((sel) => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const a = m[1].split(',').map((x) => parseFloat(x)); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const blend = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== 'none' && !cs.backgroundImage.includes('gradient')) return null;
      const c = parse(cs.backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; }
    }
    let base = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  const bad = [];
  for (const root of document.querySelectorAll(sel)) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const n = walker.currentNode; if (!n.textContent.trim()) continue;
      const el = n.parentElement; if (!el) continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (el.closest('[aria-hidden="true"]') || el.closest('.av')) continue; // avatar baş harfleri hariç
      let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
      const fg0 = parse(cs.color); const bg = bgOf(el); if (!fg0 || !bg) continue;
      const fg = blend({ ...fg0, a: fg0.a * op }, bg);
      const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight) >= 700;
      const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < need) bad.push(`${ratio.toFixed(2)} "${n.textContent.trim().slice(0, 30)}"`);
    }
  }
  return bad;
}, sel);

(async () => {
  const { loginAs, sql: sql0, Client, openLive, runCron } = await import('./lib.mjs');
  const sql = (q) => sql0(q.replace(/\s+/g, ' '));

  console.log('\nSaf kurallar (src/rozet.ts)');
  const R = loadRozet();
  await t('haftaOf: İstanbul haftası Pazartesi başlar (Pazar 23:30 İstanbul hâlâ o hafta)', () => {
    const h = R.haftaOf(new Date('2026-11-08T20:30:00Z')); // Pazar 23:30
    eq(h.week, '2026-11-02'); eq(h.end, '2026-11-08'); eq(h.dow, 7); eq(h.startUtc, '2026-11-01 21:00:00'); eq(h.endUtc, '2026-11-08 21:00:00');
    eq(R.haftaOf(new Date('2026-11-08T21:00:00Z')).week, '2026-11-09', 'Pazartesi 00:00 yeni hafta');
    eq(R.haftaOf(new Date('2026-11-04T10:00:00Z'), -1).week, '2026-10-26', 'geçen hafta');
  });
  await t('rozetZamani: Cuma 17:00 (İstanbul) öncesi hayır, sonrası ve hafta sonu evet', () => {
    eq(R.rozetZamani(new Date('2026-11-06T13:59:00Z')), false, 'Cuma 16:59');
    eq(R.rozetZamani(new Date('2026-11-06T14:05:00Z')), true, 'Cuma 17:05');
    eq(R.rozetZamani(new Date('2026-11-07T09:00:00Z')), true, 'Cumartesi');
    eq(R.rozetZamani(new Date('2026-11-05T15:00:00Z')), false, 'Perşembe 18:00');
    eq(R.rozetZamani(new Date('2026-11-08T21:00:00Z')), false, 'Pazartesi 00:00');
  });
  await t('isGunleri: Cuma itibarıyla 5, Çarşamba itibarıyla 3 gün', () => {
    eq(R.isGunleri(R.haftaOf(new Date('2026-11-06T14:05:00Z'))).length, 5);
    eq(R.isGunleri(R.haftaOf(new Date('2026-11-04T10:00:00Z'))).length, 3);
  });
  const o = (x) => ({ done: 0, onTime: 0, late: 0, dated: 0, approved: 0, shoots: 0, days: 0, ...x });
  await t('rozetleriBelirle: hiç iş bitmediyse rozet yok (çekim olsa bile)', () => {
    eq(R.rozetleriBelirle({ a: o({ shoots: 3 }), b: o({}) }, 5).length, 0);
  });
  await t('rozetleriBelirle: yıldız, dakik, onay, çekim, seri; beraberlikte paylaşılır', () => {
    const w = R.rozetleriBelirle({
      a: o({ done: 6, dated: 6, onTime: 6, days: 5, approved: 1 }),
      b: o({ done: 6, dated: 4, onTime: 3, late: 1, days: 4, shoots: 2 }),
      c: o({ done: 2, dated: 2, onTime: 2, shoots: 2, approved: 2 }),
    }, 5);
    const has = (u, b) => w.some((x) => x.userId === u && x.badge === b);
    ok(has('a', 'yildiz') && has('b', 'yildiz'), 'yıldız paylaşılmalı');
    ok(has('a', 'dakik') && !has('b', 'dakik') && !has('c', 'dakik'), 'dakik: ≥3 ve hepsi zamanında');
    ok(has('c', 'onay') && !has('a', 'onay'), 'onay: en çok');
    ok(has('b', 'cekim') && has('c', 'cekim'), 'çekim paylaşılmalı');
    ok(has('a', 'seri') && !has('b', 'seri'), 'seri: her iş günü');
    eq(w.find((x) => x.badge === 'yildiz').value, 6);
  });

  // ---------- veri hazırlığı: bu hafta ----------
  const users = { u_yigit: 'Yiğit', u_pelin: 'Pelin', u_emre: 'Emre', u_volkan: 'Volkan', u_esra: 'Esra', u_ilayda: 'İlayda' };
  const C = {};
  for (const [id, n] of Object.entries(users)) C[id] = await loginAs(id, n);
  const IST = 3 * 3600e3, DAY = 864e5, now = Date.now();
  const local = now + IST, dow = ((new Date(local).getUTCDay() + 6) % 7) + 1, dayStart = Math.floor(local / DAY) * DAY, monday = dayStart - (dow - 1) * DAY;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  const sqlT = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  const at = (dayMs, h = 9) => sqlT(Math.min(dayMs - IST + h * 3600e3, now - 60e3)); // o gün İstanbul saati h, gelecekte değil
  const workdays = []; for (let i = 0; i < 5; i++) if (monday + i * DAY <= dayStart) workdays.push(monday + i * DAY);
  const gate = dow > 5 || (dow === 5 && new Date(local).getUTCHours() >= 17);
  const W = iso(monday), LW = iso(monday - 7 * DAY);
  sql(`DELETE FROM badges; DELETE FROM badge_weeks; DELETE FROM notifications WHERE kind = 'rozet'; DELETE FROM task_revisions;
       UPDATE tasks SET completed_at = '2020-01-01 00:00:00' WHERE completed_at >= '${sqlT(monday - IST - 7 * DAY)}';
       DELETE FROM tasks WHERE id LIKE 'rz_%'; DELETE FROM shoots WHERE date >= '${LW}'; UPDATE users SET settings = '{}' WHERE id IN (${Object.keys(users).map((x) => `'${x}'`).join(',')})`);
  const ins = [];
  const task = (id, uid, doneAt, due, extra = '') => ins.push(`INSERT INTO tasks (id, title, client, assignee_id, due_date, status, completed_at${extra ? ', approval, revisions' : ''}) VALUES ('${id}', 'Rozet testi ${id}', 'Gizem Eczane', '${uid}', ${due ? `'${due}'` : 'NULL'}, 2, '${doneAt}'${extra})`);
  // Pelin: her iş günü en az bir iş, en az 5 iş, hepsi zamanında → yıldız + dakik + seri
  const pelinN = Math.max(5, workdays.length);
  for (let i = 0; i < pelinN; i++) { const d = workdays[i] ?? workdays[0]; task('rz_p' + i, 'u_pelin', at(d, 9 + (i >= workdays.length ? 1 : 0)), iso(d + DAY)); }
  // Emre: 3 iş, biri gecikmiş → dakik değil
  task('rz_e0', 'u_emre', at(monday, 10), iso(monday + DAY)); task('rz_e1', 'u_emre', at(monday, 11), iso(monday + 2 * DAY)); task('rz_e2', 'u_emre', at(monday, 12), iso(monday - DAY));
  // Volkan: 1 iş + ilk seferde onaylanan bir içerik; Esra: revize sonrası onay (sayılmaz)
  task('rz_v0', 'u_volkan', at(monday, 13), null);
  ins.push(`INSERT INTO tasks (id, title, client, assignee_id, due_date, status, approval, revisions) VALUES ('rz_va', 'Onay içeriği', 'Vatan', 'u_volkan', '${iso(monday + 4 * DAY)}', 1, 'approved', 0), ('rz_sa', 'Revizeli içerik', 'Vatan', 'u_esra', '${iso(monday + 4 * DAY)}', 1, 'approved', 1)`);
  ins.push(`INSERT INTO task_revisions (id, task_id, step, by_user, at) VALUES ('rv1', 'rz_va', 'sent', 'u_volkan', '${at(monday, 9)}'), ('rv2', 'rz_va', 'approved', 'u_volkan', '${at(monday, 14)}'),
    ('rv3', 'rz_sa', 'sent', 'u_esra', '${at(monday, 9)}'), ('rv4', 'rz_sa', 'revision', 'u_esra', '${at(monday, 10)}'), ('rv5', 'rz_sa', 'approved', 'u_esra', '${at(monday, 15)}')`);
  // çekimler: Emre ve Volkan 2'şer (paylaşılır), Pelin 1; iptal edilen sayılmaz
  ins.push(`INSERT INTO shoots (id, title, client, date, crew, status) VALUES
    ('rz_s1', 'Ürün çekimi', 'Gizem Eczane', '${W}', '["u_emre","u_volkan"]', 1), ('rz_s2', 'Röportaj', 'Vatan', '${W}', '["u_emre","u_volkan","u_pelin"]', 0),
    ('rz_s3', 'İptal', 'Vatan', '${W}', '["u_emre","u_emre","u_esra"]', 2)`);
  // geçen haftanın kazananları (hazır kayıt)
  ins.push(`INSERT INTO badge_weeks (week) VALUES ('${LW}')`);
  ins.push(`INSERT INTO badges (id, week, user_id, badge, value) VALUES ('bd_l1', '${LW}', 'u_emre', 'yildiz', 9), ('bd_l2', '${LW}', 'u_esra', 'cekim', 3), ('bd_l3', '${LW}', 'u_pelin', 'dakik', 4)`);
  sql(ins.join('; '));

  console.log('\nAPI');
  await t('giriş yapmadan 401', async () => eq((await new Client().get('/api/rozetler')).status, 401));
  await t('bu haftanın canlı durumu: ilk 3 ve kendi sıram', async () => {
    const r = await C.u_pelin.get('/api/rozetler'); eq(r.status, 200);
    eq(r.data.week.start, W);
    eq(r.data.top[0].userId, 'u_pelin'); eq(r.data.top[0].done, pelinN); eq(r.data.top[0].rank, 1);
    eq(r.data.top[1].userId, 'u_emre'); eq(r.data.top[1].done, 3);
    eq(r.data.top.length, 3); eq(r.data.me.rank, 1);
    const e = await C.u_emre.get('/api/rozetler'); eq(e.data.me.rank, 2); eq(e.data.me.of, 3);
    const i = await C.u_ilayda.get('/api/rozetler'); eq(i.data.me.rank, null); eq(i.data.me.done, 0);
    ok(r.data.badges.length === 5 && r.data.badges[0].emoji === '🌟', 'rozet tanımları');
  });
  await t('geçen haftanın kazananları', async () => {
    const r = await C.u_ilayda.get('/api/rozetler');
    eq(r.data.last.week, LW); eq(r.data.last.current, false);
    eq(r.data.last.winners[0].badge, 'yildiz'); eq(r.data.last.winners[0].userId, 'u_emre'); eq(r.data.last.winners[0].value, 9);
    eq(r.data.last.winners.length, 3);
  });
  await t('kişi geçmişi: sayılarla; ben / başkası / geçersiz / bulunamadı', async () => {
    const r = await C.u_emre.get('/api/rozetler/kisi/ben'); eq(r.status, 200);
    eq(r.data.total, 1); eq(r.data.counts[0].badge, 'yildiz'); eq(r.data.counts[0].count, 1); eq(r.data.recent[0].week, LW);
    eq((await C.u_pelin.get('/api/rozetler/kisi/u_emre')).data.total, 1);
    eq((await C.u_pelin.get('/api/rozetler/kisi/u_yok')).status, 404);
    eq((await C.u_pelin.get('/api/rozetler/kisi/' + encodeURIComponent("x' OR 1=1"))).status, 400);
    eq((await C.u_ilayda.get('/api/rozetler/kisi/ben')).data.total, 0);
  });

  // ---------- arayüz: önce (geçen haftanın yıldızı) ----------
  const browser = await chromium.launch();
  const errors = [];
  const mk = async (email, who, vp = { width: 1440, height: 900 }, mobile = false, th = null) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1, locale: 'tr-TR', timezoneId: 'Europe/Istanbul', isMobile: mobile, hasTouch: mobile });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(who + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|favicon|Failed to load resource/.test(m.text())) errors.push(who + ': ' + m.text()); });
    await page.goto(UI + '/giris');
    await page.getByLabel('E-posta').fill(email);
    await page.getByLabel('Şifre', { exact: true }).fill('TestSifre123');
    await page.getByRole('button', { name: 'Giriş yap' }).click();
    await page.locator('.shell').waitFor({ timeout: 15000 });
    if (th) await page.waitForFunction((th) => document.documentElement.dataset.theme === th, th, { timeout: 8000 });
    await wait(400);
    return { ctx, page };
  };
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, 'rozet-' + n + '.png') });
  const theme = async (c, th) => { await c.patch('/api/me', { settings: { theme: th } }); };

  console.log('\nArayüz · Bugün');
  await theme(C.u_pelin, 'dark');
  const P = await mk('pelin@mayaajans.net', 'Pelin', undefined, false, 'dark');
  const card = P.page.locator('section.hy');
  await t('Bugün: geçen haftanın yıldızı (Emre) ve bu haftanın ilk 3\'ü', async () => {
    await card.waitFor({ timeout: 8000 });
    const txt = await card.innerText();
    ok(/Geçen haftanın yıldızı/.test(txt), txt); ok(/Emre/.test(txt) && /9 iş/.test(txt), txt);
    eq(await card.locator('.hy-p').count(), 3); ok(await card.locator('.hy-p.me').count() === 1, 'kendi yerim vurgulu');
    eq(await card.locator('.hy-glow').count(), 1);
  });
  await t('kart açılınca rozet ayrıntıları ve kurallar', async () => {
    await card.locator('.hy-row').click();
    await card.locator('.hy-more').waitFor();
    const txt = await card.locator('.hy-more').innerText();
    ok(/Çekim kahramanı/.test(txt) && /Esra/.test(txt) && /Dakik/.test(txt), txt);
    ok(/Cuma 17:00/.test(txt), 'kural satırı');
    await shot(P.page, 'bugun-acik-ayrinti-koyu');
    await card.locator('.hy-row').click();
  });
  await t('koyu tema kontrast (kart)', async () => { const b = await audit(P.page, '.hy'); eq(b.length, 0, b.join(' | ')); });
  await shot(P.page, 'bugun-gecen-hafta-koyu');

  // ---------- cron ----------
  console.log('\nCron · haftalikRozetler (' + (gate ? 'rozet anı geldi' : 'rozet anı gelmedi') + ')');
  const live = openLive(C.u_ilayda); await live.ready;
  await runCron('5 * * * *'); await wait(1200);
  if (gate) {
    const want = [['u_pelin', 'yildiz', pelinN], ['u_pelin', 'dakik', pelinN], ['u_emre', 'cekim', 2], ['u_volkan', 'cekim', 2], ['u_volkan', 'onay', 1]];
    if (workdays.length >= 3) want.push(['u_pelin', 'seri', workdays.length]);
    await t('rozetler verildi ve kaydedildi', async () => {
      const rows = sql(`SELECT user_id, badge, value FROM badges WHERE week = '${W}' ORDER BY user_id, badge`);
      for (const [u, b, v] of want) ok(rows.some((r) => r.user_id === u && r.badge === b && r.value === v), `${u} ${b} ${v} yok: ${JSON.stringify(rows)}`);
      eq(rows.length, want.length, 'fazladan rozet: ' + JSON.stringify(rows));
      ok(!rows.some((r) => r.user_id === 'u_esra'), 'revizeli onay sayılmaz');
      ok(!rows.some((r) => r.user_id === 'u_emre' && r.badge === 'dakik'), 'geciken iş dakik bozar');
    });
    await t('kişisel tebrik + ekibe "haftanın yıldızı" bildirimi', async () => {
      const n = sql("SELECT user_id, title, body, link FROM notifications WHERE kind = 'rozet' ORDER BY user_id");
      const p = n.filter((x) => x.user_id === 'u_pelin');
      eq(p.length, 1, 'Pelin tek bildirim (tebrik)'); ok(/yıldızı sensin/.test(p[0].title), p[0].title); ok(/🌟 Haftanın yıldızı \(\d+ iş\)/.test(p[0].body) && /⏱️ Dakik/.test(p[0].body), p[0].body);
      const v = n.filter((x) => x.user_id === 'u_volkan'); eq(v.length, 2, 'Volkan: tebrik + ekip duyurusu'); ok(v.some((x) => /rozet kazandın/.test(x.title)));
      const i = n.filter((x) => x.user_id === 'u_ilayda'); eq(i.length, 1);
      eq(i[0].body, `Bu haftanın yıldızı: Pelin 🌟 (${pelinN} iş)`); eq(i[0].link, '/');
      eq(n.filter((x) => x.user_id === 'u_yigit').length, 1);
    });
    await t('canlı yayın: rozet + notify', async () => {
      ok(live.msgs.some((m) => m.type === 'rozet'), 'rozet yayını yok');
      ok(live.msgs.some((m) => m.type === 'notify' && m.notification.kind === 'rozet'), 'notify yok');
    });
    await t('aynı hafta iki kez verilmez', async () => {
      const before = sql("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'rozet'")[0].n;
      await runCron('5 * * * *'); await wait(800);
      eq(sql("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'rozet'")[0].n, before);
      eq(sql(`SELECT COUNT(*) AS n FROM badges WHERE week = '${W}'`)[0].n, want.length);
    });
    await t('API: son kazananlar artık bu hafta (current)', async () => {
      const r = await C.u_esra.get('/api/rozetler');
      eq(r.data.last.week, W); eq(r.data.last.current, true); eq(r.data.awarded, true);
      const g = await C.u_pelin.get('/api/rozetler/kisi/ben');
      eq(g.data.total, want.filter((x) => x[0] === 'u_pelin').length + 1); // + geçen haftanın dakik'i
      eq(g.data.counts.find((x) => x.badge === 'dakik').count, 2);
    });
    await t('Bugün kartı canlı güncellendi: bu haftanın yıldızı Pelin', async () => {
      await P.page.waitForFunction(() => /Bu haftanın yıldızı/.test(document.querySelector('section.hy')?.textContent || ''), null, { timeout: 6000 });
      const txt = await card.innerText(); ok(/Pelin/.test(txt), txt);
    });
  } else {
    await t('rozet anı gelmediyse hiçbir şey verilmez', async () => {
      eq(sql(`SELECT COUNT(*) AS n FROM badges WHERE week = '${W}'`)[0].n, 0);
      eq(sql(`SELECT COUNT(*) AS n FROM badge_weeks WHERE week = '${W}'`)[0].n, 0);
    });
  }
  live.ws.close();
  await shot(P.page, 'bugun-koyu');

  console.log('\nArayüz · Profil rozet rafı');
  const openProfile = async (p) => { await p.getByRole('button', { name: 'Profilimi düzenle' }).first().click(); await p.locator('.dialog').waitFor(); };
  await t('profilde rozet rafı: sayılarla ve son kazanılanlar', async () => {
    await openProfile(P.page);
    const rr = P.page.locator('.dialog .rr'); await rr.locator('.rr-slot.on').first().waitFor({ timeout: 6000 });
    const txt = await rr.innerText();
    ok(/Rozetlerim/.test(txt), txt);
    if (gate) { ok(/×2/.test(txt), 'Dakik ×2: ' + txt); ok(/Son kazanılanlar/.test(await rr.textContent())); }
    else ok(/×1/.test(txt), txt);
    eq(await rr.locator('.rr-slot').count(), 5);
    await rr.scrollIntoViewIfNeeded();
    await shot(P.page, 'profil-raf-koyu');
  });
  await t('koyu tema kontrast (raf)', async () => { const b = await audit(P.page, '.dialog .rr'); eq(b.length, 0, b.join(' | ')); });
  await P.ctx.close();

  // İlayda: hiç rozeti yok → nazik boş durum
  await theme(C.u_ilayda, 'light');
  const I = await mk('ilayda@mayaajans.net', 'İlayda', undefined, false, 'light');
  await t('açık tema: Bugün kartı ve kontrast', async () => {
    await I.page.locator('section.hy').waitFor({ timeout: 8000 });
    const b = await audit(I.page, '.hy'); eq(b.length, 0, b.join(' | '));
    await shot(I.page, 'bugun-acik');
  });
  await t('rozeti olmayan kişide boş durum', async () => {
    await openProfile(I.page);
    await I.page.locator('.dialog .rr-empty').waitFor({ timeout: 6000 });
    ok(/Henüz rozetin yok/.test(await I.page.locator('.dialog .rr').innerText()));
    eq(await I.page.locator('.dialog .rr-slot.on').count(), 0);
    const b = await audit(I.page, '.dialog .rr'); eq(b.length, 0, b.join(' | '));
    await I.page.locator('.dialog .rr').scrollIntoViewIfNeeded();
    await shot(I.page, 'profil-bos-acik');
  });
  await I.ctx.close();

  console.log('\nArayüz · Telefon');
  for (const th of ['dark', 'light']) {
    await theme(C.u_emre, th);
    const M = await mk('emre@mayaajans.net', 'Emre-' + th, { width: 390, height: 844 }, true, th);
    await t(`telefon (${th}): kart tek satır, yatay taşma yok`, async () => {
      const c = M.page.locator('section.hy'); await c.waitFor({ timeout: 8000 });
      const h = await c.locator('.hy-row').evaluate((e) => e.getBoundingClientRect().height);
      ok(h <= 60, 'kart yüksekliği ' + h);
      const over = await M.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(over <= 0, 'yatay taşma ' + over);
      const b = await audit(M.page, '.hy'); eq(b.length, 0, b.join(' | '));
      await shot(M.page, 'telefon-bugun-' + (th === 'dark' ? 'koyu' : 'acik'));
    });
    await t(`telefon (${th}): profil rafı`, async () => {
      await M.page.getByRole('button', { name: 'Menü' }).click();
      await openProfile(M.page);
      const rr = M.page.locator('.dialog .rr'); await rr.locator('.rr-slot').first().waitFor({ timeout: 6000 });
      await rr.scrollIntoViewIfNeeded(); await wait(200);
      const over = await M.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      ok(over <= 0, 'yatay taşma ' + over);
      const b = await audit(M.page, '.dialog .rr'); eq(b.length, 0, b.join(' | '));
      await shot(M.page, 'telefon-profil-' + (th === 'dark' ? 'koyu' : 'acik'));
    });
    await M.ctx.close();
  }

  await t('konsol hatası yok', async () => eq(errors.length, 0, errors.join(' | ')));
  await browser.close();
  console.log(`\nGEÇEN: ${pass}  KALAN: ${fail}`);
  if (fail) { console.log(fails.map((f) => ' - ' + f).join('\n')); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
