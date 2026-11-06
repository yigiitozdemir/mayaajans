// Duyuru panosu: önemli duyurular kaybolmasın, kimin okuduğu görünsün.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, onLive, snack, MON, type Member } from '../api';
import { Avatar, Icon, Modal, Switch, useStore, kutla } from '../ui';
import { Bell } from '../components/Notify';
import '../styles/duyuru.css';

export interface Duyuru {
  id: string; authorId: string; title: string; body: string; important: boolean; pinned: boolean;
  createdAt: string; editedAt: string | null; readByMe: boolean;
  readers: { userId: string; at: string }[]; readCount: number; total: number;
  canEdit: boolean; canPin: boolean; unread: string[] | null; remindedAt: string | null; archived: boolean;
}

export const BASLIK_MAX = 120;
export const METIN_MAX = 4000;

/** "az önce", "5 dk önce", "3 sa önce", "2 gün önce", "4 Kas" */
export function since(isoStr: string, now = Date.now()): string {
  const t = Date.parse(isoStr); const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'az önce';
  if (s < 3600) return Math.floor(s / 60) + ' dk önce';
  if (s < 86400) return Math.floor(s / 3600) + ' sa önce';
  if (s < 7 * 86400) return Math.floor(s / 86400) + ' gün önce';
  const d = new Date(t);
  return d.getDate() + ' ' + MON[d.getMonth()] + (d.getFullYear() !== new Date(now).getFullYear() ? ' ' + d.getFullYear() : '');
}

// ui.tsx'te olmayan birkaç çizgi simge (aynı çizgi dilinde)
const EXTRA: Record<string, string> = {
  kalem: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  asagi: '<path d="M6 9l6 6 6-6"/>',
  saga: '<path d="M9 6l6 6-6 6"/>',
};
export function Ic({ n, size = 18 }: { n: string; size?: number }) {
  if (!EXTRA[n]) return <Icon n={n} size={size} />;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={2} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: EXTRA[n] }} />;
}

const URL_RE = /(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]])/g;
/** Metindeki bağlantıları tıklanabilir yapar (HTML olarak yorumlamadan). Satır sonları CSS ile korunur. */
export function Linkify({ text }: { text: string }) {
  const parts: ComponentChildren[] = [];
  let last = 0; let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<a href={m[1]} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{m[1]}</a>);
    last = m.index + m[1].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Duyuru listesini yükler; başkası yazınca/okuyunca canlı yenilenir. */
export function useDuyurular() {
  const [items, setItems] = useState<Duyuru[] | null>(null);
  const load = () => api<{ items: Duyuru[] }>('GET', '/duyurular').then((r) => setItems(r.items)).catch(() => setItems((x) => x ?? []));
  useEffect(() => { load(); return onLive(['duyuru', '*'], () => load()); }, []);
  const replace = (d: Duyuru) => setItems((xs) => (xs || []).map((x) => (x.id === d.id ? d : x)));
  return { items, load, replace, setItems };
}

export async function okudum(d: Duyuru, el?: EventTarget | null): Promise<Duyuru | null> {
  try { const n = await api<Duyuru>('POST', `/duyurular/${d.id}/okudum`); kutla(el); return n; }
  catch (e: any) { snack(e.message); return null; }
}

const person = (team: Member[], id: string) => team.find((m) => m.id === id);

function Readers({ d, team }: { d: Duyuru; team: Member[] }) {
  const shown = d.readers.slice(0, 6);
  const pct = d.total ? Math.round((d.readCount / d.total) * 100) : 0;
  return (
    <div class="dy-readers">
      <span class="dy-stack" aria-hidden="true">
        {shown.map((r) => <span class="dy-stack-i" title={person(team, r.userId)?.name}><Avatar m={person(team, r.userId)} size={24} presence={false} /></span>)}
        {d.readers.length > shown.length && <span class="dy-stack-more">+{d.readers.length - shown.length}</span>}
      </span>
      <span class="dy-readcount" title={d.readers.map((r) => person(team, r.userId)?.firstName).filter(Boolean).join(', ')}>
        <b>{d.readCount}/{d.total}</b> kişi okudu
      </span>
      <span class="dy-bar" aria-hidden="true"><i style={{ width: pct + '%' }} /></span>
    </div>
  );
}

function Card({ d, team, onChange, onEdit, onDelete, focus }: {
  d: Duyuru; team: Member[]; onChange: (d: Duyuru) => void; onEdit: () => void; onDelete: () => void; focus: boolean;
}) {
  const [showUnread, setShowUnread] = useState(false);
  const [busy, setBusy] = useState(false);
  const author = person(team, d.authorId);
  const unread = d.unread || [];
  const pin = async () => {
    try { onChange(await api<Duyuru>('PATCH', '/duyurular/' + d.id, { pinned: !d.pinned })); snack(d.pinned ? 'Sabitleme kaldırıldı' : 'Duyuru sabitlendi'); }
    catch (e: any) { snack(e.message); }
  };
  const remind = async () => {
    setBusy(true);
    try { const r = await api<{ sent: number; item: Duyuru }>('POST', `/duyurular/${d.id}/hatirlat`); onChange(r.item); snack(r.sent ? `${r.sent} kişiye hatırlatma gönderildi` : 'Herkes okumuş'); }
    catch (e: any) { snack(e.message); } finally { setBusy(false); }
  };
  return (
    <article id={'dy-' + d.id} data-duyuru={d.id}
      class={'card dy-card' + (!d.readByMe ? ' unread' : '') + (d.important ? ' important' : '') + (d.pinned ? ' pinned' : '') + (focus ? ' flash' : '')}>
      <div class="dy-top">
        <Avatar m={author} size={34} />
        <div class="dy-meta">
          <span class="dy-author">{author?.name || 'Ekipten biri'}</span>
          <span class="dy-time" title={new Date(d.createdAt).toLocaleString('tr-TR')}>{since(d.createdAt)}{d.editedAt ? ' · düzenlendi' : ''}</span>
        </div>
        <span class="spacer" />
        <div class="dy-flags">
          {!d.readByMe && <span class="dy-flag new">Yeni</span>}
          {d.pinned && <span class="dy-flag pin"><Icon n="pin" size={12} />Sabit</span>}
          {d.important && <span class="dy-flag imp"><Icon n="uyari" size={12} />Önemli</span>}
        </div>
        {(d.canPin || d.canEdit) && (
          <div class="dy-tools">
            {d.canPin && <button type="button" class={'iconbtn dy-tool' + (d.pinned ? ' on' : '')} aria-label={d.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'} title={d.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'} onClick={pin}><Icon n="pin" size={15} /></button>}
            {d.canEdit && <button type="button" class="iconbtn dy-tool" aria-label="Düzenle" title="Düzenle" onClick={onEdit}><Ic n="kalem" size={15} /></button>}
            {d.canEdit && <button type="button" class="iconbtn dy-tool" aria-label="Sil" title="Sil" onClick={onDelete}><Icon n="trash" size={15} /></button>}
          </div>
        )}
      </div>
      <h2 class="dy-title">{d.title}</h2>
      {d.body && <div class="dy-body"><Linkify text={d.body} /></div>}
      <div class="dy-foot">
        <Readers d={d} team={team} />
        <span class="spacer" />
        {d.unread && unread.length > 0 && (
          <button type="button" class="btn ghost sm" aria-expanded={showUnread} onClick={() => setShowUnread(!showUnread)}>
            Kimler okumadı ({unread.length})
          </button>
        )}
        {d.readByMe
          ? <span class="dy-done"><Icon n="check" size={14} />Okudun</span>
          : <button type="button" class="btn primary sm dy-okudum" onClick={async (e) => { const t = e.currentTarget; const n = await okudum(d, t); if (n) onChange(n); }}><Icon n="check" size={14} />Okudum</button>}
      </div>
      {showUnread && d.unread && unread.length > 0 && (
        <div class="dy-unread">
          <div class="dy-unread-list">
            {unread.map((id) => <span class="chip dy-person"><Avatar m={person(team, id)} size={20} />{person(team, id)?.name || id}</span>)}
          </div>
          <button type="button" class="btn sm" disabled={busy} onClick={remind}><Icon n="bell" size={14} />Okumayanlara hatırlat</button>
        </div>
      )}
    </article>
  );
}

function Editor({ d, canPin, onClose, onSaved }: { d: Duyuru | null; canPin: boolean; onClose: () => void; onSaved: (d: Duyuru) => void }) {
  const [title, setTitle] = useState(d?.title || '');
  const [body, setBody] = useState(d?.body || '');
  const [important, setImportant] = useState(!!d?.important);
  const [pinned, setPinned] = useState(!!d?.pinned);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const save = async (el?: EventTarget | null) => {
    if (busy) return;
    if (!title.trim()) { setError('Başlık boş olamaz'); ref.current?.focus(); return; }
    setBusy(true); setError('');
    try {
      const payload: Record<string, unknown> = { title, body, important };
      if (canPin) payload.pinned = pinned;
      const n = d ? await api<Duyuru>('PATCH', '/duyurular/' + d.id, payload) : await api<Duyuru>('POST', '/duyurular', payload);
      if (!d) kutla(el);
      snack(d ? 'Duyuru güncellendi' : 'Duyuru yayınlandı, ekibe haber verildi');
      onSaved(n);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={d ? 'Duyuruyu düzenle' : 'Yeni duyuru'} onClose={onClose} width={620}>
      <label class="field">Başlık
        <input ref={ref} class={'input' + (error && !title.trim() ? ' err' : '')} value={title} maxLength={BASLIK_MAX} placeholder="Ör. Cuma ofis 14:00'te kapanıyor"
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(e.currentTarget); } }} />
        <span class="dy-count">{Array.from(title).length}/{BASLIK_MAX}</span>
      </label>
      <label class="field">Metin
        <textarea class="input dy-textarea" rows={7} value={body} maxLength={METIN_MAX} placeholder="Ayrıntılar, bağlantılar… (⌘/Ctrl + Enter ile yayınla)"
          onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(e.currentTarget); } }} />
        <span class="dy-count">{Array.from(body).length}/{METIN_MAX}</span>
      </label>
      <div class="dy-switches">
        <Switch on={important} label="Önemli" hint="Bildirim “📣 Önemli duyuru” diye gider, kartı vurgulanır" onToggle={() => setImportant(!important)} />
        {canPin && <Switch on={pinned} label="Sabitle" hint="Listede ve Bugün ekranında en üstte durur" onToggle={() => setPinned(!pinned)} />}
      </div>
      {error && <div class="dy-error" role="alert">{error}</div>}
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn ghost" onClick={onClose}>Vazgeç</button>
        <button type="button" class="btn primary" disabled={busy} onClick={(e) => save(e.currentTarget)}>{d ? 'Kaydet' : 'Yayınla'}</button>
      </div>
    </Modal>
  );
}

export function ConfirmDelete({ text, onClose, onYes }: { text: string; onClose: () => void; onYes: () => void }) {
  return (
    <Modal title="Silinsin mi?" onClose={onClose} width={420}>
      <p style="margin:0;color:var(--mute);line-height:1.5">{text}</p>
      <div class="row" style="justify-content:flex-end">
        <button type="button" class="btn ghost" onClick={onClose}>Vazgeç</button>
        <button type="button" class="btn danger confirm" onClick={onYes}>Sil</button>
      </div>
    </Modal>
  );
}

/** Sabitler üstte, sonra yeniye göre (sunucudaki sıra ile aynı). */
export function sirala(list: Duyuru[]): Duyuru[] {
  return [...list].sort((a, b) => (a.pinned === b.pinned ? b.createdAt.localeCompare(a.createdAt) : a.pinned ? -1 : 1));
}

const urlId = () => (location.pathname === '/duyurular' ? new URLSearchParams(location.search).get('id') : null);

export function Duyurular({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const { items, replace, setItems } = useDuyurular();
  const [editing, setEditing] = useState<Duyuru | null | 'new'>(null);
  const [deleting, setDeleting] = useState<Duyuru | null>(null);
  const [focus, setFocus] = useState<string | null>(urlId());
  const [archiveOpen, setArchiveOpen] = useState(false);

  // bildirimden gelince: o duyuruya kaydır, bir an parlat
  useEffect(() => { const f = () => { const id = urlId(); if (id) setFocus(id); }; window.addEventListener('maya-nav', f); return () => window.removeEventListener('maya-nav', f); }, []);
  useEffect(() => {
    if (!focus || !items) return;
    const d = items.find((x) => x.id === focus);
    if (!d) { if (urlId()) { snack('Bu duyuru artık yok'); history.replaceState({}, '', '/duyurular'); } setFocus(null); return; }
    if (d.archived) setArchiveOpen(true);
    requestAnimationFrame(() => document.getElementById('dy-' + focus)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    if (location.search) history.replaceState({}, '', '/duyurular');
    const t = setTimeout(() => setFocus(null), 2400);
    return () => clearTimeout(t);
  }, [focus, items]);

  const list = sirala(items || []);
  const active = list.filter((d) => !d.archived);
  const archived = list.filter((d) => d.archived);
  const unreadN = list.filter((d) => !d.readByMe).length;
  const card = (d: Duyuru) => (
    <Card key={d.id} d={d} team={s.team} focus={focus === d.id} onChange={replace}
      onEdit={() => setEditing(d)} onDelete={() => setDeleting(d)} />
  );

  return (
    <div class="page dy-page">
      <header class="row dy-head">
        <div class="dy-head-t">
          <span class="sub">Ekip panosu</span>
          <h1 class="h1">Duyurular</h1>
          <span class="dy-lead">
            {items === null ? 'Yükleniyor…' : unreadN ? <><b>{unreadN}</b> okunmamış duyuru var.</> : 'Hepsini okudun, harika.'}
          </span>
        </div>
        <span class="spacer" />
        <div class="row">
          <button type="button" class="btn primary" onClick={() => setEditing('new')}><Icon n="plus" size={16} />Yeni duyuru</button>
          <Bell onOpenTask={openTask} />
        </div>
      </header>

      {items !== null && !list.length && (
        <div class="card dy-empty">
          <span class="dy-empty-ic"><Icon n="megafon" size={26} /></span>
          <b>Henüz duyuru yok</b>
          <span class="sub">Ekibin bilmesi gereken bir şey mi var? İlk duyuruyu sen yaz; herkese bildirim gider, kimin okuduğunu görürsün.</span>
          <button type="button" class="btn primary" onClick={() => setEditing('new')}><Icon n="plus" size={16} />Duyuru yaz</button>
        </div>
      )}

      <div class="dy-list">{active.map(card)}</div>

      {archived.length > 0 && (
        <section class="dy-archive">
          <button type="button" class="dy-archive-h" aria-expanded={archiveOpen} onClick={() => setArchiveOpen(!archiveOpen)}>
            <Ic n={archiveOpen ? 'asagi' : 'saga'} size={16} /><span>Arşiv</span><span class="dy-archive-n">{archived.length}</span>
            <span class="sub" style="margin-left:6px">30 günden eski, okunmuş duyurular</span>
          </button>
          {archiveOpen && <div class="dy-list">{archived.map(card)}</div>}
        </section>
      )}

      {editing && (
        <Editor d={editing === 'new' ? null : editing} canPin={me.role === 'admin'} onClose={() => setEditing(null)}
          onSaved={(n) => { setItems((xs) => { const ys = xs || []; return ys.some((x) => x.id === n.id) ? ys.map((x) => (x.id === n.id ? n : x)) : [n, ...ys]; }); setEditing(null); }} />
      )}
      {deleting && (
        <ConfirmDelete text={`“${deleting.title}” duyurusu herkesten kaldırılacak. Bu geri alınamaz.`} onClose={() => setDeleting(null)}
          onYes={async () => {
            const d = deleting; setDeleting(null);
            try { await api('DELETE', '/duyurular/' + d.id); setItems((xs) => (xs || []).filter((x) => x.id !== d.id)); snack('Duyuru silindi'); }
            catch (e: any) { snack(e.message); }
          }} />
      )}
    </div>
  );
}
