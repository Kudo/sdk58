#!/usr/bin/env bash
# Builds ICU 74.2 from source as static, position-independent archives
# (libicuuc.a, libicui18n.a, libicudata.a with the full data) into a prefix,
# for the Linux host on systems without static ICU (AlmaLinux 8, the
# manylinux_2_28 image of .github/workflows/linux-host.yml).
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

set -euo pipefail

ICU_VERSION=74.2
ICU_TARBALL="icu4c-${ICU_VERSION/./_}-src.tgz"
ICU_URL="https://github.com/unicode-org/icu/releases/download/release-${ICU_VERSION/./-}/$ICU_TARBALL"
ICU_SHA256=68db082212a96d6f53e35d60f47d38b962e9f9d207a74cfac78029ae8ff5e08c

log() { printf '\033[1m[build-icu]\033[0m %s\n' "$*"; }
die() { printf '[build-icu] error: %s\n' "$*" >&2; exit 1; }

PREFIX="${1:-}"
[[ -n "$PREFIX" ]] || die "usage: scripts/build-icu.sh <prefix>"
export CC="${CC:-clang}" CXX="${CXX:-clang++}"

STAMP="$PREFIX/.rn-a11y-icu-stamp"
STAMP_VALUE="$ICU_VERSION $("$CC" --version | head -n 1) $("$CXX" --version | head -n 1)"
if [[ -f "$STAMP" && "$(cat "$STAMP")" == "$STAMP_VALUE" ]]; then
  log "ICU $ICU_VERSION already in $PREFIX"
  exit 0
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
log "downloading $ICU_URL"
curl -fsSL -o "$WORK/$ICU_TARBALL" "$ICU_URL"
echo "$ICU_SHA256  $WORK/$ICU_TARBALL" | sha256sum -c - >/dev/null || die "$ICU_TARBALL: SHA-256 mismatch"
tar -xzf "$WORK/$ICU_TARBALL" -C "$WORK"

log "building ICU $ICU_VERSION ($CXX) -> $PREFIX"
mkdir -p "$WORK/build"
cd "$WORK/build"
# -fPIC: Hermes links ICU into libhermesvm.so too. The data comes from the
# prebuilt source/data/in/icudt74l.dat (no Python needed).
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
log "done: $(ls "$PREFIX/lib"/*.a | tr '\n' ' ')"
