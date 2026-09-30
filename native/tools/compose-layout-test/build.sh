#!/bin/bash
# Builds build/compose-layout (the C++ Compose engine + a CoreText Roboto measurer).
# compose.mjs builds compose-ref itself (./compose-ref builds on first use).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
engine="$here/../../overlay/tester/src/expoui/compose"
mkdir -p "$here/build"
clang++ -std=c++17 -O2 -Wall -Wextra -fobjc-arc \
  -I "$engine" -I "$here" \
  "$here/main.mm" "$here/RobotoTextMeasurer.mm" "$engine/ComposeLayout.cpp" \
  -framework Foundation -framework CoreText -framework CoreGraphics \
  -o "$here/build/compose-layout"
if [ ! -f "$here/../compose-ref/fonts/Roboto-Regular.ttf" ]; then
  "$here/../compose-ref/fetch-fonts.sh" >/dev/null
fi
