// Mac uygulaması indirme sayfası ve kendi kendine güncelleme dosyaları (R2: desktop/…)
import { Hono } from 'hono';
import type { Env } from './types';

const SITE = 'https://ekip.mayaajans.net';
const FILES: Record<string, string> = {
  'latest.json': 'application/json',
  'MayaEkip.dmg': 'application/x-apple-diskimage',
  'MayaEkip.app.tar.gz': 'application/gzip',
  'MayaEkip.apk': 'application/vnd.android.package-archive',
};

const KUR_SH = `#!/bin/bash
# Maya Ekip — Mac kurulumu
set -e
echo "Maya Ekip indiriliyor…"
T="$(mktemp -d)"
curl -fsSL ${SITE}/indir/MayaEkip.app.tar.gz -o "$T/maya.tgz"
osascript -e 'quit app "Maya Ekip"' >/dev/null 2>&1 || true
sleep 1
rm -rf "/Applications/Maya Ekip.app"
tar -xzf "$T/maya.tgz" -C /Applications
xattr -dr com.apple.quarantine "/Applications/Maya Ekip.app" 2>/dev/null || true
rm -rf "$T"
open "/Applications/Maya Ekip.app"
echo "Maya Ekip kuruldu. Program açılıyor ve bundan sonra bilgisayar açılınca kendiliğinden başlayacak."
`;

const page = (version: string | null, apk: boolean, ua: string) => `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Maya Ekip · İndir</title><link rel="icon" href="/favicon-32.png">
<style>
:root{color-scheme:light}body{margin:0;background:#F4F1EC;color:#2B1E17;font:15px/1.6 -apple-system,BlinkMacSystemFont,Inter,sans-serif}
main{max-width:620px;margin:0 auto;padding:56px 20px}img.logo{width:180px;display:block;margin-bottom:32px}
h1{font-size:26px;margin:0 0 6px}h1#mac{margin-top:44px}p.sub{color:#6E5F55;margin:0 0 28px}
.card{background:#FBF9F6;border:1px solid #E4DCD2;border-radius:14px;padding:22px;margin-bottom:16px}
.card h2{font-size:16px;margin:0 0 6px}.card p{margin:0 0 14px;color:#4A3C33}
code{display:block;background:#2B1E17;color:#F4F1EC;border-radius:8px;padding:12px 14px;font:13px/1.5 ui-monospace,Menlo,monospace;word-break:break-all;user-select:all}
a.btn,button{display:inline-block;background:#9B573F;color:#fff;text-decoration:none;font:inherit;font-weight:600;border:0;border-radius:9px;padding:10px 18px;cursor:pointer}
button.ghost{background:transparent;color:#8A4B34;border:1px solid #D9C9BC;margin-top:10px;padding:7px 14px;font-size:13px}
ol{margin:0;padding-left:20px;color:#4A3C33}li{margin-bottom:4px}.mute{color:#8C7D72;font-size:13px}
</style></head><body><main>
<img class="logo" src="/logo.png" alt="Maya Ajans">
${phoneCards(apk, ua)}
<h1 id="mac">Maya Ekip · Mac uygulaması</h1>
<p class="sub">Bilgisayar açılınca kendiliğinden başlar, üst çubukta durur, bildirimleri Mac bildirimi olarak gösterir ve kendini günceller.${version ? ' Güncel sürüm: ' + version + '.' : ''}</p>
${version ? `
<div class="card"><h2>Kolay kurulum (önerilen)</h2>
<p><b>Terminal</b>'i açın (Spotlight'ta <i>Terminal</i> yazın), aşağıdaki satırı yapıştırıp Enter'a basın:</p>
<code id="cmd">curl -fsSL ${SITE}/indir/kur.sh | bash</code>
<button class="ghost" type="button" onclick="navigator.clipboard.writeText(document.getElementById('cmd').textContent);this.textContent='Kopyalandı ✓'">Kopyala</button>
</div>
<div class="card"><h2>DMG ile kurulum</h2>
<p><a class="btn" href="/indir/MayaEkip.dmg">Mac için indir (.dmg)</a></p>
<ol><li>DMG'yi açın, <b>Maya Ekip</b>'i <b>Uygulamalar</b> klasörüne sürükleyin.</li>
<li>İlk açılışta Mac "doğrulanamadı" derse: <b>Sistem Ayarları → Gizlilik ve Güvenlik</b>'te aşağıdaki <b>Yine de Aç</b>'a basın.</li>
<li>E-posta ve şifrenizle bir kez giriş yapın; bir daha sorulmaz.</li></ol>
</div>
<p class="mute">Apple Silicon (M1–M4) ve Intel Mac'lerde çalışır · macOS 11 ve üzeri.</p>
` : `<div class="card"><h2>Hazırlanıyor</h2><p>Mac uygulaması birazdan burada olacak. Bu sırada programı tarayıcıdan kullanabilirsiniz: <a href="/">${SITE.replace('https://', '')}</a></p></div>`}
</main></body></html>`;

function phoneCards(apk: boolean, ua: string) {
  const android = `<div class="card" id="android"><h2>Android (Samsung, Galaxy Z Fold …)</h2>
${apk ? `<p>Maya Ekip uygulamasını indirip kurun. Program tam ekran açılır, bildirimler "Maya Ekip" adıyla gelir, katlanır telefonlarda açık ve kapalı ekrana uyar.</p>
<p><a class="btn" href="/indir/MayaEkip.apk">Android için indir (.apk)</a></p>
<ol><li>İnen dosyaya dokunun. Telefon "bilinmeyen uygulama" derse <b>Ayarlar</b>'a girip <b>Bu kaynağa izin ver</b>'i açın, geri dönüp <b>Yükle</b>'ye basın.</li>
<li>Uygulamayı açın, e-posta ve şifrenizle bir kez giriş yapın.</li>
<li>Bildirim izni sorulursa <b>İzin ver</b>'e basın; sonra profilinizden telefon bildirimlerini açın.</li></ol>`
    : `<p>Android uygulaması hazırlanıyor. Bu sırada Chrome'da siteyi açıp ⋮ menüsünden <b>Uygulamayı yükle</b>'ye basabilirsiniz.</p>`}
<p class="mute">Telefonda Chrome yüklü olmalı (Samsung'larda hazır gelir).</p></div>`;
  const iphone = `<div class="card" id="iphone"><h2>iPhone</h2>
<p>Safari'de <b>${SITE.replace('https://', '')}</b> adresini açın → alttaki <b>Paylaş</b> düğmesi → <b>Ana Ekrana Ekle</b>. Ana ekrandaki Maya simgesinden açın ve profilinizden bildirimleri açın.</p>
<p class="mute">Bildirimler yalnızca ana ekrana eklenen uygulamada çalışır (iOS 16.4 ve üzeri).</p></div>`;
  const isIos = /iPhone|iPad|iPod/.test(ua);
  return `<h1>Maya Ekip · Telefon</h1><p class="sub">Programı telefonunuzda uygulama gibi kullanın.</p>` + (isIos ? iphone + android : android + iphone);
}

export const indir = new Hono<{ Bindings: Env }>();

indir.get('/', async (c) => {
  let version: string | null = null;
  const obj = await c.env.FILES.get('desktop/latest.json');
  if (obj) { try { version = (await obj.json<{ version: string }>()).version; } catch { /* */ } }
  const apk = !!(await c.env.FILES.head('desktop/MayaEkip.apk'));
  return c.html(page(version, apk, c.req.header('User-Agent') || ''), 200, { 'Cache-Control': 'no-cache', 'X-Frame-Options': 'DENY' });
});

indir.get('/kur.sh', (c) => c.body(KUR_SH, 200, { 'Content-Type': 'text/x-shellscript; charset=utf-8', 'Cache-Control': 'no-cache' }));

indir.get('/:name', async (c) => {
  const name = c.req.param('name');
  const ct = FILES[name];
  if (!ct) return c.text('Bulunamadı', 404);
  const obj = await c.env.FILES.get('desktop/' + name);
  if (!obj) return c.text('Henüz yayınlanmadı', 404);
  const headers: Record<string, string> = {
    'Content-Type': ct,
    'Cache-Control': name === 'latest.json' ? 'no-cache' : 'public, max-age=300',
    'Content-Length': String(obj.size),
    ETag: obj.httpEtag,
  };
  if (name !== 'latest.json') headers['Content-Disposition'] = `attachment; filename="${name}"`;
  return new Response(obj.body, { headers });
});
