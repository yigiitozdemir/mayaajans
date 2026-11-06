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
import { YoneticiOzeti } from './pages/YoneticiOzeti';
import { AramaPaleti } from './components/AramaPaleti';
import { PushBanner } from './components/PushToggle';
import { SurumIzleyici } from './components/SurumIzleyici';
import { NudgeReceiver } from './components/NudgeReceiver';
import { ChatUnread } from './components/ChatUnread';
import { Portal } from './pages/Portal';
import { Misafir } from './pages/Misafir';

function App() {
  const s = useStore();
  const path = usePath();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [newTask, setNewTask] = useState(false);

  useEffect(() => { loadMe(); applyTheme(themePref()); }, []);
  // bildirimden gelen bağlantı: herhangi bir sayfada ?is=<id> o işin detayını açar
  useEffect(() => {
    const f = () => { const id = new URLSearchParams(location.search).get('is'); if (id) setTaskId(id); };
    f(); window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); };
  }, []);
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

  // müşteri yetkilisinin (misafir) onay sayfası — ekip programından tamamen ayrı
  if (path === '/misafir') return <><Misafir />{s.snack && <div class="snack" role="status">{s.snack}</div>}</>;
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
  else if (path === '/vatan' && s.me.portals?.includes('vatan')) page = <Portal client="vatan" openTask={openTask} />;
  else if (path === '/yonetici' && s.me.role === 'admin') page = <YoneticiOzeti openTask={openTask} />;
  else if (path === '/yonetici') { history.replaceState({}, '', '/'); page = <Bugun openTask={openTask} />; }
  else page = <Bugun openTask={openTask} />;

  return (
    <>
      <OfflineNote online={s.online} />
      <Shell path={path}>{loaded ? page : <div class="page"><span class="sub">Yükleniyor…</span></div>}</Shell>
      {taskId && <TaskDrawer taskId={taskId} onClose={() => setTaskId(null)} />}
      {newTask && <NewTaskModal onClose={() => setNewTask(false)} />}
      <Toasts onOpenTask={openTask} />
      <NudgeReceiver />
      <ChatUnread />
      <ShotWatcher />
      <AramaPaleti openTask={openTask} />
      <PushBanner />
      <SurumIzleyici />
      {s.snack && <div class="snack" role="status">{s.snack}</div>}
    </>
  );
}

// Kısa kopmalarda (uykudan uyanma, ağ değişimi) uyarı hemen çıkmasın; 4 sn sürerse göster.
function OfflineNote({ online }: { online: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (online) { setShow(false); return; }
    const t = setTimeout(() => setShow(true), 4000);
    return () => clearTimeout(t);
  }, [online]);
  if (!show) return null;
  return <div class="offline" role="status">İnternet bağlantısı bekleniyor… Bağlanınca her şey kendiliğinden güncellenir.</div>;
}

// iPhone: iki parmakla yakınlaştırma hareketini engelle (uygulama gibi sabit dursun)
if (matchMedia('(pointer: coarse)').matches) {
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
}

render(<App />, document.getElementById('app')!);
