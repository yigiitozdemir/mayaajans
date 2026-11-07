import { useState } from 'preact/hooks';
import { type Task, dayDiff, fmtDate, DAY, LDAY, LMON, memberName, parseD, todayIso } from '../api';
import { Icon, Link, useStore } from '../ui';
import { Bell } from '../components/Notify';
import { DuyuruBandi } from '../components/DuyuruBandi';
import { HaftaninYildizi } from '../components/HaftaninYildizi';
import { BugunToplantilar } from './Toplantilar';
import { ClientMark } from '../components/ClientMark';
import { dueTag } from '../components/TaskPanels';
import { bySentAsc, daysLabel, sentAge, waitingApproval } from '../components/Onay';

export function Bugun({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const [scope, setScope] = useState<'me' | 'team'>('me');
  const [allFilter, setAllFilter] = useState<'all' | 0 | 1>('all');
  const team = scope === 'team';
  const mine = s.tasks.filter((t) => t.status !== 2 && (team || t.assigneeId === me.id));
  const byD = (a: Task, b: Task) => ((a.dueDate || '') < (b.dueDate || '') ? -1 : 1);
  const todayT = mine.filter((t) => t.dueDate && dayDiff(t.dueDate) === 0);
  const late = mine.filter((t) => t.dueDate && dayDiff(t.dueDate) < 0).sort(byD);
  const next = mine.filter((t) => t.dueDate && dayDiff(t.dueDate) > 0 && dayDiff(t.dueDate) <= 3).sort(byD);
  const noDate = mine.filter((t) => !t.dueDate);
  const unread = s.notifications.filter((n) => !n.readAt && n.taskId && n.kind === 'assign');
  // müşteri onayı bekleyenler: en eski gönderilen üstte, 3 günü geçen kırmızı
  const waiting = s.tasks.filter((t) => waitingApproval(t) && (team || t.assigneeId === me.id || (!t.assigneeId && t.createdBy === me.id))).sort(bySentAsc);
  const waitingLate = waiting.filter((t) => sentAge(t).late);
  const who = (t: Task) => (team ? memberName(s.team, t.assigneeId) + ' · ' : '');
  const status = (t: Task) => (t.status === 1 ? 'devam ediyor' : 'beklemede');

  const blocks = [
    { title: 'Bugün teslim', dot: 'var(--accent)', items: todayT.map((t) => ({ id: t.id, client: t.client, title: t.title, sub: who(t) + (t.client || '—') + ' · ' + status(t), tag: 'Bugün', cls: 'today' })), empty: 'Bugün teslim edilecek işin yok.' },
    { title: 'Geciken', dot: '#f28482', warn: late.length > 0, items: late.map((t) => ({ id: t.id, client: t.client, title: t.title, sub: who(t) + (t.client || '—'), tag: 'Gecikti · ' + fmtDate(t.dueDate!), cls: 'late' })), empty: 'Geciken işin yok.' },
    { title: 'Önümüzdeki 3 gün', dot: 'var(--blue)', items: next.map((t) => ({ id: t.id, client: t.client, title: t.title, sub: who(t) + (t.client || '—'), tag: DAY[parseD(t.dueDate!).getDay()] + ' · ' + fmtDate(t.dueDate!), cls: 'soon' })), empty: 'Yakın teslim yok.' },
    { title: 'Onay bekleyenler', dot: 'var(--amber)', warn: waitingLate.length > 0, items: waiting.map((t) => ({ id: t.id, client: t.client, title: t.title, sub: who(t) + (t.client || '—') + (t.revisions ? ' · revize ×' + t.revisions : ''), tag: 'Onayda · ' + daysLabel(t), cls: sentAge(t).late ? 'late' : 'soon' })), empty: team ? 'Ekipte müşteri onayı bekleyen iş yok.' : 'Müşteri onayı bekleyen işin yok.' },
    ...(!team ? [{ title: 'Okunmamış atamalar', dot: 'var(--badge)', items: unread.map((n) => { const t = s.tasks.find((x) => x.id === n.taskId); return { id: n.taskId!, client: t?.client || '', title: t?.title || n.body, sub: (t?.client || '—') + (n.actorId ? ' · ' + memberName(s.team, n.actorId) : ''), tag: 'Okunmadı', cls: 'late' }; }), empty: 'Okunmamış atama yok.' }] : []),
  ];
  const parts = [todayT.length ? todayT.length + ' teslim' : 'bugün teslim yok'];
  if (late.length) parts.push(late.length + ' geciken iş');
  if (waiting.length) parts.push(waiting.length + ' iş onay bekliyor' + (waitingLate.length ? ' (' + waitingLate.length + ' tanesi 3 günü geçti)' : ''));
  if (!team && unread.length) parts.push(unread.length + ' okunmamış atama');
  const d = parseD(todayIso());
  // bana atanan bütün açık işler: tarihe göre, tarihsizler en sonda
  const allMine = s.tasks
    .filter((t) => t.status !== 2 && t.assigneeId === me.id && (allFilter === 'all' || t.status === allFilter))
    .sort((a, b) => (a.dueDate || '9999') < (b.dueDate || '9999') ? -1 : (a.dueDate || '9999') > (b.dueDate || '9999') ? 1 : a.title.localeCompare(b.title, 'tr'));
  const myOpen = s.tasks.filter((t) => t.status !== 2 && t.assigneeId === me.id);
  const doneThisWeek = s.tasks.filter((t) => t.status === 2 && t.assigneeId === me.id && t.completedAt && Date.now() - Date.parse(t.completedAt.replace(' ', 'T') + 'Z') < 7 * 864e5).length;

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
      <DuyuruBandi openTask={openTask} />
      <HaftaninYildizi openTask={openTask} />
      <BugunToplantilar />
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px;align-items:start">
        {blocks.map((b) => (
          <section class="card" style={'padding:16px;display:flex;flex-direction:column;gap:6px;' + ((b as any).warn ? 'border-color:rgba(242,132,130,.4)' : '')}>
            <div class="row" style="gap:8px"><span class="dot" style={{ background: b.dot }} /><h2 style="margin:0;font-size:14px;font-weight:800;flex:1">{b.title} <span style="font-weight:500;color:var(--mute2)">{b.items.length}</span></h2><Link href="/isler" class="sub">İş Planı</Link></div>
            {b.items.map((it) => (
              <button type="button" onClick={() => openTask(it.id)} style="display:flex;align-items:center;gap:10px;min-height:44px;padding:6px 0;border:0;border-top:1px solid var(--line);background:transparent;text-align:left">
                <ClientMark name={(it as any).client} size={26} />
                <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px"><span style="font-size:13px;font-weight:600;line-height:1.35">{it.title}</span><span class="sub" style="font-size:12px">{it.sub}</span></span>
                <span class={'tag ' + it.cls} style="font-size:11px">{it.tag}</span>
              </button>
            ))}
            {b.items.length === 0 && <p class="empty" style="padding:8px 0 2px">{b.empty}</p>}
          </section>
        ))}
      </div>
      {!team && (
        <section class="card allmine" aria-labelledby="maya-tum-islerim">
          <div class="row" style="gap:10px">
            <span class="dot" style="background:var(--accent)" />
            <h2 id="maya-tum-islerim" style="margin:0;font-size:15px;font-weight:800">Bana atanan tüm işler <span style="font-weight:500;color:var(--mute2)">{myOpen.length}</span></h2>
            <span class="sub">{myOpen.filter((t) => t.status === 1).length} devam ediyor · {myOpen.filter((t) => t.status === 0).length} beklemede{doneThisWeek ? ' · bu hafta ' + doneThisWeek + ' tamamladın' : ''}</span>
            <span class="spacer" />
            <div class="seg" role="group" aria-label="Duruma göre süz">
              <button type="button" class={allFilter === 'all' ? 'on' : ''} aria-pressed={allFilter === 'all'} onClick={() => setAllFilter('all')}>Hepsi</button>
              <button type="button" class={allFilter === 1 ? 'on' : ''} aria-pressed={allFilter === 1} onClick={() => setAllFilter(1)}>Devam ediyor</button>
              <button type="button" class={allFilter === 0 ? 'on' : ''} aria-pressed={allFilter === 0} onClick={() => setAllFilter(0)}>Beklemede</button>
            </div>
          </div>
          <div class="allmine-list">
            {allMine.map((t) => {
              const due = dueTag(t);
              return (
                <button type="button" class="allmine-it" onClick={() => openTask(t.id)}>
                  <span class="dot" style={{ background: t.status === 1 ? 'var(--accent)' : 'var(--wait)' }} title={status(t)} />
                  <ClientMark name={t.client} size={26} />
                  <span class="t">
                    <span class="tt">{t.title}</span>
                    <span class="sub" style="font-size:12px">{(t.client || '—') + ' · ' + status(t)}</span>
                  </span>
                  <span class={'tag ' + due.cls} style="font-size:11px">{due.label}</span>
                </button>
              );
            })}
          </div>
          {allMine.length === 0 && <p class="empty" style="padding:6px 0 0">{myOpen.length ? 'Bu durumda işin yok.' : 'Sana atanmış açık iş yok. 🎉'}</p>}
        </section>
      )}
      {noDate.length > 0 && (
        <Link href="/isler" class="row nodatelink">
          <span style="display:flex;gap:10px;padding:14px 16px;border-radius:14px;background:rgba(242,132,130,.08);border:1px dashed rgba(242,132,130,.4);color:var(--red);font-size:13px;line-height:1.5">
            <Icon n="cal" size={16} stroke="var(--red)" />
            {(team ? 'Ekipte ' : '') + noDate.length + ' açık işin teslim tarihi yok. Tarih girilmeyen işler sabah özetine ve hatırlatmalara giremez; İş Planı\'nda tarih ver.'}
          </span>
        </Link>
      )}
    </div>
  );
}
