// A Jetpack Compose layout engine for @expo/ui/jetpack-compose trees. STL only.
//
// It copies Compose's measure / layout protocol in integer px: a node is a chain of layout
// modifiers around a measure policy (Row, Column, Box, FlowRow, Spacer, Text, controls). Each
// modifier measures the next one with its constraints and places it, as in Compose's
// LayoutModifierNode chain. The ground truth is native/tools/compose-ref (real Compose Desktop);
// native/tools/compose-layout-test compares the two.
//
// Input: the compose-ref JSON ({host, root: {type, props, modifiers, children}}).
// Output: frames in px, relative to the Host.

#pragma once

#include <climits>
#include <cmath>
#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "ComposeJson.h"

namespace expoui::compose {

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
  float fontSize = 14;           // TextStyle.Default resolves to 14 sp
  float lineHeight = NAN;        // sp; NaN = the font's line height
  float letterSpacing = 0;       // sp
  int fontWeight = 400;
  bool italic = false;
  std::string fontFamily;        // "" = default (Roboto on Android)
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

struct TextLayoutResult {
  /// Paragraph height in px (not rounded up yet).
  float height = 0;
  int lineCount = 0;
};

/// Text measurement. Compose Desktop lays text out with Skia's paragraph engine; Android with
/// StaticLayout. The implementation should use Roboto.
class TextMeasurer {
 public:
  virtual ~TextMeasurer() = default;
  /// ParagraphIntrinsics.maxIntrinsicWidth: the width of the text on one line, px.
  virtual float maxIntrinsicWidth(const std::string& text, const ResolvedTextStyle& style) = 0;
  /// ParagraphIntrinsics.minIntrinsicWidth: the widest unbreakable segment (word), px.
  virtual float minIntrinsicWidth(const std::string& text, const ResolvedTextStyle& style) = 0;
  /// Lays the text out in `width` px (may be infinite) with at most `maxLines` lines.
  virtual TextLayoutResult layout(const std::string& text, const ResolvedTextStyle& style, float width,
                                  int maxLines) = 0;
};

/// Material 3 sizes in dp (observed with compose-ref; material3 1.5.0-alpha / CMP 1.10).
struct ControlMetrics {
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
  float outlinedTextFieldTopPadding = 8;  // OutlinedTextFieldTopPadding, with a label
  float iconSize = 24;
};

struct LayoutOptions {
  float density = 1;
  float fontScale = 1;
  /// false = LocalMinimumInteractiveComponentSize is unspecified (compose-ref --no-touch-target).
  bool touchTarget = true;
  ControlMetrics metrics;
};

struct Rect {
  int x = 0;
  int y = 0;
  int width = 0;
  int height = 0;
  bool operator==(const Rect& o) const {
    return x == o.x && y == o.y && width == o.width && height == o.height;
  }
};

struct NodeFrame {
  std::string path;
  std::string type;
  /// Outside the node's modifiers, px, relative to the Host. Absent for virtual nodes without
  /// laid-out children.
  std::optional<Rect> frame;
  /// Inside the node's modifiers (the box the component gets).
  std::optional<Rect> contentFrame;
  std::string text;
  std::string testID;
  bool isVirtual = false;
};

struct LayoutResult {
  /// Host size in px: the content size on matchContents axes, else the input size.
  int hostWidth = 0;
  int hostHeight = 0;
  /// The same in dp: the input size on the normal axes (as compose-ref prints it).
  float hostWidthDp = 0;
  float hostHeightDp = 0;
  /// Size of the Host's content (MaybeMatchContentsLayout), px.
  int fittingWidth = 0;
  int fittingHeight = 0;
  std::vector<NodeFrame> nodes;
  /// "type:X" / "modifier:X" / "prop:X=Y" -> paths.
  std::map<std::string, std::vector<std::string>> unsupported;
};

/// Lays out a compose-ref input ({host, root}).
LayoutResult layout(const Json& input, TextMeasurer& text, const LayoutOptions& options);

/// compose-ref's output JSON (frames in dp, `framePx` when density != 1).
Json toJson(const LayoutResult& result, const LayoutOptions& options);

/// The Material 3 typography (TypeScaleTokens) for a TextView `typography` name.
std::optional<TextStyle> materialTypography(const std::string& name);

}  // namespace expoui::compose
