// Web Push istemcisi: service worker kaydı, abone ol / çık, durum.
// Mac programında (Tauri) hiç çalışmaz — orada bildirimleri program kendisi gösterir.
import { api } from './api';
import { isDesktop } from './desktop';
import { navigate } from './ui';

export type PushState =
  | 'desktop'        // Mac programı: gerek yok
  | 'ios-browser'    // iPhone/iPad Safari, ana ekrana eklenmemiş
  | 'ios-old'        // ana ekranda ama iOS 16.4 öncesi
  | 'unsupported'    // tarayıcı desteklemiyor
  | 'no-key'         // sunucuda anahtar yok
  | 'denied'         // izin reddedildi
  | 'off'            // kapalı (açılabilir)
  | 'on';            // bu cihaz bildirim alıyor

const ua = navigator.userAgent || '';
export const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
export const isStandalone = (navigator as any).standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
export const pushSupported = !isDesktop && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && typeof Notification !== 'undefined';

export function deviceName(): string {
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua) || (isIOS && /Macintosh/.test(ua))) return 'iPad';
  if (/Android/.test(ua)) return 'Android telefon';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Tarayıcı';
  const os = /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${br} · ${os}` : br;
}

function keyBytes(b64u: string): Uint8Array {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

let regP: Promise<ServiceWorkerRegistration | null> | null = null;
/** Service worker'ı kaydeder (bir kez) ve bildirime tıklanınca sayfa içi yönlendirmeyi dinler. */
export function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported) return Promise.resolve(null);
  if (!regP) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data;
      if (d && d.type === 'maya-open' && typeof d.link === 'string' && d.link.startsWith('/')) navigate(d.link);
    });
    try { navigator.serviceWorker.startMessages(); } catch { /* */ }
    regP = navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .catch(() => null);
  }
  return regP;
}

let serverInfo: { key: string; ready: boolean } | null = null;
async function info() {
  if (!serverInfo) serverInfo = await api<{ key: string; ready: boolean }>('GET', '/push/key');
  return serverInfo;
}

async function currentSub(): Promise<PushSubscription | null> {
  const reg = await registerSW();
  if (!reg) return null;
  try { return await reg.pushManager.getSubscription(); } catch { return null; }
}

const OFF_KEY = 'maya.push.off';
function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k: string, v: string | null) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* */ } }

/** Bu cihazın bildirim durumu. */
export async function pushState(): Promise<PushState> {
  if (isDesktop) return 'desktop';
  if (!pushSupported) {
    if (isIOS && !isStandalone) return 'ios-browser';
    if (isIOS) return 'ios-old';
    return 'unsupported';
  }
  const i = await info().catch(() => null);
  if (!i || !i.key || !i.ready) return 'no-key';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  const sub = await currentSub();
  return sub ? 'on' : 'off';
}

async function send(sub: PushSubscription) {
  await api('POST', '/push/subscribe', { subscription: sub.toJSON(), device: deviceName() });
  lsSet('maya.push', 'on');
}

/** İzin ister ve abone olur. Kullanıcı dokunuşu içinde çağrılmalı (iPhone şartı). */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported) return pushState();
  // izin isteği ilk iş olmalı: araya await girerse iPhone dokunuşu "kullanıcı eylemi" saymayabilir
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  const i = await info();
  if (!i.key || !i.ready) return 'no-key';
  const reg = await registerSW();
  if (!reg) throw new Error('Bildirim servisi başlatılamadı');
  let sub = await reg.pushManager.getSubscription();
  // anahtar değiştiyse eski aboneliği bırak
  if (sub && sub.options?.applicationServerKey) {
    const a = new Uint8Array(sub.options.applicationServerKey), b = keyBytes(i.key);
    if (a.length !== b.length || a.some((x, k) => x !== b[k])) { await sub.unsubscribe().catch(() => {}); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(i.key) as BufferSource });
  await send(sub);
  lsSet(OFF_KEY, null);
  return 'on';
}

export async function disablePush(): Promise<void> {
  const sub = await currentSub();
  if (sub) {
    await api('POST', '/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
  lsSet('maya.push', null);
  lsSet(OFF_KEY, '1');
}

export async function testPush(): Promise<void> {
  await api('POST', '/push/test');
}

/** Açılışta: service worker'ı kaydet; tarayıcıda abonelik varsa sunucuyla eşitle (oturum değiştiyse kişiye bağlar). */
export async function syncPush(): Promise<void> {
  if (!pushSupported) return;
  await registerSW();
  if (Notification.permission !== 'granted' || lsGet(OFF_KEY)) return;
  const sub = await currentSub();
  if (sub) await send(sub).catch(() => {});
}
