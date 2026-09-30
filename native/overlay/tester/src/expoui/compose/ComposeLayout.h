// A Jetpack Compose layout engine for @expo/ui/jetpack-compose trees. STL only.
//
// It copies Compose's measure / layout protocol in integer px: a node is a chain of layout
// modifiers around a measure policy (Row, Column, Box, FlowRow, Spacer, Text, controls). Each
// modifier measures the next one with its constraints and places it, as in Compose's
// LayoutModifierNode chain. The ground truth is native/tools/compose-ref (real Compose Desktop);
// native/tools/compose-layout-test compares the two.
//
// The public types are the SwiftUI engine's (../layout/Layout.h): the same Node, HostSpec,
// TextMeasurer and LayoutResult, so one host adapter feeds both engines. Only ControlMetrics is
// Compose's own. Frames in the result are dp (px / density), relative to the Host.

#pragma once

#include <climits>
#include <cmath>
#include <optional>
#include <string>

#include "../layout/Layout.h"

namespace expoui::compose {

using layout::FontSpec;
using layout::HostSpec;
using layout::LayoutResult;
using layout::Node;
using layout::Object;
using layout::TextMeasurement;
using layout::TextMeasurer;
using layout::Value;

/// Constraints.Infinity.
constexpr int kInfinity = INT_MAX;

struct Constraints {
  int minWidth = 0;
  int maxWidth = kInfinity;
  int minHeight = 0;
  int maxHeight = kInfinity;

  static Constraints fixed(int w, int h) { return {w, w, h, h}; }
  bool hasBoundedWidth() const { return maxWidth != kInfinity; }
  bool hasBoundedHeight() const { return maxHeight != kInfinity; }
  bool hasFixedWidth() const { return minWidth == maxWidth; }
  bool hasFixedHeight() const { return minHeight == maxHeight; }
  int constrainWidth(int w) const;
  int constrainHeight(int h) const;
  /// Constraints.offset(horizontal, vertical).
  Constraints offset(int horizontal, int vertical) const;
  /// Constraints.constrain(other): `other` coerced into this.
  Constraints constrain(const Constraints& other) const;
};

/// A text style after @expo/ui's merge (TextView.kt TextContent), in sp.
struct TextStyle {
  float fontSize = 14;     // TextStyle.Default resolves to 14 sp
  float lineHeight = NAN;  // sp; NaN = the font's line height
  float letterSpacing = 0; // sp
  int fontWeight = 400;
  bool italic = false;
  std::string fontFamily;  // "" = default (Roboto on Android); "serif", "monospace", "cursive"
  /// LineHeightStyle.Trim.Both (TextStyle.Default) vs Trim.None (the Material 3 typography).
  /// Only matters with a lineHeight.
  bool trimLineHeight = true;
};

/// The same style in px, as Compose resolves it (sp * fontScale * density).
struct ResolvedTextStyle {
  float fontSizePx = 14;
  float lineHeightPx = NAN;
  float letterSpacingPx = 0;
  int fontWeight = 400;
  bool italic = false;
  std::string fontFamily;
  bool trimLineHeight = true;
};

/// Everything platform-specific: density and the Material 3 sizes in dp (observed with
/// compose-ref; CMP material3 1.10.0-alpha05, the desktop build of androidx material3 1.5.0-alpha).
struct ControlMetrics {
  float density = 1;
  float fontScale = 1;
  /// false = LocalMinimumInteractiveComponentSize is unspecified (compose-ref --no-touch-target).
  bool touchTarget = true;

  float minimumInteractiveSize = 48;      // LocalMinimumInteractiveComponentSize
  float buttonMinWidth = 58;              // ButtonDefaults.MinWidth
  float buttonMinHeight = 40;             // ButtonDefaults.MinHeight
  float buttonPaddingHorizontal = 24;     // ButtonDefaults.ContentPadding
  float buttonPaddingVertical = 8;
  float textButtonPaddingHorizontal = 12; // ButtonDefaults.TextButtonContentPadding
  float textButtonPaddingVertical = 8;
  float switchWidth = 52;
  float switchHeight = 32;
  float checkboxSize = 20;
  float checkboxPadding = 2;
  float sliderThumbWidth = 4;
  float sliderThumbHeight = 44;
  float sliderTrackHeight = 16;
  float textFieldMinWidth = 280;          // TextFieldDefaults.MinWidth
  float textFieldMinHeight = 56;          // TextFieldDefaults.MinHeight
  float textFieldPaddingHorizontal = 16;
  float outlinedTextFieldTopPadding = 8;  // minimizedLabelHalfHeight, with a label
  float iconSize = 24;
};

/// Lays out `root` inside an @expo/ui `Host` (HostView.kt MaybeMatchContentsLayout in an Android
/// ComposeView). `host` is in dp. A root of type "Host" stands for the Host itself: its children
/// are the Host's children (paths "0/<index>"); any other root is the single child (path "0").
/// Type "RNHost" is an RNHostView leaf with props.width / props.height (its Yoga size, dp). The result has the swiftui-ref / compose-ref shape
/// (LayoutResult::toValue()).
LayoutResult layout(const HostSpec& host, const Node& root, TextMeasurer& measurer, const ControlMetrics& metrics);

/// The Material 3 typography (TypeScaleTokens) for a TextView `typography` name.
std::optional<TextStyle> materialTypography(const std::string& name);

}  // namespace expoui::compose
