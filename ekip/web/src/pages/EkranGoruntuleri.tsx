// Ekran Görüntüleri (yalnızca Mac programı): Mac'te alınan ekran görüntüleri masaüstü yerine buraya gelir.
// Dosyalar yalnızca bu Mac'te kalır; sunucuya gitmez. Paylaşmak isteyen "Ajandama ekle" / "Sohbette paylaş" der.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, pushToast, snack, store } from '../api';
import { Bell } from '../components/Notify';
import { desktopCall, isDesktop, onDesktopEvent } from '../desktop';
import { Icon, Modal, Switch, navigate, useStore } from '../ui';
import { LDAY, LMON } from '../api';
import '../styles/ekran.css';

interface Shot { name: string; size: number; at: number; kind: 'image' | 'video' }
interface Status { enabled: boolean; active: boolean; cleanup: boolean; cleanupDays: number; folder: string; systemLocation: string }

const thumbs = new Map<string, string>(); // ad+zaman → küçük resim (oturum boyunca)
const kb = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
const hhmm = (ms: number) => { const d = new Date(ms); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
function dayLabel(ms: number) {
  const d = new Date(ms); const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((t.getTime() - x.getTime()) / 864e5);
  if (diff === 0) return 'Bugün'; if (diff === 1) return 'Dün';
  return d.getDate() + ' ' + LMON[d.getMonth()] + ' ' + LDAY[d.getDay()] + (d.getFullYear() !== t.getFullYear() ? ' ' + d.getFullYear() : '');
}
function dataUrlToFile(url: string, name: string): File {
  const [head, b64] = url.split(','); const mime = /data:([^;]+)/.exec(head)?.[1] || 'application/octet-stream';
  const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

/** Her ekranda: yeni ekran görüntüsü gelince köşe bildirimi (Ekran Görüntüleri sayfasında değilken). */
export function ShotWatcher() {
  useEffect(() => onDesktopEvent((e: any) => {
    if (e.action !== 'shot' || location.pathname === '/ekran') return;
    pushToast({ id: 'shot:' + e.name + Date.now(), heading: 'Yeni ekran görüntüsü', title: 'Masaüstü yerine Ekran Görüntüleri\'ne kaydedildi.', meta: e.name, taskId: null, actorId: null, link: '/ekran?sec=' + encodeURIComponent(e.name) });
  }), []);
  return null;
}

export function EkranGoruntuleri({ openTask }: { openTask: (id: string) => void }) {
  const [st, setSt] = useState<Status | null>(null);
  const [shots, setShots] = useState<Shot[]>([]);
  const [unsupported, setUnsupported] = useState(!isDesktop);
  const [view, setView] = useState<number | null>(null); // açık önizleme (dizin)
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  const load = async () => {
    try {
      const [s, l] = await Promise.all([desktopCall<Status>('shots_status'), desktopCall<Shot[]>('shots_list')]);
      setSt(s); setShots(l);
      const sel = new URLSearchParams(location.search).get('sec');
      if (sel) { const i = l.findIndex((x) => x.name === sel); if (i >= 0) setView(i); history.replaceState({}, '', '/ekran'); }
    } catch { setUnsupported(true); }
  };
  useEffect(() => { if (isDesktop) load(); }, []);
  useEffect(() => onDesktopEvent((e: any) => { if (e.action === 'shot' || e.action === 'shots') load(); }), []);
  useEffect(() => { const f = () => { if (location.pathname === '/ekran') load(); }; window.addEventListener('maya-nav', f); return () => window.removeEventListener('maya-nav', f); }, []);

  async function toggle(on: boolean) {
    setBusy(true);
    try { setSt(await desktopCall<Status>('shots_enable', { on })); snack(on ? 'Ekran görüntüleri artık buraya kaydedilecek' : 'Ekran görüntüleri yine masaüstüne kaydedilecek'); load(); }
    catch (e: any) { snack(String(e?.message || e)); } finally { setBusy(false); }
  }
  async function setCleanup(on: boolean) { try { setSt(await desktopCall<Status>('shots_set_cleanup', { on })); load(); } catch { /* */ } }

  if (unsupported) {
    return (
      <div class="page">
        <header class="row" style="justify-content:space-between"><h1 class="h1">Ekran Görüntüleri</h1><Bell onOpenTask={openTask} /></header>
        <section class="card shot-empty">
          <span class="shot-hero" aria-hidden="true"><Icon n="image" size={28} /></span>
          <h2>Bu bölüm Maya Ekip Mac programında çalışır</h2>
          <p class="sub">{isDesktop ? 'Mac programını güncelle: üst çubuktaki Maya simgesi → "Güncellemeleri denetle".' : 'Mac programını ekip.mayaajans.net/indir adresinden kurabilirsin.'}</p>
        </section>
      </div>
    );
  }

  const filtered = q.trim() ? shots.filter((s) => s.name.toLocaleLowerCase('tr').includes(q.trim().toLocaleLowerCase('tr'))) : shots;
  const groups: { label: string; items: { s: Shot; i: number }[] }[] = [];
  filtered.forEach((s) => {
    const label = dayLabel(s.at); const i = shots.indexOf(s);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push({ s, i }); else groups.push({ label, items: [{ s, i }] });
  });
  const total = shots.reduce((a, s) => a + s.size, 0);

  return (
    <div class="page">
      <header class="row" style="align-items:flex-start;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:6px">
          <h1 class="h1">Ekran Görüntüleri</h1>
          <span class="sub">Mac'te aldığın ekran görüntüleri masaüstünü doldurmadan burada toplanır · yalnızca bu Mac'te durur, kimse göremez</span>
        </div>
        <Bell onOpenTask={openTask} />
      </header>

      {st && (
        <section class={'card shot-set' + (st.enabled ? '' : ' off')}>
          <Switch on={st.enabled} label="Ekran görüntülerini masaüstü yerine buraya kaydet" hint={st.enabled ? 'Klasör: ' + st.folder : 'Şu an: ' + st.systemLocation} onToggle={() => !busy && toggle(!st.enabled)} />
          {st.enabled && !st.active && <p class="errtext" style="margin:0">Mac'in ekran görüntüsü yeri başka bir yere değiştirilmiş. Yeniden bağlamak için anahtarı kapatıp aç.</p>}
          {st.enabled && <Switch on={st.cleanup} label={st.cleanupDays + ' günden eski olanları çöp kutusuna taşı'} hint="Kapalıyken hiçbir şey silinmez" onToggle={() => setCleanup(!st.cleanup)} />}
          <p class="sub" style="margin:0">Kısayollar: <kbd>⌘⇧3</kbd> tüm ekran · <kbd>⌘⇧4</kbd> seçili alan · <kbd>⌘⇧5</kbd> seçenekler ve ekran kaydı · <kbd>⌘⇧⌃4</kbd> sadece panoya kopyalar (dosya oluşmaz)</p>
        </section>
      )}

      {st?.enabled && (
        <div class="row" style="gap:10px">
          <div class="shot-search"><Icon n="search" size={16} /><input class="input" placeholder="Dosya adında ara…" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Ekran görüntülerinde ara" /></div>
          <span class="sub">{shots.length} dosya · {kb(total)}</span>
          <span class="spacer" />
          <button type="button" class="btn sm" onClick={() => shots[0] && desktopCall('shots_reveal', { name: shots[0].name })} disabled={!shots.length}><Icon n="folder" size={14} />Klasörü Finder'da aç</button>
        </div>
      )}

      {st?.enabled && shots.length === 0 && (
        <section class="card shot-empty">
          <span class="shot-hero" aria-hidden="true"><Icon n="image" size={28} /></span>
          <h2>Henüz ekran görüntüsü yok</h2>
          <p class="sub"><kbd>⌘⇧4</kbd> ile bir alan seç; birkaç saniye içinde burada görünür.</p>
        </section>
      )}
      {st && !st.enabled && shots.length === 0 && (
        <section class="card shot-empty">
          <span class="shot-hero" aria-hidden="true"><Icon n="image" size={28} /></span>
          <h2>Masaüstün ekran görüntüleriyle dolmasın</h2>
          <p class="sub">Yukarıdaki anahtarı açınca Mac'te aldığın her ekran görüntüsü buraya gelir. İstediğin zaman kapatırsın; Mac eski ayarına döner.</p>
          <button type="button" class="btn primary" disabled={busy} onClick={() => toggle(true)}>Aç</button>
        </section>
      )}

      {groups.map((g) => (
        <section class="shot-day">
          <h2 class="shot-dayh">{g.label} <span>{g.items.length}</span></h2>
          <div class="shot-grid">
            {g.items.map(({ s, i }) => <Thumb s={s} onOpen={() => setView(i)} />)}
          </div>
        </section>
      ))}

      {view !== null && shots[view] && (
        <Viewer shots={shots} index={view} onIndex={setView} onClose={() => setView(null)} onChanged={load} />
      )}
    </div>
  );
}

function Thumb({ s, onOpen }: { s: Shot; onOpen: () => void }) {
  const key = s.name + ':' + s.at;
  const [src, setSrc] = useState(thumbs.get(key) || '');
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (src) return;
    const io = new IntersectionObserver((en) => {
      if (!en.some((x) => x.isIntersecting)) return;
      io.disconnect();
      desktopCall<string>('shots_thumb', { name: s.name }).then((u) => { thumbs.set(key, u); setSrc(u); }).catch(() => setSrc('x'));
    }, { rootMargin: '300px' });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, [key]);
  return (
    <button ref={ref} type="button" class="shot" onClick={onOpen} title={s.name}>
      <span class="shot-img">
        {src && src !== 'x' ? <img src={src} alt="" loading="lazy" /> : <Icon n={s.kind === 'video' ? 'play' : 'image'} size={22} />}
        {s.kind === 'video' && <span class="shot-badge"><Icon n="play" size={11} />Kayıt</span>}
      </span>
      <span class="shot-meta"><span>{hhmm(s.at)}</span><span>{kb(s.size)}</span></span>
    </button>
  );
}

function Viewer({ shots, index, onIndex, onClose, onChanged }: { shots: Shot[]; index: number; onIndex: (i: number) => void; onClose: () => void; onChanged: () => void }) {
  const s = shots[index];
  const [full, setFull] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [share, setShare] = useState(false);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    setFull(''); setConfirmDel(false);
    if (s.kind === 'image') desktopCall<string>('shots_read', { name: s.name }).then(setFull).catch(() => setFull(thumbs.get(s.name + ':' + s.at) || ''));
    else setFull(thumbs.get(s.name + ':' + s.at) || '');
  }, [s.name]);
  // hızlı basışlarda da doğru konum: güncel dizin ref'te
  const idx = useRef(index); idx.current = index;
  const shareRef = useRef(share); shareRef.current = share;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea,select')) return;
      if (shareRef.current) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowRight' && idx.current < shots.length - 1) { idx.current += 1; onIndex(idx.current); }
      if (e.key === 'ArrowLeft' && idx.current > 0) { idx.current -= 1; onIndex(idx.current); }
    };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [shots.length]);

  const run = async (label: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(label);
    try { await fn(); if (ok) snack(ok); } catch (e: any) { snack(String(e?.message || e)); } finally { setBusy(''); }
  };
  async function toAgenda() {
    await run('ajanda', async () => {
      const url = await desktopCall<string>('shots_read', { name: s.name });
      const d = new Date(s.at);
      const note = await api<{ id: string }>('POST', '/agenda/notes', { kind: 'work', title: 'Ekran görüntüsü · ' + d.getDate() + ' ' + LMON[d.getMonth()] + ' ' + hhmm(s.at), body: '' });
      const fd = new FormData(); fd.append('file', dataUrlToFile(url, s.name));
      const r = await fetch('/api/agenda/notes/' + note.id + '/files', { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!r.ok) { const j: any = await r.json().catch(() => ({})); throw new Error(j.error || 'Yüklenemedi'); }
      snack('Ajandam\'a not olarak eklendi'); onClose(); navigate('/ajanda?not=' + note.id);
    });
  }
  async function del() {
    if (!confirmDel) { setConfirmDel(true); return; }
    await run('sil', async () => {
      await desktopCall('shots_trash', { name: s.name });
      snack('Çöp kutusuna taşındı');
      if (shots.length <= 1) onClose(); else if (index >= shots.length - 1) onIndex(index - 1);
      onChanged();
    });
  }
  const img = s.kind === 'image';
  return (
    <div class="overlay shot-viewer" role="dialog" aria-label={'Ekran görüntüsü: ' + s.name}>
      <button type="button" class="scrim" aria-label="Kapat" onClick={onClose} />
      <div class="shot-panel">
        <div class="shot-top">
          <div style="min-width:0"><strong class="shot-name">{s.name}</strong><span class="sub">{dayLabel(s.at)} {hhmm(s.at)} · {kb(s.size)}</span></div>
          <span class="spacer" />
          <span class="sub">{index + 1} / {shots.length}</span>
          <button type="button" class="iconbtn" aria-label="Kapat" onClick={onClose}><Icon n="x" size={16} /></button>
        </div>
        <div class="shot-stage">
          <button type="button" class="shot-nav l" aria-label="Önceki" disabled={index === 0} onClick={() => onIndex(index - 1)}>‹</button>
          {full ? <img src={full} alt={s.name} /> : <span class="sub">{img ? 'Yükleniyor…' : 'Ekran kaydı — Aç ile QuickTime\'da oynat'}</span>}
          <button type="button" class="shot-nav r" aria-label="Sonraki" disabled={index >= shots.length - 1} onClick={() => onIndex(index + 1)}>›</button>
        </div>
        <div class="shot-actions">
          {img && <button type="button" class="btn primary sm" disabled={!!busy} onClick={() => run('kopya', () => desktopCall('shots_copy', { name: s.name }), 'Panoya kopyalandı — ⌘V ile yapıştır')}><Icon n="copy" size={14} />Kopyala</button>}
          <button type="button" class="btn sm" disabled={!!busy} onClick={() => run('kaydet', async () => { const ok = await desktopCall<boolean>('shots_save_as', { name: s.name }); if (ok) snack('Kaydedildi'); })}><Icon n="save" size={14} />Farklı kaydet</button>
          <button type="button" class="btn sm" disabled={!!busy} onClick={() => run('ac', () => desktopCall('shots_open', { name: s.name }))}><Icon n="ext" size={14} />{img ? "Önizleme'de aç" : 'Oynat'}</button>
          <button type="button" class="btn sm" disabled={!!busy} onClick={() => run('finder', () => desktopCall('shots_reveal', { name: s.name }))}><Icon n="folder" size={14} />Finder'da göster</button>
          {img && <button type="button" class="btn sm" disabled={!!busy} onClick={toAgenda}><Icon n="note" size={14} />{busy === 'ajanda' ? 'Ekleniyor…' : 'Ajandama ekle'}</button>}
          {img && <button type="button" class="btn sm" disabled={!!busy} onClick={() => setShare(true)}><Icon n="chat" size={14} />Sohbette paylaş</button>}
          <span class="spacer" />
          <button type="button" class={'btn danger sm' + (confirmDel ? ' confirm' : '')} disabled={!!busy} onClick={del}><Icon n="trash" size={14} />{confirmDel ? 'Emin misin? Çöpe taşı' : 'Sil'}</button>
        </div>
      </div>
      {share && <ShareModal shot={s} onClose={() => setShare(false)} />}
    </div>
  );
}

interface Ch { id: string; name: string; kind: 'general' | 'client' | 'dm'; dmWith?: string | null }
function ShareModal({ shot, onClose }: { shot: Shot; onClose: () => void }) {
  const s = useStore();
  const [chs, setChs] = useState<Ch[]>([]);
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState('');
  useEffect(() => { api<Ch[]>('GET', '/chat/channels').then(setChs).catch(() => {}); }, []);
  const me = store.get().me!;
  const people = s.team.filter((m) => m.id !== me.id && m.status === 'active');
  const opts = [
    ...chs.filter((c) => c.kind === 'general').map((c) => ({ v: 'ch:' + c.id, l: '# ' + c.name })),
    ...people.map((m) => ({ v: 'dm:' + m.id, l: '@ ' + m.name })),
    ...chs.filter((c) => c.kind === 'client').map((c) => ({ v: 'ch:' + c.id, l: '# ' + c.name })),
  ].filter((o) => !f || o.l.toLocaleLowerCase('tr').includes(f.toLocaleLowerCase('tr')));
  async function send() {
    if (!to) return;
    setBusy(true);
    try {
      let channelId = to.slice(3);
      if (to.startsWith('dm:')) channelId = (await api<{ id: string }>('POST', '/chat/dm', { userId: to.slice(3) })).id;
      const url = await desktopCall<string>('shots_read', { name: shot.name });
      const fd = new FormData(); fd.append('file', dataUrlToFile(url, shot.name)); if (text.trim()) fd.append('text', text.trim());
      const r = await fetch('/api/chat/channels/' + channelId + '/messages', { method: 'POST', body: fd, credentials: 'same-origin' });
      if (!r.ok) { const j: any = await r.json().catch(() => ({})); throw new Error(j.error || 'Gönderilemedi'); }
      snack('Sohbette paylaşıldı'); onClose();
    } catch (e: any) { snack(String(e?.message || e)); } finally { setBusy(false); }
  }
  return (
    <Modal title="Sohbette paylaş" onClose={onClose} width={460}>
      <input class="input" placeholder="Kanal ya da kişi ara…" value={f} onInput={(e) => setF((e.target as HTMLInputElement).value)} aria-label="Kanal ya da kişi ara" />
      <div class="shot-pick" role="listbox" aria-label="Nereye">
        {opts.map((o) => <button type="button" role="option" aria-selected={to === o.v} class={to === o.v ? 'on' : ''} onClick={() => setTo(o.v)}>{o.l}</button>)}
      </div>
      <label class="field">Mesaj (isteğe bağlı)<input class="input" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} /></label>
      <div class="row"><span class="spacer" /><button type="button" class="btn" onClick={onClose}>Vazgeç</button><button type="button" class="btn primary" disabled={!to || busy} onClick={send}>{busy ? 'Gönderiliyor…' : 'Gönder'}</button></div>
    </Modal>
  );
}
