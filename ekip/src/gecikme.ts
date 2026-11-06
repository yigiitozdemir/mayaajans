// Akıllı geç kalma uyarısı (saatlik cron'dan çağrılır; Pzt–Cmt İstanbul 10:00'da çalışır, herkes için açık, kapatılamaz).
// Kural: teslim tarihi yaklaşan ve hâlâ "Başlanmadı" (status 0) duran işler —
//   teslime 2 iş günü kala → sorumluya (yoksa ekleyene),
//   teslime 1 iş günü kala ya da teslim günü → sorumluya + yöneticilere.
// Her aşama bir kez gider (tasks.gecikme_uyari). Teslim tarihi değişirse uyarı baştan başlar. Geçmiş tarihli işler hiç uyarılmaz.
import type { Env } from './types';
import { notify } from './notify';
import { istanbulHour } from './util';

const HOUR = 3_600_000;
export const GECIKME_SAAT = 10;

/** İstanbul takvim günü (YYYY-MM-DD) ve haftanın günü. */
function istanbulGun(now: Date) {
  const d = new Date(now.getTime() + 3 * HOUR);
  return { date: d.toISOString().slice(0, 10), day: d.getUTCDay() };
}

/** `bugun`den sonra `teslim` dahil kaç iş günü (Pzt–Cmt; pazar sayılmaz) var. Teslim bugünse 0, geçmişse -1. */
export function kalanIsGunu(bugun: string, teslim: string): number {
  if (teslim < bugun) return -1;
  let n = 0;
  const d = new Date(bugun + 'T00:00:00Z'), son = new Date(teslim + 'T00:00:00Z');
  while (d < son) {
    d.setUTCDate(d.getUTCDate() + 1);
    const g = d.getUTCDay();
    if (g !== 0) n++;
  }
  return n;
}

/** Bu iş için şu an gönderilmesi gereken aşama (0 = hiçbiri). */
export function gecikmeAsamasi(kalan: number): 0 | 1 | 2 {
  if (kalan < 0) return 0;
  if (kalan <= 1) return 2;
  if (kalan === 2) return 1;
  return 0;
}

const kalanYazi = (k: number) => (k === 0 ? 'teslim bugün' : k === 1 ? 'teslim yarın' : `teslime ${k} iş günü`);

/** Gönderilen bildirim sayısını döndürür. `now` testler için. */
export async function gecikmeUyarisi(env: Env, now: Date = new Date()): Promise<number> {
  const { date: bugun, day } = istanbulGun(now);
  if (day === 0 || istanbulHour(now) !== GECIKME_SAAT) return 0;
  const ufuk = new Date(Date.parse(bugun + 'T00:00:00Z') + 4 * 24 * HOUR).toISOString().slice(0, 10); // hafta sonu dahil yeterli pay
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.title, t.client, t.due_date, t.gecikme_uyari, t.assignee_id, t.created_by
     FROM tasks t
     WHERE t.status = 0 AND t.due_date IS NOT NULL AND t.due_date >= ? AND t.due_date <= ?
     ORDER BY t.due_date LIMIT 300`,
  ).bind(bugun, ufuk).all<{ id: string; title: string; client: string; due_date: string; gecikme_uyari: string | null; assignee_id: string | null; created_by: string | null }>();
  if (!results.length) return 0;
  const { results: users } = await env.DB.prepare("SELECT id, role, settings FROM users WHERE status = 'active'").all<{ id: string; role: string; settings: string }>();
  const byId = new Map(users.map((u) => [u.id, u]));
  const admins = users.filter((u) => u.role === 'admin').map((u) => u.id);
  let sent = 0;
  for (const t of results) {
    const kalan = kalanIsGunu(bugun, t.due_date);
    const asama = gecikmeAsamasi(kalan);
    if (!asama) continue;
    const [eskiTarih, eskiAsama] = (t.gecikme_uyari || '').split(':');
    const onceki = eskiTarih === t.due_date ? Number(eskiAsama) || 0 : 0;
    if (asama <= onceki) continue;
    // önce işaretle: cron aynı saat içinde yeniden çalışırsa tekrar gitmesin
    await env.DB.prepare('UPDATE tasks SET gecikme_uyari = ? WHERE id = ?').bind(t.due_date + ':' + asama, t.id).run();
    const sorumlu = t.assignee_id && byId.has(t.assignee_id) ? t.assignee_id : t.created_by && byId.has(t.created_by) ? t.created_by : null;
    const alicilar = new Set<string>();
    if (sorumlu) alicilar.add(sorumlu);
    if (asama === 2) admins.forEach((a) => alicilar.add(a));
    for (const uid of alicilar) {
      const kendi = uid === sorumlu;
      await notify(env, {
        userId: uid, kind: 'gecikme', taskId: t.id, link: '/isler?is=' + t.id,
        title: kendi ? (asama === 2 ? 'Bu iş hâlâ başlanmadı' : 'Teslimi yaklaşıyor, başlamadın') : 'Başlanmamış iş: teslim yaklaştı',
        body: [t.title, t.client, kalanYazi(kalan)].filter(Boolean).join(' · '),
        meta: (t.client || 'Firma yok') + ' · ' + kalanYazi(kalan),
      });
      sent++;
    }
  }
  return sent;
}
