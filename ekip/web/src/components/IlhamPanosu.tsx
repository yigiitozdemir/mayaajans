// İlham panosu (moodboard): müşteri kartındaki "İlham" sekmesi ve Müşteriler sayfasındaki "Genel" pano.
// Görsel: dosya seç / sürükle-bırak / ⌘V yapıştır (birden çok, PNG-JPG-WEBP-GIF ≤ 8 MB) · Bağlantı: önizlemesiz kart.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, memberName, onLive, snack } from '../api';
import { Icon, Modal, Portal, useStore } from '../ui';
import '../styles/ilham.css';

export interface IlhamItem {
  id: string; client: string; kind: 'image' | 'link'; url: string; site: string; contentType: string | null; size: number;
  width: number | null; height: number | null; note: string; tags: string[]; createdBy: string | null; createdAt: string;
}

export const IMG_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
export const MAX_IMG = 8 * 1024 * 1024;
const SUGGEST = ['renk', 'tipografi', 'reels fikri', 'kompozisyon', 'fotoğraf', 'kampanya', 'story', 'ambalaj'];
const SITES: Record<string, { label: string; mark: string }> = {
  instagram: { label: 'Instagram', mark: 'IG' }, pinterest: { label: 'Pinterest', mark: 'P' },
  behance: { label: 'Behance', mark: 'Bē' }, web: { label: 'Web', mark: '↗' },
};
const lower = (s: string) => (s || '').toLocaleLowerCase('tr');
export const sqlTime = (s: string) => new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
export function fmtWhen(s: string) {
  const d = sqlTime(s); if (isNaN(d.getTime())) return '';
  const today = new Date(); const y = new Date(); y.setDate(today.getDate() - 1);
  const hm = d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return 'bugün ' + hm;
  if (d.toDateString() === y.toDateString()) return 'dün ' + hm;
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' }) + ' ' + hm;
}

/** Panodan / sürüklenenden görsel dosyaları */
export function imageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return [];
  const out: File[] = [];
  if (dt.files && dt.files.length) { for (const f of Array.from(dt.files)) if (f.type.startsWith('image/')) out.push(f); }
  else if (dt.items) for (const it of Array.from(dt.items)) { if (it.kind === 'file') { const f = it.getAsFile(); if (f && f.type.startsWith('image/')) out.push(f); } }
  return out;
}
/** Çok parçalı (dosya) gönderim; hata mesajı Türkçe */
export async function postForm<T = any>(path: string, fd: FormData): Promise<T> {
  let r: Response;
  try { r = await fetch('/api' + path, { method: 'POST', body: fd, credentials: 'same-origin' }); } catch { throw new Error('Bağlantı hatası'); }
  const j: any = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error || 'Yüklenemedi');
  return j as T;
}
function dims(f: File): Promise<{ w: number; h: number } | null> {
  return new Promise((res) => {
    const u = URL.createObjectURL(f); const i = new Image();
    i.onload = () => { res({ w: i.naturalWidth, h: i.naturalHeight }); URL.revokeObjectURL(u); };
    i.onerror = () => { res(null); URL.revokeObjectURL(u); };
    i.src = u;
  });
}
const hostOf = (u: string) => { try { const x = new URL(u); return (x.hostname.replace(/^www\./, '') + x.pathname.replace(/\/$/, '')).slice(0, 60); } catch { return u; } };

// ---------- büyük önizleme (ok tuşları, Escape) ----------
export interface LbItem { url: string; title?: string; sub?: string; tags?: string[] }
export function Lightbox({ items, index, onIndex, onClose }: { items: LbItem[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const cur = useRef(index); cur.current = index;
  const n = items.length;
  const go = (d: number) => onIndex((cur.current + d + n) % n);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); }
      else if (e.key === 'ArrowRight' && n > 1) { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft' && n > 1) { e.preventDefault(); go(-1); }
    };
    window.addEventListener('keydown', k, true); // önce bu: arkadaki çekmece/pencere kapanmasın
    return () => window.removeEventListener('keydown', k, true);
  }, [n, onClose]);
  const it = items[index];
  if (!it) return null;
  return (
    <Portal>
      <div class="il-lb" role="dialog" aria-modal="true" aria-label="Büyük önizleme">
        <button type="button" class="il-lb-scrim" aria-label="Kapat" onClick={onClose} />
        <figure class="il-lb-fig">
          <img src={it.url} alt={it.title || 'Görsel'} />
          {(it.title || it.sub || it.tags?.length) && (
            <figcaption>
              {it.title && <span class="il-lb-t">{it.title}</span>}
              {!!it.tags?.length && <span class="il-lb-tags">{it.tags.map((t) => <span class="il-tag">#{t}</span>)}</span>}
              {it.sub && <span class="il-lb-s">{it.sub}</span>}
            </figcaption>
          )}
        </figure>
        <div class="il-lb-top">
          <span class="il-lb-n">{index + 1} / {n}</span>
          <a class="il-lb-btn" href={it.url} target="_blank" rel="noopener noreferrer" aria-label="Yeni sekmede aç"><Icon n="ext" size={16} /></a>
          <button type="button" class="il-lb-btn" aria-label="Kapat" onClick={onClose}><Icon n="x" size={18} /></button>
        </div>
        {n > 1 && <button type="button" class="il-lb-nav l" aria-label="Önceki" onClick={() => go(-1)}>‹</button>}
        {n > 1 && <button type="button" class="il-lb-nav r" aria-label="Sonraki" onClick={() => go(1)}>›</button>}
      </div>
    </Portal>
  );
}

// ---------- etiket girişi ----------
function TagInput({ value, onChange, known }: { value: string[]; onChange: (v: string[]) => void; known: string[] }) {
  const [draft, setDraft] = useState('');
  const add = (t: string) => {
    const x = lower(t.trim().replace(/^#/, '')).slice(0, 24);
    if (!x || value.includes(x)) { setDraft(''); return; }
    if (value.length >= 8) { snack('En fazla 8 etiket'); return; }
    onChange([...value, x]); setDraft('');
  };
  const sugg = [...new Set([...known, ...SUGGEST])].filter((t) => !value.includes(t)).slice(0, 10);
  return (
    <div class="il-tagin">
      <div class="il-tagbox">
        {value.map((t) => <span class="il-tag on">#{t}<button type="button" aria-label={t + ' etiketini kaldır'} onClick={() => onChange(value.filter((x) => x !== t))}><Icon n="x" size={10} w={2.6} /></button></span>)}
        <input value={draft} maxLength={24} placeholder={value.length ? 'Etiket ekle…' : 'Etiket yaz, Enter'} aria-label="Etiket"
          onInput={(e) => { const v = (e.target as HTMLInputElement).value; if (v.includes(',')) { v.split(',').forEach(add); } else setDraft(v); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && draft.trim()) { e.preventDefault(); add(draft); }
            else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft.trim() && add(draft)} />
      </div>
      {sugg.length > 0 && <div class="il-sugg">{sugg.map((t) => <button type="button" class="il-tag" onClick={() => add(t)}>+ {t}</button>)}</div>}
    </div>
  );
}

// ---------- pano ----------
interface Pending { file: File; url: string }

export function IlhamPanosu({ client }: { client: string }) {
  const s = useStore();
  const me = s.me!;
  const [items, setItems] = useState<IlhamItem[] | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [pNote, setPNote] = useState('');
  const [pTags, setPTags] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [edit, setEdit] = useState<IlhamItem | null>(null);
  const [del, setDel] = useState<IlhamItem | null>(null);
  const [lb, setLb] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const cRef = useRef(client); cRef.current = client;

  async function load() {
    try { const r = await api<{ client: string; items: IlhamItem[] }>('GET', '/ilham?client=' + encodeURIComponent(client)); if (cRef.current === client) setItems(r.items); }
    catch (e: any) { snack(e.message); setItems([]); }
  }
  useEffect(() => { setItems(null); setTag(null); load(); }, [client]);
  useEffect(() => onLive(['ilham', '*'], (m) => { if (m.type === '*' || (m.client ?? '') === cRef.current) load(); }), [client]);

  function queue(list: File[]) {
    const ok: Pending[] = []; const bad: string[] = [];
    for (const f of list) {
      if (!IMG_TYPES.includes(f.type)) bad.push((f.name || 'Dosya') + ': yalnızca PNG, JPG, WEBP, GIF');
      else if (f.size > MAX_IMG) bad.push((f.name || 'Görsel') + ': 8 MB’tan büyük');
      else ok.push({ file: f, url: URL.createObjectURL(f) });
    }
    if (bad.length) snack(bad[0] + (bad.length > 1 ? ' (+' + (bad.length - 1) + ')' : ''));
    if (ok.length) { setPending((p) => { if (!p.length) { setPNote(''); setPTags(tag ? [tag] : []); } return [...p, ...ok].slice(0, 30); }); }
  }
  function clearPending() { pending.forEach((p) => URL.revokeObjectURL(p.url)); setPending([]); }

  // ⌘/Ctrl + V: panodaki görseller
  useEffect(() => {
    const f = (e: ClipboardEvent) => {
      if (edit || linkOpen || del) return;
      const files = imageFiles(e.clipboardData);
      if (!files.length) return;
      e.preventDefault(); queue(files);
    };
    document.addEventListener('paste', f);
    return () => document.removeEventListener('paste', f);
  }, [edit, linkOpen, del, tag]);

  async function uploadAll() {
    if (busy || !pending.length) return;
    const list = pending; let okN = 0; const errs: string[] = [];
    for (let i = 0; i < list.length; i++) {
      setBusy(`${i + 1} / ${list.length}`);
      const p = list[i];
      const fd = new FormData();
      fd.append('file', p.file, p.file.name || 'gorsel'); fd.append('client', client); fd.append('note', pNote.trim()); fd.append('tags', pTags.join(','));
      const d = await dims(p.file); if (d) { fd.append('width', String(d.w)); fd.append('height', String(d.h)); }
      try { await postForm('/ilham/files', fd); okN++; } catch (e: any) { errs.push(e.message); }
    }
    setBusy(null); clearPending(); await load();
    snack(errs.length ? (okN ? okN + ' görsel eklendi · ' : '') + errs[0] : okN + ' görsel panoya eklendi');
  }

  const all = items || [];
  const tags = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of all) for (const t of x.tags) m.set(t, (m.get(t) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'tr'));
  }, [items]);
  const shown = tag ? all.filter((x) => x.tags.includes(tag)) : all;
  const images = shown.filter((x) => x.kind === 'image');
  const mine = (x: IlhamItem) => me.role === 'admin' || x.createdBy === me.id;
  const known = tags.map(([t]) => t);

  return (
    <section class={'il' + (over ? ' over' : '')} aria-label={client ? client + ' ilham panosu' : 'Genel ilham panosu'}
      onDragOver={(e) => { if (e.dataTransfer?.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); queue(imageFiles(e.dataTransfer)); }}>
      <div class="il-bar">
        <div class="il-filter" role="group" aria-label="Etikete göre süz">
          <button type="button" class={'il-tag' + (!tag ? ' on' : '')} aria-pressed={!tag} onClick={() => setTag(null)}>Tümü <b>{all.length}</b></button>
          {tags.map(([t, n]) => <button type="button" class={'il-tag' + (tag === t ? ' on' : '')} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>#{t} <b>{n}</b></button>)}
        </div>
        <span class="spacer" />
        <button type="button" class="btn sm" onClick={() => setLinkOpen(true)}><Icon n="link" size={14} />Bağlantı ekle</button>
        <button type="button" class="btn primary sm" onClick={() => fileRef.current?.click()}><Icon n="plus" size={14} w={2.4} />Görsel ekle</button>
        <input ref={fileRef} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif" class="sr" aria-label="Görsel seç" tabIndex={-1}
          onChange={(e) => { const t = e.target as HTMLInputElement; queue(Array.from(t.files || [])); t.value = ''; }} />
      </div>

      {items === null && <span class="sub">Yükleniyor…</span>}
      {items && all.length === 0 && (
        <button type="button" class="il-empty" onClick={() => fileRef.current?.click()}>
          <span class="il-empty-ic" aria-hidden="true"><Icon n="image" size={26} w={1.6} /></span>
          <b>{client ? client + ' için ilk ilhamı ekle' : 'Ajansın ilk ilhamını ekle'}</b>
          <span>Beğendiğin görselleri buraya <strong>sürükle</strong>, <strong>⌘V</strong> ile yapıştır ya da tıklayıp seç. Instagram, Pinterest, Behance bağlantıları da eklenebilir.</span>
        </button>
      )}
      {items && all.length > 0 && (
        <>
          <div class="il-grid">
            {shown.map((x) => {
              const meta = memberName(s.team, x.createdBy) + ' · ' + fmtWhen(x.createdAt);
              return (
                <article class={'il-it ' + x.kind} key={x.id}>
                  {x.kind === 'image' ? (
                    <button type="button" class="il-img" style={x.width && x.height ? { aspectRatio: x.width + ' / ' + x.height } : undefined}
                      aria-label={'Büyüt' + (x.note ? ': ' + x.note : '')} onClick={() => setLb(images.indexOf(x))}>
                      <img src={x.url} alt={x.note || 'İlham görseli'} loading="lazy" />
                    </button>
                  ) : (
                    <a class={'il-link s-' + x.site} href={x.url} target="_blank" rel="noopener noreferrer">
                      <span class="il-mark" aria-hidden="true">{(SITES[x.site] || SITES.web).mark}</span>
                      <span class="il-lt"><b>{(SITES[x.site] || SITES.web).label}</b><span>{hostOf(x.url)}</span></span>
                      <Icon n="ext" size={14} />
                    </a>
                  )}
                  {(x.note || x.tags.length > 0) && (
                    <div class="il-body">
                      {x.note && <p class="il-note">{x.note}</p>}
                      {x.tags.length > 0 && <div class="il-tags">{x.tags.map((t) => <button type="button" class={'il-tag sm' + (tag === t ? ' on' : '')} onClick={() => setTag(t)}>#{t}</button>)}</div>}
                    </div>
                  )}
                  <div class="il-foot"><span title={meta}>{meta}</span></div>
                  {mine(x) && (
                    <div class="il-acts">
                      <button type="button" aria-label="Not ve etiketi düzenle" title="Düzenle" onClick={() => setEdit(x)}><Icon n="note" size={14} /></button>
                      <button type="button" aria-label="Sil" title="Sil" onClick={() => setDel(x)}><Icon n="trash" size={14} /></button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          {shown.length === 0 && <p class="empty">#{tag} etiketli öğe yok.</p>}
          <p class="il-hint">Görselleri panoya <b>sürükleyip bırakabilir</b> ya da <b>⌘/Ctrl + V</b> ile yapıştırabilirsin · PNG, JPG, WEBP, GIF · en fazla 8 MB</p>
        </>
      )}
      {over && <div class="il-over" aria-hidden="true"><span><Icon n="image" size={22} />Bırak, panoya eklensin</span></div>}

      {pending.length > 0 && (
        <Modal title={pending.length + ' görsel ekleniyor'} onClose={() => { if (!busy) clearPending(); }} width={560}>
          <form class="il-form" onSubmit={(e) => { e.preventDefault(); uploadAll(); }}>
            <div class="il-pend">
              {pending.map((p, i) => (
                <span class="il-pthumb"><img src={p.url} alt="" />
                  {!busy && <button type="button" aria-label="Çıkar" onClick={() => { URL.revokeObjectURL(p.url); setPending(pending.filter((_, j) => j !== i)); }}><Icon n="x" size={11} w={2.6} /></button>}
                </span>
              ))}
              <button type="button" class="il-padd" aria-label="Daha fazla görsel ekle" onClick={() => fileRef.current?.click()} disabled={!!busy}><Icon n="plus" size={18} /></button>
            </div>
            <label class="field">Kısa not <span class="sub" style="font-weight:500">(hepsine)</span>
              <input class="input" value={pNote} maxLength={280} placeholder="Örn. Bu ışık ve renk geçişi çok iyi" autoFocus onInput={(e) => setPNote((e.target as HTMLInputElement).value)} />
            </label>
            <div class="field">Etiketler<TagInput value={pTags} onChange={setPTags} known={known} /></div>
            <div class="row" style="justify-content:flex-end">
              <button type="button" class="btn" disabled={!!busy} onClick={clearPending}>Vazgeç</button>
              <button type="submit" class="btn primary" disabled={!!busy}>{busy ? 'Yükleniyor ' + busy : 'Panoya ekle'}</button>
            </div>
          </form>
        </Modal>
      )}

      {linkOpen && <LinkForm client={client} known={known} initialTags={tag ? [tag] : []} onClose={() => setLinkOpen(false)} onDone={() => { setLinkOpen(false); load(); }} />}
      {edit && <EditForm item={edit} known={known} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
      {del && (
        <Modal title="Panodan sil" onClose={() => setDel(null)} width={420}>
          <p style="margin:0;color:var(--mute);line-height:1.5">{del.kind === 'image' ? 'Bu görsel' : 'Bu bağlantı'} panodan kalıcı olarak silinsin mi?</p>
          <form class="row" style="justify-content:flex-end" onSubmit={async (e) => {
            e.preventDefault();
            try { await api('DELETE', '/ilham/' + del.id); setDel(null); snack('Silindi'); load(); } catch (er: any) { snack(er.message); }
          }}>
            <button type="button" class="btn" onClick={() => setDel(null)}>Vazgeç</button>
            <button type="submit" class="btn danger confirm" autoFocus>Sil</button>
          </form>
        </Modal>
      )}
      {lb !== null && images[lb] && (
        <Lightbox index={lb} onIndex={setLb} onClose={() => setLb(null)}
          items={images.map((x) => ({ url: x.url, title: x.note, tags: x.tags, sub: memberName(s.team, x.createdBy) + ' · ' + fmtWhen(x.createdAt) }))} />
      )}
    </section>
  );
}

function LinkForm({ client, known, initialTags, onClose, onDone }: { client: string; known: string[]; initialTags: string[]; onClose: () => void; onDone: () => void }) {
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<string[]>(initialTags);
  const [e, setE] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!url.trim()) { setE('Bağlantıyı yapıştır'); return; }
    setBusy(true);
    try { await api('POST', '/ilham/links', { client, url: url.trim(), note: note.trim(), tags }); snack('Bağlantı panoya eklendi'); onDone(); }
    catch (er: any) { setE(er.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Bağlantı ekle" onClose={onClose} width={520}>
      <form class="il-form" onSubmit={(ev) => { ev.preventDefault(); save(); }}>
        <label class="field">Bağlantı
          <input class={'input' + (e ? ' err' : '')} value={url} inputMode="url" maxLength={800} placeholder="instagram.com/p/… · pinterest.com/pin/… · behance.net/…" autoFocus
            onInput={(ev) => { setUrl((ev.target as HTMLInputElement).value); setE(''); }} />
        </label>
        {e && <span class="errtext" role="alert">{e}</span>}
        <label class="field">Kısa not
          <input class="input" value={note} maxLength={280} placeholder="Neyini beğendik?" onInput={(ev) => setNote((ev.target as HTMLInputElement).value)} />
        </label>
        <div class="field">Etiketler<TagInput value={tags} onChange={setTags} known={known} /></div>
        <div class="row" style="justify-content:flex-end">
          <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
          <button type="submit" class="btn primary" disabled={busy}>Ekle</button>
        </div>
      </form>
    </Modal>
  );
}

function EditForm({ item, known, onClose, onDone }: { item: IlhamItem; known: string[]; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState(item.note);
  const [tags, setTags] = useState<string[]>(item.tags);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try { await api('PATCH', '/ilham/' + item.id, { note: note.trim(), tags }); snack('Kaydedildi'); onDone(); }
    catch (er: any) { snack(er.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Not ve etiketler" onClose={onClose} width={520}>
      <form class="il-form" onSubmit={(ev) => { ev.preventDefault(); save(); }}>
        {item.kind === 'image' && <img class="il-editprev" src={item.url} alt="" />}
        <label class="field">Kısa not
          <input class="input" value={note} maxLength={280} autoFocus onInput={(ev) => setNote((ev.target as HTMLInputElement).value)} />
        </label>
        <div class="field">Etiketler<TagInput value={tags} onChange={setTags} known={known} /></div>
        <div class="row" style="justify-content:flex-end">
          <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
          <button type="submit" class="btn primary" disabled={busy}>Kaydet</button>
        </div>
      </form>
    </Modal>
  );
}
