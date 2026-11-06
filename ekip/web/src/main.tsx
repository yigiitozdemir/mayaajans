import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles.css';
import { connectLive, disconnectLive, loadAll, loadMe, store } from './api';
import { applyTheme, themePref, type ThemePref } from './theme';
import { navigate, usePath, useStore } from './ui';
import { Shell } from './components/Shell';
import { Toasts } from './components/Notify';
import { NewTaskModal, TaskDrawer } from './components/TaskPanels';
import { isDesktop, onDesktopEvent, setDesktopUnread } from './desktop';
import { Login, Invite } from './pages/Auth';
import { Bugun } from './pages/Bugun';
import { IsPlani } from './pages/IsPlani';
import { Ekip } from './pages/Ekip';
import { OzelGunler } from './pages/OzelGunler';
import { Cekim } from './pages/Cekim';
import { Musteriler } from './pages/Musteriler';
import { Sohbet } from './pages/Sohbet';
import { Durt } from './pages/Durt';
import { Ajanda } from './pages/Ajanda';
import { YapayZeka } from './pages/YapayZeka';
import { EkranGoruntuleri, ShotWatcher } from './pages/EkranGoruntuleri';
import { NudgeReceiver } from './components/NudgeReceiver';
import { ChatUnread } from './components/ChatUnread';

function App() {
  const s = useStore();
  const path = usePath();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newTask, setNewTask] = useState(false);

  useEffect(() => { loadMe(); applyTheme(themePref()); }, []);
  // hesaptaki tema seçimi başka cihazda değişirse buraya da uygula
  const serverTheme = s.me?.settings?.theme as ThemePref | undefined;
  useEffect(() => { if (serverTheme && serverTheme !== themePref()) applyTheme(serverTheme); }, [serverTheme]);

  // giriş yapıldıysa verileri yükle ve canlı bağlantıyı aç
  useEffect(() => {
    if (!s.me) { disconnectLive(); setLoaded(false); return; }
    let alive = true;
    loadAll().then(() => alive && setLoaded(true)).catch(() => alive && setLoaded(true));
    connectLive();
    if (!isDesktop) try { if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission(); } catch { /* */ }
    return () => { alive = false; };
  }, [s.me?.id]);

  // Mac uygulaması: üst çubuk ve Dock'taki okunmamış sayısı
  const unread = s.me ? s.notifications.filter((n) => !n.readAt).length : 0;
  useEffect(() => { setDesktopUnread(unread); }, [unread]);

  // Mac uygulaması menüsü: "Yeni iş ekle", "Bugün", "İş Planı"
  useEffect(() => onDesktopEvent((e) => {
    if (!store.get().me) return;
    if (e.action === 'new-task') setNewTask(true);
    else if (e.action === 'go') navigate(e.path);
  }), []);

  const invite = /^\/davet\/([A-Za-z0-9_-]+)$/.exec(path);
  if (invite) return <Invite token={invite[1]} />;
  if (!s.ready) return null;
  if (!s.me) { if (path !== '/giris') history.replaceState({}, '', '/giris'); return <Login />; }
  if (path === '/giris') { navigate('/'); return null; }

  const openTask = (id: string) => setTaskId(id);
  let page;
  if (path === '/isler') page = <IsPlani openTask={openTask} />;
  else if (path === '/ekip') page = <Ekip />;
  else if (path === '/ozel-gunler') page = <OzelGunler openTask={openTask} />;
  else if (path === '/cekim') page = <Cekim openTask={openTask} />;
  else if (path === '/musteriler') page = <Musteriler openTask={openTask} />;
  else if (path === '/sohbet') page = <Sohbet openTask={openTask} />;
  else if (path === '/durt') page = <Durt openTask={openTask} />;
  else if (path === '/ajanda') page = <Ajanda openTask={openTask} />;
  else if (path === '/yapay-zeka') page = <YapayZeka openTask={openTask} />;
  else if (path === '/ekran') page = <EkranGoruntuleri openTask={openTask} />;
  else page = <Bugun openTask={openTask} />;

  return (
    <>
      {!s.online && <div class="offline" role="status">Bağlantı yok · değişiklikler bağlanınca güncellenecek</div>}
      <Shell path={path}>{loaded ? page : <div class="page"><span class="sub">Yükleniyor…</span></div>}</Shell>
      {taskId && <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} />}
      {newTask && <NewTaskModal onClose={() => setNewTask(false)} />}
      <Toasts onOpenTask={openTask} />
      <NudgeReceiver />
      <ChatUnread />
      <ShotWatcher />
      {s.snack && <div class="snack" role="status">{s.snack}</div>}
    </>
  );
}

render(<App />, document.getElementById('app')!);
