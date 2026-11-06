import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { api, loadMe, snack, shrinkImage, disconnectLive, store, initials } from '../api';
import { Avatar, Icon, Link, Modal, Switch, meAsMember, navigate, useStore } from '../ui';

const NAV = [
  { href: '/', label: 'Bugün', icon: 'sun' },
  { href: '/isler', label: 'İş Planı', icon: 'board' },
];
const SOON = [
  { label: 'Özel Günler', icon: 'cal' },
  { label: 'Çekim Planı', icon: 'cam' },
  { label: 'Dürtme', icon: 'hand' },
  { label: 'Sohbet', icon: 'chat' },
  { label: 'Müşteriler', icon: 'clients' },
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
          {NAV.map((n) => (
            <Link href={n.href} class={path === n.href ? 'on' : ''} aria-current={path === n.href ? 'page' : undefined}>
              <Icon n={n.icon} />{n.label}{n.href === '/isler' && <span class="count">{open}</span>}
            </Link>
          ))}
          {SOON.map((n) => <span class="soon"><Icon n={n.icon} />{n.label}<span class="pill-soon">Yakında</span></span>)}
          {me.role === 'admin' && (
            <>
              <div class="navh">Yönetim</div>
              <Link href="/ekip" class={path === '/ekip' ? 'on' : ''}><Icon n="team" />Ekip yönetimi</Link>
            </>
          )}
        </nav>
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
