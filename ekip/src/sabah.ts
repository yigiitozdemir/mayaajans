// Sabah özeti: her kişiye kendi saatinde (varsayılan 09:00, İstanbul) bugünün işleri, çekimleri ve özel günleri.
// Saatlik cron'dan çağrılır; aynı gün ikinci kez gönderilmez.
import type { Env } from './types';
import { notify } from './notify';
import { istanbulHour } from './util';

/** İstanbul'a göre bugünün tarihi (YYYY-MM-DD) ve haftanın günü (0 Pazar). */
export function istanbulToday(d = new Date()) {
  const t = new Date(d.getTime() + 3 * 3600_000);
  return { iso: t.toISOString().slice(0, 10), weekday: t.getUTCDay() };
}

export async function sabahOzeti(env: Env, now = new Date()): Promise<void> {
  const hour = istanbulHour(now);
  const { iso: today, weekday } = istanbulToday(now);
  const { results: users } = await env.DB.prepare("SELECT id, first_name, settings FROM users WHERE status = 'active'")
    .all<{ id: string; first_name: string; settings: string }>();

  for (const u of users) {
    let s: Record<string, unknown> = {};
    try { s = JSON.parse(u.settings || '{}'); } catch { /* */ }
    if (s.morning === false) continue;
    if (s.weekendQuiet !== false && (weekday === 0 || weekday === 6)) continue;
    const at = typeof s.morningTime === 'string' ? parseInt(s.morningTime.slice(0, 2), 10) : 9;
    if (hour !== at) continue;
    // bugün (İstanbul) gönderildiyse tekrar gönderme — created_at UTC
    const sent = await env.DB.prepare("SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'morning' AND created_at >= datetime(?, '-3 hours')")
      .bind(u.id, today + ' 00:00:00').first();
    if (sent) continue;

    const [due, late, shoots, days] = await Promise.all([
      env.DB.prepare('SELECT COUNT(*) n FROM tasks WHERE assignee_id = ? AND status != 2 AND due_date = ?').bind(u.id, today).first<{ n: number }>(),
      env.DB.prepare('SELECT COUNT(*) n FROM tasks WHERE assignee_id = ? AND status != 2 AND due_date < ?').bind(u.id, today).first<{ n: number }>(),
      env.DB.prepare('SELECT title, time FROM shoots WHERE status = 0 AND date = ? AND EXISTS (SELECT 1 FROM json_each(shoots.crew) WHERE value = ?) ORDER BY time')
        .bind(today, u.id).all<{ title: string; time: string }>(),
      env.DB.prepare(`SELECT COUNT(*) n FROM special_day_rows r JOIN special_days d ON d.id = r.day_id
        WHERE r.assignee_id = ? AND r.status != 2 AND d.date BETWEEN ? AND date(?, '+3 days')`).bind(u.id, today, today).first<{ n: number }>(),
    ]);

    const parts: string[] = [];
    if (due?.n) parts.push(`${due.n} iş bugün teslim`);
    if (late?.n) parts.push(`${late.n} geciken iş`);
    if (shoots.results.length) parts.push(`${shoots.results.length} çekim (${shoots.results.map((x) => (x.time ? x.time + ' ' : '') + x.title).join(', ')})`);
    if (days?.n) parts.push(`${days.n} özel gün paylaşımı yaklaşıyor`);
    const body = parts.length ? parts.join(' · ') : 'Bugün sana atanmış teslim yok. Kolay gelsin!';

    await notify(env, { userId: u.id, kind: 'morning', title: `Günaydın ${u.first_name || ''}`.trim() + ' ☀️', body, link: '/' });
  }
}
