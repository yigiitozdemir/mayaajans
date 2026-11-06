// Sol menüde "Geri bildirim" düğmesi → hata / istek / fikir yöneticiye (Yiğit) gider. "Gönderdiklerim" de burada.
import { useEffect, useRef, useState } from 'preact/hooks';
import { onLive, snack, ApiError } from '../api';
import { api } from '../api';
import { isDesktop } from '../desktop';
import { Icon, Modal, kutla } from '../ui';
import { since } from '../pages/Duyurular';
import '../styles/duyuru.css';

export interface GeriBildirim {
  id: string; userId: string; kind: 'hata' | 'istek' | 'fikir'; message: string; status: 'yeni' | 'inceleniyor' | 'yapildi' | 'olmayacak';
  page: string; device: string; hasImage: boolean; imageSize: number; reply: string; repliedAt: string | null; createdAt: string; updatedAt: string;
}
export const TURLER = [
  { id: 'hata', label: 'Hata', icon: 'uyari', ph: 'Ne oldu? Neye tıkladın, ne bekliyordun, ne gördün?' },
  { id: 'istek', label: 'İstek', icon: 'plus', ph: 'Programda neyin olmasını isterdin?' },
  { id: 'fikir', label: 'Fikir', icon: 'spark', ph: 'Aklına ne geldi? Kısaca anlat.' },
] as const;
export const DURUMLAR = [
  { id: 'yeni', label: 'Yeni' }, { id: 'inceleniyor', label: 'İnceleniyor' }, { id: 'yapildi', label: 'Yapıldı' }, { id: 'olmayacak', label: 'Olmayacak' },
] as const;
export const turAd = (k: string) => TURLER.find((t) => t.id === k)?.label || k;
export const durumAd = (k: string) => DURUMLAR.find((t) => t.id === k)?.label || k;
export const GORSEL_MAX = 8 * 1024 * 1024;
const OK_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** Bulunulan cihaz: ekran genişliği, Mac uygulaması mı, kabaca tarayıcı. */
export function cihazBilgisi(): string {
  const ua = navigator.userAgent;
  const where = isDesktop ? 'Mac uygulaması' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac tarayıcı' : /Windows/.test(ua) ? 'Windows tarayıcı' : 'Tarayıcı';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : /Firefox\//.test(ua) ? 'Firefox' : '';
  return `${innerWidth}×${innerHeight} px · ${where}${br && !isDesktop ? ' · ' + br : ''}`;
}

export const kb = (n: number) => (n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');

export function TurTag({ k }: { k: string }) {
  const t = TURLER.find((x) => x.id === k);
  return <span class={'gb-tur ' + k}><Icon n={t?.icon || 'note'} size={12} />{turAd(k)}</span>;
}
export function DurumTag({ k }: { k: string }) {
  return <span class={'gb-durum ' + k}>{durumAd(k)}</span>;
}

function Form({ onSent }: { onSent: () => void }) {
  const [kind, setKind] = useState<'hata' | 'istek' | 'fikir'>('hata');
  const [message, setMessage] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const pick = useRef<HTMLInputElement>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const page = location.pathname + location.search;
  const device = cihazBilgisi();

  useEffect(() => { ta.current?.focus(); }, []);
  useEffect(() => { if (!file) { setPreview(null); return; } const u = URL.createObjectURL(file); setPreview(u); return () => URL.revokeObjectURL(u); }, [file]);
  const take = (f: File | null | undefined) => {
    if (!f) return;
    if (!OK_TYPES.includes(f.type)) { setError('Yalnızca PNG, JPG ya da WEBP görsel eklenebilir'); return; }
    if (f.size > GORSEL_MAX) { setError('Görsel en fazla 8 MB olabilir'); return; }
    setError(''); setFile(f);
  };
  // Ctrl/⌘+V ile ekran görüntüsü yapıştır (pencere açıkken her yerden)
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      const it = Array.from(e.clipboardData?.items || []).find((x) => x.kind === 'file' && x.type.startsWith('image/'));
      if (!it) return;
      e.preventDefault();
      const f = it.getAsFile();
      if (f) take(new File([f], f.name || 'ekran-goruntusu.png', { type: f.type }));
    };
    window.addEventListener('paste', h);
    return () => window.removeEventListener('paste', h);
  }, []);

  const send = async (el: EventTarget | null) => {
    if (busy) return;
    if (!message.trim()) { setError('Ne olduğunu kısaca yaz'); ta.current?.focus(); return; }
    setBusy(true); setError('');
    const fd = new FormData();
    fd.set('kind', kind); fd.set('message', message); fd.set('page', page); fd.set('device', device);
    if (file) fd.set('file', file, file.name || 'gorsel');
    try {
      const r = await fetch('/api/geri-bildirim', { method: 'POST', body: fd, credentials: 'same-origin' });
      const data: any = await r.json().catch(() => null);
      if (!r.ok) throw new ApiError(r.status, data?.error || 'Gönderilemedi');
      kutla(el); setDone(true);
    } catch (e: any) { setError(e.message || 'Gönderilemedi'); } finally { setBusy(false); }
  };

  if (done) {
    return (
      <div class="gb-thanks" role="status">
        <span class="gb-thanks-ic"><Icon n="check" size={26} /></span>
        <b>Teşekkürler!</b>
        <span class="sub">Geri bildirimin Yiğit'e iletildi. Durumu “Gönderdiklerim”de görebilirsin; yanıt gelince bildirim alırsın.</span>
        <div class="row" style="justify-content:center">
          <button type="button" class="btn ghost" onClick={() => { setDone(false); setMessage(''); setFile(null); }}>Bir tane daha yaz</button>
          <button type="button" class="btn" onClick={onSent}>Gönderdiklerim</button>
        </div>
      </div>
    );
  }
  const t = TURLER.find((x) => x.id === kind)!;
  return (
    <>
      <div class="seg gb-seg" role="radiogroup" aria-label="Tür">
        {TURLER.map((x) => (
          <button type="button" role="radio" aria-checked={kind === x.id} class={kind === x.id ? 'on' : ''} onClick={() => setKind(x.id)}>
            <Icon n={x.icon} size={14} />{x.label}
          </button>
        ))}
      </div>
      <label class="field">Mesaj
        <textarea ref={ta} class="input gb-ta" rows={5} maxLength={4000} value={message} placeholder={t.ph}
          onInput={(e) => setMessage((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(e.currentTarget); } }} />
      </label>
      {preview ? (
        <div class="gb-preview">
          <img src={preview} alt="Eklenen görsel" />
          <div class="gb-preview-i">
            <span class="sub">{file?.name || 'Görsel'} · {kb(file?.size || 0)}</span>
            <button type="button" class="btn ghost sm" onClick={() => setFile(null)}><Icon n="x" size={13} />Kaldır</button>
          </div>
        </div>
      ) : (
        <button type="button" class={'gb-drop' + (drag ? ' drag' : '')} onClick={() => pick.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer?.files?.[0]); }}>
          <Icon n="image" size={18} />
          <span><b>Görsel ekle</b> <span class="sub">(isteğe bağlı) · seç, sürükle ya da {/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}+V ile yapıştır</span></span>
        </button>
      )}
      <input ref={pick} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Görsel seç"
        onChange={(e) => { const i = e.target as HTMLInputElement; take(i.files?.[0]); i.value = ''; }} />
      <div class="gb-auto" title="Otomatik eklenir">
        <Icon n="monitor" size={13} /><span>Otomatik eklenir: <b>{page}</b> · {device}</span>
      </div>
      {error && <div class="dy-error" role="alert">{error}</div>}
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn primary" disabled={busy} onClick={(e) => send(e.currentTarget)}>{busy ? 'Gönderiliyor…' : 'Gönder'}</button>
      </div>
    </>
  );
}

function Mine({ focus }: { focus: string | null }) {
  const [items, setItems] = useState<GeriBildirim[] | null>(null);
  const load = () => api<GeriBildirim[]>('GET', '/geri-bildirim/benim').then(setItems).catch((e) => { snack(e.message); setItems([]); });
  useEffect(() => { load(); return onLive(['geribildirim', '*'], load); }, []);
  useEffect(() => { if (focus && items) document.getElementById('gbm-' + focus)?.scrollIntoView({ block: 'nearest' }); }, [focus, items]);
  if (!items) return <div class="empty">Yükleniyor…</div>;
  if (!items.length) return <div class="empty" style="text-align:center">Henüz geri bildirim göndermedin.</div>;
  return (
    <div class="gb-mine">
      {items.map((g) => (
        <div id={'gbm-' + g.id} class={'gb-mine-i' + (focus === g.id ? ' flash' : '')}>
          <div class="row" style="gap:8px"><TurTag k={g.kind} /><DurumTag k={g.status} /><span class="spacer" /><span class="sub">{since(g.createdAt)}</span></div>
          <div class="gb-mine-m">{g.message}</div>
          {g.hasImage && <a class="gb-mine-img" href={`/api/geri-bildirim/${g.id}/gorsel`} target="_blank" rel="noopener"><img src={`/api/geri-bildirim/${g.id}/gorsel`} alt="Eklediğin görsel" loading="lazy" /></a>}
          {g.reply && <div class="gb-reply"><b>Yiğit'in yanıtı</b><span>{g.reply}</span></div>}
        </div>
      ))}
    </div>
  );
}

export function GeriBildirimDugmesi() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'yeni' | 'benim'>('yeni');
  const [focus, setFocus] = useState<string | null>(null);
  // bildirim bağlantısı: ?gb=<id> → "Gönderdiklerim" açılır
  useEffect(() => {
    const f = () => {
      const q = new URLSearchParams(location.search); const id = q.get('gb');
      if (!id) return;
      q.delete('gb'); history.replaceState({}, '', location.pathname + (q.toString() ? '?' + q : ''));
      setFocus(id); setTab('benim'); setOpen(true);
    };
    f();
    window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); };
  }, []);
  return (
    <>
      <button type="button" class="gbd" onClick={() => { setTab('yeni'); setFocus(null); setOpen(true); }} title="Hata mı gördün, bir isteğin mi var? Yiğit'e ilet">
        <span class="gbd-ic" aria-hidden="true"><Icon n="chat" size={14} /></span>
        <span class="gbd-l">Geri bildirim</span>
        <span class="gbd-h" aria-hidden="true">Hata · İstek · Fikir</span>
      </button>
      {open && (
        <Modal title="Geri bildirim" onClose={() => setOpen(false)} width={560}>
          <p class="gb-intro">Programda bir hata gördüysen ya da bir isteğin varsa yaz; doğrudan Yiğit'e gider.</p>
          <div class="seg gb-tabs" role="tablist" aria-label="Geri bildirim">
            <button type="button" role="tab" aria-selected={tab === 'yeni'} class={tab === 'yeni' ? 'on' : ''} onClick={() => setTab('yeni')}>Yeni</button>
            <button type="button" role="tab" aria-selected={tab === 'benim'} class={tab === 'benim' ? 'on' : ''} onClick={() => setTab('benim')}>Gönderdiklerim</button>
          </div>
          {tab === 'yeni' ? <Form onSent={() => setTab('benim')} /> : <Mine focus={focus} />}
        </Modal>
      )}
    </>
  );
}
