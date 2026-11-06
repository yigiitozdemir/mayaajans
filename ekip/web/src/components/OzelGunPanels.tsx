// Özel Günler: gün formu, firma seçimi, gün detayı
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, reloadTasks, snack, store, memberName, todayIso, fmtDate, parseD, LMON, LDAY, MON, type Member } from '../api';
import { Avatar, Icon, Modal, useStore } from '../ui';

export interface SRow {
  client: string; format: string; lang: string; assigneeId: string | null; status: 0 | 1 | 2;
  doneBy: string | null; doneAt: string | null; taskId: string | null;
}
export interface SDay {
  id: string; name: string; date: string; star: boolean; tone: string; note: string; rangeLabel: string;
  prepDate: string; createdBy: string | null; rows: SRow[];
}

export const TONES: { k: string; label: string }[] = [
  { k: 'anma', label: 'Anma' }, { k: 'kutlama', label: 'Kutlama' }, { k: 'bilgi', label: 'Bilgi' }, { k: 'kampanya', label: 'Kampanya' },
];
export const toneLabel = (k: string) => TONES.find((t) => t.k === k)?.label || k;
export const FORMATS = ['Story', 'Post', 'Reels', 'Video'];
const LANGS = ['TR', 'EN', 'BG', 'TR+EN', 'TR+BG', 'TR+BG+EN'];
const lower = (s: string) => (s || '').toLocaleLowerCase('tr');

/** Hazırlık durumu etiketi: paylaşımdan 2 iş günü önce. */
export function prepTag(d: SDay, remaining: number): { label: string; cls: string } {
  const t = todayIso();
  if (remaining > 0 && d.prepDate < t) return { label: 'Hazırlık gecikti · ' + fmtDate(d.prepDate), cls: 'late' };
  if (remaining > 0 && d.prepDate === t) return { label: 'Hazırlık bugün', cls: 'today' };
  return { label: 'Hazırlık: ' + fmtDate(d.prepDate), cls: '' };
}
export function longDate(s: string) { const d = parseD(s); return d.getDate() + ' ' + LMON[d.getMonth()] + ' ' + d.getFullYear() + ', ' + LDAY[d.getDay()]; }
function fmtStamp(s: string | null) {
  if (!s) return '';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '';
  return d.getDate() + ' ' + MON[d.getMonth()] + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function PersonOptions({ team }: { team: Member[] }) {
  return <>{team.map((m) => <option value={m.id}>{m.name}{m.status === 'pending' ? ' (davet bekliyor)' : ''}</option>)}</>;
}

// ---------- gün ekle / düzenle ----------
export function DayForm({ day, onClose, onSaved }: { day: SDay | null; onClose: () => void; onSaved: (d: SDay) => void }) {
  const [f, setF] = useState({
    name: day?.name || '', date: day?.date || '', rangeLabel: day?.rangeLabel || '', tone: day?.tone || 'bilgi', star: day?.star || false, note: day?.note || '',
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: unknown) => { setF({ ...f, [k]: v }); setErr(''); };
  async function save(e?: Event) {
    e?.preventDefault();
    if (!f.name.trim()) { setErr('Özel günün adını yaz.'); return; }
    if (!f.date) { setErr('Tarih seç.'); return; }
    setBusy(true);
    try {
      const d = day ? await api<SDay>('PATCH', '/days/' + day.id, f) : await api<SDay>('POST', '/days', f);
      snack(day ? 'Özel gün güncellendi' : 'Özel gün eklendi');
      onSaved(d);
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <Modal title={day ? 'Özel günü düzenle' : 'Yeni özel gün'} onClose={onClose} width={560}>
      <form style="display:flex;flex-direction:column;gap:14px" onSubmit={save}>
        <label class="field">Özel günün adı *
          <input class={'input' + (err && !f.name.trim() ? ' err' : '')} value={f.name} autoFocus maxLength={200} placeholder="Örn. Firma kuruluş yıl dönümü" onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
        </label>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
          <label class="field">Paylaşım tarihi *
            <input type="date" class={'input' + (err && !f.date ? ' err' : '')} value={f.date} onInput={(e) => set('date', (e.target as HTMLInputElement).value)} />
          </label>
          <label class="field"><span>Tarih etiketi <span style="font-weight:500;color:var(--mute2)">· hafta / ay için</span></span>
            <input class="input" value={f.rangeLabel} maxLength={60} placeholder="Örn. 3–9 Kasım" onInput={(e) => set('rangeLabel', (e.target as HTMLInputElement).value)} />
          </label>
        </div>
        <div class="field">Tür
          <div class="row" style="gap:8px">
            <div class="seg" role="group" aria-label="Tür" style="flex-wrap:wrap">
              {TONES.map((t) => <button type="button" class={f.tone === t.k ? 'on' : ''} aria-pressed={f.tone === t.k} onClick={() => set('tone', t.k)}>{t.label}</button>)}
            </div>
            <button type="button" class={'btn sm' + (f.star ? ' primary' : '')} aria-pressed={f.star} onClick={() => set('star', !f.star)}>
              <span aria-hidden="true">★</span> Önemli gün
            </button>
          </div>
        </div>
        <label class="field">Not / kurallar
          <textarea class="input" rows={3} value={f.note} maxLength={2000} placeholder="Örn. Siyah-beyaz story, resmî dil…" onInput={(e) => set('note', (e.target as HTMLTextAreaElement).value)} />
        </label>
        {f.date && <span class="sub">Hazırlık son tarihi paylaşımdan 2 iş günü önce olarak hesaplanır.</span>}
        {err && <span class="errtext" role="alert">{err}</span>}
        <div class="row"><span class="spacer" /><button type="button" class="btn" onClick={onClose}>Vazgeç</button><button type="submit" class="btn primary" disabled={busy}>{day ? 'Kaydet' : 'Özel günü ekle'}</button></div>
      </form>
    </Modal>
  );
}

// ---------- firma ekle: müşteri listesinden tek tek ----------
interface Pick { client: string; format: string; lang: string; assigneeId: string }
export function AddFirms({ day, onClose, onSaved }: { day: SDay; onClose: () => void; onSaved: (d: SDay) => void }) {
  const s = useStore();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<Pick[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const have = new Set(day.rows.map((r) => lower(r.client)));
  const avail = s.clients.filter((c) => !have.has(lower(c.name))).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  const shown = avail.filter((c) => !q || lower(c.name).includes(lower(q)));
  const isOn = (n: string) => picked.some((p) => p.client === n);
  const toggle = (n: string) => { setErr(''); setPicked(isOn(n) ? picked.filter((p) => p.client !== n) : [...picked, { client: n, format: 'Story', lang: 'TR', assigneeId: '' }]); };
  const upd = (n: string, k: keyof Pick, v: string) => setPicked(picked.map((p) => (p.client === n ? { ...p, [k]: v } : p)));
  async function save(e?: Event) {
    e?.preventDefault();
    if (!picked.length) { setErr('En az bir firma seç.'); return; }
    setBusy(true);
    try {
      const d = await api<SDay>('POST', `/days/${day.id}/rows`, { rows: picked.map((p) => ({ ...p, assigneeId: p.assigneeId || null })) });
      const me = store.get().me!.id;
      const notified = new Set(picked.filter((p) => p.assigneeId && p.assigneeId !== me).map((p) => p.assigneeId));
      snack(picked.length + ' firma eklendi' + (notified.size ? ' · ' + [...notified].map((id) => memberName(s.team, id)).join(', ') + ' bildirim aldı' : ''));
      onSaved(d);
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <Modal title={'Firma ekle · ' + day.name} onClose={onClose} width={640}>
      <form style="display:flex;flex-direction:column;gap:14px" onSubmit={save}>
        <label class="og-search">
          <Icon n="search" size={16} /><span class="sr">Firma ara</span>
          <input type="search" value={q} autoFocus placeholder="Firma ara…" onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (shown.length === 1) { toggle(shown[0].name); setQ(''); } } }} />
        </label>
        <div class="og-pick" role="group" aria-label="Müşteriler">
          {shown.map((c) => {
            const on = isOn(c.name);
            return (
              <button type="button" class={'check' + (on ? ' on' : '')} role="checkbox" aria-checked={on} onClick={() => toggle(c.name)}>
                <span class="box">{on && <Icon n="check" size={14} stroke="#fff" w={3} />}</span>{c.name}
              </button>
            );
          })}
          {shown.length === 0 && <p class="empty">{avail.length ? 'Aramaya uyan firma yok.' : s.clients.length ? 'Bütün firmalar bu güne eklenmiş.' : 'Müşteri listesi boş.'}</p>}
        </div>
        {picked.length > 0 && (
          <div class="og-picked">
            <span class="sub">Seçilen {picked.length} firma · biçim, dil ve sorumlu her firma için ayrı (sorumlu boş kalabilir)</span>
            {picked.map((p) => (
              <div class="pr">
                <strong>{p.client}</strong>
                <select aria-label={p.client + ' biçim'} value={p.format} onChange={(e) => upd(p.client, 'format', (e.target as HTMLSelectElement).value)}>
                  {FORMATS.map((x) => <option value={x}>{x}</option>)}
                </select>
                <input aria-label={p.client + ' dil'} list="og-langs" value={p.lang} maxLength={20} onInput={(e) => upd(p.client, 'lang', (e.target as HTMLInputElement).value)} />
                <select aria-label={p.client + ' sorumlu'} value={p.assigneeId} onChange={(e) => upd(p.client, 'assigneeId', (e.target as HTMLSelectElement).value)}>
                  <option value="">Sorumlu seçilmedi</option><PersonOptions team={s.team} />
                </select>
                <button type="button" class="iconbtn" style="width:32px;height:32px" aria-label={p.client + ' seçimini kaldır'} onClick={() => toggle(p.client)}><Icon n="x" size={14} /></button>
              </div>
            ))}
          </div>
        )}
        <datalist id="og-langs">{LANGS.map((l) => <option value={l} />)}</datalist>
        {err && <span class="errtext" role="alert">{err}</span>}
        <div class="row"><span class="spacer" /><button type="button" class="btn" onClick={onClose}>Vazgeç</button>
          <button type="submit" class="btn primary" disabled={busy || !picked.length}>{picked.length ? picked.length + ' firmayı ekle' : 'Firma seç'}</button></div>
      </form>
    </Modal>
  );
}

// ---------- gün detayı ----------
export function DayDetail({ day, onBack, onChange, onEdit, onDeleted, openTask }: {
  day: SDay; onBack: () => void; onChange: (d: SDay) => void; onEdit: () => void; onDeleted: () => void; openTask: (id: string) => void;
}) {
  const s = useStore();
  const me = s.me!;
  const [filter, setFilter] = useState<'all' | 'left' | 'done'>('all');
  const [confirmDel, setConfirmDel] = useState(false);
  const [adding, setAdding] = useState(false);
  useEffect(() => { setConfirmDel(false); setFilter('all'); }, [day.id]);
  const total = day.rows.length;
  const ready = day.rows.filter((r) => r.status === 2).length;
  const prep = prepTag(day, total - ready);
  const split = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of day.rows) m.set(r.assigneeId || '', (m.get(r.assigneeId || '') || 0) + 1);
    return [...m.entries()];
  }, [day.rows]);
  const rows = day.rows.filter((r) => filter === 'all' || (filter === 'done' ? r.status === 2 : r.status !== 2));
  const dd = Math.round((parseD(day.date).getTime() - parseD(todayIso()).getTime()) / 864e5);

  async function del() {
    try { await api('DELETE', '/days/' + day.id); snack('Özel gün silindi'); onDeleted(); }
    catch (e: any) { snack(e.message); }
  }

  return (
    <section class="og-panel" aria-label={day.name}>
      <div class="row" style="gap:8px">
        <button type="button" class="btn sm og-back" onClick={onBack}>← Liste</button>
        <span class="sub">{longDate(day.date)}</span>
        {dd === 0 && <span class="daytag">Bugün</span>}
        {dd === 1 && <span class="daytag">Yarın</span>}
        <span class={'tone ' + day.tone}>{toneLabel(day.tone)}</span>
        {day.star && <span class="chip" style="color:#9A6A12"><span aria-hidden="true">★</span> Önemli</span>}
        {day.rangeLabel && <span class="chip">{day.rangeLabel}</span>}
        <span class="spacer" />
        <button type="button" class="iconbtn" aria-label="Detayı kapat" onClick={onBack}><Icon n="x" size={16} /></button>
      </div>
      <div class="row" style="align-items:flex-start">
        <h2 style="flex:1 1 240px">{day.name}</h2>
        <div class="row" style="gap:8px">
          <button type="button" class="btn sm" onClick={onEdit}>Adı / tarihi düzenle</button>
          {!confirmDel
            ? <button type="button" class="btn sm danger" onClick={() => setConfirmDel(true)}>Sil</button>
            : <><button type="button" class="btn sm" onClick={() => setConfirmDel(false)}>Vazgeç</button><button type="button" class="btn sm danger confirm" onClick={del}>Evet, günü sil</button></>}
        </div>
      </div>
      {confirmDel && <span class="errtext" role="alert">Bu özel gün ve {total} firma satırı silinecek. İş Planı'na gönderilen işler yerinde kalır.</span>}

      <div class="og-info">
        <div><span class="k">Hazırlık son tarihi</span><span class={'v prep ' + prep.cls}>{fmtDate(day.prepDate)}{prep.cls === 'late' ? ' · gecikti' : prep.cls === 'today' ? ' · bugün' : ''}</span><span class="sub">Paylaşımdan 2 iş günü önce</span></div>
        <div><span class="k">İlerleme</span><span class="v">{ready} / {total} hazır</span><span class="og-bar"><span style={{ width: total ? Math.round((ready / total) * 100) + '%' : '0%' }} /></span></div>
        <div><span class="k">Görev dağılımı</span>
          <span class="row" style="gap:6px">
            {split.length === 0 && <span class="og-nofirm">Firma yok</span>}
            {split.map(([id, n]) => {
              const m = s.team.find((x) => x.id === id);
              return <span class="chip" title={id ? memberName(s.team, id) : 'Atanmamış'} style="padding:2px 8px 2px 3px">{m ? <Avatar m={m} size={20} radius={6} /> : <span class="av" style="width:20px;height:20px;border-radius:6px;background:var(--beige);color:var(--mute);font-size:10px">?</span>}{n}</span>;
            })}
          </span>
        </div>
      </div>
      {day.note && <div class="og-note">{day.note}</div>}

      <div class="row" style="gap:8px">
        <strong style="font-size:15px">Firmalar <span style="font-weight:500;color:var(--mute2)">{total}</span></strong>
        {total > 0 && (
          <div class="seg" role="group" aria-label="Firma filtresi">
            {([['all', 'Tümü'], ['left', 'Kalanlar ' + (total - ready)], ['done', 'Hazır ' + ready]] as const).map(([k, l]) => (
              <button type="button" class={filter === k ? 'on' : ''} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        )}
        <span class="spacer" />
        <button type="button" class="btn primary sm" onClick={() => setAdding(true)}><Icon n="plus" size={14} />Firma ekle</button>
      </div>
      <div class="og-rows">
        {rows.map((r) => <RowItem key={day.id + '|' + r.client} day={day} r={r} meId={me.id} onChange={onChange} openTask={openTask} />)}
        {total === 0 && <p class="empty" style="padding:4px">Bu güne henüz firma eklenmedi. "Firma ekle" ile müşteri listesinden tek tek seç; sorumluyu da sen belirle.</p>}
        {total > 0 && rows.length === 0 && <p class="empty" style="padding:4px">Bu filtrede firma yok.</p>}
      </div>
      <datalist id="og-langs-row">{LANGS.map((l) => <option value={l} />)}</datalist>
      {adding && <AddFirms day={day} onClose={() => setAdding(false)} onSaved={(d) => { setAdding(false); onChange(d); }} />}
    </section>
  );
}

function RowItem({ day, r, meId, onChange, openTask }: { day: SDay; r: SRow; meId: string; onChange: (d: SDay) => void; openTask: (id: string) => void }) {
  const s = useStore();
  const [lang, setLang] = useState(r.lang);
  const [confirmRm, setConfirmRm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setLang(r.lang), [r.lang]);
  const path = `/days/${day.id}/rows/${encodeURIComponent(r.client)}`;
  async function patch(body: Record<string, unknown>, msg?: string) {
    setBusy(true);
    try { onChange(await api<SDay>('PATCH', path, body)); if (msg) snack(msg); }
    catch (e: any) { snack(e.message); setLang(r.lang); }
    finally { setBusy(false); }
  }
  async function saveLang() {
    const v = lang.trim().toLocaleUpperCase('tr');
    if (v === r.lang) return;
    await patch({ lang: v || 'TR' });
  }
  async function remove() {
    try { onChange(await api<SDay>('DELETE', path)); snack(r.client + ' kaldırıldı'); } catch (e: any) { snack(e.message); }
  }
  async function sendTask() {
    setBusy(true);
    try {
      const res = await api<{ taskId: string; day: SDay }>('POST', path + '/task');
      onChange(res.day);
      reloadTasks().catch(() => {});
      snack("İş Planı'na gönderildi" + (r.assigneeId && r.assigneeId !== meId ? ' · ' + memberName(s.team, r.assigneeId) + ' bildirim aldı' : ''));
    } catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  const taskExists = !!r.taskId && s.tasks.some((t) => t.id === r.taskId);
  const doneBy = s.team.find((m) => m.id === r.doneBy);
  const st = r.status === 2 ? { l: 'Hazırlandı', c: 'var(--green-dot)' } : r.status === 1 ? { l: 'Hazırlanıyor', c: 'var(--accent)' } : { l: 'Bekliyor', c: 'var(--wait)' };
  return (
    <div class={'og-row' + (r.status === 2 ? ' done' : '')}>
      <div class="top">
        <span class="firm" title={r.client}>{r.client}</span>
        <span class="og-st"><span class="dot" style={{ background: st.c }} />{st.l}</span>
        {!confirmRm
          ? <button type="button" class="iconbtn" style="width:30px;height:30px" aria-label={r.client + ' firmasını kaldır'} onClick={() => setConfirmRm(true)}><Icon n="x" size={14} /></button>
          : <span class="row" style="gap:6px"><button type="button" class="btn sm" onClick={() => setConfirmRm(false)}>Vazgeç</button><button type="button" class="btn sm danger confirm" onClick={remove}>Kaldır</button></span>}
      </div>
      <div class="ctl">
        <label>Biçim
          <select value={r.format} disabled={busy} onChange={(e) => patch({ format: (e.target as HTMLSelectElement).value })}>
            {FORMATS.map((x) => <option value={x}>{x}</option>)}
          </select>
        </label>
        <label>Dil
          <input list="og-langs-row" value={lang} maxLength={20} aria-label={r.client + ' dil'} onInput={(e) => setLang((e.target as HTMLInputElement).value)}
            onBlur={saveLang} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } if (e.key === 'Escape') { setLang(r.lang); } }} />
        </label>
        <label class={'person' + (r.assigneeId ? '' : ' unset')}>
          {r.assigneeId ? <Avatar m={s.team.find((m) => m.id === r.assigneeId)} size={20} radius={6} /> : <Icon n="user" size={14} />}
          <span class="sr">Sorumlu</span>
          <select value={r.assigneeId || ''} disabled={busy} aria-label={r.client + ' sorumlu'} onChange={(e) => {
            const v = (e.target as HTMLSelectElement).value || null;
            patch({ assigneeId: v }, v ? (v === meId ? 'Sorumlu: sen' : memberName(s.team, v) + ' sorumlu · bildirim gitti') : 'Sorumlu kaldırıldı');
          }}>
            <option value="">Sorumlu seç…</option><PersonOptions team={s.team} />
          </select>
        </label>
      </div>
      <div class="act">
        {r.status === 0 && <button type="button" class="btn sm" disabled={busy} onClick={() => patch({ status: 1 })}>Başladım</button>}
        {r.status !== 2
          ? <button type="button" class="btn sm ok" disabled={busy} onClick={() => patch({ status: 2 }, r.client + ' hazır')}><Icon n="check" size={14} />Hazırladım</button>
          : <button type="button" class="btn sm" disabled={busy} onClick={() => patch({ status: 0 }, 'Geri alındı')}>Geri al</button>}
        {r.status === 2 && <span class="who">{doneBy && <Avatar m={doneBy} size={18} radius={5} />}{memberName(s.team, r.doneBy)} hazırladı · {fmtStamp(r.doneAt)}</span>}
        <span class="spacer" />
        {taskExists
          ? <button type="button" class="btn sm ghost" onClick={() => openTask(r.taskId!)}><Icon n="board" size={14} />İş Planı'nda</button>
          : <button type="button" class="btn sm ghost" disabled={busy} onClick={sendTask} title="Bu satır için İş Planı'nda iş oluştur">İş Planı'na gönder</button>}
      </div>
    </div>
  );
}
