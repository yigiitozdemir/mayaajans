import { useEffect, useRef, useState } from 'preact/hooks';
import { api, reloadTasks, snack, store, type Task, fmtDate, dayDiff, DAY as SDAY, memberName } from '../api';
import { Avatar, Icon, Modal, useStore, kutla } from '../ui';
import { markTaskRead } from './Notify';
import { ClientMark } from './ClientMark';
import { ApprovalStrip } from './Onay';

export const STATUS = [
  { label: 'Beklemede', dot: 'var(--wait)' },
  { label: 'Devam ediyor', dot: 'var(--accent)' },
  { label: 'Tamamlandı', dot: 'var(--green-dot)' },
];

export function dueTag(t: Pick<Task, 'dueDate' | 'status'>): { label: string; cls: string } {
  if (!t.dueDate) return t.status === 2 ? { label: 'Tarih yok', cls: 'muted' } : { label: 'Teslim tarihi yok', cls: 'nodate' };
  if (t.status === 2) return { label: fmtDate(t.dueDate), cls: 'muted' };
  const n = dayDiff(t.dueDate);
  if (n < 0) return { label: 'Gecikti · ' + fmtDate(t.dueDate), cls: 'late' };
  if (n === 0) return { label: 'Bugün', cls: 'today' };
  if (n === 1) return { label: 'Yarın', cls: 'soon' };
  if (n <= 7) return { label: SDAY[new Date(t.dueDate + 'T00:00:00').getDay()] + ' · ' + fmtDate(t.dueDate), cls: 'soon' };
  return { label: fmtDate(t.dueDate), cls: 'far' };
}

function ClientInput({ value, onInput }: { value: string; onInput: (v: string) => void }) {
  const s = useStore();
  return (
    <>
      <input class="input" list="maya-firmalar" value={value} placeholder="Seç ya da yaz" onInput={(e) => onInput((e.target as HTMLInputElement).value)} />
      <datalist id="maya-firmalar">{s.clients.map((c) => <option value={c.name} />)}<option value="Özel Günler" /></datalist>
    </>
  );
}

function PersonSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const s = useStore();
  return (
    <select class="input" value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      <option value="">Atanmamış</option>
      {s.team.filter((m) => m.status !== 'pending' || true).map((m) => <option value={m.id}>{m.name}{m.status === 'pending' ? ' (davet bekliyor)' : ''}</option>)}
    </select>
  );
}

// ---------- yeni iş formu (Slack'teki bütün bölümler) ----------
export function NewTaskModal({ initial, onClose }: { initial?: Partial<Task>; onClose: () => void }) {
  const [f, setF] = useState({ title: initial?.title || '', client: initial?.client || '', assigneeId: initial?.assigneeId || '', dueDate: initial?.dueDate || '', status: (initial?.status ?? 0) as 0 | 1 | 2, note: '', link: '', items: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => { setF({ ...f, [k]: v }); setErr(''); };
  async function save() {
    if (!f.title.trim()) { setErr('İş başlığı boş olamaz.'); return; }
    if (!f.dueDate) { setErr('Teslim tarihi seç.'); return; }
    setBusy(true);
    try {
      await api('POST', '/tasks', { ...f, assigneeId: f.assigneeId || null, items: f.items.split('\n').map((x) => x.trim()).filter(Boolean) });
      await reloadTasks();
      const who = f.assigneeId && f.assigneeId !== store.get().me!.id ? memberName(store.get().team, f.assigneeId) : '';
      snack('İş eklendi' + (who ? ' · ' + who + ' kişisine bildirim gitti' : ''));
      onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Yeni iş" onClose={onClose} width={620}>
      <label class="field">İş *<input class={'input' + (err && !f.title.trim() ? ' err' : '')} value={f.title} autoFocus placeholder="Örn. 22 Kasım Diş Hekimleri Günü postu" onInput={(e) => set('title', (e.target as HTMLInputElement).value)} /></label>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px">
        <label class="field">Firma<ClientInput value={f.client} onInput={(v) => set('client', v)} /></label>
        <label class="field">Sorumlu<PersonSelect value={f.assigneeId} onChange={(v) => set('assigneeId', v)} /></label>
        <label class="field">Teslim tarihi *<input type="date" class={'input' + (err && !f.dueDate ? ' err' : '')} value={f.dueDate} onInput={(e) => set('dueDate', (e.target as HTMLInputElement).value)} /></label>
        <div class="field">Durum
          <div class="seg">{STATUS.map((st, i) => <button type="button" class={f.status === i ? 'on' : ''} aria-pressed={f.status === i} onClick={() => set('status', i)}><span class="dot" style={{ background: st.dot, display: 'inline-block', marginRight: '6px' }} />{st.label}</button>)}</div>
        </div>
      </div>
      <label class="field">Not<textarea class="input" rows={3} value={f.note} placeholder="Müşteri isteği, revize notu, dikkat edilecekler…" onInput={(e) => set('note', (e.target as HTMLTextAreaElement).value)} /></label>
      <label class="field">Drive linki<input type="text" inputMode="url" class="input" value={f.link} placeholder="https://drive.google.com/…" onInput={(e) => set('link', (e.target as HTMLInputElement).value)} /></label>
      <label class="field"><span>Kapsam <span style="font-weight:500;color:var(--mute2)">· isteğe bağlı, her satıra bir firma ya da kalem</span></span><textarea class="input" rows={3} value={f.items} placeholder={'Miradent (Post)\nÇavuşdent (Story)'} onInput={(e) => set('items', (e.target as HTMLTextAreaElement).value)} /></label>
      {err && <span class="errtext" role="alert">{err}</span>}
      <div class="row"><span class="spacer" /><button type="button" class="btn" onClick={onClose}>Vazgeç</button><button type="button" class="btn primary" disabled={busy} onClick={save}>İşi ekle</button></div>
    </Modal>
  );
}

// ---------- iş detayı ----------
export function TaskDrawer({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const s = useStore();
  const t = s.tasks.find((x) => x.id === taskId);
  const [confirmDel, setConfirmDel] = useState(false);
  const [note, setNote] = useState(t?.note || '');
  // tamamlanınca: bitmiş çalışmanın linki (isteğe bağlı)
  const [askLink, setAskLink] = useState(false);
  const [doneDraft, setDoneDraft] = useState('');
  const doneRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setAskLink(false); }, [taskId]);
  useEffect(() => { if (askLink) setTimeout(() => doneRef.current?.focus(), 0); }, [askLink]);
  useEffect(() => { if (t) markTaskRead(t.id); }, [taskId]);
  useEffect(() => { setNote(t?.note || ''); }, [t?.note]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (!t) return null;
  const me = s.me!;
  const canDelete = me.role === 'admin' || t.createdBy === me.id;
  const due = dueTag(t);
  async function patch(body: Partial<Task>) {
    // anında ekranda göster, sonra sunucuya yaz
    store.set({ tasks: store.get().tasks.map((x) => (x.id === t!.id ? { ...x, ...body } : x)) });
    try { await api('PATCH', '/tasks/' + t!.id, body); await reloadTasks(); }
    catch (e: any) { snack(e.message); reloadTasks(); }
  }
  function setStatus(i: 0 | 1 | 2, el?: EventTarget | null) {
    if (i === t!.status) return;
    patch({ status: i });
    if (i === 2) kutla(el);
    if (i === 2) { setDoneDraft(t!.doneLink || ''); setAskLink(true); } else setAskLink(false);
  }
  async function saveDoneLink() {
    const v = doneDraft.trim();
    try {
      await api('PATCH', '/tasks/' + t!.id, { doneLink: v });
      await reloadTasks(); setAskLink(false);
      snack(v ? 'Teslim linki kaydedildi' : 'Teslim linki kaldırıldı');
    } catch (e: any) { snack(e.message); }
  }
  async function copyDone() {
    try { await navigator.clipboard.writeText(t!.doneLink); snack('Teslim linki kopyalandı'); } catch { snack('Kopyalanamadı'); }
  }
  async function del() {
    if (!confirmDel) { setConfirmDel(true); return; }
    try { await api('DELETE', '/tasks/' + t!.id); await reloadTasks(); snack('İş silindi'); onClose(); } catch (e: any) { snack(e.message); }
  }
  return (
    <div class="drawer-wrap">
      <button type="button" class="scrim" aria-label="Detayı kapat" onClick={onClose} />
      <aside class="drawer" role="dialog" aria-label="İş detayı">
        <div class="row">
          <span class="chip"><ClientMark name={t.client} size={18} />{t.client || 'Firma yok'}</span>
          {t.source === 'slack' && <span class="chip">Slack'ten aktarıldı</span>}
          <span class="spacer" />
          <button type="button" class="iconbtn" aria-label="Kapat" onClick={onClose}><Icon n="x" size={16} /></button>
        </div>
        <h2 style="margin:0;font-family:var(--display);font-size:22px;line-height:1.3">{t.title}</h2>
        <div class="seg" role="group" aria-label="Durum">
          {STATUS.map((st, i) => (
            <button type="button" style="flex:1" class={t.status === i ? 'on' : ''} aria-pressed={t.status === i} onClick={(e) => setStatus(i as 0 | 1 | 2, e.currentTarget)}>
              <span class="dot" style={{ background: st.dot, display: 'inline-block', marginRight: '6px' }} />{st.label}
            </button>
          ))}
        </div>
        {t.status === 2 && askLink && (
          <div class="donelink ask" role="group" aria-label="Teslim linki">
            <strong style="font-size:14px"><Icon n="check" size={15} /> İş tamamlandı</strong>
            <span class="sub">Bitmiş çalışmanın Drive linkini yapıştır, ekip buradan kopyalayabilsin. <b>İsteğe bağlı.</b></span>
            <input ref={doneRef} class="input" type="text" inputMode="url" aria-label="Bitmiş çalışmanın Drive linki" placeholder="https://drive.google.com/…"
              value={doneDraft} onInput={(e) => setDoneDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveDoneLink(); } if (e.key === 'Escape') { e.stopPropagation(); setAskLink(false); } }} />
            <div class="row" style="gap:8px">
              <button type="button" class="btn primary sm" onClick={saveDoneLink}>Linki kaydet</button>
              <button type="button" class="btn ghost sm" onClick={() => setAskLink(false)}>Şimdilik geç</button>
            </div>
          </div>
        )}
        {t.status === 2 && !askLink && (
          <div class="donelink">
            <span class="sub" style="font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:11px">Teslim linki</span>
            {t.doneLink ? (
              <div class="row" style="gap:8px;flex-wrap:nowrap">
                <a href={t.doneLink} target="_blank" rel="noopener noreferrer" class="donelink-url" title={t.doneLink}>{t.doneLink.replace(/^https?:\/\/(www\.)?/, '')}</a>
                <button type="button" class="btn primary sm" onClick={copyDone}><Icon n="copy" size={14} />Kopyala</button>
                <a class="btn sm" style="text-decoration:none" href={t.doneLink} target="_blank" rel="noopener noreferrer"><Icon n="ext" size={14} />Aç</a>
                <button type="button" class="iconbtn" style="width:32px;height:32px" aria-label="Teslim linkini değiştir" title="Değiştir" onClick={() => { setDoneDraft(t.doneLink); setAskLink(true); }}><Icon n="link" size={14} /></button>
              </div>
            ) : (
              <button type="button" class="btn sm" style="align-self:flex-start" onClick={() => { setDoneDraft(''); setAskLink(true); }}><Icon n="plus" size={14} />Teslim linki ekle</button>
            )}
          </div>
        )}
        <ApprovalStrip t={t} onStep={(k) => { if (k === 'published' && !t.doneLink) { setDoneDraft(''); setAskLink(true); } else if (k !== 'published') setAskLink(false); }} />
        <dl style="margin:0;display:grid;grid-template-columns:110px 1fr;gap:12px;align-items:center;font-size:13px">
          <dt style="color:var(--mute2)">Sorumlu</dt>
          <dd style="margin:0" class="row"><Avatar m={s.team.find((m) => m.id === t.assigneeId)} size={24} />
            <select class="input" style="height:36px;flex:1" value={t.assigneeId || ''} onChange={(e) => patch({ assigneeId: (e.target as HTMLSelectElement).value || null })}>
              <option value="">Atanmamış</option>{s.team.map((m) => <option value={m.id}>{m.name}</option>)}
            </select>
          </dd>
          <dt style="color:var(--mute2)">Teslim</dt>
          <dd style="margin:0" class="row"><span class={'tag ' + due.cls}>{due.label}</span>
            <input type="date" class="input" style="height:36px;width:auto" aria-label="Teslim tarihini değiştir" value={t.dueDate || ''} onChange={(e) => { const v = (e.target as HTMLInputElement).value; if (v) patch({ dueDate: v }); }} />
          </dd>
          <dt style="color:var(--mute2)">Ekleyen</dt><dd style="margin:0">{t.createdBy ? memberName(s.team, t.createdBy) : 'Slack listesi'}</dd>
        </dl>
        {t.items.length > 0 && (
          <div style="display:flex;flex-direction:column;gap:6px">
            <h3 class="sub" style="margin:0;font-weight:600;text-transform:uppercase;letter-spacing:.06em;font-size:12px">Kapsam</h3>
            {t.items.map((it) => <div style="padding:9px 12px;border-radius:10px;background:var(--chip);font-size:13px">{it}</div>)}
          </div>
        )}
        <label class="field">Not
          <textarea class="input" rows={4} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} onBlur={() => { if (note !== t.note) patch({ note }); }} />
        </label>
        <div class="row" style="margin-top:auto">
          {t.link && <a class="btn primary" href={t.link} target="_blank" rel="noopener"><Icon n="ext" size={15} />{t.link.includes('drive.google.com') ? "Drive'da aç" : 'Linki aç'}</a>}
          <span class="spacer" />
          {canDelete && <button type="button" class={'btn danger' + (confirmDel ? ' confirm' : '')} onClick={del}>{confirmDel ? 'Emin misin? Sil' : 'İşi sil'}</button>}
        </div>
      </aside>
    </div>
  );
}
