// Yönetici: ekipten gelen geri bildirimler (hata / istek / fikir), durum ve yanıt notu.
import { useEffect, useState } from 'preact/hooks';
import { api, onLive, snack, type Member } from '../api';
import { Avatar, Icon, Modal, useStore, kutla } from '../ui';
import { Bell } from '../components/Notify';
import { TURLER, DURUMLAR, TurTag, DurumTag, kb, type GeriBildirim } from '../components/GeriBildirimDugmesi';
import { since, ConfirmDelete, Ic } from './Duyurular';
import '../styles/duyuru.css';

const OPEN = new Set(['yeni', 'inceleniyor']);
const urlId = () => (location.pathname === '/geri-bildirim' ? new URLSearchParams(location.search).get('id') : null);
const gorsel = (id: string) => `/api/geri-bildirim/${id}/gorsel`;

function Detail({ g, team, onClose, onChange, onDelete }: {
  g: GeriBildirim; team: Member[]; onClose: () => void; onChange: (g: GeriBildirim) => void; onDelete: () => void;
}) {
  const [reply, setReply] = useState(g.reply);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReply(g.reply); }, [g.id, g.reply]);
  const who = team.find((m) => m.id === g.userId);
  const patch = async (body: Record<string, unknown>, el?: EventTarget | null, msg?: string) => {
    setBusy(true);
    try { const n = await api<GeriBildirim>('PATCH', '/geri-bildirim/' + g.id, body); onChange(n); if (msg) snack(msg); if (el) kutla(el); }
    catch (e: any) { snack(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title="Geri bildirim" onClose={onClose} width={760}>
      <div class="gbd-head">
        <Avatar m={who} size={36} />
        <div style="display:flex;flex-direction:column;gap:2px;min-width:0">
          <b>{who?.name || 'Ekipten biri'}</b>
          <span class="sub">{new Date(g.createdAt).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })} · {since(g.createdAt)}</span>
        </div>
        <span class="spacer" />
        <TurTag k={g.kind} />
      </div>
      <div class="gb-msg">{g.message}</div>
      {g.hasImage && (
        <a class="gb-big" href={gorsel(g.id)} target="_blank" rel="noopener" title="Tam boyutta aç">
          <img src={gorsel(g.id)} alt="Eklenen görsel" />
          <span class="gb-big-i"><Icon n="ext" size={13} />Tam boyutta aç · {kb(g.imageSize)}</span>
        </a>
      )}
      <dl class="gb-info">
        <dt>Sayfa</dt><dd>{g.page ? <a href={g.page} target="_blank" rel="noopener">{g.page}</a> : '—'}</dd>
        <dt>Cihaz</dt><dd>{g.device || '—'}</dd>
      </dl>
      <div class="field">Durum
        <div class="seg gb-status" role="radiogroup" aria-label="Durum">
          {DURUMLAR.map((d) => (
            <button type="button" role="radio" aria-checked={g.status === d.id} class={g.status === d.id ? 'on' : ''} disabled={busy}
              onClick={(e) => g.status !== d.id && patch({ status: d.id }, d.id === 'yapildi' ? e.currentTarget : null, 'Durum: ' + d.label)}>{d.label}</button>
          ))}
        </div>
      </div>
      <label class="field"><span>Yanıt notu <span class="sub" style="font-weight:400">· gönderene bildirim olarak gider</span></span>
        <textarea class="input" rows={3} maxLength={2000} value={reply} placeholder="Ör. Düzelttim, bir dahaki açılışta gelecek. Teşekkürler!"
          onInput={(e) => setReply((e.target as HTMLTextAreaElement).value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); patch({ reply }, null, 'Yanıt gönderildi'); } }} />
      </label>
      {g.repliedAt && <span class="sub">Son yanıt: {since(g.repliedAt)}</span>}
      <div class="row">
        <button type="button" class="btn danger sm" onClick={onDelete}><Icon n="trash" size={14} />Sil</button>
        <span class="spacer" />
        <button type="button" class="btn ghost" onClick={onClose}>Kapat</button>
        <button type="button" class="btn primary" disabled={busy} onClick={() => (reply.trim() === g.reply.trim() ? snack(reply.trim() ? 'Bu yanıt zaten gönderildi' : 'Önce bir yanıt yaz') : patch({ reply }, null, reply.trim() ? 'Yanıt gönderildi' : 'Yanıt kaldırıldı'))}>Yanıtı gönder</button>
      </div>
    </Modal>
  );
}

function Row({ g, team, onOpen }: { g: GeriBildirim; team: Member[]; onOpen: () => void }) {
  const who = team.find((m) => m.id === g.userId);
  return (
    <button type="button" class={'card gb-row' + (g.status === 'yeni' ? ' new' : '')} data-gb={g.id} onClick={onOpen}>
      <Avatar m={who} size={32} />
      <span class="gb-row-m">
        <span class="gb-row-t"><TurTag k={g.kind} /><span class="gb-row-msg">{g.message}</span></span>
        <span class="sub">{who?.firstName || 'Ekip'} · {since(g.createdAt)}{g.page ? ' · ' + g.page : ''}{g.reply ? ' · yanıtlandı' : ''}</span>
      </span>
      {g.hasImage && <img class="gb-thumb" src={gorsel(g.id)} alt="" loading="lazy" />}
      <DurumTag k={g.status} />
    </button>
  );
}

export function GeriBildirimler({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const [items, setItems] = useState<GeriBildirim[] | null>(null);
  const [tur, setTur] = useState('');
  const [durum, setDurum] = useState('');
  const [openId, setOpenId] = useState<string | null>(urlId());
  const [doneOpen, setDoneOpen] = useState(false);
  const [deleting, setDeleting] = useState<GeriBildirim | null>(null);
  const load = () => api<{ items: GeriBildirim[] }>('GET', '/geri-bildirim').then((r) => setItems(r.items)).catch((e) => { snack(e.message); setItems([]); });
  useEffect(() => { load(); return onLive(['geribildirim', '*'], load); }, []);
  useEffect(() => { const f = () => { const id = urlId(); if (id) setOpenId(id); }; window.addEventListener('maya-nav', f); return () => window.removeEventListener('maya-nav', f); }, []);
  useEffect(() => { if (openId && location.search) history.replaceState({}, '', '/geri-bildirim'); }, [openId]);

  const all = items || [];
  const list = all.filter((g) => (!tur || g.kind === tur) && (!durum || g.status === durum));
  const open = list.filter((g) => OPEN.has(g.status));
  const closed = list.filter((g) => !OPEN.has(g.status));
  const count = (st: string) => all.filter((g) => g.status === st).length;
  const cur = openId ? all.find((g) => g.id === openId) : null;
  useEffect(() => { if (openId && items && !cur) { snack('Bu geri bildirim bulunamadı'); setOpenId(null); } }, [openId, items]);
  const upd = (n: GeriBildirim) => setItems((xs) => (xs || []).map((x) => (x.id === n.id ? n : x)));
  const row = (g: GeriBildirim) => <Row key={g.id} g={g} team={s.team} onOpen={() => setOpenId(g.id)} />;

  return (
    <div class="page gb-page">
      <header class="row dy-head">
        <div class="dy-head-t">
          <span class="sub">Yönetim</span>
          <h1 class="h1">Geri bildirimler</h1>
          <span class="dy-lead">Ekibin programda gördüğü hatalar, istekler ve fikirler.</span>
        </div>
        <span class="spacer" />
        <Bell onOpenTask={openTask} />
      </header>

      <div class="gb-stats">
        {DURUMLAR.map((d) => (
          <button type="button" class={'card gb-stat ' + d.id + (durum === d.id ? ' on' : '')} aria-pressed={durum === d.id} onClick={() => setDurum(durum === d.id ? '' : d.id)}>
            <span class="gb-stat-n">{count(d.id)}</span><span class="gb-stat-l">{d.label}</span>
          </button>
        ))}
      </div>

      <div class="row gb-filters">
        <div class="seg" role="radiogroup" aria-label="Tür">
          <button type="button" role="radio" aria-checked={!tur} class={!tur ? 'on' : ''} onClick={() => setTur('')}>Tümü</button>
          {TURLER.map((t) => <button type="button" role="radio" aria-checked={tur === t.id} class={tur === t.id ? 'on' : ''} onClick={() => setTur(t.id)}>{t.label}</button>)}
        </div>
        <div class="seg" role="radiogroup" aria-label="Durum">
          <button type="button" role="radio" aria-checked={!durum} class={!durum ? 'on' : ''} onClick={() => setDurum('')}>Her durum</button>
          {DURUMLAR.map((d) => <button type="button" role="radio" aria-checked={durum === d.id} class={durum === d.id ? 'on' : ''} onClick={() => setDurum(d.id)}>{d.label}</button>)}
        </div>
      </div>

      {items === null && <div class="empty">Yükleniyor…</div>}
      {items !== null && !list.length && <div class="card dy-empty"><span class="dy-empty-ic"><Icon n="mail" size={24} /></span><b>{all.length ? 'Bu filtrede geri bildirim yok' : 'Henüz geri bildirim yok'}</b><span class="sub">Ekip sol menüdeki “Geri bildirim” düğmesiyle yazınca burada görünür.</span></div>}
      {open.length > 0 && <div class="gb-list">{open.map(row)}</div>}
      {closed.length > 0 && (durum && !OPEN.has(durum) ? <div class="gb-list">{closed.map(row)}</div> : (
        <section class="dy-archive">
          <button type="button" class="dy-archive-h" aria-expanded={doneOpen} onClick={() => setDoneOpen(!doneOpen)}>
            <Ic n={doneOpen ? 'asagi' : 'saga'} size={16} /><span>Tamamlanan</span><span class="dy-archive-n">{closed.length}</span>
            <span class="sub" style="margin-left:6px">Yapıldı ya da olmayacak</span>
          </button>
          {doneOpen && <div class="gb-list">{closed.map(row)}</div>}
        </section>
      ))}

      {cur && !deleting && <Detail g={cur} team={s.team} onClose={() => setOpenId(null)} onChange={upd} onDelete={() => setDeleting(cur)} />}
      {deleting && (
        <ConfirmDelete text="Bu geri bildirim ve görseli kalıcı olarak silinecek." onClose={() => setDeleting(null)}
          onYes={async () => {
            const g = deleting; setDeleting(null);
            try { await api('DELETE', '/geri-bildirim/' + g.id); setItems((xs) => (xs || []).filter((x) => x.id !== g.id)); setOpenId(null); snack('Silindi'); }
            catch (e: any) { snack(e.message); }
          }} />
      )}
    </div>
  );
}
