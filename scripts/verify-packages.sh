#!/usr/bin/env bash
# Installs the packed npm tarballs in <dir> (react-native-a11y-tree-*.tgz and
# react-native-a11y-tree-runtime-*.tgz, from release-host.yml) into a scratch Expo project and
# renders examples/basic/App.tsx with the directly installed optional runtime
# (RN_A11Y_HOST_BIN, RN_A11Y_HOST_SKIP_PACKAGE and RN_A11Y_HOST_BASE_URL
# unset). Fails unless the session's ready line says host.source "package".
#
#   scripts/verify-packages.sh <dir>

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$(cd "${1:?usage: scripts/verify-packages.sh <dir with the .tgz files>}" && pwd)"
CLI_TGZ="$(ls "$DIR"/react-native-a11y-tree-[0-9]*.tgz)"
PLATFORM="$(node -p "process.platform === 'darwin' ? 'darwin-universal' : process.platform === 'linux' ? 'linux-' + process.arch + '-gnu' : 'win32-' + process.arch + '-msvc'")"
PLATFORM_TGZ="$(ls "$DIR"/react-native-a11y-tree-runtime-"$PLATFORM"-*.tgz)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
cd "$WORK"
npm init -y >/dev/null
npm install --no-audit --no-fund expo@58.0.0 react-native@0.88.0-rc.2 react@19.3.0 "$CLI_TGZ" "$PLATFORM_TGZ"
cp "$ROOT/examples/basic/App.tsx" .
unset RN_A11Y_HOST_BIN RN_A11Y_HOST_SKIP_PACKAGE RN_A11Y_HOST_BASE_URL RN_A11Y_HOST_MANIFEST

npx rn-a11y-tree render App.tsx --preset android-phone --format text -v | tee render.txt
grep -q '^    submit View #submit role=button "Submit" {24,' render.txt

printf '{"id":1,"quit":true}\n' | npx rn-a11y-tree session App.tsx --preset android-phone > session.jsonl
node -e '
  const ready = JSON.parse(require("fs").readFileSync("session.jsonl", "utf8").split("\n")[0]);
  console.log("host:", JSON.stringify(ready.host));
  if (!ready.ready || ready.host?.source !== "package") process.exit(1);
'
