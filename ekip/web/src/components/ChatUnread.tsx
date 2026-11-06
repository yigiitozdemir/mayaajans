// Sohbet okunmamış sayısını her ekranda güncel tutar (store.chatUnread → menüdeki sayı).
// Birebir mesaj ya da @bahsetme gelince: pencere odakta değilse Mac bildirimi, Sohbet dışındaysan köşe bildirimi.
import { useEffect } from 'preact/hooks';
import { onLive, pushToast, store, systemNotify } from '../api';
import { getChannels, isViewing, mentionsMe, reloadChannels, scheduleReload, type ChatMessage } from './SohbetData';

function incoming(msg: ChatMessage) {
  const s = store.get();
  if (!s.me || msg.userId === s.me.id || msg.deleted) return;
  const ch = getChannels().find((c) => c.id === msg.channelId);
  const isDm = ch ? ch.kind === 'dm' : true; // listede olmayan kanal: yeni açılmış birebir konuşma
  const mention = mentionsMe(msg.text, s.me.firstName);
  if (!isDm && !mention) return;
  if (isViewing(msg.channelId) && document.hasFocus()) return;
  const author = s.team.find((m) => m.id === msg.userId)?.name || 'Ekip';
  const body = (msg.text || (msg.file ? 'Dosya: ' + msg.file.name : '')).replace(/\s+/g, ' ').slice(0, 160);
  const heading = isDm ? author + ' sana yazdı' : author + ' senden bahsetti';
  systemNotify(heading, isDm ? body : '#' + (ch?.name || '') + ': ' + body);
  if (location.pathname !== '/sohbet') {
    pushToast({
      id: 'chat:' + msg.id, heading, title: body, meta: isDm ? 'Birebir mesaj' : '#' + (ch?.name || 'kanal'),
      taskId: null, actorId: msg.userId, link: '/sohbet?c=' + msg.channelId,
    });
  }
}

export function ChatUnread() {
  useEffect(() => {
    reloadChannels().catch(() => {});
    const off = onLive(['chat', 'clients', 'team', '*'], (m) => {
      if (m.type === 'chat' && m.action === 'new' && m.message) incoming(m.message as ChatMessage);
      // açık kanala gelen mesajı Sohbet sayfası okundu yapar; sayıyı o anda artırmamak için biraz bekle
      scheduleReload(m.type === 'chat' && isViewing(m.channelId) ? 900 : 250);
    });
    return off;
  }, []);
  return null;
}
