#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
if ! command -v xcodebuild >/dev/null 2>&1; then
  echo "Instale e selecione o Xcode completo antes de executar este script." >&2
  exit 1
fi
DERIVED="${DERIVED_DATA:-$ROOT/build/DerivedData}"
mkdir -p "$ROOT/build"
xcodebuild -version
xcodebuild -resolvePackageDependencies -project Orbita.xcodeproj -scheme Orbita \
  -clonedSourcePackagesDirPath "$ROOT/build/SourcePackages"
xcodebuild -project Orbita.xcodeproj -scheme Orbita -configuration Debug \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath "$DERIVED" \
  -clonedSourcePackagesDirPath "$ROOT/build/SourcePackages" CODE_SIGNING_ALLOWED=NO build
if [[ -z "${DESTINATION:-}" ]]; then
  echo "Build concluído. Testes NÃO executados: defina DESTINATION com um simulador instalado."
  xcrun simctl list devices available
  echo "Exemplo: DESTINATION='platform=iOS Simulator,name=iPhone 16' bash scripts/validate-macos.sh"
  exit 2
fi
TEST_ARGS=(-only-testing:OrbitaTests)
if [[ "${RUN_UI_TESTS:-0}" == "1" ]]; then TEST_ARGS+=(-only-testing:OrbitaUITests); fi
RESULT="$ROOT/build/Tests-$(date +%Y%m%d-%H%M%S).xcresult"
xcodebuild -project Orbita.xcodeproj -scheme Orbita -configuration Debug \
  -destination "$DESTINATION" -derivedDataPath "$DERIVED" \
  -clonedSourcePackagesDirPath "$ROOT/build/SourcePackages" \
  -resultBundlePath "$RESULT" "${TEST_ARGS[@]}" CODE_SIGNING_ALLOWED=NO test
echo "Build e testes selecionados concluídos. Resultado: $RESULT"
echo "Ainda é necessário testar mídia, interrupções, rede e desempenho em iPhone físico."
