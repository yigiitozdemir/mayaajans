// Sohbet: açık kanalın mesajları + yazma alanı
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, ApiError, onLive, snack, LDAY, LMON, type Member, type Me } from '../api';
import { Avatar, Icon } from '../ui';
import { chatView, firstWord, fmtSize, isViewing, mentionsMe, setChannelRead, type ChatChannel, type ChatMessage } from './SohbetData';

const MAX_TEXT = 4000;
const MAX_FILE = 25 * 1024 * 1024;
const IMG = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const GROUP_MS = 5 * 60 * 1000;
const drafts = new Map<string, string>(); // kanal başına yarım kalan mesaj
const lowerTr = (s: string) => (s || '').toLocaleLowerCase('tr');
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (d: Date) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const hhmm = (iso: string) => { const d = new Date(iso); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

function dayLabel(d: Date): string {
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return 'Bugün';
  if (dayKey(d) === dayKey(y)) return 'Dün';
  return d.getDate() + ' ' + LMON[d.getMonth()] + (d.getFullYear() !== today.getFullYear() ? ' ' + d.getFullYear() : '') + ' ' + LDAY[d.getDay()];
}

/** Metni güvenle işler: yalnızca http/https bağlantıları tıklanabilir, @bahsetmeler vurgulanır. */
export function RichText({ text, team, me }: { text: string; team: Member[]; me: Me }) {
  const names = new Set(team.map((m) => lowerTr(firstWord(m.firstName))).filter(Boolean));
  const mine = lowerTr(firstWord(me.firstName));
  const out: ComponentChildren[] = [];
  const re = /(https?:\/\/[^\s<>"']+)|@([\p{L}\p{N}_]+)/giu;
  let last = 0; let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      let url = m[1]; let tail = '';
      const t = /[.,;:!?)\]}'"»]+$/.exec(url);
      if (t) { tail = t[0]; url = url.slice(0, -tail.length); }
      let safe = false;
      try { const u = new URL(url); safe = u.protocol === 'http:' || u.protocol === 'https:'; } catch { /* */ }
      out.push(safe ? <a href={url} target="_blank" rel="noopener noreferrer">{url}</a> : url);
      if (tail) out.push(tail);
    } else {
      const n = lowerTr(m[2]);
      if (n === 'herkes' || names.has(n)) out.push(<span class={'ch-mention' + (n === mine || n === 'herkes' ? ' me' : '')}>{m[0]}</span>);
      else out.push(m[0]);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

function FileView({ f, onLoad }: { f: NonNullable<ChatMessage['file']>; onLoad: () => void }) {
  if (IMG.has(f.type)) {
    return (
      <a class="ch-img" href={f.url} target="_blank" rel="noopener noreferrer" title={f.name + ' · ' + fmtSize(f.size)}>
        <img src={f.url} alt={f.name} loading="lazy" onLoad={onLoad} />
      </a>
    );
  }
  return (
    <span class="ch-file">
      <span class="ic"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg></span>
      <span class="nm"><strong>{f.name}</strong><span>{fmtSize(f.size)}</span></span>
      <a class="btn sm" href={f.url + '?download=1'} download={f.name}>İndir</a>
    </span>
  );
}

function MessageItem({ m, compact, me, team, onChanged }: { m: ChatMessage; compact: boolean; me: Me; team: Member[]; onChanged: (m: ChatMessage) => void; }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(m.text);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const author = team.find((x) => x.id === m.userId);
  const own = m.userId === me.id;
  const hit = !own && !m.deleted && mentionsMe(m.text, me.firstName);

  async function save() {
    const text = val.trim();
    if (!text && !m.file) { snack('Mesaj boş olamaz'); return; }
    if (text.length > MAX_TEXT) { snack('Mesaj en fazla 4000 karakter olabilir'); return; }
    setBusy(true);
    try { onChanged(await api<ChatMessage>('PATCH', '/chat/messages/' + m.id, { text })); setEditing(false); }
    catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  async function del() {
    setBusy(true);
    try { await api('DELETE', '/chat/messages/' + m.id); onChanged({ ...m, deleted: true, text: '', file: null }); }
    catch (e: any) { snack(e.message); } finally { setBusy(false); setConfirm(false); }
  }

  return (
    <div class={'ch-msg' + (compact ? ' compact' : '') + (hit ? ' hit' : '')} data-id={m.id}>
      <span class="ch-av">{compact ? <span class="ch-t">{hhmm(m.createdAt)}</span> : <Avatar m={author} size={38} radius={11} />}</span>
      <div class="ch-body">
        {!compact && <div class="ch-meta"><strong>{author?.name || 'Eski üye'}</strong><span>{hhmm(m.createdAt)}</span></div>}
        {m.deleted ? <p class="ch-text deleted">Bu mesaj silindi</p>
          : editing ? (
            <div class="ch-edit">
              <textarea class="input" value={val} aria-label="Mesajı düzenle" rows={Math.min(8, Math.max(2, val.split('\n').length))}
                ref={(el) => { if (el && !el.dataset.f) { el.dataset.f = '1'; el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }}
                onInput={(e) => setVal((e.target as HTMLTextAreaElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setVal(m.text); }
                  else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); }
                }} />
              <span class="row" style="gap:6px">
                <button type="button" class="btn primary sm" disabled={busy} onClick={save}>Kaydet</button>
                <button type="button" class="btn ghost sm" onClick={() => { setEditing(false); setVal(m.text); }}>Vazgeç</button>
                <span class="sub" style="font-size:11px">Enter kaydeder · Esc vazgeçer</span>
              </span>
            </div>
          ) : (
            <>
              {m.text && <p class="ch-text"><RichText text={m.text} team={team} me={me} />{m.editedAt && <span class="ch-edited"> (düzenlendi)</span>}</p>}
              {m.file && <FileView f={m.file} onLoad={() => window.dispatchEvent(new Event('ch-img'))} />}
            </>
          )}
      </div>
      {own && !m.deleted && !editing && (
        <span class={'ch-acts' + (confirm ? ' on' : '')}>
          {confirm ? (
            <>
              <span class="sub" style="font-size:12px">Silinsin mi?</span>
              <button type="button" class="btn danger confirm sm" disabled={busy} onClick={del}>Sil</button>
              <button type="button" class="btn ghost sm" onClick={() => setConfirm(false)}>Vazgeç</button>
            </>
          ) : (
            <>
              <button type="button" class="ch-act" onClick={() => { setVal(m.text); setEditing(true); }}>Düzenle</button>
              <button type="button" class="ch-act" onClick={() => setConfirm(true)}>Sil</button>
            </>
          )}
        </span>
      )}
    </div>
  );
}

function Composer({ ch, team, me, placeholder, onSent }: { ch: ChatChannel; team: Member[]; me: Me; placeholder: string; onSent: (m: ChatMessage) => void }) {
  const [text, setText] = useState(drafts.get(ch.id) || '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [sugg, setSugg] = useState<{ q: string; start: number; sel: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);

  useEffect(() => { drafts.set(ch.id, text); }, [text, ch.id]);
  useLayoutEffect(() => {
    const el = ta.current; if (!el) return;
    el.style.height = 'auto'; el.style.height = Math.min(180, el.scrollHeight) + 'px';
  }, [text]);
  useEffect(() => { if (matchMedia('(hover: hover)').matches) ta.current?.focus(); }, [ch.id]);

  const options = sugg ? [
    ...team.filter((m) => m.id !== me.id).map((m) => ({ key: firstWord(m.firstName), label: m.name, m })),
    { key: 'herkes', label: 'Kanaldaki herkes', m: null as Member | null },
  ].filter((o) => o.key && (lowerTr(o.key).startsWith(lowerTr(sugg.q)) || lowerTr(o.label).startsWith(lowerTr(sugg.q)))).slice(0, 6) : [];

  function detect(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart ?? el.value.length);
    const m = /(^|\s)@([\p{L}\p{N}_]*)$/u.exec(before);
    setSugg(m ? { q: m[2], start: before.length - m[2].length - 1, sel: 0 } : null);
  }
  function pick(key: string) {
    const el = ta.current; if (!el || !sugg) return;
    const end = el.selectionStart ?? el.value.length;
    const next = el.value.slice(0, sugg.start) + '@' + key + ' ' + el.value.slice(end);
    const pos = sugg.start + key.length + 2;
    setText(next); setSugg(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  }
  function choose(f: File | null | undefined) {
    if (!f) return;
    if (f.size > MAX_FILE) { snack('Dosya en fazla 25 MB olabilir'); return; }
    if (f.size === 0) { snack('Dosya boş'); return; }
    setFile(f);
  }

  async function send() {
    const t = text.trim();
    if (busy) return;
    if (!t && !file) return;
    if (t.length > MAX_TEXT) { snack('Mesaj en fazla 4000 karakter olabilir'); return; }
    setBusy(true);
    try {
      let msg: ChatMessage;
      if (file) {
        const fd = new FormData(); fd.append('file', file, file.name); if (t) fd.append('text', t);
        const r = await fetch('/api/chat/channels/' + encodeURIComponent(ch.id) + '/messages', { method: 'POST', body: fd, credentials: 'same-origin' });
        const data: any = await r.json().catch(() => null);
        if (!r.ok) throw new ApiError(r.status, data?.error || 'Dosya gönderilemedi');
        msg = data;
      } else {
        msg = await api<ChatMessage>('POST', '/chat/channels/' + encodeURIComponent(ch.id) + '/messages', { text: t });
      }
      setText(''); setFile(null); drafts.delete(ch.id);
      onSent(msg);
    } catch (e: any) { snack(e.message); } finally { setBusy(false); requestAnimationFrame(() => ta.current?.focus()); }
  }

  return (
    <div class="ch-compose">
      {sugg && options.length > 0 && (
        <div class="ch-sugg" role="listbox" aria-label="Kişi öner">
          {options.map((o, i) => (
            <button type="button" role="option" aria-selected={i === sugg.sel} class={i === sugg.sel ? 'on' : ''}
              onMouseDown={(e) => { e.preventDefault(); pick(o.key); }}>
              {o.m ? <Avatar m={o.m} size={22} radius={7} /> : <span class="ch-hash">@</span>}
              <strong>@{o.key}</strong><span class="sub">{o.label}</span>
            </button>
          ))}
        </div>
      )}
      {file && (
        <div class="ch-pending">
          <Icon n="link" size={14} /><span class="nm">{file.name}</span><span class="sub">{fmtSize(file.size)}</span>
          <button type="button" class="iconbtn" style="width:26px;height:26px" aria-label="Dosyayı kaldır" onClick={() => setFile(null)}><Icon n="x" size={12} /></button>
        </div>
      )}
      <div class="ch-box">
        <button type="button" class="ch-attach" aria-label="Dosya ekle" title="Dosya ekle (en fazla 25 MB)" onClick={() => fileIn.current?.click()}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l7.5-7.5" /></svg>
        </button>
        <input ref={fileIn} type="file" class="sr" tabIndex={-1} aria-hidden="true"
          onChange={(e) => { const el = e.target as HTMLInputElement; choose(el.files?.[0]); el.value = ''; }} />
        <textarea ref={ta} rows={1} value={text} placeholder={placeholder} aria-label="Mesaj yaz" maxLength={MAX_TEXT + 500}
          onInput={(e) => { const el = e.target as HTMLTextAreaElement; setText(el.value); detect(el); }}
          onClick={(e) => detect(e.target as HTMLTextAreaElement)}
          onBlur={() => setTimeout(() => setSugg(null), 120)}
          onPaste={(e) => { const f = e.clipboardData?.files?.[0]; if (f) { e.preventDefault(); choose(f); } }}
          onKeyDown={(e) => {
            if (sugg && options.length) {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSugg({ ...sugg, sel: (sugg.sel + 1) % options.length }); return; }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSugg({ ...sugg, sel: (sugg.sel - 1 + options.length) % options.length }); return; }
              if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(options[Math.min(sugg.sel, options.length - 1)].key); return; }
              if (e.key === 'Escape') { e.preventDefault(); setSugg(null); return; }
            }
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
          }} />
        <button type="button" class="ch-send" aria-label="Gönder" disabled={busy || (!text.trim() && !file)} onClick={send}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" /></svg>
        </button>
      </div>
      <span class="ch-hint">{busy && file ? 'Dosya yükleniyor…' : text.length > MAX_TEXT ? `Çok uzun: ${text.length}/${MAX_TEXT}` : 'Enter ile gönder · Shift+Enter yeni satır · @ ile kişi an'}</span>
    </div>
  );
}

export function Konusma({ ch, me, team, placeholder, empty }: { ch: ChatChannel; me: Me; team: Member[]; placeholder: string; empty: { title: string; text: string } }) {
  const [msgs, setMsgs] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [err, setErr] = useState('');
  const [older, setOlder] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const scroll = useRef<{ mode: 'bottom' } | { mode: 'keep'; h: number; top: number } | null>(null);

  const markRead = () => {
    if (!isViewing(ch.id)) return;
    setChannelRead(ch.id);
    api('POST', '/chat/read', { channelId: ch.id }).catch(() => {});
  };

  async function load() {
    try {
      const r = await api<{ messages: ChatMessage[]; hasMore: boolean }>('GET', '/chat/channels/' + encodeURIComponent(ch.id) + '/messages');
      scroll.current = { mode: 'bottom' };
      setMsgs(r.messages); setHasMore(r.hasMore); setState('ok');
      markRead();
    } catch (e: any) { setErr(e instanceof ApiError && e.status === 403 ? 'Bu konuşmayı göremezsin.' : e.message); setState('error'); }
  }

  async function loadOlder() {
    if (older || !hasMore || !msgs.length) return;
    setOlder(true);
    try {
      const r = await api<{ messages: ChatMessage[]; hasMore: boolean }>('GET', '/chat/channels/' + encodeURIComponent(ch.id) + '/messages?before=' + encodeURIComponent(msgs[0].id));
      const el = list.current;
      scroll.current = el ? { mode: 'keep', h: el.scrollHeight, top: el.scrollTop } : null;
      setMsgs((cur) => { const ids = new Set(cur.map((x) => x.id)); return [...r.messages.filter((x) => !ids.has(x.id)), ...cur]; });
      setHasMore(r.hasMore);
    } catch (e: any) { snack(e.message); } finally { setOlder(false); }
  }

  const upsert = (m: ChatMessage, stick = false) => {
    if (stick || atBottom.current) scroll.current = { mode: 'bottom' };
    setMsgs((cur) => cur.some((x) => x.id === m.id) ? cur.map((x) => (x.id === m.id ? m : x)) : [...cur, m]);
  };

  useEffect(() => {
    chatView.channelId = ch.id;
    setState('loading'); setMsgs([]); load();
    const off = onLive(['chat', '*'], (e) => {
      if (e.type === '*') { load(); return; }
      if (e.channelId !== ch.id) return;
      if (!e.message) { if (e.action !== 'read') load(); return; } // başka bölümün yazdığı mesaj (ör. Çekim hatırlatması)
      upsert(e.message as ChatMessage);
      if (e.action === 'new' && (e.message as ChatMessage).userId !== me.id) markRead();
    });
    const vis = () => { if (document.visibilityState === 'visible') markRead(); };
    const img = () => { if (atBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight; };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', vis);
    window.addEventListener('ch-img', img);
    return () => {
      off(); document.removeEventListener('visibilitychange', vis); window.removeEventListener('focus', vis); window.removeEventListener('ch-img', img);
      if (chatView.channelId === ch.id) chatView.channelId = null;
    };
  }, [ch.id]);

  useLayoutEffect(() => {
    const el = list.current; const s = scroll.current;
    if (!el || !s) return;
    if (s.mode === 'bottom') el.scrollTop = el.scrollHeight;
    else el.scrollTop = s.top + (el.scrollHeight - s.h);
    scroll.current = null;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }, [msgs]);

  const onScroll = () => {
    const el = list.current; if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 80 && hasMore && !older) loadOlder();
  };

  const rows: ComponentChildren[] = [];
  let prev: ChatMessage | null = null;
  for (const m of msgs) {
    const d = new Date(m.createdAt);
    const newDay = !prev || dayKey(new Date(prev.createdAt)) !== dayKey(d);
    if (newDay) rows.push(<div class="ch-day" role="separator"><span>{dayLabel(d)}</span></div>);
    const compact = !newDay && !!prev && prev.userId === m.userId && !prev.deleted && d.getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
    rows.push(<MessageItem key={m.id} m={m} compact={compact} me={me} team={team} onChanged={(x) => upsert(x)} />);
    prev = m;
  }

  return (
    <>
      <div class="ch-list" ref={list} onScroll={onScroll} aria-live="polite" aria-busy={state === 'loading'}>
        {hasMore && (
          <div class="ch-older"><button type="button" class="btn sm" disabled={older} onClick={loadOlder}>{older ? 'Yükleniyor…' : 'Daha eski mesajlar'}</button></div>
        )}
        {state === 'loading' && <p class="empty" style="text-align:center">Yükleniyor…</p>}
        {state === 'error' && <p class="empty" style="text-align:center">{err}</p>}
        {state === 'ok' && msgs.length === 0 && (
          <div class="ch-empty">
            <span class="ic">{ch.kind === 'dm' ? '@' : '#'}</span>
            <strong>{empty.title}</strong>
            <span>{empty.text}</span>
          </div>
        )}
        {rows}
      </div>
      {state !== 'error' && <Composer key={ch.id} ch={ch} team={team} me={me} placeholder={placeholder} onSent={(m) => upsert(m, true)} />}
    </>
  );
}
