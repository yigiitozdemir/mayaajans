// Müşteriler: seçili müşterinin kartı (marka kiti, logolar, marka sesi, bağlantılar, notlar)
import { useEffect, useState } from 'preact/hooks';
import { api, memberName, reloadTeam, snack, type Member } from '../api';
import { Icon as BaseIcon, Modal, navigate, useStore } from '../ui';

// ui.tsx'te olmayan simgeler
const EXTRA: Record<string, string> = {
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  upload: '<path d="M12 21V9M7 14l5-5 5 5M5 3h14"/>',
  file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
export function Icon({ n, size = 18, stroke = 'currentColor', w = 2 }: { n: string; size?: number; stroke?: string; w?: number }) {
  if (!EXTRA[n]) return <BaseIcon n={n} size={size} stroke={stroke} w={w} />;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke} stroke-width={w} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: EXTRA[n] }} />;
}

export const VARIANTS = ['Renkli', 'Beyaz', 'Siyah', 'Yatay', 'Dikey', 'İkon', 'Diğer'];
const ALLOWED = ['png', 'jpg', 'jpeg', 'webp', 'svg', 'pdf', 'ai', 'eps', 'zip'];
const MAX = 25 * 1024 * 1024;
const PALETTE = ['#2F6F8F', '#7A4E9C', '#3E7A55', '#9C4A5E', '#8A5A2B', '#5B6B3A', '#4C6A9E', '#8E5B8A'];
const LINKS: [string, string, string][] = [
  ['instagram', 'Instagram', 'instagram.com/…'], ['facebook', 'Facebook', 'facebook.com/…'], ['tiktok', 'TikTok', 'tiktok.com/@…'],
  ['linkedin', 'LinkedIn', 'linkedin.com/company/…'], ['web', 'Web sitesi', 'https://…'], ['drive', 'Drive klasörü', 'drive.google.com/…'],
];

export interface CFile { id: string; variant: string; name: string; contentType: string; size: number; ext: string; isImage: boolean; createdBy: string | null; createdAt: string }
export interface Kit {
  sector: string; owner: string; colors: { hex: string; name: string }[]; fonts: { name: string; use: string }[];
  tone: string[]; banned: string[]; tagSets: { name: string; tags: string }[]; links: Record<string, string>;
  notes: { id: string; text: string; by: string; at: string }[];
}
export interface CItem {
  id: string; name: string; slack_channel: string | null; archived: boolean; sector: string; owner: string | null;
  logoFileId: string | null; logoVariant: string | null; fileCount: number; colorCount: number; incomplete: boolean; updatedAt: string | null;
}
export interface CDetail extends CItem { kit: Kit; files: CFile[]; channel: { id: string; name: string; archived: boolean } | null }

export const fileUrl = (cid: string, fid: string, dl = false) => `/api/clients/${cid}/files/${fid}${dl ? '?download=1' : ''}`;
export function clientColor(name: string) { let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0; return PALETTE[h % PALETTE.length]; }
export function clientInitials(name: string) {
  const p = name.replace(/[^A-Za-zÇĞİÖŞÜçğıöşü0-9\s]/g, ' ').trim().split(/\s+/);
  return (((p[0] || '')[0] || '') + ((p[1] || '')[0] || '')).toLocaleUpperCase('tr') || '?';
}
const sizeLabel = (b: number) => b >= 1048576 ? (b / 1048576).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const fmtWhen = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }); };

export async function copyText(text: string, label: string) {
  try { await navigator.clipboard.writeText(text); snack('Kopyalandı: ' + label); }
  catch {
    try {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); snack('Kopyalandı: ' + label);
    } catch { snack('Kopyalanamadı'); }
  }
}

export function ClientLogo({ c, size }: { c: Pick<CItem, 'id' | 'name' | 'logoFileId' | 'logoVariant'>; size: number }) {
  const [broken, setBroken] = useState(false);
  const r = Math.round(size * 0.27);
  if (c.logoFileId && !broken) {
    return <span class={'mu-logo' + (c.logoVariant === 'Beyaz' ? ' dark' : '')} style={{ width: size + 'px', height: size + 'px', borderRadius: r + 'px', padding: Math.round(size * 0.08) + 'px', border: '1px solid var(--line)' }}>
      <img src={fileUrl(c.id, c.logoFileId)} alt="" loading="lazy" onError={() => setBroken(true)} />
    </span>;
  }
  return <span class="mu-logo ini" aria-hidden="true" style={{ width: size + 'px', height: size + 'px', borderRadius: r + 'px', background: clientColor(c.name), fontSize: Math.round(size * 0.34) + 'px' }}>{clientInitials(c.name)}</span>;
}

export function Confirm({ title, text, ok, onOk, onClose }: { title: string; text: string; ok: string; onOk: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const go = async () => { if (busy) return; setBusy(true); try { await onOk(); onClose(); } finally { setBusy(false); } };
  return (
    <Modal title={title} onClose={onClose} width={440}>
      <p style="margin:0;line-height:1.5;color:var(--mute)">{text}</p>
      <form class="row" style="justify-content:flex-end" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
        <button type="submit" class="btn danger confirm" disabled={busy} autoFocus>{ok}</button>
      </form>
    </Modal>
  );
}

/** Odaktan çıkınca / Enter'da kaydeden küçük metin alanı */
function SaveInput({ value, onSave, ...p }: { value: string; onSave: (v: string) => void; placeholder?: string; class?: string; 'aria-label'?: string; type?: string; inputMode?: string; maxLength?: number; style?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  // değeri DOM'dan oku: hızlı yazıp Enter'a basınca durum henüz güncellenmemiş olabilir
  const commit = (e: Event) => { const nv = (e.currentTarget as HTMLInputElement).value.trim(); if (nv !== value) onSave(nv); };
  return <input {...p} value={v} onInput={(e) => setV((e.target as HTMLInputElement).value)} onBlur={commit}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { setV(value); } }} />;
}

type Tab = 'kit' | 'logos' | 'voice' | 'links' | 'notes';
const TABS: [Tab, string][] = [['kit', 'Marka kiti'], ['logos', 'Logolar'], ['voice', 'Marka sesi'], ['links', 'Bağlantılar'], ['notes', 'Notlar']];

export function MusteriKart({ d, onChange, onRemoved, onBack }: { d: CDetail; onChange: (d: CDetail) => void; onRemoved: (id: string) => void | Promise<void>; onBack: () => void }) {
  const s = useStore();
  const me = s.me!;
  const isAdmin = me.role === 'admin';
  const canEdit = !!me.canEditClients || isAdmin;
  const [tab, setTab] = useState<Tab>('kit');
  const [confirm, setConfirm] = useState<null | { title: string; text: string; ok: string; run: () => Promise<void> }>(null);
  const kit = d.kit;

  async function patch(body: Partial<Kit>, msg?: string) {
    try { onChange(await api<CDetail>('PATCH', '/clients/' + d.id, body)); if (msg) snack(msg); return true; }
    catch (e: any) { snack(e.message); return false; }
  }

  const editors = s.team.filter((m) => m.canEditClients && m.status !== 'pending' || m.role === 'admin');
  const quick = d.files;

  return (
    <>
      <div class="row" style="gap:8px">
        <button type="button" class="btn sm ghost mu-back" onClick={onBack}>← Müşteriler</button>
        <span class="spacer" />
        {d.archived && <span class="tag late">Kaldırıldı</span>}
      </div>
      <header class="mu-head">
        <ClientLogo c={d} size={72} />
        <div style="flex:1 1 260px;min-width:0;display:flex;flex-direction:column;gap:8px">
          <h2>{d.name}</h2>
          <div class="row" style="gap:8px">
            <label class="mu-pill">Sektör
              {canEdit ? <SaveInput value={kit.sector} maxLength={80} placeholder="Örn. Diş kliniği" onSave={(v) => patch({ sector: v }, 'Sektör kaydedildi')} />
                : <b>{kit.sector || '—'}</b>}
            </label>
            <label class="mu-pill">Sorumlu
              {canEdit ? (
                <select value={kit.owner} onChange={(e) => patch({ owner: (e.target as HTMLSelectElement).value }, 'Sorumlu kaydedildi')}>
                  <option value="">Seçilmedi</option>
                  {s.team.map((m) => <option value={m.id}>{m.name}</option>)}
                </select>
              ) : <b>{kit.owner ? memberName(s.team, kit.owner) : '—'}</b>}
            </label>
            {d.channel && !d.channel.archived && (
              <a class="mu-pill" href={'/sohbet?id=' + d.channel.id} onClick={(e) => { e.preventDefault(); navigate('/sohbet?id=' + d.channel!.id); }}>
                <Icon n="chat" size={14} /># {d.channel.name}
              </a>
            )}
            {isAdmin && !d.archived && (
              <button type="button" class="btn sm danger" style="min-height:34px" onClick={() => setConfirm({
                title: 'Müşteriyi kaldır', ok: 'Kaldır',
                text: d.name + ' listeden kaldırılsın mı? Geçmiş işler ve dosyalar silinmez; sohbet kanalı arşivlenir. Aynı adla yeniden eklersen geri gelir.',
                run: async () => { try { await api('DELETE', '/clients/' + d.id); await onRemoved(d.id); snack(d.name + ' müşterilerden kaldırıldı'); } catch (e: any) { snack(e.message); } },
              })}><Icon n="x" size={14} />Kaldır</button>
            )}
          </div>
        </div>
      </header>

      {quick.length > 0 && (
        <div class="mu-quick" aria-label="Logo indir">
          <span style="font-size:12px;font-weight:700;color:var(--mute2)">Logo indir:</span>
          {quick.map((f) => (
            <a class="mu-dl" href={fileUrl(d.id, f.id, true)} download={f.name} title={f.name + ' indir'}>
              <span class={'mu-sw ' + (['Renkli', 'Beyaz', 'Siyah'].includes(f.variant) ? f.variant : 'other')} />
              {f.variant}<span class="ext">{f.ext.toUpperCase()}</span>
              <Icon n="download" size={14} stroke="var(--accent)" />
            </a>
          ))}
        </div>
      )}

      {isAdmin ? <EditorsBox /> : !canEdit && (
        <div class="mu-ro" role="note">
          <Icon n="lock" size={16} />
          <span>Düzenleme yetkisi yöneticide. Kartları görüntüleyebilir ve logoları indirebilirsin. Düzenleyebilenler: {editors.map((m) => m.firstName || m.name).join(', ')}.</span>
        </div>
      )}

      <div class="mu-tabs" role="tablist" aria-label="Müşteri bölümleri">
        {TABS.map(([k, l]) => (
          <button type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {l}{k === 'logos' && d.files.length > 0 && <span style="color:var(--mute2);font-weight:500"> {d.files.length}</span>}
            {k === 'notes' && kit.notes.length > 0 && <span style="color:var(--mute2);font-weight:500"> {kit.notes.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'kit' && <KitTab key={d.id} d={d} canEdit={canEdit} patch={patch} setConfirm={setConfirm} goLogos={() => setTab('logos')} />}
      {tab === 'logos' && <LogosTab key={d.id} d={d} canEdit={canEdit} onChange={onChange} setConfirm={setConfirm} />}
      {tab === 'voice' && <VoiceTab key={d.id} d={d} canEdit={canEdit} patch={patch} />}
      {tab === 'links' && <LinksTab key={d.id} d={d} canEdit={canEdit} patch={patch} />}
      {tab === 'notes' && <NotesTab key={d.id} d={d} canEdit={canEdit} onChange={onChange} setConfirm={setConfirm} team={s.team} />}

      {confirm && <Confirm title={confirm.title} text={confirm.text} ok={confirm.ok} onOk={confirm.run} onClose={() => setConfirm(null)} />}
    </>
  );
}

type SetConfirm = (c: null | { title: string; text: string; ok: string; run: () => Promise<void> }) => void;

// ---------- yönetici: düzenleme yetkisi ----------
function EditorsBox() {
  const s = useStore();
  const members = s.team.filter((m) => m.role !== 'admin');
  async function toggle(m: Member) {
    try {
      await api('PATCH', '/admin/users/' + m.id, { canEditClients: !m.canEditClients });
      await reloadTeam();
      snack(m.firstName + (m.canEditClients ? ' artık müşteri kartlarını sadece görür' : ' artık bütün müşteri kartlarını düzenleyebilir'));
    } catch (e: any) { snack(e.message); }
  }
  return (
    <div class="mu-box">
      <span class="row" style="gap:6px;font-size:12px;font-weight:700;color:var(--mute)"><Icon n="lock" size={14} />Müşteri kartlarını düzenleyebilecekler · tüm kartlar:</span>
      <span class="mu-me">Sen (her zaman)</span>
      {members.map((m) => (
        <button type="button" class={'mu-chipbtn' + (m.canEditClients ? ' on' : '')} aria-pressed={m.canEditClients} onClick={() => toggle(m)}>
          {m.canEditClients && <Icon n="check" size={11} w={3} />}{m.name}
        </button>
      ))}
      <span style="flex-basis:100%;font-size:11px;color:var(--mute2)">Seçtiğin kişiler bütün müşteri kartlarını düzenleyebilir, seçmediklerin sadece görür ve logoları indirebilir. Aynı ayar Ekip yönetiminde de var.</span>
    </div>
  );
}

// ---------- marka kiti: renkler + yazı tipleri ----------
function KitTab({ d, canEdit, patch, setConfirm, goLogos }: { d: CDetail; canEdit: boolean; patch: (b: Partial<Kit>, m?: string) => Promise<boolean>; setConfirm: SetConfirm; goLogos: () => void }) {
  const kit = d.kit;
  const [hex, setHex] = useState('#9B573F');
  const [cname, setCname] = useState('');
  const [font, setFont] = useState('');
  const [use, setUse] = useState('Başlık');
  async function addColor() {
    let h = hex.trim(); if (!h.startsWith('#')) h = '#' + h;
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) { snack('Geçerli bir HEX kodu yaz, örn. #0E5E6F'); return; }
    if (await patch({ colors: [...kit.colors, { hex: h, name: cname.trim() }] }, 'Renk eklendi')) setCname('');
  }
  async function addFont() {
    const n = font.trim(); if (!n) return;
    if (await patch({ fonts: [...kit.fonts, { name: n, use }] }, 'Yazı tipi eklendi')) setFont('');
  }
  return (
    <div style="display:flex;flex-direction:column;gap:22px">
      {d.files.length === 0 && (
        <div class="mu-box" style="justify-content:space-between">
          <span class="sub">Henüz logo yüklenmedi.</span>
          <button type="button" class="btn sm" onClick={goLogos}>{canEdit ? 'Logo yükle' : 'Logolar'}</button>
        </div>
      )}
      <section class="mu-sec">
        <h3 class="mu-h3">Renkler · tıklayınca HEX kopyalanır</h3>
        <div class="mu-cgrid">
          {kit.colors.map((c, i) => (
            <div class="mu-color">
              <button type="button" class="sw" style={{ background: c.hex }} aria-label={(c.name || 'Renk') + ' ' + c.hex + ' kopyala'} onClick={() => copyText(c.hex, c.hex)} />
              <span class="meta"><span style="font-size:13px;font-weight:600">{c.name || 'Renk'}</span><span class="hex">{c.hex}</span></span>
              {canEdit && <button type="button" class="rm" aria-label={(c.name || c.hex) + ' rengini kaldır'} onClick={() => setConfirm({ title: 'Rengi kaldır', ok: 'Kaldır', text: (c.name || 'Renk') + ' ' + c.hex + ' kaldırılsın mı?', run: async () => { await patch({ colors: kit.colors.filter((_, j) => j !== i) }, 'Renk kaldırıldı'); } })}><Icon n="x" size={12} /></button>}
            </div>
          ))}
          {kit.colors.length === 0 && !canEdit && <div class="mu-empty">Henüz renk eklenmedi.</div>}
          {canEdit && (
            <form class="mu-dash" onSubmit={(e) => { e.preventDefault(); addColor(); }}>
              <label class="row" style="gap:8px;flex-wrap:nowrap">
                <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : '#000000'} aria-label="Renk seç" style="width:36px;height:30px;padding:0;border:0;background:transparent" onInput={(e) => setHex((e.target as HTMLInputElement).value.toUpperCase())} />
                <input class="mu-mini" value={hex} aria-label="HEX kodu" maxLength={7} style="width:90px;font-family:ui-monospace,Menlo,monospace" onInput={(e) => setHex((e.target as HTMLInputElement).value)} />
              </label>
              <input class="mu-mini" value={cname} placeholder="Renk adı" aria-label="Renk adı" maxLength={40} onInput={(e) => setCname((e.target as HTMLInputElement).value)} />
              <button type="submit" class="btn primary sm">Renk ekle</button>
            </form>
          )}
        </div>
      </section>
      <section class="mu-sec mu-white">
        <h3 class="mu-h3">Yazı tipleri</h3>
        {kit.fonts.map((f, i) => (
          <div class="mu-font">
            <span class="n" style={{ fontFamily: `'${f.name.replace(/'/g, '')}', var(--font)` }}>{f.name}</span>
            <span class="chip">{f.use}</span>
            <button type="button" class="mu-x" aria-label={f.name + ' adını kopyala'} title="Adı kopyala" onClick={() => copyText(f.name, f.name)}><Icon n="copy" size={13} /></button>
            {canEdit && <button type="button" class="mu-x" aria-label={f.name + ' yazı tipini kaldır'} onClick={() => patch({ fonts: kit.fonts.filter((_, j) => j !== i) }, 'Yazı tipi kaldırıldı')}><Icon n="x" size={13} /></button>}
          </div>
        ))}
        {kit.fonts.length === 0 && <span class="sub">Henüz yazı tipi eklenmedi.</span>}
        {canEdit && (
          <form class="mu-inl" onSubmit={(e) => { e.preventDefault(); addFont(); }}>
            <input class="mu-mini" value={font} placeholder="Yazı tipi, örn. Poppins" aria-label="Yazı tipi adı" maxLength={60} onInput={(e) => setFont((e.target as HTMLInputElement).value)} />
            <select class="mu-mini" style="flex:0 0 auto" value={use} aria-label="Kullanım" onChange={(e) => setUse((e.target as HTMLSelectElement).value)}>
              <option>Başlık</option><option>Gövde</option><option>Vurgu</option>
            </select>
            <button type="submit" class="btn primary sm">Ekle</button>
          </form>
        )}
      </section>
    </div>
  );
}

// ---------- logolar ----------
function LogosTab({ d, canEdit, onChange, setConfirm }: { d: CDetail; canEdit: boolean; onChange: (d: CDetail) => void; setConfirm: SetConfirm }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [dark, setDark] = useState<Record<string, boolean>>({});
  const reload = async () => onChange(await api<CDetail>('GET', '/clients/' + d.id));

  async function upload(variant: string, list: FileList | null) {
    const files = Array.from(list || []);
    if (!files.length) return;
    setBusy(variant);
    let okN = 0;
    const errs: string[] = [];
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!f.name.includes('.') || !ALLOWED.includes(ext)) { errs.push(f.name + ': bu tür yüklenemez'); continue; }
      if (f.size > MAX) { errs.push(f.name + ': 25 MB’tan büyük'); continue; }
      const fd = new FormData(); fd.append('file', f, f.name); fd.append('variant', variant);
      try {
        const r = await fetch('/api/clients/' + d.id + '/files', { method: 'POST', body: fd, credentials: 'same-origin' });
        if (!r.ok) { const j: any = await r.json().catch(() => null); errs.push(f.name + ': ' + (j?.error || 'yüklenemedi')); continue; }
        okN++;
      } catch { errs.push(f.name + ': bağlantı hatası'); }
    }
    setBusy(null);
    await reload().catch(() => {});
    snack(errs.length ? (okN ? okN + ' dosya yüklendi · ' : '') + errs[0] + (errs.length > 1 ? ' (+' + (errs.length - 1) + ')' : '') : okN + ' dosya yüklendi (' + variant + ')');
  }

  const shown = VARIANTS.filter((v) => canEdit || d.files.some((f) => f.variant === v));
  return (
    <div class="mu-sec">
      <h3 class="mu-h3">Logo dosyaları · herkes indirebilir</h3>
      {shown.length === 0 && <div class="mu-empty">Henüz logo yüklenmedi.</div>}
      <div class="mu-vgrid">
        {shown.map((v) => {
          const files = d.files.filter((f) => f.variant === v);
          const img = files.find((f) => f.isImage);
          const isDark = dark[v] ?? v === 'Beyaz';
          return (
            <div class={'mu-vcard' + (files.length ? '' : ' empty')} aria-label={v + ' logo'}>
              {files.length > 0 && (
                <div class={'mu-prev' + (isDark ? ' dark' : '')}>
                  {img ? <img src={fileUrl(d.id, img.id)} alt={d.name + ' ' + v + ' logo'} />
                    : <span class="ph"><Icon n="file" size={30} w={1.8} />{files[0].ext.toUpperCase()}</span>}
                  <button type="button" class="tgl" aria-label={'Zemini ' + (isDark ? 'açık' : 'koyu') + ' yap'} title="Zemin açık / koyu" onClick={() => setDark({ ...dark, [v]: !isDark })}><Icon n={isDark ? 'sun' : 'moon'} size={14} /></button>
                </div>
              )}
              <div class="mu-vbody">
                <span class="row" style="gap:6px"><span class="mu-vtag">{v}</span><span class="sub" style="font-size:11px">{files.length ? files.length + ' dosya' : 'Dosya yok'}</span></span>
                {files.map((f) => (
                  <div class="mu-frow">
                    <span class="fx">{f.ext.toUpperCase()} · {sizeLabel(f.size)}</span>
                    <span class="fn" title={f.name}>{f.name}</span>
                    <a class="mu-get" href={fileUrl(d.id, f.id, true)} download={f.name} aria-label={v + ' ' + f.ext.toUpperCase() + ' indir'}><Icon n="download" size={13} />İndir</a>
                    {canEdit && <button type="button" class="mu-x" aria-label={f.name + ' dosyasını sil'} onClick={() => setConfirm({
                      title: 'Dosyayı sil', ok: 'Sil', text: f.name + ' (' + v + ') kalıcı olarak silinsin mi?',
                      run: async () => { try { await api('DELETE', '/clients/' + d.id + '/files/' + f.id); await reload(); snack('Dosya silindi'); } catch (e: any) { snack(e.message); } },
                    })}><Icon n="x" size={13} /></button>}
                  </div>
                ))}
                {canEdit && (
                  <label class="mu-up">
                    <Icon n="upload" size={14} />{busy === v ? 'Yükleniyor…' : files.length ? 'Dosya ekle' : v + ' logo yükle'}
                    <input type="file" multiple accept=".png,.jpg,.jpeg,.webp,.svg,.pdf,.ai,.eps,.zip" disabled={!!busy} aria-label={v + ' logo dosyası yükle'}
                      onChange={(e) => { const t = e.target as HTMLInputElement; upload(v, t.files).finally(() => { t.value = ''; }); }} />
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {canEdit && <span class="sub" style="font-size:12px">PNG, JPG, WEBP, SVG, PDF, AI, EPS, ZIP · en fazla 25 MB · bir türe birden çok dosya (ör. PNG + SVG) yükleyebilirsin.</span>}
    </div>
  );
}

// ---------- marka sesi ----------
function ChipEditor({ title, items, canEdit, placeholder, ban, onSave }: { title: string; items: string[]; canEdit: boolean; placeholder: string; ban?: boolean; onSave: (v: string[]) => Promise<boolean> }) {
  const [draft, setDraft] = useState('');
  const add = async () => { const v = draft.trim(); if (!v) return; if (await onSave([...items, v])) setDraft(''); };
  return (
    <section class="mu-sec mu-white">
      <h3 class="mu-h3">{title}</h3>
      <div class="mu-chips">
        {items.map((t, i) => (
          <span class={'mu-chip' + (ban ? ' ban' : '') + (canEdit ? '' : ' ro')}>{t}
            {canEdit && <button type="button" aria-label={t + ' kaldır'} onClick={() => onSave(items.filter((_, j) => j !== i))}><Icon n="x" size={10} w={2.6} /></button>}
          </span>
        ))}
        {items.length === 0 && <span class="sub">Henüz eklenmedi.</span>}
      </div>
      {canEdit && (
        <form class="mu-inl" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <input class="mu-mini" value={draft} placeholder={placeholder} maxLength={80} aria-label={title + ' ekle'} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} />
          <button type="submit" class="btn primary sm">Ekle</button>
        </form>
      )}
    </section>
  );
}

function VoiceTab({ d, canEdit, patch }: { d: CDetail; canEdit: boolean; patch: (b: Partial<Kit>, m?: string) => Promise<boolean> }) {
  const kit = d.kit;
  const [tn, setTn] = useState('');
  const [tl, setTl] = useState('');
  const addSet = async () => { if (!tl.trim()) return; if (await patch({ tagSets: [...kit.tagSets, { name: tn.trim() || 'Genel', tags: tl }] }, 'Hashtag seti eklendi')) { setTn(''); setTl(''); } };
  return (
    <div style="display:flex;flex-direction:column;gap:14px">
      <ChipEditor title="Ses tonu" items={kit.tone} canEdit={canEdit} placeholder="Örn. Samimi, güven veren" onSave={(v) => patch({ tone: v })} />
      <ChipEditor title="Kullanılmayacak ifadeler" items={kit.banned} canEdit={canEdit} ban placeholder="Örn. garanti" onSave={(v) => patch({ banned: v })} />
      <section class="mu-sec mu-white">
        <h3 class="mu-h3">Hashtag setleri · tek tıkla kopyala</h3>
        {kit.tagSets.map((t, i) => (
          <div class="mu-tagset">
            <span class="tn">{t.name}</span>
            <span class="tg">{t.tags}</span>
            <button type="button" class="btn sm" onClick={() => copyText(t.tags, t.name + ' seti')}><Icon n="copy" size={13} />Kopyala</button>
            {canEdit && <button type="button" class="mu-x" aria-label={t.name + ' setini kaldır'} onClick={() => patch({ tagSets: kit.tagSets.filter((_, j) => j !== i) }, 'Set kaldırıldı')}><Icon n="x" size={13} /></button>}
          </div>
        ))}
        {kit.tagSets.length === 0 && <span class="sub">Henüz hashtag seti eklenmedi.</span>}
        {canEdit && (
          <form class="mu-inl" onSubmit={(e) => { e.preventDefault(); addSet(); }}>
            <input class="mu-mini" style="flex:0 1 150px" value={tn} placeholder="Set adı, örn. Genel" maxLength={40} aria-label="Set adı" onInput={(e) => setTn((e.target as HTMLInputElement).value)} />
            <input class="mu-mini" style="flex:3 1 220px" value={tl} placeholder="#etiket1 #etiket2 …" aria-label="Hashtagler" onInput={(e) => setTl((e.target as HTMLInputElement).value)} />
            <button type="submit" class="btn primary sm">Set ekle</button>
          </form>
        )}
      </section>
    </div>
  );
}

// ---------- bağlantılar ----------
function LinksTab({ d, canEdit, patch }: { d: CDetail; canEdit: boolean; patch: (b: Partial<Kit>, m?: string) => Promise<boolean> }) {
  const links = d.kit.links;
  return (
    <section class="mu-white" style="padding:4px 16px">
      {LINKS.map(([k, label, ph]) => {
        const v = links[k] || '';
        return (
          <div class="mu-link">
            <span class="lb">{label}</span>
            <span class="v">
              {canEdit ? <SaveInput class="mu-mini" style="width:100%" type="text" inputMode="url" value={v} placeholder={ph} maxLength={500} aria-label={label}
                onSave={(nv) => patch({ links: { [k]: nv } }, label + ' kaydedildi')} />
                : v ? <a href={v} target="_blank" rel="noopener noreferrer">{v.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</a> : <span class="sub">—</span>}
            </span>
            {v && <a class="btn sm" href={v} target="_blank" rel="noopener noreferrer"><Icon n="ext" size={13} />Aç</a>}
            {v && <button type="button" class="mu-x" aria-label={label + ' bağlantısını kopyala'} onClick={() => copyText(v, label)}><Icon n="copy" size={13} /></button>}
          </div>
        );
      })}
    </section>
  );
}

// ---------- notlar ----------
function NotesTab({ d, canEdit, onChange, setConfirm, team }: { d: CDetail; canEdit: boolean; onChange: (d: CDetail) => void; setConfirm: SetConfirm; team: Member[] }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  async function add() {
    const t = draft.trim(); if (!t || busy) return;
    setBusy(true);
    try { onChange(await api<CDetail>('POST', '/clients/' + d.id + '/notes', { text: t })); setDraft(''); snack('Not eklendi'); }
    catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  return (
    <div class="mu-sec">
      {canEdit && (
        <form class="mu-sec" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <label class="field">Yeni not
            <textarea class="input" rows={3} maxLength={2000} value={draft} placeholder="Müşteriyle ilgili ekip notu… (⌘/Ctrl + Enter)" onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } }} />
          </label>
          <button type="submit" class="btn primary sm" style="align-self:flex-start" disabled={busy || !draft.trim()}>Notu ekle</button>
        </form>
      )}
      {d.kit.notes.map((n) => (
        <div class="mu-note-it">
          <span class="t"><span>{n.text}</span><span class="sub" style="font-size:12px">{memberName(team, n.by)} · {fmtWhen(n.at)}</span></span>
          {canEdit && <button type="button" class="mu-x" aria-label="Notu sil" onClick={() => setConfirm({
            title: 'Notu sil', ok: 'Sil', text: 'Bu not silinsin mi?',
            run: async () => { try { onChange(await api<CDetail>('DELETE', '/clients/' + d.id + '/notes/' + n.id)); snack('Not silindi'); } catch (e: any) { snack(e.message); } },
          })}><Icon n="x" size={13} /></button>}
        </div>
      ))}
      {d.kit.notes.length === 0 && <div class="mu-empty">Henüz not yok.</div>}
    </div>
  );
}
