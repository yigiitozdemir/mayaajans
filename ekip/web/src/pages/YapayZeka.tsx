// Yapay Zekâ: ChatGPT ve Claude — herkes kendi hesabıyla.
// Mac programında panelin İÇİNDE açılır (sol menü yerinde kalır); web'de / eski sürümde yeni sekmede.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Bell } from '../components/Notify';
import { desktopCall, desktopOr, isDesktop } from '../desktop';
import { Icon, navigate } from '../ui';
import '../styles/yapayzeka.css';

export const AI_TOOLS = [
  {
    id: 'chatgpt', name: 'ChatGPT', cta: "ChatGPT'yi aç", url: 'https://chatgpt.com/', by: 'OpenAI', icon: 'chat',
    good: ['Görsel oluşturma (story, post, kapak fikirleri)', 'Caption, metin, hashtag', 'Dosya / ekran görüntüsü yükleyip yorumlatma', 'Sesli konuşma'],
  },
  {
    id: 'claude', name: 'Claude', cta: "Claude'u aç", url: 'https://claude.ai/new', by: 'Anthropic', icon: 'asterisk',
    good: ['Uzun metin, caption ve içerik planı', 'Brief, sunum ve rapor taslağı', 'PDF / görsel inceleme ve özetleme', 'Fikir geliştirme, düzeltme, çeviri'],
  },
  {
    id: 'whatsapp', name: 'WhatsApp', cta: "WhatsApp'ı aç", url: 'https://web.whatsapp.com/', by: 'Meta', icon: 'phone',
    good: ['Telefonundaki WhatsApp\'ı QR kodla bir kez bağla', 'Müşteri ve ekip yazışmaları, gruplar', 'Görsel, dosya, ekran görüntüsü gönderme', 'Yeni mesajda Mac bildirimi ve menüde sayı'],
  },
] as const;
type AiId = (typeof AI_TOOLS)[number]['id'];

const LAST = 'maya.ai';
export function lastAi(): AiId { try { const v = localStorage.getItem(LAST); return v === 'claude' || v === 'whatsapp' ? v : 'chatgpt'; } catch { return 'chatgpt'; } }
export const appIconCls = (id: string) => (id === 'chatgpt' ? 'gpt' : id === 'whatsapp' ? 'wa' : 'cld');
/** Telefonda WhatsApp uygulamasını, bilgisayar tarayıcısında WhatsApp Web'i açar. */
export function openAppOutside(id: string, url: string) {
  if (id === 'whatsapp' && /iPhone|iPad|Android/i.test(navigator.userAgent)) { location.href = 'whatsapp://'; return; }
  window.open(url, '_blank', 'noopener');
}
const urlAi = (): AiId | null => { const v = new URLSearchParams(location.search).get('ai'); return v === 'chatgpt' || v === 'claude' || v === 'whatsapp' ? v : null; };

/** Gömülü görünüm desteklenmiyorsa (tarayıcı / eski Mac sürümü) bir kez öğrenilir. */
let embedBroken = !isDesktop;
let embedError = '';
let embedInfo = ''; // Mac programının bildirdiği gerçek ölçüler (teşhis)

export function YapayZeka({ openTask }: { openTask: (id: string) => void }) {
  const [ai, setAi] = useState<AiId>(urlAi() || lastAi());
  const [broken, setBroken] = useState(embedBroken);
  const [help, setHelp] = useState(() => new URLSearchParams(location.search).has('yardim'));
  useEffect(() => {
    const f = () => { const q = new URLSearchParams(location.search); setHelp(q.has('yardim')); const v = urlAi(); if (v) setAi(v); };
    window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); };
  }, []);
  useEffect(() => { try { localStorage.setItem(LAST, ai); } catch { /* */ } }, [ai]);

  if (broken || help) return <AiInfo openTask={openTask} onBack={!broken ? () => navigate('/yapay-zeka?ai=' + ai) : undefined} />;
  return <AiEmbed ai={ai} onFail={() => { embedBroken = true; document.documentElement.classList.add('ai-broken'); window.dispatchEvent(new Event('maya-ai-broken')); setBroken(true); }} />;
}

function AiEmbed({ ai, onFail }: { ai: AiId; onFail: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const tool = AI_TOOLS.find((t) => t.id === ai)!;
  useEffect(() => {
    let raf = 0, alive = true;
    const covered = () => !!document.querySelector('.overlay, .drawer-wrap, .bellpanel');
    const sync = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (!alive || !host.current) return;
        if (covered()) { desktopCall('ai_hide').catch(() => {}); return; }
        const r = host.current.getBoundingClientRect();
        desktopCall('ai_show', { which: ai, x: r.left, y: r.top, w: r.width, h: r.height, dark: document.documentElement.dataset.theme === 'dark' }).then((i) => { if (i) embedInfo = JSON.stringify(i) + ' sayfa:' + innerWidth + 'x' + innerHeight + ' dpr:' + devicePixelRatio; }).catch((e) => { embedError = String((e && (e.message || e)) || 'bilinmeyen hata'); if (alive) onFail(); });
      });
    };
    sync();
    const ro = new ResizeObserver(sync); if (host.current) ro.observe(host.current);
    const mo = new MutationObserver(sync); mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', sync);
    window.addEventListener('maya-theme', sync); // tema değişince zemin rengi de uysun
    return () => {
      alive = false; cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', sync); window.removeEventListener('maya-theme', sync);
      desktopCall('ai_hide').catch(() => {});
    };
  }, [ai]);

  return (
    <div class="ai-embed">
      <div ref={host} class="ai-host" aria-label={tool.name}>
        <span class="sub">{tool.name} yükleniyor…</span>
      </div>
    </div>
  );
}

/** Mac programı panel içi görünümü desteklemiyorsa (1.0.2 öncesi) güncelleme uyarısı. */
function OldAppNotice() {
  const [ver, setVer] = useState<string | null>(null);
  useEffect(() => { if (isDesktop && embedBroken) desktopCall<{ version: string }>('app_info').then((r) => setVer(r?.version || '?')).catch(() => setVer('?')); }, []);
  if (!isDesktop || !embedBroken || !ver) return null;
  return (
    <section class="card ai-old" role="status">
      <strong>ChatGPT, Claude ve WhatsApp'ın programın içinde açılması için Mac programını güncelle</strong>
      <span class="sub">Şu anki sürüm: {ver}. Gereken: 1.0.2 veya üstü. Ekranın üstündeki menü çubuğunda <b>Maya</b> simgesine tıkla → <b>Güncellemeleri denetle</b> → <b>Yeniden başlat</b>. Güncelleyene kadar düğmeler tarayıcıda açar.</span>
    </section>
  );
}

/** Teşhis: programın içinde neden açılmadığını gösterir (destek için). */
function Diagnose() {
  const [ver, setVer] = useState('');
  const t = (window as any).__TAURI__;
  const ti = (window as any).__TAURI_INTERNALS__;
  useEffect(() => { if (isDesktop) desktopCall<{ version: string }>('app_info').then((r) => setVer(r?.version || '')).catch((e) => setVer('hata: ' + String(e?.message || e))); }, []);
  const ua = navigator.userAgent;
  const looksMac = /Macintosh/.test(ua) && !/Safari\/\d/.test(ua.replace(/Version\/[\d.]+ /, ''));
  return (
    <details class="card ai-diag">
      <summary>Teşhis bilgisi (programın içinde açılmıyorsa bunu Claude'a gönder)</summary>
      <code>
        masaüstü bağlantısı: {isDesktop ? 'var' : 'YOK'} · __TAURI__: {t ? 'var' : 'yok'} · internals: {ti ? 'var' : 'yok'}{'\n'}
        program sürümü: {ver || '—'} · gömme hatası: {embedError || '—'}{'\n'}
        ölçüler: {embedInfo || '—'}{'\n'}
        adres: {location.origin} · tarayıcı kimliği: {ua}{looksMac ? ' (Mac uygulaması gibi)' : ''}
      </code>
    </details>
  );
}

function AiInfo({ openTask, onBack }: { openTask: (id: string) => void; onBack?: () => void }) {
  const open = (t: (typeof AI_TOOLS)[number]) => (t.id === 'whatsapp' ? openAppOutside(t.id, t.url) : desktopOr('open_ai', { which: t.id }, () => openAppOutside(t.id, t.url)));
  return (
    <div class="page">
      <header class="row" style="align-items:flex-start;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:6px">
          <h1 class="h1">Uygulamalar</h1>
          <span class="sub">ChatGPT, Claude ve WhatsApp — kendi hesabınla. {isDesktop ? 'Sol menüden açınca panelin içinde açılır.' : "Mac programında panelin içinde açılır; burada yeni sekmede açılır."}</span>
        </div>
        <div class="row">{onBack && <button type="button" class="btn" onClick={onBack}><Icon n="chat" size={15} />Sohbete dön</button>}<Bell onOpenTask={openTask} /></div>
      </header>
      <OldAppNotice />
      <div class="ai-grid">
        {AI_TOOLS.map((t) => (
          <section class={'ai-card ai-' + t.id}>
            <div class="row" style="gap:12px;flex-wrap:nowrap">
              <span class={'aiq-ic lg ' + appIconCls(t.id)} aria-hidden="true"><Icon n={t.icon} size={22} stroke="#fff" w={2.2} /></span>
              <div style="flex:1;min-width:0"><h2>{t.name}</h2><span class="sub">{t.by} · kendi hesabınla</span></div>
            </div>
            <ul>{t.good.map((g) => <li><Icon n="check" size={14} />{g}</li>)}</ul>
            <button type="button" class="btn primary" onClick={() => (isDesktop && !embedBroken ? navigate('/yapay-zeka?ai=' + t.id) : open(t))}><Icon n="ext" size={15} />{t.cta}</button>
          </section>
        ))}
      </div>
      <Diagnose />
      <section class="card ai-tips">
        <h2>Nasıl kullanılır?</h2>
        <ol>
          <li><b>WhatsApp'ı bağlamak:</b> telefonda WhatsApp → Ayarlar → Bağlı Cihazlar → Cihaz Bağla → ekrandaki QR kodu okut. Bir kez yeterli; telefonun yakında olmasa da çalışır. Program açık olduğu sürece yeni mesajlarda Mac bildirimi gelir ve menüde sayı görünür.</li>
          <li><b>ChatGPT / Claude: ilk açılışta bir kez giriş yap.</b> Kendi ChatGPT / Claude hesabını kullanırsın; ücretli aboneliğin varsa o geçerli. Oturum hatırlanır, bir daha sorulmaz.</li>
          <li><b>Google ile girişte sorun çıkarsa</b> e-posta ile (giriş kodu) ya da Apple ile giriş yap.</li>
          <li><b>Oluşturulan görselleri</b> indir düğmesiyle indir; Mac programında doğrudan İndirilenler klasörüne kaydedilir.</li>
          <li><b>Ekran görüntüsü / dosya</b> yapıştırarak (⌘V) ya da sürükleyerek gönderebilirsin.</li>
          <li>Yan yana çalışmak istersen üstteki <b>Ayrı pencere</b> düğmesiyle ayrı pencerede açabilirsin.</li>
          <li>Giriş bilgilerin ve mesajların yalnızca kendi Mac'inde durur; Maya Ekip ve ekip arkadaşların göremez.</li>
        </ol>
      </section>
    </div>
  );
}
