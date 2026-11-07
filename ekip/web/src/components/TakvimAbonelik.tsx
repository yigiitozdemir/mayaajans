// Profilim → Takvim eşitleme: kişiye özel gizli abonelik adresi (Google / iPhone / Mac) + dış çekim hava uyarısı anahtarı
import { useEffect, useState } from 'preact/hooks';
import { api, snack, store } from '../api';
import { Icon, Switch, useStore } from '../ui';
import '../styles/takvim.css';

type Group = 'shoots' | 'meetings' | 'tasks' | 'agenda' | 'special';
interface FeedState { active: boolean; groups: Record<Group, boolean>; hint: string | null; createdAt: string | null; fetchedAt: string | null }
interface Links { url: string; webcal: string; google: string }

const GROUPS: { k: Group; label: string; icon: string }[] = [
  { k: 'shoots', label: 'Çekimlerim', icon: 'cam' },
  { k: 'meetings', label: 'Toplantılarım', icon: 'toplanti' },
  { k: 'tasks', label: 'Teslimlerim', icon: 'check' },
  { k: 'agenda', label: 'Ajandam', icon: 'note' },
  { k: 'special', label: 'Özel günler', icon: 'yildiz' },
];

const LS = (uid: string) => 'maya.takvim.' + uid;
function loadLinks(uid: string): Links | null {
  try { const o = JSON.parse(localStorage.getItem(LS(uid)) || 'null'); return o && typeof o.url === 'string' ? o : null; } catch { return null; }
}
function saveLinks(uid: string, l: Links | null) {
  try { if (l) localStorage.setItem(LS(uid), JSON.stringify(l)); else localStorage.removeItem(LS(uid)); } catch { /* */ }
}
async function hashHint(url: string): Promise<string | null> {
  const m = /\/takvim\/([A-Za-z0-9_-]+)\.ics$/.exec(url);
  if (!m || !crypto?.subtle) return null;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[1])));
  let s = ''; for (const b of d) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 10);
}
function ago(sql: string | null): string {
  if (!sql) return '';
  const t = Date.parse(sql.replace(' ', 'T') + 'Z');
  if (isNaN(t)) return '';
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (m < 2) return 'az önce';
  if (m < 60) return m + ' dk önce';
  const h = Math.round(m / 60);
  if (h < 24) return h + ' saat önce';
  return Math.round(h / 24) + ' gün önce';
}
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); snack('Bağlantı kopyalandı · kimseyle paylaşma'); }
  catch {
    const el = document.querySelector<HTMLInputElement>('.tk-url input');
    if (el) { el.select(); try { document.execCommand('copy'); snack('Bağlantı kopyalandı'); return; } catch { /* */ } }
    snack('Kopyalanamadı · bağlantıyı seçip kopyala');
  }
}

export function TakvimAbonelik() {
  const s = useStore();
  const me = s.me!;
  const [st, setSt] = useState<FeedState | null>(null);
  const [links, setLinks] = useState<Links | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'' | 'yenile' | 'kapat'>('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const x = await api<FeedState>('GET', '/takvim');
        if (!live) return;
        setSt(x);
        const l = loadLinks(me.id);
        if (l && x.active && x.hint && (await hashHint(l.url)) === x.hint) setLinks(l);
        else if (l) saveLinks(me.id, null); // başka yerde yenilenmiş ya da kapatılmış
      } catch { if (live) setSt(null); }
    })();
    return () => { live = false; };
  }, [me.id]);

  async function yenile() {
    if (busy) return;
    if (st?.active && confirm !== 'yenile') { setConfirm('yenile'); return; }
    setBusy(true); setConfirm('');
    try {
      const x = await api<FeedState & Links>('POST', '/takvim/yenile');
      const l = { url: x.url, webcal: x.webcal, google: x.google };
      setSt(x); setLinks(l); saveLinks(me.id, l); setOpen(true);
      snack(st?.active ? 'Yeni bağlantı hazır · eski abonelikler artık güncellenmez' : 'Takvim bağlantın hazır');
    } catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  async function kapat() {
    if (busy) return;
    if (confirm !== 'kapat') { setConfirm('kapat'); return; }
    setBusy(true); setConfirm('');
    try { setSt(await api<FeedState>('DELETE', '/takvim')); setLinks(null); saveLinks(me.id, null); snack('Takvim eşitleme kapatıldı · bağlantı artık çalışmıyor'); }
    catch (e: any) { snack(e.message); } finally { setBusy(false); }
  }
  async function toggleGroup(k: Group) {
    if (!st) return;
    const v = !st.groups[k];
    setSt({ ...st, groups: { ...st.groups, [k]: v } });
    try { setSt(await api<FeedState>('PATCH', '/takvim', { groups: { [k]: v } })); }
    catch (e: any) { snack(e.message); setSt(st); }
  }

  // dış çekim hava uyarısı (sunucuda settings.havaUyarisi)
  const havaOn = me.settings?.havaUyarisi !== false;
  async function toggleHava() {
    const v = !havaOn;
    try {
      await api('PATCH', '/me', { settings: { havaUyarisi: v } });
      // Profil penceresi aynı ayar nesnesini tutuyor: Kaydet'e basınca eski değer geri yazılmasın
      if (me.settings) (me.settings as Record<string, unknown>).havaUyarisi = v;
      store.set({ me: { ...me, settings: me.settings || { havaUyarisi: v } } });
      snack(v ? 'Hava uyarısı açık' : 'Hava uyarısı kapatıldı');
    } catch (e: any) { snack(e.message); }
  }

  const on = !!st?.active;
  const nGroups = st ? GROUPS.filter((g) => st.groups[g.k]).length : 0;
  const status = !st ? 'Yükleniyor…' : !on ? 'Kapalı · Google, iPhone ya da Mac takvimine ekle' : nGroups + ' grup takvime gidiyor' + (st.fetchedAt ? ' · son eşitleme ' + ago(st.fetchedAt) : ' · henüz eşitlenmedi');

  return (
    <div class="tk">
      <button type="button" class="tk-head" aria-expanded={open} aria-controls="tk-body" onClick={() => { setOpen(!open); setConfirm(''); }}>
        <span class={'tk-ic' + (on ? ' on' : '')}><Icon n="cal" size={16} /></span>
        <span class="tk-ht">
          <span class="tk-title">Takvim eşitleme{on && <span class="tk-badge">Açık</span>}</span>
          <span class="tk-sub">{status}</span>
        </span>
        <span class={'tk-chev' + (open ? ' up' : '')} aria-hidden="true">›</span>
      </button>

      {open && st && (
        <div class="tk-body" id="tk-body">
          <p class="tk-p">Çekimlerin, toplantıların, teslim günlerin, Ajandam ve özel günler kendi takviminde görünsün. Bağlantı <b>sana özel</b> — kimseyle paylaşma.</p>

          {!on && (
            <button type="button" class="btn primary sm tk-go" disabled={busy} onClick={yenile}><Icon n="link" size={14} />Takvim bağlantımı oluştur</button>
          )}

          {on && links && (
            <>
              <div class="tk-add">
                <a class="btn sm" href={links.google} target="_blank" rel="noopener noreferrer"><span class="tk-g" aria-hidden="true">G</span>Google Takvim'e ekle</a>
                <a class="btn sm" href={links.webcal}><Icon n="cal" size={14} />iPhone / Mac Takvim'e ekle</a>
              </div>
              <div class="tk-url">
                <label class="sr" for="tk-url-in">Abonelik bağlantısı</label>
                <input id="tk-url-in" readOnly value={links.url} onFocus={(e) => (e.target as HTMLInputElement).select()} />
                <button type="button" class="btn sm ghost" onClick={() => copy(links.url)}><Icon n="copy" size={14} />Bağlantıyı kopyala</button>
              </div>
            </>
          )}
          {on && !links && (
            <div class="tk-note">Abonelik açık. Güvenlik için bağlantı yalnızca oluşturulduğu cihazda gösterilir. Bu cihazdan eklemek için <b>Bağlantıyı yenile</b>'ye bas (eski abonelikler güncellenmez, yenisini eklemen gerekir).</div>
          )}

          <div class="tk-groups" role="group" aria-label="Takvime gidecekler">
            {GROUPS.map((g) => (
              <button type="button" class="tk-chip" aria-pressed={st.groups[g.k]} onClick={() => toggleGroup(g.k)}>
                <Icon n={st.groups[g.k] ? 'check' : g.icon} size={13} w={st.groups[g.k] ? 2.6 : 2} />{g.label}
              </button>
            ))}
          </div>

          <p class="tk-hint">Google Takvim abonelikleri <b>birkaç saatte bir</b> (bazen günde bir) güncellenir; değişiklik hemen görünmeyebilir. iPhone ve Mac daha sık yeniler (Ayarlar → Takvim → Hesaplar → Yeni Verileri Al).</p>

          {on && (
            <div class="tk-actions">
              <button type="button" class={'btn sm' + (confirm === 'yenile' ? ' danger confirm' : ' ghost')} disabled={busy} onClick={yenile}>
                {confirm === 'yenile' ? 'Eski bağlantı çalışmaz olacak · Yenile' : 'Bağlantıyı yenile'}
              </button>
              <span class="spacer" />
              <button type="button" class={'btn sm danger' + (confirm === 'kapat' ? ' confirm' : '')} disabled={busy} onClick={kapat}>
                {confirm === 'kapat' ? 'Emin misin? Kapat' : 'Eşitlemeyi kapat'}
              </button>
            </div>
          )}
        </div>
      )}

      <Switch on={havaOn} label="Dış çekimlerde hava uyarısı" hint="Ertesi gün yağmur ya da kuvvetli rüzgâr bekleniyorsa 18:00'de haber ver" onToggle={toggleHava} />
    </div>
  );
}
