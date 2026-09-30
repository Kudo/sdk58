#!/usr/bin/env bash
# Builds the headless React Native host (Fantom tester) from the
# third_party/react-native submodule and copies it, with its dylibs, into
# native/dist/<arch>/ as a relocatable folder:
#
#   native/dist/<arch>/rn-a11y-host   (one executable: Hermes, JSI and
#                                      libcrypto are linked statically)
#
# With the tester's FANTOM_STATIC_HOST=OFF the dylibs are copied to
# native/dist/<arch>/lib/ (libhermesvm.dylib, libjsi.dylib).
#
# RN_A11Y_HOST_BUILD_TYPE=Release (default) | MinSizeRel | Debug selects the
# tester build type (build dir: .../build/tester-<type>). Release and
# MinSizeRel use ThinLTO and -dead_strip, and strip local symbols (strip -x)
# in native/dist. See docs/build-analysis.md.
#
# Requirements: JDK 17, Android SDK (for its CMake and Ninja), Xcode command
# line tools, Node with corepack. First build takes ~5 min on an M4 (Hermes
# from source ~2.5 min, tester ~2.2 min); incremental builds ~10 s (Release)
# or ~3 s (Debug) after the gradle check.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RN_DIR="$ROOT/third_party/react-native"
FANTOM_DIR="$RN_DIR/private/react-native-fantom"
# RN_A11Y_OVERLAY_DIR: build from another copy of native/overlay (for example
# the git index exported with `git checkout-index`, to leave out uncommitted
# work in the tree).
OVERLAY_DIR="${RN_A11Y_OVERLAY_DIR:-$ROOT/native/overlay}"
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

# NDK: nothing is compiled for Android, but Gradle configures ReactAndroid,
# which checks that android.ndkPath (the ANDROID_NDK env var, root
# build.gradle.kts) is the NDK of android.ndkVersion (ANDROID_NDK_VERSION, else
# libs.versions.toml). CI images set ANDROID_NDK* to their own NDK (e.g. 27.3
# on macos-15) while React Native pins another (27.1): use the pinned NDK when
# it is installed, else the NDK from the environment or the newest installed
# one, and pass its version so the check passes without downloading an NDK.
PINNED_NDK="$(sed -n 's/^ndkVersion = "\(.*\)"/\1/p' "$RN_DIR/packages/react-native/gradle/libs.versions.toml")"
ndk_revision() { sed -n 's/^Pkg.Revision *= *//p' "$1/source.properties" 2>/dev/null; }
NDK_DIR=""
if [[ -n "$PINNED_NDK" && -f "$ANDROID_HOME/ndk/$PINNED_NDK/source.properties" ]]; then
  NDK_DIR="$ANDROID_HOME/ndk/$PINNED_NDK"
else
  for candidate in "${ANDROID_NDK:-}" "${ANDROID_NDK_HOME:-}" "${ANDROID_NDK_ROOT:-}" \
    $(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -r); do
    if [[ -n "$candidate" && -f "$candidate/source.properties" ]]; then
      NDK_DIR="$candidate"
      break
    fi
  done
fi
unset ANDROID_NDK ANDROID_NDK_HOME ANDROID_NDK_ROOT ANDROID_NDK_VERSION
NDK_VERSION=""
if [[ -n "$NDK_DIR" ]]; then
  NDK_VERSION="$(ndk_revision "$NDK_DIR")"
  export ANDROID_NDK="$NDK_DIR" ANDROID_NDK_VERSION="$NDK_VERSION"
fi

# Versions, for CI logs.
log "JDK:    $(java -version 2>&1 | head -n 1) ($JAVA_HOME)"
log "CMake:  $("$ANDROID_HOME/cmake/$CMAKE_VERSION/bin/cmake" --version | head -n 1)"
log "Ninja:  $(ninja --version 2>/dev/null || echo 'not on PATH (the SDK CMake bundles one)')"
log "NDK:    ${NDK_VERSION:-none} ${NDK_DIR:+($NDK_DIR)}; React Native pins ${PINNED_NDK:-?}"
log "Gradle: $(sed -n 's/^distributionUrl=.*gradle-\([0-9.]*\)-.*/\1/p' "$RN_DIR/gradle/wrapper/gradle-wrapper.properties")"
log "Node:   $(node --version)"
log "Xcode:  $(xcodebuild -version 2>/dev/null | tr '\n' ' ')($(xcode-select -p 2>/dev/null))"
log "Clang:  $(clang --version | head -n 1)"

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

# RN_A11Y_HOST_BUILD_TYPE: Release (default), MinSizeRel or Debug. Gradle's
# configureFantomTester hardcodes CMAKE_BUILD_TYPE=Debug, so gradle only builds
# the prerequisites (Hermes, third-party sources, codegen) and the tester is
# configured here with the same arguments into build/tester-<type> (Ninja).
#
# RN_A11Y_HOST_SANITIZE=1: a build with AddressSanitizer and
# UndefinedBehaviorSanitizer in build/tester-<type>-sanitize (Debug unless
# RN_A11Y_HOST_BUILD_TYPE is set: Release keeps NDEBUG, which changes React
# Native's code paths, e.g. ShadowNode sealing is off). It is not copied to
# native/dist (the dist binary stays as it is); run it with
# RN_A11Y_HOST_BIN=<printed path>.
SANITIZE="${RN_A11Y_HOST_SANITIZE:-0}"
if [[ "$SANITIZE" == "1" ]]; then
  BUILD_TYPE="${RN_A11Y_HOST_BUILD_TYPE:-Debug}"
else
  BUILD_TYPE="${RN_A11Y_HOST_BUILD_TYPE:-Release}"
fi
case "$BUILD_TYPE" in
  Debug|Release|MinSizeRel) ;;
  *) die "RN_A11Y_HOST_BUILD_TYPE must be Debug, Release or MinSizeRel (got $BUILD_TYPE)" ;;
esac
BUILD_TYPE_LOWER="$(printf '%s' "$BUILD_TYPE" | tr '[:upper:]' '[:lower:]')"

log "gradle :private:react-native-fantom:prepareAllDependencies (Hermes, third-party, codegen; logs: $FANTOM_DIR/build/reports/)"
(cd "$RN_DIR" && ./gradlew :private:react-native-fantom:prepareAllDependencies --no-daemon --console=plain)

CMAKE_BIN_DIR="$ANDROID_HOME/cmake/$CMAKE_VERSION/bin"
FANTOM_BUILD_DIR="$FANTOM_DIR/build"
REACT_NATIVE_DIR="$RN_DIR/packages/react-native"
TESTER_BUILD_DIR="$FANTOM_BUILD_DIR/tester-$BUILD_TYPE_LOWER"
if [[ "$SANITIZE" == "1" ]]; then
  TESTER_BUILD_DIR="$FANTOM_BUILD_DIR/tester-$BUILD_TYPE_LOWER-sanitize"
fi

# Same arguments as configureFantomTester in private/react-native-fantom/build.gradle.kts.
CMAKE_ARGS=(
  -DCMAKE_BUILD_TYPE="$BUILD_TYPE"
  -DFANTOM_CODEGEN_DIR="$FANTOM_BUILD_DIR/codegen"
  -DFANTOM_THIRD_PARTY_DIR="$FANTOM_BUILD_DIR/third-party"
  -DREACT_ANDROID_DIR="$REACT_NATIVE_DIR/ReactAndroid"
  -DREACT_COMMON_DIR="$REACT_NATIVE_DIR/ReactCommon"
  -DREACT_CXX_PLATFORM_DIR="$REACT_NATIVE_DIR/ReactCxxPlatform"
  -DREACT_THIRD_PARTY_NDK_DIR="$REACT_NATIVE_DIR/ReactAndroid/build/third-party-ndk"
  -DRN_ENABLE_DEBUG_STRING_CONVERTIBLE=ON
  -DHERMES_V1_ENABLED=1
)
if [[ "$SANITIZE" == "1" ]]; then
  # vptr explicitly: clang 21 (Xcode 26.6) leaves it out of `undefined`,
  # Xcode 26.3's clang includes it; the tester CMake turns it off for
  # reanimated and rngesturehandler (see FANTOM_SANITIZE there).
  SANITIZE_FLAGS="-fsanitize=address,undefined,vptr -fno-omit-frame-pointer -fno-sanitize-recover=undefined,vptr -g"
  CMAKE_ARGS+=(
    "-DCMAKE_C_FLAGS=$SANITIZE_FLAGS"
    "-DCMAKE_CXX_FLAGS=$SANITIZE_FLAGS"
    "-DCMAKE_OBJC_FLAGS=$SANITIZE_FLAGS"
    "-DCMAKE_OBJCXX_FLAGS=$SANITIZE_FLAGS"
    "-DCMAKE_EXE_LINKER_FLAGS=-fsanitize=address,undefined,vptr"
    -DFANTOM_SANITIZE=ON
  )
elif [[ "$BUILD_TYPE" != "Debug" ]]; then
  # ThinLTO and dead code stripping (docs/build-analysis.md). Debug info (-g)
  # for native/dist/<arch>/rn-a11y-host.dSYM: ThinLTO keeps its objects in
  # lto-objects/ so that dsymutil can read them; the binary is stripped.
  CMAKE_ARGS+=(
    -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON
    -DCMAKE_C_FLAGS=-g
    -DCMAKE_CXX_FLAGS=-g
    -DCMAKE_OBJC_FLAGS=-g
    -DCMAKE_OBJCXX_FLAGS=-g
    "-DCMAKE_EXE_LINKER_FLAGS=-Wl,-dead_strip -Wl,-object_path_lto,$TESTER_BUILD_DIR/lto-objects"
    "-DCMAKE_SHARED_LINKER_FLAGS=-Wl,-dead_strip"
  )
fi

# Configure once per build directory; Ninja re-runs CMake itself when a
# CMakeLists.txt or a CONFIGURE_DEPENDS glob changes.
# Re-configure when the arguments change (the cache keeps the old values).
ARGS_STAMP="$TESTER_BUILD_DIR/.rn-a11y-cmake-args"
ARGS_HASH="$(printf '%s\n' "${CMAKE_ARGS[@]}" | shasum | cut -d' ' -f1)"
if [[ ! -f "$TESTER_BUILD_DIR/build.ninja" || "$(cat "$ARGS_STAMP" 2>/dev/null)" != "$ARGS_HASH" ]]; then
  mkdir -p "$TESTER_BUILD_DIR/lto-objects"
  log "cmake configure ($BUILD_TYPE, Ninja) -> ${TESTER_BUILD_DIR#"$ROOT"/}"
  "$CMAKE_BIN_DIR/cmake" --log-level=ERROR -G Ninja \
    -DCMAKE_MAKE_PROGRAM="$CMAKE_BIN_DIR/ninja" \
    -S "$FANTOM_DIR/tester" -B "$TESTER_BUILD_DIR" "${CMAKE_ARGS[@]}"
  echo "$ARGS_HASH" >"$ARGS_STAMP"
fi

log "cmake --build ($BUILD_TYPE)"
"$CMAKE_BIN_DIR/cmake" --build "$TESTER_BUILD_DIR" --target fantom_tester

BIN="$TESTER_BUILD_DIR/fantom_tester"
[[ -x "$BIN" ]] || die "build did not produce $BIN"

# Warn if the binary is older than an overlay file. This can be harmless
# (an edit that does not change the link output) but usually means a stale build.
NEWER_OVERLAY="$(find "$OVERLAY_DIR" -type f -newer "$BIN" | head -n 5)"
if [[ -n "$NEWER_OVERLAY" ]]; then
  log "warning: $BIN is older than these overlay files:"
  printf '  %s\n' $NEWER_OVERLAY
fi

if [[ "$SANITIZE" == "1" ]]; then
  log "sanitizer build (not copied to native/dist): $BIN"
  log "run: RN_A11Y_HOST_BIN=$BIN ASAN_OPTIONS=detect_leaks=0 node bin/rn-a11y-tree.js ..."
  exit 0
fi

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

# Replace absolute rpaths with relative ones. With the static host (default,
# FANTOM_STATIC_HOST in the tester CMake) there are no @rpath dylibs: the
# rpaths are removed and there is no lib/ directory.
fix_rpaths() {
  local file="$1" new="$2" rp
  for rp in $(rpaths_of "$file"); do
    install_name_tool -delete_rpath "$rp" "$file" 2>/dev/null || true
  done
  if [[ -n "$new" ]]; then
    install_name_tool -add_rpath "$new" "$file"
  fi
}
shopt -s nullglob
DIST_DYLIBS=("$DIST_DIR"/lib/*.dylib)
shopt -u nullglob
if [[ ${#DIST_DYLIBS[@]} -eq 0 ]]; then
  rmdir "$DIST_DIR/lib"
  fix_rpaths "$DIST_DIR/rn-a11y-host" ""
else
  fix_rpaths "$DIST_DIR/rn-a11y-host" "@executable_path/lib"
  for lib in ${DIST_DYLIBS[@]+"${DIST_DYLIBS[@]}"}; do
    install_name_tool -id "@rpath/$(basename "$lib")" "$lib"
    fix_rpaths "$lib" "@loader_path"
  done
fi

# Release/MinSizeRel: debug symbols into rn-a11y-host.dSYM (for crash
# reports: `atos -o rn-a11y-host.dSYM/Contents/Resources/DWARF/rn-a11y-host
# -arch arm64 -l <load address> <addresses>`), then remove local symbols
# (strip -x; exported symbols stay, dylibs need them).
if [[ "$BUILD_TYPE" != "Debug" ]]; then
  log "dsymutil -> ${DIST_DIR#"$ROOT"/}/rn-a11y-host.dSYM"
  dsymutil "$DIST_DIR/rn-a11y-host" -o "$DIST_DIR/rn-a11y-host.dSYM"
  for f in "$DIST_DIR/rn-a11y-host" ${DIST_DYLIBS[@]+"${DIST_DYLIBS[@]}"}; do
    strip -x "$f"
  done
fi

# install_name_tool invalidates signatures; arm64 requires one.
for f in "$DIST_DIR/rn-a11y-host" ${DIST_DYLIBS[@]+"${DIST_DYLIBS[@]}"}; do
  codesign --force --sign - "$f" 2>/dev/null
done

# Anything that is not a system library would make the host non-portable.
NON_SYSTEM_DEPS="$(otool -L "$DIST_DIR/rn-a11y-host" | awk 'NR>1{print $1}' |
  grep -v -e '^/usr/lib/' -e '^/System/Library/' -e '^@rpath/' || true)"
if [[ -n "$NON_SYSTEM_DEPS" ]]; then
  log "warning: rn-a11y-host links non-system libraries:"
  printf '  %s\n' $NON_SYSTEM_DEPS
fi

log "done: $DIST_DIR/rn-a11y-host"
otool -L "$DIST_DIR/rn-a11y-host"
