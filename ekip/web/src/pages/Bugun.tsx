import { useState } from 'preact/hooks';
import { type Task, dayDiff, fmtDate, DAY, LDAY, LMON, memberName, parseD, todayIso } from '../api';
import { Icon, Link, useStore } from '../ui';
import { Bell } from '../components/Notify';

export function Bugun({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const [scope, setScope] = useState<'me' | 'team'>('me');
  const team = scope === 'team';
  const mine = s.tasks.filter((t) => t.status !== 2 && (team || t.assigneeId === me.id));
  const byD = (a: Task, b: Task) => ((a.dueDate || '') < (b.dueDate || '') ? -1 : 1);
  const todayT = mine.filter((t) => t.dueDate && dayDiff(t.dueDate) === 0);
  const late = mine.filter((t) => t.dueDate && dayDiff(t.dueDate) < 0).sort(byD);
  const next = mine.filter((t) => t.dueDate && dayDiff(t.dueDate) > 0 && dayDiff(t.dueDate) <= 3).sort(byD);
  const noDate = mine.filter((t) => !t.dueDate);
  const unread = s.notifications.filter((n) => !n.readAt && n.taskId);
  const who = (t: Task) => (team ? memberName(s.team, t.assigneeId) + ' · ' : '');
  const status = (t: Task) => (t.status === 1 ? 'devam ediyor' : 'beklemede');

  const blocks = [
    { title: 'Bugün teslim', dot: 'var(--accent)', items: todayT.map((t) => ({ id: t.id, title: t.title, sub: who(t) + (t.client || '—') + ' · ' + status(t), tag: 'Bugün', cls: 'today' })), empty: 'Bugün teslim edilecek işin yok.' },
    { title: 'Geciken', dot: '#f28482', warn: late.length > 0, items: late.map((t) => ({ id: t.id, title: t.title, sub: who(t) + (t.client || '—'), tag: 'Gecikti · ' + fmtDate(t.dueDate!), cls: 'late' })), empty: 'Geciken işin yok.' },
    { title: 'Önümüzdeki 3 gün', dot: 'var(--blue)', items: next.map((t) => ({ id: t.id, title: t.title, sub: who(t) + (t.client || '—'), tag: DAY[parseD(t.dueDate!).getDay()] + ' · ' + fmtDate(t.dueDate!), cls: 'soon' })), empty: 'Yakın teslim yok.' },
    ...(!team ? [{ title: 'Okunmamış atamalar', dot: 'var(--badge)', items: unread.map((n) => { const t = s.tasks.find((x) => x.id === n.taskId); return { id: n.taskId!, title: t?.title || n.body, sub: (t?.client || '—') + (n.actorId ? ' · ' + memberName(s.team, n.actorId) : ''), tag: 'Okunmadı', cls: 'late' }; }), empty: 'Okunmamış atama yok.' }] : []),
  ];
  const parts = [todayT.length ? todayT.length + ' teslim' : 'bugün teslim yok'];
  if (late.length) parts.push(late.length + ' geciken iş');
  if (!team && unread.length) parts.push(unread.length + ' okunmamış atama');
  const d = parseD(todayIso());

  return (
    <div class="page">
      <header class="row" style="align-items:flex-start;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:8px">
          <span class="sub">{d.getDate()} {LMON[d.getMonth()]} {d.getFullYear()} · {LDAY[d.getDay()]}</span>
          <h1 class="h1" style="font-size:38px">Günaydın, {me.firstName}</h1>
          <p style="margin:0;font-size:16px;color:var(--mute)">{(team ? 'Ekipte bugün: ' : 'Bugün: ') + parts.join(' · ') + '.'}</p>
          <div class="seg" style="align-self:flex-start;margin-top:6px" role="group" aria-label="Kapsam">
            <button type="button" class={!team ? 'on' : ''} onClick={() => setScope('me')}>Benim günüm</button>
            <button type="button" class={team ? 'on' : ''} onClick={() => setScope('team')}>Tüm ekip</button>
          </div>
        </div>
        <Bell onOpenTask={openTask} />
      </header>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;align-items:start">
        {blocks.map((b) => (
          <section class="card" style={'padding:16px;display:flex;flex-direction:column;gap:6px;' + ((b as any).warn ? 'border-color:rgba(242,132,130,.4)' : '')}>
            <div class="row" style="gap:8px"><span class="dot" style={{ background: b.dot }} /><h2 style="margin:0;font-size:14px;font-weight:800;flex:1">{b.title} <span style="font-weight:500;color:var(--mute2)">{b.items.length}</span></h2><Link href="/isler" class="sub">İş Planı</Link></div>
            {b.items.map((it) => (
              <button type="button" onClick={() => openTask(it.id)} style="display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 0;border:0;border-top:1px solid var(--line);background:transparent;text-align:left">
                <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;font-weight:600;line-height:1.35">{it.title}</span><span class="sub" style="font-size:12px">{it.sub}</span></span>
                <span class={'tag ' + it.cls} style="font-size:11px">{it.tag}</span>
              </button>
            ))}
            {b.items.length === 0 && <p class="empty" style="padding:8px 0 2px">{b.empty}</p>}
          </section>
        ))}
      </div>
      {noDate.length > 0 && (
        <Link href="/isler" class="row nodatelink">
          <span style="display:flex;gap:10px;padding:14px 16px;border-radius:14px;background:rgba(242,132,130,.08);border:1px dashed rgba(242,132,130,.4);color:#8E2F27;font-size:13px;line-height:1.5">
            <Icon n="cal" size={16} stroke="var(--red)" />
            {(team ? 'Ekipte ' : '') + noDate.length + ' açık işin teslim tarihi yok. Tarih girilmeyen işler sabah özetine ve hatırlatmalara giremez; İş Planı\'nda tarih ver.'}
          </span>
        </Link>
      )}
    </div>
  );
}
