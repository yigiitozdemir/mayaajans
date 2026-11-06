// Ortak bildirim: veritabanına yazar, kişiye canlı gönderir (zil + açılır bildirim + Mac bildirimi).
import type { Env } from './types';
import { broadcast } from './hub';
import { newId } from './util';
import { sendPush } from './push';

export interface NotifyInput {
  userId: string;          // kime
  kind: string;            // assign | shoot | special | chat | nudge | morning | …
  title: string;           // "Çekim ekibine eklendin"
  body: string;            // ana metin
  actorId?: string | null; // kim yaptı (kendine bildirim gönderilmez)
  link?: string | null;    // tıklanınca açılacak sayfa: "/cekim?id=s_1"
  taskId?: string | null;
  meta?: string;           // açılır bildirimde küçük satır ("Gizem Eczane · 14 Kas")
}

/** Bildirim oluşturur. `waitUntil` verilirse yayın arka planda yapılır. */
export async function notify(env: Env, n: NotifyInput, waitUntil?: (p: Promise<unknown>) => void) {
  if (n.actorId && n.actorId === n.userId) return null;
  const id = newId('n');
  await env.DB.prepare('INSERT INTO notifications (id, user_id, kind, task_id, actor_id, title, body, link) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, n.userId, n.kind, n.taskId ?? null, n.actorId ?? null, n.title, n.body, n.link ?? null).run();
  const p = broadcast(env, {
    type: 'notify',
    notification: { id, kind: n.kind, taskId: n.taskId ?? null, actorId: n.actorId ?? null, title: n.title, body: n.body, link: n.link ?? null, meta: n.meta ?? '', readAt: null, reminders: 0 },
  }, { to: n.userId });
  // iPhone / tarayıcı bildirimi (abone olduysa)
  const push = sendPush(env, n.userId, { title: n.title, body: n.body, link: n.link ?? null, tag: n.kind }).catch(() => {});
  if (waitUntil) { waitUntil(p); waitUntil(push); } else await Promise.all([p, push]);
  return id;
}

/** Herkese "şu bölüm değişti" yayını; sayfalar onLive(type) ile yeniden yükler. */
export function changed(env: Env, type: string, waitUntil: (p: Promise<unknown>) => void, extra: Record<string, unknown> = {}) {
  waitUntil(broadcast(env, { type, ...extra }));
}
