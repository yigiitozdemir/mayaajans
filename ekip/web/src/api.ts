import { desktopInvoke, isDesktop } from './desktop';
// Sunucu ile konuşma + ortak uygulama durumu + canlı bağlantı
export interface Me {
  id: string; email: string; firstName: string; lastName: string; photo: string | null; color: string;
  role: 'admin' | 'member'; canEditClients: boolean; settings: Record<string, unknown>; sessionId: string;
  portals?: string[]; // görebildiği müşteri portalları (ör. 'vatan')
}
export interface Member {
  id: string; firstName: string; lastName: string; name: string; color: string; photo: string | null;
  role: 'admin' | 'member'; status: 'pending' | 'active'; canEditClients: boolean; email: string;
  mood?: Mood | null; // kişi durumu: 🎬 Çekimde …
}
export interface Mood { emoji: string; text: string; until: string | null; focus: boolean }
/** Ayarlardaki kişi durumu; süresi dolduysa null. */
export function moodOf(settings: Record<string, unknown> | undefined | null): Mood | null {
  const m = settings?.mood as Mood | undefined;
  if (!m || (!m.emoji && !m.text)) return null;
  if (m.until && Date.parse(m.until) <= Date.now()) return null;
  return m;
}
export interface Task {
  id: string; title: string; client: string; assigneeId: string | null; dueDate: string | null; status: 0 | 1 | 2;
  note: string; items: string[]; link: string; doneLink: string; source: string; createdBy: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null;
  /** İçerik onayı: '' Hazırlanıyor/takipte değil · sent Onaya gönderildi · revision Revize istendi · approved Onaylandı · published Paylaşıldı */
  approval: '' | 'sent' | 'revision' | 'approved' | 'published'; approvalAt: string | null; sentAt: string | null; revisions: number;
}
export interface Notification {
  id: string; kind: string; taskId: string | null; actorId: string | null; title: string; body: string;
  createdAt?: string; readAt: string | null; reminders: number; link?: string | null; meta?: string;
}
export interface Client { id: string; name: string; slack_channel: string | null; logoFileId?: string | null; logoVariant?: string | null; color?: string | null }

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api' + path, {
    method, credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data: any = null;
  try { data = await r.json(); } catch { /* */ }
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/auth/')) store.set({ me: null });
    throw new ApiError(r.status, (data && data.error) || 'Bağlantı hatası');
  }
  return data as T;
}

// ---------- basit ortak durum ----------
export interface State {
  ready: boolean;
  me: Me | null;
  team: Member[];
  tasks: Task[];
  notifications: Notification[];
  clients: Client[];
  online: boolean;
  toasts: { id: string; heading: string; title: string; meta: string; taskId: string | null; actorId: string | null; link?: string | null }[];
  chatUnread: number; // Sohbet: okunmamış mesaj sayısı (menüde)
  presence: string[]; // çevrimiçi kişiler (avatarlardaki yeşil nokta)
  snack: string | null;
}
type Listener = () => void;
let state: State = { ready: false, me: null, team: [], tasks: [], notifications: [], clients: [], online: true, toasts: [], snack: null, chatUnread: 0, presence: [] };
const listeners = new Set<Listener>();
export const store = {
  get: () => state,
  set(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach((l) => l()); },
  subscribe(l: Listener) { listeners.add(l); return () => listeners.delete(l); },
};

let snackTimer: any;
export function snack(msg: string) {
  clearTimeout(snackTimer);
  store.set({ snack: msg });
  snackTimer = setTimeout(() => store.set({ snack: null }), 2800);
}

export function pushToast(t: State['toasts'][number]) {
  store.set({ toasts: [t, ...store.get().toasts].slice(0, 3) });
  setTimeout(() => store.set({ toasts: store.get().toasts.filter((x) => x.id !== t.id) }), 7000);
}
export function closeToast(id: string) { store.set({ toasts: store.get().toasts.filter((x) => x.id !== id) }); }

// ---------- yükleme ----------
export async function loadMe() {
  try { const me = await api<Me>('GET', '/me'); store.set({ me }); return me; }
  catch { store.set({ me: null }); return null; }
  finally { store.set({ ready: true }); }
}
export const reloadTasks = async () => store.set({ tasks: await api<Task[]>('GET', '/tasks') });
export const reloadTeam = async () => store.set({ team: await api<Member[]>('GET', '/team') });
export const reloadNotifications = async () => store.set({ notifications: await api<Notification[]>('GET', '/notifications') });
export const reloadClients = async () => store.set({ clients: await api<Client[]>('GET', '/clients') });
export async function loadAll() {
  await Promise.all([reloadTasks(), reloadTeam(), reloadNotifications(), reloadClients()]);
}


// ---------- masaüstü bildirimi (tarayıcı / Mac uygulaması) ----------
export function systemNotify(title: string, body: string) {
  try {
    if (document.hasFocus()) return;
    if (isDesktop) { desktopInvoke('notify', { title, body }); return; }
    try { if (localStorage.getItem('maya.push') === 'on') return; } catch { /* */ } // bu cihaz push alıyor: çift bildirim olmasın
    if (typeof Notification === 'undefined') return;
    if (Notification.permission === 'granted') new Notification(title, { body, icon: '/icon-192.png' });
  } catch { /* */ }
}

// ---------- canlı bağlantı ----------
/** Canlı olay dinleyicisi. type '*' bağlantı yeniden kurulunca gelir (her şeyi yeniden yükle). */
export function onLive(types: string[], fn: (msg: any) => void): () => void {
  const h = (e: Event) => { const m = (e as CustomEvent).detail; if (m.type === '*' || types.includes(m.type)) fn(m); };
  window.addEventListener('maya-live', h);
  return () => window.removeEventListener('maya-live', h);
}

let ws: WebSocket | null = null;
let retry = 0;
let pingTimer: any;
let stopped = false;
let lastHeard = 0; // sunucudan son haber (mesaj/pong) zamanı
let retryTimer: any;

/** Uygulama öne gelince / internet dönünce: bağlantı kopuk ya da uykuda öldüyse hemen yeniden bağlan. */
function wakeUp() {
  if (stopped || !store.get().me) return;
  const dead = !ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING
    || (ws.readyState === WebSocket.OPEN && Date.now() - lastHeard > 60_000);
  if (!dead) return;
  clearTimeout(retryTimer); retry = 0;
  const old = ws; ws = null;
  if (old) { old.onclose = null; try { old.close(); } catch { /* */ } }
  connectLive();
}
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wakeUp(); });
  window.addEventListener('online', wakeUp);
  window.addEventListener('focus', wakeUp);
}

export function connectLive() {
  stopped = false;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/api/live`);
  ws.onopen = () => {
    lastHeard = Date.now();
    const wasOffline = !store.get().online;
    retry = 0; store.set({ online: true });
    api<string[]>('GET', '/online').then((ids) => Array.isArray(ids) && store.set({ presence: ids })).catch(() => {});
    clearInterval(pingTimer);
    pingTimer = setInterval(() => { try { ws?.send('ping'); } catch { /* */ } }, 25_000);
    if (wasOffline) { loadAll().catch(() => {}); window.dispatchEvent(new CustomEvent('maya-live', { detail: { type: '*' } })); } // kopukken olan değişiklikleri al
  };
  ws.onmessage = (e) => {
    lastHeard = Date.now();
    if (e.data === 'pong') return;
    let msg: any; try { msg = JSON.parse(e.data); } catch { return; }
    window.dispatchEvent(new CustomEvent('maya-live', { detail: msg }));
    if (msg.type === 'presence' && Array.isArray(msg.online)) { store.set({ presence: msg.online }); return; }
    if (msg.type === 'tasks') reloadTasks().catch(() => {});
    else if (msg.type === 'team') { reloadTeam().catch(() => {}); loadMe().catch(() => {}); }
    else if (msg.type === 'notify' || msg.type === 'remind') {
      reloadNotifications().catch(() => {});
      const n = msg.notification;
      const actor = store.get().team.find((m) => m.id === n.actorId);
      const meta = n.meta || [n.task?.client, n.task?.dueDate ? 'Teslim: ' + fmtDate(n.task.dueDate) : '', msg.type === 'remind' ? n.reminders + '. hatırlatma' : actor ? 'Atayan: ' + actor.name : ''].filter(Boolean).join(' · ');
      if (n.kind !== 'nudge' && n.kind !== 'chat') pushToast({ id: n.id + ':' + Date.now(), heading: n.title, title: n.body, meta, taskId: n.taskId, actorId: n.actorId, link: n.link });
      if (n.kind !== 'nudge') systemNotify(n.title, n.body);
    } else if (msg.type === 'session-revoked') {
      stopped = true; store.set({ me: null });
    }
  };
  ws.onclose = () => {
    clearInterval(pingTimer);
    if (stopped || !store.get().me) return;
    store.set({ online: false });
    const delay = Math.min(30_000, 1000 * 2 ** retry++);
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => { if (!stopped && store.get().me) connectLive(); }, delay);
  };
}
export function disconnectLive() { stopped = true; try { ws?.close(); } catch { /* */ } ws = null; }

// ---------- tarih yardımcıları ----------
export const MON = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const LMON = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
export const DAY = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
export const LDAY = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
export function todayIso(): string {
  const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export const parseD = (s: string) => new Date(s + 'T00:00:00');
export function fmtDate(s: string) { const d = parseD(s); return d.getDate() + ' ' + MON[d.getMonth()]; }
export function dayDiff(s: string) { return Math.round((parseD(s).getTime() - parseD(todayIso()).getTime()) / 864e5); }

export function memberName(team: Member[], id: string | null | undefined) {
  if (!id) return 'Atanmamış';
  return team.find((m) => m.id === id)?.name || 'Eski üye';
}
export function initials(first: string, last = '') {
  return ((first.trim()[0] || '') + (last.trim()[0] || '')).toLocaleUpperCase('tr') || '?';
}

// Fotoğrafı tarayıcıda küçült (en fazla 256 px) → küçük veri adresi
export function shrinkImage(file: File, size = 256): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, size / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Görsel okunamadı')); };
    img.src = url;
  });
}
