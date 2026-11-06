import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, onLive, loadMe, snack, shrinkImage, disconnectLive, store, initials, moodOf, type Mood } from '../api';
import { Avatar, Icon, Link, Modal, Switch, meAsMember, navigate, useStore } from '../ui';
import { applyTheme, useThemePref, type ThemePref } from '../theme';
import { PushToggle } from './PushToggle';
import { GeriBildirimDugmesi } from './GeriBildirimDugmesi';
import { TakvimAbonelik } from './TakvimAbonelik';
import { SesAyari } from './SesAyari';
import { RozetRafi } from './RozetRafi';
import { desktopOr, isDesktop, macOverlay, onDesktopEvent } from '../desktop';
import { lastAi, openAppOutside } from '../pages/YapayZeka';

// Menünün altında: ChatGPT ve Claude kısayolları (kişinin kendi hesabıyla; Mac'te programın içinde açılır)
const AI = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', icon: 'chat', cls: 'gpt' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', icon: 'asterisk', cls: 'cld' },
  { id: 'whatsapp', name: 'WhatsApp', url: 'https://web.whatsapp.com/', icon: 'phone', cls: 'wa' },
];
function AiQuick({ path }: { path: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); window.addEventListener('maya-nav', f); window.addEventListener('popstate', f); return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); }; }, []);
  const cur = path === '/yapay-zeka' ? (new URLSearchParams(location.search).get('ai') || lastAi()) : null;
  const [unread, setUnread] = useState<Record<string, number>>({});
  useEffect(() => onDesktopEvent((e: any) => { if (e.action === 'app-unread') setUnread((u) => ({ ...u, [e.app]: e.count })); }), []);
  return (
    <div class="aiquick">
      <div class="aiquick-h">
        <span class="navh" id="maya-yz">Uygulamalar</span>
        <span class="aiquick-tools">
          {isDesktop && cur && cur !== 'whatsapp' && (
            <button type="button" class="aiquick-help" aria-label="Ayrı pencerede aç" title="Ayrı pencerede aç (yan yana çalışmak için)"
              onClick={() => desktopOr('open_ai', { which: cur }, () => {})}><Icon n="ext" size={14} /></button>
          )}
          <a href="/yapay-zeka?yardim=1" class="aiquick-help" aria-label="Uygulamalar: nasıl kullanılır" title="Nasıl kullanılır?"
            onClick={(e) => { e.preventDefault(); navigate('/yapay-zeka?yardim=1'); }}><Icon n="help" size={14} /></a>
        </span>
      </div>
      <div class="aiquick-row" role="group" aria-labelledby="maya-yz">
        {AI.map((a) => (
          <button type="button" class={'aiq ' + a.cls + (cur === a.id ? ' on' : '')} aria-current={cur === a.id ? 'page' : undefined} title={a.name + ' (kendi hesabınla)'}
            onClick={() => (isDesktop ? navigate('/yapay-zeka?ai=' + a.id) : openAppOutside(a.id, a.url))}>
            <span class="aiq-ic" aria-hidden="true"><Icon n={a.icon} size={15} stroke="#fff" w={2.2} /></span>
            <span class="aiq-n">{a.name}</span>
            {(unread[a.id] || 0) > 0 && <span class="aiq-badge" aria-label={unread[a.id] + ' okunmamış'}>{unread[a.id]}</span>}
            {!isDesktop && <span class="aiq-go" aria-hidden="true"><Icon n="ext" size={13} /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// Menünün altında: Koyu (varsayılan) · Açık · Sistem
const THEMES: { v: ThemePref; label: string; icon: string }[] = [
  { v: 'dark', label: 'Koyu', icon: 'moon' },
  { v: 'light', label: 'Açık', icon: 'sun' },
  { v: 'system', label: 'Sistem', icon: 'monitor' },
];
function ThemePicker() {
  const p = useThemePref();
  function choose(v: ThemePref) {
    if (v === p) return;
    applyTheme(v, true);
    if (store.get().me) api('PATCH', '/me', { settings: { theme: v } }).catch(() => {});
  }
  return (
    <div class="themepick">
      <span class="navh" id="maya-gorunum">Görünüm</span>
      <div class="seg" role="radiogroup" aria-labelledby="maya-gorunum">
        {THEMES.map((t) => (
          <button type="button" role="radio" aria-checked={p === t.v} class={p === t.v ? 'on' : ''} title={t.v === 'system' ? 'Mac / telefon ayarına uyar' : t.label + ' tema'} onClick={() => choose(t.v)}>
            <Icon n={t.icon} size={14} />{t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type NavItem = { href: string; label: string; icon: string };
// Menü grupları (başlıklı, her zaman açık)
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  { title: 'Günlük', items: [
    { href: '/', label: 'Bugün', icon: 'sun' },
    { href: '/ajanda', label: 'Ajandam', icon: 'note' },
    { href: '/sohbet', label: 'Sohbet', icon: 'chat' },
  ] },
  { title: 'Planlama', items: [
    { href: '/isler', label: 'İş Planı', icon: 'board' },
    { href: '/cekim', label: 'Çekim Planı', icon: 'cam' },
    { href: '/ozel-gunler', label: 'Özel Günler', icon: 'cal' },
    { href: '/musteriler', label: 'Müşteriler', icon: 'clients' },
  ] },
  { title: 'Ekip', items: [
    { href: '/duyurular', label: 'Duyurular', icon: 'megafon' },
    { href: '/durt', label: 'Dürtme', icon: 'hand' },
    { href: '/krizler', label: 'Kriz kayıtları', icon: 'uyari' },
  ] },
];
const EKRAN: NavItem = { href: '/ekran', label: 'Ekran Görüntüleri', icon: 'image' }; // yalnızca Mac uygulamasında

// Telefonda alttaki sekmeler (geri kalanı "Menü"de)
const TABS = [
  { href: '/', label: 'Bugün', icon: 'sun' },
  { href: '/isler', label: 'İş Planı', icon: 'board' },
  { href: '/sohbet', label: 'Sohbet', icon: 'chat' },
  { href: '/ajanda', label: 'Ajandam', icon: 'note' },
];

export function Shell({ path, children }: { path: string; children: ComponentChildren }) {
  const s = useStore();
  const [, navTick] = useState(0); // aynı sayfada ?ai= / ?yardim değişince şeridi güncelle
  useEffect(() => { const f = () => navTick((n) => n + 1); window.addEventListener('maya-nav', f); window.addEventListener('popstate', f); window.addEventListener('maya-ai-broken', f); return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); window.removeEventListener('maya-ai-broken', f); }; }, []);
  const me = s.me!;
  const [menuOpen, setMenuOpen] = useState(false);
  // okunmamış duyuru sayısı (menü rozeti)
  const [duyuruSayi, setDuyuruSayi] = useState(0);
  useEffect(() => {
    const f = () => api<{ sayi: number }>('GET', '/duyurular/okunmamis').then((r) => setDuyuruSayi(r?.sayi || 0)).catch(() => {});
    f(); return onLive(['duyuru', '*'], f);
  }, []);
  useEffect(() => { setMenuOpen(false); }, [path]); // bir bölüme geçince menü kapanır
  useEffect(() => {
    if (!menuOpen) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.documentElement.classList.add('noscroll'); window.addEventListener('keydown', k);
    return () => { document.documentElement.classList.remove('noscroll'); window.removeEventListener('keydown', k); };
  }, [menuOpen]);
  const open = s.tasks.filter((t) => t.status !== 2).length;
  // Mac'te ChatGPT/Claude/WhatsApp panelin içinde açıkken sol menü ince simge şeridine döner (uygulamaya yer kalır)
  const rail = isDesktop && path === '/yapay-zeka' && !new URLSearchParams(location.search).has('yardim') && !document.documentElement.classList.contains('ai-broken');
  const search = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: /Mac/.test(navigator.platform) }));
  return (
    <div class={'shell' + (rail ? ' rail' : '') + (menuOpen ? ' menu-open' : '')}>
      {macOverlay && <div class="dragbar" data-tauri-drag-region />}
      {/* Telefon / katlanır telefonun kapalı ekranı: üst başlık + alt sekmeler, menü soldan açılır */}
      <header class="mtop">
        <button type="button" class="mtop-btn" aria-label="Menü" aria-expanded={menuOpen} onClick={() => setMenuOpen(true)}><Icon n="menu" size={22} /></button>
        <Link href="/" class="mtop-logo" title="Bugün"><img src="/logo.png" alt="Maya Ajans" /></Link>
        <button type="button" class="mtop-btn" aria-label="Ara" onClick={search}><Icon n="search" size={20} /></button>
      </header>
      {menuOpen && <div class="mscrim" aria-hidden="true" onClick={() => setMenuOpen(false)} />}
      <aside class="side" aria-label="Menü">
        <button type="button" class="side-close" aria-label="Menüyü kapat" onClick={() => setMenuOpen(false)}><Icon n="x" size={20} /></button>
        <Link href="/" class="brand"><img src="/logo.png" alt="Maya Ajans" /><span>Ekip alanı</span></Link>
        <button type="button" class="searchbtn" onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, metaKey: /Mac/.test(navigator.platform) }))}>
          <Icon n="search" size={15} /><span>Ara</span><kbd>⌘K</kbd>
        </button>
        <ProfileCard />
        <nav class="nav" aria-label="Ana menü">
          {NAV_GROUPS.map((g, gi) => (
            <div class="navg" role="group" aria-labelledby={'navg-' + gi}>
              <div class="navh" id={'navg-' + gi}>{g.title}</div>
              {(isDesktop && gi === 0 ? [...g.items.slice(0, 2), EKRAN, ...g.items.slice(2)] : g.items).map((n) => (
                <Link href={n.href} class={path === n.href ? 'on' : ''} aria-current={path === n.href ? 'page' : undefined} title={n.label}>
                  <Icon n={n.icon} />{n.label}{n.href === '/isler' && <span class="count">{open}</span>}{n.href === '/sohbet' && s.chatUnread > 0 && <span class="count" style="background:var(--badge);color:#fff">{s.chatUnread}</span>}{n.href === '/duyurular' && duyuruSayi > 0 && <span class="count" style="background:var(--badge);color:#fff">{duyuruSayi}</span>}
                </Link>
              ))}
              {gi === 1 && me.portals?.includes('vatan') && (
                <Link href="/vatan" class={'nav-portal' + (path === '/vatan' ? ' on' : '')} aria-current={path === '/vatan' ? 'page' : undefined} title="Vatan Onay"><Icon n="check" />Vatan Onay<span class="nav-lock" title="Yalnızca sana özel"><Icon n="lock" size={12} /></span></Link>
              )}
            </div>
          ))}
          {me.role === 'admin' && (
            <>
              <div class="navh">Yönetim</div>
              <Link href="/yonetici" class={path === '/yonetici' ? 'on' : ''} title="Yönetici özeti"><Icon n="board" />Yönetici özeti</Link>
              <Link href="/ekip" class={path === '/ekip' ? 'on' : ''} title="Ekip yönetimi"><Icon n="team" />Ekip yönetimi</Link>
              <Link href="/geri-bildirim" class={path === '/geri-bildirim' ? 'on' : ''} title="Geri bildirimler"><Icon n="mail" />Geri bildirimler</Link>
            </>
          )}
        </nav>
        <AiQuick path={path} />
        <GeriBildirimDugmesi />
        <ThemePicker />
      </aside>
      <div class="main">{children}</div>
      <nav class="mtabs" aria-label="Hızlı geçiş">
        {TABS.map((t) => (
          <Link href={t.href} class={path === t.href ? 'on' : ''} aria-current={path === t.href ? 'page' : undefined}>
            <span class="mtab-ic"><Icon n={t.icon} size={21} />
              {t.href === '/sohbet' && s.chatUnread > 0 && <span class="mtab-badge">{s.chatUnread > 99 ? '99+' : s.chatUnread}</span>}
            </span>
            <span class="mtab-l">{t.label}</span>
          </Link>
        ))}
        <button type="button" class={menuOpen || !TABS.some((t) => t.href === path) ? 'on' : ''} onClick={() => setMenuOpen(true)} aria-label="Diğer bölümler">
          <span class="mtab-ic"><Icon n="menu" size={21} /></span><span class="mtab-l">Menü</span>
        </button>
      </nav>
    </div>
  );
}

// Kişi durumu: 🎬 Çekimde · 🎧 Odaklanıyorum … (Slack'teki gibi; süresi dolunca kendiliğinden kalkar)
const MOODS: { emoji: string; text: string; focus?: boolean }[] = [
  { emoji: '🎬', text: 'Çekimde' },
  { emoji: '🎧', text: 'Odaklanıyorum', focus: true },
  { emoji: '🤝', text: 'Toplantıda' },
  { emoji: '🍽', text: 'Öğle arası' },
  { emoji: '🏠', text: 'Evden çalışıyorum' },
  { emoji: '🚗', text: 'Yoldayım' },
  { emoji: '🤒', text: 'İzinli' },
];
const DURATIONS: { label: string; until: () => string | null }[] = [
  { label: '30 dk', until: () => new Date(Date.now() + 30 * 6e4).toISOString() },
  { label: '1 saat', until: () => new Date(Date.now() + 60 * 6e4).toISOString() },
  { label: '2 saat', until: () => new Date(Date.now() + 120 * 6e4).toISOString() },
  { label: '4 saat', until: () => new Date(Date.now() + 240 * 6e4).toISOString() },
  { label: 'Bugün', until: () => { const d = new Date(); d.setHours(23, 59, 0, 0); return d.toISOString(); } },
  { label: 'Süresiz', until: () => null },
];
const hm = (iso: string) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };

function MoodButton() {
  const s = useStore();
  const mood = moodOf(s.me!.settings);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class={'moodbtn' + (mood ? ' on' : '')} onClick={() => setOpen(true)} aria-label={mood ? 'Durum: ' + mood.text + ' — değiştir' : 'Durum ekle'}>
        <span class="mood-e" aria-hidden="true">{mood?.emoji || '🙂'}</span>
        <span class="mood-t">{mood ? mood.text || 'Durum' : 'Durum ekle'}</span>
        {mood?.until && <span class="mood-u" title={'Bitiş: ' + hm(mood.until)}>⏱ {hm(mood.until)}</span>}
      </button>
      {open && <MoodModal current={mood} onClose={() => setOpen(false)} />}
    </>
  );
}

function MoodModal({ current, onClose }: { current: Mood | null; onClose: () => void }) {
  const [emoji, setEmoji] = useState(current?.emoji || '🎬');
  const [text, setText] = useState(current?.text || '');
  const [focus, setFocus] = useState(!!current?.focus);
  const [dur, setDur] = useState(current ? (current.until ? -1 : 5) : 1);
  const [busy, setBusy] = useState(false);
  async function save(clear = false) {
    setBusy(true);
    try {
      const until = dur === -1 ? current?.until ?? null : DURATIONS[dur].until();
      await api('PATCH', '/me', { settings: { mood: clear ? null : { emoji, text, until, focus } } });
      await loadMe(); snack(clear ? 'Durum kaldırıldı' : 'Durumun güncellendi'); onClose();
    } catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  return (
    <Modal title="Durumun" onClose={onClose} width={460}>
      <div class="mood-presets">
        {MOODS.map((m) => (
          <button type="button" class={emoji === m.emoji && text === m.text ? 'on' : ''} onClick={() => { setEmoji(m.emoji); setText(m.text); setFocus(!!m.focus); }}>
            <span aria-hidden="true">{m.emoji}</span>{m.text}
          </button>
        ))}
      </div>
      <div class="row" style="gap:8px;flex-wrap:nowrap">
        <input class="input" style="width:64px;text-align:center;font-size:20px" maxLength={4} value={emoji} aria-label="Emoji" onInput={(e) => setEmoji((e.target as HTMLInputElement).value)} />
        <input class="input" maxLength={60} placeholder="Ne yapıyorsun?" value={text} aria-label="Durum metni" onInput={(e) => setText((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); }} />
      </div>
      <div class="field">Ne kadar süre?
        <div class="seg" role="group" aria-label="Süre" style="flex-wrap:wrap">
          {current?.until && <button type="button" class={dur === -1 ? 'on' : ''} onClick={() => setDur(-1)}>Şu anki (bitiş {hm(current.until)})</button>}
          {DURATIONS.map((d, i) => <button type="button" class={dur === i ? 'on' : ''} onClick={() => setDur(i)}>{d.label}</button>)}
        </div>
      </div>
      <Switch on={focus} label="Dürtmeleri sessize al" hint="Bu durum sürdükçe ses, titreme ve bildirim gelmez; dürtmeler zilde birikir" onToggle={() => setFocus(!focus)} />
      <div class="row">
        {current && <button type="button" class="btn ghost" style="color:var(--red);border:0;padding:0 4px" disabled={busy} onClick={() => save(true)}>Durumu kaldır</button>}
        <span class="spacer" />
        <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
        <button type="button" class="btn primary" disabled={busy || (!emoji.trim() && !text.trim())} onClick={() => save()}>Kaydet</button>
      </div>
    </Modal>
  );
}

// Tek profil: bütün ekranlarda aynı kart ve aynı pencere
function ProfileCard() {
  const s = useStore();
  const me = s.me!;
  const [edit, setEdit] = useState(false);
  return (
    <div class="pcard" style="margin:0 2px 14px;padding:10px;border-radius:12px;background:var(--chip);border:1px solid var(--line);display:flex;flex-direction:column;gap:8px">
      <div class="row" style="gap:10px;flex-wrap:nowrap">
        <button type="button" class="pcard-av" aria-label="Profilim" title="Profilim" onClick={() => setEdit(true)}><Avatar m={meAsMember(me)} size={38} radius={11} /></button>
        <span class="pcard-name" style="flex:1;min-width:0;display:flex;flex-direction:column">
          <span style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{(me.firstName + ' ' + me.lastName).trim()}</span>
          <span style="font-size:11px;color:var(--mute2)">{me.role === 'admin' ? 'Yönetici' : 'Üye'}</span>
        </span>
      </div>
      <MoodButton />
      <button type="button" class="btn sm" onClick={() => setEdit(true)}><Icon n="user" size={14} />Profilimi düzenle</button>
      {edit && <ProfileModal onClose={() => setEdit(false)} />}
    </div>
  );
}

function ProfileModal({ onClose }: { onClose: () => void }) {
  const me = store.get().me!;
  const [first, setFirst] = useState(me.firstName);
  const [last, setLast] = useState(me.lastName);
  const [photo, setPhoto] = useState<string | null>(me.photo);
  const [settings, setSettings] = useState<Record<string, unknown>>(me.settings || {});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const flag = (k: string, def = true) => (settings[k] === undefined ? def : !!settings[k]);
  const toggle = (k: string, def = true) => setSettings({ ...settings, [k]: !flag(k, def) });

  async function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setErr('Sadece JPG, PNG veya WEBP yükleyebilirsin.'); return; }
    if (f.size > 8 * 1024 * 1024) { setErr('Fotoğraf en fazla 8 MB olabilir.'); return; }
    try { setPhoto(await shrinkImage(f)); setErr(''); } catch { setErr('Fotoğraf okunamadı.'); }
    (e.target as HTMLInputElement).value = '';
  }
  async function save() {
    if (!first.trim()) { setErr('Adını yaz.'); return; }
    setBusy(true);
    try {
      // yalnızca bu pencerenin kendi ayarlarını gönder; anında kaydedilen ayarlar (ses, titreşim, hava, tema…) geri dönmesin
      const OWN = ['remindHourly', 'gecikmeUyari', 'quietHours', 'morning', 'morningTime', 'weekendQuiet'];
      const own = Object.fromEntries(OWN.filter((k) => k in settings).map((k) => [k, (settings as any)[k]]));
      await api('PATCH', '/me', { firstName: first, lastName: last, photo: photo || null, settings: own });
      await loadMe(); snack('Profilin güncellendi'); onClose();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function logout() {
    await api('POST', '/auth/logout').catch(() => {});
    disconnectLive(); store.set({ me: null }); navigate('/giris');
  }
  const preview = { firstName: first || '?', lastName: last, color: me.color, photo };
  return (
    <Modal title="Profilim" onClose={onClose} width={500}>
      <div class="row" style="gap:18px">
        <Avatar m={preview} size={96} radius={28} />
        <div style="display:flex;flex-direction:column;align-items:flex-start;gap:8px">
          <label class="btn primary sm" style="position:relative;cursor:pointer">
            <Icon n="camera" size={15} />{photo ? 'Fotoğrafı değiştir' : 'Fotoğraf yükle'}
            <input type="file" accept="image/png,image/jpeg,image/webp" class="sr" onChange={onFile} />
          </label>
          {photo && <button type="button" class="btn danger sm" onClick={() => setPhoto(null)}>Fotoğrafı kaldır</button>}
          <span class="sub">JPG, PNG veya WEBP</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
        <label class="field">Ad *<input class="input" value={first} maxLength={40} autocomplete="given-name" onInput={(e) => setFirst((e.target as HTMLInputElement).value)} /></label>
        <label class="field">Soyad<input class="input" value={last} maxLength={40} autocomplete="family-name" onInput={(e) => setLast((e.target as HTMLInputElement).value)} /></label>
      </div>
      <span class="sub">Ekipte görünen adın: <strong style="color:var(--ink)">{(first + ' ' + last).trim() || '—'}</strong> · bütün ekranlarda bu bilgi kullanılır.</span>
      <div style="display:flex;flex-direction:column;border-top:1px solid var(--line);padding-top:6px">
        <Switch on={flag('remindHourly')} label="Okumadığım atamaları saatte bir hatırlat" hint="İşi açana kadar" onToggle={() => toggle('remindHourly')} />
        <Switch on={flag('gecikmeUyari')} label="Teslimi yaklaşan başlanmamış işlerimi hatırlat" hint="2 iş günü ve 1 iş günü kala, sabah 10:00" onToggle={() => toggle('gecikmeUyari')} />
        <Switch on={flag('quietHours')} label="Mesai dışında hatırlatma gönderme" hint="19:00 – 09:00 arası sessiz" onToggle={() => toggle('quietHours')} />
        <PushToggle />
        <SesAyari />
        <Switch on={flag('morning')} label="Sabah özeti gönder" hint="Bugünkü işlerim, çekimlerim ve özel günler" onToggle={() => toggle('morning')} />
        {flag('morning') && (
          <div class="row" style="gap:10px;padding:4px 0 8px">
            <label class="sub" for="maya-sabah">Saat</label>
            <select id="maya-sabah" class="input" style="width:auto" value={typeof settings.morningTime === 'string' ? settings.morningTime : '09:00'}
              onChange={(e) => setSettings({ ...settings, morningTime: (e.target as HTMLSelectElement).value })}>
              {['07:00', '08:00', '09:00', '10:00', '11:00'].map((h) => <option value={h}>{h}</option>)}
            </select>
            <span class="spacer" />
            <label class="sub" style="display:flex;align-items:center;gap:6px">
              <input type="checkbox" checked={flag('weekendQuiet')} onChange={() => toggle('weekendQuiet')} />Hafta sonu gönderme
            </label>
          </div>
        )}
      </div>
      <TakvimAbonelik />
      <RozetRafi />
      {err && <span class="errtext" role="alert">{err}</span>}
      <div class="row">
        <button type="button" class="btn ghost" style="color:var(--red);border:0;padding:0 4px" onClick={logout}><Icon n="out" size={15} />Oturumu kapat</button>
        <span class="spacer" />
        <button type="button" class="btn" onClick={onClose}>Vazgeç</button>
        <button type="button" class="btn primary" disabled={busy} onClick={save}>Kaydet</button>
      </div>
    </Modal>
  );
}

export { initials };
