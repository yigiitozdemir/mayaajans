// Mac uygulaması (Tauri) köprüsü. Tarayıcıda çalışırken hiçbir şey yapmaz.
const tauri = (window as any).__TAURI__;
export const isDesktop = !!tauri?.core?.invoke;
/** Mac 1.0.7+: başlık çubuğu yok, pencere düğmeleri sol menünün üst köşesinde. */
export const macOverlay = isDesktop && !!(window as any).__MAYA_OVERLAY__;
if (macOverlay) document.documentElement.classList.add('mac-overlay');

export function desktopInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!isDesktop) return Promise.resolve(undefined);
  return tauri.core.invoke(cmd, args).catch(() => undefined);
}

let lastUnread = -1;
export function setDesktopUnread(count: number) {
  if (count === lastUnread) return;
  lastUnread = count;
  desktopInvoke('set_unread', { count });
}

export type DesktopEvent = { action: 'new-task' } | { action: 'go'; path: string } | { action: 'shot'; name: string } | { action: 'shots' } | { action: 'app-unread'; app: string; count: number };
export function onDesktopEvent(fn: (e: DesktopEvent) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent).detail);
  window.addEventListener('maya-desktop', h);
  return () => window.removeEventListener('maya-desktop', h);
}

/** Mac uygulamasında komutu dener; yoksa (tarayıcı ya da eski sürüm) yedek davranışı çalıştırır. */
export function desktopOr(cmd: string, args: Record<string, unknown>, fallback: () => void) {
  if (!isDesktop) { fallback(); return; }
  tauri.core.invoke(cmd, args).catch(fallback);
}

/** Mac uygulaması komutu; tarayıcıda ya da komut yoksa (eski sürüm) hata verir. */
export function desktopCall<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop) return Promise.reject(new Error('masaüstü değil'));
  return tauri.core.invoke(cmd, args);
}
