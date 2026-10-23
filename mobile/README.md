# Órbita Mobile (Android TWA)

Trusted Web Activity (android-browser-helper, mesmo modelo gerado pelo Bubblewrap) que abre https://orbita-8nwu.onrender.com em tela cheia.

- Pacote: `app.orbita.mobile` · minSdk 24 (Android 7)
- APK publicado em `static/downloads/Orbita.apk`, servido em `/baixar/Orbita.apk`.
- Verificação de domínio: `/.well-known/assetlinks.json` (rota em `app.py`, impressão digital SHA-256 do certificado).
- A keystore NÃO fica no repositório: `/workspace/secrets/orbita-release.jks` (alias `orbita`), senha em `/workspace/secrets/orbita-release.password`.

Build (JDK 17 + Android SDK build-tools 34):

```
cd mobile/android
echo "sdk.dir=$HOME/android-sdk" > local.properties
ORBITA_KEYSTORE_PASSWORD=$(cat /workspace/secrets/orbita-release.password) gradle assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../../static/downloads/Orbita.apk
```
Para uma nova versão, aumente `versionCode`/`versionName` em `app/build.gradle`.
