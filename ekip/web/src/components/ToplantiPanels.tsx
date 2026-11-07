// Toplantılar: ortak tipler, form, detay paneli (gündem · notlar · kararlar · aksiyonlar · ses kaydı · dosyalar), takvim
import { useEffect, useRef, useState } from 'preact/hooks';
import { api, snack, store, todayIso, parseD, MON, LMON, LDAY, DAY, memberName, reloadTasks, type Task } from '../api';
import { Avatar, Icon, Modal, useStore } from '../ui';
import { ClientMark } from './ClientMark';
import { CrewStack, whenLabel } from './CekimPanels';

// ---------- tipler ----------
export type MType = 'yuzyuze' | 'online' | 'telefon';
export type MStatus = 'planlandi' | 'yapildi' | 'ertelendi' | 'iptal';
export interface AgendaItem { text: string; done: boolean }
export interface MAction { id: string; text: string; assigneeId: string | null; dueDate: string | null; done: boolean; taskId: string | null; createdBy: string | null; createdAt: string }
export interface MFile { id: string; kind: 'ses' | 'dosya'; name: string; contentType: string; size: number; durationS: number | null; createdBy: string | null; createdAt: string; url: string }
export interface Meeting {
  id: string; title: string; client: string; date: string; startTime: string; endTime: string; type: MType;
  location: string; link: string; participants: string[]; clientAttendees: string; agenda: AgendaItem[];
  status: MStatus; notes: string; decisions: string[]; remindedFor: string | null; createdBy: string | null;
  createdAt: string; updatedAt: string; actions: MAction[]; files: MFile[];
}

export const TYPES: { k: MType; label: string; icon: string }[] = [
  { k: 'yuzyuze', label: 'Yüz yüze', icon: 'toplanti' },
  { k: 'online', label: 'Online', icon: 'cam' },
  { k: 'telefon', label: 'Telefon', icon: 'phone' },
];
export const TYPE: Record<MType, { label: string; icon: string }> = Object.fromEntries(TYPES.map((t) => [t.k, t])) as any;
export const STATUSES: { k: MStatus; label: string }[] = [
  { k: 'planlandi', label: 'Planlandı' }, { k: 'yapildi', label: 'Yapıldı' }, { k: 'ertelendi', label: 'Ertelendi' }, { k: 'iptal', label: 'İptal' },
];
export const STATUS: Record<MStatus, string> = Object.fromEntries(STATUSES.map((s) => [s.k, s.label])) as any;
export const REMIND_INFO = 'Toplantıdan 30 dakika önce katılımcılara bildirim gider. Toplantılar kişisel takvim aboneliğinde de görünür.';
export const MAX_AUDIO = 95 * 1024 * 1024;
export const MAX_DOC = 25 * 1024 * 1024;

// ---------- yardımcılar ----------
export const lower = (s: string) => (s || '').toLocaleLowerCase('tr');
export const longDate = (s: string) => { const d = parseD(s); return d.getDate() + ' ' + LMON[d.getMonth()] + ' ' + LDAY[d.getDay()]; };
export const shortDate = (s: string) => { const d = parseD(s); return d.getDate() + ' ' + MON[d.getMonth()]; };
export const startMs = (m: Pick<Meeting, 'date' | 'startTime'>) => Date.parse(m.date + 'T' + m.startTime + ':00+03:00');
export const endMs = (m: Pick<Meeting, 'date' | 'startTime' | 'endTime'>) => (m.endTime ? Date.parse(m.date + 'T' + m.endTime + ':00+03:00') : startMs(m) + 60 * 60_000);
/** Saati geçmiş ama hâlâ "Planlandı": notları eklemeye çağır */
export const needsNotes = (m: Meeting, now = Date.now()) => m.status === 'planlandi' && endMs(m) < now;
export const isPast = (m: Meeting, now = Date.now()) => endMs(m) < now;
export const byWhen = (a: Meeting, b: Meeting) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0);
export const timeRange = (m: Pick<Meeting, 'startTime' | 'endTime'>) => m.startTime + (m.endTime ? '–' + m.endTime : '');
export function fmtSize(n: number) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  return (n / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
}
export function fmtDur(s: number | null | undefined) {
  if (s === null || s === undefined || !isFinite(s)) return '';
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(x).padStart(2, '0');
}
/** Sunucu zamanı (UTC 'YYYY-MM-DD HH:MM:SS') → "7 Kas 14:05" (yerel) */
export function localStamp(sqlUtc: string) {
  const d = new Date(Date.parse(sqlUtc.slice(0, 19).replace(' ', 'T') + 'Z'));
  if (isNaN(d.getTime())) return '';
  return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
export function hostOf(link: string) { try { return new URL(link).host.replace(/^www\./, ''); } catch { return link; } }
const canDelete = (createdBy: string | null) => { const me = store.get().me!; return me.role === 'admin' || createdBy === me.id; };
/** Kart ve takvim için kısa özet: notlar / kararlar / aksiyonlar / ses */
export function counts(m: Meeting) {
  return {
    notes: !!m.notes.trim(), decisions: m.decisions.length, actions: m.actions.length, open: m.actions.filter((a) => !a.done).length,
    audio: m.files.filter((f) => f.kind === 'ses').length, docs: m.files.filter((f) => f.kind === 'dosya').length,
  };
}

/** Dosyayı (ses / belge) ham gövdeyle yükler; ilerleme bildirir. */
export function uploadFile(meetingId: string, kind: 'ses' | 'dosya', blob: Blob, name: string, sure: number | null, onProgress?: (p: number) => void): Promise<MFile> {
  return new Promise((res, rej) => {
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams({ kind, name });
    if (sure) q.set('sure', String(Math.round(sure)));
    xhr.open('POST', `/api/toplantilar/${meetingId}/files?` + q.toString());
    xhr.setRequestHeader('Content-Type', blob.type || (kind === 'ses' ? 'audio/webm' : 'application/octet-stream'));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let d: any = null; try { d = JSON.parse(xhr.responseText); } catch { /* */ }
      if (xhr.status >= 200 && xhr.status < 300) res(d); else rej(new Error((d && d.error) || 'Yüklenemedi'));
    };
    xhr.onerror = () => rej(new Error('Bağlantı hatası · yüklenemedi'));
    xhr.send(blob);
  });
}

// ---------- küçük parçalar ----------
export function StatusTag({ m, now }: { m: Meeting; now?: number }) {
  if (needsNotes(m, now)) return <span class="tp-st late">Notları bekliyor</span>;
  return <span class={'tp-st ' + m.status}>{STATUS[m.status]}</span>;
}
export function TypeLine({ m, withPlace = true }: { m: Meeting; withPlace?: boolean }) {
  const t = TYPE[m.type];
  const place = m.type === 'online' ? (m.link ? hostOf(m.link) : '') : m.location;
  return <span class="tp-type"><Icon n={t.icon} size={13} />{t.label}{withPlace && place ? <span class="tp-place"> · {place}</span> : null}</span>;
}

function PeoplePicker({ value, onToggle }: { value: string[]; onToggle: (id: string) => void }) {
  const s = useStore();
  return (
    <div class="ck-chips" role="group" aria-label="Ekipten katılımcılar">
      {s.team.map((m) => {
        const on = value.includes(m.id);
        return (
          <button type="button" class="ck-chip" aria-pressed={on} onClick={() => onToggle(m.id)}>
            <Avatar m={m} size={24} radius={99} />{m.firstName}{m.id === s.me?.id ? ' (ben)' : ''}
          </button>
        );
      })}
    </div>
  );
}

/** Basit madde listesi düzenleyici (gündem / kararlar) */
function ItemList({ items, onChange, placeholder, checkable, label, empty, max }: {
  items: AgendaItem[]; onChange: (next: AgendaItem[]) => void; placeholder: string; checkable?: boolean; label: string; empty: string; max: number;
}) {
  const [draft, setDraft] = useState('');
  const [edit, setEdit] = useState<{ i: number; v: string } | null>(null);
  const add = () => { const v = draft.trim(); if (!v) return; if (items.length >= max) { snack('En fazla ' + max + ' madde eklenebilir'); return; } onChange([...items, { text: v, done: false }]); setDraft(''); };
  const commit = () => { if (!edit) return; const v = edit.v.trim(); setEdit(null); if (v && v !== items[edit.i]?.text) onChange(items.map((x, j) => (j === edit.i ? { ...x, text: v } : x))); };
  return (
    <div class="tp-items">
      {items.map((x, i) => {
        const id = 'tpi-' + label.length + '-' + i;
        return (
          <div class={'ck-check tp-item' + (x.done ? ' done' : '')}>
            {checkable ? <input type="checkbox" id={id} checked={x.done} onChange={() => onChange(items.map((y, j) => (j === i ? { ...y, done: !y.done } : y)))} aria-label={x.text + ' tamamlandı'} />
              : <span class="tp-num" aria-hidden="true">{i + 1}</span>}
            {edit?.i === i ? (
              <input class="input tp-inline" value={edit.v} maxLength={500} autoFocus aria-label="Maddeyi düzenle"
                onInput={(e) => setEdit({ i, v: (e.target as HTMLInputElement).value })} onBlur={commit}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } if (e.key === 'Escape') { e.stopPropagation(); setEdit(null); } }} />
            ) : checkable ? <label for={id}>{x.text}</label> : <span class="tp-itx">{x.text}</span>}
            {edit?.i !== i && <button type="button" class="x tp-ed" aria-label={x.text + ' maddesini düzenle'} onClick={() => setEdit({ i, v: x.text })}><Icon n="edit" size={14} /></button>}
            <button type="button" class="x" aria-label={x.text + ' maddesini sil'} onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
          </div>
        );
      })}
      {items.length === 0 && <p class="tp-empty">{empty}</p>}
      <div class="ck-add">
        <label style="flex:1;display:flex"><span class="sr">{label}</span>
          <input class="input" value={draft} placeholder={placeholder} maxLength={500}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(); } }} />
        </label>
        <button type="button" class="btn sm" style="min-height:38px" onClick={add}>Ekle</button>
      </div>
    </div>
  );
}

// ---------- ekle / düzenle ----------
export function MeetingForm({ initial, firms, onClose, onSaved }: { initial: Partial<Meeting>; firms: string[]; onClose: () => void; onSaved: (m: Meeting) => void }) {
  const isEdit = !!initial.id;
  const [f, setF] = useState({
    title: initial.title || '', client: initial.client || '', date: initial.date || '', startTime: initial.startTime || '',
    endTime: initial.endTime || '', type: (initial.type || 'yuzyuze') as MType, location: initial.location || '', link: initial.link || '',
    participants: initial.participants || [], clientAttendees: initial.clientAttendees || '', agenda: initial.agenda || [],
    status: (initial.status || 'planlandi') as MStatus,
  });
  const [err, setErr] = useState<{ k: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setErr(null); };

  async function save() {
    if (busy) return;
    if (!f.title.trim()) { setErr({ k: 'title', msg: 'Toplantı başlığını yaz.' }); return; }
    if (!f.date) { setErr({ k: 'date', msg: 'Toplantı tarihi seç.' }); return; }
    if (!f.startTime) { setErr({ k: 'start', msg: 'Başlangıç saatini seç.' }); return; }
    if (f.endTime && f.endTime <= f.startTime) { setErr({ k: 'end', msg: 'Bitiş saati başlangıçtan sonra olmalı.' }); return; }
    setBusy(true);
    try {
      const body = { ...f, title: f.title.trim(), link: f.type === 'online' ? f.link : '', location: f.type === 'online' ? '' : f.location };
      const m = isEdit ? await api<Meeting>('PATCH', '/toplantilar/' + initial.id, body) : await api<Meeting>('POST', '/toplantilar', body);
      const me = store.get().me!.id;
      const added = f.participants.filter((x) => x !== me && !(initial.participants || []).includes(x));
      snack((isEdit ? 'Toplantı kaydedildi' : 'Toplantı eklendi') + (added.length ? ' · ' + added.map((x) => memberName(store.get().team, x).split(' ')[0]).join(', ') + ' kişisine bildirim gitti' : ''));
      onSaved(m);
    } catch (e: any) { setErr({ k: /bağlantı|link/i.test(e.message) ? 'link' : 'x', msg: e.message }); } finally { setBusy(false); }
  }
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && t.tagName === 'INPUT' && !['checkbox', 'date', 'time'].includes((t as HTMLInputElement).type) && !t.closest('.ck-add') && !t.closest('.tp-items')) { e.preventDefault(); save(); }
  };
  const bad = (k: string) => (err?.k === k ? ' err' : '');

  return (
    <Modal title={isEdit ? 'Toplantıyı düzenle' : 'Yeni toplantı'} onClose={onClose} width={660}>
      <div class="tp-form" onKeyDown={onKey}>
        <label class="field">Toplantı başlığı *
          <input class={'input' + bad('title')} value={f.title} autoFocus maxLength={200} placeholder="Örn. Aralık içerik planı sunumu" onInput={(e) => set({ title: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field">Firma
          <span class="tp-firm">
            {f.client && <ClientMark name={f.client} size={22} />}
            <input class="input" list="toplanti-firmalar" value={f.client} maxLength={120} placeholder="Seç ya da yaz" onInput={(e) => set({ client: (e.target as HTMLInputElement).value })} />
          </span>
          <datalist id="toplanti-firmalar">{firms.map((x) => <option value={x} />)}</datalist>
        </label>
        <div class="tp-when">
          <label class="field"><span>Tarih * {f.date && <span class="tp-hint">· {LDAY[parseD(f.date).getDay()]}</span>}</span>
            <input type="date" required class={'input' + bad('date')} value={f.date} onInput={(e) => set({ date: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="field">Başlangıç *
            <input type="time" required step={300} class={'input' + bad('start')} value={f.startTime} onInput={(e) => set({ startTime: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="field">Bitiş
            <input type="time" step={300} class={'input' + bad('end')} value={f.endTime} onInput={(e) => set({ endTime: (e.target as HTMLInputElement).value })} />
          </label>
        </div>
        <div class="field">Toplantı türü
          <div class="seg tp-typeseg" role="group" aria-label="Toplantı türü">
            {TYPES.map((t) => <button type="button" class={f.type === t.k ? 'on' : ''} aria-pressed={f.type === t.k} onClick={() => set({ type: t.k })}><Icon n={t.icon} size={15} />{t.label}</button>)}
          </div>
        </div>
        {f.type === 'online' ? (
          <label class="field">Toplantı bağlantısı
            <input class={'input' + bad('link')} inputMode="url" value={f.link} maxLength={800} placeholder="https://meet.google.com/… ya da Zoom / Teams bağlantısı" onInput={(e) => set({ link: (e.target as HTMLInputElement).value })} />
          </label>
        ) : (
          <label class="field">{f.type === 'telefon' ? 'Arama bilgisi' : 'Yer'}
            <input class="input" value={f.location} maxLength={200} placeholder={f.type === 'telefon' ? 'Örn. Klinik müdürü arayacak' : 'Örn. Firma ofisi, Maya Ajans toplantı odası'} onInput={(e) => set({ location: (e.target as HTMLInputElement).value })} />
          </label>
        )}
        <div class="field"><span>Ekipten katılımcılar <span class="tp-hint">· eklenenlere bildirim ve 30 dk önce hatırlatma gider</span></span>
          <PeoplePicker value={f.participants} onToggle={(id) => set({ participants: f.participants.includes(id) ? f.participants.filter((x) => x !== id) : [...f.participants, id] })} />
        </div>
        <label class="field">Firma tarafından katılanlar
          <input class="input" value={f.clientAttendees} maxLength={500} placeholder="Örn. Dr. Ayşe Arslan (klinik sahibi), Mert Bey (pazarlama)" onInput={(e) => set({ clientAttendees: (e.target as HTMLInputElement).value })} />
        </label>
        <div class="field">Gündem
          <ItemList items={f.agenda} onChange={(agenda) => set({ agenda })} placeholder="Gündem maddesi ekle (Enter)" label="Gündem maddesi ekle" empty="Henüz gündem maddesi yok." max={30} />
        </div>
        {isEdit && (
          <div class="field">Durum
            <div class="seg" role="group" aria-label="Durum">
              {STATUSES.map((st) => <button type="button" style="flex:1" class={f.status === st.k ? 'on' : ''} aria-pressed={f.status === st.k} onClick={() => set({ status: st.k })}><span class={'dot tp-dot ' + st.k} />{st.label}</button>)}
            </div>
          </div>
        )}
        {err && <span class="errtext" role="alert">{err.msg}</span>}
        <div class="row"><span class="spacer" />
          <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
          <button type="button" class="btn primary" disabled={busy} onClick={save}>{isEdit ? 'Kaydet' : 'Toplantıyı ekle'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- notlar (otomatik kayıt) ----------
function NotesEditor({ m, onSaved }: { m: Meeting; onSaved: (m: Meeting) => void }) {
  const [val, setVal] = useState(m.notes);
  const [st, setSt] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [at, setAt] = useState<string | null>(null);
  const dirty = useRef(false); const timer = useRef<any>(null); const cur = useRef(val); cur.current = val;
  const idRef = useRef(m.id);
  // başkası değiştirdiyse ve burada yazılmıyorsa güncelle
  useEffect(() => { if (!dirty.current) setVal(m.notes); }, [m.notes]);
  async function flush() {
    clearTimeout(timer.current);
    if (!dirty.current) return;
    const text = cur.current; dirty.current = false; setSt('saving');
    try {
      const r = await api<Meeting>('PATCH', '/toplantilar/' + idRef.current, { notes: text });
      if (!dirty.current) setSt('saved');
      const d = new Date(); setAt(String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'));
      onSaved(r);
    } catch (e: any) { dirty.current = true; setSt('error'); snack(e.message); timer.current = setTimeout(flush, 5000); }
  }
  useEffect(() => () => { flush(); }, []); // kapatırken yazılanı kaydet
  const label = { saved: m.notes || at ? 'Kaydedildi' + (at ? ' · ' + at : '') : 'Yazdıkça kaydedilir', dirty: 'Yazılıyor…', saving: 'Kaydediliyor…', error: 'Kaydedilemedi · tekrar denenecek' }[st];
  const words = val.trim() ? val.trim().split(/\s+/).length : 0;
  return (
    <div class="tp-notes">
      <textarea class="input" rows={12} value={val} maxLength={20000} aria-label="Toplantı notları"
        placeholder={'Toplantıda neler konuşuldu?\n\n• Müşterinin talepleri\n• Geri bildirimler\n• Bütçe / takvim\n• Sonraki adımlar'}
        onInput={(e) => { setVal((e.target as HTMLTextAreaElement).value); dirty.current = true; setSt('dirty'); clearTimeout(timer.current); timer.current = setTimeout(flush, 1200); }}
        onBlur={flush} />
      <div class="tp-notes-f"><span class={'tp-save ' + st} role="status">{st === 'saved' && <Icon n="check" size={13} w={2.6} />}{label}</span><span class="spacer" /><span class="sub">{words} kelime</span></div>
    </div>
  );
}

// ---------- aksiyon maddeleri ----------
function Actions({ m, onChanged, openTask }: { m: Meeting; onChanged: (m: Meeting) => void; openTask: (id: string) => void }) {
  const s = useStore();
  const [text, setText] = useState(''); const [who, setWho] = useState(''); const [due, setDue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const call = async (method: string, path: string, body?: unknown) => {
    try { const r = await api<Meeting>(method, `/toplantilar/${m.id}/actions` + path, body); onChanged(r); return r; } catch (e: any) { snack(e.message); return null; }
  };
  async function add() {
    const t = text.trim(); if (!t) return;
    const r = await call('POST', '', { text: t, assigneeId: who || null, dueDate: due || null });
    if (r) { setText(''); setDue(''); }
  }
  async function toTask(a: MAction, el: HTMLElement) {
    if (!a.dueDate) {
      snack("İş Planı'na eklemek için önce teslim tarihi seç");
      (el.closest('.tp-act')?.querySelector('input[type=date]') as HTMLInputElement | null)?.focus();
      return;
    }
    setBusy(a.id);
    try {
      const task = await api<Task>('POST', '/tasks', {
        title: a.text, client: m.client, assigneeId: a.assigneeId, dueDate: a.dueDate,
        note: 'Toplantıdan: ' + m.title + ' · ' + longDate(m.date) + ' ' + m.startTime,
        link: location.origin + '/toplantilar?id=' + m.id,
      });
      await call('PATCH', '/' + a.id, { taskId: task.id });
      reloadTasks().catch(() => {});
      snack("İş Planı'na eklendi" + (a.assigneeId && a.assigneeId !== s.me?.id ? ' · ' + memberName(s.team, a.assigneeId).split(' ')[0] + ' kişisine bildirim gitti' : ''));
    } catch (e: any) { snack(e.message); } finally { setBusy(null); }
  }
  const taskOf = (id: string | null) => (id ? s.tasks.find((t) => t.id === id) : null);
  const done = m.actions.filter((a) => a.done).length;
  return (
    <div class="tp-acts">
      {m.actions.length > 0 && (
        <div class="row" style="gap:10px"><div class="ck-prog" style="flex:1" aria-hidden="true"><i style={{ width: Math.round((done / m.actions.length) * 100) + '%' }} /></div><span class="sub">{done}/{m.actions.length} tamamlandı</span></div>
      )}
      {m.actions.map((a) => {
        const t = taskOf(a.taskId);
        const id = 'tpa-' + a.id;
        return (
          <div class={'tp-act' + (a.done ? ' done' : '')}>
            <div class="tp-act-top">
              <input type="checkbox" id={id} checked={a.done} onChange={() => call('PATCH', '/' + a.id, { done: !a.done })} />
              <label for={id} class="tp-act-t">{a.text}</label>
              <button type="button" class="x" aria-label={a.text + ' maddesini sil'} onClick={() => call('DELETE', '/' + a.id)}>×</button>
            </div>
            <div class="tp-act-m">
              <label class="tp-mini"><span class="sr">Sorumlu</span>
                {a.assigneeId && <Avatar m={s.team.find((x) => x.id === a.assigneeId)} size={20} radius={99} presence={false} />}
                <select value={a.assigneeId || ''} aria-label={a.text + ' sorumlusu'} onChange={(e) => call('PATCH', '/' + a.id, { assigneeId: (e.target as HTMLSelectElement).value || null })}>
                  <option value="">Sorumlu yok</option>{s.team.map((x) => <option value={x.id}>{x.name}</option>)}
                </select>
              </label>
              <label class="tp-mini"><span class="sr">Teslim tarihi</span><Icon n="cal" size={13} />
                <input type="date" value={a.dueDate || ''} aria-label={a.text + ' teslim tarihi'} onChange={(e) => call('PATCH', '/' + a.id, { dueDate: (e.target as HTMLInputElement).value || null })} />
              </label>
              <span class="spacer" />
              {a.taskId ? (
                <button type="button" class="tp-tasklink" onClick={() => openTask(a.taskId!)}>
                  <Icon n="board" size={13} />{t ? (t.status === 2 ? "İş Planı'nda · Tamamlandı" : t.status === 1 ? "İş Planı'nda · Devam ediyor" : "İş Planı'nda · Beklemede") : "İş Planı'nda"}
                </button>
              ) : (
                <button type="button" class="btn sm tp-totask" disabled={busy === a.id} onClick={(e) => toTask(a, e.currentTarget as HTMLElement)}><Icon n="plus" size={13} w={2.4} />İş Planı'na ekle</button>
              )}
            </div>
          </div>
        );
      })}
      {m.actions.length === 0 && <p class="tp-empty">Toplantıdan çıkan yapılacakları buraya ekle; tek tıkla İş Planı'na iş olarak aktarılır.</p>}
      <div class="tp-act-add">
        <label style="flex:2 1 220px;display:flex"><span class="sr">Aksiyon maddesi</span>
          <input class="input" value={text} maxLength={300} placeholder="Aksiyon maddesi (Enter)" onInput={(e) => setText((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} />
        </label>
        <label style="flex:1 1 140px;display:flex"><span class="sr">Sorumlu</span>
          <select class="input" value={who} onChange={(e) => setWho((e.target as HTMLSelectElement).value)}>
            <option value="">Sorumlu (isteğe bağlı)</option>{s.team.map((x) => <option value={x.id}>{x.name}</option>)}
          </select>
        </label>
        <label style="flex:1 1 140px;display:flex"><span class="sr">Teslim tarihi</span>
          <input class="input" type="date" value={due} onInput={(e) => setDue((e.target as HTMLInputElement).value)} />
        </label>
        <button type="button" class="btn sm" style="min-height:42px" onClick={add}>Ekle</button>
      </div>
    </div>
  );
}

// ---------- ses kaydı ----------
const MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];
export function pickMime(): string {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  return MIMES.find((x) => { try { return MediaRecorder.isTypeSupported(x); } catch { return false; } }) || '';
}
const recName = () => { const d = new Date(); return 'Toplantı kaydı · ' + d.getDate() + ' ' + MON[d.getMonth()] + ' ' + String(d.getHours()).padStart(2, '0') + '.' + String(d.getMinutes()).padStart(2, '0'); };

type RecState = 'idle' | 'izin' | 'kayit' | 'duraklat' | 'yukle' | 'hata';
function Recorder({ m, onUploaded, busyRef }: { m: Meeting; onUploaded: () => void; busyRef: { current: boolean } }) {
  const [st, setSt] = useState<RecState>('idle');
  const [sec, setSec] = useState(0);
  const [prog, setProg] = useState(0);
  const [failed, setFailed] = useState<{ blob: Blob; name: string; sure: number } | null>(null);
  const R = useRef<{ rec?: MediaRecorder; stream?: MediaStream; chunks: Blob[]; bytes: number; ctx?: AudioContext; raf?: number; tick?: any; t0: number; acc: number; mime: string }>({ chunks: [], bytes: 0, t0: 0, acc: 0, mime: '' });
  const meter = useRef<HTMLDivElement>(null);
  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined';
  busyRef.current = st === 'kayit' || st === 'duraklat' || st === 'yukle' || st === 'izin';

  const elapsed = () => R.current.acc + (R.current.t0 ? (performance.now() - R.current.t0) / 1000 : 0);
  function cleanup() {
    const x = R.current;
    clearInterval(x.tick); if (x.raf) cancelAnimationFrame(x.raf);
    x.stream?.getTracks().forEach((t) => t.stop());
    x.ctx?.close().catch(() => {});
    x.stream = undefined; x.ctx = undefined;
  }
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (busyRef.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => { window.removeEventListener('beforeunload', warn); try { if (R.current.rec?.state !== 'inactive') R.current.rec?.stop(); } catch { /* */ } cleanup(); };
  }, []);

  async function upload(blob: Blob, name: string, sure: number) {
    setSt('yukle'); setProg(0); setFailed(null);
    try {
      await uploadFile(m.id, 'ses', blob, name, sure, setProg);
      setSt('idle'); setSec(0); snack('Ses kaydı kaydedildi'); onUploaded();
    } catch (e: any) { setSt('hata'); setFailed({ blob, name, sure }); snack(e.message); }
  }

  async function start() {
    if (!supported) { snack('Bu tarayıcı kayıt yapamıyor — ses dosyası yükleyebilirsin'); return; }
    setSt('izin');
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e: any) {
      setSt('idle');
      snack(e?.name === 'NotAllowedError' || e?.name === 'SecurityError' ? 'Mikrofon izni verilmedi · tarayıcı / uygulama ayarlarından mikrofona izin ver' : e?.name === 'NotFoundError' ? 'Mikrofon bulunamadı' : 'Mikrofon açılamadı');
      return;
    }
    const mime = pickMime();
    let rec: MediaRecorder;
    try { rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 64000 } : undefined); }
    catch { rec = new MediaRecorder(stream); }
    const x = R.current;
    Object.assign(x, { rec, stream, chunks: [], bytes: 0, acc: 0, t0: performance.now(), mime: rec.mimeType || mime });
    rec.ondataavailable = (e) => {
      if (!e.data || !e.data.size) return;
      x.chunks.push(e.data); x.bytes += e.data.size;
      if (x.bytes > MAX_AUDIO - 2 * 1024 * 1024 && rec.state !== 'inactive') { snack('Kayıt 95 MB sınırına ulaştı, durduruldu'); stop(); }
    };
    rec.onstop = () => {
      const sure = elapsed(); x.t0 = 0; x.acc = sure;
      cleanup();
      const blob = new Blob(x.chunks, { type: (x.mime || 'audio/webm').split(';')[0] });
      x.chunks = [];
      if (blob.size < 200) { setSt('idle'); setSec(0); snack('Kayıt boş görünüyor · tekrar dene'); return; }
      upload(blob, recName(), sure);
    };
    rec.start(1000);
    setSt('kayit'); setSec(0);
    x.tick = setInterval(() => setSec(elapsed()), 250);
    // ses seviyesi göstergesi
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new AC(); x.ctx = ctx;
      const an = ctx.createAnalyser(); an.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let smooth = 0;
      const loop = () => {
        an.getByteTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const lv = Math.min(1, Math.sqrt(sum / buf.length) * 4);
        smooth = smooth * 0.7 + lv * 0.3;
        meter.current?.style.setProperty('--lv', (rec.state === 'paused' ? 0 : smooth).toFixed(3));
        x.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch { /* gösterge olmadan da kaydeder */ }
  }
  function pause() {
    const x = R.current; if (!x.rec || x.rec.state !== 'recording') return;
    try { x.rec.pause(); } catch { return; }
    x.acc = elapsed(); x.t0 = 0; setSt('duraklat');
  }
  function resume() {
    const x = R.current; if (!x.rec || x.rec.state !== 'paused') return;
    x.rec.resume(); x.t0 = performance.now(); setSt('kayit');
  }
  function stop() {
    const x = R.current; if (!x.rec || x.rec.state === 'inactive') return;
    try { x.rec.requestData(); } catch { /* */ }
    x.rec.stop();
  }
  function saveLocal() {
    if (!failed) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(failed.blob); a.download = failed.name.replace(/[^\wçğıöşüÇĞİÖŞÜ .-]+/g, '') + (failed.blob.type.includes('mp4') ? '.m4a' : '.webm');
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  const canPause = typeof MediaRecorder !== 'undefined' && 'pause' in MediaRecorder.prototype;
  const live = st === 'kayit' || st === 'duraklat';

  return (
    <div class={'tp-rec' + (live ? ' on' : '') + (st === 'duraklat' ? ' paused' : '')} aria-live="polite">
      {live ? (
        <>
          <div class="tp-rec-l">
            <span class="tp-rec-dot" aria-hidden="true" />
            <span class="tp-rec-time" role="timer" aria-label={'Kayıt süresi ' + fmtDur(sec)}>{fmtDur(sec)}</span>
            <span class="tp-rec-st">{st === 'duraklat' ? 'Duraklatıldı' : 'Kaydediliyor'}</span>
          </div>
          <div class="tp-meter" ref={meter} aria-hidden="true">{[0.35, 0.6, 0.85, 1, 0.8, 0.55, 0.3, 0.5, 0.75].map((k) => <i style={{ '--k': k }} />)}</div>
          <div class="tp-rec-b">
            {canPause && (st === 'kayit'
              ? <button type="button" class="btn sm" onClick={pause}><Icon n="pause" size={14} w={2.4} />Duraklat</button>
              : <button type="button" class="btn sm" onClick={resume}><Icon n="mic" size={14} />Devam et</button>)}
            <button type="button" class="btn sm primary" onClick={stop}><Icon n="stop" size={13} w={2.4} />Bitir ve kaydet</button>
          </div>
        </>
      ) : st === 'yukle' ? (
        <div class="tp-up"><span>Kayıt yükleniyor… %{Math.round(prog * 100)}</span><div class="ck-prog"><i style={{ width: Math.round(prog * 100) + '%' }} /></div></div>
      ) : st === 'hata' && failed ? (
        <div class="tp-rec-fail" role="alert">
          <span><strong>Kayıt yüklenemedi.</strong> Kayıt kaybolmadı — tekrar dene ya da cihazına indir.</span>
          <span class="row" style="gap:8px">
            <button type="button" class="btn sm primary" onClick={() => upload(failed.blob, failed.name, failed.sure)}>Tekrar dene</button>
            <button type="button" class="btn sm" onClick={saveLocal}><Icon n="save" size={13} />Cihaza indir</button>
          </span>
        </div>
      ) : (
        <>
          <button type="button" class="tp-rec-start" disabled={st === 'izin'} onClick={start}>
            <span class="ic" aria-hidden="true"><Icon n="mic" size={22} /></span>
            <span class="tx"><strong>{st === 'izin' ? 'Mikrofon izni bekleniyor…' : 'Kayda başla'}</strong><span>{supported ? 'Toplantıyı bu cihazın mikrofonuyla kaydet' : 'Bu tarayıcıda kayıt yok · dosya yükle'}</span></span>
          </button>
          <AudioUpload m={m} onUploaded={onUploaded} />
        </>
      )}
    </div>
  );
}

function AudioUpload({ m, onUploaded }: { m: Meeting; onUploaded: () => void }) {
  const [prog, setProg] = useState<number | null>(null);
  async function pick(file: File) {
    if (file.size > MAX_AUDIO) { snack('Ses kaydı en fazla 95 MB olabilir'); return; }
    if (file.type && !/^(audio\/|video\/(webm|mp4|quicktime))/.test(file.type)) { snack('Yalnızca ses dosyası yüklenebilir'); return; }
    const sure = await new Promise<number | null>((res) => {
      try {
        const a = new Audio(); const u = URL.createObjectURL(file); let done = false;
        const fin = (v: number | null) => { if (done) return; done = true; URL.revokeObjectURL(u); res(v); };
        a.preload = 'metadata'; a.onloadedmetadata = () => fin(isFinite(a.duration) ? a.duration : null); a.onerror = () => fin(null);
        setTimeout(() => fin(null), 3000); a.src = u;
      } catch { res(null); }
    });
    setProg(0);
    try { await uploadFile(m.id, 'ses', file, file.name.replace(/\.[a-z0-9]{1,5}$/i, ''), sure, setProg); snack('Ses dosyası yüklendi'); onUploaded(); }
    catch (e: any) { snack(e.message); } finally { setProg(null); }
  }
  if (prog !== null) return <div class="tp-up"><span>Yükleniyor… %{Math.round(prog * 100)}</span><div class="ck-prog"><i style={{ width: Math.round(prog * 100) + '%' }} /></div></div>;
  return (
    <label class="tp-upbtn">
      <Icon n="upload" size={16} /><span>Ses dosyası yükle<small>m4a, mp3, wav, webm · en fazla 95 MB</small></span>
      <input type="file" accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac" class="sr" onChange={(e) => { const f = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = ''; if (f) pick(f); }} />
    </label>
  );
}

function FileRowView({ m, f, onChanged }: { m: Meeting; f: MFile; onChanged: (m: Meeting | null) => void }) {
  const s = useStore();
  const [name, setName] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => { if (!confirm) return; const t = setTimeout(() => setConfirm(false), 4000); return () => clearTimeout(t); }, [confirm]);
  async function rename() {
    const v = (name || '').trim(); setName(null);
    if (!v || v === f.name) return;
    try { onChanged(await api<Meeting>('PATCH', `/toplantilar/${m.id}/files/${f.id}`, { name: v })); snack('Ad değiştirildi'); } catch (e: any) { snack(e.message); }
  }
  async function del() {
    if (!confirm) { setConfirm(true); return; }
    try { onChanged(await api<Meeting>('DELETE', `/toplantilar/${m.id}/files/${f.id}`)); snack(f.kind === 'ses' ? 'Ses kaydı silindi' : 'Dosya silindi'); } catch (e: any) { snack(e.message); }
  }
  const isImg = f.contentType.startsWith('image/') && f.contentType !== 'image/heic';
  const ext = f.contentType === 'application/pdf' ? 'PDF' : /presentation|powerpoint|keynote/.test(f.contentType) ? 'Sunum' : /word|pages/.test(f.contentType) ? 'Belge' : /sheet|excel|numbers/.test(f.contentType) ? 'Tablo' : isImg || f.contentType === 'image/heic' ? 'Görsel' : 'Dosya';
  const meta = [f.kind === 'ses' ? fmtDur(f.durationS) : ext, fmtSize(f.size), memberName(s.team, f.createdBy).split(' ')[0], localStamp(f.createdAt)].filter(Boolean).join(' · ');
  return (
    <div class={'tp-file ' + f.kind}>
      <div class="tp-file-h">
        {f.kind === 'ses' ? <span class="tp-fic ses" aria-hidden="true"><Icon n="mic" size={16} /></span>
          : isImg ? <a class="tp-thumb" href={f.url} target="_blank" rel="noopener"><img src={f.url} alt="" loading="lazy" /></a>
          : <span class="tp-fic" aria-hidden="true"><Icon n={ext === 'PDF' || ext === 'Belge' ? 'note' : ext === 'Sunum' ? 'monitor' : 'clip'} size={16} /></span>}
        <span class="tp-file-t">
          {name !== null ? (
            <input class="input tp-inline" value={name} maxLength={150} autoFocus aria-label="Yeni ad" onInput={(e) => setName((e.target as HTMLInputElement).value)} onBlur={rename}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); rename(); } if (e.key === 'Escape') { e.stopPropagation(); setName(null); } }} />
          ) : <span class="nm">{f.name}</span>}
          <span class="sub">{meta}</span>
        </span>
        <span class="tp-file-b">
          {f.kind === 'dosya' && <a class="iconbtn sm" href={f.url} target="_blank" rel="noopener" aria-label={f.name + ' dosyasını aç'} title="Aç"><Icon n="ext" size={15} /></a>}
          <a class="iconbtn sm" href={f.url + '?download'} aria-label={f.name + ' indir'} title="İndir"><Icon n="save" size={15} /></a>
          <button type="button" class="iconbtn sm" aria-label={f.name + ' adını değiştir'} title="Adını değiştir" onClick={() => setName(f.name)}><Icon n="edit" size={15} /></button>
          {canDelete(f.createdBy) && <button type="button" class={'iconbtn sm del' + (confirm ? ' confirm' : '')} aria-label={confirm ? 'Emin misin? Silmek için tekrar bas' : f.name + ' sil'} title={confirm ? 'Emin misin? Tekrar bas' : 'Sil'} onClick={del}>{confirm ? <span class="cf">Sil?</span> : <Icon n="trash" size={15} />}</button>}
        </span>
      </div>
      {f.kind === 'ses' && <audio controls preload="metadata" src={f.url} aria-label={f.name} />}
    </div>
  );
}

function Docs({ m, onChanged, reload }: { m: Meeting; onChanged: (m: Meeting | null) => void; reload: () => void }) {
  const [prog, setProg] = useState<{ name: string; p: number } | null>(null);
  const [drag, setDrag] = useState(false);
  async function send(files: File[]) {
    for (const file of files) {
      if (file.size > MAX_DOC) { snack(file.name + ' · dosya en fazla 25 MB olabilir'); continue; }
      setProg({ name: file.name, p: 0 });
      try { await uploadFile(m.id, 'dosya', file, file.name, null, (p) => setProg({ name: file.name, p })); }
      catch (e: any) { snack(file.name + ' · ' + e.message); }
    }
    setProg(null); reload();
  }
  const docs = m.files.filter((f) => f.kind === 'dosya');
  return (
    <div class="tp-docs">
      <label class={'tp-drop' + (drag ? ' on' : '')} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const l = Array.from(e.dataTransfer?.files || []); if (l.length) send(l); }}>
        <Icon n="clip" size={18} />
        <span><strong>Dosya ekle</strong> ya da buraya sürükle<small>Sunum, PDF, belge, görsel · en fazla 25 MB</small></span>
        <input type="file" multiple class="sr" accept=".pdf,.ppt,.pptx,.key,.doc,.docx,.pages,.xls,.xlsx,.numbers,.zip,image/*" onChange={(e) => { const l = Array.from((e.target as HTMLInputElement).files || []); (e.target as HTMLInputElement).value = ''; if (l.length) send(l); }} />
      </label>
      {prog && <div class="tp-up"><span>{prog.name} yükleniyor… %{Math.round(prog.p * 100)}</span><div class="ck-prog"><i style={{ width: Math.round(prog.p * 100) + '%' }} /></div></div>}
      {docs.map((f) => <FileRowView m={m} f={f} onChanged={onChanged} />)}
      {docs.length === 0 && !prog && <p class="tp-empty">Toplantıda gösterilen sunum, teklif ya da notların fotoğrafı burada saklanır.</p>}
    </div>
  );
}

// ---------- detay paneli ----------
export type Tab = 'gundem' | 'notlar' | 'kararlar' | 'aksiyonlar' | 'ses' | 'dosyalar';
export const TAB_KEYS: Tab[] = ['gundem', 'notlar', 'kararlar', 'aksiyonlar', 'ses', 'dosyalar'];

export function MeetingDrawer({ m, tab0, onClose, onEdit, onChanged, reload, openTask }: {
  m: Meeting; tab0?: Tab | null; onClose: () => void; onEdit: () => void; onChanged: (m: Meeting | null) => void; reload: () => void; openTask: (id: string) => void;
}) {
  const s = useStore();
  const now = Date.now();
  const past = isPast(m, now);
  const [tab, setTab] = useState<Tab>(tab0 || (past || m.status === 'yapildi' ? 'notlar' : 'gundem'));
  const [confirmDel, setConfirmDel] = useState(false);
  const busy = useRef(false);
  useEffect(() => { setConfirmDel(false); }, [m.id]);
  useEffect(() => { if (tab0) setTab(tab0); }, [tab0]);
  const close = () => { if (busy.current) { snack('Ses kaydı sürüyor · önce kaydı bitir'); return; } onClose(); };
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.overlay')) close(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  async function patch(body: Partial<Meeting>, msg?: string) {
    try { const r = await api<Meeting>('PATCH', '/toplantilar/' + m.id, body); onChanged(r); if (msg) snack(msg); }
    catch (e: any) { snack(e.message); onChanged(null); }
  }
  async function del() {
    if (!confirmDel) { setConfirmDel(true); return; }
    try { await api('DELETE', '/toplantilar/' + m.id); snack('Toplantı silindi'); onChanged(null); onClose(); } catch (e: any) { snack(e.message); }
  }
  const c = counts(m);
  const tabs: { k: Tab; label: string; icon: string; n?: number | string }[] = [
    { k: 'gundem', label: 'Gündem', icon: 'list', n: m.agenda.length || undefined },
    { k: 'notlar', label: 'Notlar', icon: 'note', n: c.notes ? '•' : undefined },
    { k: 'kararlar', label: 'Kararlar', icon: 'flag', n: c.decisions || undefined },
    { k: 'aksiyonlar', label: 'Aksiyonlar', icon: 'check', n: c.actions ? c.open + '/' + c.actions : undefined },
    { k: 'ses', label: 'Ses kaydı', icon: 'mic', n: c.audio || undefined },
    { k: 'dosyalar', label: 'Dosyalar', icon: 'clip', n: c.docs || undefined },
  ];
  const when = whenLabel(m.date);
  const startsIn = Math.round((startMs(m) - now) / 60_000);
  const soon = m.status === 'planlandi' && startsIn > 0 && startsIn <= 120;
  const ongoing = m.status === 'planlandi' && startMs(m) <= now && endMs(m) >= now;
  return (
    <div class="drawer-wrap">
      <button type="button" class="scrim" aria-label="Detayı kapat" onClick={close} />
      <aside class={'drawer tp-drawer st-' + m.status} role="dialog" aria-label="Toplantı detayı">
        <div class="row" style="gap:8px">
          <span class="chip"><ClientMark name={m.client} size={18} />{m.client || 'Firma yok'}</span>
          <span class="chip tp-tchip"><Icon n={TYPE[m.type].icon} size={13} />{TYPE[m.type].label}</span>
          <span class="spacer" />
          <button type="button" class="iconbtn" aria-label="Kapat" onClick={close}><Icon n="x" size={16} /></button>
        </div>
        <div class="tp-dhead">
          <h2 class={m.status === 'iptal' ? 'cancel' : ''}>{m.title}</h2>
          <span class="tp-dwhen"><Icon n="clock" size={15} /><strong>{longDate(m.date)}</strong> · {timeRange(m)} {(ongoing || soon || !LDAY.includes(when)) && <span class="sub">· {ongoing ? 'şu an sürüyor' : soon ? startsIn + ' dk sonra' : when}</span>}</span>
        </div>
        {needsNotes(m, now) && (
          <div class="tp-prompt" role="status">
            <Icon n="note" size={16} />
            <span><strong>Toplantı notlarını ekle</strong>Saati geçti; notları, kararları ve ses kaydını ekleyip durumu güncelle.</span>
            <span class="tp-prompt-b">
              <button type="button" class="btn sm primary" onClick={() => patch({ status: 'yapildi' }, 'Yapıldı olarak işaretlendi')}>Yapıldı</button>
              <button type="button" class="btn sm" onClick={() => patch({ status: 'ertelendi' }, 'Ertelendi olarak işaretlendi')}>Ertelendi</button>
            </span>
          </div>
        )}
        {m.type === 'online' && m.link && m.status !== 'iptal' && !past && (
          <a class="tp-join" href={m.link} target="_blank" rel="noopener noreferrer"><Icon n="cam" size={16} /><span><strong>Toplantıya katıl</strong>{hostOf(m.link)}</span><Icon n="ext" size={14} /></a>
        )}
        <div class="seg tp-stseg" role="group" aria-label="Durum">
          {STATUSES.map((st) => (
            <button type="button" class={m.status === st.k ? 'on' : ''} aria-pressed={m.status === st.k} onClick={() => m.status !== st.k && patch({ status: st.k }, STATUS[st.k] + ' olarak işaretlendi')}>
              <span class={'dot tp-dot ' + st.k} />{st.label}
            </button>
          ))}
        </div>
        <dl class="ck-dl tp-dl">
          <dt>{m.type === 'online' ? 'Bağlantı' : m.type === 'telefon' ? 'Arama' : 'Yer'}</dt>
          <dd>{m.type === 'online' ? (m.link ? <a href={m.link} target="_blank" rel="noopener noreferrer" class="tp-link">{hostOf(m.link)}<Icon n="ext" size={12} /></a> : <span class="sub">Bağlantı eklenmedi</span>) : m.location || <span class="sub">—</span>}</dd>
          <dt>Firma tarafı</dt><dd>{m.clientAttendees || <span class="sub">—</span>}</dd>
          <dt>Ekleyen</dt><dd>{memberName(s.team, m.createdBy)}</dd>
        </dl>
        <div class="tp-part">
          <h3 class="ck-h3">Ekipten katılımcılar</h3>
          <PeoplePicker value={m.participants} onToggle={(id) => {
            const on = m.participants.includes(id);
            patch({ participants: on ? m.participants.filter((x) => x !== id) : [...m.participants, id] },
              on ? 'Katılımcılardan çıkarıldı' : id === s.me?.id ? 'Katılımcı olarak eklendin' : memberName(s.team, id).split(' ')[0] + ' eklendi · bildirim gitti');
          }} />
        </div>

        <div class="tp-tabs" role="tablist" aria-label="Toplantı bölümleri">
          {tabs.map((t) => (
            <button type="button" role="tab" id={'tpt-' + t.k} aria-selected={tab === t.k} aria-controls="tp-tabpanel" onClick={() => setTab(t.k)}>
              <Icon n={t.icon} size={14} />{t.label}{t.n !== undefined && <span class="n">{t.n}</span>}
            </button>
          ))}
        </div>
        <div class="tp-panel" id="tp-tabpanel" role="tabpanel" aria-labelledby={'tpt-' + tab}>
          {tab === 'gundem' && (
            <>
              <p class="tp-lead">Toplantıda konuşulacak başlıklar. Konuşulanları işaretleyebilirsin.</p>
              <ItemList items={m.agenda} checkable onChange={(agenda) => patch({ agenda })} placeholder="Gündem maddesi ekle (Enter)" label="Gündem maddesi ekle" empty="Henüz gündem maddesi yok." max={30} />
            </>
          )}
          {tab === 'notlar' && <NotesEditor key={m.id} m={m} onSaved={onChanged} />}
          {tab === 'kararlar' && (
            <>
              <p class="tp-lead">Toplantıda netleşen kararlar — müşteriyle ne konusunda anlaşıldı?</p>
              <ItemList items={m.decisions.map((text) => ({ text, done: false }))} onChange={(l) => patch({ decisions: l.map((x) => x.text) })} placeholder="Alınan kararı yaz (Enter)" label="Karar ekle" empty="Henüz karar eklenmedi." max={40} />
            </>
          )}
          {tab === 'aksiyonlar' && <Actions m={m} onChanged={onChanged} openTask={openTask} />}
          {tab === 'ses' && (
            <div class="tp-audio">
              <Recorder m={m} onUploaded={reload} busyRef={busy} />
              {m.files.filter((f) => f.kind === 'ses').map((f) => <FileRowView m={m} f={f} onChanged={onChanged} />)}
              {c.audio === 0 && <p class="tp-empty">Henüz ses kaydı yok. Kayıtlar yalnızca ekibe açıktır.</p>}
            </div>
          )}
          {tab === 'dosyalar' && <Docs m={m} onChanged={onChanged} reload={reload} />}
        </div>

        <div class="ck-info"><Icon n="bell" size={15} /><span>{REMIND_INFO}</span></div>
        <div class="row" style="margin-top:auto">
          <button type="button" class="btn" onClick={onEdit}><Icon n="edit" size={14} />Düzenle</button>
          <span class="spacer" />
          {canDelete(m.createdBy) && <button type="button" class={'btn danger' + (confirmDel ? ' confirm' : '')} onClick={del}>{confirmDel ? 'Emin misin? Sil' : 'Toplantıyı sil'}</button>}
        </div>
      </aside>
    </div>
  );
}

// ---------- takvim ----------
export function MeetCal({ month, setMonth, list, day, onPick, onOpen, big }: {
  month: string; setMonth: (m: string) => void; list: Meeting[]; day: string | null; onPick: (d: string) => void; onOpen?: (id: string) => void; big?: boolean;
}) {
  const [yy, mm] = month.split('-').map((n) => parseInt(n, 10));
  const lead = (new Date(yy, mm - 1, 1).getDay() + 6) % 7;
  const daysIn = new Date(yy, mm, 0).getDate();
  const today = todayIso();
  const now = Date.now();
  const shift = (n: number) => { const d = new Date(yy, mm - 1 + n, 1); setMonth(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); };
  const byDay = new Map<string, Meeting[]>();
  for (const x of list) if (x.date.startsWith(month)) { const a = byDay.get(x.date) || []; a.push(x); byDay.set(x.date, a); }
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<span class="ck-day blank" aria-hidden="true" />);
  for (let d = 1; d <= daysIn; d++) {
    const ds = month + '-' + String(d).padStart(2, '0');
    const items = (byDay.get(ds) || []).sort(byWhen);
    const cls = 'ck-day' + (items.length ? ' has' : '') + (ds === today ? ' today' : '') + (ds === day ? ' sel' : '');
    const aria = d + ' ' + LMON[mm - 1] + ' ' + LDAY[new Date(yy, mm - 1, d).getDay()] + (items.length ? ', ' + items.length + ' toplantı' : '');
    if (big) {
      cells.push(
        <div class={cls + ' tp-bday'}>
          <button type="button" class="tp-bday-n" aria-label={aria} aria-pressed={ds === day} onClick={() => onPick(ds)}>{d}</button>
          {items.slice(0, 3).map((x) => (
            <button type="button" class={'tp-ev ' + (needsNotes(x, now) ? 'late' : x.status)} title={x.startTime + ' ' + x.title + (x.client ? ' · ' + x.client : '')} onClick={() => (onOpen ? onOpen(x.id) : onPick(ds))}>
              <ClientMark name={x.client} size={14} title={false} /><b>{x.startTime}</b> {x.title}
            </button>
          ))}
          {items.length > 3 && <button type="button" class="ck-more" onClick={() => onPick(ds)}>+{items.length - 3} toplantı</button>}
        </div>,
      );
    } else {
      const sts = [...new Set(items.map((x) => (needsNotes(x, now) ? 'late' : x.status)))];
      cells.push(
        <button type="button" class={cls} aria-label={aria} aria-pressed={ds === day} onClick={() => onPick(ds)}>
          <span>{d}</span>
          <span class="ck-dots">{sts.map((st) => <i class={'tp-dot ' + st} />)}</span>
        </button>,
      );
    }
  }
  return (
    <section class={'ck-cal tp-cal' + (big ? ' big card' : ' panel')} style={big ? 'padding:16px' : ''} aria-label="Toplantı takvimi">
      <div class="ck-cal-h">
        <h2>{LMON[mm - 1]} {yy}</h2>
        <button type="button" class="iconbtn" style="width:32px;height:32px" aria-label="Önceki ay" onClick={() => shift(-1)}>‹</button>
        <button type="button" class="btn sm ghost" onClick={() => setMonth(today.slice(0, 7))}>Bugün</button>
        <button type="button" class="iconbtn" style="width:32px;height:32px" aria-label="Sonraki ay" onClick={() => shift(1)}>›</button>
      </div>
      <div class="ck-wk" aria-hidden="true">{[1, 2, 3, 4, 5, 6, 0].map((i) => <span>{DAY[i]}</span>)}</div>
      <div class="ck-grid">{cells}</div>
      {!big && <span class="sub" style="font-size:12px">Noktalı günlerde toplantı var. Güne tıklayınca o günün toplantıları listelenir.</span>}
      <div class="row tp-legend">
        {STATUSES.map((st) => <span class="row" style="gap:5px"><span class={'dot tp-dot ' + st.k} />{st.label}</span>)}
        <span class="row" style="gap:5px"><span class="dot tp-dot late" />Notları bekliyor</span>
      </div>
    </section>
  );
}

// ---------- kart (liste, Bugün, müşteri kartı) ----------
export function MeetingCard({ m, onOpen, showClient = true, now = Date.now() }: { m: Meeting; onOpen: (id: string, tab?: Tab) => void; showClient?: boolean; now?: number }) {
  const s = useStore();
  const c = counts(m);
  const color = s.clients.find((x) => x.name === m.client)?.color;
  const d = parseD(m.date);
  const late = needsNotes(m, now);
  return (
    <div class={'ck-card tp-card st-' + m.status + (late ? ' late' : '') + (color ? ' stripe' : '')} style={color ? { '--stripe': color } : undefined}>
      <span class="ck-when tp-when-c"><b>{m.startTime}</b><span>{m.endTime ? '– ' + m.endTime : DAY[d.getDay()] + ' · ' + d.getDate() + ' ' + MON[d.getMonth()]}</span></span>
      <button type="button" class="ck-body" onClick={() => onOpen(m.id)} aria-label={m.title + ' toplantısının detayını aç'}>
        <span class="ck-top"><span class="ck-title">{m.title}</span><StatusTag m={m} now={now} /></span>
        <span class="ck-meta">
          {showClient && <span class="cline"><ClientMark name={m.client} size={16} /><span>{m.client || '—'}</span></span>}
          <TypeLine m={m} />
          {m.agenda.length > 0 && <span><Icon n="list" size={12} />Gündem {m.agenda.length}</span>}
          {c.notes && <span><Icon n="note" size={12} />Not</span>}
          {c.decisions > 0 && <span><Icon n="flag" size={12} />{c.decisions} karar</span>}
          {c.actions > 0 && <span style={c.open === 0 ? 'color:var(--green)' : ''}><Icon n="check" size={12} />Aksiyon {c.actions - c.open}/{c.actions}</span>}
          {c.audio > 0 && <span><Icon n="mic" size={12} />{c.audio} kayıt</span>}
          {c.docs > 0 && <span><Icon n="clip" size={12} />{c.docs} dosya</span>}
        </span>
      </button>
      <span class="ck-side">
        <CrewStack ids={m.participants} />
        {late && <button type="button" class="btn sm tp-addnotes" onClick={() => onOpen(m.id, 'notlar')}><Icon n="note" size={13} />Toplantı notlarını ekle</button>}
      </span>
    </div>
  );
}
