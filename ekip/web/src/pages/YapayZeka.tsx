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

export function YapayZeka({ openTask }: { openTask: (id: string) => void }) {
  const [ai, setAi] = useState<AiId>(urlAi() || lastAi());
  const [broken, setBroken] = useState(embedBroken);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    const f = () => { const v = urlAi(); if (v) setAi(v); };
    window.addEventListener('maya-nav', f); window.addEventListener('popstate', f);
    return () => { window.removeEventListener('maya-nav', f); window.removeEventListener('popstate', f); };
  }, []);
  useEffect(() => { try { localStorage.setItem(LAST, ai); } catch { /* */ } }, [ai]);

  if (broken || help) return <AiInfo openTask={openTask} onBack={!broken ? () => setHelp(false) : undefined} />;
  return <AiEmbed ai={ai} openTask={openTask} onHelp={() => setHelp(true)} onFail={() => { embedBroken = true; setBroken(true); }} />;
}

function AiEmbed({ ai, openTask, onHelp, onFail }: { ai: AiId; openTask: (id: string) => void; onHelp: () => void; onFail: () => void }) {
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
        desktopCall('ai_show', { which: ai, x: r.left, y: r.top, w: r.width, h: r.height, dark: document.documentElement.dataset.theme === 'dark' }).catch(() => { if (alive) onFail(); });
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
      <header class="ai-bar">
        <div class="seg" role="tablist" aria-label="Uygulamalar">
          {AI_TOOLS.map((t) => (
            <button type="button" role="tab" aria-selected={t.id === ai} class={t.id === ai ? 'on' : ''} onClick={() => navigate('/yapay-zeka?ai=' + t.id)}>
              <span class={'aiq-ic sm ' + appIconCls(t.id)} aria-hidden="true"><Icon n={t.icon} size={12} stroke="#fff" w={2.4} /></span>{t.name}
            </button>
          ))}
        </div>
        <span class="sub ai-bar-note">Kendi hesabınla · giriş bilgilerin yalnızca bu Mac'te</span>
        <span class="spacer" />
        {ai !== 'whatsapp' && (
          <button type="button" class="btn sm" onClick={() => desktopOr('open_ai', { which: ai }, () => window.open(tool.url, '_blank', 'noopener'))} title="Yan yana çalışmak için ayrı pencerede aç">
            <Icon n="ext" size={14} />Ayrı pencere
          </button>
        )}
        <button type="button" class="iconbtn" aria-label="Nasıl kullanılır?" title="Nasıl kullanılır?" onClick={onHelp}><Icon n="help" size={16} /></button>
        <Bell onOpenTask={openTask} />
      </header>
      <div ref={host} class="ai-host" aria-label={tool.name}>
        <span class="sub">{tool.name} yükleniyor…</span>
      </div>
    </div>
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
