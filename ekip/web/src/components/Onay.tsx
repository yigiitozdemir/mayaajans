// İçerik onay takibi: Hazırlanıyor → Onaya gönderildi → Revize istendi → Onaylandı → Paylaşıldı
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, reloadTasks, snack, store, type Task, MON, memberName } from '../api';
import { Icon, useStore } from '../ui';
import '../styles/onay.css';

export type Approval = Task['approval'];
export const APPROVAL_STEPS: { k: Approval; label: string; done: string }[] = [
  { k: '', label: 'Hazırlanıyor', done: 'Hazırlanıyor’a aldı' },
  { k: 'sent', label: 'Onaya gönderildi', done: 'Müşteriye onaya gönderdi' },
  { k: 'revision', label: 'Revize istendi', done: 'Revize istendi diye işaretledi' },
  { k: 'approved', label: 'Onaylandı', done: 'Onaylandı diye işaretledi' },
  { k: 'published', label: 'Paylaşıldı', done: 'Paylaşıldı diye işaretledi' },
];
const stepIndex = (a: Approval) => Math.max(0, APPROVAL_STEPS.findIndex((s) => s.k === a));
const utc = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z');
const LIMIT = 72 * 3600e3; // 3 gün: hatırlatma eşiği, kırmızı

/** "Onaya gönderildi"den bu yana geçen tam gün ve 3 günü geçti mi */
export function sentAge(t: Pick<Task, 'sentAt'>): { days: number; late: boolean } {
  if (!t.sentAt) return { days: 0, late: false };
  const ms = Date.now() - utc(t.sentAt);
  return { days: Math.max(0, Math.floor(ms / 864e5)), late: ms >= LIMIT };
}
export const waitingApproval = (t: Task) => t.status !== 2 && t.approval === 'sent';
export const bySentAsc = (a: Task, b: Task) => (a.sentAt || '') < (b.sentAt || '') ? -1 : (a.sentAt || '') > (b.sentAt || '') ? 1 : 0;
export function daysLabel(t: Task) { const { days } = sentAge(t); return days === 0 ? 'bugün gönderildi' : days + ' gündür'; }

/** Kart / liste etiketi: null = takipte değil */
export function approvalTag(t: Task): { label: string; cls: string; title: string } | null {
  const rev = t.revisions > 0 ? ' · revize ×' + t.revisions : '';
  if (t.approval === 'sent') {
    const a = sentAge(t);
    return { label: 'Onayda · ' + daysLabel(t), cls: a.late ? 'late' : 'sent', title: 'Müşteri onayı bekleniyor' + rev };
  }
  if (t.approval === 'revision') return { label: 'Revize ×' + Math.max(1, t.revisions), cls: 'rev', title: 'Müşteri revize istedi' };
  if (t.approval === 'approved') return { label: 'Onaylandı', cls: 'ok', title: 'Müşteri onayladı, paylaşım bekliyor' + rev };
  if (t.approval === 'published') return { label: 'Paylaşıldı', cls: 'pub', title: 'Paylaşıldı' + rev };
  return null;
}

export function ApprovalBadge({ t }: { t: Task }) {
  const tag = approvalTag(t);
  if (!tag) return null;
  return <span class={'onay-badge ' + tag.cls} title={tag.title}>{tag.label}</span>;
}

interface LogRow { id: string; step: Approval; note: string; by: string | null; at: string }
function fmtTime(at: string) {
  const d = new Date(utc(at));
  return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** İş detayındaki onay şeridi: adımlar, düğmeler, revize notu, geçmiş, geri al */
export function ApprovalStrip({ t, onStep }: { t: Task; onStep?: (k: Approval) => void }) {
  const s = useStore();
  const [log, setLog] = useState<LogRow[]>([]);
  const [revOpen, setRevOpen] = useState(false);
  const [revNote, setRevNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setRevOpen(false); setRevNote(''); setShowAll(false); }, [t.id]);
  useEffect(() => {
    let live = true;
    api<LogRow[]>('GET', '/tasks/' + t.id + '/approval').then((r) => { if (live) setLog(r); }).catch(() => {});
    return () => { live = false; };
  }, [t.id, t.updatedAt, t.approvalAt]);
  useEffect(() => { if (revOpen) setTimeout(() => noteRef.current?.focus(), 0); }, [revOpen]);

  const cur = stepIndex(t.approval);
  async function go(k: Approval, note?: string) {
    if (busy) return;
    setBusy(true);
    try {
      const row = await api<Task>('POST', '/tasks/' + t.id + '/approval', { approval: k, ...(note !== undefined ? { note } : {}) });
      store.set({ tasks: store.get().tasks.map((x) => (x.id === t.id ? row : x)) });
      setRevOpen(false); setRevNote('');
      onStep?.(k);
      const st = APPROVAL_STEPS[stepIndex(k)];
      snack(k === 'published' ? 'Paylaşıldı · iş tamamlandı' : k === 'sent' ? 'Onaya gönderildi · müşteri dönüşü bekleniyor' : st.label);
      reloadTasks().catch(() => {});
    } catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  async function undo() {
    if (busy) return;
    setBusy(true);
    try {
      const row = await api<Task>('POST', '/tasks/' + t.id + '/approval/undo');
      store.set({ tasks: store.get().tasks.map((x) => (x.id === t.id ? row : x)) });
      snack('Geri alındı · ' + APPROVAL_STEPS[stepIndex(row.approval)].label);
      reloadTasks().catch(() => {});
    } catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  const tag = approvalTag(t);
  const last = log[0];
  const shown = showAll ? log : log.slice(0, 4);
  const actions: { k: Approval; label: string; icon: string }[] = [
    { k: 'sent', label: t.approval === 'revision' ? 'Tekrar onaya gönderildi' : 'Onaya gönderildi', icon: 'mail' },
    { k: 'revision', label: 'Revize istendi', icon: 'note' },
    { k: 'approved', label: 'Onaylandı', icon: 'check' },
    { k: 'published', label: 'Paylaşıldı', icon: 'ext' },
  ];
  return (
    <section class="onay" aria-labelledby={'onay-h-' + t.id}>
      <div class="row" style="gap:8px">
        <h3 id={'onay-h-' + t.id} class="onay-h">Müşteri onayı</h3>
        {tag && <span class={'onay-badge ' + tag.cls}>{tag.label}</span>}
        <span class="spacer" />
        {last && (
          <button type="button" class="btn ghost sm" disabled={busy} onClick={undo} title={'Son adımı geri al: ' + APPROVAL_STEPS[stepIndex(last.step)].label}>
            <Icon n="x" size={13} />Geri al
          </button>
        )}
      </div>
      <ol class="onay-steps" aria-label="Onay adımları">
        {APPROVAL_STEPS.map((st, i) => {
          const skipped = st.k === 'revision' && t.revisions === 0 && i < cur;
          const cls = i === cur ? 'cur' : i < cur && !skipped ? 'done' : '';
          return (
            <li class={cls} aria-current={i === cur ? 'step' : undefined}>
              <span class="b" aria-hidden="true">{i < cur && !skipped ? <Icon n="check" size={11} w={3} /> : i + 1}</span>
              <span class="l">{st.label}{st.k === 'revision' && t.revisions > 0 ? ' ×' + t.revisions : ''}</span>
            </li>
          );
        })}
      </ol>
      <div class="onay-actions" role="group" aria-label="Onay adımını işaretle">
        {actions.map((a) => (
          <button type="button" class={'btn sm' + (t.approval === a.k ? ' on' : '')} aria-pressed={t.approval === a.k} disabled={busy || t.approval === a.k}
            onClick={() => (a.k === 'revision' ? setRevOpen(!revOpen) : go(a.k))}>
            <Icon n={a.icon} size={13} />{a.label}
          </button>
        ))}
      </div>
      {revOpen && (
        <div class="onay-rev" role="group" aria-label="Revize notu">
          <label class="field" style="gap:6px">Müşteri ne dedi? <span class="sub" style="font-weight:500">İsteğe bağlı ama yazarsan ekip neyi düzelteceğini bilir.</span>
            <textarea ref={noteRef} class="input" rows={3} maxLength={2000} value={revNote} placeholder="Örn. logo daha büyük olsun, metindeki tarih 22 Kasım olacak"
              onInput={(e) => setRevNote((e.target as HTMLTextAreaElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); go('revision', revNote); }
                if (e.key === 'Escape') { e.stopPropagation(); setRevOpen(false); }
              }} />
          </label>
          <div class="row" style="gap:8px">
            <button type="button" class="btn primary sm" disabled={busy} onClick={() => go('revision', revNote)}>Revizeyi kaydet</button>
            <button type="button" class="btn ghost sm" onClick={() => setRevOpen(false)}>Vazgeç</button>
          </div>
        </div>
      )}
      {log.length > 0 && (
        <div class="onay-log">
          <span class="onay-cap">Geçmiş</span>
          <ul>
            {shown.map((r) => (
              <li>
                <span class={'dot ' + (r.step || 'prep')} aria-hidden="true" />
                <span class="t">
                  <span><b>{r.by ? memberName(s.team, r.by) : 'Biri'}</b> · {APPROVAL_STEPS[stepIndex(r.step)].done}</span>
                  {r.note && <q class="onay-note">{r.note}</q>}
                </span>
                <time class="sub" dateTime={r.at.replace(' ', 'T') + 'Z'}>{fmtTime(r.at)}</time>
              </li>
            ))}
          </ul>
          {log.length > 4 && <button type="button" class="linkbtn sm" onClick={() => setShowAll(!showAll)}>{showAll ? 'Daha az göster' : 'Tüm geçmiş (' + log.length + ')'}</button>}
        </div>
      )}
    </section>
  );
}
