// Sohbet: ortak veri (kanal listesi, okunmamış sayıları, açık kanal) — Sohbet sayfası ve ChatUnread kullanır
import { useEffect, useState } from 'preact/hooks';
import { api, store, type Member } from '../api';

export interface ChatChannel {
  id: string; name: string; kind: 'general' | 'client' | 'dm'; topic: string; clientId: string | null;
  dmWith: string | null; unread: number; mentions: number; lastAt: string | null;
}
export interface ChatFile { name: string; type: string; size: number; url: string }
export interface ChatMessage {
  id: string; channelId: string; userId: string; text: string; file: ChatFile | null;
  createdAt: string; editedAt: string | null; deleted: boolean;
}

/** Sohbet sayfasında şu an açık olan kanal (sayfa dışındaysa null) */
export const chatView: { channelId: string | null } = { channelId: null };

let channels: ChatChannel[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => { store.set({ chatUnread: totalUnread(channels) }); listeners.forEach((l) => l()); };

export const getChannels = () => channels;
export const channelsLoaded = () => loaded;

export function useChannels(): ChatChannel[] {
  const [, force] = useState(0);
  useEffect(() => { const l = () => force((n) => n + 1); listeners.add(l); return () => { listeners.delete(l); }; }, []);
  return channels;
}

/** Açık ve görünür kanal okunmuş sayılır */
export const isViewing = (id: string) =>
  location.pathname === '/sohbet' && chatView.channelId === id && document.visibilityState === 'visible';

let seq = 0;
export async function reloadChannels() {
  const my = ++seq;
  const list = await api<ChatChannel[]>('GET', '/chat/channels');
  if (my !== seq) return; // daha yeni bir yükleme var
  channels = list.map((c) => (isViewing(c.id) ? { ...c, unread: 0, mentions: 0 } : c));
  loaded = true;
  emit();
}

let timer: any;
export function scheduleReload(ms = 250) {
  clearTimeout(timer);
  timer = setTimeout(() => { reloadChannels().catch(() => {}); }, ms);
}

export function setChannelRead(id: string) {
  if (!channels.some((c) => c.id === id && (c.unread || c.mentions))) return;
  channels = channels.map((c) => (c.id === id ? { ...c, unread: 0, mentions: 0 } : c));
  emit();
}

export function upsertChannel(ch: ChatChannel) {
  channels = channels.some((c) => c.id === ch.id) ? channels.map((c) => (c.id === ch.id ? { ...c, ...ch } : c)) : [...channels, ch];
  emit();
}

/**
 * Menüdeki toplam: birebir mesajlar + genel kanallar + müşteri kanallarında yalnızca bahsetmeler.
 * (26 müşteri kanalının her mesajı sayıyı şişirmesin; o kanallar listede kalın görünür.)
 */
export function totalUnread(list: ChatChannel[]): number {
  return list.reduce((n, c) => n + (c.kind === 'client' ? c.mentions : c.unread), 0);
}
/** Kanal satırında kırmızı sayı (toplamla aynı kural) */
export const badgeCount = (c: ChatChannel) => (c.kind === 'client' ? c.mentions : c.unread);

const lowerTr = (s: string) => (s || '').toLocaleLowerCase('tr');
export const firstWord = (s: string) => (s || '').trim().split(/\s+/)[0] || '';

/** Mesaj beni anıyor mu? (@Ad ya da @herkes) */
export function mentionsMe(text: string, firstName: string): boolean {
  const me = lowerTr(firstWord(firstName));
  const re = /@([\p{L}\p{N}_]+)/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ''))) {
    const t = lowerTr(m[1]);
    if (t === 'herkes' || (me && t === me)) return true;
  }
  return false;
}

export function channelTitle(c: ChatChannel | undefined, team: Member[]): string {
  if (!c) return 'Sohbet';
  if (c.kind === 'dm') return team.find((m) => m.id === c.dmWith)?.name || 'Eski üye';
  return '# ' + c.name;
}

export function fmtSize(n: number): string {
  if (n < 1024) return n + ' B';
  const kb = n / 1024;
  if (kb < 1024) return Math.max(1, Math.round(kb)) + ' KB';
  return (kb / 1024).toFixed(1).replace('.', ',') + ' MB';
}
