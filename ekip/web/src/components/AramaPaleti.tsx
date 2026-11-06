// ⌘K hızlı arama ve komutlar (her ekranda)
// ⌘K / Ctrl+K ya da "/" (yazı alanında değilken) açar · ↑/↓ gezin · Enter aç · Escape kapat.
// Dar ekranda (≤880px) sağ altta küçük bir "Ara" düğmesi görünür.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, fmtDate, memberName, snack, store } from '../api';
import { Avatar, Icon, navigate, useStore } from '../ui';
import { applyTheme, resolvedTheme } from '../theme';
import '../styles/arama.css';

// ---------- Türkçe duyarsız katlama (sunucudaki ile aynı; her harf tek harfe dönüşür, konumlar korunur) ----------
const FOLD: Record<string, string> = {
  Ç: 'c', ç: 'c', Ş: 's', ş: 's', Ğ: 'g', ğ: 'g', Ü: 'u', ü: 'u', Ö: 'o', ö: 'o',
  İ: 'i', I: 'i', ı: 'i', Â: 'a', â: 'a', Î: 'i', î: 'i', Û: 'u', û: 'u',
};
const fold = (s: string) => Array.from(s, (ch) => FOLD[ch] ?? (ch >= 'A' && ch <= 'Z' ? ch.toLowerCase() : ch)).join('');
const tokensOf = (q: string) => [...new Set(fold(q.replace(/\s+/g, ' ').trim()).split(' ').filter(Boolean))];
const matches = (text: string, tokens: string[]) => { const f = fold(text); return tokens.every((t) => f.includes(t)); };

/** Eşleşen kısımları <mark> ile vurgular */
function Hl({ text, tokens }: { text: string; tokens: string[] }) {
  if (!text) return null;
  const chars = Array.from(text);
  const f = Array.from(fold(text));
  if (f.length !== chars.length || !tokens.length) return <>{text}</>;
  const on = new Array(chars.length).fill(false);
  const fs = f.join('');
  for (const tk of tokens) {
    const tl = Array.from(tk).length;
    let i = fs.indexOf(tk);
    while (i >= 0) {
      const start = Array.from(fs.slice(0, i)).length;
      for (let k = start; k < start + tl; k++) on[k] = true;
      i = fs.indexOf(tk, i + tk.length);
    }
  }
  const out: ComponentChildren[] = [];
  let buf = '', cur = false;
  chars.forEach((ch, i) => {
    if (on[i] !== cur) { if (buf) out.push(cur ? <mark>{buf}</mark> : buf); buf = ''; cur = on[i]; }
    buf += ch;
  });
  if (buf) out.push(cur ? <mark>{buf}</mark> : buf);
  return <>{out}</>;
}

// ---------- tipler ----------
type Action =
  | { t: 'task'; id: string }
  | { t: 'nav'; path: string }
  | { t: 'dm'; userId: string }
  | { t: 'cmd'; id: string };
interface Item {
  key: string; group: string; icon: string; title: string; sub?: string; done?: boolean; tag?: string;
  avatar?: string; // ekip üyesi id (avatar için)
  action: Action;
  hlSub?: boolean;
}
interface Results {
  q: string;
  tasks: { id: string; title: string; client: string; dueDate: string | null; status: number; assigneeId: string | null; done: boolean }[];
  clients: { id: string; name: string; link: string }[];
  shoots: { id: string; title: string; client: string; date: string; time: string; location: string; status: number; done: boolean; link: string }[];
  days: { id: string; name: string; date: string; range: string | null; done: boolean; link: string }[];
  agenda: { type: 'todo' | 'event' | 'note'; id: string; title: string; date: string | null; time?: string; done: boolean; link: string }[];
  messages: { id: string; channelId: string; userId: string; text: string; channel: string | null; kind: string; dmWith: string | null; link: string }[];
  people: { id: string; firstName: string; lastName: string; color: string; photo: string | null }[];
}

const NAV_CMDS: { id: string; title: string; path: string; icon: string; kw?: string }[] = [
  { id: 'go-bugun', title: 'Bugün', path: '/', icon: 'sun', kw: 'ana sayfa' },
  { id: 'go-isler', title: 'İş Planı', path: '/isler', icon: 'board', kw: 'isler gorevler' },
  { id: 'go-ajanda', title: 'Ajandam', path: '/ajanda', icon: 'note', kw: 'notlar yapilacaklar takvim' },
  { id: 'go-ozel', title: 'Özel Günler', path: '/ozel-gunler', icon: 'cal' },
  { id: 'go-cekim', title: 'Çekim Planı', path: '/cekim', icon: 'cam' },
  { id: 'go-musteri', title: 'Müşteriler', path: '/musteriler', icon: 'clients', kw: 'firmalar marka' },
  { id: 'go-sohbet', title: 'Sohbet', path: '/sohbet', icon: 'chat', kw: 'mesaj kanal' },
  { id: 'go-durt', title: 'Dürtme', path: '/durt', icon: 'hand' },
];

const RECENT_KEY = 'maya.arama.son';
function readRecent(): Item[] {
  try { const v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); return Array.isArray(v) ? v.slice(0, 5) : []; } catch { return []; }
}
function pushRecent(it: Item) {
  if (it.action.t === 'cmd' && it.action.id.startsWith('theme')) return; // tema komutu her seferinde değişir
  try {
    const l = [{ ...it, group: 'Son kullanılanlar' }, ...readRecent().filter((x) => x.key !== it.key)].slice(0, 5);
    localStorage.setItem(RECENT_KEY, JSON.stringify(l));
  } catch { /* */ }
}

const isTyping = (e: KeyboardEvent) => {
  const el = (e.target as HTMLElement) || null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
};
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function AramaPaleti({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const openRef = useRef(false);
  openRef.current = open;
  const lastFocus = useRef<HTMLElement | null>(null);
  const pendingEnter = useRef(false); // sonuç gelmeden Enter'a basıldıysa, gelince ilk sonucu aç

  const show = () => { if (!store.get().me) return; pendingEnter.current = false; lastFocus.current = document.activeElement as HTMLElement; setOpen(true); setQ(''); setRes(null); setSel(0); };
  const hide = () => {
    setOpen(false);
    const f = lastFocus.current; lastFocus.current = null;
    if (f && document.contains(f)) setTimeout(() => { try { f.focus(); } catch { /* */ } }, 0);
  };

  // kısayollar (yakalama aşamasında: palet açıkken başka pencereler Escape'i almasın)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!store.get().me) return;
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault(); e.stopPropagation();
        if (openRef.current) hide(); else show();
        return;
      }
      if (openRef.current) {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hide(); }
        return;
      }
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e)) { e.preventDefault(); show(); }
    };
    window.addEventListener('keydown', k, true);
    return () => window.removeEventListener('keydown', k, true);
  }, []);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 0); }, [open]);
  useEffect(() => { if (!s.me && open) setOpen(false); }, [s.me]);

  // arama: 150 ms gecikmeli, sorgu başına tek istek; eski cevaplar yok sayılır
  const tokens = useMemo(() => tokensOf(q), [q]);
  const longEnough = tokens.join('').length >= 2;
  const qNorm = q.replace(/\s+/g, ' ').trim().slice(0, 80);
  const stale = longEnough && (!res || res.q !== qNorm); // ekrandaki sonuçlar yazılan sorguya ait değil (henüz gelmedi)
  useEffect(() => {
    if (!open) return;
    const my = ++seq.current;
    if (!longEnough) { setRes(null); setLoading(false); return; }
    setLoading(true);
    const t = setTimeout(() => {
      api<Results>('GET', '/search?q=' + encodeURIComponent(q.trim()))
        .then((r) => { if (my === seq.current) { setRes(r); setLoading(false); } })
        .catch((e) => { if (my === seq.current) { pendingEnter.current = false; setLoading(false); setRes(null); if (e?.status !== 401) snack(e.message || 'Arama yapılamadı'); } });
    }, 150);
    return () => clearTimeout(t);
  }, [q, open]);

  const me = s.me;
  const team = s.team;

  // komutlar
  const commands = useMemo<Item[]>(() => {
    const dark = resolvedTheme() === 'dark';
    const l: Item[] = [
      { key: 'cmd:new-task', group: 'Komutlar', icon: 'plus', title: 'Yeni iş ekle', sub: 'İş Planı’na yeni iş', action: { t: 'cmd', id: 'new-task' } },
      ...NAV_CMDS.map((n) => ({ key: 'cmd:' + n.id, group: 'Komutlar', icon: n.icon, title: n.title, sub: 'Sayfaya git', action: { t: 'nav', path: n.path } as Action, kw: n.kw })),
      dark
        ? { key: 'cmd:theme-light', group: 'Komutlar', icon: 'sun', title: 'Açık tema', sub: 'Görünümü değiştir', action: { t: 'cmd', id: 'theme-light' } }
        : { key: 'cmd:theme-dark', group: 'Komutlar', icon: 'moon', title: 'Koyu tema', sub: 'Görünümü değiştir', action: { t: 'cmd', id: 'theme-dark' } },
    ];
    return l as (Item & { kw?: string })[];
  }, [open, q]);
  const nudgeCmds = useMemo<Item[]>(() => (me ? team.filter((m) => m.id !== me.id && m.status === 'active') : []).map((m) => ({
    key: 'cmd:nudge:' + m.id, group: 'Komutlar', icon: 'hand', title: 'Dürt: ' + m.name, sub: 'Hemen dikkatini çek', avatar: m.id,
    action: { t: 'cmd', id: 'nudge:' + m.id },
  })), [team, me?.id]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    if (!tokens.length) {
      out.push(...readRecent());
      out.push(...commands);
      return out;
    }
    const cmdHits = [...commands, ...nudgeCmds].filter((c) => matches(c.title + ' ' + ((c as any).kw || ''), tokens)).slice(0, 5);
    out.push(...cmdHits);
    if (!res || !longEnough) return out;
    const taskSub = (t: Results['tasks'][number]) => [t.client, t.dueDate ? fmtDate(t.dueDate) : '', t.assigneeId ? memberName(team, t.assigneeId) : ''].filter(Boolean).join(' · ');
    res.tasks.forEach((t) => out.push({ key: 'task:' + t.id, group: 'İşler', icon: 'board', title: t.title, sub: taskSub(t), done: t.done, tag: t.done ? 'Tamamlandı' : t.status === 1 ? 'Devam' : undefined, action: { t: 'task', id: t.id }, hlSub: true }));
    res.clients.forEach((c) => out.push({ key: 'client:' + c.id, group: 'Müşteriler', icon: 'clients', title: c.name, sub: 'Marka kiti', action: { t: 'nav', path: c.link } }));
    res.shoots.forEach((x) => out.push({
      key: 'shoot:' + x.id, group: 'Çekimler', icon: 'cam', title: x.title,
      sub: [x.client, fmtDate(x.date) + (x.time ? ' ' + x.time : ''), x.location].filter(Boolean).join(' · '),
      done: x.done, tag: x.status === 1 ? 'Tamamlandı' : x.status === 2 ? 'İptal' : undefined, action: { t: 'nav', path: x.link }, hlSub: true,
    }));
    res.days.forEach((d) => out.push({ key: 'day:' + d.id, group: 'Özel günler', icon: 'cal', title: d.name, sub: d.range || fmtDate(d.date), done: d.done, tag: d.done ? 'Geçti' : undefined, action: { t: 'nav', path: d.link } }));
    res.agenda.forEach((a) => out.push({
      key: 'ag:' + a.id, group: 'Ajandam', icon: a.type === 'note' ? 'note' : a.type === 'event' ? 'cal' : 'check', title: a.title,
      sub: (a.type === 'note' ? 'Not' : a.type === 'event' ? 'Etkinlik' : 'Yapılacak') + (a.date ? ' · ' + fmtDate(a.date) + (a.time ? ' ' + a.time : '') : ''),
      done: a.done, tag: a.done ? (a.type === 'todo' ? 'Yapıldı' : 'Geçti') : undefined, action: { t: 'nav', path: a.link },
    }));
    res.messages.forEach((m) => out.push({
      key: 'msg:' + m.id, group: 'Sohbet', icon: 'chat', title: m.text || '(dosya)', avatar: m.userId,
      sub: (m.kind === 'dm' ? 'Birebir · ' + memberName(team, m.dmWith) : '#' + m.channel) + ' · ' + memberName(team, m.userId),
      action: { t: 'nav', path: m.link },
    }));
    res.people.forEach((p) => out.push({ key: 'dm:' + p.id, group: 'Kişiler', icon: 'user', title: (p.firstName + ' ' + p.lastName).trim(), sub: 'Birebir mesaj aç', avatar: p.id, action: { t: 'dm', userId: p.id } }));
    return out;
  }, [tokens, res, commands, nudgeCmds, team]);

  useEffect(() => {
    setSel(0);
    if (pendingEnter.current && !stale) { pendingEnter.current = false; if (items[0]) run(items[0]); }
  }, [items, stale]);
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel, open]);

  async function run(it: Item) {
    pushRecent(it);
    hide();
    const a = it.action;
    try {
      if (a.t === 'task') openTask(a.id);
      else if (a.t === 'nav') navigate(a.path);
      else if (a.t === 'dm') {
        const ch = await api<{ id: string }>('POST', '/chat/dm', { userId: a.userId });
        navigate('/sohbet?c=' + ch.id);
      } else if (a.id === 'new-task') window.dispatchEvent(new CustomEvent('maya-desktop', { detail: { action: 'new-task' } }));
      else if (a.id === 'theme-dark' || a.id === 'theme-light') {
        const v = a.id === 'theme-dark' ? 'dark' : 'light';
        applyTheme(v);
        api('PATCH', '/me', { settings: { theme: v } }).catch(() => {});
        snack(v === 'dark' ? 'Koyu tema açıldı' : 'Açık tema açıldı');
      } else if (a.id.startsWith('nudge:')) {
        const to = a.id.slice(6);
        await api('POST', '/nudge', { to });
        snack(memberName(store.get().team, to) + ' dürtüldü');
      }
    } catch (e: any) { snack(e.message || 'Olmadı, tekrar dene'); }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (items.length) setSel((i) => (i + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); if (items.length) setSel((i) => (i - 1 + items.length) % items.length); }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setSel(0); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (stale && sel === 0) { pendingEnter.current = true; return; } // yeni sonuçlar gelince ilkini aç
      const it = items[sel]; if (it) run(it);
    }
    else if (e.key === 'Tab') { e.preventDefault(); } // odak kutuda kalsın
  }

  if (!me) return null;

  const fab = !open && (
    <button type="button" class="ap-fab" aria-label="Ara (komut paleti)" onClick={show}>
      <Icon n="search" size={18} /><span>Ara</span>
    </button>
  );
  if (!open) return fab || null;

  // gruplara ayır (sıra korunur)
  const groups: { name: string; list: { it: Item; i: number }[] }[] = [];
  items.forEach((it, i) => {
    let g = groups[groups.length - 1];
    if (!g || g.name !== it.group) { g = { name: it.group, list: [] }; groups.push(g); }
    g.list.push({ it, i });
  });
  const noResults = longEnough && !loading && res && items.length === 0;
  const tooShort = tokens.length > 0 && !longEnough && items.length === 0;
  const activeId = items[sel] ? 'ap-o-' + sel : undefined;
  const memberOf = (id?: string) => (id ? team.find((m) => m.id === id) : undefined);

  return (
    <div class="overlay ap-root">
      <button type="button" class="scrim" aria-label="Kapat" tabIndex={-1} onClick={hide} />
      <div class="ap" role="dialog" aria-modal="true" aria-label="Hızlı arama ve komutlar">
        <div class="ap-in">
          <Icon n="search" size={18} />
          <input ref={inputRef} type="text" value={q} placeholder="İş, müşteri, çekim, mesaj ara ya da komut yaz…"
            role="combobox" aria-expanded="true" aria-controls="ap-list" aria-autocomplete="list" aria-activedescendant={activeId}
            aria-label="Ara" autoComplete="off" autoCorrect="off" spellcheck={false} enterKeyHint="go"
            onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={onKey} />
          {loading && <span class="ap-spin" aria-label="Aranıyor" role="status" />}
          <button type="button" class="ap-esc" onClick={hide} aria-label="Kapat">esc</button>
        </div>
        <div class="ap-list" id="ap-list" role="listbox" aria-label="Sonuçlar" ref={listRef}>
          {groups.map((g) => (
            <div class="ap-g" role="group" aria-label={g.name} key={g.name}>
              <div class="ap-gh" aria-hidden="true">{g.name}</div>
              {g.list.map(({ it, i }) => {
                const m = memberOf(it.avatar);
                return (
                  <div id={'ap-o-' + i} key={it.key} role="option" aria-selected={i === sel}
                    class={'ap-it' + (i === sel ? ' on' : '') + (it.done ? ' done' : '')}
                    onMouseMove={() => { if (i !== sel) setSel(i); }} onClick={() => run(it)}>
                    <span class="ap-ic" aria-hidden="true">{m && it.group !== 'Komutlar' ? <Avatar m={m} size={24} radius={7} /> : <Icon n={it.icon} size={16} />}</span>
                    <span class="ap-tx">
                      <span class="ap-t"><Hl text={it.title} tokens={tokens} /></span>
                      {it.sub && <span class="ap-s">{it.hlSub ? <Hl text={it.sub} tokens={tokens} /> : it.sub}</span>}
                    </span>
                    {it.tag && <span class="ap-tag">{it.tag}</span>}
                    {i === sel && <span class="ap-enter" aria-hidden="true">↵</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {noResults && <div class="ap-empty">“{q.trim()}” için sonuç yok</div>}
          {tooShort && <div class="ap-empty">Aramak için en az 2 harf yaz</div>}
          {longEnough && loading && !res && items.length === 0 && <div class="ap-empty">Aranıyor…</div>}
        </div>
        <div class="ap-foot" aria-hidden="true">
          <span><kbd>↑</kbd><kbd>↓</kbd> gezin</span><span><kbd>↵</kbd> aç</span><span><kbd>esc</kbd> kapat</span>
          <span class="spacer" /><span><kbd>{isMac ? '⌘' : 'Ctrl'}</kbd><kbd>K</kbd></span>
        </div>
      </div>
    </div>
  );
}
