import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { store, type State, type Member, type Me, initials, moodOf } from './api';

export function useStore(): State {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force((n) => n + 1)), []);
  return store.get();
}

// ---------- yönlendirme ----------
export function navigate(path: string) {
  if (location.pathname !== path) history.pushState({}, '', path);
  window.dispatchEvent(new Event('maya-nav'));
}
export function usePath(): string {
  const [p, setP] = useState(location.pathname);
  useEffect(() => {
    const f = () => setP(location.pathname);
    window.addEventListener('popstate', f); window.addEventListener('maya-nav', f);
    return () => { window.removeEventListener('popstate', f); window.removeEventListener('maya-nav', f); };
  }, []);
  return p;
}
export function Link(props: { href: string; class?: string; children: ComponentChildren; 'aria-current'?: 'page'; title?: string }) {
  return (
    <a href={props.href} class={props.class} aria-current={props['aria-current']} title={props.title}
      onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(props.href); }}>
      {props.children}
    </a>
  );
}

// ---------- simgeler (çizgi) ----------
const P: Record<string, string> = {
  phone: '<path d="M6.6 3h2.6l1.4 4-2 1.3a12 12 0 0 0 7.1 7.1l1.3-2 4 1.4v2.6A2.6 2.6 0 0 1 18.4 21 15.4 15.4 0 0 1 3 5.6 2.6 2.6 0 0 1 5.6 3z"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  save: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  play: '<path d="M8 5l11 7-11 7z"/>',
  asterisk: '<path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  spark: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  note: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 12h8M8 16h6"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  board: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  cam: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3"/>',
  hand: '<path d="M9 11V5a1.5 1.5 0 0 1 3 0v5M12 10V4a1.5 1.5 0 0 1 3 0v6M15 10V6a1.5 1.5 0 0 1 3 0v7a7 7 0 0 1-7 7h-1a6 6 0 0 1-5.2-3L3 13.5a1.5 1.5 0 0 1 2.6-1.5L9 15"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
  clients: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h6"/>',
  team: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14.2A5 5 0 0 1 21.5 19"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  out: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/><path d="M10 17l-5-5 5-5M5 12h11"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  camera: '<path d="M4 7h3l2-3h6l2 3h3v13H4z"/><circle cx="12" cy="13" r="4"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
};
export function Icon({ n, size = 18, stroke = 'currentColor', w = 2 }: { n: keyof typeof P | string; size?: number; stroke?: string; w?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} stroke-width={w} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: P[n] || '' }} />;
}

type AvatarMember = Pick<Member, 'firstName' | 'lastName' | 'color' | 'photo'> & { id?: string | null; mood?: Member['mood'] };
/** Avatar: büyüklüğü 20px ve üstündeyse çevrimiçi noktası, 24px ve üstündeyse durum emojisi gösterir. */
export function Avatar({ m, size = 26, radius, presence = true }: { m: AvatarMember | null | undefined; size?: number; radius?: number; presence?: boolean }) {
  const s = useStore();
  const r = radius ?? Math.round(size * 0.3);
  const style = { width: size + 'px', height: size + 'px', borderRadius: r + 'px', background: m ? m.color : '#8C8074', fontSize: Math.round(size * 0.4) + 'px' };
  const inner = m?.photo ? <span class="av" style={style}><img src={m.photo} alt="" /></span> : <span class="av" style={style}>{m ? initials(m.firstName, m.lastName) : '–'}</span>;
  const online = presence && size >= 20 && !!m?.id && s.presence.includes(m.id);
  const mood = size >= 24 ? m?.mood : null;
  if (!online && !mood?.emoji) return inner;
  const dot = Math.max(8, Math.round(size * 0.28));
  return (
    <span class="avw" style={{ width: size + 'px', height: size + 'px' }} title={mood ? (mood.emoji + ' ' + mood.text).trim() : undefined}>
      {inner}
      {online && <i class="av-dot" style={{ width: dot + 'px', height: dot + 'px' }} aria-label="Çevrimiçi" />}
      {mood?.emoji && <i class="av-mood" style={{ fontSize: Math.max(10, Math.round(size * 0.36)) + 'px' }} aria-hidden="true">{mood.emoji}</i>}
    </span>
  );
}

export function Switch({ on, label, hint, onToggle }: { on: boolean; label: string; hint?: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} class={'switch' + (on ? ' on' : '')} onClick={onToggle}>
      <span style="flex:1;display:flex;flex-direction:column;gap:2px">
        <span style="font-size:13px;font-weight:600">{label}</span>
        {hint && <span style="font-size:12px;color:var(--mute2)">{hint}</span>}
      </span>
      <span class="tr"><span class="kn" /></span>
    </button>
  );
}

export function Modal({ title, onClose, children, width }: { title: string; onClose: () => void; children: ComponentChildren; width?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div class="overlay">
      <button type="button" class="scrim" aria-label="Kapat" onClick={onClose} />
      <div class="dialog" role="dialog" aria-modal="true" aria-label={title} style={width ? { width: width + 'px' } : undefined}>
        <div class="row"><h2>{title}</h2><span class="spacer" /><button type="button" class="iconbtn" aria-label="Kapat" onClick={onClose}><Icon n="x" size={16} /></button></div>
        {children}
      </div>
    </div>
  );
}

export function meAsMember(me: Me): AvatarMember {
  return { id: me.id, firstName: me.firstName, lastName: me.lastName, color: me.color, photo: me.photo, mood: moodOf(me.settings) };
}
