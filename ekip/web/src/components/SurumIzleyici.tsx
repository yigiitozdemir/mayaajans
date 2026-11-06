// Yeni web sürümü yayınlanınca açık sayfayı (Mac programı / tarayıcı / iPhone) kendiliğinden yeniler.
// Kişi o an bir şey yazıyorsa ya da bir pencere açıksa zorla yenilemez; "Yeni sürüm hazır · Yenile" bandı gösterir.
import { useEffect, useState } from 'preact/hooks';

const CHECK_MS = 3 * 60_000;
const busy = () => {
  const a = document.activeElement as HTMLElement | null;
  const typing = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable) && !!(a as HTMLInputElement).value;
  return typing || !!document.querySelector('.overlay, .drawer-wrap, .aj-lb, .shot-viewer, .bellpanel');
};

export function SurumIzleyici() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let base = '';
    let pending = false;
    let stop = false;
    const check = async () => {
      if (stop) return;
      try {
        const r = await fetch('/api/version', { cache: 'no-store', credentials: 'same-origin' });
        const { build } = (await r.json()) as { build?: string };
        if (!build) return;
        if (!base) { base = build; return; }
        if (build !== base) { pending = true; tryReload(); }
      } catch { /* çevrimdışı: sonra tekrar */ }
    };
    const tryReload = () => {
      if (!pending) return;
      if (document.hidden || !busy()) location.reload();
      else setReady(true);
    };
    check();
    const t = setInterval(() => { check(); tryReload(); }, CHECK_MS);
    const t2 = setInterval(tryReload, 20_000);
    const vis = () => { if (!document.hidden) check(); else tryReload(); };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('online', check);
    const live = (e: Event) => { if ((e as CustomEvent).detail?.type === '*') check(); }; // canlı bağlantı yeniden kurulunca
    window.addEventListener('maya-live', live);
    return () => { stop = true; clearInterval(t); clearInterval(t2); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', check); window.removeEventListener('maya-live', live); };
  }, []);
  if (!ready) return null;
  return (
    <div class="surum-band" role="status">
      <span>Programın yeni sürümü hazır</span>
      <button type="button" class="btn primary sm" onClick={() => location.reload()}>Yenile</button>
    </div>
  );
}
