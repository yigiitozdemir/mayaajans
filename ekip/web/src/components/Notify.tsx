import { useState } from 'preact/hooks';
import { api, closeToast, reloadNotifications, store, memberName } from '../api';
import { Avatar, Icon, navigate, useStore } from '../ui';

// Bildirimin gideceği yer: iş → iş detayı; link → o sayfa; eski kayıtlarda link yoksa türüne göre
const KIND_PAGE: Record<string, string> = { nudge: '/durt', morning: '/', reminder: '/ajanda', shoot: '/cekim', special: '/ozel-gunler', approval: '/isler', chat: '/sohbet' };
export function openNotification(n: { id: string; taskId?: string | null; link?: string | null; kind?: string; readAt?: string | null }, onOpenTask: (id: string) => void) {
  if (!n.readAt) {
    store.set({ notifications: store.get().notifications.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)) });
    api('POST', '/notifications/read', { id: n.id }).catch(() => {});
  }
  if (n.taskId) { onOpenTask(n.taskId); return; }
  const to = n.link || (n.kind ? KIND_PAGE[n.kind] : '');
  if (to) navigate(to);
}

// Okunmamış atamayı okundu say (işi açınca çağrılır)
export async function markTaskRead(taskId: string) {
  const s = store.get();
  if (!s.notifications.some((n) => n.taskId === taskId && !n.readAt)) return;
  store.set({ notifications: s.notifications.map((n) => (n.taskId === taskId && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n)) });
  await api('POST', '/notifications/read', { taskId }).catch(() => {});
}

export function Bell({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const s = useStore();
  const [open, setOpen] = useState(false);
  const unread = s.notifications.filter((n) => !n.readAt).length;
  const me = s.me!;
  const remindOn = me.settings.remindHourly !== false;
  return (
    <>
      <button type="button" class="bell" aria-label={'Bildirimler' + (unread ? ', ' + unread + ' okunmamış' : '')} aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon n="bell" size={20} />
        {unread > 0 && <span class="n">{unread}</span>}
      </button>
      {open && (
        <div class="bellpanel" role="dialog" aria-label="Bildirimler">
          <div class="row">
            <strong style="font-size:16px">Bildirimler</strong><span class="spacer" />
            <button type="button" class="btn ghost sm" style="border:0" onClick={async () => { await api('POST', '/notifications/read', { all: true }); reloadNotifications(); }}>Tümünü okundu yap</button>
            <button type="button" class="iconbtn" style="width:32px;height:32px" aria-label="Kapat" onClick={() => setOpen(false)}><Icon n="x" size={14} /></button>
          </div>
          {s.notifications.length === 0 && <p class="empty" style="text-align:center">Yeni bildirim yok.</p>}
          {s.notifications.map((n) => {
            const task = s.tasks.find((t) => t.id === n.taskId);
            return (
              <button type="button" class={'nitem' + (n.readAt ? '' : ' unread')} onClick={() => { setOpen(false); openNotification(n, onOpenTask); }}>
                <Avatar m={s.team.find((m) => m.id === n.actorId)} size={34} />
                <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
                  <span style={'font-size:13px;' + (n.readAt ? 'color:var(--mute)' : 'font-weight:700')}>{n.title}</span>
                  <span style="font-size:13px;color:var(--ink2);line-height:1.4">{task ? task.title + ' · ' + (task.client || '—') : n.body}</span>
                  <span style={'font-size:11px;font-weight:600;color:' + (n.readAt ? 'var(--mute2)' : 'var(--red)')}>
                    {n.readAt ? 'Okundu' : n.kind !== 'assign' ? 'Okunmadı' : remindOn ? 'Okunmadı · işi açana kadar saatte bir hatırlatılır' + (n.reminders ? ' · ' + n.reminders + '. hatırlatma' : '') : 'Okunmadı'}
                    {n.actorId ? ' · ' + memberName(s.team, n.actorId) : ''}
                  </span>
                </span>
                {!n.readAt && <span class="dot" style="background:var(--badge);margin-top:4px" aria-label="Okunmadı" />}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

// Köşe bildirimleri: hiçbir şeyi engellemez, 7 sn sonra kaybolur
export function Toasts({ onOpenTask }: { onOpenTask: (id: string) => void }) {
  const s = useStore();
  if (!s.toasts.length) return null;
  return (
    <div class="toasts" aria-live="polite">
      {s.toasts.map((t) => (
        <div class="toast" role="status">
          <span class="app"><img src="/icon-64.png" alt="" />Maya Ajans<span class="spacer" />şimdi</span>
          <span class="row" style="gap:12px;flex-wrap:nowrap;align-items:flex-start">
            <Avatar m={s.team.find((m) => m.id === t.actorId)} size={40} radius={12} />
            <span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:3px">
              <strong style="font-size:14px">{t.heading}</strong>
              <span style="font-size:13px;color:var(--ink2);line-height:1.4">{t.title}</span>
              {t.meta && <span style="font-size:12px;color:var(--mute2)">{t.meta}</span>}
            </span>
          </span>
          <span class="row" style="gap:8px">
            {t.taskId && <button type="button" class="btn primary sm" style="flex:1" onClick={() => { closeToast(t.id); onOpenTask(t.taskId!); }}>İşi aç</button>}
            {!t.taskId && t.link && <button type="button" class="btn primary sm" style="flex:1" onClick={() => { closeToast(t.id); navigate(t.link!); }}>Aç</button>}
            <button type="button" class="btn sm" style="flex:1" onClick={() => closeToast(t.id)}>Kapat</button>
          </span>
        </div>
      ))}
    </div>
  );
}
