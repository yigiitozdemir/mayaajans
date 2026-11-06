import { useMemo, useState } from 'preact/hooks';
import { api, reloadTasks, snack, type Task, todayIso, dayDiff, memberName } from '../api';
import { Avatar, Icon, useStore } from '../ui';
import { Bell } from '../components/Notify';
import { NewTaskModal, STATUS, dueTag } from '../components/TaskPanels';

const byDateAsc = (a: Task, b: Task) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : (a.dueDate || '9999') > (b.dueDate || '9999') ? 1 : 0;
const byDateDesc = (a: Task, b: Task) => (a.dueDate || '0000') > (b.dueDate || '0000') ? -1 : (a.dueDate || '0000') < (b.dueDate || '0000') ? 1 : 0;
const lower = (s: string) => (s || '').toLocaleLowerCase('tr');

export function IsPlani({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const [view, setView] = useState<'board' | 'list'>('board');
  const [person, setPerson] = useState('all');
  const [firm, setFirm] = useState('all');
  const [q, setQ] = useState('');
  const [quick, setQuick] = useState<string | null>(null);
  const [showAllDone, setShowAllDone] = useState(false);
  const [showDoneList, setShowDoneList] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftDate, setDraftDate] = useState('');
  const [draftErr, setDraftErr] = useState(false);
  const [form, setForm] = useState<Partial<Task> | null>(null);

  const unreadTaskIds = new Set(s.notifications.filter((n) => !n.readAt && n.taskId).map((n) => n.taskId));
  const quickTest: Record<string, (t: Task) => boolean> = {
    late: (t) => t.status !== 2 && !!t.dueDate && dayDiff(t.dueDate) < 0,
    today: (t) => t.status !== 2 && !!t.dueDate && dayDiff(t.dueDate) === 0,
    week: (t) => t.status !== 2 && !!t.dueDate && dayDiff(t.dueDate) > 0 && dayDiff(t.dueDate) <= 7,
    doing: (t) => t.status === 1,
    nodate: (t) => t.status !== 2 && !t.dueDate,
  };
  const scoped = useMemo(() => s.tasks.filter((t) =>
    (person === 'all' || t.assigneeId === person) &&
    (firm === 'all' || t.client === firm || t.items.some((it) => lower(it).includes(lower(firm.split(' ')[0])))) &&
    (!q || lower(t.title + ' ' + t.client + ' ' + t.note + ' ' + t.items.join(' ')).includes(lower(q)))), [s.tasks, person, firm, q]);
  const visible = quick ? scoped.filter(quickTest[quick]) : scoped;
  const open = s.tasks.filter((t) => t.status !== 2);
  const firms = Array.from(new Set([...s.clients.map((c) => c.name), ...s.tasks.map((t) => t.client).filter(Boolean)])).sort((a, b) => a.localeCompare(b, 'tr'));

  async function addQuick() {
    const title = draft.trim(); if (!title) return;
    if (!draftDate) { setDraftErr(true); return; }
    try {
      const assigneeId = person === 'all' ? null : person;
      await api('POST', '/tasks', { title, dueDate: draftDate, client: firm === 'all' ? '' : firm, assigneeId });
      setDraft(''); setDraftDate(''); setDraftErr(false); await reloadTasks();
      snack('İş eklendi' + (assigneeId && assigneeId !== me.id ? ' · ' + memberName(s.team, assigneeId) + ' kişisine bildirim gitti' : ''));
    } catch (e: any) { snack(e.message); }
  }

  const card = (t: Task) => {
    const due = dueTag(t);
    const m = s.team.find((x) => x.id === t.assigneeId);
    return (
      <button type="button" class={'tcard' + (t.status === 2 ? ' done' : '')} onClick={() => openTask(t.id)}>
        <span class="row" style="gap:6px;flex-wrap:nowrap;font-size:12px;color:var(--mute)">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{t.client || '—'}</span>
          {unreadTaskIds.has(t.id) && t.assigneeId === me.id && <span class="newtag">Yeni · sana atandı</span>}
          {t.link && <span style="margin-left:auto;flex:none;color:var(--mute2)"><Icon n="link" size={14} /></span>}
        </span>
        <span class="title">{t.title}</span>
        {t.items.length > 0 && <span class="chip" style="align-self:flex-start;font-size:11px">{t.items.length} firma / kalem</span>}
        {t.status === 2 && t.doneLink && <span class="chip donechip" style="align-self:flex-start;font-size:11px"><Icon n="link" size={12} />Teslim linki var</span>}
        <span class="row" style="justify-content:space-between;flex-wrap:nowrap">
          <span class={'tag ' + due.cls}>{due.label}</span>
          {m && <span title={m.name}><Avatar m={m} size={24} radius={8} /></span>}
        </span>
      </button>
    );
  };

  const stats = [
    { k: 'late', label: 'Geciken', dot: '#f28482' }, { k: 'today', label: 'Bugün teslim', dot: 'var(--accent)' },
    { k: 'week', label: 'Önümüzdeki 7 gün', dot: 'var(--blue)' }, { k: 'doing', label: 'Devam eden', dot: 'var(--accent)' },
    { k: 'nodate', label: 'Tarihi olmayan', dot: 'var(--wait)' },
  ];
  const doneList = visible.filter((t) => t.status === 2).sort(byDateDesc);

  return (
    <div class="page">
      <header class="row" style="align-items:flex-end;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:6px">
          <h1 class="h1">İş Planı</h1>
          <span class="row sub" style="gap:6px"><span class="dot" style={{ background: s.online ? 'var(--green-dot)' : 'var(--red)' }} />{s.online ? 'Canlı · eklenen ve değişen işler ekipteki herkese anında düşer' : 'Bağlantı yok · yeniden bağlanıyor'}</span>
        </div>
        <div class="row">
          <Bell onOpenTask={openTask} />
          <div class="seg" role="group" aria-label="Görünüm">
            <button type="button" class={view === 'board' ? 'on' : ''} aria-pressed={view === 'board'} onClick={() => setView('board')}>Pano</button>
            <button type="button" class={view === 'list' ? 'on' : ''} aria-pressed={view === 'list'} onClick={() => setView('list')}>Liste</button>
          </div>
        </div>
      </header>

      <div class="stats">
        {stats.map((st) => (
          <button type="button" class={'stat' + (quick === st.k ? ' on' : '')} aria-pressed={quick === st.k} onClick={() => setQuick(quick === st.k ? null : st.k)}>
            <span class="row sub" style="gap:8px;color:var(--mute)"><span class="dot" style={{ background: st.dot }} />{st.label}</span>
            <span class="v">{scoped.filter(quickTest[st.k]).length}</span>
          </button>
        ))}
      </div>

      <div class="row">
        <div class="seg" role="group" aria-label="Kişi" style="flex-wrap:wrap">
          <button type="button" class={person === 'all' ? 'on' : ''} onClick={() => setPerson('all')}>Herkes <span style="color:var(--mute2)">{open.length}</span></button>
          {s.team.map((m) => (
            <button type="button" class={person === m.id ? 'on' : ''} onClick={() => setPerson(m.id)} style="display:inline-flex;align-items:center;gap:6px">
              <Avatar m={m} size={20} radius={6} />{m.firstName} <span style="color:var(--mute2)">{open.filter((t) => t.assigneeId === m.id).length}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="row">
        <label class="row" style="flex:2 1 240px;gap:8px;height:42px;padding:0 12px;border-radius:11px;background:var(--card);border:1px solid var(--line);color:var(--mute2)">
          <Icon n="search" size={16} /><span class="sr">İşlerde ara</span>
          <input type="search" value={q} placeholder="İş, firma veya not ara…" style="flex:1;min-width:0;border:0;outline:none;background:transparent" onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        </label>
        <label class="row" style="flex:1 1 200px;gap:8px;height:42px;padding:0 12px;border-radius:11px;background:var(--card);border:1px solid var(--line);color:var(--mute2)">
          <span style="font-size:12px">Firma</span>
          <select value={firm} style="flex:1;min-width:0;border:0;outline:none;background:transparent" onChange={(e) => setFirm((e.target as HTMLSelectElement).value)}>
            <option value="all">Tüm firmalar</option>{firms.map((f) => <option value={f}>{f}</option>)}
          </select>
        </label>
        {(person !== 'all' || firm !== 'all' || q || quick) && <button type="button" class="btn" onClick={() => { setPerson('all'); setFirm('all'); setQ(''); setQuick(null); }}>Filtreleri temizle</button>}
      </div>

      <div class="quick">
        <Icon n="plus" size={16} stroke="var(--accent)" />
        <label style="flex:1 1 220px;display:flex"><span class="sr">Yeni iş</span>
          <input type="text" value={draft} placeholder={'Yeni iş ekle' + (firm !== 'all' ? ' · ' + firm : '') + (person !== 'all' ? ' · ' + memberName(s.team, person) : '') + ' (Enter)'}
            onInput={(e) => setDraft((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addQuick(); } }} />
        </label>
        <label class="row" style={'gap:6px;height:36px;padding:0 8px;border-radius:9px;font-size:12px;color:var(--mute2);border:1px solid ' + (draftErr ? '#f28482' : 'var(--line2)')}>
          Teslim *<input type="date" value={draftDate} min={todayIso()} aria-label="Teslim tarihi" style="border:0;outline:none;background:transparent" onInput={(e) => { setDraftDate((e.target as HTMLInputElement).value); setDraftErr(false); }} />
        </label>
        <button type="button" class="btn sm" onClick={() => setForm({ title: draft, dueDate: draftDate, client: firm === 'all' ? '' : firm, assigneeId: person === 'all' ? null : person })}>Detaylı ekle</button>
        <button type="button" class="btn primary sm" onClick={addQuick}>Ekle</button>
        {draftErr && <span class="errtext" style="font-size:12px" role="alert">Teslim tarihi seç</span>}
      </div>

      {view === 'board' ? (
        <div class="board">
          {[0, 1, 2].map((st) => {
            let list = visible.filter((t) => t.status === st);
            list = st === 2 ? list.sort(byDateDesc) : list.sort(byDateAsc);
            const shown = st === 2 && !showAllDone ? list.slice(0, 6) : list;
            return (
              <section class="col" aria-label={STATUS[st].label}>
                <div class="row" style="gap:8px"><span class="dot" style={{ background: STATUS[st].dot }} /><h2>{STATUS[st].label}</h2><span class="sub">{list.length}</span></div>
                {shown.map(card)}
                {list.length === 0 && <p class="empty" style="padding:4px">Bu filtrede iş yok.</p>}
                {st === 2 && list.length > 6 && <button type="button" class="btn sm" onClick={() => setShowAllDone(!showAllDone)}>{showAllDone ? 'Daha az göster' : 'Tümünü göster (' + list.length + ')'}</button>}
              </section>
            );
          })}
        </div>
      ) : (
        <>
          <ListTable rows={visible.filter((t) => t.status !== 2).sort(byDateAsc)} openTask={openTask} empty="Bu filtrede bekleyen iş yok." />
          {doneList.length > 0 && (
            <section style="display:flex;flex-direction:column;gap:10px">
              <div class="row" style="border-top:1px solid var(--line);padding-top:12px">
                <span class="dot" style="background:var(--green-dot)" /><strong style="font-size:15px">Tamamlanan <span style="font-weight:500;color:var(--mute2)">{doneList.length}</span></strong>
                <span class="sub">En yeni teslim tarihi üstte</span><span class="spacer" />
                <button type="button" class="btn sm" onClick={() => setShowDoneList(!showDoneList)}>{showDoneList ? 'Gizle' : 'Göster'}</button>
              </div>
              {showDoneList && <ListTable rows={doneList} openTask={openTask} empty="" muted />}
            </section>
          )}
        </>
      )}
      {form && <NewTaskModal initial={form} onClose={() => { setForm(null); setDraft(''); setDraftDate(''); }} />}
    </div>
  );
}

function ListTable({ rows, openTask, empty, muted }: { rows: Task[]; openTask: (id: string) => void; empty: string; muted?: boolean }) {
  const s = useStore();
  return (
    <div class="card" style={'overflow-x:auto;' + (muted ? 'opacity:.85' : '')}>
      <table class="table">
        <thead><tr><th scope="col">İş</th><th scope="col">Firma</th><th scope="col">Sorumlu</th><th scope="col">Teslim</th><th scope="col">Durum</th></tr></thead>
        <tbody>
          {rows.map((t) => {
            const due = dueTag(t);
            return (
              <tr>
                <td style="max-width:380px"><button type="button" class="linkbtn" onClick={() => openTask(t.id)}>{t.title}</button></td>
                <td style="color:var(--mute);white-space:nowrap">{t.client || '—'}</td>
                <td style="color:var(--mute);white-space:nowrap">{memberName(s.team, t.assigneeId)}</td>
                <td style="white-space:nowrap"><span class={'tag ' + due.cls}>{due.label}</span></td>
                <td style="white-space:nowrap;color:var(--mute)"><span class="dot" style={{ background: STATUS[t.status].dot, display: 'inline-block', marginRight: '6px' }} />{STATUS[t.status].label}
                  {t.status === 2 && t.doneLink && (
                    <button type="button" class="btn sm" style="margin-left:10px" aria-label={'Teslim linkini kopyala: ' + t.title}
                      onClick={async () => { try { await navigator.clipboard.writeText(t.doneLink); snack('Teslim linki kopyalandı'); } catch { snack('Kopyalanamadı'); } }}>
                      <Icon n="copy" size={13} />Linki kopyala
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && empty && <p class="empty">{empty}</p>}
    </div>
  );
}
