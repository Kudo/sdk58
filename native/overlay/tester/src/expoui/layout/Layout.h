// SwiftUI layout for @expo/ui trees, without SwiftUI.
//
// The host renders `@expo/ui` SwiftUI components as Fabric nodes (`ViewManagerAdapter_ExpoUI_*`)
// whose Yoga frames are not where SwiftUI would put them. This module computes the SwiftUI frames
// from the same input the host sees: the component type, its props, its `modifiers` array (the
// `{$type, ...params}` objects of `@expo/ui/swift-ui/modifiers`) and its children. It follows the
// SwiftUI layout protocol (a parent proposes a size, the child answers with `sizeThatFits`, the
// parent places it) and the behavior of `@expo/ui`'s Swift views (sdk-58, `packages/expo-ui/ios`).
//
// STL only (C++17). Text and SF Symbol sizes come from a `TextMeasurer` that the host implements
// with CoreText; everything platform-specific (control sizes, text style fonts, default spacing)
// comes from `ControlMetrics`.
//
// Ground truth: `native/tools/swiftui-ref` (real SwiftUI on macOS); tests:
// `native/tools/swiftui-layout-test`.

#pragma once

#include <map>
#include <memory>
#include <optional>
#include <string>
#include <vector>

#include "Value.h"

namespace expoui::layout {

struct Size {
  double width = 0;
  double height = 0;
};

struct Rect {
  double x = 0;
  double y = 0;
  double width = 0;
  double height = 0;
};

/// One @expo/ui component: `type` is the @expo/ui component name (`VStack`, `Text`, ...), not the
/// native view name. `props` and `modifiers` use the @expo/ui names.
struct Node {
  std::string type;
  Object props;
  std::vector<Object> modifiers;
  std::vector<Node> children;

  /// From `{"type", "props", "modifiers", "children"}` (the swiftui-ref input format).
  static Node fromValue(const Value& value);
};

enum class Platform { ios, macos };

/// A resolved font: what `font(...)` and the text style tables produce.
struct FontSpec {
  std::string textStyle; // "body", "headline", ... or empty for an explicit size
  double pointSize = 17;
  std::string weight; // "regular", "bold", ... (empty = the style's weight)
  std::string design; // "default", "rounded", "serif", "monospaced"
  std::string family; // custom font family, or empty for the system font
  // From the metrics table when `ControlMetrics::textHeightFromMetrics` (0 = ask the measurer).
  double lineHeight = 0;
  double leading = 0;
  double ascender = 0;
  double letterSpacing = 0; // points added after each character (tracking, kerning stays on)
  bool italic = false;
};

struct TextMeasurement {
  double width = 0; // widest line, unrounded
  double height = 0; // all lines, unrounded
  int lines = 1;
  double firstBaseline = 0; // from the top of the first line
};

/// Text and SF Symbol measurement (CoreText in the host).
class TextMeasurer {
 public:
  virtual ~TextMeasurer() = default;
  /// Lays out `text` in lines no wider than `maxWidth` (may be infinity). `maxLines` = 0 means
  /// unlimited; otherwise the last line is truncated with an ellipsis.
  virtual TextMeasurement measureText(const std::string& text, const FontSpec& font, double maxWidth, int maxLines) = 0;
  /// Like `measureText`, with SwiftUI's `truncationMode` ("head", "middle", "tail") for the
  /// truncated line. The default ignores the mode (tail truncation).
  virtual TextMeasurement measureTextTruncated(const std::string& text, const FontSpec& font, double maxWidth,
                                               int maxLines, const std::string& truncationMode) {
    (void)truncationMode;
    return measureText(text, font, maxWidth, maxLines);
  }
  /// Line height of the font, used when `FontSpec::lineHeight` is 0.
  virtual double lineHeight(const FontSpec& font) = 0;
  /// Size of `Image(systemName:)` in this font.
  virtual Size measureSymbol(const std::string& name, const FontSpec& font) = 0;
};

/// Default spacing preferences of a text style against neighbors (vertical axis), in points.
struct TextSpacing {
  double topVsText = 0;
  double topVsControl = 0;
  double bottomVsControl = 0;
};

struct TextStyleMetrics {
  double pointSize = 17;
  std::string weight = "regular";
  double lineHeight = 0; // one line (ascender + descender), unrounded; 0 = measurer
  double leading = 0; // added between lines
  double ascender = 0;
  TextSpacing spacing;
};

/// Metrics of List / Form (one style) that the engine cannot derive.
///
/// Rows are boxes: `max(rowMinHeight, content + rowPadding)` tall, content centered. Offsets are
/// from the bottom of the previous block (row box, header, footer) or from the top of the list to
/// the top of the next block (row box or header).
struct SectionListMetrics {
  double insetX = 0; // content inset from the list's leading and trailing edges
  double rowPadding = 0; // vertical padding of a row box (both edges together)
  double rowMinHeight = 0;
  double untitledFirst = 0; // first section without a header: its first row box
  double headerFirst = 0; // first section with a header: the header
  double untitledAfterRows = 0;
  double untitledAfterFooter = 0;
  double headerAfterRows = 0;
  double headerAfterFooter = 0;
  double headerToRows = 0;
  double rowsToFooter = 0;
  std::string headerTextStyle = "headline"; // Section(title:) header text
  std::string headerSlotTextStyle; // header slot content: this text style ("" = the section font)
  std::string headerSlotWeight; // header slot content: in this weight ("" = the font's)
  std::string footerTextStyle = "subheadline";
  std::string footerWeight; // "" = the text style's
  double labelIconGap = -1; // Label in rows; -1 = ControlMetrics::labelIconGap
  double labelIconSlot = -1; // Label in rows: fixed icon column width (icon + gap); -1 = none
  double labelIconMinWidth = 0; // Label in rows: the icon column is at least this wide (+ gap)
  bool looseRowsFormSection = true; // rows outside a Section form an implicit section
  // Whether controls inside a container in a row (e.g. a Toggle in an HStack) are styled as row
  // controls (macOS) or as plain controls (iOS).
  bool nestedControlsUseRowStyle = true;
  // Controls in rows fill the row width; these heights replace theirs (-1 = keep the control's).
  bool controlsFillRow = false;
  double toggleRowHeight = -1;
  double textFieldRowHeight = -1;
  double sliderRowHeight = -1;
  double pickerRowHeight = -1;
};

/// Everything platform-specific. `verified` says whether the numbers were measured (true) or
/// taken from documentation / guesses (false).
struct ControlMetrics {
  Platform platform = Platform::macos;
  bool verified = false;
  double pixelScale = 1; // text and symbol sizes round up to this grid
  std::map<std::string, TextStyleMetrics> textStyles; // "body", "largeTitle", ...
  std::string defaultTextStyle = "body";
  /// Whether Text without a `font` modifier uses the text style font (iOS) or the plain system
  /// font of that size (macOS: it wraps differently from `.font(.body)`).
  bool defaultFontIsTextStyle = true;
  /// iOS: text height = lines * lineHeight + (lines - 1) * leading from the table (UIFont
  /// metrics), rounded up to pixels. macOS: the measurer's height.
  bool textHeightFromMetrics = false;
  /// For explicit font sizes when `textHeightFromMetrics`: line height and ascender per point.
  double lineHeightPerPoint = 0;
  double ascenderPerPoint = 0;

  double horizontalSpacing = 8; // default HStack spacing between two non-Spacer views
  double controlSpacing = 8; // default vertical spacing between two controls
  double imageTopVsControl = 2;
  double imageBottomVsControl = 3;
  double spacerMinLength = 8;
  double defaultPadding = 16;

  // Button: the default style is bordered on macOS and plain (just the label) on iOS.
  bool buttonDefaultBordered = true;
  // Bordered styles: label + padding, at least minHeight.
  double buttonPaddingX = 12;
  double buttonPaddingY = 4;
  double buttonMinHeight = 24;
  double buttonChildrenSpacing = 4; // label children are laid out in an HStack
  // Toggle, switch style: [label, gap, switch].
  double switchWidth = 54;
  double switchHeight = 24;
  double switchLabelGap = 8;
  bool switchFillsWidth = false; // iOS: the switch goes to the trailing edge
  bool switchGapWithoutLabel = false; // iOS: the label gap is kept without a label
  bool toggleAutomaticIsSwitch = false; // iOS: no checkbox style
  // Toggle, checkbox style (macOS automatic).
  double checkboxWidth = 16;
  double checkboxHeight = 16;
  double checkboxLabelGap = 5;
  // Slider.
  double sliderHeight = 16;
  double sliderIdealWidth = 0;
  // TextField: ideal width = max(text, placeholder) + textFieldPaddingX.
  double textFieldPaddingX = 12;
  double textFieldMinWidth = 0;
  double textFieldHeight = 24;
  // Picker: menu = label + widest option + menuExtra;
  // segmented = label + n * (widest + segmentExtra) + segmentedExtra.
  double pickerMenuExtra = 56;
  double pickerSegmentExtra = 20;
  double pickerSegmentedExtra = 8;
  double pickerSingleSegmentExtra = 28; // one segment: label + widest + this
  // iOS: the menu shows the selected option (no label); segmented fills the width.
  bool pickerMenuShowsSelection = false;
  bool pickerSegmentedFills = false;
  double pickerSegmentedHeight = 24;
  double pickerMenuHeight = 24;
  // Label: icon + gap + title.
  double labelIconGap = 8;
  // Divider thickness.
  double dividerThickness = 1;
  // SF Symbol sizes from the measured iOS table (Symbols.h) before asking the measurer.
  bool iosSymbolTable = false;
  // Width of always-visible scrollers, added to a ScrollView whose content overflows (0 = overlay).
  double scrollerWidth = 0;

  SectionListMetrics form; // grouped Form
  SectionListMetrics list; // List (default style)

  const TextStyleMetrics& style(const std::string& name) const;

  /// Measured on macOS 26.5 / Xcode 26.6 with native/tools/swiftui-ref.
  static ControlMetrics macos();
  /// iOS values; see `verified` and the comments in Layout.cpp.
  static ControlMetrics ios();
};

struct HostSpec {
  double width = 390;
  double height = 844;
  bool matchContentsHorizontal = false;
  bool matchContentsVertical = false;
  bool rightToLeft = false;

  static HostSpec fromValue(const Value& value);
};

struct NodeLayout {
  std::string path; // "0" = root, "0/2/1" = children by index
  std::string type;
  std::optional<Rect> frame; // after the node's modifiers, relative to the Host
  std::optional<Rect> contentFrame; // before the modifiers (only if different)
  bool isVirtual = false; // Group / Slot / Section: frame = union of children
  bool platformRendered = false; // Picker options: no SwiftUI frame
  std::optional<std::string> text;
  std::optional<std::string> accessibilityLabel;
};

struct LayoutResult {
  Size host;
  std::vector<NodeLayout> nodes; // sorted by path
  std::map<std::string, std::vector<std::string>> unsupported; // "type:X" / "modifier:Y" -> paths

  /// The swiftui-ref output format.
  Value toValue() const;
};

/// Lays out `root` inside an @expo/ui `Host` of the given size.
LayoutResult layout(const HostSpec& host, const Node& root, TextMeasurer& measurer, const ControlMetrics& metrics);

} // namespace expoui::layout
