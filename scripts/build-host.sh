#!/usr/bin/env bash
# Builds the headless React Native host (Fantom tester) from the
# third_party/react-native submodule and copies it, with its dylibs, into
# native/dist/<arch>/ as a relocatable folder:
#
#   native/dist/<arch>/rn-a11y-host
#   native/dist/<arch>/lib/libhermesvm.dylib
#   native/dist/<arch>/lib/libjsi.dylib
#
# Requirements: JDK 17, Android SDK (for its CMake), Xcode command line tools,
# Node with corepack. First build takes ~5 min (Hermes from source);
# incremental builds ~20 s.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RN_DIR="$ROOT/third_party/react-native"
FANTOM_DIR="$RN_DIR/private/react-native-fantom"
OVERLAY_DIR="$ROOT/native/overlay"
ARCH="$(uname -m)"
DIST_DIR="$ROOT/native/dist/$ARCH"
CMAKE_VERSION="${CMAKE_VERSION:-3.30.5}"

log() { printf '\033[1m[build-host]\033[0m %s\n' "$*"; }
die() { printf '[build-host] error: %s\n' "$*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "only macOS is supported for now"

# --- (a) toolchain ---------------------------------------------------------

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
[[ -x "$JAVA_HOME/bin/java" ]] || die "JAVA_HOME ($JAVA_HOME) has no bin/java; install JDK 17 (brew install openjdk@17)"
export PATH="$JAVA_HOME/bin:$PATH"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[[ -d "$ANDROID_HOME" ]] || die "ANDROID_HOME ($ANDROID_HOME) does not exist; install the Android SDK"

if [[ ! -x "$ANDROID_HOME/cmake/$CMAKE_VERSION/bin/cmake" ]]; then
  SDKMANAGER="$(ls "$ANDROID_HOME"/cmdline-tools/*/bin/sdkmanager 2>/dev/null | head -n 1 || true)"
  [[ -n "$SDKMANAGER" ]] || die "sdkmanager not found under $ANDROID_HOME/cmdline-tools"
  log "installing cmake;$CMAKE_VERSION with $SDKMANAGER"
  yes | "$SDKMANAGER" --install "cmake;$CMAKE_VERSION" >/dev/null
fi

[[ -f "$RN_DIR/package.json" ]] || die "submodule missing; run: git submodule update --init --depth 1"

# RN's codegen shells out to `yarn`. It must be Yarn 1: put a shim first on PATH.
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
SHIM_DIR="$(mktemp -d)"
trap 'rm -rf "$SHIM_DIR"' EXIT
cat >"$SHIM_DIR/yarn" <<'EOF'
#!/usr/bin/env bash
exec corepack yarn@1.22.22 "$@"
EOF
chmod +x "$SHIM_DIR/yarn"
export PATH="$SHIM_DIR:$PATH"

# --- (b) JS deps in the submodule -------------------------------------------

STAMP="$RN_DIR/node_modules/.rn-a11y-tree-install-stamp"
LOCK_HASH="$(shasum "$RN_DIR/yarn.lock" | cut -d' ' -f1)"
if [[ ! -f "$STAMP" || "$(cat "$STAMP")" != "$LOCK_HASH" ]]; then
  log "yarn install (Yarn 1) in third_party/react-native"
  (cd "$RN_DIR" && yarn install --frozen-lockfile --non-interactive)
  echo "$LOCK_HASH" >"$STAMP"
else
  log "yarn install: up to date"
fi

# --- (c) overlay ------------------------------------------------------------

log "applying native/overlay -> private/react-native-fantom"
rsync -a "$OVERLAY_DIR/" "$FANTOM_DIR/"

# --- (d) build --------------------------------------------------------------

log "gradle :private:react-native-fantom:buildFantomTester (logs: $FANTOM_DIR/build/reports/)"
(cd "$RN_DIR" && ./gradlew :private:react-native-fantom:buildFantomTester --no-daemon --console=plain)

BIN="$FANTOM_DIR/build/tester/fantom_tester"
[[ -x "$BIN" ]] || die "build did not produce $BIN"

# --- (e) relocatable dist ---------------------------------------------------

log "copying to ${DIST_DIR#"$ROOT"/}"
rm -rf "$DIST_DIR"
mkdir -p "$DIST_DIR/lib"
cp "$BIN" "$DIST_DIR/rn-a11y-host"

rpaths_of() {
  otool -l "$1" | awk '/cmd LC_RPATH/{getline; getline; print $2}'
}

# Copy every @rpath dylib the binary links, looking it up in the binary's rpaths.
copy_rpath_deps() {
  local file="$1" dep name found
  for dep in $(otool -L "$file" | awk 'NR>1 && $1 ~ /^@rpath\//{print $1}'); do
    name="${dep#@rpath/}"
    [[ -f "$DIST_DIR/lib/$name" ]] && continue
    found=""
    for rp in $(rpaths_of "$BIN") $(rpaths_of "$file"); do
      if [[ -f "$rp/$name" ]]; then found="$rp/$name"; break; fi
    done
    [[ -n "$found" ]] || die "cannot find $name (needed by $(basename "$file"))"
    cp "$found" "$DIST_DIR/lib/$name"
    chmod u+w "$DIST_DIR/lib/$name"
    copy_rpath_deps "$DIST_DIR/lib/$name"
  done
}
copy_rpath_deps "$DIST_DIR/rn-a11y-host"

# Replace absolute rpaths with relative ones.
fix_rpaths() {
  local file="$1" new="$2" rp
  for rp in $(rpaths_of "$file"); do
    install_name_tool -delete_rpath "$rp" "$file" 2>/dev/null || true
  done
  install_name_tool -add_rpath "$new" "$file"
}
fix_rpaths "$DIST_DIR/rn-a11y-host" "@executable_path/lib"
for lib in "$DIST_DIR"/lib/*.dylib; do
  install_name_tool -id "@rpath/$(basename "$lib")" "$lib"
  fix_rpaths "$lib" "@loader_path"
done

# install_name_tool invalidates signatures; arm64 requires one.
for f in "$DIST_DIR/rn-a11y-host" "$DIST_DIR"/lib/*.dylib; do
  codesign --force --sign - "$f" 2>/dev/null
done

log "done: $DIST_DIR/rn-a11y-host"
otool -L "$DIST_DIR/rn-a11y-host"
