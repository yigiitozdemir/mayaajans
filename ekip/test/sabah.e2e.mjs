// Sabah özeti testi: kullanıcının saatini şu anki İstanbul saatine ayarlar, cron'u tetikler.
import { loginAs, t, ok, eq, done, runCron, sql, openLive, until } from './lib.mjs';

const hour = String((new Date().getUTCHours() + 3) % 24).padStart(2, '0') + ':00';
const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const weekday = new Date(Date.now() + 3 * 3600_000).getUTCDay();
const pelin = await loginAs('u_pelin', 'Pelin');
sql(`UPDATE users SET settings = '{"morningTime":"${hour}","weekendQuiet":false}' WHERE id = 'u_pelin'`);
sql(`INSERT INTO tasks (id, title, client, assignee_id, due_date, status) VALUES ('t_sabah1', 'Bugünkü iş', 'Nevvital', 'u_pelin', '${today}', 0), ('t_sabah2', 'Geciken iş', 'Nevvital', 'u_pelin', '2020-01-01', 0)`);
sql(`INSERT INTO shoots (id, title, client, date, time, crew) VALUES ('s_sabah', 'Sabah çekimi', 'Nevvital', '${today}', '10:00', '["u_pelin"]')`);
const live = openLive(pelin); await live.ready;

console.log('\nSabah özeti');
await t('saatinde özet gelir (işler + çekim)', async () => {
  eq(await runCron('5 * * * *'), 200);
  ok(await until(() => live.msgs.some((m) => m.type === 'notify' && m.notification.kind === 'morning')), 'canlı özet gelmedi');
  const n = live.msgs.find((m) => m.notification?.kind === 'morning').notification;
  const dueN = sql(`SELECT COUNT(*) n FROM tasks WHERE assignee_id = 'u_pelin' AND status != 2 AND due_date = '${today}'`)[0].n;
  const lateN = sql(`SELECT COUNT(*) n FROM tasks WHERE assignee_id = 'u_pelin' AND status != 2 AND due_date < '${today}'`)[0].n;
  ok(n.body.includes(dueN + ' iş bugün teslim') && n.body.includes(lateN + ' geciken') && n.body.includes('Sabah çekimi'), n.body);
  eq(n.link, '/');
});
await t('aynı gün ikinci kez gönderilmez', async () => {
  await runCron('5 * * * *');
  eq(sql("SELECT COUNT(*) n FROM notifications WHERE user_id = 'u_pelin' AND kind = 'morning'")[0].n, 1);
});
await t('kapalıysa gönderilmez', async () => {
  const admin = await loginAs('u_yigit', 'Yiğit');
  sql(`UPDATE users SET settings = '{"morning":false,"morningTime":"${hour}"}' WHERE id = 'u_yigit'`);
  await runCron('5 * * * *');
  eq(sql("SELECT COUNT(*) n FROM notifications WHERE user_id = 'u_yigit' AND kind = 'morning'")[0].n, 0);
  void admin;
});
await t('hafta sonu ayarı', async () => {
  if (weekday !== 0 && weekday !== 6) return; // hafta içi: atla
  sql(`UPDATE users SET settings = '{"morningTime":"${hour}"}' WHERE id = 'u_ilayda'`);
});
live.ws.close();
done();
