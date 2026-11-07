// Ana ekran simgesindeki kırmızı sayı (iPhone ana ekran uygulaması, Mac/Chrome kurulu uygulama):
// okunmamış bildirimler + Sohbet'teki okunmamışlar. Uygulama kapalıyken sayıyı push bildirimi günceller (sw.js).
import { useEffect } from 'preact/hooks';
import { useStore } from '../ui';

export function UygulamaRozeti() {
  const s = useStore();
  const n = s.notifications.filter((x) => !x.readAt).length + (s.chatUnread || 0);
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    if (!nav.setAppBadge) return;
    (n > 0 ? nav.setAppBadge(n) : nav.clearAppBadge ? nav.clearAppBadge() : nav.setAppBadge(0)).catch(() => {});
  }, [n]);
  return null;
}
