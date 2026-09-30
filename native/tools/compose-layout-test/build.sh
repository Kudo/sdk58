#!/bin/bash
# Builds build/compose-layout: the C++ Compose engine with the host's text adapter
# (tester/src/components/FantomComposeText.mm) and the embedded Roboto
# (native/fonts/roboto, generated into build/ like the host build does).
# compare.ts builds compose-ref itself (./compose-ref builds on first use).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tester="$here/../../overlay/tester"
src="$tester/src"
fonts="$here/../../fonts/roboto"
mkdir -p "$here/build"
cmake="$(command -v cmake || ls "${ANDROID_HOME:-$HOME/Library/Android/sdk}"/cmake/*/bin/cmake 2>/dev/null | tail -n 1)"
"$cmake" -DOUTPUT="$here/build/EmbeddedFontData.cpp" -DWORK_DIR="$here/build/fonts" \
  "-DNAMES=fantom_roboto_regular;fantom_roboto_medium;fantom_roboto_bold;fantom_roboto_italic" \
  "-DFILES=$fonts/Roboto-Regular.ttf;$fonts/Roboto-Medium.ttf;$fonts/Roboto-Bold.ttf;$fonts/Roboto-Italic.ttf" \
  -P "$tester/cmake/embed-files.cmake"
clang++ -std=c++20 -O2 -Wall -Wextra -Werror -fobjc-arc \
  -I "$src" -I "$here" \
  "$here/main.mm" \
  "$src/components/FantomComposeText.mm" \
  "$src/platform/macos/EmbeddedFonts.mm" \
  "$here/build/EmbeddedFontData.cpp" \
  "$src/expoui/compose/ComposeLayout.cpp" \
  "$src"/expoui/layout/*.cpp \
  -framework Foundation -framework CoreText -framework CoreGraphics -lcompression \
  -o "$here/build/compose-layout"
