// Kriz kayıtları: olumsuz yorum, şikâyet, yanlış paylaşım… hızlı kayıt, ekibe haber, çözüm takibi.
// Açık krizler üstte (öncelik, sonra yaş), "kaç saattir açık" sayacı; çözülenler en altta kapalı bölümde.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { api, memberName, onLive, snack, type Member } from '../api';
import { Avatar, Icon, Modal, Portal, Sayi, kutla, navigate, useStore } from '../ui';
import { Bell } from '../components/Notify';
import { ClientMark, findClient } from '../components/ClientMark';
import { IMG_TYPES, Lightbox, fmtWhen, imageFiles, postForm, sqlTime } from '../components/IlhamPanosu';
import '../styles/kriz.css';

// ---------- sabitler ----------
export const PRI: Record<string, { label: string; emoji: string; rank: number }> = {
  acil: { label: 'Acil', emoji: '🚨', rank: 4 }, yuksek: { label: 'Yüksek', emoji: '🔴', rank: 3 },
  orta: { label: 'Orta', emoji: '🟠', rank: 2 }, dusuk: { label: 'Düşük', emoji: '🟢', rank: 1 },
};
const PRI_ORDER = ['dusuk', 'orta', 'yuksek', 'acil'];
export const SRC: [string, string][] = [
  ['instagram', 'Instagram yorumu'], ['google', 'Google yorumu'], ['dm', 'DM / mesaj'], ['telefon', 'Telefon / e-posta'], ['paylasim', 'Yanlış paylaşım'], ['diger', 'Diğer'],
];
const SRC_L = Object.fromEntries(SRC);
const STA: [string, string][] = [['acik', 'Açık'], ['mudahale', 'Müdahale ediliyor'], ['cozuldu', 'Çözüldü']];
const STA_L = Object.fromEntries(STA);
const MAX_SHOT = 8 * 1024 * 1024;
const SHOT_TYPES = IMG_TYPES.filter((t) => t !== 'image/gif');

export interface KFile { id: string; name: string; contentType: string; size: number; createdBy: string | null; createdAt: string; url: string }
export interface KEvent { id: string; userId: string | null; kind: string; text: string; createdAt: string }
export interface Kriz {
  id: string; client: string; title: string; source: string; link: string; description: string; priority: string; status: string;
  ownerId: string | null; resolution: string; createdBy: string; createdAt: string; updatedAt: string; resolvedAt: string | null; resolvedBy: string | null;
  files: KFile[]; events?: KEvent[];
}
export type OpenMap = Record<string, { count: number; priority: string }>;

// ---------- yardımcılar ----------
function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
/** "45 dk" · "3 sa 12 dk" · "2 gün 5 sa" */
export function dur(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'az önce';
  if (m < 60) return m + ' dk';
  const h = Math.floor(m / 60);
  if (h < 24) return h + ' sa' + (m % 60 ? ' ' + (m % 60) + ' dk' : '');
  const d = Math.floor(h / 24);
  return d + ' gün' + (h % 24 ? ' ' + (h % 24) + ' sa' : '');
}
/** "3 sa 12 dk’dır açık" · "Az önce açıldı" */
function openFor(ms: number, bold = false) {
  if (ms < 60_000) return 'Az önce açıldı';
  return <span>{bold ? <b>{dur(ms)}</b> : dur(ms)}’dır açık</span>;
}
const sortOpen = (a: Kriz, b: Kriz) => PRI[b.priority].rank - PRI[a.priority].rank || (a.createdAt < b.createdAt ? -1 : 1);
const sortDone = (a: Kriz, b: Kriz) => ((a.resolvedAt || '') < (b.resolvedAt || '') ? 1 : -1);
const activeTeam = (team: Member[]) => team.filter((m) => m.status === 'active');

export function PriPill({ p }: { p: string }) {
  const x = PRI[p] || PRI.orta;
  return <span class={'kr-pri p-' + p}><span aria-hidden="true">{x.emoji}</span>{x.label}</span>;
}
function StaPill({ s }: { s: string }) { return <span class={'kr-sta s-' + s}>{STA_L[s] || s}</span>; }

/** Müşteri adının yanındaki küçük uyarı rozeti (açık kriz sayısı) */
export function KrizRozet({ info, onClick }: { info?: { count: number; priority: string } | null; onClick?: () => void }) {
  if (!info || !info.count) return null;
  const label = info.count + ' açık kriz · en yüksek: ' + (PRI[info.priority]?.label || '');
  const inner = <><Icon n="uyari" size={12} w={2.4} />{info.count}</>;
  return onClick
    ? <button type="button" class={'kr-rozet p-' + info.priority} title={label} aria-label={label} onClick={onClick}>{inner}</button>
    : <span class={'kr-rozet p-' + info.priority} title={label} aria-label={label} role="img">{inner}</span>;
}

// ---------- kart ----------
function KrizCard({ k, now, onOpen, showClient = true }: { k: Kriz; now: number; onOpen: (id: string) => void; showClient?: boolean }) {
  const s = useStore();
  const owner = s.team.find((m) => m.id === k.ownerId);
  const done = k.status === 'cozuldu';
  return (
    <button type="button" class={'kr-card p-' + k.priority + (done ? ' done' : '')} onClick={() => onOpen(k.id)} aria-label={(done ? 'Çözüldü: ' : PRI[k.priority].label + ' kriz: ') + k.client + ' — ' + k.title}>
      <span class="kr-card-top">
        <PriPill p={k.priority} />
        <StaPill s={k.status} />
        <span class="spacer" />
        {done
          ? <span class="kr-age done"><Icon n="check" size={13} w={2.6} />{dur(sqlTime(k.resolvedAt || k.updatedAt).getTime() - sqlTime(k.createdAt).getTime())} sürdü</span>
          : <span class="kr-age" title={'Açıldı: ' + fmtWhen(k.createdAt)}><span class="kr-pulse" aria-hidden="true" />{openFor(now - sqlTime(k.createdAt).getTime())}</span>}
      </span>
      <span class="kr-title">{k.title}</span>
      <span class="kr-meta">
        {showClient && <span class="kr-client"><ClientMark name={k.client} size={18} />{k.client}</span>}
        <span class="kr-src">{SRC_L[k.source]}</span>
        {k.files.length > 0 && <span class="kr-src"><Icon n="image" size={12} />{k.files.length}</span>}
        <span class="spacer" />
        {owner ? <span class="kr-owner"><Avatar m={owner} size={20} />{owner.firstName}</span> : <span class="kr-owner none">Sorumlu yok</span>}
      </span>
      {done && k.resolution && <span class="kr-res"><b>Çözüm:</b> {k.resolution}</span>}
    </button>
  );
}

// ---------- ekran görüntüsü ekleme alanı ----------
function ShotDrop({ onFiles, busy, compact }: { onFiles: (f: File[]) => void; busy?: string | null; compact?: boolean }) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div class={'kr-drop' + (over ? ' on' : '') + (compact ? ' sm' : '')} role="button" tabIndex={0} aria-label="Ekran görüntüsü ekle"
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ref.current?.click(); } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(imageFiles(e.dataTransfer)); }}>
      <Icon n="camera" size={16} />
      {busy ? <b>Yükleniyor… {busy}</b> : over ? <b>Bırak, eklensin</b> : <span>Ekran görüntüsünü <b>yapıştır</b> (⌘V), <b>sürükle</b> ya da tıklayıp seç · PNG, JPG, WEBP · en fazla 8 MB</span>}
      <input ref={ref} type="file" multiple accept="image/png,image/jpeg,image/webp" class="sr" tabIndex={-1} aria-label="Ekran görüntüsü seç"
        onClick={(e) => e.stopPropagation()} onChange={(e) => { const t = e.target as HTMLInputElement; onFiles(Array.from(t.files || [])); t.value = ''; }} />
    </div>
  );
}
function checkShots(list: File[]): File[] {
  const ok: File[] = []; const bad: string[] = [];
  for (const f of list) {
    if (!SHOT_TYPES.includes(f.type)) bad.push((f.name || 'Dosya') + ': yalnızca PNG, JPG, WEBP');
    else if (f.size > MAX_SHOT) bad.push((f.name || 'Görsel') + ': 8 MB’tan büyük');
    else ok.push(f);
  }
  if (bad.length) snack(bad[0] + (bad.length > 1 ? ' (+' + (bad.length - 1) + ')' : ''));
  return ok;
}
async function uploadShots(id: string, files: File[], setBusy?: (s: string | null) => void) {
  let okN = 0; const errs: string[] = [];
  for (let i = 0; i < files.length; i++) {
    setBusy?.(`${i + 1}/${files.length}`);
    const fd = new FormData(); fd.append('file', files[i], files[i].name || 'ekran.png');
    try { await postForm('/krizler/' + id + '/files', fd); okN++; } catch (e: any) { errs.push(e.message); }
  }
  setBusy?.(null);
  if (errs.length) snack((okN ? okN + ' görsel eklendi · ' : '') + errs[0]);
  return okN;
}

// ---------- yeni kayıt / düzenleme ----------
export function KrizForm({ client, edit, onClose, onSaved }: { client?: string; edit?: Kriz; onClose: () => void; onSaved: (k: Kriz) => void }) {
  const s = useStore();
  const me = s.me!;
  const clients = s.clients;
  const team = activeTeam(s.team);
  const ownerOf = (name: string) => ((findClient(clients, name) as any)?.owner as string | null) || '';
  const [f, setF] = useState(() => edit
    ? { client: edit.client, title: edit.title, source: edit.source, link: edit.link, description: edit.description, priority: edit.priority, ownerId: edit.ownerId || '' }
    : { client: client || '', title: '', source: 'instagram', link: '', description: '', priority: 'orta', ownerId: (client && ownerOf(client)) || me.id });
  const [shots, setShots] = useState<{ file: File; url: string }[]>([]);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setErrs({}); };
  const addShots = (list: File[]) => { const ok = checkShots(list); if (ok.length) setShots((x) => [...x, ...ok.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, 12)); };
  useEffect(() => () => shots.forEach((x) => URL.revokeObjectURL(x.url)), []);
  useEffect(() => {
    if (edit) return;
    const h = (e: ClipboardEvent) => { const fs = imageFiles(e.clipboardData); if (fs.length) { e.preventDefault(); addShots(fs); } };
    document.addEventListener('paste', h); return () => document.removeEventListener('paste', h);
  }, []);

  async function save() {
    const e: Record<string, string> = {};
    if (!f.client) e.client = 'Müşteri seç';
    if (!f.title.trim()) e.title = 'Kısa bir başlık yaz';
    const l = f.link.trim();
    if (l && !/^(https?:\/\/)?[^\s/]+\.[^\s]+$/i.test(l)) e.link = 'Geçerli bir bağlantı yaz (http/https)';
    if (Object.keys(e).length) { setErrs(e); return; }
    setBusy(true);
    try {
      const body = { client: f.client, title: f.title.trim(), source: f.source, link: l, description: f.description.trim(), priority: f.priority, ownerId: f.ownerId || null };
      let k: Kriz;
      if (edit) k = await api<Kriz>('PATCH', '/krizler/' + edit.id, body);
      else {
        k = await api<Kriz>('POST', '/krizler', body);
        if (shots.length) { await uploadShots(k.id, shots.map((x) => x.file)); k = await api<Kriz>('GET', '/krizler/' + k.id); }
      }
      snack(edit ? 'Kayıt güncellendi' : (f.priority === 'acil' || f.priority === 'yuksek') ? 'Kriz kaydı açıldı · bütün ekibe haber verildi' : 'Kriz kaydı açıldı · sorumluya ve yöneticiye haber verildi');
      onSaved(k);
    } catch (er: any) { setErrs({ form: er.message }); } finally { setBusy(false); }
  }
  const loud = f.priority === 'acil' || f.priority === 'yuksek';
  return (
    <Modal title={edit ? 'Kaydı düzenle' : 'Kriz kaydı aç'} onClose={onClose} width={620}>
      <form class="kr-form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div class="kr-2">
          <label class="field">Müşteri
            <select class={'input' + (errs.client ? ' err' : '')} value={f.client} autoFocus={!client && !edit} onChange={(e) => {
              const v = (e.target as HTMLSelectElement).value; set({ client: v, ...(!edit && ownerOf(v) ? { ownerId: ownerOf(v) } : {}) });
            }}>
              <option value="">Müşteri seç…</option>
              {clients.map((c) => <option value={c.name}>{c.name}</option>)}
              {edit && !clients.some((c) => c.name === edit.client) && <option value={edit.client}>{edit.client}</option>}
            </select>
            {errs.client && <span class="errtext" role="alert">{errs.client}</span>}
          </label>
          <label class="field">Sorumlu
            <select class="input" value={f.ownerId} onChange={(e) => set({ ownerId: (e.target as HTMLSelectElement).value })}>
              <option value="">Seçilmedi</option>
              {team.map((m) => <option value={m.id}>{m.id === me.id ? m.name + ' (sen)' : m.name}</option>)}
            </select>
          </label>
        </div>
        <label class="field">Kısa başlık
          <input class={'input' + (errs.title ? ' err' : '')} value={f.title} maxLength={140} autoFocus={!!client || !!edit} placeholder="Örn. Google'da 1 yıldızlı yorum: randevu iptali"
            onInput={(e) => set({ title: (e.target as HTMLInputElement).value })} />
          {errs.title && <span class="errtext" role="alert">{errs.title}</span>}
        </label>
        <div class="field"><span>Öncelik</span>
          <div class="kr-prisel" role="radiogroup" aria-label="Öncelik">
            {PRI_ORDER.map((p) => (
              <button type="button" role="radio" aria-checked={f.priority === p} class={'p-' + p + (f.priority === p ? ' on' : '')} onClick={() => set({ priority: p })}>
                <span aria-hidden="true">{PRI[p].emoji}</span>{PRI[p].label}
              </button>
            ))}
          </div>
        </div>
        <div class="field"><span>Kaynak</span>
          <div class="kr-chips" role="radiogroup" aria-label="Kaynak">
            {SRC.map(([k, l]) => <button type="button" role="radio" aria-checked={f.source === k} class={'kr-chip' + (f.source === k ? ' on' : '')} onClick={() => set({ source: k })}>{l}</button>)}
          </div>
        </div>
        <label class="field">Bağlantı <span class="sub" style="font-weight:500">(isteğe bağlı)</span>
          <input class={'input' + (errs.link ? ' err' : '')} value={f.link} inputMode="url" maxLength={800} placeholder="https://… yorumun ya da paylaşımın adresi" onInput={(e) => set({ link: (e.target as HTMLInputElement).value })} />
          {errs.link && <span class="errtext" role="alert">{errs.link}</span>}
        </label>
        <label class="field">Açıklama
          <textarea class="input" rows={3} maxLength={4000} value={f.description} placeholder="Ne oldu? Müşteri ne diyor, ne zaman fark ettik?" onInput={(e) => set({ description: (e.target as HTMLTextAreaElement).value })} />
        </label>
        {!edit && (
          <div class="field"><span>Ekran görüntüsü <span class="sub" style="font-weight:500">(isteğe bağlı)</span></span>
            {shots.length > 0 && (
              <div class="kr-thumbs">
                {shots.map((x, i) => <span class="kr-thumb"><img src={x.url} alt="" /><button type="button" class="kr-thumb-x" aria-label="Çıkar" onClick={() => { URL.revokeObjectURL(x.url); setShots(shots.filter((_, j) => j !== i)); }}><Icon n="x" size={11} w={2.6} /></button></span>)}
              </div>
            )}
            <ShotDrop onFiles={addShots} compact={shots.length > 0} />
          </div>
        )}
        {errs.form && <span class="errtext" role="alert">{errs.form}</span>}
        <div class="row kr-formfoot">
          {!edit && <span class={'kr-who' + (loud ? ' loud' : '')}><Icon n="bell" size={14} />{loud ? 'Bütün ekibe bildirim gider' : 'Sorumluya ve yöneticiye bildirim gider'}</span>}
          <span class="spacer" />
          <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
          <button type="submit" class={'btn primary' + (f.priority === 'acil' ? ' kr-urgent' : '')} disabled={busy}>{busy ? 'Kaydediliyor…' : edit ? 'Kaydet' : 'Kaydı aç'}</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- detay çekmecesi ----------
function evText(e: KEvent): { t: string; body: string; st?: string } {
  switch (e.kind) {
    case 'created': return { t: 'kaydı açtı', body: '' };
    case 'status': { const [st, ...rest] = e.text.split('\n'); return { t: st === 'cozuldu' ? 'çözüldü olarak işaretledi' : st === 'mudahale' ? 'müdahaleye başladı' : 'yeniden açtı', body: rest.join('\n'), st }; }
    case 'note': return { t: 'not ekledi', body: e.text };
    case 'priority': return { t: 'önceliği ' + e.text + ' yaptı', body: '' };
    case 'owner': return { t: e.text ? 'sorumluyu ' + e.text + ' yaptı' : 'sorumluyu kaldırdı', body: '' };
    case 'edit': return { t: 'güncelledi: ' + e.text, body: '' };
    case 'file': return { t: 'ekran görüntüsü ekledi', body: '' };
    default: return { t: e.kind, body: e.text };
  }
}

export function KrizDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const s = useStore();
  const me = s.me!;
  const now = useNow();
  const [k, setK] = useState<Kriz | null>(null);
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState('');
  const [resolving, setResolving] = useState(false);
  const [resNote, setResNote] = useState('');
  const [resErr, setResErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [lb, setLb] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; text: string; run: () => Promise<void> }>(null);
  const idRef = useRef(id); idRef.current = id;
  const tlEnd = useRef<HTMLDivElement>(null);

  async function load() {
    try { const d = await api<Kriz>('GET', '/krizler/' + id); if (idRef.current === id) { setK(d); setMissing(false); } }
    catch (e: any) { if (e.status === 404) setMissing(true); else snack(e.message); }
  }
  useEffect(() => { setK(null); setResolving(false); setNote(''); load(); }, [id]);
  useEffect(() => onLive(['kriz', '*'], (m) => { if (m.type === '*' || m.id === idRef.current) load(); }), []);
  // Escape: üstte pencere/önizleme yoksa çekmeceyi kapat
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.overlay, .lb')) onClose(); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  // ⌘V: ekran görüntüsü ekle
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      if (!k || document.querySelector('.overlay')) return;
      const fs = imageFiles(e.clipboardData); if (!fs.length) return;
      e.preventDefault(); addShots(fs);
    };
    document.addEventListener('paste', h); return () => document.removeEventListener('paste', h);
  }, [k?.id]);

  async function addShots(list: File[]) {
    const ok = checkShots(list); if (!ok.length || !k) return;
    const n = await uploadShots(k.id, ok, setBusy);
    if (n) snack(n + ' ekran görüntüsü eklendi');
    load();
  }
  async function setStatus(st: string) {
    if (!k || st === k.status) return;
    if (st === 'cozuldu') { setResolving(true); setResErr(''); return; }
    try { setK(await api<Kriz>('POST', '/krizler/' + k.id + '/status', { status: st })); snack(st === 'mudahale' ? 'Müdahale ediliyor olarak işaretlendi' : 'Kayıt yeniden açıldı'); }
    catch (e: any) { snack(e.message); }
  }
  async function resolve(el: EventTarget | null) {
    if (!k) return;
    if (!resNote.trim()) { setResErr('Kısa bir çözüm notu yaz'); return; }
    try {
      setK(await api<Kriz>('POST', '/krizler/' + k.id + '/status', { status: 'cozuldu', note: resNote.trim() }));
      setResolving(false); setResNote(''); kutla(el as Element); snack('Kriz çözüldü 🎉');
    } catch (e: any) { setResErr(e.message); }
  }
  async function addNote() {
    const t = note.trim(); if (!t || !k) return;
    try { setK(await api<Kriz>('POST', '/krizler/' + k.id + '/notes', { text: t })); setNote(''); setTimeout(() => tlEnd.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50); }
    catch (e: any) { snack(e.message); }
  }
  async function patch(body: Partial<Kriz>) {
    if (!k) return;
    try { setK(await api<Kriz>('PATCH', '/krizler/' + k.id, body)); } catch (e: any) { snack(e.message); }
  }

  const isAdmin = me.role === 'admin';
  const canEdit = !!k && (isAdmin || k.createdBy === me.id || k.ownerId === me.id);
  const canDelete = !!k && (isAdmin || k.createdBy === me.id);
  const team = activeTeam(s.team);
  const client = k ? findClient(s.clients, k.client) : null;
  const done = k?.status === 'cozuldu';
  const stepIdx = k ? STA.findIndex(([x]) => x === k.status) : 0;

  return (
    <Portal>
    <div class="drawer-wrap kr-wrap">
      <button type="button" class="scrim" aria-label="Kapat" onClick={onClose} />
      <aside class={'drawer kr-drawer' + (k ? ' p-' + k.priority : '')} role="dialog" aria-label="Kriz kaydı">
        <div class="row" style="gap:8px">
          {k && <PriPill p={k.priority} />}
          {k && <StaPill s={k.status} />}
          <span class="spacer" />
          {canEdit && <button type="button" class="btn sm ghost" onClick={() => setEditing(true)}>Düzenle</button>}
          <button type="button" class="iconbtn" aria-label="Kapat" onClick={onClose}><Icon n="x" size={16} /></button>
        </div>
        {missing && <p class="empty">Bu kayıt silinmiş ya da bulunamadı.</p>}
        {!k && !missing && <span class="sub">Yükleniyor…</span>}
        {k && (
          <>
            <div class="kr-dhead">
              <h2>{k.title}</h2>
              <div class="row" style="gap:8px">
                <a class="kr-clientlink" href={client ? '/musteriler?id=' + client.id : '#'} onClick={(e) => { e.preventDefault(); if (client) navigate('/musteriler?id=' + client.id); }}>
                  <ClientMark name={k.client} size={20} />{k.client}
                </a>
                <span class="sub">{memberName(s.team, k.createdBy)} açtı · {fmtWhen(k.createdAt)}</span>
              </div>
              {!done
                ? <span class="kr-timer"><span class="kr-pulse" aria-hidden="true" />{openFor(now - sqlTime(k.createdAt).getTime(), true)}</span>
                : <span class="kr-timer done"><Icon n="check" size={14} w={2.6} /><b>{dur(sqlTime(k.resolvedAt || k.updatedAt).getTime() - sqlTime(k.createdAt).getTime())}</b> içinde çözüldü</span>}
            </div>

            {/* durum adımları */}
            <div class="kr-steps" role="group" aria-label="Durum">
              {STA.map(([st, l], i) => (
                <button type="button" class={'kr-step' + (i <= stepIdx ? ' on' : '') + (st === k.status ? ' cur' : '') + ' s-' + st} aria-pressed={st === k.status}
                  onClick={() => setStatus(st)}>
                  <span class="kr-step-dot" aria-hidden="true">{i < stepIdx || done ? '✓' : i + 1}</span>{l}
                </button>
              ))}
            </div>
            {resolving && !done && (
              <form class="kr-resolve" onSubmit={(e) => { e.preventDefault(); resolve((e.currentTarget as HTMLFormElement).querySelector('button[type=submit]')); }}>
                <label class="field">Çözüm notu <span class="sub" style="font-weight:500">(zorunlu)</span>
                  <textarea class={'input' + (resErr ? ' err' : '')} rows={3} maxLength={2000} autoFocus value={resNote} placeholder="Nasıl çözüldü? Örn. Müşteriyle görüşüldü, yorum yanıtlandı, yeni paylaşım yapıldı."
                    onInput={(e) => { setResNote((e.target as HTMLTextAreaElement).value); setResErr(''); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); resolve(e.currentTarget); } if (e.key === 'Escape') { e.stopPropagation(); setResolving(false); } }} />
                </label>
                {resErr && <span class="errtext" role="alert">{resErr}</span>}
                <div class="row" style="justify-content:flex-end">
                  <button type="button" class="btn sm" onClick={() => setResolving(false)}>Vazgeç</button>
                  <button type="submit" class="btn primary sm kr-okbtn"><Icon n="check" size={14} w={2.6} />Çözüldü olarak kaydet</button>
                </div>
              </form>
            )}
            {done && k.resolution && (
              <div class="kr-resbox"><b>Çözüm</b><span>{k.resolution}</span><span class="sub">{memberName(s.team, k.resolvedBy)} · {k.resolvedAt ? fmtWhen(k.resolvedAt) : ''}</span></div>
            )}

            <dl class="kr-facts">
              <div><dt>Kaynak</dt><dd>{SRC_L[k.source]}</dd></div>
              <div><dt>Sorumlu</dt><dd>
                {canEdit ? (
                  <select class="kr-inl" aria-label="Sorumlu" value={k.ownerId || ''} onChange={(e) => patch({ ownerId: (e.target as HTMLSelectElement).value || null })}>
                    <option value="">Seçilmedi</option>
                    {team.map((m) => <option value={m.id}>{m.name}</option>)}
                  </select>
                ) : memberName(s.team, k.ownerId)}
              </dd></div>
              <div><dt>Öncelik</dt><dd>
                {canEdit ? (
                  <select class="kr-inl" aria-label="Öncelik" value={k.priority} onChange={(e) => patch({ priority: (e.target as HTMLSelectElement).value })}>
                    {PRI_ORDER.slice().reverse().map((p) => <option value={p}>{PRI[p].emoji} {PRI[p].label}</option>)}
                  </select>
                ) : PRI[k.priority].label}
              </dd></div>
              {k.link && <div class="wide"><dt>Bağlantı</dt><dd><a href={k.link} target="_blank" rel="noopener noreferrer" class="kr-link"><Icon n="ext" size={13} />{k.link.replace(/^https?:\/\/(www\.)?/, '').slice(0, 70)}</a></dd></div>}
            </dl>
            {k.description && <p class="kr-desc">{k.description}</p>}

            <section class="kr-sec">
              <h3 class="kr-h3">Ekran görüntüleri {k.files.length > 0 && <span>{k.files.length}</span>}</h3>
              {k.files.length > 0 && (
                <div class="kr-thumbs">
                  {k.files.map((f, i) => (
                    <span class="kr-thumb">
                      <button type="button" class="kr-thumb-b" aria-label={'Büyüt: ' + f.name} onClick={() => setLb(i)}><img src={f.url} alt={f.name} loading="lazy" /></button>
                      {(isAdmin || f.createdBy === me.id) && <button type="button" class="kr-thumb-x" aria-label={'Sil: ' + f.name} onClick={() => setConfirm({
                        title: 'Ekran görüntüsünü sil', text: f.name + ' silinsin mi?',
                        run: async () => { try { await api('DELETE', '/krizler/' + k.id + '/files/' + f.id); load(); } catch (e: any) { snack(e.message); } },
                      })}><Icon n="x" size={11} w={2.6} /></button>}
                    </span>
                  ))}
                </div>
              )}
              <ShotDrop onFiles={addShots} busy={busy} compact />
            </section>

            <section class="kr-sec">
              <h3 class="kr-h3">Zaman çizelgesi</h3>
              <ol class="kr-tl">
                {(k.events || []).map((e) => {
                  const m = s.team.find((x) => x.id === e.userId);
                  const x = evText(e);
                  return (
                    <li class={'kr-ev k-' + e.kind + (x.st ? ' st-' + x.st : '')}>
                      <span class="kr-ev-av"><Avatar m={m} size={24} presence={false} /></span>
                      <span class="kr-ev-b">
                        <span class="kr-ev-h"><b>{m?.firstName || 'Eski üye'}</b> {x.t}<span class="kr-ev-t">{fmtWhen(e.createdAt)}</span></span>
                        {x.body && <span class="kr-ev-x">{x.body}</span>}
                      </span>
                    </li>
                  );
                })}
              </ol>
              <div ref={tlEnd} />
              <form class="kr-noteform" onSubmit={(e) => { e.preventDefault(); addNote(); }}>
                <textarea class="input" rows={2} maxLength={2000} value={note} placeholder="Adım notu ekle… (ne yaptın, kimle konuştun) · Enter ile gönder" aria-label="Adım notu"
                  onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); addNote(); } }} />
                <button type="submit" class="btn primary sm">Ekle</button>
              </form>
            </section>

            {canDelete && (
              <div class="row" style="justify-content:flex-end;border-top:1px solid var(--line);padding-top:14px">
                <button type="button" class="btn sm danger" onClick={() => setConfirm({
                  title: 'Kaydı sil', text: '“' + k.title + '” kaydı, zaman çizelgesi ve ekran görüntüleriyle birlikte kalıcı olarak silinsin mi?',
                  run: async () => { try { await api('DELETE', '/krizler/' + k.id); snack('Kayıt silindi'); onClose(); } catch (e: any) { snack(e.message); } },
                })}><Icon n="trash" size={14} />Kaydı sil</button>
              </div>
            )}
          </>
        )}
      </aside>
      {editing && k && <KrizForm edit={k} onClose={() => setEditing(false)} onSaved={(d) => { setK(d); setEditing(false); }} />}
      {lb !== null && k && k.files[lb] && <Lightbox index={lb} onIndex={setLb} onClose={() => setLb(null)} items={k.files.map((f) => ({ url: f.url, title: f.name, sub: memberName(s.team, f.createdBy) + ' · ' + fmtWhen(f.createdAt) }))} />}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)} width={420}>
          <p style="margin:0;color:var(--mute);line-height:1.5">{confirm.text}</p>
          <form class="row" style="justify-content:flex-end" onSubmit={async (e) => { e.preventDefault(); const c = confirm; setConfirm(null); await c.run(); }}>
            <button type="button" class="btn" onClick={() => setConfirm(null)}>Vazgeç</button>
            <button type="submit" class="btn danger confirm" autoFocus>Sil</button>
          </form>
        </Modal>
      )}
    </div>
    </Portal>
  );
}

// ---------- müşteri kartındaki "Kriz kayıtları" sekmesi ----------
export function MusteriKrizleri({ client }: { client: string }) {
  const now = useNow();
  const [list, setList] = useState<Kriz[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const cRef = useRef(client); cRef.current = client;
  const load = () => api<Kriz[]>('GET', '/krizler?client=' + encodeURIComponent(client)).then((l) => { if (cRef.current === client) setList(l); }).catch((e) => snack(e.message));
  useEffect(() => { setList(null); load(); }, [client]);
  useEffect(() => onLive(['kriz', '*'], () => load()), [client]);
  const act = (list || []).filter((k) => k.status !== 'cozuldu').sort(sortOpen);
  const done = (list || []).filter((k) => k.status === 'cozuldu').sort(sortDone);
  return (
    <div class="kr-mk">
      <div class="row" style="gap:8px">
        <span class="sub">{list ? (act.length ? act.length + ' açık kriz' : 'Açık kriz yok') + (done.length ? ' · ' + done.length + ' çözüldü' : '') : 'Yükleniyor…'}</span>
        <span class="spacer" />
        <button type="button" class="btn sm ghost" onClick={() => navigate('/krizler?musteri=' + encodeURIComponent(client))}>Tüm kayıtlar</button>
        <button type="button" class="btn primary sm" onClick={() => setForm(true)}><Icon n="plus" size={14} w={2.4} />Kriz kaydı aç</button>
      </div>
      {list && act.length === 0 && done.length === 0 && <div class="kr-calm"><span aria-hidden="true">🌿</span>{client} için hiç kriz kaydı yok.</div>}
      {act.map((k) => <KrizCard k={k} now={now} onOpen={setOpen} showClient={false} />)}
      {done.length > 0 && (
        <div class="kr-donebox">
          <button type="button" class="kr-donebtn" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <span aria-hidden="true">{showDone ? '▾' : '▸'}</span>Çözülenler <span class="sub">{done.length}</span>
          </button>
          {showDone && done.map((k) => <KrizCard k={k} now={now} onOpen={setOpen} showClient={false} />)}
        </div>
      )}
      {open && <KrizDrawer id={open} onClose={() => { setOpen(null); load(); }} />}
      {form && <KrizForm client={client} onClose={() => setForm(false)} onSaved={(k) => { setForm(false); load(); setOpen(k.id); }} />}
    </div>
  );
}

// ---------- sayfa ----------
const qp = (k: string) => new URLSearchParams(location.search).get(k);

export function Krizler({ openTask }: { openTask: (id: string) => void }) {
  const now = useNow();
  const [list, setList] = useState<Kriz[] | null>(null);
  const [open, setOpen] = useState<string | null>(qp('id'));
  const [client, setClient] = useState(qp('musteri') || '');
  const [form, setForm] = useState(qp('yeni') !== null);
  const [showDone, setShowDone] = useState(false);
  const openRef = useRef(open); openRef.current = open;

  const load = () => api<Kriz[]>('GET', '/krizler').then(setList).catch((e) => snack(e.message));
  useEffect(() => { load(); }, []);
  useEffect(() => onLive(['kriz', '*'], () => load()), []);
  // bildirim bağlantısı / geri tuşu: ?id=
  useEffect(() => {
    const f = () => { if (location.pathname !== '/krizler') return; const id = qp('id'); if (id !== openRef.current) setOpen(id); const m = qp('musteri'); if (m !== null) setClient(m); };
    window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); };
  }, []);
  function pick(id: string | null) {
    setOpen(id);
    const p = new URLSearchParams(location.search); p.delete('yeni');
    if (id) p.set('id', id); else p.delete('id');
    const url = '/krizler' + (p.toString() ? '?' + p : '');
    if (location.pathname + location.search !== url) history[id ? 'pushState' : 'replaceState']({}, '', url);
  }
  function setFilter(v: string) {
    setClient(v);
    const p = new URLSearchParams(location.search); if (v) p.set('musteri', v); else p.delete('musteri');
    history.replaceState({}, '', '/krizler' + (p.toString() ? '?' + p : ''));
  }

  const all = list || [];
  const shown = client ? all.filter((k) => k.client.toLocaleLowerCase('tr') === client.toLocaleLowerCase('tr')) : all;
  const act = shown.filter((k) => k.status !== 'cozuldu').sort(sortOpen);
  const done = shown.filter((k) => k.status === 'cozuldu').sort(sortDone);
  const names = useMemo(() => [...new Set(all.map((k) => k.client))].sort((a, b) => a.localeCompare(b, 'tr')), [list]);
  const nOpen = act.filter((k) => k.status === 'acik').length;
  const nAct = act.filter((k) => k.status === 'mudahale').length;
  const nHot = act.filter((k) => k.priority === 'acil' || k.priority === 'yuksek').length;
  const month = new Date().toISOString().slice(0, 7);
  const nMonth = done.filter((k) => (k.resolvedAt || '').startsWith(month)).length;

  return (
    <div class="page kr">
      <div class="row kr-head">
        <div style="flex:1 1 260px;min-width:0">
          <h1 class="h1">Kriz kayıtları</h1>
          <p class="sub" style="margin:6px 0 0">Olumsuz yorum, şikâyet, yanlış paylaşım… hızlıca kaydet, ekip duysun, çözülene kadar takip et.</p>
        </div>
        <button type="button" class="btn primary" onClick={() => setForm(true)}><Icon n="plus" size={16} w={2.4} />Kriz kaydı aç</button>
        <Bell onOpenTask={openTask} />
      </div>

      <div class="kr-stats">
        <div class={'kr-stat' + (nHot ? ' hot' : '')}><span class="v"><Sayi v={nHot} /></span><span class="l">Acil / yüksek</span></div>
        <div class="kr-stat"><span class="v"><Sayi v={nOpen} /></span><span class="l">Açık</span></div>
        <div class="kr-stat"><span class="v"><Sayi v={nAct} /></span><span class="l">Müdahale ediliyor</span></div>
        <div class="kr-stat ok"><span class="v"><Sayi v={nMonth} /></span><span class="l">Bu ay çözülen</span></div>
      </div>

      <div class="row kr-filter">
        <label class="kr-sel"><Icon n="clients" size={15} /><span class="sr">Müşteriye göre süz</span>
          <select value={client} onChange={(e) => setFilter((e.target as HTMLSelectElement).value)}>
            <option value="">Tüm müşteriler</option>
            {names.map((n) => <option value={n}>{n}</option>)}
            {client && !names.includes(client) && <option value={client}>{client}</option>}
          </select>
        </label>
        {client && <button type="button" class="btn sm ghost" onClick={() => setFilter('')}>Süzgeci kaldır</button>}
      </div>

      <section class="kr-list" aria-label="Açık krizler">
        {list === null && <span class="sub">Yükleniyor…</span>}
        {list && act.length === 0 && <div class="kr-calm"><span aria-hidden="true">🌿</span>Şu an açık kriz yok. Sakin bir gün.</div>}
        {act.map((k) => <KrizCard k={k} now={now} onOpen={pick} />)}
      </section>

      {done.length > 0 && (
        <section class="kr-donebox" aria-label="Çözülenler">
          <button type="button" class="kr-donebtn" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            <span aria-hidden="true">{showDone ? '▾' : '▸'}</span>Çözülenler <span class="sub">{done.length}</span>
          </button>
          {showDone && <div class="kr-list">{done.map((k) => <KrizCard k={k} now={now} onOpen={pick} />)}</div>}
        </section>
      )}

      {open && <KrizDrawer id={open} onClose={() => pick(null)} />}
      {form && <KrizForm client={client || undefined} onClose={() => { setForm(false); pick(openRef.current); }} onSaved={(k) => { setForm(false); load(); pick(k.id); }} />}
    </div>
  );
}
