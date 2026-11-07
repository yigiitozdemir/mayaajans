// Kendine has kısa sesler + (destekleyen cihazda) titreşim. Dosya yok: hepsi Web Audio ile sentezlenir.
// AudioContext tek tanedir ve ancak ilk kullanıcı etkileşiminden (tıklama/tuş) sonra açılır.
// Dürtme'nin kendi sesi NudgeReceiver'da; buradaki 'durt' yalnızca o deseni taklit eder (dinle / kutla dışı kullanım).
import { store, moodOf } from './api';

export type SesTuru = 'tamam' | 'onay' | 'mesaj' | 'atama' | 'durt' | 'hata';

export const SESLER: { tur: SesTuru; ad: string }[] = [
  { tur: 'tamam', ad: 'İş bitti' },
  { tur: 'onay', ad: 'Onay' },
  { tur: 'mesaj', ad: 'Mesaj' },
  { tur: 'atama', ad: 'Atama' },
  { tur: 'hata', ad: 'Hata' },
];

// ---------- AudioContext: tek, etkileşimden sonra ----------
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let etkilesim = false;

function audio(): AudioContext | null {
  if (!etkilesim || typeof window === 'undefined') return null;
  try {
    const C = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!C) return null;
    if (!ctx) {
      ctx = new C() as AudioContext;
      // yumuşak bir tepe filtresi + ana ses düzeyi: hiçbir ses sert ya da yüksek çıkmaz
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 5200; lp.Q.value = 0.4;
      master = ctx.createGain(); master.gain.value = 0.55;
      master.connect(lp); lp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch { return null; }
}

if (typeof window !== 'undefined') {
  const unlock = () => {
    etkilesim = true;
    const c = audio();
    if (c && c.state === 'running') {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}

/** Tek nota: zarf (hızlı atak, üstel sönüm), isteğe bağlı perde kayması ve ince bir üst ton. */
function nota(c: AudioContext, o: { f: number; at: number; dur: number; vol?: number; to?: number; type?: OscillatorType; harm?: number }) {
  const t = c.currentTime + o.at;
  const g = c.createGain();
  const peak = o.vol ?? 0.3;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  g.connect(master || c.destination);
  const osc = c.createOscillator();
  osc.type = o.type || 'sine';
  osc.frequency.setValueAtTime(o.f, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + Math.min(o.dur, 0.12));
  osc.connect(g); osc.start(t); osc.stop(t + o.dur + 0.02);
  if (o.harm) { // cam/çan tınısı için oktav üstü, daha kısa
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(peak * o.harm, t + 0.005);
    g2.gain.exponentialRampToValueAtTime(0.0001, t + o.dur * 0.55);
    g2.connect(master || c.destination);
    const o2 = c.createOscillator();
    o2.type = 'sine'; o2.frequency.setValueAtTime(o.f * 2, t);
    if (o.to) o2.frequency.exponentialRampToValueAtTime(o.to * 2, t + Math.min(o.dur, 0.12));
    o2.connect(g2); o2.start(t); o2.stop(t + o.dur);
  }
}

// Her ses ≤ 400 ms
const DESEN: Record<SesTuru, (c: AudioContext) => void> = {
  // iş bitti: parlak iki nota (La5 → Mi6), cam tınılı
  tamam: (c) => { nota(c, { f: 880, at: 0, dur: 0.16, vol: 0.26, harm: 0.18 }); nota(c, { f: 1318.5, at: 0.085, dur: 0.28, vol: 0.24, harm: 0.15 }); },
  // onay geldi: sıcak, yükselen üçlü (Do6 – Mi6 – Sol6), kısa
  onay: (c) => { [1046.5, 1318.5, 1568].forEach((f, i) => nota(c, { f, at: i * 0.07, dur: i === 2 ? 0.22 : 0.12, vol: 0.2, harm: 0.12 })); },
  // mesaj: yumuşak "pop" — kısa yukarı kayan sinüs
  mesaj: (c) => { nota(c, { f: 420, to: 820, at: 0, dur: 0.11, vol: 0.32 }); },
  // atama: tek, yükselen nota
  atama: (c) => { nota(c, { f: 587, to: 988, at: 0, dur: 0.24, vol: 0.24, type: 'triangle' }); nota(c, { f: 1975, at: 0.16, dur: 0.14, vol: 0.05 }); },
  // dürtme deseni (NudgeReceiver'daki "tık-tık-tık" ile aynı notalar)
  durt: (c) => { ([[0, 587], [0.11, 784], [0.22, 659]] as const).forEach(([at, f]) => nota(c, { f, at, dur: 0.1, vol: 0.2, type: 'triangle' })); },
  // hata: alçak, inen iki nota, yumuşak
  hata: (c) => { nota(c, { f: 392, at: 0, dur: 0.13, vol: 0.22, type: 'triangle' }); nota(c, { f: 294, at: 0.11, dur: 0.22, vol: 0.22, type: 'triangle' }); },
};

const TITRESIM: Record<SesTuru, number[]> = {
  tamam: [14, 50, 22], onay: [18, 60, 18, 60, 26], mesaj: [12], atama: [28, 60, 40], durt: [30, 40, 30, 40, 30], hata: [50, 50, 50],
};

export const titresimVar = () => typeof navigator !== 'undefined' && typeof (navigator as any).vibrate === 'function';

function ayar(k: 'sesler' | 'titresim'): boolean {
  const s = store.get().me?.settings;
  return s?.[k] === undefined ? true : !!s[k];
}

/** Sesi çalar (ve titreştirir). `zorla`: ayarlar kapalı olsa da (dinle düğmesi). */
function cal(tur: SesTuru, zorla = false) {
  const sesAcik = zorla || ayar('sesler');
  const titAcik = zorla ? false : ayar('titresim');
  if (sesAcik) {
    const c = audio();
    if (c) { try { DESEN[tur](c); } catch { /* */ } }
  }
  if (titAcik && titresimVar()) { try { navigator.vibrate(TITRESIM[tur]); } catch { /* */ } }
  if (sesAcik || titAcik) { try { window.dispatchEvent(new CustomEvent('maya-ses', { detail: tur })); } catch { /* */ } }
}

/** Kullanıcının kendi eylemi (iş tamamlama vb.) için kısa ses. */
export function sesCal(tur: SesTuru): void { cal(tur); }

/** "Dinle" düğmesi: ayar kapalı olsa da çalar, titreşmez. */
export function sesDinle(tur: SesTuru): void { etkilesim = true; cal(tur, true); }

/** Bildirim türü → ses. null = sessiz. */
export function bildirimTuru(kind: string): SesTuru | null {
  switch (kind) {
    case 'morning': case 'backup': case 'nudge': return null;
    case 'assign': case 'remind': case 'gecikme': case 'reminder': case 'work': case 'special': case 'shoot': case 'toplanti': return 'atama';
    case 'chat': case 'mention': return 'mesaj';
    case 'portal': case 'approval': case 'onay': case 'content': return 'onay';
    case 'rozet': return 'tamam';
    case 'kriz': return 'hata';
    case 'duyuru': case 'hava': return 'mesaj';
    default: return 'mesaj';
  }
}

/** Yeni bildirim geldiğinde (api.ts). Sayfa odakta değilse, odaklanma durumunda ya da Rahatsız etme açıkken sessiz. */
export function bildirimSesi(kind: string): void {
  const tur = bildirimTuru(kind);
  if (!tur || typeof document === 'undefined') return;
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return; // cihaz kendi bildirim sesini çalıyor
  const s = store.get().me?.settings;
  if (!s || s.dnd) return;
  if (moodOf(s)?.focus) return;
  cal(tur);
}
