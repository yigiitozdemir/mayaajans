// Telefonda "aşağı çek, yenile": sayfanın en üstündeyken aşağı çekilince veriler sunucudan yeniden alınır.
// (Sayfanın esneme hareketi kapalı; bu, uygulamalardaki gibi düzgün bir yenileme verir.)
import { useEffect, useRef, useState } from 'preact/hooks';
import { loadAll } from '../api';
import '../styles/cekyenile.css';

const ESIK = 72;   // bırakınca yenileme için gereken çekme (px)
const AZAMI = 110; // göstergenin en çok inebileceği yer

/** Dokunma bir pencere/çekmece/kaydırılabilir kutunun içinde mi? (oralarda yenileme yok) */
function engelli(t: EventTarget | null): boolean {
  if (document.documentElement.classList.contains('noscroll')) return true;
  if (document.querySelector('.overlay, .drawer-wrap, .dialog, .ap-wrap')) return true;
  for (let el = t as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 2 && el.scrollTop > 0) return true;
    if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT') return true;
  }
  return false;
}

export function CekYenile() {
  const [cek, setCek] = useState(0);
  const [yenileniyor, setYenileniyor] = useState(false);
  const r = useRef({ y0: 0, aktif: false, mesafe: 0, mesgul: false });

  useEffect(() => {
    if (!matchMedia('(pointer: coarse)').matches) return;
    const st = r.current;
    const bas = (e: TouchEvent) => {
      if (st.mesgul || e.touches.length !== 1 || window.scrollY > 0 || engelli(e.target)) { st.aktif = false; return; }
      st.aktif = true; st.y0 = e.touches[0].clientY; st.mesafe = 0;
    };
    const hareket = (e: TouchEvent) => {
      if (!st.aktif) return;
      const dy = e.touches[0].clientY - st.y0;
      if (dy <= 0 || window.scrollY > 0) { if (st.mesafe) { st.mesafe = 0; setCek(0); } return; }
      // direnç: çektikçe zorlaşır
      st.mesafe = Math.min(AZAMI, dy * 0.5);
      setCek(st.mesafe);
      if (e.cancelable && dy > 8) e.preventDefault();
    };
    const bit = async () => {
      if (!st.aktif) return;
      st.aktif = false;
      const yeter = st.mesafe >= ESIK;
      st.mesafe = 0;
      if (!yeter) { setCek(0); return; }
      st.mesgul = true; setYenileniyor(true); setCek(ESIK);
      try { navigator.vibrate?.(8); } catch { /* */ }
      const bekle = new Promise((res) => setTimeout(res, 650)); // göz için en az bir an dönsün
      try {
        await Promise.all([loadAll(), bekle]);
        window.dispatchEvent(new CustomEvent('maya-live', { detail: { type: '*' } })); // sayfalar kendi verisini de yeniler
      } catch { /* bağlantı yoksa sessiz */ }
      setYenileniyor(false); setCek(0); st.mesgul = false;
    };
    window.addEventListener('touchstart', bas, { passive: true });
    window.addEventListener('touchmove', hareket, { passive: false });
    window.addEventListener('touchend', bit);
    window.addEventListener('touchcancel', bit);
    return () => {
      window.removeEventListener('touchstart', bas);
      window.removeEventListener('touchmove', hareket);
      window.removeEventListener('touchend', bit);
      window.removeEventListener('touchcancel', bit);
    };
  }, []);

  if (!cek && !yenileniyor) return null;
  const oran = Math.min(1, cek / ESIK);
  return (
    <div class={'cy' + (yenileniyor ? ' don' : '') + (oran >= 1 ? ' hazir' : '')} style={{ transform: `translate(-50%, ${cek - 44}px)`, opacity: Math.max(0.15, oran) }}
      role="status" aria-live="polite" aria-label={yenileniyor ? 'Yenileniyor' : 'Yenilemek için bırak'}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={yenileniyor ? undefined : { transform: `rotate(${oran * 270}deg)` }}>
        <path d="M20 12a8 8 0 1 1-2.34-5.66" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
        <path d="M20 4v4.5h-4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
  );
}
