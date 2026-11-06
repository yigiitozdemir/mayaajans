// Tema: Koyu "Gece" (varsayılan) · Açık "Premium cam" · Sistem. Seçim kişinin hesabına ve bu cihaza kaydedilir.
import { useEffect, useState } from 'preact/hooks';
import { desktopInvoke } from './desktop';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'maya.theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function readLocal(): ThemePref {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* */ }
  return 'dark'; // hiç seçim yapılmadıysa: Gece
}
let pref: ThemePref = readLocal();

let gecisT: ReturnType<typeof setTimeout> | undefined;
export const themePref = () => pref;
export const resolvedTheme = (): 'light' | 'dark' => (pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref);

/** Temayı uygular (sayfa yenilenmez). `yumusak`: kullanıcı seçtiyse eski ve yeni görünüm yumuşakça geçer. */
export function applyTheme(p: ThemePref = pref, yumusak = false) {
  // kullanıcı seçtiyse renkler yarım saniyede yumuşakça değişir (tema hemen uygulanır)
  if (yumusak && p !== pref && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const root = document.documentElement;
    root.classList.add('tema-gecis');
    clearTimeout(gecisT); gecisT = setTimeout(() => root.classList.remove('tema-gecis'), 500);
  }
  pref = p;
  try { localStorage.setItem(KEY, p); } catch { /* */ }
  const r = resolvedTheme();
  document.documentElement.dataset.theme = r;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', r === 'dark' ? '#0B0B0F' : '#F6F3EF');
  desktopInvoke('set_theme', { theme: p }); // Mac uygulamasında başlık çubuğu da uysun
  window.dispatchEvent(new Event('maya-theme'));
}

mq.addEventListener?.('change', () => { if (pref === 'system') applyTheme('system'); });

export function useThemePref(): ThemePref {
  const [p, setP] = useState(pref);
  useEffect(() => {
    const f = () => setP(pref);
    window.addEventListener('maya-theme', f);
    return () => window.removeEventListener('maya-theme', f);
  }, []);
  return p;
}
