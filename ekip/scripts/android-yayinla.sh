#!/bin/bash
# Android APK'yı yayınlar: GitHub'ın derlediği imzasız APK'yı (android-derleme dalı) Google'ın resmi
# apksigner'ıyla imzalar, doğrular ve ekip.mayaajans.net/indir/MayaEkip.apk'ye yükler.
# Anahtar: R2 maya-ekip-gizli/android-imza.jks + android-parola.txt (GitHub'da tutulmaz).
# Kullanım: scripts/android-yayinla.sh   (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID tanımlı olmalı)
set -euo pipefail
cd "$(dirname "$0")/.."
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
git fetch -q origin android-derleme
git show origin/android-derleme:MayaEkip-imzasiz.apk > "$T/imzasiz.apk"
git show origin/android-derleme:apksigner.jar > "$T/apksigner.jar"
for f in android-imza.jks android-parola.txt; do npx wrangler r2 object get "maya-ekip-gizli/$f" --file "$T/$f" --remote >/dev/null; done
java -jar "$T/apksigner.jar" sign --ks "$T/android-imza.jks" --ks-pass "file:$T/android-parola.txt" --ks-key-alias maya --min-sdk-version 24 --out "$T/MayaEkip.apk" "$T/imzasiz.apk"
java -jar "$T/apksigner.jar" verify --print-certs "$T/MayaEkip.apk" | grep -q "3f46fbf9ad45197542195b6d13b379d5ab6e2d24f55ff7609c1fb610c7f1262c" || { echo "Sertifika beklenen değil"; exit 1; }
npx wrangler r2 object put maya-ekip-dosyalar/desktop/MayaEkip.apk --file "$T/MayaEkip.apk" --content-type application/vnd.android.package-archive --remote
echo "Yayında: https://ekip.mayaajans.net/indir/MayaEkip.apk (sürüm $(git show origin/android-derleme:VERSION))"
