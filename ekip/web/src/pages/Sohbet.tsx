// Sohbet: genel kanallar, müşteri kanalları, birebir mesajlar
import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, snack, type Member } from '../api';
import { Avatar, Icon, Link, useStore } from '../ui';
import { Bell } from '../components/Notify';
import { Konusma } from '../components/SohbetKonusma';
import { badgeCount, channelsLoaded, chatView, reloadChannels, upsertChannel, useChannels, type ChatChannel } from '../components/SohbetData';
import '../styles/sohbet.css';

const LAST_KEY = 'maya.chat.last';
const lowerTr = (s: string) => (s || '').toLocaleLowerCase('tr');
const urlChannel = () => { const p = new URLSearchParams(location.search); return p.get('c') || p.get('id'); };
function lastChannel(): string { try { return localStorage.getItem(LAST_KEY) || 'ch_genel'; } catch { return 'ch_genel'; } }
function initials(n: string) {
  const p = n.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/);
  return (((p[0] || '')[0] || '') + ((p[1] || '')[0] || '')).toLocaleUpperCase('tr') || '#';
}
function colorFor(f: string) {
  const pal = ['#2F6F8F', '#7A4E9C', '#3E7A55', '#9C4A5E', '#8A5A2B', '#5B6B3A', '#4C6A9E', '#8E5B8A'];
  let h = 0; for (let i = 0; i < f.length; i++) h = (h * 31 + f.charCodeAt(i)) >>> 0;
  return pal[h % pal.length];
}

export function Sohbet({ openTask }: { openTask: (id: string) => void }) {
  const s = useStore();
  const me = s.me!;
  const channels = useChannels();
  const [cur, setCur] = useState<string>(() => urlChannel() || lastChannel());
  const [mobileList, setMobileList] = useState(() => !urlChannel());
  const [q, setQ] = useState('');
  const [opening, setOpening] = useState<string | null>(null);

  // adres çubuğu / bildirim bağlantısı: /sohbet?c=<kanal>
  useEffect(() => {
    const f = () => { if (location.pathname !== '/sohbet') return; const c = urlChannel(); if (c) { setCur(c); setMobileList(false); } };
    window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    if (!channelsLoaded()) reloadChannels().catch(() => {});
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); chatView.channelId = null; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LAST_KEY, cur); } catch { /* */ }
    if (urlChannel() !== cur) history.replaceState({}, '', '/sohbet?c=' + encodeURIComponent(cur));
  }, [cur]);

  // listede yoksa (yeni açılmış DM olabilir) bir kez yenile
  const curCh = channels.find((c) => c.id === cur);
  useEffect(() => { if (channelsLoaded() && !curCh) reloadChannels().catch(() => {}); }, [cur]);

  const select = (id: string) => { setCur(id); setMobileList(false); };
  async function openDm(m: Member) {
    const existing = channels.find((c) => c.kind === 'dm' && c.dmWith === m.id);
    if (existing) { select(existing.id); return; }
    setOpening(m.id);
    try { const ch = await api<ChatChannel>('POST', '/chat/dm', { userId: m.id }); upsertChannel(ch); select(ch.id); }
    catch (e: any) { snack(e.message); } finally { setOpening(null); }
  }

  const ql = lowerTr(q.trim());
  const general = channels.filter((c) => c.kind === 'general' && (!ql || lowerTr(c.name + ' ' + c.topic).includes(ql)));
  const clients = useMemo(() => channels.filter((c) => c.kind === 'client' && (!ql || lowerTr(c.name + ' ' + c.topic).includes(ql)))
    .sort((a, b) => a.topic.localeCompare(b.topic, 'tr') || a.name.localeCompare(b.name, 'tr')), [channels, ql]);
  const people = s.team.filter((m) => m.id !== me.id && (!ql || lowerTr(m.name).includes(ql)));

  const row = (c: ChatChannel, label: string, lead: any, key?: string) => {
    const n = badgeCount(c);
    return (
      <button type="button" key={key || c.id} class={'ch-row' + (c.id === cur ? ' on' : '') + (c.unread > 0 ? ' unread' : '')}
        aria-current={c.id === cur ? 'true' : undefined} onClick={() => select(c.id)}
        aria-label={label + (c.unread ? ', ' + c.unread + ' okunmamış' : '') + (c.mentions ? ', ' + c.mentions + ' bahsetme' : '')}>
        {lead}<span class="lb">{label}</span>{n > 0 && <span class="ch-badge">{n > 99 ? '99+' : n}</span>}
      </button>
    );
  };
  const hash = <span class="ch-hash" aria-hidden="true">#</span>;

  // açık kanalın başlığı
  let title = 'Sohbet', subtitle = '', placeholder = 'Mesaj yaz…', empty = { title: 'Konuşma boş', text: 'İlk mesajı yaz.' };
  let dmMember: Member | undefined;
  if (curCh?.kind === 'dm') {
    dmMember = s.team.find((m) => m.id === curCh.dmWith);
    const n = dmMember?.name || 'Eski üye';
    title = n; subtitle = 'Birebir mesaj · sadece ikiniz görürsünüz'; placeholder = n + ' kişisine yaz…';
    empty = { title: n + ' ile mesajlaşma', text: 'İlk mesajı yaz. Acil bir şey için Dürtme bölümünü de kullanabilirsin.' };
  } else if (curCh?.kind === 'client') {
    title = '# ' + curCh.name; subtitle = curCh.topic + ' hakkında ekip içi yazışma · müşteri görmez'; placeholder = '#' + curCh.name + ' kanalına yaz…';
    empty = { title: '#' + curCh.name + ' kanalı boş', text: curCh.topic + ' ile ilgili revizyonları, onayları ve dosyaları burada konuşun.' };
  } else if (curCh) {
    title = '# ' + curCh.name; subtitle = curCh.topic; placeholder = '#' + curCh.name + ' kanalına yaz…';
    empty = { title: '#' + curCh.name + ' kanalı boş', text: (curCh.topic || 'Ekiple konuşun') + '.' };
  }

  return (
    <div class={'chat' + (mobileList ? ' m-list' : ' m-conv')}>
      <section class="ch-side" aria-label="Kanallar">
        <label class="ch-search">
          <Icon n="search" size={14} />
          <span class="sr">Kanal ara</span>
          <input type="search" value={q} placeholder="Kanal veya kişi ara…" onInput={(e) => setQ((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQ(''); }} />
        </label>
        {general.length > 0 && (
          <div class="ch-group">
            <h2>Kanallar</h2>
            {general.map((c) => row(c, c.name, hash))}
          </div>
        )}
        {clients.length > 0 && (
          <div class="ch-group">
            <h2>Müşteri kanalları <span>{clients.length}</span></h2>
            {clients.map((c) => row(c, c.name, hash))}
          </div>
        )}
        {people.length > 0 && (
          <div class="ch-group">
            <h2>Birebir mesajlar</h2>
            {people.map((m) => {
              const c = channels.find((x) => x.kind === 'dm' && x.dmWith === m.id);
              const lead = <Avatar m={m} size={22} radius={7} />;
              if (c) return row(c, m.name, lead, 'u' + m.id);
              return (
                <button type="button" key={'u' + m.id} class="ch-row" disabled={opening === m.id} onClick={() => openDm(m)}>
                  {lead}<span class="lb">{m.name}</span>
                </button>
              );
            })}
          </div>
        )}
        {!general.length && !clients.length && !people.length && <p class="empty">“{q}” ile eşleşen kanal ya da kişi yok.</p>}
      </section>

      <main class="ch-main" aria-label={title}>
        <header class="ch-head">
          <button type="button" class="iconbtn ch-back" aria-label="Kanallara dön" onClick={() => setMobileList(true)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          {dmMember && <Avatar m={dmMember} size={34} radius={10} />}
          <div class="ch-title">
            <h1>{title}</h1>
            {subtitle && <span>{subtitle}</span>}
          </div>
          <span class={'ch-live' + (s.online ? '' : ' off')}><span class="dot" />{s.online ? 'Canlı' : 'Bağlantı yok'}</span>
          <Bell onOpenTask={openTask} />
        </header>
        {curCh ? <Konusma key={curCh.id} ch={curCh} me={me} team={s.team} placeholder={placeholder} empty={empty} />
          : <div class="ch-list"><p class="empty" style="text-align:center">{channelsLoaded() ? 'Bu konuşma bulunamadı ya da arşivlendi.' : 'Yükleniyor…'}</p></div>}
      </main>

      {curCh?.kind === 'client' && (
        <aside class="ch-aside" aria-label="Müşteri özeti">
          <div class="row" style="flex-wrap:nowrap;gap:12px">
            <span class="ch-cav" style={{ background: colorFor(curCh.topic || curCh.name) }}>{initials(curCh.topic || curCh.name)}</span>
            <span style="display:flex;flex-direction:column;gap:2px;min-width:0">
              <strong>{curCh.topic || curCh.name}</strong>
              <span class="sub" style="font-size:12px">Ekip içi kanal · müşteri görmez</span>
            </span>
          </div>
          <span class="sub" style="font-size:12px;line-height:1.5">Marka renkleri, yasaklı ifadeler ve linkler müşteri kartında.</span>
          <Link class="ch-alink" href={'/musteriler' + (curCh.clientId ? '?id=' + encodeURIComponent(curCh.clientId) : '')}>Müşteri kartı <span aria-hidden="true">›</span></Link>
          <Link class="ch-alink" href="/isler">İşleri <span aria-hidden="true">›</span></Link>
          <Link class="ch-alink" href="/cekim">Çekimleri <span aria-hidden="true">›</span></Link>
        </aside>
      )}
    </div>
  );
}
