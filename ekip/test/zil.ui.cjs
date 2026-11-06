// Bildirim zili: sayfa yenilendikten sonra her bildirim türüne tıklayınca ilgili yere gider ve okundu olur
const { chromium } = require('playwright');
(async () => {
  const { t, ok, eq, done, loginAs, sql, BASE } = await import('./lib.mjs');
  await loginAs('u_pelin', 'Pelin');
  const task = sql("SELECT id, title FROM tasks WHERE status != 2 LIMIT 1")[0];
  const shoot = sql("SELECT id, title FROM shoots WHERE status = 0 LIMIT 1")[0];
  const day = sql("SELECT id, name FROM special_days ORDER BY date LIMIT 1")[0];
  const ins = (id, kind, title, taskId, link) => sql(`INSERT INTO notifications (id, user_id, kind, task_id, title, body, link) VALUES ('${id}', 'u_pelin', '${kind}', ${taskId ? `'${taskId}'` : 'NULL'}, '${title}', 'gövde', ${link ? `'${link}'` : 'NULL'})`);
  ins('n_z1', 'assign', 'Atama', task.id, null);
  ins('n_z2', 'shoot', 'Çekim ekibine eklendin', null, '/cekim?id=' + shoot.id);
  ins('n_z3', 'special', 'Özel gün görevi', null, '/ozel-gunler?id=' + day.id);
  ins('n_z4', 'approval', 'Müşteri onayı bekleniyor', null, '/?is=' + task.id);
  ins('n_z5', 'nudge', 'Emre seni dürttü', null, '/durt');
  ins('n_z6', 'nudge', 'Eski dürtme (linksiz)', null, null);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1300, height: 820 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(BASE + '/giris'); await p.fill('input[type=email]', 'pelin@mayaajans.net'); await p.fill('input[type=password]', 'TestSifre123'); await p.keyboard.press('Enter');
  await p.waitForURL((u) => !u.pathname.startsWith('/giris'));
  const click = async (title) => {
    await p.goto(BASE + '/isler'); await p.waitForTimeout(500); // yenilenmiş sayfa
    await p.locator('.bell').first().click(); await p.locator('.nitem', { hasText: title }).click(); await p.waitForTimeout(600);
  };
  const path = () => { const u = new URL(p.url()); return u.pathname + u.search; };
  await t('atama → iş detayı açılır', async () => { await click('Atama'); await p.locator('.drawer', { hasText: task.title }).waitFor(); await p.keyboard.press('Escape'); });
  await t('çekim → çekim detayı', async () => { await click('Çekim ekibine eklendin'); ok(path().startsWith('/cekim'), path()); await p.getByText(shoot.title).first().waitFor(); });
  await t('özel gün → o gün', async () => { await click('Özel gün görevi'); ok(path().startsWith('/ozel-gunler'), path()); await p.getByText(day.name).first().waitFor(); });
  await t('onay hatırlatması → iş detayı', async () => { await click('Müşteri onayı bekleniyor'); await p.locator('.drawer', { hasText: task.title }).waitFor(); await p.keyboard.press('Escape'); });
  await t('dürtme → Dürtme sayfası', async () => { await click('Emre seni dürttü'); eq(new URL(p.url()).pathname, '/durt'); });
  await t('linksiz eski bildirim → türüne göre sayfa', async () => { await click('Eski dürtme'); eq(new URL(p.url()).pathname, '/durt'); });
  await t('tıklananlar okundu oldu', async () => { await p.waitForTimeout(500); eq(sql("SELECT COUNT(*) n FROM notifications WHERE user_id='u_pelin' AND id LIKE 'n_z%' AND read_at IS NULL")[0].n, 0); });
  await t('konsol hatası yok', async () => eq(errs.length, 0, errs.join(' | ')));
  await b.close(); done();
})();
