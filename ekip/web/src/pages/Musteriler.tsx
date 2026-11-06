// Müşteriler: solda arama + liste, sağda seçili müşterinin kartı. Mobilde liste → detay.
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, memberName, onLive, reloadClients, snack } from '../api';
import { useStore } from '../ui';
import { Bell } from '../components/Notify';
import { ClientLogo, Icon, MusteriKart, type CDetail, type CItem } from '../components/MusteriKart';
import '../styles/musteriler.css';

const lower = (s: string) => (s || '').toLocaleLowerCase('tr');
const urlId = () => new URLSearchParams(location.search).get('id');
const wide = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 821px)').matches;

export function Musteriler({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const isAdmin = me.role === 'admin';
  const [list, setList] = useState<CItem[] | null>(null);
  const [archived, setArchived] = useState<CItem[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [sel, setSel] = useState<string | null>(urlId());
  const [detail, setDetail] = useState<CDetail | null>(null);
  const [q, setQ] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [addErr, setAddErr] = useState('');
  const selRef = useRef(sel);
  selRef.current = sel;

  async function loadList() {
    const all = await api<CItem[]>('GET', '/clients' + (isAdmin ? '?archived=1' : ''));
    setList(all.filter((c) => !c.archived));
    setArchived(all.filter((c) => c.archived));
    return all;
  }
  async function loadDetail(id: string) {
    try { const d = await api<CDetail>('GET', '/clients/' + id); if (selRef.current === id) setDetail(d); }
    catch (e: any) { if (selRef.current === id) { setDetail(null); snack(e.message); } }
  }

  function pick(id: string | null, push = false) {
    selRef.current = id;
    setSel(id);
    if (!id) setDetail(null);
    const url = '/musteriler' + (id ? '?id=' + id : '');
    if (location.pathname + location.search !== url) history[push ? 'pushState' : 'replaceState']({}, '', url);
  }

  // ilk yükleme; geniş ekranda ilk müşteriyi aç
  useEffect(() => {
    loadList().then((all) => {
      if (!selRef.current && wide()) { const first = all.find((c) => !c.archived); if (first) pick(first.id); }
    }).catch((e) => snack(e.message));
  }, []);
  useEffect(() => { if (sel) { if (detail?.id !== sel) setDetail(null); loadDetail(sel); } }, [sel]);

  // bildirim bağlantısı / geri tuşu: ?id=
  useEffect(() => {
    const f = () => { if (location.pathname === '/musteriler') { const id = urlId(); if (id !== selRef.current) { selRef.current = id; setSel(id); if (!id) setDetail(null); } } };
    window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); };
  }, []);

  // canlı: başkası değiştirince
  useEffect(() => onLive(['clients'], (m) => {
    loadList().catch(() => {});
    reloadClients().catch(() => {});
    const cur = selRef.current;
    if (cur && (!m.id || m.id === cur)) loadDetail(cur);
  }), []);

  async function addClient() {
    const name = newName.trim();
    if (!name) { setAddErr('Firma adı yaz'); return; }
    try {
      const d = await api<CDetail & { reactivated?: boolean }>('POST', '/clients', { name });
      setNewName(''); setShowAdd(false); setAddErr('');
      await Promise.all([loadList(), reloadClients()]);
      pick(d.id, true); setDetail(d);
      snack(d.reactivated ? d.name + ' geri getirildi, #' + (d.channel?.name || '') + ' kanalı yeniden açıldı' : d.name + ' eklendi, #' + (d.channel?.name || '') + ' kanalı açıldı');
    } catch (e: any) { setAddErr(e.message); }
  }
  async function restore(c: CItem) {
    try { await api('POST', '/clients', { name: c.name }); await Promise.all([loadList(), reloadClients()]); pick(c.id, true); snack(c.name + ' geri getirildi'); }
    catch (e: any) { snack(e.message); }
  }

  const shown = (list || []).filter((c) => !q || lower(c.name + ' ' + c.sector + ' ' + (c.slack_channel || '')).includes(lower(q)));
  const sub = (c: CItem) => [c.sector, c.owner ? memberName(s.team, c.owner) : ''].filter(Boolean).join(' · ') || '# ' + (c.slack_channel || '');

  return (
    <div class={'mu' + (sel ? ' has-sel' : '')}>
      <section class="mu-list" aria-label="Müşteri listesi">
        <div class="row" style="gap:8px;flex-wrap:nowrap">
          <h1>Müşteriler <span style="font-size:14px;font-weight:600;color:var(--mute2)">{list ? list.length : ''}</span></h1>
          {isAdmin && (
            <button type="button" class="btn primary sm" style="min-height:38px;flex:none" aria-expanded={showAdd} onClick={() => { setShowAdd(!showAdd); setAddErr(''); }}>
              <Icon n="plus" size={15} w={2.4} />Müşteri ekle
            </button>
          )}
          <span class="mu-bell-m"><Bell onOpenTask={openTask} /></span>
        </div>
        <span class="mu-note">{isAdmin ? 'Müşteri ekleme ve kaldırma sadece sende.' : 'Müşteri ekleme ve kaldırma yöneticide · logoları herkes indirebilir.'}</span>
        {isAdmin && showAdd && (
          <form class="mu-add" onSubmit={(e) => { e.preventDefault(); addClient(); }}>
            <label class="field">Firma adı
              <input class={'input' + (addErr ? ' err' : '')} style="height:40px" value={newName} maxLength={80} placeholder="Örn. Yeni Klinik" autoFocus
                onInput={(e) => { setNewName((e.target as HTMLInputElement).value); setAddErr(''); }}
                onKeyDown={(e) => { if (e.key === 'Escape') { setShowAdd(false); setNewName(''); } }} />
            </label>
            {addErr && <span class="errtext" role="alert" style="font-size:12px">{addErr}</span>}
            <div class="row" style="gap:6px">
              <button type="submit" class="btn primary sm" style="flex:1">Müşteriyi ekle</button>
              <button type="button" class="btn sm" onClick={() => { setShowAdd(false); setNewName(''); setAddErr(''); }}>Vazgeç</button>
            </div>
            <span class="mu-note" style="font-size:11px">Eklenince Sohbet'te kendi kanalı da açılır. Kaldırılmış bir müşteriyi aynı adla eklersen geri gelir.</span>
          </form>
        )}
        <label class="mu-search">
          <Icon n="search" size={15} /><span class="sr">Müşteri ara</span>
          <input type="search" value={q} placeholder="Müşteri ara…" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
        <div class="mu-items">
          {list === null && <span class="sub">Yükleniyor…</span>}
          {shown.map((c) => (
            <button type="button" class={'mu-item' + (c.id === sel ? ' on' : '')} aria-current={c.id === sel ? 'true' : undefined} onClick={() => pick(c.id, true)}>
              <ClientLogo c={c} size={34} />
              <span class="tx"><span class="nm">{c.name}</span><span class="sb">{sub(c)}</span></span>
              {c.incomplete && <span class="inc" title="Bilgileri eksik" />}
            </button>
          ))}
          {list && shown.length === 0 && <p class="empty">{q ? '“' + q + '” ile eşleşen müşteri yok.' : 'Henüz müşteri yok.'}</p>}
        </div>
        {isAdmin && archived.length > 0 && (
          <div style="display:flex;flex-direction:column;gap:6px;border-top:1px solid var(--line);padding-top:10px">
            <button type="button" class="btn ghost sm" style="justify-content:flex-start;border:0;padding:0 4px" aria-expanded={showArchived} onClick={() => setShowArchived(!showArchived)}>
              {showArchived ? '▾' : '▸'} Kaldırılan müşteriler <span style="color:var(--mute2)">{archived.length}</span>
            </button>
            {showArchived && archived.map((c) => (
              <div class="mu-archived">
                <ClientLogo c={c} size={26} />
                <button type="button" class="linkbtn" style="flex:1;min-width:0;color:var(--mute);font-weight:500" onClick={() => pick(c.id, true)}>{c.name}</button>
                <button type="button" class="btn sm" onClick={() => restore(c)}>Geri getir</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <main class="mu-detail">
        <div class="row mu-bell-d" style="justify-content:flex-end;margin-bottom:-12px"><Bell onOpenTask={openTask} /></div>
        {!sel && <div class="mu-empty">Soldan bir müşteri seç.</div>}
        {sel && !detail && <span class="sub">Yükleniyor…</span>}
        {sel && detail && detail.id === sel && (
          <MusteriKart d={detail} onChange={(d) => { setDetail(d); loadList().catch(() => {}); reloadClients().catch(() => {}); }}
            onBack={() => pick(null, true)}
            onRemoved={async () => { await Promise.all([loadList(), reloadClients()]).catch(() => {}); pick(null); }} />
        )}
      </main>
    </div>
  );
}
