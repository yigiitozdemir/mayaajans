// Gelen dürtmeleri her ekranda karşılar: ses, ekran titremesi, Mac bildirimi (hiçbir şeyi engellemez).
import { useEffect, useState } from 'preact/hooks';
import { api, ApiError, onLive, snack, store, moodOf } from '../api';
import { desktopInvoke, isDesktop } from '../desktop';
import { Avatar, navigate, useStore } from '../ui';
import '../styles/durt.css';

export const NUDGE_COOLDOWN_S = 15;
export const NUDGE_MSG_MAX = 80;

// ---------- bekleme süresi (kişi başına, sekme içinde ortak) ----------
const cooldown = new Map<string, number>(); // userId → bitiş (ms)
const CD_EVENT = 'maya-nudge-cd';
function setCooldown(id: string, seconds: number) {
  cooldown.set(id, Date.now() + seconds * 1000);
  window.dispatchEvent(new Event(CD_EVENT));
}
/** Kalan saniye (0 = dürtülebilir) */
export function cooldownLeft(id: string): number {
  const until = cooldown.get(id) || 0;
  return Math.max(0, Math.ceil((until - Date.now()) / 1000));
}
/** Bekleme süreleri değiştikçe ve geri sayım sürerken saniyede bir yeniden çizer. */
export function useCooldownTick() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    window.addEventListener(CD_EVENT, f);
    const iv = setInterval(() => { for (const v of cooldown.values()) if (v > Date.now() - 1000) { f(); break; } }, 1000);
    return () => { window.removeEventListener(CD_EVENT, f); clearInterval(iv); };
  }, []);
}

export interface NudgeResult { ok: boolean; dnd?: boolean; wait?: number; error?: string }
/** Dürt: sunucuya gönderir, bekleme süresini işler, sonucu döner (hata mesajı dahil). */
export async function sendNudge(to: string, message = ''): Promise<NudgeResult> {
  const left = cooldownLeft(to);
  if (left > 0) return { ok: false, wait: left, error: `Biraz bekle, ${left} saniye sonra yeniden dürtebilirsin` };
  try {
    const r = await api<{ ok: true; dnd?: boolean; wait: number }>('POST', '/nudge', { to, message: message.trim() || undefined });
    setCooldown(to, r.wait || NUDGE_COOLDOWN_S);
    window.dispatchEvent(new Event('maya-nudge-sent'));
    return { ok: true, dnd: !!r.dnd };
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Dürtülemedi';
    if (e instanceof ApiError && e.status === 429) {
      const m = /(\d+) saniye/.exec(msg);
      const w = m ? Number(m[1]) : NUDGE_COOLDOWN_S;
      setCooldown(to, w);
      return { ok: false, wait: w, error: msg };
    }
    return { ok: false, error: msg };
  }
}
export function nudgeSnack(name: string, r: NudgeResult) {
  if (r.ok) snack(r.dnd ? `${name}: Rahatsız etme açık, sessizce iletildi` : `${name} dürtüldü 👋`);
  else snack(r.error || 'Dürtülemedi');
}

// ---------- ses: kısa, üç notalı "tık-tık-tık" ----------
let audio: AudioContext | null = null;
function ensureAudio(): AudioContext | null {
  try {
    const C = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!C) return null;
    if (!audio) audio = new C() as AudioContext;
    if (audio.state === 'suspended') audio.resume().catch(() => {});
    return audio;
  } catch { return null; }
}
// Tarayıcılar sesi ancak bir kullanıcı etkileşiminden sonra açar: ilk tıklama/tuşta hazırla.
if (typeof window !== 'undefined') {
  const unlock = () => {
    const ctx = ensureAudio();
    if (ctx && ctx.state === 'running') {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    }
  };
  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
}
export function beep() {
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const t = ctx.currentTime;
    ([[0, 587], [0.11, 784], [0.22, 659]] as const).forEach(([d, f]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t + d);
      g.gain.setValueAtTime(0.0001, t + d);
      g.gain.exponentialRampToValueAtTime(0.22, t + d + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.1);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + d); o.stop(t + d + 0.11);
    });
  } catch { /* */ }
}

// ---------- ekran titremesi: yalnızca sınıf ekler, DOM'a dokunmaz (odak ve yazılan metin korunur) ----------
let shakeTimer: any;
export function shakeScreen() {
  const el = document.getElementById('app') || document.body;
  clearTimeout(shakeTimer);
  el.classList.remove('durt-shake');
  void el.offsetWidth; // animasyonu yeniden başlat
  el.classList.add('durt-shake');
  shakeTimer = setTimeout(() => el.classList.remove('durt-shake'), 650);
}

// ---------- sistem bildirimi (pencere odakta olsa bile) ----------
function systemNudge(id: string, title: string, body: string) {
  try {
    if (isDesktop) { desktopInvoke('notify', { title, body }); return; }
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    const n = new Notification(title, { body, icon: '/icon-192.png', tag: 'nudge-' + id });
    n.onclick = () => { try { window.focus(); } catch { /* */ } navigate('/durt'); n.close(); };
  } catch { /* */ }
}

interface Balloon { id: string; fromId: string; message: string }

export function NudgeReceiver() {
  const s = useStore();
  const [items, setItems] = useState<Balloon[]>([]);
  useCooldownTick();

  const close = (id: string) => setItems((l) => l.filter((x) => x.id !== id));

  useEffect(() => onLive(['nudge'], (msg) => {
    const n = msg?.nudge;
    if (!n || !n.id) return; // '*' (yeniden bağlanma) olayı
    const me = store.get().me;
    if (!me || n.fromId === me.id) return;
    const st = me.settings || {};
    if (st.dnd === true || moodOf(st)?.focus) return; // rahatsız etme / Odaklanıyorum: sessiz, zil kaydı yeter
    const from = store.get().team.find((m) => m.id === n.fromId);
    const first = from?.firstName || 'Ekipten biri';
    if (st.nudgeSound !== false) beep();
    if (st.nudgeShake !== false) shakeScreen();
    if (st.nudgeMac !== false) systemNudge(n.id, `${first} seni dürttü`, n.message || '👋');
    setItems((l) => [{ id: n.id, fromId: n.fromId, message: n.message || '' }, ...l.filter((x) => x.id !== n.id)].slice(0, 3));
    setTimeout(() => close(n.id), 6000);
  }), []);

  if (!s.me || !items.length) return null;
  return (
    <div class="durt-balloons" aria-live="polite">
      {items.map((b) => {
        const m = s.team.find((x) => x.id === b.fromId);
        const first = m?.firstName || 'Ekipten biri';
        const left = cooldownLeft(b.fromId);
        return (
          <div class="durt-balloon" role="status" key={b.id} data-nudge={b.id}>
            <span class="durt-wiggle" style="display:flex;flex:none"><Avatar m={m} size={40} radius={12} /></span>
            <span class="durt-balloon-txt">
              <strong>{first} seni dürttü!</strong>
              <span>{b.message || 'Bir bakar mısın? 👋'}</span>
              <span class="row" style="gap:6px;margin-top:6px">
                <button type="button" class="btn primary sm" disabled={left > 0} onClick={async () => {
                  const r = await sendNudge(b.fromId);
                  nudgeSnack(m?.name || first, r);
                  if (r.ok) close(b.id);
                }}>{left > 0 ? `Geri dürt · ${left} sn` : 'Geri dürt'}</button>
                <button type="button" class="btn ghost sm" onClick={() => close(b.id)}>Kapat</button>
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
