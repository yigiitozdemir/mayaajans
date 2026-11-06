import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, loadMe, snack, shrinkImage, disconnectLive, store, initials } from '../api';
import { Avatar, Icon, Link, Modal, Switch, meAsMember, navigate, useStore } from '../ui';
import { applyTheme, useThemePref, type ThemePref } from '../theme';
import { isDesktop } from '../desktop';
import { lastAi } from '../pages/YapayZeka';

// Menünün altında: ChatGPT ve Claude kısayolları (kişinin kendi hesabıyla; Mac'te programın içinde açılır)
const AI = [
  { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', icon: 'chat', cls: 'gpt' },
  { id: 'claude', name: 'Claude', url: 'https://claude.ai/new', icon: 'asterisk', cls: 'cld' },
];
function AiQuick({ path }: { path: string }) {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); window.addEventListener('maya-nav', f); window.addEventListener('popstate', f); return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); }; }, []);
  const cur = path === '/yapay-zeka' ? (new URLSearchParams(location.search).get('ai') || lastAi()) : null;
  return (
    <div class="aiquick">
      <div class="aiquick-h">
        <span class="navh" id="maya-yz">Yapay Zekâ</span>
        <a href="/yapay-zeka" class={'aiquick-help' + (path === '/yapay-zeka' ? ' on' : '')} aria-label="Yapay Zekâ: nasıl kullanılır" title="Nasıl kullanılır?"
          onClick={(e) => { e.preventDefault(); navigate('/yapay-zeka'); }}><Icon n="help" size={14} /></a>
      </div>
      <div class="aiquick-row" role="group" aria-labelledby="maya-yz">
        {AI.map((a) => (
          <button type="button" class={'aiq ' + a.cls + (cur === a.id ? ' on' : '')} aria-current={cur === a.id ? 'page' : undefined} title={a.name + ' (kendi hesabınla)'}
            onClick={() => (isDesktop ? navigate('/yapay-zeka?ai=' + a.id) : window.open(a.url, '_blank', 'noopener'))}>
            <span class="aiq-ic" aria-hidden="true"><Icon n={a.icon} size={15} stroke="#fff" w={2.2} /></span>
            <span class="aiq-n">{a.name}</span>
            {!isDesktop && <span class="aiq-go" aria-hidden="true"><Icon n="ext" size={13} /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// Menünün altında: Sistem · Açık · Koyu
const THEMES: { v: ThemePref; label: string; icon: string }[] = [
  { v: 'system', label: 'Sistem', icon: 'monitor' },
  { v: 'light', label: 'Açık', icon: 'sun' },
  { v: 'dark', label: 'Koyu', icon: 'moon' },
];
function ThemePicker() {
  const p = useThemePref();
  function choose(v: ThemePref) {
    if (v === p) return;
    applyTheme(v);
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

const NAV = [
  { href: '/', label: 'Bugün', icon: 'sun' },
  { href: '/ajanda', label: 'Ajandam', icon: 'note' },
  { href: '/isler', label: 'İş Planı', icon: 'board' },
  { href: '/ozel-gunler', label: 'Özel Günler', icon: 'cal' },
  { href: '/cekim', label: 'Çekim Planı', icon: 'cam' },
  { href: '/musteriler', label: 'Müşteriler', icon: 'clients' },
  { href: '/sohbet', label: 'Sohbet', icon: 'chat' },
  { href: '/durt', label: 'Dürtme', icon: 'hand' },
];

export function Shell({ path, children }: { path: string; children: ComponentChildren }) {
  const s = useStore();
  const me = s.me!;
  const open = s.tasks.filter((t) => t.status !== 2).length;
  return (
    <div class="shell">
      <aside class="side">
        <Link href="/" class="brand"><img src="/logo.png" alt="Maya Ajans" /><span>Ekip alanı</span></Link>
        <ProfileCard />
        <nav class="nav" aria-label="Ana menü">
          {(isDesktop ? [...NAV.slice(0, 2), { href: '/ekran', label: 'Ekran Görüntüleri', icon: 'image' }, ...NAV.slice(2)] : NAV).map((n) => (
            <Link href={n.href} class={path === n.href ? 'on' : ''} aria-current={path === n.href ? 'page' : undefined}>
              <Icon n={n.icon} />{n.label}{n.href === '/isler' && <span class="count">{open}</span>}{n.href === '/sohbet' && s.chatUnread > 0 && <span class="count" style="background:var(--badge);color:#fff">{s.chatUnread}</span>}
            </Link>
          ))}
          {me.role === 'admin' && (
            <>
              <div class="navh">Yönetim</div>
              <Link href="/ekip" class={path === '/ekip' ? 'on' : ''}><Icon n="team" />Ekip yönetimi</Link>
            </>
          )}
        </nav>
        <AiQuick path={path} />
        <ThemePicker />
      </aside>
      <div class="main">{children}</div>
    </div>
  );
}

// Tek profil: bütün ekranlarda aynı kart ve aynı pencere
function ProfileCard() {
  const s = useStore();
  const me = s.me!;
  const [edit, setEdit] = useState(false);
  return (
    <div style="margin:0 2px 14px;padding:10px;border-radius:12px;background:var(--chip);border:1px solid var(--line);display:flex;flex-direction:column;gap:8px">
      <div class="row" style="gap:10px;flex-wrap:nowrap">
        <Avatar m={meAsMember(me)} size={38} radius={11} />
        <span style="flex:1;min-width:0;display:flex;flex-direction:column">
          <span style="font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{(me.firstName + ' ' + me.lastName).trim()}</span>
          <span style="font-size:11px;color:var(--mute2)">{me.role === 'admin' ? 'Yönetici' : 'Üye'}</span>
        </span>
      </div>
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
      await api('PATCH', '/me', { firstName: first, lastName: last, photo: photo || null, settings });
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
        <Switch on={flag('quietHours')} label="Mesai dışında hatırlatma gönderme" hint="19:00 – 09:00 arası sessiz" onToggle={() => toggle('quietHours')} />
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
