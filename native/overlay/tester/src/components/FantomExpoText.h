/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/graphics/Float.h>
#include <react/renderer/graphics/Size.h>

#include <limits>
#include <optional>
#include <string>
#include <string_view>

namespace facebook::react {

/*
 * Text measurement for the @expo/ui layout emulation (the engine's
 * TextMeasurer calls this). It uses the host's TextLayoutManager (CoreText on
 * macOS), the same path as React Native <Text>.
 */
struct ExpoTextMeasureOptions {
  // Font family; empty for the system font (SF on macOS/iOS).
  std::string fontFamily;
  Float size{17};
  // 100..900 (400 regular, 600 semibold, 700 bold).
  int weight{400};
  bool italic{false};
  // Points added after each character (TextAttributes::letterSpacing).
  Float letterSpacing{0};
  // SwiftUI Font.Design: "" / "default", "rounded", "serif", "monospaced"
  // (system font only; mapped to ui-rounded / ui-serif / ui-monospace).
  std::string design;
  Float maxWidth{std::numeric_limits<Float>::infinity()};
  // 0 for no limit.
  int maxLines{0};
};

// Size of `text` (points, rounded up to the pixel grid of pointScaleFactor).
Size measureExpoText(const std::string &text, const ExpoTextMeasureOptions &options, Float pointScaleFactor = 3);

// SwiftUI text style (Font.TextStyle) with the iOS point sizes at the
// default Dynamic Type size (large).
struct SwiftUITextStyle {
  Float size;
  int weight;
};
// largeTitle 34, title 28, title2 22, title3 20, headline 17 semibold,
// body 17, callout 16, subheadline 15, footnote 13, caption 12, caption2 11.
std::optional<SwiftUITextStyle> swiftUITextStyle(std::string_view name);

} // namespace facebook::react
