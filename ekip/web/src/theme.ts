// Tema: Sistem (varsayılan) · Açık · Koyu. Seçim kişinin hesabına ve bu cihaza kaydedilir.
import { useEffect, useState } from 'preact/hooks';
import { desktopInvoke } from './desktop';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'maya.theme';
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function readLocal(): ThemePref {
  try { const v = localStorage.getItem(KEY); if (v === 'light' || v === 'dark' || v === 'system') return v; } catch { /* */ }
  return 'system';
}
let pref: ThemePref = readLocal();

export const themePref = () => pref;
export const resolvedTheme = (): 'light' | 'dark' => (pref === 'system' ? (mq.matches ? 'dark' : 'light') : pref);

/** Temayı uygular (sayfa yenilenmez). */
export function applyTheme(p: ThemePref = pref) {
  pref = p;
  try { localStorage.setItem(KEY, p); } catch { /* */ }
  const r = resolvedTheme();
  document.documentElement.dataset.theme = r;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', r === 'dark' ? '#1A1512' : '#F4F1EC');
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
