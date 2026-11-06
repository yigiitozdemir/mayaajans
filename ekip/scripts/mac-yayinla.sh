#!/bin/bash
# GitHub'da derlenen Mac uygulamasını imzalar ve ekip.mayaajans.net/indir'e yükler.
# Kullanım: scripts/mac-yayinla.sh   (Cloudflare için CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID tanımlı olmalı)
# İmza anahtarı Cloudflare'deki gizli R2 deposundan (maya-ekip-gizli, dışarıya kapalı) alınır;
# istenirse TAURI_KEY=/yol/anahtar ile verilebilir.
set -euo pipefail
cd "$(dirname "$0")/.."
KEYTMP=""
if [ -z "${TAURI_KEY:-}" ]; then
  KEYTMP="$(mktemp)"; chmod 600 "$KEYTMP"
  npx wrangler r2 object get maya-ekip-gizli/guncelleme-imza.key --file "$KEYTMP" --remote >/dev/null
  TAURI_KEY="$KEYTMP"
fi
trap '[ -n "$KEYTMP" ] && rm -f "$KEYTMP"' EXIT

W="$(mktemp -d)"
git fetch -q origin masaustu-derleme
git --work-tree="$W" checkout origin/masaustu-derleme -- .
git reset -q
VERSION="$(cat "$W/VERSION")"
echo "Sürüm $VERSION ($(cat "$W/COMMIT" | cut -c1-7)) imzalanıyor…"

(cd desktop && npx tauri signer sign -f "$TAURI_KEY" -p "" "$W/MayaEkip.app.tar.gz" >/dev/null)
SIG="$(cat "$W/MayaEkip.app.tar.gz.sig")"
URL="https://ekip.mayaajans.net/indir/MayaEkip.app.tar.gz"
# sürüm notları: desktop/SURUM-NOTLARI.md içindeki "## <sürüm>" bölümü
NOTES="$(awk -v v="## $VERSION" '$0==v{f=1;next} /^## /{f=0} f' desktop/SURUM-NOTLARI.md | sed '/^[[:space:]]*$/d')"
[ -n "$NOTES" ] || { echo "UYARI: desktop/SURUM-NOTLARI.md içinde '## $VERSION' bölümü yok"; }
node -e '
const [v, sig, url, notes] = process.argv.slice(1);
const p = { signature: sig, url };
console.log(JSON.stringify({ version: v, notes, pub_date: new Date().toISOString(),
  platforms: { "darwin-aarch64": p, "darwin-x86_64": p, "darwin-universal": p } }, null, 2));
' "$VERSION" "$SIG" "$URL" "$NOTES" > "$W/latest.json"

put() { npx wrangler r2 object put "maya-ekip-dosyalar/desktop/$1" --file "$W/$1" --content-type "$2" --remote >/dev/null; echo "  ✓ $1"; }
# önce paketler, en son latest.json (yarım yükleme uygulamaları bozmasın)
put MayaEkip.app.tar.gz application/gzip
put MayaEkip.dmg application/x-apple-diskimage
put latest.json application/json
rm -rf "$W"
echo "Yayında: https://ekip.mayaajans.net/indir (sürüm $VERSION)"
