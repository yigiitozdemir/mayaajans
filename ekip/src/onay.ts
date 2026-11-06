// İçerik onay takibi: uzun süredir müşteriden dönüş bekleyen işler için sorumluya hatırlatma (saatlik cron'dan çağrılır).
// Kural: 'sent' (Onaya gönderildi) adımında 72 saati geçen, tamamlanmamış işler → sorumluya (yoksa ekleyene) günde en fazla bir bildirim,
// yalnızca hafta içi ve İstanbul mesai saatinde (09:00–17:59).
import type { Env } from './types';
import { notify } from './notify';
import { istanbulHour } from './util';

const HOUR = 3_600_000;
const sqlTime = (d: Date) => d.toISOString().replace('T', ' ').slice(0, 19);

/** Hafta içi (Pzt–Cum) ve İstanbul saatiyle 09–18 arası mı? (İstanbul UTC+3, yaz saati yok) */
export function onayMesaide(now: Date): boolean {
  const day = new Date(now.getTime() + 3 * HOUR).getUTCDay();
  const h = istanbulHour(now);
  return day >= 1 && day <= 5 && h >= 9 && h < 18;
}

/** Gönderilen hatırlatma sayısını döndürür. `now` testler için. */
export async function onayHatirlatma(env: Env, now: Date = new Date()): Promise<number> {
  if (!onayMesaide(now)) return 0;
  const nowS = sqlTime(now);
  const limit = sqlTime(new Date(now.getTime() - 72 * HOUR));
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.title, t.client, t.sent_at, COALESCE(a.id, c.id) AS uid
     FROM tasks t
     LEFT JOIN users a ON a.id = t.assignee_id AND a.status = 'active'
     LEFT JOIN users c ON c.id = t.created_by AND c.status = 'active'
     WHERE t.approval = 'sent' AND t.status != 2 AND t.sent_at IS NOT NULL AND t.sent_at <= ?
       AND (t.approval_reminded_at IS NULL OR date(t.approval_reminded_at, '+3 hours') < date(?, '+3 hours'))
     ORDER BY t.sent_at LIMIT 200`,
  ).bind(limit, nowS).all<{ id: string; title: string; client: string; sent_at: string; uid: string | null }>();
  let sent = 0;
  for (const t of results) {
    // önce işaretle: cron aynı gün yeniden çalışırsa tekrar gitmesin
    await env.DB.prepare('UPDATE tasks SET approval_reminded_at = ? WHERE id = ?').bind(nowS, t.id).run();
    if (!t.uid) continue;
    const days = Math.max(3, Math.floor((now.getTime() - Date.parse(t.sent_at.replace(' ', 'T') + 'Z')) / (24 * HOUR)));
    await notify(env, {
      userId: t.uid, kind: 'approval', taskId: t.id, link: '/?is=' + t.id,
      title: 'Müşteri onayı bekleniyor',
      body: [t.title, t.client, days + ' gündür'].filter(Boolean).join(' · '),
      meta: (t.client || 'Firma yok') + ' · ' + days + ' gündür onayda',
    });
    sent++;
  }
  return sent;
}
