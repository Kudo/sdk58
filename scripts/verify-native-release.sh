#!/usr/bin/env bash
# Exercise the actual macOS npm runtime artifact, without rebuilding the host.
# Uses the existing source CLI/E2E assertions; verify-packages.sh separately
# checks installation and execution of the packaged CLI.
# Usage: bash scripts/verify-native-release.sh <release-directory> <arm64|x86_64>
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RELEASE_DIR="$(cd "${1:?release directory required}" && pwd)"
EXPECTED_ARCH="${2:?expected runner architecture required: arm64 or x86_64}"
case "$EXPECTED_ARCH" in
  arm64) EXPECTED_NODE_ARCH=arm64 ;;
  x86_64) EXPECTED_NODE_ARCH=x64 ;;
  *) echo "Unsupported runner architecture: $EXPECTED_ARCH" >&2; exit 1 ;;
esac
if [[ "$(uname -s)" != Darwin || "$(uname -m)" != "$EXPECTED_ARCH" || "$(node -p process.arch)" != "$EXPECTED_NODE_ARCH" ]]; then
  echo "Expected a native $EXPECTED_ARCH macOS runner and matching Node architecture" >&2
  exit 1
fi

shopt -s nullglob
RUNTIME_ARCHIVES=("$RELEASE_DIR"/react-native-a11y-tree-runtime-darwin-universal-*.tgz)
if [[ ${#RUNTIME_ARCHIVES[@]} -ne 1 ]]; then
  echo "Expected exactly one darwin-universal npm runtime tarball in $RELEASE_DIR" >&2
  exit 1
fi

VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/rn-a11y-native-release.XXXXXX")"
trap 'rm -rf "$VERIFY_DIR"' EXIT
tar -xzf "${RUNTIME_ARCHIVES[0]}" -C "$VERIFY_DIR"
PACKAGED_HOST="$VERIFY_DIR/package/osx-bin/rn-a11y-host"
test -f "$PACKAGED_HOST"
chmod +x "$PACKAGED_HOST"
lipo "$PACKAGED_HOST" -verify_arch arm64 x86_64
lipo -info "$PACKAGED_HOST"
echo "Strict native release verification on $EXPECTED_ARCH"
shasum -a 256 "${RUNTIME_ARCHIVES[0]}" "$PACKAGED_HOST"

# Do not allow a runner override or host discovery to substitute a local build.
unset RN_A11Y_HOST_RUNNER RN_A11Y_HOST_BASE_URL RN_A11Y_HOST_MANIFEST RN_A11Y_HOST_SKIP_PACKAGE
export RN_A11Y_HOST_BIN="$PACKAGED_HOST"
export RN_A11Y_E2E_STRICT=1
export RN_A11Y_E2E_PRESETS=android-phone,ios-phone
cd "$SCRIPT_ROOT"
bun run test:e2e
