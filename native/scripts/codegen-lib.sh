#!/usr/bin/env bash
# Runs React Native codegen for a native library, for manual inspection.
# The host build runs the same script (native/overlay/tester/scripts/codegen-lib.sh)
# at CMake configure time and writes into the build directory.
#
# Usage: native/scripts/codegen-lib.sh <package-dir> <name> [out-dir]
#   out-dir defaults to native/dist/codegen-libs/<name> (ignored by git)
#
# Example: native/scripts/codegen-lib.sh node_modules/react-native-screens rnscreens

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
[[ $# -ge 2 ]] || { echo "usage: $0 <package-dir> <name> [out-dir]" >&2; exit 2; }
OUT_DIR="${3:-$ROOT/native/dist/codegen-libs/$2}"

REACT_NATIVE_ROOT="$ROOT/third_party/react-native" \
  exec bash "$ROOT/native/overlay/tester/scripts/codegen-lib.sh" "$1" "$2" "$OUT_DIR"
