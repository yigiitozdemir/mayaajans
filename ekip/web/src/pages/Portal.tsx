// Ekip tarafı: Vatan Hastanesi içerik onayı + talepler + misafir hesapları.
// Yalnızca portal üyeleri (Pelin) ve yönetici görür.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, onLive, snack } from '../api';
import { Icon, Modal, Sayi } from '../ui';
import { Bell } from '../components/Notify';
import {
  CONTENT_STATUS, REQUEST_STATUS, DriveButton, NoteBox, NoteThread, StatusPill, fmtTime, itemDate,
  type PGuest, type PItem, type PNote,
} from '../components/PortalParts';

type Data = { items: PItem[]; notes: PNote[]; guests: PGuest[]; client: { id: string; name: string; short: string } };
type Tab = 'content' | 'request' | 'guests';

export function Portal({ client, openTask }: { client: string; openTask: (id: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get('sekme') as Tab) || 'content');
  const [filter, setFilter] = useState('acik');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.search).get('kayit'));
  const [creating, setCreating] = useState<'content' | 'request' | null>(null);

  const load = () => api<Data>('GET', `/portal/${client}/all`).then((d) => { setData(d); setErr(''); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [client]);
  useEffect(() => onLive(['portal', '*'], (m) => { if (!m.client || m.client === client) load(); }), [client]);
  // bildirimden gelen ?kayit=
  useEffect(() => {
    const f = () => { const k = new URLSearchParams(location.search).get('kayit'); if (k) setOpen(k); };
    window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); };
  }, []);
  // açılan kayıt kendi sekmesinde görünsün
  useEffect(() => { const it = data?.items.find((i) => i.id === open); if (it && tab !== it.kind) setTab(it.kind); }, [open, data]);

  const notesBy = useMemo(() => {
    const m = new Map<string, PNote[]>();
    for (const n of data?.notes || []) { const a = m.get(n.itemId) || []; a.push(n); m.set(n.itemId, a); }
    return m;
  }, [data]);

  if (err) return <div class="page"><h1 class="h1">Vatan Onay</h1><div class="card empty">{err}</div></div>;
  if (!data) return <div class="page"><span class="sub">Yükleniyor…</span></div>;

  const contents = data.items.filter((i) => i.kind === 'content');
  const requests = data.items.filter((i) => i.kind === 'request');
  const waiting = contents.filter((i) => i.status === 'onay_bekliyor').length;
  const revise = contents.filter((i) => i.status === 'revize').length;
  const newReq = requests.filter((i) => i.status === 'bekliyor' && i.createdByKind === 'guest').length;

  const list = (tab === 'content' ? contents : requests).filter((i) => {
    if (q && !(i.title + ' ' + i.description).toLocaleLowerCase('tr').includes(q.toLocaleLowerCase('tr'))) return false;
    if (filter === 'hepsi') return true;
    if (filter === 'acik') return tab === 'content' ? !['paylasildi'].includes(i.status) : i.status !== 'tamam';
    return i.status === filter;
  });
  const opened = data.items.find((i) => i.id === open) || null;
  const statuses = tab === 'content' ? CONTENT_STATUS : REQUEST_STATUS;
  const countOf = (v: string) => (tab === 'content' ? contents : requests).filter((i) => i.status === v).length;

  return (
    <div class="page pt-page">
      <header class="row" style="align-items:flex-end;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:6px">
          <h1 class="h1">{data.client.short} Onay</h1>
          <span class="sub pt-private"><Icon n="lock" size={13} />Yalnızca sen, yönetici ve {data.client.name} yetkilileri görür</span>
        </div>
        <div class="row"><Bell onOpenTask={openTask} /></div>
      </header>

      <div class="pt-stats">
        <button type="button" class="card pt-stat amber" onClick={() => { setTab('content'); setFilter('onay_bekliyor'); }}><span>Onay bekleyen</span><b><Sayi v={waiting} /></b></button>
        <button type="button" class="card pt-stat red" onClick={() => { setTab('content'); setFilter('revize'); }}><span>Revize istenen</span><b><Sayi v={revise} /></b></button>
        <button type="button" class="card pt-stat blue" onClick={() => { setTab('request'); setFilter('bekliyor'); }}><span>Yeni talep ({data.client.short})</span><b><Sayi v={newReq} /></b></button>
        <button type="button" class="card pt-stat" onClick={() => setTab('guests')}><span>Misafir hesap</span><b>{data.guests.filter((g) => g.status === 'active').length}<small>/{data.guests.length}</small></b></button>
      </div>

      <div class="row pt-toolbar">
        <div class="seg" role="tablist" aria-label="Bölüm">
          <button type="button" role="tab" aria-selected={tab === 'content'} class={tab === 'content' ? 'on' : ''} onClick={() => { setTab('content'); setFilter('acik'); }}>İçerik onay <span class="pt-count">{contents.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === 'request'} class={tab === 'request' ? 'on' : ''} onClick={() => { setTab('request'); setFilter('acik'); }}>Talepler <span class="pt-count">{requests.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === 'guests'} class={tab === 'guests' ? 'on' : ''} onClick={() => setTab('guests')}>Misafirler</button>
        </div>
        <span class="spacer" />
        {tab !== 'guests' && <button type="button" class="btn primary" onClick={() => setCreating(tab as 'content' | 'request')}><Icon n="plus" size={16} stroke="#fff" />{tab === 'content' ? 'Yeni içerik' : 'Yeni talep'}</button>}
      </div>

      {tab === 'guests' ? <Guests client={client} data={data} reload={load} /> : (
        <>
          <div class="row pt-filters">
            <div class="pt-search"><Icon n="search" size={15} /><input class="input" placeholder={tab === 'content' ? 'İçerik ara…' : 'Talep ara…'} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} aria-label="Ara" /></div>
            <div class="pt-chips" role="group" aria-label="Durum">
              <button type="button" class={filter === 'acik' ? 'on' : ''} onClick={() => setFilter('acik')}>Açık</button>
              {statuses.map((s) => <button type="button" class={(filter === s.v ? 'on ' : '') + s.tone} onClick={() => setFilter(s.v)}>{s.label} <span>{countOf(s.v)}</span></button>)}
              <button type="button" class={filter === 'hepsi' ? 'on' : ''} onClick={() => setFilter('hepsi')}>Hepsi</button>
            </div>
          </div>
          <div class="pt-list">
            {!list.length && <div class="card empty">Bu filtrede kayıt yok.</div>}
            {list.map((it) => {
              const ns = notesBy.get(it.id) || [];
              const last = [...ns].reverse().find((n) => n.authorKind !== 'team' && n.action !== 'status');
              return (
                <button type="button" class={'card pt-row ' + it.kind} onClick={() => setOpen(it.id)}>
                  <span class="pt-no">{it.no}</span>
                  <span class="pt-main">
                    <span class="pt-title">{it.title}{it.createdByKind === 'guest' && <span class="pt-from">{data.client.short}'dan</span>}</span>
                    <span class="pt-meta">
                      {itemDate(it) && <span><Icon n="cal" size={12} />{itemDate(it)}</span>}
                      {it.description && <span class="pt-desc">{it.description}</span>}
                    </span>
                    {last && <span class={'pt-last ' + last.action}>{last.action === 'approve' ? '✓ ' : last.action === 'revise' ? '↺ ' : '💬 '}<b>{last.authorName.split(' · ')[0]}:</b> {last.body || (last.action === 'approve' ? 'Onayladı' : '')}</span>}
                  </span>
                  <span class="pt-side">
                    <StatusPill kind={it.kind} status={it.status} />
                    <span class="row" style="gap:6px;flex-wrap:nowrap">
                      {ns.length > 0 && <span class="pt-ncount" title="Not sayısı"><Icon n="chat" size={12} />{ns.length}</span>}
                      <DriveButton link={it.link} compact />
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {opened && <ItemModal client={client} item={opened} notes={notesBy.get(opened.id) || []} onClose={() => { setOpen(null); if (location.search.includes('kayit=')) history.replaceState({}, '', location.pathname); }} reload={load} />}
      {creating && <ItemModal client={client} kind={creating} notes={[]} onClose={() => setCreating(null)} reload={load} />}
    </div>
  );
}

function ItemModal({ client, item, kind, notes, onClose, reload }: { client: string; item?: PItem; kind?: 'content' | 'request'; notes: PNote[]; onClose: () => void; reload: () => void }) {
  const k = item?.kind || kind || 'content';
  const [f, setF] = useState({
    title: item?.title || '', link: item?.link || '', planDate: item?.planDate || '', givenDate: item?.givenDate || '', dueDate: item?.dueDate || '',
    dateText: item?.dateText || '', description: item?.description || '', status: item?.status || (k === 'content' ? 'onay_bekliyor' : 'bekliyor'),
  });
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const set = (key: keyof typeof f) => (e: Event) => setF({ ...f, [key]: (e.target as HTMLInputElement).value });
  const dirty = !item || (Object.keys(f) as (keyof typeof f)[]).some((key) => String((item as any)[key] ?? '') !== String(f[key] ?? ''));

  async function save() {
    if (!f.title.trim()) { snack('Başlık yaz'); return; }
    setBusy(true);
    const body = k === 'content'
      ? { kind: k, title: f.title, link: f.link, planDate: f.planDate || null, dateText: f.dateText, description: f.description, status: f.status }
      : { kind: k, title: f.title, link: f.link, givenDate: f.givenDate || null, dueDate: f.dueDate || null, dateText: f.dateText, description: f.description, status: f.status };
    try {
      if (item) await api('PATCH', `/portal/${client}/items/${item.id}`, body);
      else await api('POST', `/portal/${client}/items`, body);
      snack(item ? 'Kaydedildi' : k === 'content' ? 'İçerik eklendi — Vatan yetkilileri görebilir' : 'Talep eklendi');
      reload(); if (!item) onClose();
    } catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!item) return;
    if (!del) { setDel(true); return; }
    try { await api('DELETE', `/portal/${client}/items/${item.id}`); snack('Silindi'); reload(); onClose(); } catch (e: any) { snack(e.message); }
  }
  const statuses = k === 'content' ? CONTENT_STATUS : REQUEST_STATUS;

  return (
    <Modal title={item ? (k === 'content' ? 'İçerik #' + item.no : 'Talep #' + item.no) : k === 'content' ? 'Yeni içerik' : 'Yeni talep'} onClose={onClose} width={640}>
      <div class="pt-form">
        <label class="field">{k === 'content' ? 'İçerik' : 'İş / talep'}
          <input class="input" value={f.title} onInput={set('title')} placeholder={k === 'content' ? 'Örn. Dr. Serkan Aslan vizit videosu' : 'Örn. Nöroşirurji bilgilendirici postu'} />
        </label>
        <label class="field">Drive bağlantısı
          <div class="row" style="flex-wrap:nowrap">
            <input class="input" value={f.link} onInput={set('link')} placeholder="https://drive.google.com/…" inputMode="url" />
            {f.link && <DriveButton link={f.link} compact />}
          </div>
        </label>
        <div class="pt-form2">
          {k === 'content' ? (
            <label class="field">Paylaşım için planlanan tarih<input class="input" type="date" value={f.planDate} onInput={set('planDate')} /></label>
          ) : (
            <>
              <label class="field">Verildiği tarih<input class="input" type="date" value={f.givenDate} onInput={set('givenDate')} /></label>
              <label class="field">Teslim tarihi<input class="input" type="date" value={f.dueDate} onInput={set('dueDate')} /></label>
            </>
          )}
          <label class="field">Durum
            <select class="input" value={f.status} onChange={set('status')}>{statuses.map((s) => <option value={s.v}>{s.label}</option>)}</select>
          </label>
        </div>
        {f.dateText && <label class="field">Tarih (yazı)<input class="input" value={f.dateText} onInput={set('dateText')} /></label>}
        <label class="field">{k === 'content' ? 'Maya Ajans açıklaması' : 'Not'}
          <textarea class="input" rows={3} value={f.description} onInput={set('description')} placeholder={k === 'content' ? 'Vatan yetkilisinin göreceği açıklama (isteğe bağlı)' : 'Ayrıntılar (isteğe bağlı)'} />
        </label>
        <div class="row">
          {item && <button type="button" class={'btn danger' + (del ? ' confirm' : '')} onClick={remove}><Icon n="trash" size={14} />{del ? 'Eminim, sil' : 'Sil'}</button>}
          <span class="spacer" />
          <button type="button" class="btn" onClick={onClose}>Kapat</button>
          <button type="button" class="btn primary" disabled={busy || !dirty} onClick={save}>{item ? 'Kaydet' : 'Ekle'}</button>
        </div>
      </div>
      {item && (
        <section class="pt-notes">
          <h3>Yazışma <span class="sub">Vatan yetkilileri de görür</span></h3>
          <NoteThread notes={notes} empty="Henüz not yok. Vatan yetkilileri onay ya da revize notu yazınca burada görünür." />
          <NoteBox placeholder="Vatan yetkililerine not yaz…" onSend={async (body) => { try { await api('POST', `/portal/${client}/items/${item.id}/notes`, { body }); reload(); } catch (e: any) { snack(e.message); throw e; } }} />
        </section>
      )}
    </Modal>
  );
}

function shareText(l: { link: string; firstName: string; reset?: boolean }, clientName: string) {
  return l.reset
    ? `Merhaba ${l.firstName}, Maya Ajans içerik onay sayfası için yeni şifre bağlantınız: ${l.link}`
    : `Merhaba ${l.firstName}, ${clientName} içeriklerini onaylamak, revize notu yazmak ve taleplerinizi iletmek için Maya Ajans onay sayfanız hazır. Şifrenizi belirleyip giriş yapın: ${l.link}`;
}

function Guests({ client, data, reload }: { client: string; data: Data; reload: () => void }) {
  const [f, setF] = useState({ firstName: '', lastName: '', email: '' });
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<{ link: string; email: string; firstName: string; reset?: boolean } | null>(null);
  const [rm, setRm] = useState<string | null>(null);
  async function add() {
    setBusy(true);
    try { const r = await api<any>('POST', `/portal/${client}/guests`, f); setLink(r); setF({ firstName: '', lastName: '', email: '' }); reload(); }
    catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  async function newLink(g: PGuest) {
    try { setLink(await api<any>('POST', `/portal/${client}/guests/${g.id}/link`)); } catch (e: any) { snack(e.message); }
  }
  async function remove(g: PGuest) {
    if (rm !== g.id) { setRm(g.id); return; }
    try { await api('DELETE', `/portal/${client}/guests/${g.id}`); snack('Erişim kaldırıldı'); setRm(null); reload(); } catch (e: any) { snack(e.message); }
  }
  const text = link ? shareText(link, data.client.name) : '';
  return (
    <div class="pt-guests">
      <div class="card pt-ginfo">
        <Icon n="lock" size={16} />
        <p><b>{data.client.name} yetkilileri</b> e-posta ve şifreleriyle giriş yapar ve yalnızca bu onay sayfasını görür: içerikleri, Drive bağlantılarını, durumları ve yazışmaları. Onay verebilir, revize notu yazabilir, yeni talep iletebilirler. Ekibin diğer bölümlerine erişemezler.</p>
      </div>
      <div class="card pt-glist">
        {!data.guests.length && <div class="empty">Henüz misafir yok.</div>}
        {data.guests.map((g) => (
          <div class="pt-g">
            <span class="pt-gav">{(g.firstName || g.email).slice(0, 1).toUpperCase()}</span>
            <span class="pt-gmain"><b>{(g.firstName + ' ' + g.lastName).trim() || g.email}</b><span>{g.email}</span></span>
            <span class={'pt-gst ' + g.status}>{g.status === 'active' ? (g.lastLoginAt ? 'Son giriş ' + fmtTime(g.lastLoginAt) : 'Aktif') : 'Davet bekliyor'}</span>
            <button type="button" class="btn sm" onClick={() => newLink(g)}>{g.status === 'active' ? 'Şifre bağlantısı' : 'Davet bağlantısı'}</button>
            <button type="button" class={'btn sm danger' + (rm === g.id ? ' confirm' : '')} onClick={() => remove(g)}>{rm === g.id ? 'Eminim' : 'Kaldır'}</button>
          </div>
        ))}
      </div>
      <div class="card pt-gadd">
        <h3>Misafir ekle</h3>
        <div class="pt-form2">
          <label class="field">Ad<input class="input" value={f.firstName} onInput={(e) => setF({ ...f, firstName: (e.target as HTMLInputElement).value })} /></label>
          <label class="field">Soyad<input class="input" value={f.lastName} onInput={(e) => setF({ ...f, lastName: (e.target as HTMLInputElement).value })} /></label>
          <label class="field">E-posta<input class="input" type="email" value={f.email} onInput={(e) => setF({ ...f, email: (e.target as HTMLInputElement).value })} placeholder="ad@corluvatan.com" /></label>
        </div>
        <div class="row"><span class="spacer" /><button type="button" class="btn primary" disabled={busy || !f.email || !f.firstName} onClick={add}><Icon n="plus" size={15} stroke="#fff" />Ekle ve bağlantı oluştur</button></div>
      </div>
      {link && (
        <Modal title={link.reset ? 'Şifre bağlantısı' : 'Davet bağlantısı'} onClose={() => setLink(null)} width={520}>
          <p class="sub" style="margin:0;line-height:1.5">{link.firstName} ({link.email}) bu bağlantıyla şifresini belirleyip giriş yapar. Bağlantı 14 gün geçerli.</p>
          <input class="input" readOnly value={link.link} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <div class="row">
            <button type="button" class="btn" onClick={() => { navigator.clipboard?.writeText(link.link); snack('Bağlantı kopyalandı'); }}><Icon n="copy" size={15} />Kopyala</button>
            <a class="btn" style="text-decoration:none" href={`mailto:${encodeURIComponent(link.email)}?subject=${encodeURIComponent('Maya Ajans · içerik onay sayfası')}&body=${encodeURIComponent(text)}`}><Icon n="mail" size={15} />E-postayla gönder</a>
            <a class="btn" style="text-decoration:none" href={'https://wa.me/?text=' + encodeURIComponent(text)} target="_blank" rel="noopener noreferrer"><Icon n="chat" size={15} />WhatsApp'ta gönder</a>
          </div>
        </Modal>
      )}
    </div>
  );
}
