// See ComposeLayout.h. Comments name the Compose source that each part copies
// (androidx.compose.foundation.layout / material3, 1.10 / 1.5.0-alpha), and the @expo/ui
// sdk-58 Kotlin file for the node builders.

#include "ComposeLayout.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <utility>

namespace expoui::compose {

using Json = layout::Value;

// ---------------------------------------------------------------------------------------------
// Constraints
// ---------------------------------------------------------------------------------------------

namespace {

int clampInt(int v, int lo, int hi) {
  return std::max(lo, std::min(v, hi));
}

/// Addition that keeps Constraints.Infinity.
int addMaxWithMinimum(int max, int value) {
  return max == kInfinity ? max : std::max(0, max + value);
}

}  // namespace

int Constraints::constrainWidth(int w) const {
  return clampInt(w, minWidth, maxWidth);
}

int Constraints::constrainHeight(int h) const {
  return clampInt(h, minHeight, maxHeight);
}

Constraints Constraints::offset(int horizontal, int vertical) const {
  return {std::max(0, minWidth + horizontal), addMaxWithMinimum(maxWidth, horizontal),
          std::max(0, minHeight + vertical), addMaxWithMinimum(maxHeight, vertical)};
}

Constraints Constraints::constrain(const Constraints& o) const {
  return {clampInt(o.minWidth, minWidth, maxWidth), clampInt(o.maxWidth, minWidth, maxWidth),
          clampInt(o.minHeight, minHeight, maxHeight), clampInt(o.maxHeight, minHeight, maxHeight)};
}

namespace {

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

/// Kotlin Float.fastRoundToInt() / Math.round(float): floor(x + 0.5).
int roundToInt(float v) {
  if (std::isinf(v)) {
    return v > 0 ? kInfinity : 0;
  }
  return static_cast<int>(std::floor(v + 0.5f));
}

/// Kotlin Float.ceilToIntPx() for text sizes.
int ceilToInt(float v) {
  if (std::isinf(v)) {
    return kInfinity;
  }
  return static_cast<int>(std::ceil(v));
}

/// Kotlin Double.toInt() for `Int` record fields: truncation toward zero.
int truncToInt(double v) {
  if (std::isnan(v)) {
    return 0;
  }
  return static_cast<int>(std::trunc(v));
}

// ---------------------------------------------------------------------------------------------
// Alignment and arrangement (Alignment.kt BiasAlignment, Arrangement.kt)
// ---------------------------------------------------------------------------------------------

/// BiasAlignment.Horizontal.align(size, space, layoutDirection).
int alignHorizontal(float bias, int size, int space, bool rtl) {
  float center = static_cast<float>(space - size) / 2.0f;
  float resolved = rtl ? -bias : bias;
  return roundToInt(center * (1 + resolved));
}

/// BiasAlignment.Vertical.align(size, space).
int alignVertical(float bias, int size, int space) {
  float center = static_cast<float>(space - size) / 2.0f;
  return roundToInt(center * (1 + bias));
}

struct Alignment2D {
  float horizontal = -1;
  float vertical = -1;
};

struct Arrangement {
  enum Kind { Start, End, Center, SpaceBetween, SpaceAround, SpaceEvenly, SpacedBy };
  Kind kind = Start;
  float space = 0;  // dp, SpacedBy only
};

template <typename F>
void forEachIndexed(size_t n, bool reversed, F f) {
  if (!reversed) {
    for (size_t i = 0; i < n; i++) {
      f(i);
    }
  } else {
    for (size_t i = n; i-- > 0;) {
      f(i);
    }
  }
}

int sum(const std::vector<int>& v) {
  long long s = 0;
  for (int x : v) {
    s += x;
  }
  return static_cast<int>(s);
}

void placeLeftOrTop(const std::vector<int>& size, std::vector<int>& out, bool reverse) {
  int current = 0;
  forEachIndexed(size.size(), reverse, [&](size_t i) {
    out[i] = current;
    current += size[i];
  });
}

void placeRightOrBottom(int total, const std::vector<int>& size, std::vector<int>& out, bool reverse) {
  int current = total - sum(size);
  forEachIndexed(size.size(), reverse, [&](size_t i) {
    out[i] = current;
    current += size[i];
  });
}

void placeCenter(int total, const std::vector<int>& size, std::vector<int>& out, bool reverse) {
  float current = static_cast<float>(total - sum(size)) / 2;
  forEachIndexed(size.size(), reverse, [&](size_t i) {
    out[i] = roundToInt(current);
    current += static_cast<float>(size[i]);
  });
}

void placeSpaceEvenly(int total, const std::vector<int>& size, std::vector<int>& out, bool reverse) {
  float gap = static_cast<float>(total - sum(size)) / static_cast<float>(size.size() + 1);
  float current = gap;
  forEachIndexed(size.size(), reverse, [&](size_t i) {
    out[i] = roundToInt(current);
    current += static_cast<float>(size[i]) + gap;
  });
}

void placeSpaceBetween(int total, const std::vector<int>& size, std::vector<int>& out, bool reverse) {
  if (size.empty()) {
    return;
  }
  int gaps = std::max(static_cast<int>(size.size()) - 1, 1);
  float gap = static_cast<float>(total - sum(size)) / static_cast<float>(gaps);
  float current = 0;
  if (reverse && size.size() == 1) {
    current = gap;
  }
  forEachIndexed(size.size(), reverse, [&](size_t i) {
    out[i] = roundToInt(current);
    current += static_cast<float>(size[i]) + gap;
  });
}

void placeSpaceAround(int total, const std::vector<int>& size, std::vector<int>& out, bool reverse) {
  float gap = size.empty() ? 0.0f : static_cast<float>(total - sum(size)) / static_cast<float>(size.size());
  float current = gap / 2;
  forEachIndexed(size.size(), reverse, [&](size_t i) {
    out[i] = roundToInt(current);
    current += static_cast<float>(size[i]) + gap;
  });
}

/// Arrangement.SpacedAligned.arrange for spacedBy(space), whose alignment is
/// `Alignment.Start.align(0, size, layoutDirection)`: 0 in LTR, the free space in RTL.
void placeSpacedBy(int spacePx, int total, const std::vector<int>& size, std::vector<int>& out, bool reverse) {
  if (size.empty()) {
    return;
  }
  int occupied = 0;
  int lastSpace = 0;
  forEachIndexed(size.size(), reverse, [&](size_t i) {
    out[i] = std::min(occupied, total - size[i]);
    lastSpace = std::min(spacePx, total - out[i] - size[i]);
    occupied = out[i] + size[i] + lastSpace;
  });
  occupied -= lastSpace;
  if (reverse && occupied < total) {
    for (auto& position : out) {
      position += total - occupied;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// CNode model
// ---------------------------------------------------------------------------------------------

enum class Direction { Horizontal, Vertical, Both };

/// One layout modifier node. Lengths are dp (NaN = unspecified), converted with roundToPx at
/// measure time like Compose.
struct Mod {
  enum Kind {
    Padding,         // PaddingNode (rtlAware)
    Size,            // SizeNode (size, width, height, sizeIn, requiredSize, ...)
    Fill,            // FillNode (fillMaxWidth / Height / Size)
    WrapContent,     // WrapContentNode
    DefaultMinSize,  // UnspecifiedConstraintsNode
    Offset,          // OffsetNode (rtlAware)
    Intrinsic,       // IntrinsicWidthNode / IntrinsicHeightNode
    MinTouch,        // MinimumInteractiveModifierNode (material3)
    Scroll,          // ScrollNode
    AspectRatio,     // AspectRatioNode
    LabelMinHeight,  // material3 textFieldLabelMinHeight
  };
  Kind kind;
  float start = 0, top = 0, end = 0, bottom = 0;             // Padding, Offset (start = x, top = y)
  float minW = NAN, maxW = NAN, minH = NAN, maxH = NAN;      // Size, DefaultMinSize
  bool enforceIncoming = true;                               // Size
  Direction direction = Direction::Both;                     // Fill, WrapContent, Intrinsic, Scroll
  float fraction = 1;                                        // Fill; AspectRatio ratio
  Alignment2D align{0, 0};                                   // WrapContent (default center)
  bool unbounded = false;                                    // WrapContent
  bool intrinsicMax = false;                                 // Intrinsic
  bool flag = false;  // AspectRatio matchHeightConstraintsFirst
};

enum class Policy {
  Row,
  Column,
  Box,
  FlowRow,
  Spacer,    // SpacerMeasurePolicy
  EmptyBox,  // EmptyBoxMeasurePolicy: (minWidth, minHeight)
  Text,
  Slider,
  TextField,
  Host,      // HostView.kt MaybeMatchContentsLayout
};

enum class Scope { None, Row, Column, Box };

struct ParentData {
  float weight = 0;
  bool fill = true;
  bool hasWeight = false;
  std::optional<float> crossBias;  // RowScope.align (vertical) / ColumnScope.align (horizontal)
  bool hasBoxData = false;         // BoxChildDataNode: the outermost one wins
  std::optional<Alignment2D> boxAlign;
  bool matchParentSize = false;
};

struct Placement {
  int x = 0;
  int y = 0;
  bool relative = false;
};

struct Coord {
  int measuredWidth = 0;
  int measuredHeight = 0;
  Constraints constraints;
  // Placement of the next coordinator (modifiers only).
  Placement child;
  int childWidth = 0;  // the next coordinator's placeable width, for placeRelative in RTL
};

struct CNode {
  std::string type;
  std::string path;  // empty = internal node (not reported)
  std::vector<Mod> mods;
  size_t innerIndex = 0;  // coordinator the inner recorder reports
  Policy policy = Policy::Box;
  Arrangement horizontalArrangement;
  Arrangement verticalArrangement;
  float crossBias = -1;  // Row: vertical alignment; Column: horizontal alignment
  Alignment2D contentAlignment;
  bool propagateMinConstraints = false;
  // Text
  std::string text;
  TextStyle style;
  int maxLines = INT_MAX;
  int minLines = 1;
  bool softWrap = true;
  bool ellipsis = false;
  // TextField
  bool outlined = false;
  bool hasValue = false;
  bool singleLine = false;
  CNode* labelSlot = nullptr;        // the label Box (layoutId LabelId)
  CNode* placeholderSlot = nullptr;  // the placeholder Box, when it is shown
  CNode* textBox = nullptr;          // the input Box (layoutId TextFieldId)
  // Tree
  ParentData parentData;
  std::string testID;
  bool isVirtual = false;           // Slot: frame = union of the children
  std::vector<CNode*> reportedKids;  // Slot: the children to union
  std::vector<std::unique_ptr<CNode>> children;
  // Measure results
  std::vector<Coord> coords;
  std::vector<Placement> placements;  // per child, from the policy
  std::vector<bool> placed;
  // Absolute positions after placement
  std::vector<std::pair<int, int>> positions;
  bool laidOut = false;
};

struct Placeable {
  int width = 0;
  int height = 0;
};

enum class Intrinsic { MinWidth, MaxWidth, MinHeight, MaxHeight };

bool isWidth(Intrinsic k) {
  return k == Intrinsic::MinWidth || k == Intrinsic::MaxWidth;
}

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

class Engine {
 public:
  Engine(TextMeasurer& text, const ControlMetrics& metrics)
      : text_(text), compose_(dynamic_cast<ComposeTextMeasurer*>(&text)), metrics_(metrics) {}

  bool rtl = false;
  std::map<std::string, std::vector<std::string>> unsupported;

  void report(const std::string& key, const std::string& path) {
    auto& paths = unsupported[key];
    if (std::find(paths.begin(), paths.end(), path) == paths.end()) {
      paths.push_back(path);
    }
  }

  /// Dp.roundToPx().
  int px(float dp) const {
    if (std::isinf(dp)) {
      return kInfinity;
    }
    return roundToInt(dp * metrics_.density);
  }

  const ControlMetrics& metrics() const { return metrics_; }
  bool touchTarget() const { return metrics_.touchTarget; }

  ResolvedTextStyle resolve(const TextStyle& s) const {
    float scale = metrics_.fontScale * metrics_.density;
    ResolvedTextStyle r;
    r.fontSizePx = s.fontSize * scale;
    r.lineHeightPx = std::isnan(s.lineHeight) ? NAN : s.lineHeight * scale;
    r.letterSpacingPx = s.letterSpacing * scale;
    r.fontWeight = s.fontWeight;
    r.italic = s.italic;
    r.fontFamily = s.fontFamily;
    r.trimLineHeight = s.trimLineHeight;
    return r;
  }

  // ----- text ---------------------------------------------------------------------------------

  static const char* weightName(int weight) {
    if (weight <= 100) return "thin";
    if (weight <= 200) return "ultraLight";
    if (weight <= 300) return "light";
    if (weight <= 400) return "regular";
    if (weight <= 500) return "medium";
    if (weight <= 600) return "semibold";
    if (weight <= 700) return "bold";
    if (weight <= 800) return "heavy";
    return "black";
  }

  static FontSpec fontSpec(const ResolvedTextStyle& style) {
    FontSpec f;
    f.pointSize = style.fontSizePx;
    f.weight = weightName(style.fontWeight);
    if (style.fontFamily == "serif") {
      f.design = "serif";
    } else if (style.fontFamily == "monospace") {
      f.design = "monospaced";
    } else {
      f.design = "default";
      f.family = style.fontFamily == "cursive" ? "cursive" : "Roboto";
    }
    return f;
  }

  static int codePoints(const std::string& text) {
    int n = 0;
    for (unsigned char c : text) {
      if ((c & 0xC0) != 0x80 && c != '\n') n++;
    }
    return n;
  }

  TextMeasurement measureText(const std::string& text, const ResolvedTextStyle& style, double maxWidth, int maxLines) {
    if (compose_) {
      return compose_->measureComposeText(text, style, maxWidth, maxLines);
    }
    TextMeasurement m = text_.measureText(text, fontSpec(style), maxWidth, maxLines);
    if (style.letterSpacingPx != 0 && m.lines <= 1) {
      m.width += style.letterSpacingPx * codePoints(text);
    }
    return m;
  }

  double fontHeight(const ResolvedTextStyle& style) {
    return compose_ ? compose_->composeFontHeight(style) : text_.lineHeight(fontSpec(style));
  }

  /// ParagraphIntrinsics.maxIntrinsicWidth: the widest line without wrapping.
  float maxIntrinsicWidth(const std::string& text, const ResolvedTextStyle& style) {
    return static_cast<float>(measureText(text, style, INFINITY, 0).width);
  }

  /// ParagraphIntrinsics.minIntrinsicWidth: the widest word.
  float minIntrinsicWidth(const std::string& text, const ResolvedTextStyle& style) {
    float widest = 0;
    size_t start = 0;
    while (start <= text.size()) {
      size_t end = text.find_first_of(" \n", start);
      if (end == std::string::npos) end = text.size();
      if (end > start) {
        widest = std::max(widest, maxIntrinsicWidth(text.substr(start, end - start), style));
      }
      start = end + 1;
    }
    return widest;
  }

  /// Paragraph height (Skia, observed with compose-ref): without a lineHeight each line is
  /// round(ascent + descent); with a lineHeight and LineHeightStyle.Trim.Both
  /// (TextStyle.Default) the first line's extra top and the last line's extra bottom go away:
  /// (lines - 1) * lineHeight + ascent + descent; with Trim.None (the Material typography)
  /// lines * lineHeight.
  float paragraphHeight(const ResolvedTextStyle& style, int lines) {
    float font = static_cast<float>(fontHeight(style));
    if (std::isnan(style.lineHeightPx)) {
      return std::round(font) * static_cast<float>(lines);
    }
    if (style.trimLineHeight) {
      return style.lineHeightPx * static_cast<float>(lines - 1) + font;
    }
    return std::round(style.lineHeightPx) * static_cast<float>(lines);
  }

  struct Paragraph {
    float height = 0;
    int lines = 1;
  };

  Paragraph layoutText(const std::string& text, const ResolvedTextStyle& style, float width, int maxLines) {
    TextMeasurement m = measureText(text, style, width, maxLines == INT_MAX ? 0 : maxLines);
    int lines = std::max(1, m.lines);
    if (maxLines != INT_MAX) lines = std::min(lines, std::max(1, maxLines));
    return {paragraphHeight(style, lines), lines};
  }

  // ----- measure ------------------------------------------------------------------------------

  Placeable measure(CNode& n, const Constraints& c) { return measureCoord(n, 0, c); }

  Placeable measureCoord(CNode& n, size_t k, const Constraints& c) {
    n.coords[k].constraints = c;
    n.coords[k].child = {};
    int w = 0;
    int h = 0;
    if (k == n.mods.size()) {
      measurePolicy(n, c, w, h);
    } else {
      measureMod(n, k, c, w, h, [&](const Constraints& ic) { return measureCoord(n, k + 1, ic); });
    }
    n.coords[k].measuredWidth = w;
    n.coords[k].measuredHeight = h;
    return {c.constrainWidth(w), c.constrainHeight(h)};
  }

  using MeasureInner = std::function<Placeable(const Constraints&)>;

  void setChild(CNode& n, size_t k, int x, int y, bool relative, int childWidth) {
    n.coords[k].child = {x, y, relative};
    n.coords[k].childWidth = childWidth;
  }

  /// SizeNode.targetConstraints.
  Constraints sizeTarget(const Mod& m) const {
    int maxW = std::isnan(m.maxW) ? kInfinity : std::max(0, px(m.maxW));
    int maxH = std::isnan(m.maxH) ? kInfinity : std::max(0, px(m.maxH));
    int minW = 0;
    if (!std::isnan(m.minW)) {
      minW = std::max(0, std::min(px(m.minW), maxW));
      if (minW == kInfinity) {
        minW = 0;
      }
    }
    int minH = 0;
    if (!std::isnan(m.minH)) {
      minH = std::max(0, std::min(px(m.minH), maxH));
      if (minH == kInfinity) {
        minH = 0;
      }
    }
    return {minW, maxW, minH, maxH};
  }

  Constraints sizeWrapped(const Mod& m, const Constraints& c) const {
    Constraints t = sizeTarget(m);
    if (m.enforceIncoming) {
      return c.constrain(t);
    }
    return {
        !std::isnan(m.minW) ? t.minWidth : std::min(c.minWidth, t.maxWidth),
        !std::isnan(m.maxW) ? t.maxWidth : std::max(c.maxWidth, t.minWidth),
        !std::isnan(m.minH) ? t.minHeight : std::min(c.minHeight, t.maxHeight),
        !std::isnan(m.maxH) ? t.maxHeight : std::max(c.maxHeight, t.minHeight),
    };
  }

  /// AspectRatioNode.findSize.
  static std::pair<int, int> aspectRatioSize(const Constraints& c, float ratio, bool heightFirst) {
    auto satisfied = [&](int w, int h) {
      return w >= c.minWidth && w <= c.maxWidth && h >= c.minHeight && h <= c.maxHeight;
    };
    auto tryMaxWidth = [&](bool enforce) -> std::pair<int, int> {
      if (c.maxWidth != kInfinity) {
        int h = roundToInt(static_cast<float>(c.maxWidth) / ratio);
        if (h > 0 && (!enforce || satisfied(c.maxWidth, h))) {
          return {c.maxWidth, h};
        }
      }
      return {0, 0};
    };
    auto tryMaxHeight = [&](bool enforce) -> std::pair<int, int> {
      if (c.maxHeight != kInfinity) {
        int w = roundToInt(static_cast<float>(c.maxHeight) * ratio);
        if (w > 0 && (!enforce || satisfied(w, c.maxHeight))) {
          return {w, c.maxHeight};
        }
      }
      return {0, 0};
    };
    auto tryMinWidth = [&](bool enforce) -> std::pair<int, int> {
      int h = roundToInt(static_cast<float>(c.minWidth) / ratio);
      if (h > 0 && (!enforce || satisfied(c.minWidth, h))) {
        return {c.minWidth, h};
      }
      return {0, 0};
    };
    auto tryMinHeight = [&](bool enforce) -> std::pair<int, int> {
      int w = roundToInt(static_cast<float>(c.minHeight) * ratio);
      if (w > 0 && (!enforce || satisfied(w, c.minHeight))) {
        return {w, c.minHeight};
      }
      return {0, 0};
    };
    for (bool enforce : {true, false}) {
      std::pair<int, int> r;
      if (!heightFirst) {
        if ((r = tryMaxWidth(enforce)).first) return r;
        if ((r = tryMaxHeight(enforce)).first) return r;
        if ((r = tryMinWidth(enforce)).first) return r;
        if ((r = tryMinHeight(enforce)).first) return r;
      } else {
        if ((r = tryMaxHeight(enforce)).first) return r;
        if ((r = tryMaxWidth(enforce)).first) return r;
        if ((r = tryMinHeight(enforce)).first) return r;
        if ((r = tryMinWidth(enforce)).first) return r;
      }
    }
    return {0, 0};
  }

  void measureMod(CNode& n, size_t k, const Constraints& c, int& w, int& h, const MeasureInner& inner) {
    const Mod& m = n.mods[k];
    switch (m.kind) {
      case Mod::Padding: {
        int s = px(m.start), t = px(m.top), e = px(m.end), b = px(m.bottom);
        int horizontal = s + e;
        int vertical = t + b;
        Placeable p = inner(c.offset(-horizontal, -vertical));
        w = c.constrainWidth(p.width + horizontal);
        h = c.constrainHeight(p.height + vertical);
        setChild(n, k, s, t, true, p.width);
        return;
      }
      case Mod::Size: {
        Placeable p = inner(sizeWrapped(m, c));
        w = p.width;
        h = p.height;
        setChild(n, k, 0, 0, true, p.width);
        return;
      }
      case Mod::Fill: {
        int minW = c.minWidth, maxW = c.maxWidth, minH = c.minHeight, maxH = c.maxHeight;
        if (c.hasBoundedWidth() && m.direction != Direction::Vertical) {
          int width = clampInt(roundToInt(static_cast<float>(c.maxWidth) * m.fraction), c.minWidth, c.maxWidth);
          minW = maxW = width;
        }
        if (c.hasBoundedHeight() && m.direction != Direction::Horizontal) {
          int height =
              clampInt(roundToInt(static_cast<float>(c.maxHeight) * m.fraction), c.minHeight, c.maxHeight);
          minH = maxH = height;
        }
        Placeable p = inner({minW, maxW, minH, maxH});
        w = p.width;
        h = p.height;
        setChild(n, k, 0, 0, false, p.width);
        return;
      }
      case Mod::WrapContent: {
        bool horizontal = m.direction != Direction::Vertical;
        bool vertical = m.direction != Direction::Horizontal;
        Constraints wrapped{
            horizontal ? 0 : c.minWidth,
            horizontal && m.unbounded ? kInfinity : c.maxWidth,
            vertical ? 0 : c.minHeight,
            vertical && m.unbounded ? kInfinity : c.maxHeight,
        };
        Placeable p = inner(wrapped);
        w = clampInt(p.width, c.minWidth, c.maxWidth);
        h = clampInt(p.height, c.minHeight, c.maxHeight);
        int x = horizontal ? alignHorizontal(m.align.horizontal, 0, w - p.width, rtl) : 0;
        int y = vertical ? alignVertical(m.align.vertical, 0, h - p.height) : 0;
        setChild(n, k, x, y, false, p.width);
        return;
      }
      case Mod::DefaultMinSize: {
        Constraints wrapped{
            !std::isnan(m.minW) && c.minWidth == 0 ? std::max(0, std::min(px(m.minW), c.maxWidth)) : c.minWidth,
            c.maxWidth,
            !std::isnan(m.minH) && c.minHeight == 0 ? std::max(0, std::min(px(m.minH), c.maxHeight)) : c.minHeight,
            c.maxHeight,
        };
        Placeable p = inner(wrapped);
        w = p.width;
        h = p.height;
        setChild(n, k, 0, 0, true, p.width);
        return;
      }
      case Mod::Offset: {
        Placeable p = inner(c);
        w = p.width;
        h = p.height;
        setChild(n, k, px(m.start), px(m.top), true, p.width);
        return;
      }
      case Mod::Intrinsic: {
        if (m.direction == Direction::Horizontal) {
          int iw = intrinsicCoord(n, k + 1, m.intrinsicMax ? Intrinsic::MaxWidth : Intrinsic::MinWidth, c.maxHeight);
          iw = std::max(iw, 0);
          Placeable p = inner(c.constrain({iw, iw, 0, kInfinity}));
          w = p.width;
          h = p.height;
        } else {
          int ih = intrinsicCoord(n, k + 1, m.intrinsicMax ? Intrinsic::MaxHeight : Intrinsic::MinHeight, c.maxWidth);
          ih = std::max(ih, 0);
          Placeable p = inner(c.constrain({0, kInfinity, ih, ih}));
          w = p.width;
          h = p.height;
        }
        setChild(n, k, 0, 0, true, w);
        return;
      }
      case Mod::MinTouch: {
        Placeable p = inner(c);
        w = p.width;
        h = p.height;
        if (touchTarget()) {
          int size = px(metrics().minimumInteractiveSize);
          w = std::max(w, size);
          h = std::max(h, size);
        }
        int x = roundToInt(static_cast<float>(w - p.width) / 2.0f);
        int y = roundToInt(static_cast<float>(h - p.height) / 2.0f);
        setChild(n, k, x, y, false, p.width);
        return;
      }
      case Mod::Scroll: {
        bool vertical = m.direction == Direction::Vertical;
        Constraints child = c;
        if (vertical) {
          child.maxHeight = kInfinity;
        } else {
          child.maxWidth = kInfinity;
        }
        Placeable p = inner(child);
        w = std::min(p.width, c.maxWidth);
        h = std::min(p.height, c.maxHeight);
        setChild(n, k, 0, 0, true, p.width);
        return;
      }
      case Mod::LabelMinHeight: {
        Constraints wrapped = c;
        wrapped.minHeight = c.constrainHeight(px(m.minH));
        Placeable p = inner(wrapped);
        w = p.width;
        h = p.height;
        setChild(n, k, 0, 0, false, p.width);
        return;
      }
      case Mod::AspectRatio: {
        auto size = aspectRatioSize(c, m.fraction, m.flag);
        Constraints wrapped = size.first != 0 || size.second != 0 ? Constraints::fixed(size.first, size.second) : c;
        Placeable p = inner(wrapped);
        w = p.width;
        h = p.height;
        setChild(n, k, 0, 0, true, p.width);
        return;
      }
    }
  }

  // ----- intrinsics ---------------------------------------------------------------------------

  /// An intrinsic of the chain from coordinator k. `other` is the height for width queries and
  /// the width for height queries.
  int intrinsicCoord(CNode& n, size_t k, Intrinsic kind, int other) {
    if (k == n.mods.size()) {
      return intrinsicPolicy(n, kind, other);
    }
    const Mod& m = n.mods[k];
    switch (m.kind) {
      case Mod::Size: {
        // SizeNode overrides the intrinsics.
        Constraints t = sizeTarget(m);
        if (isWidth(kind)) {
          return t.hasFixedWidth() ? t.maxWidth : t.constrainWidth(intrinsicCoord(n, k + 1, kind, other));
        }
        return t.hasFixedHeight() ? t.maxHeight : t.constrainHeight(intrinsicCoord(n, k + 1, kind, other));
      }
      case Mod::DefaultMinSize: {
        int v = intrinsicCoord(n, k + 1, kind, other);
        float min = isWidth(kind) ? m.minW : m.minH;
        return std::isnan(min) ? v : std::max(v, px(min));
      }
      case Mod::Intrinsic: {
        bool widthNode = m.direction == Direction::Horizontal;
        if (isWidth(kind) == widthNode) {
          Intrinsic own = widthNode ? (m.intrinsicMax ? Intrinsic::MaxWidth : Intrinsic::MinWidth)
                                    : (m.intrinsicMax ? Intrinsic::MaxHeight : Intrinsic::MinHeight);
          return intrinsicCoord(n, k + 1, own, other);
        }
        int size = intrinsicCoord(n, k + 1,
                                  widthNode ? (m.intrinsicMax ? Intrinsic::MaxWidth : Intrinsic::MinWidth)
                                            : (m.intrinsicMax ? Intrinsic::MaxHeight : Intrinsic::MinHeight),
                                  kInfinity);
        return intrinsicCoord(n, k + 1, kind, size);
      }
      case Mod::Scroll: {
        bool vertical = m.direction == Direction::Vertical;
        if (isWidth(kind)) {
          return intrinsicCoord(n, k + 1, kind, vertical ? kInfinity : other);
        }
        return intrinsicCoord(n, k + 1, kind, vertical ? other : kInfinity);
      }
      default: {
        // LayoutModifierNode default intrinsics: measure with a child whose size is its
        // intrinsic (NodeMeasuringIntrinsics).
        Constraints c = isWidth(kind) ? Constraints{0, kInfinity, 0, other} : Constraints{0, other, 0, kInfinity};
        Coord saved = n.coords[k];
        int w = 0, h = 0;
        measureMod(n, k, c, w, h, [&](const Constraints& ic) -> Placeable {
          if (isWidth(kind)) {
            int v = intrinsicCoord(n, k + 1, kind, ic.maxHeight);
            return {v, ic.hasBoundedHeight() ? ic.maxHeight : 0};
          }
          int v = intrinsicCoord(n, k + 1, kind, ic.maxWidth);
          return {ic.hasBoundedWidth() ? ic.maxWidth : 0, v};
        });
        n.coords[k] = saved;
        return isWidth(kind) ? w : h;
      }
    }
  }

  int intrinsic(CNode& n, Intrinsic kind, int other) { return intrinsicCoord(n, 0, kind, other); }

  /// RowColumnImpl intrinsicMainAxisSize.
  int intrinsicMainAxisSize(const std::vector<CNode*>& kids, Intrinsic main, int crossAvailable, int spacing) {
    if (kids.empty()) {
      return 0;
    }
    int weightUnitSpace = 0;
    int fixedSpace = 0;
    float totalWeight = 0;
    for (CNode* kid : kids) {
      float weight = kid->parentData.weight;
      int size = intrinsic(*kid, main, crossAvailable);
      if (weight == 0) {
        fixedSpace += size;
      } else if (weight > 0) {
        totalWeight += weight;
        weightUnitSpace = std::max(weightUnitSpace, roundToInt(static_cast<float>(size) / weight));
      }
    }
    return roundToInt(static_cast<float>(weightUnitSpace) * totalWeight) + fixedSpace +
           (static_cast<int>(kids.size()) - 1) * spacing;
  }

  /// RowColumnImpl intrinsicCrossAxisSize.
  int intrinsicCrossAxisSize(const std::vector<CNode*>& kids, Intrinsic cross, Intrinsic main, int mainAvailable,
                             int spacing) {
    if (kids.empty()) {
      return 0;
    }
    int fixedSpace = std::min((static_cast<int>(kids.size()) - 1) * spacing, mainAvailable);
    int crossMax = 0;
    float totalWeight = 0;
    for (CNode* kid : kids) {
      float weight = kid->parentData.weight;
      if (weight == 0) {
        int remaining = mainAvailable == kInfinity ? kInfinity : mainAvailable - fixedSpace;
        int mainSpace = std::min(intrinsic(*kid, main, kInfinity), remaining);
        fixedSpace += mainSpace;
        crossMax = std::max(crossMax, intrinsic(*kid, cross, mainSpace));
      } else if (weight > 0) {
        totalWeight += weight;
      }
    }
    int weightUnitSpace = 0;
    if (totalWeight != 0) {
      weightUnitSpace = mainAvailable == kInfinity
                            ? kInfinity
                            : roundToInt(static_cast<float>(std::max(0, mainAvailable - fixedSpace)) / totalWeight);
    }
    for (CNode* kid : kids) {
      float weight = kid->parentData.weight;
      if (weight > 0) {
        int size = weightUnitSpace != kInfinity ? roundToInt(static_cast<float>(weightUnitSpace) * weight) : kInfinity;
        crossMax = std::max(crossMax, intrinsic(*kid, cross, size));
      }
    }
    return crossMax;
  }

  std::vector<CNode*> kids(CNode& n) {
    std::vector<CNode*> out;
    for (auto& c : n.children) {
      out.push_back(c.get());
    }
    return out;
  }

  int spacingPx(const Arrangement& a) const { return a.kind == Arrangement::SpacedBy ? px(a.space) : 0; }

  int intrinsicPolicy(CNode& n, Intrinsic kind, int other) {
    switch (n.policy) {
      case Policy::Row:
      case Policy::FlowRow:
      case Policy::Column: {
        bool row = n.policy != Policy::Column;
        auto list = kids(n);
        int spacing = spacingPx(row ? n.horizontalArrangement : n.verticalArrangement);
        bool mainQuery = isWidth(kind) == row;
        if (n.policy == Policy::FlowRow && kind == Intrinsic::MinWidth) {
          // FlowRow: the widest child.
          int widest = 0;
          for (CNode* kid : list) {
            widest = std::max(widest, intrinsic(*kid, kind, other));
          }
          return widest;
        }
        if (mainQuery) {
          return intrinsicMainAxisSize(list, kind, other, spacing);
        }
        Intrinsic main = row ? Intrinsic::MaxWidth : Intrinsic::MaxHeight;
        return intrinsicCrossAxisSize(list, kind, main, other, spacing);
      }
      case Policy::Box:
      case Policy::Host: {
        int v = 0;
        for (auto& kid : n.children) {
          if (!kid->parentData.matchParentSize) {
            v = std::max(v, intrinsic(*kid, kind, other));
          }
        }
        return v;
      }
      case Policy::Spacer:
      case Policy::EmptyBox:
        return 0;
      case Policy::Text: {
        ResolvedTextStyle style = resolve(n.style);
        if (kind == Intrinsic::MinWidth) {
          return ceilToInt(minIntrinsicWidth(n.text, style));
        }
        if (kind == Intrinsic::MaxWidth) {
          return ceilToInt(maxIntrinsicWidth(n.text, style));
        }
        int w = 0, h = 0;
        measureText(n, Constraints{0, other, 0, kInfinity}, w, h);
        return h;
      }
      case Policy::Slider:
        return isWidth(kind) ? px(metrics().sliderThumbWidth) : px(metrics().sliderThumbHeight);
      case Policy::TextField: {
        if (isWidth(kind)) {
          return px(metrics().textFieldMinWidth);
        }
        return px(metrics().textFieldMinHeight);
      }
    }
    return 0;
  }

  // ----- policies -----------------------------------------------------------------------------

  void measurePolicy(CNode& n, const Constraints& c, int& w, int& h) {
    n.placements.assign(n.children.size(), {});
    n.placed.assign(n.children.size(), false);
    switch (n.policy) {
      case Policy::Row:
      case Policy::Column:
        measureRowColumn(n, c, w, h);
        return;
      case Policy::Box:
        measureBox(n, c, w, h);
        return;
      case Policy::FlowRow:
        measureFlowRow(n, c, w, h);
        return;
      case Policy::Spacer:
        w = c.hasFixedWidth() ? c.maxWidth : 0;
        h = c.hasFixedHeight() ? c.maxHeight : 0;
        return;
      case Policy::EmptyBox:
        w = c.minWidth;
        h = c.minHeight;
        return;
      case Policy::Text:
        measureText(n, c, w, h);
        return;
      case Policy::Slider:
        measureSlider(c, w, h);
        return;
      case Policy::TextField:
        measureTextField(n, c, w, h);
        return;
      case Policy::Host: {
        w = 0;
        h = 0;
        for (size_t i = 0; i < n.children.size(); i++) {
          Placeable p = measure(*n.children[i], c);
          w = std::max(w, p.width);
          h = std::max(h, p.height);
          n.placements[i] = {0, 0, true};
          n.placed[i] = true;
        }
        return;
      }
    }
  }

  static Constraints mainCross(bool row, int mainMin, int mainMax, int crossMin, int crossMax) {
    return row ? Constraints{mainMin, mainMax, crossMin, crossMax} : Constraints{crossMin, crossMax, mainMin, mainMax};
  }

  struct LineResult {
    int mainSize = 0;
    int crossSize = 0;
    std::vector<int> mainPositions;
    std::vector<int> crossSizes;
  };

  /// RowColumnMeasurePolicy.measure over kids[start, end). `pre` holds children that are
  /// already measured (FlowRow).
  LineResult rowColumnMeasure(bool row, const std::vector<CNode*>& list, std::vector<std::optional<Placeable>>& pre,
                              int mainMin, int crossMin, int mainMax, int crossMax, int spacing) {
    size_t count = list.size();
    std::vector<Placeable> placeables(count);
    std::vector<bool> done(count, false);
    float totalWeight = 0;
    int fixedSpace = 0;
    int crossSpace = 0;
    int weightChildren = 0;
    int spaceAfterLastNoWeight = 0;
    auto mainOf = [&](const Placeable& p) { return row ? p.width : p.height; };
    auto crossOf = [&](const Placeable& p) { return row ? p.height : p.width; };

    for (size_t i = 0; i < count; i++) {
      CNode& kid = *list[i];
      float weight = kid.parentData.weight;
      if (weight > 0) {
        totalWeight += weight;
        weightChildren++;
      } else {
        Placeable p;
        if (pre[i]) {
          p = *pre[i];
        } else {
          int childMainMax = mainMax == kInfinity ? kInfinity : std::max(0, mainMax - fixedSpace);
          p = measure(kid, mainCross(row, 0, childMainMax, 0, crossMax));
        }
        placeables[i] = p;
        done[i] = true;
        int remaining = mainMax == kInfinity ? kInfinity : mainMax - fixedSpace;
        spaceAfterLastNoWeight = std::min(spacing, std::max(0, remaining == kInfinity ? spacing : remaining - mainOf(p)));
        fixedSpace += mainOf(p) + spaceAfterLastNoWeight;
        crossSpace = std::max(crossSpace, crossOf(p));
      }
    }

    int weightedSpace = 0;
    if (weightChildren == 0) {
      fixedSpace -= spaceAfterLastNoWeight;
    } else {
      int targetSpace = totalWeight > 0 && mainMax != kInfinity ? mainMax : mainMin;
      int spacingTotal = spacing * (weightChildren - 1);
      int remainingToTarget = std::max(0, targetSpace - fixedSpace - spacingTotal);
      float weightUnitSpace = totalWeight > 0 ? static_cast<float>(remainingToTarget) / totalWeight : 0;
      int remainder = remainingToTarget;
      for (size_t i = 0; i < count; i++) {
        remainder -= roundToInt(weightUnitSpace * list[i]->parentData.weight);
      }
      for (size_t i = 0; i < count; i++) {
        if (done[i]) {
          continue;
        }
        CNode& kid = *list[i];
        int remainderUnit = remainder > 0 ? 1 : remainder < 0 ? -1 : 0;
        remainder -= remainderUnit;
        int childMain = std::max(0, roundToInt(weightUnitSpace * kid.parentData.weight) + remainderUnit);
        Placeable p = measure(kid, mainCross(row, kid.parentData.fill && childMain != kInfinity ? childMain : 0,
                                             childMain, 0, crossMax));
        placeables[i] = p;
        done[i] = true;
        weightedSpace += mainOf(p);
        crossSpace = std::max(crossSpace, crossOf(p));
      }
      long long ws = static_cast<long long>(weightedSpace) + spacingTotal;
      long long hi = mainMax == kInfinity ? kInfinity : static_cast<long long>(mainMax) - fixedSpace;
      weightedSpace = static_cast<int>(std::max(0LL, std::min(ws, std::max(0LL, hi))));
    }

    LineResult r;
    r.mainSize = std::max(std::max(0, fixedSpace + weightedSpace), mainMin);
    r.crossSize = std::max(crossSpace, crossMin);
    std::vector<int> sizes(count);
    for (size_t i = 0; i < count; i++) {
      sizes[i] = mainOf(placeables[i]);
      r.crossSizes.push_back(crossOf(placeables[i]));
      pre[i] = placeables[i];
    }
    r.mainPositions.assign(count, 0);
    return r;
  }

  void arrange(const Arrangement& a, bool horizontal, int total, const std::vector<int>& sizes,
               std::vector<int>& out) {
    bool reverse = horizontal && rtl;
    switch (a.kind) {
      case Arrangement::Start:
        if (!reverse) {
          placeLeftOrTop(sizes, out, false);
        } else {
          placeRightOrBottom(total, sizes, out, true);
        }
        return;
      case Arrangement::End:
        if (!reverse) {
          placeRightOrBottom(total, sizes, out, false);
        } else {
          placeLeftOrTop(sizes, out, true);
        }
        return;
      case Arrangement::Center:
        placeCenter(total, sizes, out, reverse);
        return;
      case Arrangement::SpaceBetween:
        placeSpaceBetween(total, sizes, out, reverse);
        return;
      case Arrangement::SpaceAround:
        placeSpaceAround(total, sizes, out, reverse);
        return;
      case Arrangement::SpaceEvenly:
        placeSpaceEvenly(total, sizes, out, reverse);
        return;
      case Arrangement::SpacedBy:
        placeSpacedBy(px(a.space), total, sizes, out, reverse);
        return;
    }
  }

  void measureRowColumn(CNode& n, const Constraints& c, int& w, int& h) {
    bool row = n.policy == Policy::Row;
    auto list = kids(n);
    const Arrangement& mainArrangement = row ? n.horizontalArrangement : n.verticalArrangement;
    int spacing = spacingPx(mainArrangement);
    std::vector<std::optional<Placeable>> pre(list.size());
    LineResult r = row ? rowColumnMeasure(true, list, pre, c.minWidth, c.minHeight, c.maxWidth, c.maxHeight, spacing)
                       : rowColumnMeasure(false, list, pre, c.minHeight, c.minWidth, c.maxHeight, c.maxWidth, spacing);
    std::vector<int> sizes;
    for (auto& p : pre) {
      sizes.push_back(row ? p->width : p->height);
    }
    std::vector<int> positions(list.size(), 0);
    arrange(mainArrangement, row, r.mainSize, sizes, positions);
    for (size_t i = 0; i < list.size(); i++) {
      float bias = list[i]->parentData.crossBias.value_or(n.crossBias);
      int cross = row ? alignVertical(bias, r.crossSizes[i], r.crossSize)
                      : alignHorizontal(bias, r.crossSizes[i], r.crossSize, rtl);
      n.placements[i] = row ? Placement{positions[i], cross, false} : Placement{cross, positions[i], false};
      n.placed[i] = true;
    }
    w = row ? r.mainSize : r.crossSize;
    h = row ? r.crossSize : r.mainSize;
  }

  void measureBox(CNode& n, const Constraints& c, int& w, int& h) {
    Constraints content = n.propagateMinConstraints ? c : Constraints{0, c.maxWidth, 0, c.maxHeight};
    size_t count = n.children.size();
    std::vector<Placeable> placeables(count);
    if (count == 0) {
      w = c.minWidth;
      h = c.minHeight;
      return;
    }
    if (count == 1) {
      CNode& kid = *n.children[0];
      if (!kid.parentData.matchParentSize) {
        placeables[0] = measure(kid, content);
        w = std::max(c.minWidth, placeables[0].width);
        h = std::max(c.minHeight, placeables[0].height);
      } else {
        w = c.minWidth;
        h = c.minHeight;
        placeables[0] = measure(kid, Constraints::fixed(c.minWidth, c.minHeight));
      }
    } else {
      bool hasMatchParent = false;
      w = c.minWidth;
      h = c.minHeight;
      for (size_t i = 0; i < count; i++) {
        CNode& kid = *n.children[i];
        if (!kid.parentData.matchParentSize) {
          placeables[i] = measure(kid, content);
          w = std::max(w, placeables[i].width);
          h = std::max(h, placeables[i].height);
        } else {
          hasMatchParent = true;
        }
      }
      if (hasMatchParent) {
        Constraints mp{w != kInfinity ? w : 0, w, h != kInfinity ? h : 0, h};
        for (size_t i = 0; i < count; i++) {
          if (n.children[i]->parentData.matchParentSize) {
            placeables[i] = measure(*n.children[i], mp);
          }
        }
      }
    }
    for (size_t i = 0; i < count; i++) {
      const ParentData& pd = n.children[i]->parentData;
      Alignment2D a = pd.boxAlign.value_or(n.contentAlignment);
      int x = alignHorizontal(a.horizontal, placeables[i].width, w, rtl);
      int y = alignVertical(a.vertical, placeables[i].height, h);
      n.placements[i] = {x, y, false};
      n.placed[i] = true;
    }
  }

  /// FlowLayout.kt breakDownItems + placeHelper (no maxItemsInEachRow / maxLines / overflow,
  /// which @expo/ui does not expose).
  void measureFlowRow(CNode& n, const Constraints& c, int& w, int& h) {
    auto list = kids(n);
    if (list.empty()) {
      w = 0;
      h = 0;
      return;
    }
    // The main-axis spacing is ceil(spacing.toPx()) here; the arrangement still places with
    // roundToPx, and the cross-axis spacing in placeHelper is roundToPx.
    int spacing = n.horizontalArrangement.kind == Arrangement::SpacedBy
                      ? static_cast<int>(std::ceil(n.horizontalArrangement.space * metrics_.density))
                      : 0;
    int crossSpacing = spacingPx(n.verticalArrangement);
    int mainMax = c.maxWidth;
    Constraints measureConstraints{0, mainMax, 0, c.maxHeight};
    std::vector<std::optional<Placeable>> pre(list.size());
    std::vector<int> mainSizes(list.size());
    for (size_t i = 0; i < list.size(); i++) {
      CNode& kid = *list[i];
      if (kid.parentData.weight == 0) {
        pre[i] = measure(kid, measureConstraints);
        mainSizes[i] = pre[i]->width;
      } else {
        mainSizes[i] = intrinsic(kid, Intrinsic::MinWidth, kInfinity);
      }
    }
    std::vector<std::vector<size_t>> lines(1);
    long long leftOver = mainMax;
    long long lineSize = 0;
    int mainTotal = c.minWidth;
    for (size_t i = 0; i < list.size(); i++) {
      long long item = mainSizes[i] + (lines.back().empty() ? 0 : spacing);
      if (!lines.back().empty() && leftOver - item < 0) {
        mainTotal = static_cast<int>(std::min<long long>(std::max<long long>(mainTotal, lineSize), mainMax));
        lines.push_back({});
        leftOver = mainMax;
        lineSize = 0;
        item = mainSizes[i];
      }
      lineSize += item;
      leftOver -= item;
      lines.back().push_back(i);
    }
    mainTotal = static_cast<int>(std::min<long long>(std::max<long long>(mainTotal, lineSize), mainMax));

    std::vector<LineResult> results;
    std::vector<int> lineCross;
    int crossTotal = 0;
    for (auto& line : lines) {
      std::vector<CNode*> lineKids;
      std::vector<std::optional<Placeable>> linePre;
      for (size_t i : line) {
        lineKids.push_back(list[i]);
        linePre.push_back(pre[i]);
      }
      int crossMax = c.maxHeight == kInfinity ? kInfinity : c.maxHeight - crossTotal;
      LineResult r = rowColumnMeasure(true, lineKids, linePre, mainTotal, 0, mainMax, crossMax, spacing);
      std::vector<int> sizes;
      for (size_t j = 0; j < line.size(); j++) {
        pre[line[j]] = linePre[j];
        sizes.push_back(linePre[j]->width);
      }
      r.mainPositions.assign(line.size(), 0);
      arrange(n.horizontalArrangement, true, r.mainSize, sizes, r.mainPositions);
      crossTotal += r.crossSize;
      mainTotal = std::max(mainTotal, r.mainSize);
      lineCross.push_back(r.crossSize);
      results.push_back(std::move(r));
    }
    int totalCross = clampInt(crossTotal + crossSpacing * (static_cast<int>(lines.size()) - 1), c.minHeight, c.maxHeight);
    std::vector<int> linePositions(lines.size(), 0);
    arrange(n.verticalArrangement, false, totalCross, lineCross, linePositions);
    w = clampInt(mainTotal, c.minWidth, c.maxWidth);
    h = totalCross;
    for (size_t l = 0; l < lines.size(); l++) {
      for (size_t j = 0; j < lines[l].size(); j++) {
        size_t i = lines[l][j];
        float bias = list[i]->parentData.crossBias.value_or(-1);
        int y = alignVertical(bias, results[l].crossSizes[j], results[l].crossSize);
        n.placements[i] = {results[l].mainPositions[j], linePositions[l] + y, false};
        n.placed[i] = true;
      }
    }
  }

  void measureText(CNode& n, const Constraints& c, int& w, int& h) {
    ResolvedTextStyle style = resolve(n.style);
    // ParagraphLayoutCache.finalMaxWidth / finalMaxLines.
    float maxIntrinsic = maxIntrinsicWidth(n.text, style);
    bool widthMatters = n.softWrap || n.ellipsis;
    int maxWidth = widthMatters && c.hasBoundedWidth() ? c.maxWidth : kInfinity;
    int width = c.minWidth == maxWidth ? maxWidth : clampInt(ceilToInt(maxIntrinsic), c.minWidth, maxWidth);
    int maxLines = !n.softWrap && n.ellipsis ? 1 : std::max(1, n.maxLines);
    Paragraph r = layoutText(n.text, style, width == kInfinity ? INFINITY : static_cast<float>(width), maxLines);
    int height = ceilToInt(r.height);
    Constraints cc = c;
    if (n.minLines > 1) {
      // MinLinesConstrainer: one line plus (minLines - 1) line heights.
      float one = paragraphHeight(style, 1);
      float two = paragraphHeight(style, 2);
      int minHeight = ceilToInt(one + (two - one) * static_cast<float>(n.minLines - 1));
      cc.minHeight = clampInt(std::max(cc.minHeight, minHeight), 0, cc.maxHeight);
    }
    w = cc.constrainWidth(width);
    h = cc.constrainHeight(height);
  }

  /// material3 Slider (SliderImpl): thumb `size(ThumbWidth, ThumbHeight)`, track
  /// `fillMaxWidth().height(TrackHeight)` measured with the width left by the thumb.
  void measureSlider(const Constraints& c, int& w, int& h) {
    int thumbW = c.constrainWidth(px(metrics().sliderThumbWidth));
    int thumbH = c.constrainHeight(px(metrics().sliderThumbHeight));
    Constraints track = c.offset(-thumbW, 0);
    track.minHeight = 0;
    int trackW = track.hasBoundedWidth() ? track.maxWidth : track.minWidth;
    int trackH = track.constrainHeight(px(metrics().sliderTrackHeight));
    w = thumbW + trackW;
    h = std::max(trackH, thumbH);
  }

  /// Compose's Int lerp: start + ((stop - start) * fraction).roundToInt().
  static int lerpInt(int start, int stop, float fraction) {
    return start + static_cast<int>(std::lround(static_cast<double>(stop - start) * fraction));
  }

  /// material3 TextFieldMeasurePolicy / OutlinedTextFieldMeasurePolicy (label position Attached),
  /// for the label, placeholder and input. No leading / trailing icons, prefix, suffix or
  /// supporting text. The field is not focused, so the label floats when the value is not empty.
  void measureTextField(CNode& n, const Constraints& c, int& w, int& h) {
    float progress = n.labelSlot && n.hasValue ? 1.0f : 0.0f;
    CNode* label = n.labelSlot;
    CNode* placeholder = n.placeholderSlot;
    CNode* input = n.textBox;
    Constraints loose{0, c.maxWidth, 0, c.maxHeight};
    auto index = [&](CNode* kid) {
      for (size_t i = 0; i < n.children.size(); i++) {
        if (n.children[i].get() == kid) return i;
      }
      return n.children.size();
    };
    auto placeAt = [&](CNode* kid, int x, int y, bool relative) {
      size_t i = index(kid);
      n.placements[i] = {x, y, relative};
      n.placed[i] = true;
    };
    float d = metrics_.density;
    if (!n.outlined) {
      // TextFieldDefaults.contentPaddingWithLabel (16, 8, 16, 8) / WithoutLabel (16).
      float topDp = label ? 8.0f : 16.0f;
      float bottomDp = topDp;
      int top = px(topDp);
      int bottom = px(bottomDp);
      Placeable lp = label ? measure(*label, loose.offset(0, -bottom)) : Placeable{};
      int effectiveTop = top + lp.height;
      Constraints tc = Constraints{c.minWidth, c.maxWidth, 0, c.maxHeight}.offset(0, -effectiveTop - bottom);
      Placeable tp = measure(*input, tc);
      Constraints pc = tc;
      pc.minWidth = 0;
      Placeable pp = placeholder ? measure(*placeholder, pc) : Placeable{};
      w = c.constrainWidth(std::max({tp.width, pp.width, lp.width}));
      int verticalPadding = px(topDp + bottomDp);
      int inputHeight = std::max({tp.height, pp.height, lerpInt(lp.height, 0, progress)});
      int nonOverlapped = label ? std::max(px(2 * minimizedLabelHalfHeight), lerpInt(0, lp.height, progress)) : 0;
      h = c.constrainHeight(verticalPadding + nonOverlapped + inputHeight);
      if (label) {
        int startY = n.singleLine ? alignVertical(0, lp.height, h) : top + px(minimizedLabelHalfHeight);
        int labelY = lerpInt(startY, top, progress);
        placeAt(label, alignHorizontal(-1, lp.width, w, rtl), labelY, false);
        int textPosition = top + lp.height;
        placeAt(input, 0, textPosition, true);
        if (placeholder) placeAt(placeholder, 0, textPosition, true);
      } else {
        placeAt(input, 0, n.singleLine ? alignVertical(0, tp.height, h) : top, true);
        if (placeholder) placeAt(placeholder, 0, n.singleLine ? alignVertical(0, pp.height, h) : top, true);
      }
      return;
    }
    // OutlinedTextFieldDefaults.contentPadding: 16 on every side.
    float padDp = 16;
    int bottom = px(padDp);
    int totalHorizontal = px(padDp) + px(padDp);
    Placeable lp = label ? measure(*label, loose.offset(-lerpInt(totalHorizontal, totalHorizontal, progress), -bottom))
                         : Placeable{};
    int topPadding = std::max(lp.height / 2, px(padDp));
    Constraints tc = c.offset(0, -bottom - topPadding);
    tc.minHeight = 0;
    Placeable tp = measure(*input, tc);
    Constraints pc = tc;
    pc.minWidth = 0;
    Placeable pp = placeholder ? measure(*placeholder, pc) : Placeable{};
    int middle = std::max({tp.width, pp.width, lerpInt(lp.width, 0, progress)});
    int focusedLabelWidth = roundToInt((static_cast<float>(lp.width) + 2 * padDp * d) * progress);
    w = c.constrainWidth(std::max(middle, focusedLabelWidth));
    int inputHeight = std::max({tp.height, pp.height, lerpInt(lp.height, 0, progress)});
    float topF = padDp * d;
    float actualTop = topF + (std::max(topF, static_cast<float>(lp.height) / 2.0f) - topF) * progress;
    h = c.constrainHeight(roundToInt(actualTop + static_cast<float>(inputHeight) + padDp * d));
    int topPx = roundToInt(padDp * d);
    if (label) {
      int startY = n.singleLine ? alignVertical(0, lp.height, h) : topPx;
      int y = lerpInt(startY, -(lp.height / 2), progress);
      float startPad = padDp * d;
      int space = w - roundToInt(2 * startPad);
      float startX = static_cast<float>(alignHorizontal(-1, lp.width, space, rtl)) + startPad;
      placeAt(label, roundToInt(startX), y, false);
    }
    auto textY = [&](int height) {
      int y = n.singleLine ? alignVertical(0, height, h) : topPx;
      return std::max(y, lp.height / 2);
    };
    placeAt(input, 0, textY(tp.height), true);
    if (placeholder) placeAt(placeholder, 0, textY(pp.height), true);
  }

  /// minimizedLabelHalfHeight(): half of bodySmall's line height.
  static constexpr float minimizedLabelHalfHeight = 8;

  // ----- placement ----------------------------------------------------------------------------

  static int coerced(int measured, int min, int max) { return clampInt(measured, min, max); }

  /// Placeable.apparentToRealOffset for a coordinator.
  static std::pair<int, int> apparent(const Coord& co) {
    int cw = coerced(co.measuredWidth, co.constraints.minWidth, co.constraints.maxWidth);
    int ch = coerced(co.measuredHeight, co.constraints.minHeight, co.constraints.maxHeight);
    return {(cw - co.measuredWidth) / 2, (ch - co.measuredHeight) / 2};
  }

  /// `x` and `y` are where the parent placed the node (its first coordinator), before the
  /// apparent-to-real offset.
  void place(CNode& n, int x, int y) {
    n.laidOut = true;
    n.positions.assign(n.coords.size(), {0, 0});
    auto a0 = apparent(n.coords[0]);
    n.positions[0] = {x + a0.first, y + a0.second};
    for (size_t k = 0; k < n.mods.size(); k++) {
      const Coord& co = n.coords[k];
      int cx = co.child.x;
      if (co.child.relative && rtl) {
        cx = co.measuredWidth - co.childWidth - cx;
      }
      auto a = apparent(n.coords[k + 1]);
      n.positions[k + 1] = {n.positions[k].first + cx + a.first, n.positions[k].second + co.child.y + a.second};
    }
    auto inner = n.positions[n.mods.size()];
    const Coord& policy = n.coords[n.mods.size()];
    for (size_t i = 0; i < n.children.size(); i++) {
      if (!n.placed[i]) {
        continue;
      }
      CNode& kid = *n.children[i];
      const Placement& p = n.placements[i];
      int cx = p.x;
      if (p.relative && rtl) {
        const Coord& k0 = kid.coords[0];
        int kidWidth = coerced(k0.measuredWidth, k0.constraints.minWidth, k0.constraints.maxWidth);
        cx = policy.measuredWidth - kidWidth - cx;
      }
      place(kid, inner.first + cx, inner.second + p.y);
    }
  }

 private:
  TextMeasurer& text_;
  ComposeTextMeasurer* compose_;
  const ControlMetrics& metrics_;
};

// ---------------------------------------------------------------------------------------------
// Builder: JSON -> nodes (the @expo/ui Kotlin views, ModifierRegistry.kt)
// ---------------------------------------------------------------------------------------------

std::optional<Alignment2D> alignment2d(const std::string& s) {
  static const std::map<std::string, Alignment2D> table = {
      {"topStart", {-1, -1}},    {"topCenter", {0, -1}},    {"topEnd", {1, -1}},
      {"centerStart", {-1, 0}},  {"center", {0, 0}},        {"centerEnd", {1, 0}},
      {"bottomStart", {-1, 1}},  {"bottomCenter", {0, 1}},  {"bottomEnd", {1, 1}},
  };
  auto it = table.find(s);
  return it == table.end() ? std::nullopt : std::optional<Alignment2D>(it->second);
}

/// AlignmentType.toVerticalAlignment().
std::optional<float> alignmentVertical(const std::string& s) {
  if (s == "top") return -1.0f;
  if (s == "centerVertically") return 0.0f;
  if (s == "bottom") return 1.0f;
  return std::nullopt;
}

/// AlignmentType.toHorizontalAlignment().
std::optional<float> alignmentHorizontal(const std::string& s) {
  if (s == "start") return -1.0f;
  if (s == "centerHorizontally") return 0.0f;
  if (s == "end") return 1.0f;
  return std::nullopt;
}

const std::vector<std::string>& nonLayoutModifiers() {
  static const std::vector<std::string> names = {
      "background", "shadow", "dropShadow", "innerShadow", "alpha", "blur", "cornerRadius", "rotate",
      "graphicsLayer", "zIndex", "animateContentSize", "testID", "semantics", "clip", "onVisibilityChanged",
      "onSizeChanged", "onGloballyPositioned", "clickable", "combinedClickable", "selectable", "selectableGroup",
      "toggleable", "menuAnchor", "maskClip", "imePadding",
  };
  return names;
}

float optFloat(const Json& v) {
  return v.isNumber() ? static_cast<float>(v.asNumber()) : NAN;
}

class Builder {
 public:
  Builder(Engine& engine, const ControlMetrics& metrics) : engine_(engine), metrics_(metrics) {}

  Mod size(float minW, float maxW, float minH, float maxH, bool enforce = true) {
    Mod m{Mod::Size};
    m.minW = minW;
    m.maxW = maxW;
    m.minH = minH;
    m.maxH = maxH;
    m.enforceIncoming = enforce;
    return m;
  }

  Mod padding(float s, float t, float e, float b) {
    Mod m{Mod::Padding};
    m.start = s;
    m.top = t;
    m.end = e;
    m.bottom = b;
    return m;
  }

  Mod minTouch() { return Mod{Mod::MinTouch}; }

  Mod wrapContentCenter() {
    Mod m{Mod::WrapContent};
    m.direction = Direction::Both;
    m.align = {0, 0};
    return m;
  }

  /// ModifierRegistry.applyModifiers: the layout modifiers in order, parent data by scope.
  void applyModifiers(CNode& n, const std::vector<Object>& modifiers, Scope scope) {
    for (const Object& object : modifiers) {
      const Json params(object);
      const std::string& type = params["$type"].asString();
      auto intParam = [&](const char* key, int fallback) {
        const Json& v = params[key];
        return v.isNumber() ? truncToInt(v.asNumber()) : fallback;
      };
      auto floatParam = [&](const char* key, float fallback) {
        const Json& v = params[key];
        return v.isNumber() ? static_cast<float>(v.asNumber()) : fallback;
      };
      if (type == "paddingAll") {
        float all = static_cast<float>(intParam("all", 0));
        n.mods.push_back(padding(all, all, all, all));
      } else if (type == "padding") {
        n.mods.push_back(padding(static_cast<float>(intParam("start", 0)), static_cast<float>(intParam("top", 0)),
                                 static_cast<float>(intParam("end", 0)), static_cast<float>(intParam("bottom", 0))));
      } else if (type == "size") {
        float w = static_cast<float>(intParam("width", 0));
        float h = static_cast<float>(intParam("height", 0));
        n.mods.push_back(size(w, w, h, h));
      } else if (type == "fillMaxSize" || type == "fillMaxWidth" || type == "fillMaxHeight") {
        Mod m{Mod::Fill};
        m.direction = type == "fillMaxWidth"    ? Direction::Horizontal
                      : type == "fillMaxHeight" ? Direction::Vertical
                                                : Direction::Both;
        m.fraction = floatParam("fraction", 1);
        n.mods.push_back(m);
      } else if (type == "width") {
        const std::string& s = params["width"].asString();
        if (s == "min" || s == "max") {
          Mod m{Mod::Intrinsic};
          m.direction = Direction::Horizontal;
          m.intrinsicMax = s == "max";
          n.mods.push_back(m);
        } else {
          float w = static_cast<float>(intParam("width", 0));
          n.mods.push_back(size(w, w, NAN, NAN));
        }
      } else if (type == "height") {
        float h = static_cast<float>(intParam("height", 0));
        n.mods.push_back(size(NAN, NAN, h, h));
      } else if (type == "defaultMinSize") {
        Mod m{Mod::DefaultMinSize};
        m.minW = optFloat(params["minWidth"]);
        m.minH = optFloat(params["minHeight"]);
        n.mods.push_back(m);
      } else if (type == "wrapContentWidth" || type == "wrapContentHeight") {
        Mod m{Mod::WrapContent};
        bool horizontal = type == "wrapContentWidth";
        m.direction = horizontal ? Direction::Horizontal : Direction::Vertical;
        const std::string& a = params["alignment"].asString();
        if (horizontal) {
          m.align.horizontal = alignmentHorizontal(a).value_or(0);
        } else {
          m.align.vertical = alignmentVertical(a).value_or(0);
        }
        n.mods.push_back(m);
      } else if (type == "offset") {
        Mod m{Mod::Offset};
        m.start = static_cast<float>(intParam("x", 0));
        m.top = static_cast<float>(intParam("y", 0));
        n.mods.push_back(m);
      } else if (type == "weight") {
        if (scope == Scope::Row || scope == Scope::Column) {
          if (!n.parentData.hasWeight) {
            n.parentData.hasWeight = true;
            n.parentData.weight = floatParam("weight", 1);
            n.parentData.fill = true;
          }
        } else {
          engine_.report("modifier:weight(no Row/Column scope)", n.path);
        }
      } else if (type == "align") {
        const std::string& a = params["alignment"].asString();
        bool applied = false;
        if (scope == Scope::Box) {
          if (auto v = alignment2d(a)) {
            if (!n.parentData.hasBoxData) {
              n.parentData.hasBoxData = true;
              n.parentData.boxAlign = v;
            }
            applied = true;
          }
        } else if (scope == Scope::Row) {
          if (auto v = alignmentVertical(a)) {
            if (!n.parentData.crossBias) {
              n.parentData.crossBias = v;
            }
            applied = true;
          }
        } else if (scope == Scope::Column) {
          if (auto v = alignmentHorizontal(a)) {
            if (!n.parentData.crossBias) {
              n.parentData.crossBias = v;
            }
            applied = true;
          }
        }
        if (!applied) {
          engine_.report("modifier:align(" + a + ") ignored", n.path);
        }
      } else if (type == "matchParentSize") {
        if (scope == Scope::Box) {
          if (!n.parentData.hasBoxData) {
            n.parentData.hasBoxData = true;
            n.parentData.matchParentSize = true;
          }
        } else {
          engine_.report("modifier:matchParentSize(no Box scope)", n.path);
        }
      } else if (type == "verticalScroll" || type == "horizontalScroll") {
        Mod m{Mod::Scroll};
        m.direction = type == "verticalScroll" ? Direction::Vertical : Direction::Horizontal;
        n.mods.push_back(m);
      } else if (type == "border") {
        // Drawn only.
      } else if (type == "sizeIn") {
        // Test-only extensions (compose-ref accepts them; @expo/ui does not have them).
        n.mods.push_back(size(optFloat(params["minWidth"]), optFloat(params["maxWidth"]), optFloat(params["minHeight"]),
                              optFloat(params["maxHeight"])));
      } else if (type == "requiredSize") {
        float w = floatParam("width", 0), h = floatParam("height", 0);
        n.mods.push_back(size(w, w, h, h, false));
      } else if (type == "requiredWidth") {
        float w = floatParam("width", 0);
        n.mods.push_back(size(w, w, NAN, NAN, false));
      } else if (type == "requiredHeight") {
        float h = floatParam("height", 0);
        n.mods.push_back(size(NAN, NAN, h, h, false));
      } else if (type == "aspectRatio") {
        Mod m{Mod::AspectRatio};
        m.fraction = floatParam("ratio", 1);
        m.flag = params["matchHeightConstraintsFirst"].asBool(false);
        n.mods.push_back(m);
      } else if (type == "wrapContentSize") {
        Mod m{Mod::WrapContent};
        m.direction = Direction::Both;
        m.align = alignment2d(params["alignment"].asString()).value_or(Alignment2D{0, 0});
        m.unbounded = params["unbounded"].asBool(false);
        n.mods.push_back(m);
      } else if (std::find(nonLayoutModifiers().begin(), nonLayoutModifiers().end(), type) !=
                 nonLayoutModifiers().end()) {
        if (type == "testID" && n.testID.empty()) {
          n.testID = params["testID"].asString();
        }
      } else {
        engine_.report("modifier:" + type, n.path);
      }
    }
  }

  Arrangement horizontalArrangement(const Json& props, const char* key, const std::string& path) {
    const Json& v = props[key];
    Arrangement a;
    if (v.isNull()) {
      return a;
    }
    if (v.isObject()) {
      if (v["spacedBy"].isNumber()) {
        a.kind = Arrangement::SpacedBy;
        a.space = static_cast<float>(truncToInt(v["spacedBy"].asNumber()));
      }
      return a;
    }
    const std::string& s = v.asString();
    if (s == "start") a.kind = Arrangement::Start;
    else if (s == "end") a.kind = Arrangement::End;
    else if (s == "center") a.kind = Arrangement::Center;
    else if (s == "spaceBetween") a.kind = Arrangement::SpaceBetween;
    else if (s == "spaceAround") a.kind = Arrangement::SpaceAround;
    else if (s == "spaceEvenly") a.kind = Arrangement::SpaceEvenly;
    else engine_.report(std::string("prop:") + key + "=" + v.serialize(), path);
    return a;
  }

  Arrangement verticalArrangement(const Json& props, const char* key, const std::string& path) {
    const Json& v = props[key];
    Arrangement a;
    if (v.isNull()) {
      return a;
    }
    if (v.isObject()) {
      if (v["spacedBy"].isNumber()) {
        a.kind = Arrangement::SpacedBy;
        a.space = static_cast<float>(truncToInt(v["spacedBy"].asNumber()));
      }
      return a;
    }
    const std::string& s = v.asString();
    if (s == "top") a.kind = Arrangement::Start;
    else if (s == "bottom") a.kind = Arrangement::End;
    else if (s == "center") a.kind = Arrangement::Center;
    else if (s == "spaceBetween") a.kind = Arrangement::SpaceBetween;
    else if (s == "spaceAround") a.kind = Arrangement::SpaceAround;
    else if (s == "spaceEvenly") a.kind = Arrangement::SpaceEvenly;
    else engine_.report(std::string("prop:") + key + "=" + v.serialize(), path);
    return a;
  }

  static int fontWeight(const std::string& s) {
    if (s == "bold") return 700;
    if (s == "normal") return 400;
    if (s.size() == 3 && s[1] == '0' && s[2] == '0' && s[0] >= '1' && s[0] <= '9') return (s[0] - '0') * 100;
    return 0;
  }

  /// TextView.kt TextContent: typography (or TextStyle.Default) merged with the props.
  TextStyle textStyle(const Json& props, const std::string& path) {
    TextStyle style;
    const std::string& typography = props["typography"].asString();
    if (!typography.empty()) {
      if (auto t = materialTypography(typography)) {
        style = *t;
      }
    }
    if (props["fontSize"].isNumber()) style.fontSize = static_cast<float>(props["fontSize"].asNumber());
    if (int w = fontWeight(props["fontWeight"].asString())) style.fontWeight = w;
    if (props["fontStyle"].asString() == "italic") style.italic = true;
    if (props["fontStyle"].asString() == "normal") style.italic = false;
    if (props["letterSpacing"].isNumber()) style.letterSpacing = static_cast<float>(props["letterSpacing"].asNumber());
    if (props["lineHeight"].isNumber()) style.lineHeight = static_cast<float>(props["lineHeight"].asNumber());
    const std::string& family = props["fontFamily"].asString();
    if (!family.empty() && family != "default" && family != "sansSerif") {
      if (family == "serif" || family == "monospace" || family == "cursive") {
        style.fontFamily = family;
      } else {
        engine_.report("prop:fontFamily=" + family, path);
      }
    }
    return style;
  }

  std::unique_ptr<CNode> internal(Policy policy) {
    auto n = std::make_unique<CNode>();
    n->policy = policy;
    return n;
  }

  /// Adds the children of `json` to `parent` in `scope`. Slot children are flattened (SlotView
  /// renders them in a new UIComposableScope) and the Slot becomes a virtual node.
  void addChildren(CNode& parent, const Node& json, const std::string& path, Scope scope,
                   std::vector<std::unique_ptr<CNode>>& virtuals) {
    const auto& list = json.children;
    for (size_t i = 0; i < list.size(); i++) {
      std::string childPath = path + "/" + std::to_string(i);
      const Node& child = list[i];
      if (child.type == "Slot") {
        auto slot = std::make_unique<CNode>();
        slot->type = "Slot";
        slot->path = childPath;
        slot->isVirtual = true;
        size_t before = parent.children.size();
        addChildren(parent, child, childPath, Scope::None, virtuals);
        for (size_t k = before; k < parent.children.size(); k++) {
          slot->reportedKids.push_back(parent.children[k].get());
        }
        virtuals.push_back(std::move(slot));
        continue;
      }
      if (auto node = build(child, childPath, scope, virtuals)) {
        parent.children.push_back(std::move(node));
      }
    }
  }

  std::unique_ptr<CNode> build(const Node& json, const std::string& path, Scope scope,
                              std::vector<std::unique_ptr<CNode>>& virtuals) {
    const std::string& type = json.type;
    const Json props(json.props);
    auto n = std::make_unique<CNode>();
    n->type = type;
    n->path = path;
    const ControlMetrics& m = metrics_;

    // Icon: the size modifier from `size` is outside the user modifiers.
    if (type == "Icon" && props["size"].isNumber()) {
      float s = static_cast<float>(truncToInt(props["size"].asNumber()));
      n->mods.push_back(size(s, s, s, s));
    }
    applyModifiers(*n, json.modifiers, scope);
    n->innerIndex = n->mods.size();

    if (type == "Row" || type == "Column") {
      bool row = type == "Row";
      n->policy = row ? Policy::Row : Policy::Column;
      if (row) {
        n->horizontalArrangement = horizontalArrangement(props, "horizontalArrangement", path);
        const std::string& a = props["verticalAlignment"].asString();
        if (a == "center") n->crossBias = 0;
        else if (a == "bottom") n->crossBias = 1;
        else if (a.empty() || a == "top") n->crossBias = -1;
        else engine_.report("prop:verticalAlignment=" + a, path);
      } else {
        n->verticalArrangement = verticalArrangement(props, "verticalArrangement", path);
        const std::string& a = props["horizontalAlignment"].asString();
        if (a == "center") n->crossBias = 0;
        else if (a == "end") n->crossBias = 1;
        else if (a.empty() || a == "start") n->crossBias = -1;
        else engine_.report("prop:horizontalAlignment=" + a, path);
      }
      addChildren(*n, json, path, row ? Scope::Row : Scope::Column, virtuals);
    } else if (type == "Box") {
      n->policy = Policy::Box;
      const std::string& a = props["contentAlignment"].asString();
      if (auto v = alignment2d(a)) {
        n->contentAlignment = *v;
      } else if (!a.empty()) {
        engine_.report("prop:contentAlignment=" + a, path);
      }
      n->propagateMinConstraints = props["propagateMinConstraints"].asBool(false);
      addChildren(*n, json, path, Scope::Box, virtuals);
    } else if (type == "FlowRow") {
      n->policy = Policy::FlowRow;
      n->horizontalArrangement = horizontalArrangement(props, "horizontalArrangement", path);
      n->verticalArrangement = verticalArrangement(props, "verticalArrangement", path);
      addChildren(*n, json, path, Scope::Row, virtuals);
    } else if (type == "Spacer") {
      n->policy = Policy::Spacer;
    } else if (type == "Text") {
      n->policy = Policy::Text;
      n->text = props["text"].asString();
      n->style = textStyle(props, path);
      if (props["maxLines"].isNumber()) n->maxLines = truncToInt(props["maxLines"].asNumber());
      if (props["minLines"].isNumber()) n->minLines = truncToInt(props["minLines"].asNumber());
      n->softWrap = props["softWrap"].asBool(true);
      n->ellipsis = props["overflow"].asString() == "ellipsis";
    } else if (type == "Button" || type == "FilledTonalButton" || type == "OutlinedButton" ||
               type == "ElevatedButton" || type == "TextButton") {
      // material3 Button: Surface(minimumInteractiveComponentSize) -> Box(propagateMinConstraints)
      // -> Row(defaultMinSize(MinWidth, MinHeight).padding(contentPadding), Center, CenterVertically).
      bool text = type == "TextButton";
      float ph = text ? m.textButtonPaddingHorizontal : m.buttonPaddingHorizontal;
      float pv = text ? m.textButtonPaddingVertical : m.buttonPaddingVertical;
      float ps = ph, pt = pv, pe = ph, pb = pv;
      const Json& cp = props["contentPadding"];
      if (cp.isObject()) {
        // ContentPaddingRecord.toPaddingValues(): ButtonDefaults.ContentPadding per missing edge.
        ps = cp["start"].isNumber() ? static_cast<float>(cp["start"].asNumber()) : m.buttonPaddingHorizontal;
        pt = cp["top"].isNumber() ? static_cast<float>(cp["top"].asNumber()) : m.buttonPaddingVertical;
        pe = cp["end"].isNumber() ? static_cast<float>(cp["end"].asNumber()) : m.buttonPaddingHorizontal;
        pb = cp["bottom"].isNumber() ? static_cast<float>(cp["bottom"].asNumber()) : m.buttonPaddingVertical;
      }
      n->mods.push_back(minTouch());
      n->policy = Policy::Box;
      n->propagateMinConstraints = true;
      auto row = internal(Policy::Row);
      Mod minSize{Mod::DefaultMinSize};
      minSize.minW = m.buttonMinWidth;
      minSize.minH = m.buttonMinHeight;
      row->mods.push_back(minSize);
      row->mods.push_back(padding(ps, pt, pe, pb));
      row->innerIndex = row->mods.size();
      row->horizontalArrangement.kind = Arrangement::Center;
      row->crossBias = 0;
      addChildren(*row, json, path, Scope::Row, virtuals);
      row->coords.resize(row->mods.size() + 1);
      n->children.push_back(std::move(row));
    } else if (type == "Switch") {
      // material3 Switch: minimumInteractiveComponentSize (onCheckedChange is always set by
      // SwitchView.kt), wrapContentSize(Center), requiredSize(SwitchWidth, SwitchHeight).
      n->mods.push_back(minTouch());
      n->mods.push_back(wrapContentCenter());
      n->mods.push_back(size(m.switchWidth, m.switchWidth, m.switchHeight, m.switchHeight, false));
      n->policy = Policy::EmptyBox;
    } else if (type == "Checkbox") {
      // material3 Checkbox: minimumInteractiveComponentSize only when clickable,
      // padding(CheckboxDefaultPadding), wrapContentSize(Center), requiredSize(CheckboxSize).
      if (props["nativeClickable"].asBool(true)) {
        n->mods.push_back(minTouch());
      }
      n->mods.push_back(padding(m.checkboxPadding, m.checkboxPadding, m.checkboxPadding, m.checkboxPadding));
      n->mods.push_back(wrapContentCenter());
      n->mods.push_back(size(m.checkboxSize, m.checkboxSize, m.checkboxSize, m.checkboxSize, false));
      n->policy = Policy::EmptyBox;
    } else if (type == "Slider") {
      // material3 Slider: minimumInteractiveComponentSize, requiredSizeIn(ThumbWidth, ThumbHeight).
      n->mods.push_back(minTouch());
      n->mods.push_back(size(m.sliderThumbWidth, NAN, m.sliderThumbHeight, NAN, false));
      n->policy = Policy::Slider;
    } else if (type == "TextField") {
      n->outlined = props["variant"].asString() == "outlined";
      bool hasLabel = false;
      for (const Node& child : json.children) {
        hasLabel = hasLabel || (child.type == "Slot" && Json(child.props)["name"].asString() == "label");
      }
      if (n->outlined && hasLabel) {
        // OutlinedTextField: padding(top = OutlinedTextFieldTopPadding) when there is a label.
        n->mods.push_back(padding(0, m.outlinedTextFieldTopPadding, 0, 0));
      }
      Mod minSize{Mod::DefaultMinSize};
      minSize.minW = m.textFieldMinWidth;
      minSize.minH = m.textFieldMinHeight;
      n->mods.push_back(minSize);
      n->policy = Policy::TextField;
      n->text = props["value"].asString();
      n->hasValue = !n->text.empty();
      n->singleLine = props["singleLine"].asBool(false);
      // The decoration boxes (TextFieldLayout): label, placeholder and input.
      float sidePadding = m.textFieldPaddingHorizontal;
      auto textPadding = [&](CNode& box) {
        box.mods.push_back(size(NAN, NAN, 24, NAN));  // heightIn(min = MinTextLineHeight)
        Mod wrap{Mod::WrapContent};
        wrap.direction = Direction::Vertical;
        box.mods.push_back(wrap);
        box.mods.push_back(padding(sidePadding, 0, sidePadding, 0));
      };
      CNode* labelBox = nullptr;
      CNode* placeholderBox = nullptr;
      const auto& list = json.children;
      for (size_t i = 0; i < list.size(); i++) {
        const Node& child = list[i];
        if (child.type != "Slot") {
          continue;
        }
        const std::string name = Json(child.props)["name"].asString();
        std::string childPath = path + "/" + std::to_string(i);
        auto slot = std::make_unique<CNode>();
        slot->type = "Slot";
        slot->path = childPath;
        slot->isVirtual = true;
        auto box = internal(Policy::Box);
        if (name == "label") {
          Mod minHeight{Mod::LabelMinHeight};
          minHeight.minH = n->hasValue ? 16 : 24;  // lerp(MinTextLineHeight, MinFocusedLabelLineHeight)
          box->mods.push_back(minHeight);
          Mod wrap{Mod::WrapContent};
          wrap.direction = Direction::Vertical;
          box->mods.push_back(wrap);
          if (!n->outlined) {
            box->mods.push_back(padding(sidePadding, 0, sidePadding, 0));
          }
        } else if (name == "placeholder") {
          textPadding(*box);
        } else {
          engine_.report("prop:TextField slot " + name, childPath);
        }
        addChildren(*box, child, childPath, Scope::None, virtuals);
        for (auto& k : box->children) {
          slot->reportedKids.push_back(k.get());
        }
        box->innerIndex = box->mods.size();
        box->coords.resize(box->mods.size() + 1);
        if (name == "label" && !labelBox) {
          labelBox = box.get();
          n->children.push_back(std::move(box));
        } else if (name == "placeholder" && !placeholderBox) {
          placeholderBox = box.get();
          n->children.push_back(std::move(box));
        }
        virtuals.push_back(std::move(slot));
      }
      n->labelSlot = labelBox;
      // The placeholder shows when the value is empty and the label (if any) floats; unfocused,
      // that is only without a label.
      n->placeholderSlot = !n->hasValue && !labelBox ? placeholderBox : nullptr;
      // Input: Box(propagateMinConstraints) around the core text field (TextStyle.Default).
      auto box = internal(Policy::Box);
      box->propagateMinConstraints = true;
      textPadding(*box);
      box->innerIndex = box->mods.size();
      box->coords.resize(box->mods.size() + 1);
      auto core = internal(Policy::Text);
      core->text = n->text;
      core->softWrap = !n->singleLine;
      core->maxLines = n->singleLine ? 1 : (props["maxLines"].isNumber() ? truncToInt(props["maxLines"].asNumber()) : INT_MAX);
      core->minLines = props["minLines"].isNumber() ? truncToInt(props["minLines"].asNumber()) : 1;
      if (n->singleLine) {
        // Single-line text scrolls horizontally (textFieldScroll).
        Mod scroll{Mod::Scroll};
        scroll.direction = Direction::Horizontal;
        core->mods.push_back(scroll);
      }
      core->innerIndex = core->mods.size();
      core->coords.resize(core->mods.size() + 1);
      n->textBox = box.get();
      box->children.push_back(std::move(core));
      n->children.push_back(std::move(box));
    } else if (type == "Icon") {
      // material3 Icon with a painter of unspecified size: DefaultIconSizeModifier.
      n->mods.push_back(size(m.iconSize, m.iconSize, m.iconSize, m.iconSize));
      n->policy = Policy::EmptyBox;
    } else {
      engine_.report("type:" + type, path);
      return nullptr;
    }
    n->coords.resize(n->mods.size() + 1);
    return n;
  }

 private:
  Engine& engine_;
  const ControlMetrics& metrics_;
};

void collect(CNode& n, std::map<std::string, CNode*>& byPath) {
  if (!n.path.empty()) {
    byPath[n.path] = &n;
  }
  for (auto& c : n.children) {
    collect(*c, byPath);
  }
}

bool pathLess(const std::string& a, const std::string& b) {
  // Compare "0/10" after "0/9": numeric per segment.
  size_t i = 0, j = 0;
  while (i < a.size() && j < b.size()) {
    size_t ie = a.find('/', i), je = b.find('/', j);
    if (ie == std::string::npos) ie = a.size();
    if (je == std::string::npos) je = b.size();
    long x = std::stol(a.substr(i, ie - i)), y = std::stol(b.substr(j, je - j));
    if (x != y) return x < y;
    i = ie + 1;
    j = je + 1;
  }
  return a.size() < b.size();
}

}  // namespace

std::optional<TextStyle> materialTypography(const std::string& name) {
  struct Entry {
    float size, lineHeight, tracking;
    int weight;
  };
  // material3 TypeScaleTokens (CMP material3 1.10.0-alpha05 sources).
  static const std::map<std::string, Entry> table = {
      {"displayLarge", {57, 64, -0.2f, 400}}, {"displayMedium", {45, 52, 0, 400}},
      {"displaySmall", {36, 44, 0, 400}},      {"headlineLarge", {32, 40, 0, 400}},
      {"headlineMedium", {28, 36, 0, 400}},    {"headlineSmall", {24, 32, 0, 400}},
      {"titleLarge", {22, 28, 0, 400}},        {"titleMedium", {16, 24, 0.2f, 500}},
      {"titleSmall", {14, 20, 0.1f, 500}},     {"bodyLarge", {16, 24, 0.5f, 400}},
      {"bodyMedium", {14, 20, 0.2f, 400}},    {"bodySmall", {12, 16, 0.4f, 400}},
      {"labelLarge", {14, 20, 0.1f, 500}},     {"labelMedium", {12, 16, 0.5f, 500}},
      {"labelSmall", {11, 16, 0.5f, 500}},
  };
  auto it = table.find(name);
  if (it == table.end()) {
    return std::nullopt;
  }
  TextStyle s;
  s.trimLineHeight = false;  // DefaultLineHeightStyle: Alignment.Center, Trim.None
  s.fontSize = it->second.size;
  s.lineHeight = it->second.lineHeight;
  s.letterSpacing = it->second.tracking;
  s.fontWeight = it->second.weight;
  return s;
}

LayoutResult layout(const HostSpec& host, const Node& rootNode, TextMeasurer& text, const ControlMetrics& metrics) {
  Engine engine(text, metrics);
  Builder builder(engine, metrics);
  bool matchW = host.matchContentsHorizontal;
  bool matchH = host.matchContentsVertical;
  engine.rtl = host.rightToLeft;

  // HostView.kt MaybeMatchContentsLayout, with wrapContentWidth/Height on the matchContents axes.
  std::vector<std::unique_ptr<CNode>> virtuals;
  CNode root;
  root.policy = Policy::Host;
  if (matchW) {
    Mod m{Mod::WrapContent};
    m.direction = Direction::Horizontal;
    root.mods.push_back(m);
  }
  if (matchH) {
    Mod m{Mod::WrapContent};
    m.direction = Direction::Vertical;
    root.mods.push_back(m);
  }
  root.coords.resize(root.mods.size() + 1);
  if (auto node = builder.build(rootNode, "0", Scope::None, virtuals)) {
    root.children.push_back(std::move(node));
  }

  // The ComposeView: fixed constraints on the normal axes, 0..Infinity on matchContents axes.
  // React Native converts the Host's Yoga size with PixelUtil.toPixelFromDIP + rounding.
  float d = metrics.density;
  int widthPx = roundToInt(static_cast<float>(host.width) * d);
  int heightPx = roundToInt(static_cast<float>(host.height) * d);
  Constraints c{matchW ? 0 : widthPx, matchW ? kInfinity : widthPx, matchH ? 0 : heightPx,
                matchH ? kInfinity : heightPx};
  Placeable content = engine.measure(root, c);
  engine.place(root, 0, 0);

  LayoutResult result;
  result.host.width = matchW ? content.width / static_cast<double>(d) : host.width;
  result.host.height = matchH ? content.height / static_cast<double>(d) : host.height;
  result.unsupported = engine.unsupported;

  auto dp = [&](int x, int y, int w, int h) {
    return layout::Rect{x / static_cast<double>(d), y / static_cast<double>(d), w / static_cast<double>(d),
                        h / static_cast<double>(d)};
  };
  std::map<std::string, CNode*> byPath;
  for (auto& c2 : root.children) {
    collect(*c2, byPath);
  }
  for (auto& v : virtuals) {
    byPath[v->path] = v.get();
  }
  std::vector<std::string> paths;
  for (auto& [p, _] : byPath) {
    paths.push_back(p);
  }
  std::sort(paths.begin(), paths.end(), pathLess);
  for (const auto& p : paths) {
    CNode& n = *byPath[p];
    layout::NodeLayout f;
    f.path = n.path;
    f.type = n.type;
    if (n.type == "Text") {
      f.text = n.text;
    }
    if (n.isVirtual) {
      f.isVirtual = true;
      bool any = false;
      int x0 = 0, y0 = 0, x1 = 0, y1 = 0;
      for (CNode* kid : n.reportedKids) {
        if (!kid->laidOut) {
          continue;
        }
        int kx = kid->positions[0].first, ky = kid->positions[0].second;
        int kw = kid->coords[0].measuredWidth, kh = kid->coords[0].measuredHeight;
        if (!any) {
          x0 = kx, y0 = ky, x1 = kx + kw, y1 = ky + kh;
          any = true;
        } else {
          x0 = std::min(x0, kx), y0 = std::min(y0, ky), x1 = std::max(x1, kx + kw), y1 = std::max(y1, ky + kh);
        }
      }
      if (any) {
        f.frame = dp(x0, y0, x1 - x0, y1 - y0);
      }
      result.nodes.push_back(f);
      continue;
    }
    if (!n.laidOut) {
      continue;
    }
    const Coord& outer = n.coords[0];
    f.frame = dp(n.positions[0].first, n.positions[0].second, outer.measuredWidth, outer.measuredHeight);
    size_t k = n.innerIndex;
    const Coord& inner = n.coords[k];
    if (n.positions[k] != n.positions[0] || inner.measuredWidth != outer.measuredWidth ||
        inner.measuredHeight != outer.measuredHeight) {
      f.contentFrame = dp(n.positions[k].first, n.positions[k].second, inner.measuredWidth, inner.measuredHeight);
    }
    result.nodes.push_back(f);
  }
  return result;
}

}  // namespace expoui::compose
