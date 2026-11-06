// Müşteri yetkilisinin (misafir) sayfası: yalnızca kendi kurumunun içerikleri ve talepleri.
// Ekip programının hiçbir bölümüne erişim yok.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, snack } from '../api';
import { Icon, Modal, Sayi, kutla } from '../ui';
import { DriveOnizleme } from '../components/DriveOnizleme';
import { applyTheme, themePref } from '../theme';
import {
  DriveButton, NoteBox, NoteThread, StatusPill, itemDate, type PItem, type PNote,
} from '../components/PortalParts';

type Me = { id: string; email: string; firstName: string; lastName: string; client: { id: string; name: string; short: string } };
type Tab = 'bekleyen' | 'icerik' | 'talep';

export function Misafir() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [data, setData] = useState<{ items: PItem[]; notes: PNote[] } | null>(null);
  const [tab, setTab] = useState<Tab>('bekleyen');
  const [open, setOpen] = useState<string | null>(null);
  const [newReq, setNewReq] = useState(false);

  const load = () => api<{ items: PItem[]; notes: PNote[] }>('GET', '/misafir/items').then(setData).catch(() => {});
  useEffect(() => {
    applyTheme(themePref());
    api<Me>('GET', '/misafir/me').then((m) => { setMe(m); document.title = m.client.name + ' · İçerik onay · Maya Ajans'; load(); }).catch(() => setMe(null));
  }, []);
  // açık kalan sayfa güncel kalsın
  useEffect(() => {
    if (!me) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 30_000);
    const v = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [me?.id]);

  const notesBy = useMemo(() => {
    const m = new Map<string, PNote[]>();
    for (const n of data?.notes || []) { const a = m.get(n.itemId) || []; a.push(n); m.set(n.itemId, a); }
    return m;
  }, [data]);

  if (me === undefined) return null;
  if (me === null) { location.replace('/giris'); return null; }

  async function logout() {
    try { await api('POST', '/misafir/logout'); } catch { /* */ }
    location.replace('/giris');
  }

  const contents = (data?.items || []).filter((i) => i.kind === 'content');
  const requests = (data?.items || []).filter((i) => i.kind === 'request');
  const pending = contents.filter((i) => i.status === 'onay_bekliyor');
  const list = tab === 'bekleyen' ? pending : tab === 'icerik' ? contents : requests;
  const opened = data?.items.find((i) => i.id === open) || null;

  return (
    <div class="ms">
      <header class="ms-top">
        <img src="/logo.png" alt="Maya Ajans" class="ms-logo" />
        <span class="ms-client">{me.client.name}</span>
        <span class="spacer" />
        <span class="ms-me">{me.firstName}</span>
        <button type="button" class="btn sm ghost" onClick={logout}><Icon n="out" size={14} />Çıkış</button>
      </header>
      <main class="ms-main">
        <section class="ms-hero">
          <h1>Merhaba {me.firstName} 👋</h1>
          <p>{me.client.name} için hazırladığımız içerikler burada. Drive'dan inceleyip <b>onaylayabilir</b> ya da <b>revize notu</b> yazabilirsiniz. Yeni bir isteğinizi <b>Talepler</b>'den iletebilirsiniz.</p>
          <div class="ms-stats">
            <div><b><Sayi v={pending.length} /></b><span>onayınızı bekliyor</span></div>
            <div><b><Sayi v={contents.filter((i) => i.status === 'revize').length} /></b><span>revize hazırlanıyor</span></div>
            <div><b><Sayi v={contents.filter((i) => i.status === 'onaylandi' || i.status === 'paylasildi').length} /></b><span>onaylandı / paylaşıldı</span></div>
          </div>
        </section>

        <div class="ms-tabs seg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'bekleyen'} class={tab === 'bekleyen' ? 'on' : ''} onClick={() => setTab('bekleyen')}>Onay bekleyen <span class="pt-count">{pending.length}</span></button>
          <button type="button" role="tab" aria-selected={tab === 'icerik'} class={tab === 'icerik' ? 'on' : ''} onClick={() => setTab('icerik')}>Tüm içerikler</button>
          <button type="button" role="tab" aria-selected={tab === 'talep'} class={tab === 'talep' ? 'on' : ''} onClick={() => setTab('talep')}>Talepler <span class="pt-count">{requests.length}</span></button>
        </div>

        {tab === 'talep' && (
          <div class="row" style="justify-content:space-between">
            <span class="sub">Maya Ajans'tan istediğiniz işler · durumlarını buradan takip edin</span>
            <button type="button" class="btn primary" onClick={() => setNewReq(true)}><Icon n="plus" size={15} stroke="#fff" />Yeni talep</button>
          </div>
        )}

        <div class="ms-list">
          {!data && <div class="card empty">Yükleniyor…</div>}
          {data && !list.length && <div class="card empty">{tab === 'bekleyen' ? 'Şu an onayınızı bekleyen içerik yok. 🎉' : 'Henüz kayıt yok.'}</div>}
          {list.map((it) => {
            const ns = notesBy.get(it.id) || [];
            return (
              <article class="card ms-card" onClick={() => setOpen(it.id)}>
                <div class="ms-card-h">
                  <span class="pt-no">{it.no}</span>
                  <h2>{it.title}</h2>
                  <StatusPill kind={it.kind} status={it.status} />
                </div>
                <div class="ms-card-m">
                  {itemDate(it) && <span><Icon n="cal" size={13} />{it.kind === 'content' ? 'Paylaşım: ' : ''}{itemDate(it)}</span>}
                  {ns.length > 0 && <span><Icon n="chat" size={13} />{ns.length} not</span>}
                </div>
                {it.description && <p class="ms-desc">{it.description}</p>}
                <div class="ms-card-a" onClick={(e) => e.stopPropagation()}>
                  <DriveButton link={it.link} />
                  {it.kind === 'content' && it.status !== 'paylasildi' && (
                    <>
                      <span class="spacer" />
                      <button type="button" class="btn sm" onClick={() => setOpen(it.id)}>↺ Revize iste</button>
                      {it.status !== 'onaylandi' && <ApproveButton id={it.id} reload={load} />}
                    </>
                  )}
                  {it.kind === 'request' && <><span class="spacer" /><button type="button" class="btn sm" onClick={() => setOpen(it.id)}><Icon n="chat" size={13} />Not yaz</button></>}
                </div>
              </article>
            );
          })}
        </div>
        <footer class="ms-foot">Maya Ajans · Bu sayfayı yalnızca {me.client.name} yetkilileri ve Maya Ajans ekibi görür.</footer>
      </main>
      {opened && <GuestItem item={opened} notes={notesBy.get(opened.id) || []} onClose={() => setOpen(null)} reload={load} />}
      {newReq && <NewRequest onClose={() => setNewReq(false)} reload={load} />}
    </div>
  );
}

function ApproveButton({ id, reload }: { id: string; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" class="btn sm ms-approve" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await api('POST', `/misafir/items/${id}/approve`, {}); kutla(document.activeElement); snack('Onaylandı — Maya Ajans\'a iletildi'); reload(); } catch (e: any) { snack(e.message); } finally { setBusy(false); }
    }}><Icon n="check" size={14} stroke="#fff" />Onaylıyorum</button>
  );
}

function GuestItem({ item, notes, onClose, reload }: { item: PItem; notes: PNote[]; onClose: () => void; reload: () => void }) {
  const [rev, setRev] = useState('');
  const [busy, setBusy] = useState(false);
  const canAct = item.kind === 'content' && item.status !== 'paylasildi';
  async function act(action: 'approve' | 'revise') {
    if (action === 'revise' && !rev.trim()) { snack('Revize notunu yazın'); return; }
    setBusy(true);
    try {
      const at = document.activeElement;
      await api('POST', `/misafir/items/${item.id}/${action}`, { body: action === 'revise' ? rev.trim() : '' });
      if (action === 'approve') kutla(at);
      snack(action === 'approve' ? 'Onaylandı — Maya Ajans\'a iletildi' : 'Revize notunuz Maya Ajans\'a iletildi');
      setRev(''); reload();
    } catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal title={(item.kind === 'content' ? 'İçerik #' : 'Talep #') + item.no} onClose={onClose} width={620}>
      <div class="ms-detail">
        <h2>{item.title}</h2>
        <div class="row"><StatusPill kind={item.kind} status={item.status} />{itemDate(item) && <span class="sub"><Icon n="cal" size={13} /> {item.kind === 'content' ? 'Paylaşım: ' : ''}{itemDate(item)}</span>}</div>
        {item.description && <p class="ms-desc">{item.description}</p>}
        <DriveButton link={item.link} />
        <DriveOnizleme link={item.link} misafir />
      </div>
      {canAct && (
        <div class="ms-actions">
          <textarea class="input" rows={3} placeholder="Revize gerekiyorsa ne değişmeli? (ör. alt yazıda isim yanlış, kapak görseli değişsin…)" value={rev} onInput={(e) => setRev((e.target as HTMLTextAreaElement).value)} />
          <div class="row">
            <button type="button" class="btn" disabled={busy || !rev.trim()} onClick={() => act('revise')}>↺ Revize iste</button>
            <span class="spacer" />
            {item.status !== 'onaylandi' ? <button type="button" class="btn ms-approve" disabled={busy} onClick={() => act('approve')}><Icon n="check" size={15} stroke="#fff" />Onaylıyorum</button>
              : <span class="pt-pill green">✓ Onayladınız</span>}
          </div>
        </div>
      )}
      <section class="pt-notes">
        <h3>Yazışma</h3>
        <NoteThread notes={notes} empty="Henüz not yok." />
        <NoteBox placeholder="Maya Ajans'a not yazın…" label="Gönder" onSend={async (body) => { try { await api('POST', `/misafir/items/${item.id}/note`, { body }); reload(); } catch (e: any) { snack(e.message); throw e; } }} />
      </section>
    </Modal>
  );
}

function NewRequest({ onClose, reload }: { onClose: () => void; reload: () => void }) {
  const [f, setF] = useState({ title: '', link: '', dueDate: '', description: '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: Event) => setF({ ...f, [k]: (e.target as HTMLInputElement).value });
  async function send() {
    setBusy(true);
    try { await api('POST', '/misafir/requests', { ...f, dueDate: f.dueDate || null }); snack('Talebiniz Maya Ajans\'a iletildi'); reload(); onClose(); }
    catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Yeni talep" onClose={onClose} width={560}>
      <div class="pt-form">
        <label class="field">Ne hazırlanmasını istiyorsunuz?<input class="input" value={f.title} onInput={set('title')} placeholder="Örn. Dr. … hasta haberi, 19 Kasım özel gün paylaşımı" /></label>
        <label class="field">Drive bağlantısı (metin, foto, video)<input class="input" value={f.link} onInput={set('link')} placeholder="https://drive.google.com/…" inputMode="url" /></label>
        <label class="field">İstenen teslim tarihi (isteğe bağlı)<input class="input" type="date" value={f.dueDate} onInput={set('dueDate')} /></label>
        <label class="field">Açıklama<textarea class="input" rows={3} value={f.description} onInput={set('description')} placeholder="Açıklama metni Drive'da, alt yazı eklenecek vb." /></label>
        <div class="row"><span class="spacer" /><button type="button" class="btn" onClick={onClose}>Vazgeç</button><button type="button" class="btn primary" disabled={busy || !f.title.trim()} onClick={send}>Talebi gönder</button></div>
      </div>
    </Modal>
  );
}
