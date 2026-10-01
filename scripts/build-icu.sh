#!/usr/bin/env bash
# Builds ICU 74.2 from source as static, position-independent archives
# (libicuuc.a, libicui18n.a, libicudata.a) into a prefix, for the Linux host
# on systems without static ICU (AlmaLinux 8, the manylinux_2_28 image of
# .github/workflows/linux-host.yml).
#
# The data is built from the ICU data sources with the filter in
# scripts/icu-data-filter.json (ICU_DATA_FILTER_FILE): only what Hermes uses
# without Intl (lib/Platform/Unicode/PlatformUnicodeICU.cpp: ucol_* collation,
# udat_* medium date/time format, u_strToUpper/Lower, unorm2_* NFC/NFD/NFKC/
# NFKD) for the locales root, en, en_US and en_US_POSIX (the default locale
# without LANG). Another default locale falls back to root. Needs python3.
#
#   scripts/build-icu.sh <prefix>
#
# Then build the host with the prefix on CMAKE_PREFIX_PATH and ICU_ROOT, so
# that Hermes (gradle) finds the headers and libraries and the tester CMake
# finds the archives (FANTOM_STATIC_ICU):
#
#   CMAKE_PREFIX_PATH=<prefix> ICU_ROOT=<prefix> bun run build:host
#
# Uses CC/CXX (default clang/clang++). Skips the build when
# <prefix>/.rn-a11y-icu-stamp matches the version and compilers.
#
# Windows (Git Bash, in an MSVC developer environment: cl.exe on PATH):
# ICU's MSYS/MSVC build (runConfigureICU) with cl.exe and the static runtime
# (/MT), run in MSYS2 (GNU make; MSYS2_ROOT, default C:/msys64, with the make
# and python packages). Output: <prefix>/lib/sicuuc.lib, sicuin.lib and
# sicudt.lib (the names CMake's FindICU looks for), <prefix>/include.

set -euo pipefail

ICU_VERSION=74.2
ICU_TARBALL="icu4c-${ICU_VERSION/./_}-src.tgz"
ICU_URL="https://github.com/unicode-org/icu/releases/download/release-${ICU_VERSION/./-}/$ICU_TARBALL"
ICU_SHA256=68db082212a96d6f53e35d60f47d38b962e9f9d207a74cfac78029ae8ff5e08c
ICU_DATA_ZIP="icu4c-${ICU_VERSION/./_}-data.zip"
ICU_DATA_URL="https://github.com/unicode-org/icu/releases/download/release-${ICU_VERSION/./-}/$ICU_DATA_ZIP"
ICU_DATA_SHA256=c28c3ca5f4ba3384781797138a294ca360988d4322674ad4d51e52f5d9b0a2b6
FILTER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/icu-data-filter.json"

log() { printf '\033[1m[build-icu]\033[0m %s\n' "$*"; }
die() { printf '[build-icu] error: %s\n' "$*" >&2; exit 1; }

PREFIX="${1:-}"
[[ -n "$PREFIX" ]] || die "usage: scripts/build-icu.sh <prefix>"
WINDOWS=0
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) WINDOWS=1 ;; esac
if [[ "$WINDOWS" == "1" ]]; then
  command -v cl >/dev/null || die "cl.exe not on PATH (run in an MSVC developer environment)"
  MSYS2_ROOT="${MSYS2_ROOT:-C:/msys64}"
  [[ -x "$MSYS2_ROOT/usr/bin/make" && -x "$MSYS2_ROOT/usr/bin/python3" ]] ||
    die "MSYS2 with make and python not found in $MSYS2_ROOT (pacman -S make python; or set MSYS2_ROOT)"
  COMPILER_ID="cl $(cl 2>&1 | head -n 1 | tr -d '\r') /MT"
else
  export CC="${CC:-clang}" CXX="${CXX:-clang++}"
  COMPILER_ID="$("$CC" --version | head -n 1) $("$CXX" --version | head -n 1)"
fi

STAMP="$PREFIX/.rn-a11y-icu-stamp"
STAMP_VALUE="$ICU_VERSION $COMPILER_ID filter $(sha256sum <"$FILTER" | cut -d' ' -f1)"
if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$STAMP_VALUE" ]]; then
  log "ICU $ICU_VERSION already in $PREFIX"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
log "downloading $ICU_URL"
curl -fsSL -o "$WORK/$ICU_TARBALL" "$ICU_URL"
echo "$ICU_SHA256  $WORK/$ICU_TARBALL" | sha256sum -c - >/dev/null || die "$ICU_TARBALL: SHA-256 mismatch"
curl -fsSL -o "$WORK/$ICU_DATA_ZIP" "$ICU_DATA_URL"
echo "$ICU_DATA_SHA256  $WORK/$ICU_DATA_ZIP" | sha256sum -c - >/dev/null || die "$ICU_DATA_ZIP: SHA-256 mismatch"
tar -xzf "$WORK/$ICU_TARBALL" -C "$WORK"
# The data sources replace the prebuilt data (the filter needs the sources).
rm -rf "$WORK/icu/source/data"
unzip -q "$WORK/$ICU_DATA_ZIP" -d "$WORK/icu/source"

mkdir -p "$WORK/build"
cd "$WORK/build"

if [[ "$WINDOWS" == "1" ]]; then
  log "building ICU $ICU_VERSION (cl.exe /MT, MSYS2 $MSYS2_ROOT) -> $PREFIX"
  # MSYS2's bash with the environment of this shell (cl.exe, link.exe,
  # INCLUDE, LIB). runConfigureICU puts -MD first; the later -MT wins.
  # Paths in the mixed form (C:/...): Git Bash's /tmp is not MSYS2's.
  WIN_PREFIX="$(cygpath -m "$PREFIX")"
  WIN_WORK="$(cygpath -m "$WORK")"
  WIN_FILTER="$(cygpath -m "$FILTER")"
  # The MSVC tools first: MSYS2's coreutils have a link.exe too.
  WIN_MSVC_BIN="$(cygpath -m "$(dirname "$(command -v cl)")")"
  rm -rf "$PREFIX"
  # The MSVC variables are passed explicitly: MSYS2's bash does not see LIB
  # from Git Bash (link.exe: "cannot open file 'LIBCMT.lib'").
  [[ -n "${LIB:-}" && -n "${INCLUDE:-}" ]] || die "LIB / INCLUDE not set (MSVC developer environment)"
  MSYSTEM=MSYS \
    "$MSYS2_ROOT/usr/bin/bash.exe" -c "set -e
      export PATH=\"\$(/usr/bin/cygpath -u '$WIN_MSVC_BIN'):/usr/bin:\$PATH\"
      export LIB='$LIB' INCLUDE='$INCLUDE' LIBPATH='${LIBPATH:-}'
      cd \"\$(cygpath -u '$WIN_WORK')/build\"
      export ICU_DATA_FILTER_FILE='$WIN_FILTER' CFLAGS='-MT -O2' CXXFLAGS='-MT -O2 -std:c++17'
      \"\$(cygpath -u '$WIN_WORK')/icu/source/runConfigureICU\" MSYS/MSVC --prefix=\"\$(cygpath -u '$WIN_PREFIX')\" \\
        --enable-static --disable-shared --with-data-packaging=static \\
        --disable-tests --disable-samples --disable-extras --disable-icuio --disable-layoutex >/dev/null \\
        || { sed -n '/C compiler version/,/^## ----------------/p' config.log | head -n 80; exit 1; }
      make -j$(nproc) >/dev/null
      make install >/dev/null"
  echo "$STAMP_VALUE" >"$STAMP"
  log "done: $(ls "$PREFIX/lib"/*.lib | tr '\n' ' ')($(wc -c <"$PREFIX/lib/sicudt.lib") bytes of data)"
  exit 0
fi

log "building ICU $ICU_VERSION ($CXX) -> $PREFIX"
# -fPIC: Hermes links ICU into libhermesvm.so too.
ICU_DATA_FILTER_FILE="$FILTER" \
CFLAGS="-O2 -fPIC -ffunction-sections -fdata-sections" \
CXXFLAGS="-O2 -fPIC -ffunction-sections -fdata-sections" \
  "$WORK/icu/source/configure" --prefix="$PREFIX" \
    --enable-static --disable-shared --with-data-packaging=static \
    --disable-tests --disable-samples --disable-extras --disable-icuio --disable-layoutex \
    >/dev/null
make -j"$(nproc)" >/dev/null
rm -rf "$PREFIX"
make install >/dev/null
echo "$STAMP_VALUE" >"$STAMP"
log "done: $(ls "$PREFIX/lib"/*.a | tr '\n' ' ')($(wc -c <"$PREFIX/lib/libicudata.a") bytes of data)"
