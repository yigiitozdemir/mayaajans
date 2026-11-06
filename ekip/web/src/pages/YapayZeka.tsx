// Yapay Zekâ: ChatGPT ve Claude — herkes kendi hesabıyla. Mac programında programın içinde ayrı pencerede açılır.
import { Bell } from '../components/Notify';
import { desktopOr, isDesktop } from '../desktop';
import { Icon } from '../ui';
import '../styles/yapayzeka.css';

const TOOLS = [
  {
    id: 'chatgpt', name: 'ChatGPT', cta: "ChatGPT'yi aç", url: 'https://chatgpt.com/', by: 'OpenAI',
    good: ['Görsel oluşturma (story, post, kapak fikirleri)', 'Caption, metin, hashtag', 'Dosya / ekran görüntüsü yükleyip yorumlatma', 'Sesli konuşma'],
  },
  {
    id: 'claude', name: 'Claude', cta: "Claude'u aç", url: 'https://claude.ai/new', by: 'Anthropic',
    good: ['Uzun metin, caption ve içerik planı', 'Brief, sunum ve rapor taslağı', 'PDF / görsel inceleme ve özetleme', 'Fikir geliştirme, düzeltme, çeviri'],
  },
];

export function YapayZeka({ openTask }: { openTask: (id: string) => void }) {
  const open = (t: (typeof TOOLS)[number]) => desktopOr('open_ai', { which: t.id }, () => window.open(t.url, '_blank', 'noopener'));
  return (
    <div class="page">
      <header class="row" style="align-items:flex-start;justify-content:space-between">
        <div style="display:flex;flex-direction:column;gap:6px">
          <h1 class="h1">Yapay Zekâ</h1>
          <span class="sub">ChatGPT ve Claude, kendi hesabınla{isDesktop ? ' — Maya Ekip\'in içinde ayrı pencerede açılır.' : '. Mac programında programın içinde açılır; burada yeni sekmede açılır.'}</span>
        </div>
        <Bell onOpenTask={openTask} />
      </header>

      <div class="ai-grid">
        {TOOLS.map((t) => (
          <section class={'ai-card ai-' + t.id}>
            <div class="row" style="gap:12px;flex-wrap:nowrap">
              <span class="ai-ic" aria-hidden="true"><Icon n="spark" size={22} /></span>
              <div style="flex:1;min-width:0">
                <h2>{t.name}</h2>
                <span class="sub">{t.by} · kendi hesabınla</span>
              </div>
            </div>
            <ul>{t.good.map((g) => <li><Icon n="check" size={14} />{g}</li>)}</ul>
            <button type="button" class="btn primary" onClick={() => open(t)}><Icon n="ext" size={15} />{t.cta}</button>
          </section>
        ))}
      </div>

      <section class="card ai-tips">
        <h2>Nasıl kullanılır?</h2>
        <ol>
          <li><b>İlk açılışta bir kez giriş yap.</b> Kendi ChatGPT / Claude hesabını kullanırsın; ücretli aboneliğin varsa o geçerli. Oturum hatırlanır, bir daha sorulmaz.</li>
          <li><b>Google ile girişte sorun çıkarsa</b> e-posta ile (giriş kodu) ya da Apple ile giriş yap.</li>
          <li><b>Oluşturulan görselleri</b> indir düğmesiyle indir; Mac programında doğrudan İndirilenler klasörüne kaydedilir.</li>
          <li><b>Ekran görüntüsü / dosya</b> yapıştırarak (⌘V) ya da sürükleyerek gönderebilirsin.</li>
          <li>Giriş bilgilerin yalnızca kendi Mac'inde durur; Maya Ekip ve ekip arkadaşların göremez.</li>
          {isDesktop && <li>Üst çubuktaki Maya simgesinden de ChatGPT ve Claude'u doğrudan açabilirsin.</li>}
        </ol>
      </section>
    </div>
  );
}
