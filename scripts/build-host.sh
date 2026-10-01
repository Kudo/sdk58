#!/usr/bin/env bash
# Builds the headless React Native host (Fantom tester) from the
# third_party/react-native submodule and copies it, with its dylibs, into
# native/dist/<arch>/ as a relocatable folder:
#
#   native/dist/<arch>/rn-a11y-host   (one executable: Hermes and JSI are
#                                      linked statically; SHA-256 through a
#                                      CommonCrypto shim, no OpenSSL)
#
# With the tester's FANTOM_STATIC_HOST=OFF the dylibs are copied to
# native/dist/<arch>/lib/ (libhermesvm.dylib, libjsi.dylib).
#
# RN_A11Y_HOST_ARCH=arm64 | x86_64 | universal (default: the build machine's
# architecture). A foreign architecture (x86_64 on an arm64 Mac) gets its own
# Hermes build (ReactAndroid/hermes-engine/build/hermes-<arch>, with the
# native build's hermesc through IMPORT_HOST_COMPILERS; rebuilt when the
# Hermes source revision changes) and tester build dir (tester-<type>-<arch>),
# and goes to native/dist/<arch>/. `universal` builds arm64 and x86_64 and
# joins them with lipo into native/dist/universal/rn-a11y-host (+ .dSYM).
#
# RN_A11Y_TEXT_LAYOUT=macos | portable | stub selects the tester's
# FANTOM_TEXT_LAYOUT (text measurement: CoreText, the portable stb_truetype
# layout with the embedded fonts, or the upstream stub). Default: macos on
# macOS, portable on Linux. A non-default layout gets its own tester build dir
# (tester-<type>-<layout>) and goes to native/dist/<arch>-<layout>/ (not with
# RN_A11Y_HOST_ARCH=universal).
#
# RN_A11Y_TESTER_BUILD_DIR: the tester build directory instead of
# .../build/tester-<type>[-<arch>][-<layout>] (e.g. D:/t on Windows).
#
# RN_A11Y_HOST_BUILD_TYPE=Release (default) | MinSizeRel | Debug selects the
# tester build type (build dir: .../build/tester-<type>). Release and
# MinSizeRel use ThinLTO and -dead_strip, and strip local symbols (strip -x)
# in native/dist. See docs/build-analysis.md.
#
# Linux (x86_64; arm64 builds too): native/dist/x86_64/rn-a11y-host, one
# executable that links only glibc dynamically (libstdc++, libgcc, libatomic,
# ICU, OpenSSL's libcrypto, Hermes and JSI are static; the tester CMake does
# this for FANTOM_STATIC_HOST off Apple). Text uses the portable layout by
# default (RN_A11Y_TEXT_LAYOUT above; macos is Apple only). Release strips the binary and keeps its
# symbols in rn-a11y-host.debug (objcopy --only-keep-debug; no -g, so symbols
# but no line tables). Needs clang (CC/CXX default to clang/clang++), ld.lld
# (used when on PATH), static ICU and OpenSSL (Ubuntu: libicu-dev,
# libssl-dev), rsync. RN_A11Y_HOST_ARCH must be the machine's architecture.
#
# Windows (x64, Git Bash): native/dist/x86_64/rn-a11y-host.exe, one
# executable with the static MSVC runtime (/MT) and static ICU; it imports
# only Windows system DLLs. Run in an MSVC developer environment (vcvars64:
# cl.exe, link.exe) with LLVM (clang-cl, lld-link, llvm-lib) on PATH. Hermes
# is built with MSVC (cl.exe; Hermes' CMake does not support clang-cl), the
# tester with clang-cl (the tester CMake translates the GCC-style options of
# the React Native CMake files). ICU: scripts/build-icu.sh <prefix> (needs
# MSYS2), then ICU_ROOT=<prefix>. Gradle's Windows paths are avoided:
# react-native-codegen's lib/ is built with node (its build.sh fails in Git
# Bash) and Hermes is configured here (gradle passes JSI_DIR with
# backslashes, which Hermes' CMake reads as escapes). Release: no debug
# information. See docs/research/windows-feasibility.md.
#
# Requirements: JDK 17, Android SDK (for its CMake and Ninja), Xcode command
# line tools (macOS), Node with corepack. Homebrew OpenSSL is not needed (the tester's
# FANTOM_OPENSSL_SHIM, default ON). The x86_64 slice on an arm64 Mac adds its
# own Hermes build (~1.5 min) and tester build (~3.5 min); it cannot run here
# without Rosetta. First build takes ~5 min on an M4 (Hermes
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
OS="$(uname -s)"
case "$OS" in MINGW*|MSYS*|CYGWIN*) OS=Windows ;; esac
MACHINE_ARCH="$(uname -m)"
# Linux arm64: the same name as on macOS (and as os.arch() in src/host.ts).
[[ "$MACHINE_ARCH" == "aarch64" ]] && MACHINE_ARCH=arm64
ARCH="${RN_A11Y_HOST_ARCH:-$MACHINE_ARCH}"
DEFAULT_TEXT_LAYOUT=macos
[[ "$OS" == "Darwin" ]] || DEFAULT_TEXT_LAYOUT=portable
TEXT_LAYOUT="${RN_A11Y_TEXT_LAYOUT:-$DEFAULT_TEXT_LAYOUT}"
DIST_DIR="$ROOT/native/dist/$ARCH"
if [[ "$TEXT_LAYOUT" != "$DEFAULT_TEXT_LAYOUT" ]]; then
  DIST_DIR="$ROOT/native/dist/$ARCH-$TEXT_LAYOUT"
fi
EXE=""
[[ "$OS" == "Windows" ]] && EXE=".exe"
CMAKE_VERSION="${CMAKE_VERSION:-3.30.5}"

log() { printf '\033[1m[build-host]\033[0m %s\n' "$*"; }
die() { printf '[build-host] error: %s\n' "$*" >&2; exit 1; }

case "$OS" in
  Darwin|Linux|Windows) ;;
  *) die "only macOS, Linux and Windows are supported (got $OS)" ;;
esac
if [[ "$OS" != "Darwin" && "$ARCH" != "$MACHINE_ARCH" ]]; then
  die "on $OS RN_A11Y_HOST_ARCH must be the machine's architecture ($MACHINE_ARCH, got $ARCH)"
fi
if [[ "$OS" == "Windows" && "$ARCH" != "x86_64" ]]; then
  die "on Windows only x86_64 is supported (got $ARCH)"
fi

# Hash of stdin, for stamps (SHA-1 with shasum on macOS, SHA-256 on Linux,
# where shasum is not always installed).
hash_stdin() {
  if [[ "$OS" == "Darwin" ]]; then shasum | cut -d' ' -f1; else sha256sum | cut -d' ' -f1; fi
}

# A path for the native tools (CMake, Ninja): C:/... on Windows.
native_path() {
  if [[ "$OS" == "Windows" ]]; then cygpath -m "$1"; else printf '%s' "$1"; fi
}

case "$TEXT_LAYOUT" in
  macos|portable|stub) ;;
  *) die "RN_A11Y_TEXT_LAYOUT must be macos, portable or stub (got $TEXT_LAYOUT)" ;;
esac
[[ "$TEXT_LAYOUT" != "macos" || "$OS" == "Darwin" ]] || die "RN_A11Y_TEXT_LAYOUT=macos needs macOS (CoreText)"

case "$ARCH" in
  arm64|x86_64) ;;
  universal)
    [[ "$TEXT_LAYOUT" == "macos" ]] || die "RN_A11Y_HOST_ARCH=universal needs RN_A11Y_TEXT_LAYOUT=macos"
    # Both slices (each a full run of this script), then one fat binary.
    for slice in arm64 x86_64; do
      log "universal: building the $slice slice"
      RN_A11Y_HOST_ARCH="$slice" "$0"
    done
    rm -rf "$DIST_DIR"
    mkdir -p "$DIST_DIR"
    lipo -create "$ROOT/native/dist/arm64/rn-a11y-host" "$ROOT/native/dist/x86_64/rn-a11y-host" \
      -output "$DIST_DIR/rn-a11y-host"
    codesign --force --sign - "$DIST_DIR/rn-a11y-host" 2>/dev/null
    if [[ -d "$ROOT/native/dist/arm64/rn-a11y-host.dSYM" && -d "$ROOT/native/dist/x86_64/rn-a11y-host.dSYM" ]]; then
      cp -R "$ROOT/native/dist/arm64/rn-a11y-host.dSYM" "$DIST_DIR/"
      DWARF=Contents/Resources/DWARF/rn-a11y-host
      lipo -create "$ROOT/native/dist/arm64/rn-a11y-host.dSYM/$DWARF" \
        "$ROOT/native/dist/x86_64/rn-a11y-host.dSYM/$DWARF" -output "$DIST_DIR/rn-a11y-host.dSYM/$DWARF"
    fi
    log "universal: $(lipo -info "$DIST_DIR/rn-a11y-host" | sed 's/.*: //') ($(stat -f%z "$DIST_DIR/rn-a11y-host") bytes) -> ${DIST_DIR#"$ROOT"/}/rn-a11y-host"
    exit 0
    ;;
  *) die "RN_A11Y_HOST_ARCH must be arm64, x86_64 or universal (got $ARCH)" ;;
esac
CROSS_ARCH=0
[[ "$ARCH" != "$MACHINE_ARCH" ]] && CROSS_ARCH=1

# --- (a) toolchain ---------------------------------------------------------

if [[ "$OS" == "Darwin" ]]; then
  export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
  JDK_HINT="brew install openjdk@17"
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
elif [[ "$OS" == "Windows" ]]; then
  # POSIX forms of the Windows paths (C:\... in the environment).
  [[ -n "${JAVA_HOME:-}" ]] && JAVA_HOME="$(cygpath -u "$JAVA_HOME")"
  export JAVA_HOME="${JAVA_HOME:-}"
  JDK_HINT="e.g. winget install EclipseAdoptium.Temurin.17.JDK, and set JAVA_HOME"
  if [[ -n "${ANDROID_HOME:-}" ]]; then
    ANDROID_HOME="$(cygpath -u "$ANDROID_HOME")"
  else
    ANDROID_HOME="$(cygpath -u "${LOCALAPPDATA:-$HOME/AppData/Local}")/Android/Sdk"
  fi
  export ANDROID_HOME
  command -v cl >/dev/null || die "cl.exe not on PATH: run in an MSVC developer environment (vcvars64.bat, or ilammy/msvc-dev-cmd in CI)"
  for tool in clang-cl lld-link llvm-lib llvm-readobj; do
    command -v "$tool" >/dev/null || die "$tool not on PATH (install LLVM, e.g. C:\Program Files\LLVM\bin)"
  done
  [[ -n "${ICU_ROOT:-}" && -f "$ICU_ROOT/lib/sicuuc.lib" ]] ||
    die "ICU_ROOT must be a static ICU build (scripts/build-icu.sh <prefix>, then ICU_ROOT=<prefix>; got '${ICU_ROOT:-}')"
else
  # The JDK of the java on PATH (e.g. /usr/lib/jvm/java-17-openjdk-amd64).
  if [[ -z "${JAVA_HOME:-}" ]] && command -v java >/dev/null; then
    JAVA_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v java)")")")"
  fi
  export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-17-openjdk-amd64}"
  JDK_HINT="e.g. apt install openjdk-17-jdk-headless"
  # Android Studio's default SDK location on Linux.
  export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
  # Hermes (gradle) and the tester are built with clang: the upstream code
  # and its -Werror flags are not checked with GCC.
  export CC="${CC:-clang}" CXX="${CXX:-clang++}"
  command -v "$CXX" >/dev/null || die "$CXX not found; install clang (or set CC/CXX)"
fi
[[ -x "$JAVA_HOME/bin/java" ]] || die "JAVA_HOME ($JAVA_HOME) has no bin/java; install JDK 17 ($JDK_HINT)"
export PATH="$JAVA_HOME/bin:$PATH"

[[ -d "$ANDROID_HOME" ]] || die "ANDROID_HOME ($ANDROID_HOME) does not exist; install the Android SDK"

if [[ ! -x "$ANDROID_HOME/cmake/$CMAKE_VERSION/bin/cmake$EXE" ]]; then
  SDKMANAGER="$(ls "$ANDROID_HOME"/cmdline-tools/*/bin/sdkmanager "$ANDROID_HOME"/cmdline-tools/*/bin/sdkmanager.bat 2>/dev/null | head -n 1 || true)"
  [[ -n "$SDKMANAGER" ]] || die "sdkmanager not found under $ANDROID_HOME/cmdline-tools"
  log "installing cmake;$CMAKE_VERSION with $SDKMANAGER"
  yes | "$SDKMANAGER" --install "cmake;$CMAKE_VERSION" >/dev/null
fi
# The SDK CMake for Linux is x86_64 only. Gradle reads CMake from this path
# only (cmakeBinaryPath in private/react-native-fantom/build.gradle.kts), so
# on Linux arm64 the system cmake and ninja take its place.
if [[ "$OS" == "Linux" ]] && ! "$ANDROID_HOME/cmake/$CMAKE_VERSION/bin/cmake" --version >/dev/null 2>&1; then
  command -v cmake >/dev/null && command -v ninja >/dev/null ||
    die "the SDK CMake $CMAKE_VERSION does not run on this machine and there is no system cmake + ninja to use instead"
  log "the SDK CMake $CMAKE_VERSION does not run here: using $(command -v cmake) and $(command -v ninja) in its place"
  rm -rf "$ANDROID_HOME/cmake/$CMAKE_VERSION"
  mkdir -p "$ANDROID_HOME/cmake/$CMAKE_VERSION/bin"
  ln -s "$(command -v cmake)" "$ANDROID_HOME/cmake/$CMAKE_VERSION/bin/cmake"
  ln -s "$(command -v ninja)" "$ANDROID_HOME/cmake/$CMAKE_VERSION/bin/ninja"
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
if [[ "$OS" == "Darwin" ]]; then
  log "Xcode:  $(xcodebuild -version 2>/dev/null | tr '\n' ' ')($(xcode-select -p 2>/dev/null))"
  log "Clang:  $(clang --version | head -n 1)"
elif [[ "$OS" == "Windows" ]]; then
  log "OS:     $(uname -s) ($(uname -r))"
  log "MSVC:   $(cl 2>&1 | head -n 1 | tr -d '\r') ($(command -v cl))"
  log "Clang:  $(clang-cl --version | head -n 1) ($(command -v clang-cl))"
  log "ICU:    $ICU_ROOT"
else
  log "OS:     $(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-}") ($(uname -r)), glibc $(ldd --version 2>/dev/null | head -n 1 | awk '{print $NF}')"
  log "Clang:  $("$CXX" --version | head -n 1) ($CXX)"
fi

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
LOCK_HASH="$(hash_stdin <"$RN_DIR/yarn.lock")"
if [[ ! -f "$STAMP" || "$(cat "$STAMP")" != "$LOCK_HASH" ]]; then
  log "yarn install (Yarn 1) in third_party/react-native"
  (cd "$RN_DIR" && yarn install --frozen-lockfile --non-interactive)
  echo "$LOCK_HASH" >"$STAMP"
else
  log "yarn install: up to date"
fi

# --- (c) overlay ------------------------------------------------------------

log "applying native/overlay -> private/react-native-fantom"
if command -v rsync >/dev/null; then
  rsync -a "$OVERLAY_DIR/" "$FANTOM_DIR/"
else
  # Git for Windows has no rsync.
  cp -R "$OVERLAY_DIR/." "$FANTOM_DIR/"
fi

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

CMAKE_BIN_DIR="$ANDROID_HOME/cmake/$CMAKE_VERSION/bin"
FANTOM_BUILD_DIR="$FANTOM_DIR/build"
REACT_NATIVE_DIR="$RN_DIR/packages/react-native"

if [[ "$OS" == "Windows" ]]; then
  # react-native-codegen lib/: gradle's buildCodegenCLI runs
  # scripts/oss/build.sh, whose Windows branch tars "<abs>/scripts/oss/../.."
  # and fails in Git Bash ("Member name contains '..'"). The same build with
  # node and the workspace's dependencies; buildCodegenCLI is skipped.
  CODEGEN_DIR="$RN_DIR/packages/react-native-codegen"
  CODEGEN_CLI="$CODEGEN_DIR/lib/cli/combine/combine-js-to-schema-cli.js"
  if [[ ! -f "$CODEGEN_CLI" || -n "$(find "$CODEGEN_DIR/src" -newer "$CODEGEN_CLI" -name '*.js' | head -n 1)" ]]; then
    log "react-native-codegen lib/ (node scripts/build.js)"
    (cd "$CODEGEN_DIR" && rm -rf lib && node scripts/build.js >/dev/null)
  fi
  # Gradle without the Hermes build (configured below): codegen, the
  # third-party sources and the Hermes source.
  log "gradle: codegen, third-party sources, Hermes source (logs: $FANTOM_DIR/build/reports/)"
  # Gradle (Java) reads these variables as Windows paths.
  GRADLE_ENV=(JAVA_HOME="$(cygpath -w "$JAVA_HOME")" ANDROID_HOME="$(cygpath -w "$ANDROID_HOME")"
    ANDROID_SDK_ROOT="$(cygpath -w "$ANDROID_HOME")")
  [[ -n "${ANDROID_NDK:-}" ]] && GRADLE_ENV+=(ANDROID_NDK="$(cygpath -w "$ANDROID_NDK")")
  (cd "$RN_DIR" && env "${GRADLE_ENV[@]}" ./gradlew.bat \
    :private:react-native-fantom:enableHermesBuild \
    :packages:react-native:ReactAndroid:hermes-engine:unzipHermes \
    :private:react-native-fantom:prepareRNCodegen \
    :private:react-native-fantom:prepareNative3pDependencies \
    -x :packages:react-native:ReactAndroid:buildCodegenCLI \
    --no-daemon --console=plain)

  # Hermes: the arguments of configureBuildForHermesWithDebugger
  # (hermes-engine/build.gradle.kts), with Ninja, MSVC, the static runtime
  # and the static ICU, and paths with forward slashes.
  HERMES_SRC="$(cygpath -m "$REACT_NATIVE_DIR/sdks/hermes")"
  HERMES_BUILD="$REACT_NATIVE_DIR/ReactAndroid/hermes-engine/build/hermes"
  MSVC_BIN="$(cygpath -m "$(dirname "$(command -v cl)")")"
  HERMES_ARGS=(
    -DJSI_DIR="$(cygpath -m "$REACT_NATIVE_DIR/ReactCommon/jsi")"
    -DCMAKE_BUILD_TYPE=Release
    -DHERMES_ENABLE_DEBUGGER=True
    -DHERMESVM_HEAP_HV_MODE=HEAP_HV_PREFER32
    -DHERMES_MSVC_MP=OFF
    -DCMAKE_C_COMPILER="$MSVC_BIN/cl.exe"
    -DCMAKE_CXX_COMPILER="$MSVC_BIN/cl.exe"
    -DCMAKE_LINKER="$MSVC_BIN/link.exe"
    -DCMAKE_POLICY_DEFAULT_CMP0091=NEW
    -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded
    -DHERMES_ENABLE_WIN10_ICU_FALLBACK=OFF
    -DHERMES_USE_STATIC_ICU=ON
    # FindICU by explicit paths: it would take the Windows SDK's icuuc.lib
    # and icuin.lib (on LIB) before the static sicuuc.lib and sicuin.lib.
    -DICU_ROOT="$(cygpath -m "$ICU_ROOT")"
    -DICU_INCLUDE_DIR="$(cygpath -m "$ICU_ROOT/include")"
    -DICU_UC_LIBRARY_RELEASE="$(cygpath -m "$ICU_ROOT/lib/sicuuc.lib")"
    -DICU_I18N_LIBRARY_RELEASE="$(cygpath -m "$ICU_ROOT/lib/sicuin.lib")"
    -DICU_DATA_LIBRARY_RELEASE="$(cygpath -m "$ICU_ROOT/lib/sicudt.lib")"
  )
  HERMES_STAMP="$HERMES_BUILD/.rn-a11y-cmake-args"
  HERMES_HASH="$(printf '%s\n' "${HERMES_ARGS[@]}" | hash_stdin)"
  if [[ ! -f "$HERMES_BUILD/build.ninja" || "$(cat "$HERMES_STAMP" 2>/dev/null)" != "$HERMES_HASH" ]]; then
    log "Hermes: cmake configure (Ninja, cl.exe /MT) -> ${HERMES_BUILD#"$ROOT"/}"
    rm -rf "$HERMES_BUILD"
    "$CMAKE_BIN_DIR/cmake$EXE" --log-level=ERROR -Wno-dev -G Ninja \
      -DCMAKE_MAKE_PROGRAM="$(cygpath -m "$CMAKE_BIN_DIR/ninja$EXE")" \
      -S "$HERMES_SRC" -B "$(cygpath -m "$HERMES_BUILD")" "${HERMES_ARGS[@]}"
    echo "$HERMES_HASH" >"$HERMES_STAMP"
  fi
  log "Hermes: build (hermesvm, hermesc)"
  HERMES_START=$SECONDS
  "$CMAKE_BIN_DIR/cmake$EXE" --build "$(cygpath -m "$HERMES_BUILD")" --target hermesvm hermesc
  log "Hermes: $((SECONDS - HERMES_START)) s"
  # prepareHeadersForPrefabWithDebugger: API/ and public/ headers, not jsi/.
  PREFAB_HEADERS="$REACT_NATIVE_DIR/ReactAndroid/hermes-engine/build/prefab-headers"
  mkdir -p "$PREFAB_HEADERS"
  for headers in "$REACT_NATIVE_DIR/sdks/hermes/API" "$REACT_NATIVE_DIR/sdks/hermes/public"; do
    (cd "$headers" && find . -name '*.h' -not -path './jsi/*' | while read -r header; do
      mkdir -p "$PREFAB_HEADERS/$(dirname "$header")"
      cp "$header" "$PREFAB_HEADERS/$header"
    done)
  done
else
  log "gradle :private:react-native-fantom:prepareAllDependencies (Hermes, third-party, codegen; logs: $FANTOM_DIR/build/reports/)"
  (cd "$RN_DIR" && ./gradlew :private:react-native-fantom:prepareAllDependencies --no-daemon --console=plain)
fi
TESTER_BUILD_DIR="$FANTOM_BUILD_DIR/tester-$BUILD_TYPE_LOWER"
if [[ "$CROSS_ARCH" == "1" ]]; then
  TESTER_BUILD_DIR="$TESTER_BUILD_DIR-$ARCH"
fi
if [[ "$SANITIZE" == "1" ]]; then
  TESTER_BUILD_DIR="$FANTOM_BUILD_DIR/tester-$BUILD_TYPE_LOWER-sanitize"
fi
if [[ "$TEXT_LAYOUT" != "$DEFAULT_TEXT_LAYOUT" ]]; then
  TESTER_BUILD_DIR="$TESTER_BUILD_DIR-$TEXT_LAYOUT"
fi
# RN_A11Y_TESTER_BUILD_DIR: another tester build directory, e.g. a short one
# on Windows (object paths under the checkout can exceed MAX_PATH).
TESTER_BUILD_DIR="${RN_A11Y_TESTER_BUILD_DIR:-$TESTER_BUILD_DIR}"

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
  -DFANTOM_TEXT_LAYOUT="$TEXT_LAYOUT"
)
if [[ "$OS" == "Darwin" ]]; then
  CMAKE_ARGS+=(-DCMAKE_OSX_ARCHITECTURES="$ARCH")
fi
if [[ "$OS" == "Windows" ]]; then
  # clang-cl, lld-link and llvm-lib by full path (CMake takes a bare
  # CMAKE_AR as relative to the source directory), CMake paths with forward
  # slashes, static ICU for the tester (FANTOM_STATIC_ICU: s*.lib).
  LLVM_BIN="$(cygpath -m "$(dirname "$(command -v clang-cl)")")"
  for i in "${!CMAKE_ARGS[@]}"; do
    case "${CMAKE_ARGS[$i]}" in
      -D*_DIR=/*) CMAKE_ARGS[$i]="${CMAKE_ARGS[$i]%%=*}=$(cygpath -m "${CMAKE_ARGS[$i]#*=}")" ;;
    esac
  done
  CMAKE_ARGS+=(
    -DCMAKE_C_COMPILER="$LLVM_BIN/clang-cl.exe"
    -DCMAKE_CXX_COMPILER="$LLVM_BIN/clang-cl.exe"
    -DCMAKE_LINKER="$LLVM_BIN/lld-link.exe"
    -DCMAKE_AR="$LLVM_BIN/llvm-lib.exe"
    -DCMAKE_PREFIX_PATH="$(cygpath -m "$ICU_ROOT")"
  )
fi

# A foreign architecture needs Hermes built for it (gradle builds it for the
# build machine only). Its build runs hermesc to compile Hermes' internal
# bytecode: the native build's hermesc is imported (IMPORT_HOST_COMPILERS), as
# for an Android cross build, so no Rosetta is needed to build.
if [[ "$CROSS_ARCH" == "1" ]]; then
  HERMES_SRC="$REACT_NATIVE_DIR/sdks/hermes"
  HERMES_NATIVE_BUILD="$REACT_NATIVE_DIR/ReactAndroid/hermes-engine/build/hermes"
  HERMES_ARCH_BUILD="$REACT_NATIVE_DIR/ReactAndroid/hermes-engine/build/hermes-$ARCH"
  HERMES_REV="$(git -C "$HERMES_SRC" rev-parse HEAD 2>/dev/null || cat "$HERMES_SRC/.hermesv1version" 2>/dev/null || echo unknown)"
  HERMES_STAMP="$HERMES_ARCH_BUILD/.rn-a11y-hermes-rev"
  if [[ ! -f "$HERMES_ARCH_BUILD/lib/libhermesvm_a.a" || "$(cat "$HERMES_STAMP" 2>/dev/null)" != "$HERMES_REV" ]]; then
    [[ -f "$HERMES_NATIVE_BUILD/ImportHostCompilers.cmake" ]] || die "no $HERMES_NATIVE_BUILD/ImportHostCompilers.cmake (gradle Hermes build)"
    log "Hermes for $ARCH (${HERMES_REV:0:12}) -> ${HERMES_ARCH_BUILD#"$ROOT"/}"
    HERMES_START=$SECONDS
    "$CMAKE_BIN_DIR/cmake" --log-level=ERROR -Wno-dev -G Ninja \
      -DCMAKE_MAKE_PROGRAM="$CMAKE_BIN_DIR/ninja" \
      -S "$HERMES_SRC" -B "$HERMES_ARCH_BUILD" \
      -DJSI_DIR="$REACT_NATIVE_DIR/ReactCommon/jsi" \
      -DCMAKE_BUILD_TYPE=Release \
      -DHERMES_ENABLE_DEBUGGER=True \
      -DHERMESVM_HEAP_HV_MODE=HEAP_HV_PREFER32 \
      -DCMAKE_OSX_ARCHITECTURES="$ARCH" \
      -DIMPORT_HOST_COMPILERS="$HERMES_NATIVE_BUILD/ImportHostCompilers.cmake"
    "$CMAKE_BIN_DIR/cmake" --build "$HERMES_ARCH_BUILD" --target hermesvm
    echo "$HERMES_REV" >"$HERMES_STAMP"
    log "Hermes for $ARCH: $((SECONDS - HERMES_START)) s"
  fi
  CMAKE_ARGS+=(-DFANTOM_HERMES_BUILD_DIR="$HERMES_ARCH_BUILD")
fi

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
elif [[ "$OS" == "Windows" ]]; then
  # CMake's flags for clang-cl as they are (CMAKE_CXX_FLAGS would replace its
  # /DWIN32 /D_WINDOWS /EHsc /GR). lld-link removes unreferenced code in
  # Release (/OPT:REF without /DEBUG). No LTO, no debug information.
  :
elif [[ "$BUILD_TYPE" != "Debug" && "$OS" == "Linux" ]]; then
  # Unused sections removed at link time (as -dead_strip on macOS). No ThinLTO
  # and no -g: the link would need more time and memory than a 2-core, 7 GB CI
  # runner has to spare. lld when it is installed (faster than GNU ld).
  LINKER_FLAGS="-Wl,--gc-sections"
  if command -v ld.lld >/dev/null; then
    LINKER_FLAGS="-fuse-ld=lld $LINKER_FLAGS"
  fi
  CMAKE_ARGS+=(
    "-DCMAKE_C_FLAGS=-ffunction-sections -fdata-sections"
    "-DCMAKE_CXX_FLAGS=-ffunction-sections -fdata-sections"
    "-DCMAKE_EXE_LINKER_FLAGS=$LINKER_FLAGS"
    "-DCMAKE_SHARED_LINKER_FLAGS=$LINKER_FLAGS"
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
ARGS_HASH="$(printf '%s\n' "${CMAKE_ARGS[@]}" | hash_stdin)"
if [[ ! -f "$TESTER_BUILD_DIR/build.ninja" || "$(cat "$ARGS_STAMP" 2>/dev/null)" != "$ARGS_HASH" ]]; then
  mkdir -p "$TESTER_BUILD_DIR/lto-objects"
  log "cmake configure ($BUILD_TYPE, Ninja) -> ${TESTER_BUILD_DIR#"$ROOT"/}"
  "$CMAKE_BIN_DIR/cmake$EXE" --log-level=ERROR -G Ninja \
    -DCMAKE_MAKE_PROGRAM="$(native_path "$CMAKE_BIN_DIR/ninja$EXE")" \
    -S "$(native_path "$FANTOM_DIR/tester")" -B "$(native_path "$TESTER_BUILD_DIR")" "${CMAKE_ARGS[@]}"
  echo "$ARGS_HASH" >"$ARGS_STAMP"
fi

log "cmake --build ($BUILD_TYPE)"
"$CMAKE_BIN_DIR/cmake$EXE" --build "$(native_path "$TESTER_BUILD_DIR")" --target fantom_tester

BIN="$TESTER_BUILD_DIR/fantom_tester$EXE"
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
  log "run: RN_A11Y_HOST_BIN=$BIN ASAN_OPTIONS=detect_leaks=0 node src/cli.ts ..."
  exit 0
fi

# --- (e) relocatable dist ---------------------------------------------------

if [[ "$OS" == "Windows" ]]; then
  log "copying to ${DIST_DIR#"$ROOT"/}"
  rm -rf "$DIST_DIR"
  mkdir -p "$DIST_DIR"
  HOST="$DIST_DIR/rn-a11y-host.exe"
  cp "$BIN" "$HOST"
  # Only Windows system DLLs may be imported: no MSVC runtime (/MT), no ICU.
  IMPORTS="$(llvm-readobj --coff-imports "$HOST" | sed -n 's/^ *Name: \(.*\.dll\)$/\1/Ip' | sort -u)"
  NON_SYSTEM_DEPS="$(printf '%s\n' "$IMPORTS" |
    grep -v -i -E '^(kernel32|advapi32|bcrypt|dbghelp|ole32|oleaut32|psapi|shell32|shlwapi|user32|winmm|ws2_32|ntdll|api-ms-win-core-[a-z0-9-]+)\.dll$' || true)"
  if [[ -n "$NON_SYSTEM_DEPS" ]]; then
    log "warning: rn-a11y-host.exe imports non-system DLLs:"
    printf '  %s\n' $NON_SYSTEM_DEPS
  fi
  log "done: $HOST ($(stat -c%s "$HOST") bytes)"
  log "imports: $(printf '%s ' $IMPORTS)"
  exit 0
fi

if [[ "$OS" == "Linux" ]]; then
  log "copying to ${DIST_DIR#"$ROOT"/}"
  rm -rf "$DIST_DIR"
  mkdir -p "$DIST_DIR"
  cp "$BIN" "$DIST_DIR/rn-a11y-host"
  HOST="$DIST_DIR/rn-a11y-host"
  # Release/MinSizeRel: the symbol table into rn-a11y-host.debug (gdb and
  # addr2line find it through the debug link), then strip the binary.
  if [[ "$BUILD_TYPE" != "Debug" ]]; then
    objcopy --only-keep-debug "$HOST" "$HOST.debug"
    strip --strip-all "$HOST"
    objcopy --add-gnu-debuglink="$HOST.debug" "$HOST"
  fi
  # Only glibc may stay dynamic: anything else would make the host depend on
  # the distribution.
  NEEDED="$(readelf -d "$HOST" | sed -n 's/.*(NEEDED).*\[\(.*\)\]/\1/p')"
  NON_SYSTEM_DEPS="$(printf '%s\n' "$NEEDED" |
    grep -v -E '^(libc|libm|libdl|libpthread|librt|ld-linux-x86-64|ld-linux-aarch64)\.so\.[0-9]+$' || true)"
  if [[ -n "$NON_SYSTEM_DEPS" ]]; then
    log "warning: rn-a11y-host links non-glibc libraries:"
    printf '  %s\n' $NON_SYSTEM_DEPS
  fi
  GLIBC_MAX="$(objdump -T "$HOST" | grep -o 'GLIBC_[0-9.]*' | sort -u -V | tail -n 1)"
  log "done: $HOST ($(stat -c%s "$HOST") bytes; needs ${GLIBC_MAX:-no versioned glibc symbols})"
  log "NEEDED: $(printf '%s ' $NEEDED)"
  exit 0
fi

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
