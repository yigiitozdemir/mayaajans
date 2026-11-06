// Haftanın yıldızı ve rozetler (Paket D).
// Saatlik cron'dan çağrılır; Cuma 17:00'den (İstanbul) sonraki ilk çalışmada haftanın rozetlerini bir kez verir.
// Hafta: Pazartesi 00:00 – Pazar 24:00 (İstanbul, UTC+3). Ajandam yapılacakları kişiye özeldir, sayılmaz.
import type { Env } from './types';
import { notify } from './notify';
import { broadcast } from './hub';
import { newId } from './util';

export type RozetKey = 'yildiz' | 'dakik' | 'onay' | 'cekim' | 'seri';
export const ROZETLER: Record<RozetKey, { emoji: string; ad: string; birim: string }> = {
  yildiz: { emoji: '🌟', ad: 'Haftanın yıldızı', birim: 'iş' },
  dakik: { emoji: '⏱️', ad: 'Dakik', birim: 'iş zamanında' },
  onay: { emoji: '✅', ad: 'Tek seferde onay', birim: 'içerik' },
  cekim: { emoji: '🎬', ad: 'Çekim kahramanı', birim: 'çekim' },
  seri: { emoji: '🔥', ad: 'Seri', birim: 'gün' },
};
export const ROZET_SIRA: RozetKey[] = ['yildiz', 'dakik', 'onay', 'cekim', 'seri'];

const IST = 3 * 3600_000; // İstanbul UTC+3 (yaz saati yok)
const DAYMS = 86_400_000;
export const sqlTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export interface Hafta {
  week: string;       // Pazartesi (YYYY-MM-DD, İstanbul)
  end: string;        // Pazar (YYYY-MM-DD)
  startUtc: string;   // SQL UTC 'YYYY-MM-DD HH:MM:SS' (dahil)
  endUtc: string;     // bir sonraki Pazartesi 00:00 İstanbul (hariç)
  today: string;      // İstanbul bugünü
  dow: number;        // 1 = Pazartesi … 7 = Pazar
  hour: number;       // İstanbul saati
}

/** `now` anının içinde bulunduğu İstanbul haftası. `offsetWeeks` = -1 → geçen hafta. */
export function haftaOf(now: Date, offsetWeeks = 0): Hafta {
  const local = now.getTime() + IST;
  const dow = ((new Date(local).getUTCDay() + 6) % 7) + 1;
  const dayStart = Math.floor(local / DAYMS) * DAYMS;           // İstanbul gece yarısı (yerel ms)
  const monday = dayStart - (dow - 1) * DAYMS + offsetWeeks * 7 * DAYMS;
  return {
    week: isoDay(monday), end: isoDay(monday + 6 * DAYMS),
    startUtc: sqlTime(monday - IST), endUtc: sqlTime(monday + 7 * DAYMS - IST),
    today: isoDay(dayStart), dow, hour: new Date(local).getUTCHours(),
  };
}

/** Rozet verme anı geldi mi? Cuma 17:00'den Pazar sonuna kadar (kaçan cron'u telafi eder). */
export function rozetZamani(now: Date): boolean {
  const h = haftaOf(now);
  return h.dow > 5 || (h.dow === 5 && h.hour >= 17);
}

export interface Olcu { done: number; onTime: number; late: number; dated: number; approved: number; shoots: number; days: number }
export type Olculer = Record<string, Olcu>;
const bos = (): Olcu => ({ done: 0, onTime: 0, late: 0, dated: 0, approved: 0, shoots: 0, days: 0 });

/** Haftanın iş günlerinden `until` gününe (dahil) kadar geçenler — Seri için. */
export function isGunleri(h: Hafta, until = h.today): string[] {
  const out: string[] = [];
  const mon = Date.parse(h.week + 'T00:00:00Z');
  for (let i = 0; i < 5; i++) { const d = isoDay(mon + i * DAYMS); if (d <= until) out.push(d); }
  return out;
}

/** Haftalık ölçüler (yalnızca aktif ekip üyeleri). `untilUtc` verilirse o ana kadar sayılır. */
export async function haftalikOlculer(env: Env, h: Hafta, untilUtc = h.endUtc): Promise<Olculer> {
  const until = untilUtc < h.endUtc ? untilUtc : h.endUtc;
  const lastDay = isoDay(Date.parse(until.replace(' ', 'T') + 'Z') + IST - 1000);
  const [users, tasks, appr, shoots] = await Promise.all([
    env.DB.prepare("SELECT id FROM users WHERE status = 'active'").all<{ id: string }>(),
    env.DB.prepare(
      `SELECT assignee_id AS uid, due_date AS due, date(completed_at, '+3 hours') AS day FROM tasks
       WHERE status = 2 AND assignee_id IS NOT NULL AND completed_at >= ? AND completed_at < ?`,
    ).bind(h.startUtc, until).all<{ uid: string; due: string | null; day: string }>(),
    // ilk seferde onay: hiç revize istenmemiş, ilk onay (approved/published) adımı bu hafta atılmış içerikler
    env.DB.prepare(
      `SELECT t.assignee_id AS uid, COUNT(*) AS n FROM tasks t
       JOIN (SELECT task_id, MIN(at) AS first_at FROM task_revisions WHERE step IN ('approved', 'published') GROUP BY task_id) r ON r.task_id = t.id
       WHERE t.revisions = 0 AND t.approval IN ('approved', 'published') AND t.assignee_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM task_revisions x WHERE x.task_id = t.id AND x.step = 'revision')
         AND r.first_at >= ? AND r.first_at < ?
       GROUP BY t.assignee_id`,
    ).bind(h.startUtc, until).all<{ uid: string; n: number }>(),
    // katılınan çekimler: iptal edilmemiş, tarihi bu hafta ve bugüne (dahil) kadar
    env.DB.prepare('SELECT crew FROM shoots WHERE status != 2 AND date >= ? AND date <= ?').bind(h.week, lastDay < h.end ? lastDay : h.end).all<{ crew: string }>(),
  ]);
  const m: Olculer = {};
  for (const u of users.results) m[u.id] = bos();
  const days: Record<string, Set<string>> = {};
  for (const t of tasks.results) {
    const o = m[t.uid]; if (!o) continue;
    o.done++;
    if (t.due) { o.dated++; if (t.day <= t.due) o.onTime++; else o.late++; }
    const wd = new Date(t.day + 'T00:00:00Z').getUTCDay();
    if (wd >= 1 && wd <= 5) (days[t.uid] ||= new Set()).add(t.day);
  }
  for (const [uid, s] of Object.entries(days)) if (m[uid]) m[uid].days = s.size;
  for (const a of appr.results) if (m[a.uid]) m[a.uid].approved = Number(a.n) || 0;
  for (const s of shoots.results) {
    let crew: unknown = [];
    try { crew = JSON.parse(s.crew || '[]'); } catch { /* */ }
    if (!Array.isArray(crew)) continue;
    for (const id of new Set(crew.filter((x): x is string => typeof x === 'string'))) if (m[id]) m[id].shoots++;
  }
  return m;
}

export interface Kazanan { userId: string; badge: RozetKey; value: number }

/** Saf kural: ölçülerden rozetleri çıkarır. Hiç iş bitmediyse boş döner. Beraberlikte rozet paylaşılır. */
export function rozetleriBelirle(m: Olculer, workdays: number): Kazanan[] {
  const rows = Object.entries(m);
  if (!rows.some(([, o]) => o.done > 0)) return [];
  const out: Kazanan[] = [];
  const leaders = (badge: RozetKey, f: (o: Olcu) => number) => {
    const best = Math.max(0, ...rows.map(([, o]) => f(o)));
    if (best < 1) return;
    for (const [uid, o] of rows) if (f(o) === best) out.push({ userId: uid, badge, value: best });
  };
  leaders('yildiz', (o) => o.done);
  for (const [uid, o] of rows) if (o.dated >= 3 && o.late === 0) out.push({ userId: uid, badge: 'dakik', value: o.onTime });
  leaders('onay', (o) => o.approved);
  leaders('cekim', (o) => o.shoots);
  if (workdays >= 3) for (const [uid, o] of rows) if (o.days >= workdays) out.push({ userId: uid, badge: 'seri', value: o.days });
  return out;
}

export const rozetYazi = (k: { badge: RozetKey; value: number }) => {
  const r = ROZETLER[k.badge];
  return `${r.emoji} ${r.ad}` + (k.badge === 'dakik' ? ` (${k.value} iş, hepsi zamanında)` : ` (${k.value} ${r.birim})`);
};

/** Saatlik cron. Rozet anı gelmediyse ya da bu hafta zaten verildiyse hiçbir şey yapmaz. */
export async function haftalikRozetler(env: Env, now = new Date()): Promise<void> {
  if (!rozetZamani(now)) return;
  const h = haftaOf(now);
  // haftayı sahiplen (eşzamanlı iki çalışma olursa yalnız biri geçer)
  const claim = await env.DB.prepare('INSERT INTO badge_weeks (week) VALUES (?) ON CONFLICT(week) DO NOTHING').bind(h.week).run();
  if (!claim.meta.changes) return;
  const m = await haftalikOlculer(env, h, sqlTime(now.getTime()));
  const wins = rozetleriBelirle(m, isGunleri(h).length);
  await env.DB.prepare('UPDATE badge_weeks SET stats = ? WHERE week = ?').bind(JSON.stringify(m), h.week).run();
  if (!wins.length) return;
  await env.DB.batch(wins.map((w) => env.DB.prepare('INSERT OR IGNORE INTO badges (id, week, user_id, badge, value) VALUES (?, ?, ?, ?, ?)')
    .bind(newId('bd'), h.week, w.userId, w.badge, w.value)));

  const { results: users } = await env.DB.prepare("SELECT id, first_name, email FROM users WHERE status = 'active'").all<{ id: string; first_name: string; email: string }>();
  const name = (id: string) => { const u = users.find((x) => x.id === id); return u ? (u.first_name || u.email.split('@')[0]) : ''; };
  const byUser = new Map<string, Kazanan[]>();
  for (const w of wins) byUser.set(w.userId, [...(byUser.get(w.userId) || []), w]);
  const jobs: Promise<unknown>[] = [];
  // kişisel tebrik
  for (const [uid, ws] of byUser) {
    const star = ws.some((w) => w.badge === 'yildiz');
    jobs.push(notify(env, {
      userId: uid, kind: 'rozet', link: '/',
      title: star ? 'Tebrikler, haftanın yıldızı sensin 🌟' : 'Tebrikler, bu hafta rozet kazandın 🎉',
      body: ws.map(rozetYazi).join(' · '),
      meta: 'Rozetlerin profilinde',
    }));
  }
  // bütün ekibe kısa duyuru (yıldızlar kendi tebriklerini aldı)
  const stars = wins.filter((w) => w.badge === 'yildiz');
  if (stars.length) {
    const names = stars.map((s) => name(s.userId)).filter(Boolean);
    const list = names.length > 1 ? names.slice(0, -1).join(', ') + ' ve ' + names[names.length - 1] : names[0];
    const body = `Bu haftanın ${names.length > 1 ? 'yıldızları' : 'yıldızı'}: ${list} 🌟 (${stars[0].value} iş)`;
    for (const u of users) {
      if (stars.some((s) => s.userId === u.id)) continue;
      jobs.push(notify(env, { userId: u.id, kind: 'rozet', title: 'Haftanın yıldızı', body, link: '/' }));
    }
  }
  jobs.push(broadcast(env, { type: 'rozet' }));
  await Promise.allSettled(jobs);
}
