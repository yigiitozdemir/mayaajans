// Bu cihaza (iPhone / tarayıcı) bildirim gönderme açma-kapama + iPhone için bir kerelik öneri bandı
import { useEffect, useState } from 'preact/hooks';
import { snack } from '../api';
import { Icon, Switch, useStore } from '../ui';
import { isDesktop } from '../desktop';
import { deviceName, disablePush, enablePush, isIOS, isStandalone, pushState, pushSupported, syncPush, testPush, type PushState } from '../push';
import '../styles/push.css';

function deniedHelp(): string {
  if (isIOS) return 'iPhone Ayarlar → Bildirimler → Maya Ekip → Bildirimlere İzin Ver’i aç, sonra buraya dön.';
  const u = navigator.userAgent;
  if (/Safari\//.test(u) && !/Chrome\/|Edg\//.test(u)) return 'Safari → Ayarlar → Web Siteleri → Bildirimler’den bu siteye “İzin Ver” seç.';
  return 'Adres çubuğundaki kilit simgesine tıkla → Bildirimler → İzin ver, sonra sayfayı yenile.';
}

export function PushToggle() {
  const [st, setSt] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!isDesktop) pushState().then(setSt).catch(() => setSt('unsupported')); }, []);
  if (isDesktop || st === null || st === 'desktop') return null;

  if (st === 'ios-browser' || st === 'ios-old' || st === 'unsupported') {
    return (
      <div class="push-note" role="note">
        <Icon n="bell" size={16} />
        <div>
          <strong>Bu cihaza bildirim</strong>
          {st === 'ios-browser' && <span>iPhone’da bildirim için önce Safari’de <b>Paylaş</b> → <b>Ana Ekrana Ekle</b>’ye dokun, sonra programı ana ekrandaki simgeden açıp buradan bildirimi aç.</span>}
          {st === 'ios-old' && <span>iPhone’a bildirim için iOS 16.4 ya da daha yeni bir sürüm gerekiyor. Ayarlar → Genel → Yazılım Güncelleme’den güncelle.</span>}
          {st === 'unsupported' && <span>Bu tarayıcı bildirimleri desteklemiyor. Chrome, Safari, Edge ya da Firefox ile dene.</span>}
        </div>
      </div>
    );
  }

  const on = st === 'on';
  async function toggle() {
    if (busy) return;
    if (st === 'no-key') { snack('Sunucuda bildirim ayarı eksik'); return; }
    setBusy(true);
    try {
      if (on) { await disablePush(); setSt('off'); snack('Bu cihaza bildirim kapatıldı'); }
      else {
        const r = await enablePush(); setSt(r);
        if (r === 'on') snack('Bu cihaza bildirim açıldı');
        else if (r === 'denied') snack('Bildirim izni verilmedi');
      }
    } catch (e: any) { snack(e?.message || 'Bildirim açılamadı'); setSt(await pushState().catch(() => 'off' as PushState)); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true);
    try { await testPush(); snack('Deneme bildirimi gönderildi'); }
    catch (e: any) { snack(e?.message || 'Gönderilemedi'); }
    finally { setBusy(false); }
  }
  const hint = on ? `${deviceName()} bildirim alıyor` : st === 'denied' ? 'İzin verilmemiş' : st === 'no-key' ? 'Sunucuda bildirim ayarı eksik' : 'Atama, hatırlatma, dürtme… bu cihaza da gelsin';
  return (
    <div class="push-toggle" data-state={st}>
      <Switch on={on} label={isIOS ? 'Bu iPhone’a bildirim gönder' : 'Bu cihaza bildirim gönder'} hint={hint} onToggle={toggle} />
      {on && (
        <div class="push-row">
          <button type="button" class="btn ghost sm" disabled={busy} onClick={test}><Icon n="bell" size={14} />Deneme bildirimi gönder</button>
        </div>
      )}
      {st === 'denied' && <p class="push-help">{deniedHelp()}</p>}
    </div>
  );
}

const DISMISS = 'maya.push.banner';

export function PushBanner() {
  const s = useStore();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const meId = s.me?.id;
  useEffect(() => {
    if (!meId || isDesktop || !pushSupported) return;
    syncPush().catch(() => {});
    let dismissed = false;
    try { dismissed = localStorage.getItem(DISMISS) === '1'; } catch { /* */ }
    if (!isIOS || !isStandalone || dismissed) return;
    pushState().then((st) => setShow(st === 'off')).catch(() => {});
  }, [meId]);
  if (!show || isDesktop) return null;

  function close() {
    try { localStorage.setItem(DISMISS, '1'); } catch { /* */ }
    setShow(false);
  }
  async function enable() {
    setBusy(true);
    try {
      const r = await enablePush();
      if (r === 'on') { snack('Bildirimler açıldı · bu iPhone’a da gelecek'); close(); }
      else if (r === 'denied') { snack('İzin verilmedi · Profilim’den yeniden açabilirsin'); close(); }
    } catch (e: any) { snack(e?.message || 'Bildirim açılamadı'); }
    finally { setBusy(false); }
  }
  return (
    <div class="push-banner" role="region" aria-label="Bildirim önerisi">
      <Icon n="bell" size={18} />
      <span class="push-banner-t">Telefonuna bildirim gelsin mi?</span>
      <button type="button" class="btn primary sm" disabled={busy} onClick={enable}>Aç</button>
      <button type="button" class="push-x" aria-label="Kapat" onClick={close}><Icon n="x" size={16} /></button>
    </div>
  );
}
