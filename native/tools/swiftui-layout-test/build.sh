#!/bin/bash
# Builds build/swiftui-layout (the engine + a CoreText measurer) and the swiftui-ref harness.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
engine="$here/../../overlay/tester/src/expoui/layout"
mkdir -p "$here/build"
clang++ -std=c++17 -O2 -Wall -Wextra -fobjc-arc \
  -I "$engine" -I "$here" \
  "$here/main.mm" "$here/CoreTextMeasurer.mm" "$engine"/*.cpp \
  -framework AppKit -framework CoreText \
  -o "$here/build/swiftui-layout"
(cd "$here/../swiftui-ref" && swift build -c release >/dev/null)
