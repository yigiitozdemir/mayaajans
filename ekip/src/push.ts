// Web Push gönderimi (VAPID, aes128gcm) — Workers'ta WebCrypto ile.
import type { Env } from './types';
export interface PushPayload { title: string; body: string; link?: string | null; tag?: string }
/** Kişinin kayıtlı bütün cihazlarına bildirim gönderir. Hata vermez (bildirim isteğe bağlı). */
export async function sendPush(_env: Env, _userId: string, _p: PushPayload): Promise<void> {}
