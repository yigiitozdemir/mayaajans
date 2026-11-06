// Çekim Planı: ortak tipler, form, detay paneli, takvim
import { useEffect, useState } from 'preact/hooks';
import { api, snack, store, todayIso, parseD, LMON, LDAY, DAY, dayDiff, memberName, type Member } from '../api';
import { Avatar, Icon, Modal, useStore } from '../ui';

export interface Check { text: string; done: boolean }
export interface Shoot {
  id: string; title: string; client: string; date: string; time: string; location: string; status: 0 | 1 | 2;
  note: string; crew: string[]; checks: Check[]; source: string; createdBy: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null; remindedFor: string | null;
}

export const STATUS = [
  { label: 'Planlandı', cls: 's0' },
  { label: 'Tamamlandı', cls: 's1' },
  { label: 'İptal', cls: 's2' },
] as const;
export const DEFAULT_CHECKS = ['Yedek batarya ve kart', 'Gimbal', 'Hava durumu kontrolü', 'Lokasyon / izin teyidi'];
const SUGG = [...DEFAULT_CHECKS, 'Mikrofon', 'Işık', 'Reflektör', 'Drone izni', 'Kıyafet / makyaj'];
const TIME_CHIPS = ['Sabah', 'Öğleden sonra', 'Tam gün'];
export const REMIND_INFO = "Her gün 16:30'da yarın çekimi olan ekibe ve #çekim-planı kanalına hatırlatma gider.";

export const lower = (s: string) => (s || '').toLocaleLowerCase('tr');
export const longDate = (s: string) => { const d = parseD(s); return d.getDate() + ' ' + LMON[d.getMonth()] + ' ' + LDAY[d.getDay()]; };
export const isLate = (x: Shoot) => x.status === 0 && x.date < todayIso();

/** Serbest saat metnini sıralama anahtarına çevirir (sunucudaki ile aynı). */
export function timeKey(t: string): number {
  const s = lower(t).trim();
  const m = /(\d{1,2})[:.](\d{2})/.exec(s);
  if (m) return Math.min(23, +m[1]) * 60 + Math.min(59, +m[2]);
  if (!s) return 1440;
  if (s.includes('tam gün')) return 480;
  if (s.includes('sabah')) return 540;
  if (s.includes('öğleden sonra')) return 840;
  if (s.includes('öğle')) return 720;
  if (s.includes('akşam')) return 1080;
  if (s.includes('gece')) return 1260;
  return 1439;
}
export const byWhenAsc = (a: Shoot, b: Shoot) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : timeKey(a.time) - timeKey(b.time));
export const byWhenDesc = (a: Shoot, b: Shoot) => -byWhenAsc(a, b);

export function whenLabel(date: string): string {
  const n = dayDiff(date);
  if (n === 0) return 'Bugün';
  if (n === 1) return 'Yarın';
  if (n === -1) return 'Dün';
  if (n > 1 && n <= 6) return LDAY[parseD(date).getDay()];
  if (n < 0) return -n + ' gün önce';
  return n + ' gün sonra';
}

export function CrewStack({ ids, size = 24 }: { ids: string[]; size?: number }) {
  const s = useStore();
  const ms = ids.map((id) => s.team.find((m) => m.id === id)).filter(Boolean) as Member[];
  if (!ms.length) return null;
  return (
    <span class="ck-crew" aria-label={'Ekip: ' + ms.map((m) => m.firstName).join(', ')}>
      {ms.slice(0, 4).map((m) => <span title={m.name}><Avatar m={m} size={size} radius={8} /></span>)}
      {ms.length > 4 && <span class="av" style={{ width: size + 'px', height: size + 'px', borderRadius: '8px', background: 'var(--mute2)', fontSize: '11px' }}>+{ms.length - 4}</span>}
    </span>
  );
}

function CrewPicker({ value, onToggle }: { value: string[]; onToggle: (id: string) => void }) {
  const s = useStore();
  return (
    <div class="ck-chips" role="group" aria-label="Çekim ekibi">
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

function CheckList({ checks, onToggle, onRemove, onAdd }: { checks: Check[]; onToggle: (i: number) => void; onRemove: (i: number) => void; onAdd: (t: string) => void }) {
  const [draft, setDraft] = useState('');
  const add = (t: string) => { const v = t.trim(); if (!v) return; onAdd(v); setDraft(''); };
  const sugg = SUGG.filter((x) => !checks.some((c) => c.text === x)).slice(0, 4);
  return (
    <div class="ck-checks">
      {checks.map((c, i) => {
        const id = 'ckc-' + i + '-' + c.text.length;
        return (
          <div class={'ck-check' + (c.done ? ' done' : '')}>
            <input type="checkbox" id={id} checked={c.done} onChange={() => onToggle(i)} />
            <label for={id}>{c.text}</label>
            <button type="button" class="x" aria-label={c.text + ' maddesini sil'} onClick={() => onRemove(i)}>×</button>
          </div>
        );
      })}
      {checks.length === 0 && <span class="sub">Hazırlık maddesi yok.</span>}
      <div class="ck-add">
        <label style="flex:1;display:flex"><span class="sr">Hazırlık maddesi ekle</span>
          <input class="input" value={draft} placeholder="Madde ekle (Enter)" maxLength={200}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); add(draft); } }} />
        </label>
        <button type="button" class="btn sm" style="min-height:38px" onClick={() => add(draft)}>Ekle</button>
      </div>
      {sugg.length > 0 && (
        <div class="row" style="gap:6px;font-size:12px;color:var(--mute2)">Sık kullanılanlar:
          {sugg.map((x) => <button type="button" class="ck-tchip" onClick={() => add(x)}>+ {x}</button>)}
        </div>
      )}
    </div>
  );
}

// ---------- ekle / düzenle ----------
export function ShootForm({ initial, firms, onClose, onSaved }: { initial: Partial<Shoot>; firms: string[]; onClose: () => void; onSaved: (s: Shoot) => void }) {
  const isEdit = !!initial.id;
  const [f, setF] = useState({
    title: initial.title || '', client: initial.client || '', date: initial.date || '', time: initial.time || '',
    location: initial.location || '', status: (initial.status ?? 0) as 0 | 1 | 2, note: initial.note || '',
    crew: initial.crew || [], checks: initial.checks || DEFAULT_CHECKS.map((text) => ({ text, done: false })),
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof f>) => { setF({ ...f, ...patch }); setErr(''); };

  async function save() {
    if (busy) return;
    if (!f.title.trim()) { setErr('Çekim / içerik adını yaz.'); return; }
    if (!f.date) { setErr('Çekim tarihi seç — tarih zorunlu.'); return; }
    setBusy(true);
    try {
      const body = { ...f, title: f.title.trim() };
      const s = isEdit ? await api<Shoot>('PATCH', '/shoots/' + initial.id, body) : await api<Shoot>('POST', '/shoots', body);
      const me = store.get().me!.id;
      const prev = initial.crew || [];
      const added = f.crew.filter((x) => x !== me && !prev.includes(x));
      snack((isEdit ? 'Çekim kaydedildi' : 'Çekim eklendi') + (added.length && f.status !== 2 ? ' · ' + added.map((x) => memberName(store.get().team, x).split(' ')[0]).join(', ') + ' kişisine bildirim gitti' : ''));
      onSaved(s);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Enter' && t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox' && !t.closest('.ck-add')) { e.preventDefault(); save(); }
  };

  return (
    <Modal title={isEdit ? 'Çekimi düzenle' : 'Yeni çekim'} onClose={onClose} width={640}>
      <div style="display:flex;flex-direction:column;gap:16px" onKeyDown={onKey}>
        <label class="field">Çekim / İçerik *
          <input class={'input' + (err && !f.title.trim() ? ' err' : '')} value={f.title} autoFocus maxLength={200} placeholder="Örn. Hasta memnuniyet çekimi" onInput={(e) => set({ title: (e.target as HTMLInputElement).value })} />
        </label>
        <div class="ck-grid2">
          <label class="field">Firma
            <input class="input" list="cekim-firmalar" value={f.client} maxLength={120} placeholder="Seç ya da yaz" onInput={(e) => set({ client: (e.target as HTMLInputElement).value })} />
            <datalist id="cekim-firmalar">{firms.map((x) => <option value={x} />)}</datalist>
          </label>
          <label class="field">Lokasyon
            <input class="input" value={f.location} maxLength={160} placeholder="Örn. Klinik, Ofis, Stüdyo" onInput={(e) => set({ location: (e.target as HTMLInputElement).value })} />
          </label>
          <label class="field"><span>Tarih * {f.date && <span style="font-weight:500;color:var(--mute2)">· {LDAY[parseD(f.date).getDay()]}</span>}</span>
            <input type="date" required class={'input' + (err && !f.date ? ' err' : '')} value={f.date} onInput={(e) => set({ date: (e.target as HTMLInputElement).value })} />
          </label>
          <div class="field">
            <label style="display:flex;flex-direction:column;gap:6px">Saat
              <input class="input" value={f.time} maxLength={40} placeholder="Örn. 10:00 ya da Sabah" onInput={(e) => set({ time: (e.target as HTMLInputElement).value })} />
            </label>
            <span class="row" style="gap:6px">{TIME_CHIPS.map((t) => <button type="button" class="ck-tchip" aria-pressed={f.time === t} onClick={() => set({ time: t })}>{t}</button>)}</span>
          </div>
        </div>
        <div class="field">Durum
          <div class="seg" role="group" aria-label="Durum">
            {STATUS.map((st, i) => <button type="button" style="flex:1" class={f.status === i ? 'on' : ''} aria-pressed={f.status === i} onClick={() => set({ status: i as 0 | 1 | 2 })}><span class={'dot ck-dot' + i} style="display:inline-block;margin-right:6px" />{st.label}</button>)}
          </div>
        </div>
        <div class="field"><span>Çekim ekibi <span style="font-weight:500;color:var(--mute2)">· yeni eklenenlere bildirim gider</span></span>
          <CrewPicker value={f.crew} onToggle={(id) => set({ crew: f.crew.includes(id) ? f.crew.filter((x) => x !== id) : [...f.crew, id] })} />
        </div>
        <div class="field">Hazırlık listesi
          <CheckList checks={f.checks}
            onToggle={(i) => set({ checks: f.checks.map((c, j) => (j === i ? { ...c, done: !c.done } : c)) })}
            onRemove={(i) => set({ checks: f.checks.filter((_, j) => j !== i) })}
            onAdd={(t) => set({ checks: [...f.checks, { text: t, done: false }] })} />
        </div>
        <label class="field">Not
          <textarea class="input" rows={3} value={f.note} maxLength={4000} placeholder="Çekimle ilgili notlar…" onInput={(e) => set({ note: (e.target as HTMLTextAreaElement).value })} />
        </label>
        {err && <span class="errtext" role="alert">{err}</span>}
        <div class="row"><span class="spacer" />
          <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
          <button type="button" class="btn primary" disabled={busy} onClick={save}>{isEdit ? 'Kaydet' : 'Çekimi ekle'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- detay paneli ----------
export function ShootDrawer({ shoot: x, onClose, onEdit, onChanged }: { shoot: Shoot; onClose: () => void; onEdit: () => void; onChanged: (s: Shoot | null) => void }) {
  const s = useStore();
  const [confirmDel, setConfirmDel] = useState(false);
  const [note, setNote] = useState(x.note);
  useEffect(() => { setNote(x.note); }, [x.note, x.id]);
  useEffect(() => { setConfirmDel(false); }, [x.id]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.overlay')) onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);

  async function call(method: string, path: string, body?: unknown, msg?: string) {
    try { const r = await api<Shoot>(method, path, body); onChanged(r); if (msg) snack(msg); }
    catch (e: any) { snack(e.message); onChanged(null); }
  }
  const patch = (body: Partial<Shoot>, msg?: string) => call('PATCH', '/shoots/' + x.id, body, msg);
  async function del() {
    if (!confirmDel) { setConfirmDel(true); return; }
    try { await api('DELETE', '/shoots/' + x.id); snack('Çekim silindi'); onChanged(null); onClose(); } catch (e: any) { snack(e.message); }
  }
  const late = isLate(x);
  const doneN = x.checks.filter((c) => c.done).length;
  return (
    <div class="drawer-wrap">
      <button type="button" class="scrim" aria-label="Detayı kapat" onClick={onClose} />
      <aside class="drawer" role="dialog" aria-label="Çekim detayı">
        <div class="row">
          <span class="chip">{x.client || 'Firma yok'}</span>
          {x.source === 'slack' && <span class="chip">Slack'ten aktarıldı</span>}
          <span class="spacer" />
          <button type="button" class="iconbtn" aria-label="Kapat" onClick={onClose}><Icon n="x" size={16} /></button>
        </div>
        <h2 style={'margin:0;font-family:var(--display);font-size:22px;line-height:1.3' + (x.status === 2 ? ';text-decoration:line-through;color:var(--mute2)' : '')}>{x.title}</h2>
        {late && (
          <div class="ck-alert" role="status">Tarihi geçti, durumu güncelle
            <span class="spacer" />
            <button type="button" class="btn sm primary" onClick={() => patch({ status: 1 }, 'Tamamlandı olarak işaretlendi')}>Çekildi</button>
            <button type="button" class="btn sm" onClick={() => patch({ status: 2 }, 'İptal edildi')}>İptal</button>
          </div>
        )}
        <div class="seg" role="group" aria-label="Durum">
          {STATUS.map((st, i) => (
            <button type="button" style="flex:1" class={x.status === i ? 'on' : ''} aria-pressed={x.status === i} onClick={() => x.status !== i && patch({ status: i as 0 | 1 | 2 })}>
              <span class={'dot ck-dot' + i} style="display:inline-block;margin-right:6px" />{st.label}
            </button>
          ))}
        </div>
        <dl class="ck-dl">
          <dt>Tarih</dt><dd><strong>{longDate(x.date)}</strong> <span class="sub">· {whenLabel(x.date)}</span></dd>
          <dt>Saat</dt><dd>{x.time || <span class="sub">—</span>}</dd>
          <dt>Lokasyon</dt><dd>{x.location || <span class="sub">—</span>}</dd>
          <dt>Firma</dt><dd>{x.client || <span class="sub">—</span>}</dd>
          <dt>Ekleyen</dt><dd>{x.createdBy ? memberName(s.team, x.createdBy) : 'Slack listesi'}</dd>
          {x.completedAt && <><dt>Tamamlandı</dt><dd class="sub">{x.completedAt.slice(0, 10).split('-').reverse().join('.')}</dd></>}
        </dl>
        <div style="display:flex;flex-direction:column;gap:8px">
          <h3 class="ck-h3">Çekim ekibi</h3>
          <CrewPicker value={x.crew} onToggle={(id) => {
            const on = x.crew.includes(id);
            patch({ crew: on ? x.crew.filter((c) => c !== id) : [...x.crew, id] },
              on ? 'Ekipten çıkarıldı' : id === s.me?.id ? 'Ekibe eklendin' : memberName(s.team, id).split(' ')[0] + ' ekibe eklendi · bildirim gitti');
          }} />
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="row"><h3 class="ck-h3">Hazırlık listesi</h3><span class="spacer" />{x.checks.length > 0 && <span class="sub">{doneN}/{x.checks.length} hazır</span>}</div>
          {x.checks.length > 0 && <div class="ck-prog" aria-hidden="true"><i style={{ width: Math.round((doneN / x.checks.length) * 100) + '%' }} /></div>}
          <CheckList checks={x.checks}
            onToggle={(i) => call('PATCH', `/shoots/${x.id}/checks/${i}`, { done: !x.checks[i].done })}
            onRemove={(i) => call('DELETE', `/shoots/${x.id}/checks/${i}`)}
            onAdd={(t) => call('POST', `/shoots/${x.id}/checks`, { text: t })} />
        </div>
        <label class="field">Not
          <textarea class="input" rows={4} value={note} maxLength={4000} placeholder="Çekimle ilgili notlar…" onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} onBlur={() => { if (note !== x.note) patch({ note }, 'Not kaydedildi'); }} />
        </label>
        <div class="ck-info"><Icon n="bell" size={15} /><span>{REMIND_INFO}</span></div>
        <div class="row" style="margin-top:auto">
          <button type="button" class="btn" onClick={onEdit}>Düzenle</button>
          <span class="spacer" />
          <button type="button" class={'btn danger' + (confirmDel ? ' confirm' : '')} onClick={del}>{confirmDel ? 'Emin misin? Sil' : 'Çekimi sil'}</button>
        </div>
      </aside>
    </div>
  );
}

// ---------- takvim ----------
export function MonthCal({ month, setMonth, shoots, day, onPick, big }: { month: string; setMonth: (m: string) => void; shoots: Shoot[]; day: string | null; onPick: (d: string) => void; big?: boolean }) {
  const [yy, mm] = month.split('-').map((n) => parseInt(n, 10));
  const lead = (new Date(yy, mm - 1, 1).getDay() + 6) % 7;
  const daysIn = new Date(yy, mm, 0).getDate();
  const today = todayIso();
  const shift = (n: number) => { const d = new Date(yy, mm - 1 + n, 1); setMonth(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')); };
  const byDay = new Map<string, Shoot[]>();
  for (const x of shoots) if (x.date.startsWith(month)) { const a = byDay.get(x.date) || []; a.push(x); byDay.set(x.date, a); }
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(<span class="ck-day blank" aria-hidden="true" />);
  for (let d = 1; d <= daysIn; d++) {
    const ds = month + '-' + String(d).padStart(2, '0');
    const list = (byDay.get(ds) || []).sort(byWhenAsc);
    const cls = 'ck-day' + (list.length ? ' has' : '') + (ds === today ? ' today' : '') + (ds === day ? ' sel' : '');
    const aria = d + ' ' + LMON[mm - 1] + ' ' + LDAY[new Date(yy, mm - 1, d).getDay()] + (list.length ? ', ' + list.length + ' çekim' : '');
    const statuses = [...new Set(list.map((x) => x.status))].sort();
    cells.push(
      <button type="button" class={cls} aria-label={aria} aria-pressed={ds === day} onClick={() => onPick(ds)}>
        {big ? (
          <>
            <span class="n">{d}</span>
            {list.slice(0, 3).map((x) => <span class={'ck-ev ' + STATUS[x.status].cls + (isLate(x) ? ' late' : '')} title={x.title}>{x.time && timeKey(x.time) < 1440 && /\d/.test(x.time) ? x.time.slice(0, 5) + ' ' : ''}{x.title}</span>)}
            {list.length > 3 && <span class="ck-more">+{list.length - 3} çekim</span>}
          </>
        ) : (
          <>
            <span>{d}</span>
            <span class="ck-dots">{statuses.map((st) => <i class={'ck-dot' + st} />)}</span>
          </>
        )}
      </button>,
    );
  }
  return (
    <section class={'ck-cal' + (big ? ' big card' : ' panel')} style={big ? 'padding:16px' : ''} aria-label="Takvim">
      <div class="ck-cal-h">
        <h2>{LMON[mm - 1]} {yy}</h2>
        <button type="button" class="iconbtn" style="width:32px;height:32px" aria-label="Önceki ay" onClick={() => shift(-1)}>‹</button>
        <button type="button" class="btn sm ghost" onClick={() => setMonth(today.slice(0, 7))}>Bugün</button>
        <button type="button" class="iconbtn" style="width:32px;height:32px" aria-label="Sonraki ay" onClick={() => shift(1)}>›</button>
      </div>
      <div class="ck-wk" aria-hidden="true">{[1, 2, 3, 4, 5, 6, 0].map((i) => <span>{DAY[i]}</span>)}</div>
      <div class="ck-grid">{cells}</div>
      {!big && <span class="sub" style="font-size:12px">Noktalı günlerde çekim var. Güne tıklayınca o günün çekimleri listelenir.</span>}
      <div class="row" style="gap:12px;font-size:11px;color:var(--mute2)">
        {STATUS.map((st, i) => <span class="row" style="gap:5px"><span class={'dot ck-dot' + i} />{st.label}</span>)}
      </div>
    </section>
  );
}
