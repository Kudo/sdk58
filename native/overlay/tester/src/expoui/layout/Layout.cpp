// SwiftUI layout for @expo/ui trees. See Layout.h.
//
// The algorithms follow the SwiftUI layout protocol as observed with native/tools/swiftui-ref:
// - A parent proposes a size (each axis: a length, infinity, or nil = "your ideal size"); the child
//   answers with its size; the parent places the child in its own coordinate space.
// - HStack/VStack: the children are sized in priority groups (highest `layoutPriority` first); in
//   a group, the least flexible child (flexibility = size at an infinite proposal minus size at a
//   zero proposal) goes first and gets `remaining / children left`, where `remaining` excludes the
//   minimum sizes of the lower-priority children.
// - Default spacing comes from the neighbors' spacing preferences (see `ViewSpacing`).
// - `frame(width:height:)` proposes the given lengths and takes them as its size; the flexible
//   `frame(min...max)` clamps the proposal for the child and then clamps the child's size towards
//   the proposal: `max(min, min(child, proposal))`, then `min(max, max(child, proposal))`.
//
// Each node is recorded twice, like swiftui-ref does: `contentFrame` = the component before its
// modifiers, `frame` = after them. Offsets move what is drawn inside them (content and
// descendants) but not the node's own `frame`.

#include "Layout.h"
#include "Symbols.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <numeric>

namespace expoui::layout {

namespace {

constexpr double kInf = std::numeric_limits<double>::infinity();
using OptD = std::optional<double>;

struct Proposal {
  OptD width;
  OptD height;

  bool operator==(const Proposal& other) const { return width == other.width && height == other.height; }
};

enum class Axis { none, horizontal, vertical };

double ceilTo(double value, double scale) {
  return std::ceil(value * scale - 1e-9) / scale;
}

// ---------------------------------------------------------------------------------------------
// Spacing preferences

enum class Cat { none, text, control, image };

/// One edge's spacing preference: its category and the distance it wants from a neighbor of each
/// category. The distance between two views is the larger of the two edges' wishes.
struct Edge {
  Cat cat = Cat::control;
  double vsText = 0;
  double vsControl = 0;
  double vsImage = 0;

  double value(Cat other) const {
    switch (other) {
      case Cat::text: return vsText;
      case Cat::control: return vsControl;
      case Cat::image: return vsImage;
      case Cat::none: return 0;
    }
    return 0;
  }
};

struct ViewSpacing {
  Edge top, bottom, leading, trailing;
};

double distance(const Edge& before, const Edge& after) {
  if (before.cat == Cat::none || after.cat == Cat::none) {
    return 0;
  }
  return std::max(before.value(after.cat), after.value(before.cat));
}

Edge mergeEdges(const std::vector<Edge>& edges) {
  Edge out;
  out.cat = Cat::none;
  bool any = false;
  for (const auto& e : edges) {
    if (e.cat == Cat::none) {
      continue;
    }
    if (!any) {
      out = e;
      any = true;
      continue;
    }
    if (e.cat == Cat::control || (e.cat == Cat::text && out.cat == Cat::image)) {
      out.cat = e.cat;
    }
    out.vsText = std::max(out.vsText, e.vsText);
    out.vsControl = std::max(out.vsControl, e.vsControl);
    out.vsImage = std::max(out.vsImage, e.vsImage);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Alignment

enum class HAlign { leading, center, trailing };
enum class VAlign { top, center, bottom, firstBaseline, lastBaseline };

struct Alignment2D {
  HAlign h = HAlign::center;
  VAlign v = VAlign::center;
};

HAlign parseHAlign(const std::string& s, HAlign fallback) {
  if (s == "leading") return HAlign::leading;
  if (s == "trailing") return HAlign::trailing;
  if (s == "center") return HAlign::center;
  return fallback;
}

VAlign parseVAlign(const std::string& s, VAlign fallback) {
  if (s == "top") return VAlign::top;
  if (s == "bottom") return VAlign::bottom;
  if (s == "center") return VAlign::center;
  if (s == "firstTextBaseline") return VAlign::firstBaseline;
  if (s == "lastTextBaseline") return VAlign::lastBaseline;
  return fallback;
}

/// AlignmentOptions.swift names.
std::optional<Alignment2D> parseAlignment(const std::string& s) {
  static const std::map<std::string, Alignment2D> table = {
      {"center", {HAlign::center, VAlign::center}},
      {"leading", {HAlign::leading, VAlign::center}},
      {"trailing", {HAlign::trailing, VAlign::center}},
      {"top", {HAlign::center, VAlign::top}},
      {"bottom", {HAlign::center, VAlign::bottom}},
      {"topLeading", {HAlign::leading, VAlign::top}},
      {"topTrailing", {HAlign::trailing, VAlign::top}},
      {"bottomLeading", {HAlign::leading, VAlign::bottom}},
      {"bottomTrailing", {HAlign::trailing, VAlign::bottom}},
      {"centerFirstTextBaseline", {HAlign::center, VAlign::firstBaseline}},
      {"centerLastTextBaseline", {HAlign::center, VAlign::lastBaseline}},
      {"leadingFirstTextBaseline", {HAlign::leading, VAlign::firstBaseline}},
      {"leadingLastTextBaseline", {HAlign::leading, VAlign::lastBaseline}},
      {"trailingFirstTextBaseline", {HAlign::trailing, VAlign::firstBaseline}},
      {"trailingLastTextBaseline", {HAlign::trailing, VAlign::lastBaseline}},
  };
  auto it = table.find(s);
  if (it == table.end()) {
    return std::nullopt;
  }
  return it->second;
}

double alignFactor(HAlign a) {
  return a == HAlign::leading ? 0 : a == HAlign::trailing ? 1 : 0.5;
}

double alignFactor(VAlign a) {
  switch (a) {
    case VAlign::top: return 0;
    case VAlign::bottom:
    case VAlign::firstBaseline: // baselines are treated as bottom (not measured yet)
    case VAlign::lastBaseline: return 1;
    case VAlign::center: return 0.5;
  }
  return 0.5;
}

// ---------------------------------------------------------------------------------------------
// Frame store

struct Store {
  std::map<std::string, NodeLayout> nodes;
  std::map<std::string, Rect> frames;
  std::map<std::string, Rect> contentFrames;
  std::map<std::string, std::vector<std::string>> unsupported;

  NodeLayout& registerNode(const std::string& path, const std::string& type) {
    auto& node = nodes[path];
    node.path = path;
    node.type = type;
    return node;
  }

  void noteUnsupported(const std::string& key, const std::string& path) {
    auto& paths = unsupported[key];
    if (std::find(paths.begin(), paths.end(), path) == paths.end()) {
      paths.push_back(path);
    }
  }
};

struct Context {
  TextMeasurer& measurer;
  const ControlMetrics& m;
  Store& store;
};

/// Environment values the engine needs while building views.
struct Env {
  FontSpec font;
  Axis axis = Axis::none; // the enclosing stack's axis (Spacer and Divider direction)
  bool fontExplicit = false; // a `font` modifier is set above
  int lineLimit = 0; // lineLimit(n) / lineLimit(min...max).max; 0 = none
  int minLines = 0; // lineLimit(n, reservesSpace: true) / lineLimit(min...max).min
  std::string truncationMode = "tail";
  std::string buttonStyle = "automatic";
  const SectionListMetrics* row = nullptr; // set for the content of a List / Form row
  bool nestedInRow = false; // inside a container in a row, where row styling does not apply
};

// ---------------------------------------------------------------------------------------------
// Views

class View {
 public:
  virtual ~View() = default;

  Size size(const Proposal& p) {
    for (const auto& [proposal, size] : cache_) {
      if (proposal == p) {
        return size;
      }
    }
    Size s = compute(p);
    cache_.emplace_back(p, s);
    return s;
  }

  /// Places the view in `rect` (Host coordinates). `p` is the proposal the parent used to get the
  /// view's size; (tx, ty) is the offset applied by `offset` modifiers around it.
  virtual void place(const Rect& rect, const Proposal& p, double tx, double ty) = 0;
  virtual ViewSpacing spacing() const = 0;
  virtual double priority() const { return 0; }
  virtual bool isSpacer() const { return false; }
  /// First and last text baselines from the top, at the size for `p`. Views without text use
  /// their bottom edge.
  virtual std::pair<double, double> baselines(const Proposal& p) {
    double h = size(p).height;
    return {h, h};
  }
  /// An explicit horizontal alignment guide set with `alignmentGuide` (x from the view's leading
  /// edge), or nullopt for the default (0, width / 2, width).
  virtual std::optional<double> explicitGuide(HAlign, const Proposal&) { return std::nullopt; }

 protected:
  virtual Size compute(const Proposal& p) = 0;

 private:
  std::vector<std::pair<Proposal, Size>> cache_;
};

using ViewPtr = std::shared_ptr<View>;

ViewSpacing controlSpacing(const ControlMetrics& m) {
  ViewSpacing s;
  s.top = s.bottom = Edge{Cat::control, 0, m.controlSpacing, 0};
  s.leading = s.trailing = Edge{Cat::control, m.horizontalSpacing, m.horizontalSpacing, m.horizontalSpacing};
  return s;
}

/// A leaf whose size is a function of the proposal (controls, symbols).
class LeafView : public View {
 public:
  LeafView(std::function<Size(const Proposal&)> fn, ViewSpacing spacing) : fn_(std::move(fn)), spacing_(spacing) {}
  void place(const Rect&, const Proposal&, double, double) override {}
  ViewSpacing spacing() const override { return spacing_; }

 protected:
  Size compute(const Proposal& p) override { return fn_(p); }

 private:
  std::function<Size(const Proposal&)> fn_;
  ViewSpacing spacing_;
};

class TextView : public View {
 public:
  TextView(Context& ctx, std::string text, FontSpec font, int lineLimit = 0, int minLines = 0,
           std::string truncationMode = "tail")
      : ctx_(ctx),
        text_(std::move(text)),
        font_(std::move(font)),
        lineLimit_(lineLimit),
        minLines_(minLines),
        truncationMode_(std::move(truncationMode)) {}

  void place(const Rect&, const Proposal&, double, double) override {}

  ViewSpacing spacing() const override {
    const auto& m = ctx_.m;
    TextSpacing ts;
    if (!font_.textStyle.empty()) {
      ts = m.style(font_.textStyle).spacing;
    } else {
      // Explicit sizes: the default text's values scaled by size; no text-to-text spacing.
      const auto& base = m.style(m.defaultTextStyle);
      double k = font_.pointSize / base.pointSize;
      ts.topVsControl = base.spacing.topVsControl * k;
      ts.bottomVsControl = base.spacing.bottomVsControl * k;
      ts.topVsText = 0;
    }
    ViewSpacing s;
    s.top = Edge{Cat::text, ts.topVsText, ts.topVsControl, 0};
    s.bottom = Edge{Cat::text, 0, ts.bottomVsControl, 0};
    s.leading = s.trailing = Edge{Cat::text, m.horizontalSpacing, m.horizontalSpacing, m.horizontalSpacing};
    return s;
  }

  /// First baseline = the ascender rounded to pixels (observed on macOS: Texts of different
  /// styles align to whole points); the last line's baseline sits as far below its line top.
  std::pair<double, double> baselines(const Proposal& p) override {
    Size s = size(p);
    double scale = ctx_.m.pixelScale;
    double ascender = font_.ascender > 0 ? font_.ascender : ctx_.measurer.measureText("A", font_, kInf, 0).firstBaseline;
    double ascent = std::round(ascender * scale) / scale;
    return {ascent, s.height - singleLine() + ascent};
  }

 protected:
  Size compute(const Proposal& p) override {
    double maxWidth = p.width.value_or(kInf);
    int maxLines = lineLimit_;
    if (p.height && std::isfinite(*p.height)) {
      int fit = std::max(1, static_cast<int>(std::floor(*p.height / singleLine() + 1e-9)));
      maxLines = maxLines > 0 ? std::min(maxLines, fit) : fit;
    }
    auto m = ctx_.measurer.measureTextTruncated(text_, font_, maxWidth, maxLines, truncationMode_);
    if (minLines_ > m.lines) {
      // lineLimit(n, reservesSpace: true) / lineLimit(min...max): the height of at least n lines.
      if (!(ctx_.m.textHeightFromMetrics && font_.lineHeight > 0)) {
        m.height += (minLines_ - m.lines) * singleLine();
      }
      m.lines = minLines_;
    }
    double scale = ctx_.m.pixelScale;
    double width = ceilTo(m.width, scale);
    if (std::isfinite(maxWidth)) {
      width = std::min(width, maxWidth);
    }
    double height = m.height;
    if (ctx_.m.textHeightFromMetrics && font_.lineHeight > 0) {
      height = m.lines * font_.lineHeight + (m.lines - 1) * font_.leading;
    }
    return {width, ceilTo(height, scale)};
  }

  /// Height of one line, rounded up to pixels.
  double singleLine() const {
    if (ctx_.m.textHeightFromMetrics && font_.lineHeight > 0) {
      return ceilTo(font_.lineHeight, ctx_.m.pixelScale);
    }
    return ctx_.measurer.lineHeight(font_);
  }

 private:
  Context& ctx_;
  std::string text_;
  FontSpec font_;
  int lineLimit_;
  int minLines_;
  std::string truncationMode_;
};

class SpacerView : public View {
 public:
  SpacerView(Axis axis, double minLength) : axis_(axis), minLength_(minLength) {}
  void place(const Rect&, const Proposal&, double, double) override {}
  ViewSpacing spacing() const override {
    ViewSpacing s;
    s.top = s.bottom = s.leading = s.trailing = Edge{Cat::none};
    return s;
  }
  bool isSpacer() const override { return true; }

 protected:
  Size compute(const Proposal& p) override {
    auto along = [&](OptD len) { return len ? std::max(minLength_, *len) : minLength_; };
    switch (axis_) {
      case Axis::horizontal: return {along(p.width), 0};
      case Axis::vertical: return {0, along(p.height)};
      case Axis::none: return {along(p.width), along(p.height)};
    }
    return {};
  }

 private:
  Axis axis_;
  double minLength_;
};

/// Base of the modifier views: one child, spacing and priority pass through.
class WrapperView : public View {
 public:
  explicit WrapperView(ViewPtr child) : child_(std::move(child)) {}
  ViewSpacing spacing() const override { return child_->spacing(); }
  double priority() const override { return child_->priority(); }
  bool isSpacer() const override { return child_->isSpacer(); }
  void place(const Rect& rect, const Proposal& p, double tx, double ty) override { child_->place(rect, p, tx, ty); }
  std::pair<double, double> baselines(const Proposal& p) override { return child_->baselines(p); }
  std::optional<double> explicitGuide(HAlign a, const Proposal& p) override { return child_->explicitGuide(a, p); }

 protected:
  Size compute(const Proposal& p) override { return child_->size(p); }
  ViewPtr child_;
};

/// Records the frame of the view it wraps.
class RecordView : public WrapperView {
 public:
  RecordView(ViewPtr child, Store& store, std::string path, bool content)
      : WrapperView(std::move(child)), store_(store), path_(std::move(path)), content_(content) {}

  void place(const Rect& rect, const Proposal& p, double tx, double ty) override {
    Rect r{rect.x + tx, rect.y + ty, rect.width, rect.height};
    (content_ ? store_.contentFrames : store_.frames)[path_] = r;
    child_->place(rect, p, tx, ty);
  }

 private:
  Store& store_;
  std::string path_;
  bool content_;
};

class OffsetView : public WrapperView {
 public:
  OffsetView(ViewPtr child, double dx, double dy) : WrapperView(std::move(child)), dx_(dx), dy_(dy) {}
  void place(const Rect& rect, const Proposal& p, double tx, double ty) override {
    child_->place(rect, p, tx + dx_, ty + dy_);
  }

 private:
  double dx_, dy_;
};

class PriorityView : public WrapperView {
 public:
  PriorityView(ViewPtr child, double priority) : WrapperView(std::move(child)), priority_(priority) {}
  double priority() const override { return priority_; }

 private:
  double priority_;
};

/// `alignmentGuide(guide, value)`: the view's `guide` alignment is at x = value.
class AlignmentGuideView : public WrapperView {
 public:
  AlignmentGuideView(ViewPtr child, HAlign guide, double value) : WrapperView(std::move(child)), guide_(guide), value_(value) {}
  std::optional<double> explicitGuide(HAlign a, const Proposal& p) override {
    return a == guide_ ? std::optional<double>(value_) : child_->explicitGuide(a, p);
  }

 private:
  HAlign guide_;
  double value_;
};

/// `frame` and other views that replace the child's spacing preferences with the control ones.
class SpacingOverrideView : public WrapperView {
 public:
  SpacingOverrideView(ViewPtr child, ViewSpacing spacing) : WrapperView(std::move(child)), spacing_(spacing) {}
  ViewSpacing spacing() const override { return spacing_; }

 private:
  ViewSpacing spacing_;
};

void placeAligned(View& child, const Rect& bounds, Size size, const Proposal& p, Alignment2D a, double tx, double ty) {
  Rect r{bounds.x + (bounds.width - size.width) * alignFactor(a.h),
         bounds.y + (bounds.height - size.height) * alignFactor(a.v), size.width, size.height};
  child.place(r, p, tx, ty);
}

/// Baselines of a child placed with `alignment` inside a parent of height `parentHeight`.
std::pair<double, double> shiftedBaselines(View& child, const Proposal& q, double parentHeight, VAlign v) {
  Size s = child.size(q);
  double dy = (parentHeight - s.height) * alignFactor(v);
  auto b = child.baselines(q);
  return {b.first + dy, b.second + dy};
}

class PaddingView : public WrapperView {
 public:
  PaddingView(ViewPtr child, double top, double leading, double bottom, double trailing)
      : WrapperView(std::move(child)), top_(top), leading_(leading), bottom_(bottom), trailing_(trailing) {}

  void place(const Rect& rect, const Proposal& p, double tx, double ty) override {
    Proposal q = inner(p);
    Size s = child_->size(q);
    Rect r{rect.x + leading_, rect.y + top_, std::max(0.0, rect.width - leading_ - trailing_),
           std::max(0.0, rect.height - top_ - bottom_)};
    placeAligned(*child_, r, s, q, {HAlign::center, VAlign::center}, tx, ty);
  }

  std::pair<double, double> baselines(const Proposal& p) override {
    auto b = child_->baselines(inner(p));
    return {b.first + top_, b.second + top_};
  }

  std::optional<double> explicitGuide(HAlign a, const Proposal& p) override {
    auto g = child_->explicitGuide(a, inner(p));
    return g ? std::optional<double>(*g + leading_) : std::nullopt;
  }

 protected:
  Size compute(const Proposal& p) override {
    Size s = child_->size(inner(p));
    return {s.width + leading_ + trailing_, s.height + top_ + bottom_};
  }

 private:
  Proposal inner(const Proposal& p) const {
    Proposal q;
    if (p.width) q.width = std::max(0.0, *p.width - leading_ - trailing_);
    if (p.height) q.height = std::max(0.0, *p.height - top_ - bottom_);
    return q;
  }
  double top_, leading_, bottom_, trailing_;
};

class FixedFrameView : public WrapperView {
 public:
  FixedFrameView(ViewPtr child, OptD width, OptD height, Alignment2D alignment)
      : WrapperView(std::move(child)), width_(width), height_(height), alignment_(alignment) {}

  void place(const Rect& rect, const Proposal& p, double tx, double ty) override {
    Proposal q = inner(p);
    placeAligned(*child_, rect, child_->size(q), q, alignment_, tx, ty);
  }

  std::pair<double, double> baselines(const Proposal& p) override {
    return shiftedBaselines(*child_, inner(p), size(p).height, alignment_.v);
  }

  std::optional<double> explicitGuide(HAlign a, const Proposal& p) override {
    Proposal q = inner(p);
    auto g = child_->explicitGuide(a, q);
    if (!g) {
      return std::nullopt;
    }
    return *g + (size(p).width - child_->size(q).width) * alignFactor(alignment_.h);
  }

 protected:
  Size compute(const Proposal& p) override {
    Size s = child_->size(inner(p));
    return {width_.value_or(s.width), height_.value_or(s.height)};
  }

 private:
  Proposal inner(const Proposal& p) const { return {width_ ? width_ : p.width, height_ ? height_ : p.height}; }
  OptD width_, height_;
  Alignment2D alignment_;
};

class FlexFrameView : public WrapperView {
 public:
  struct Axis1 {
    OptD min, ideal, max;
  };

  FlexFrameView(ViewPtr child, Axis1 w, Axis1 h, Alignment2D alignment)
      : WrapperView(std::move(child)), w_(w), h_(h), alignment_(alignment) {}

  void place(const Rect& rect, const Proposal& p, double tx, double ty) override {
    Proposal q = inner(p);
    placeAligned(*child_, rect, child_->size(q), q, alignment_, tx, ty);
  }

  std::pair<double, double> baselines(const Proposal& p) override {
    return shiftedBaselines(*child_, inner(p), size(p).height, alignment_.v);
  }

  std::optional<double> explicitGuide(HAlign a, const Proposal& p) override {
    Proposal q = inner(p);
    auto g = child_->explicitGuide(a, q);
    if (!g) {
      return std::nullopt;
    }
    return *g + (size(p).width - child_->size(q).width) * alignFactor(alignment_.h);
  }

 protected:
  Size compute(const Proposal& p) override {
    Size s = child_->size(inner(p));
    return {resolve(w_, p.width, s.width), resolve(h_, p.height, s.height)};
  }

 private:
  static OptD innerAxis(const Axis1& a, OptD proposal) {
    if (!proposal) {
      return a.ideal;
    }
    double v = *proposal;
    if (a.min) v = std::max(v, *a.min);
    if (a.max) v = std::min(v, *a.max);
    return v;
  }

  static double resolve(const Axis1& a, OptD proposal, double child) {
    if (!proposal) {
      double v = a.ideal.value_or(child);
      if (a.min) v = std::max(v, *a.min);
      if (a.max) v = std::min(v, *a.max);
      return v;
    }
    double v = child;
    if (a.min) v = std::max(*a.min, std::min(v, *proposal));
    if (a.max) v = std::min(*a.max, std::max(v, *proposal));
    return v;
  }

  Proposal inner(const Proposal& p) const { return {innerAxis(w_, p.width), innerAxis(h_, p.height)}; }

  Axis1 w_, h_;
  Alignment2D alignment_;
};

class FixedSizeView : public WrapperView {
 public:
  FixedSizeView(ViewPtr child, bool horizontal, bool vertical)
      : WrapperView(std::move(child)), horizontal_(horizontal), vertical_(vertical) {}

  void place(const Rect& rect, const Proposal& p, double tx, double ty) override {
    Proposal q = inner(p);
    placeAligned(*child_, rect, child_->size(q), q, {HAlign::center, VAlign::center}, tx, ty);
  }

  std::pair<double, double> baselines(const Proposal& p) override { return child_->baselines(inner(p)); }

 protected:
  Size compute(const Proposal& p) override { return child_->size(inner(p)); }

 private:
  Proposal inner(const Proposal& p) const {
    return {horizontal_ ? OptD() : p.width, vertical_ ? OptD() : p.height};
  }
  bool horizontal_, vertical_;
};

// ---- Stacks

class StackView : public View {
 public:
  StackView(Context& ctx, Axis axis, std::vector<ViewPtr> children, OptD spacing, HAlign hAlign, VAlign vAlign)
      : ctx_(ctx), axis_(axis), children_(std::move(children)), spacing_(spacing), hAlign_(hAlign), vAlign_(vAlign) {
    for (size_t i = 1; i < children_.size(); i++) {
      if (spacing_) {
        gaps_.push_back(*spacing_);
        continue;
      }
      auto a = children_[i - 1]->spacing();
      auto b = children_[i]->spacing();
      gaps_.push_back(axis_ == Axis::vertical ? distance(a.bottom, b.top) : distance(a.trailing, b.leading));
    }
  }

  ViewSpacing spacing() const override {
    if (children_.empty()) {
      return controlSpacing(ctx_.m);
    }
    ViewSpacing s;
    std::vector<Edge> tops, bottoms, leadings, trailings;
    for (const auto& c : children_) {
      auto cs = c->spacing();
      tops.push_back(cs.top);
      bottoms.push_back(cs.bottom);
      leadings.push_back(cs.leading);
      trailings.push_back(cs.trailing);
    }
    if (axis_ == Axis::vertical) {
      s.top = tops.front();
      s.bottom = bottoms.back();
      s.leading = mergeEdges(leadings);
      s.trailing = mergeEdges(trailings);
    } else {
      s.leading = leadings.front();
      s.trailing = trailings.back();
      s.top = mergeEdges(tops);
      s.bottom = mergeEdges(bottoms);
    }
    return s;
  }

  /// Children are sized again with the stack's proposal, where a nil axis becomes the stack's
  /// size on that axis (observed: under a nil width a flexible frame in a VStack takes the stack's
  /// final width; under a concrete width the children keep the distribution of that width).
  void place(const Rect& rect, const Proposal& proposal, double tx, double ty) override {
    Proposal p{proposal.width ? proposal.width : OptD(rect.width), proposal.height ? proposal.height : OptD(rect.height)};
    auto layout = sizes(p);
    auto offsets = positions(layout, crossOf(Size{rect.width, rect.height}));
    for (size_t i = 0; i < children_.size(); i++) {
      Size s = layout.sizes[i];
      Rect r{rect.x + offsets[i].first, rect.y + offsets[i].second, s.width, s.height};
      children_[i]->place(r, layout.proposals[i], tx, ty);
    }
  }

  std::pair<double, double> baselines(const Proposal& p) override {
    if (children_.empty()) {
      return View::baselines(p);
    }
    auto layout = sizes(p);
    auto offsets = positions(layout, crossOf(size(p)));
    auto first = children_.front()->baselines(layout.proposals.front());
    auto last = children_.back()->baselines(layout.proposals.back());
    return {offsets.front().second + first.first, offsets.back().second + last.second};
  }

 protected:
  Size compute(const Proposal& p) override {
    auto layout = sizes(p);
    double main = std::accumulate(gaps_.begin(), gaps_.end(), 0.0);
    double cross = 0;
    for (const auto& s : layout.sizes) {
      main += mainOf(s);
      cross = std::max(cross, crossOf(s));
    }
    if (axis_ == Axis::horizontal && isBaseline()) {
      cross = 0;
      auto offsets = positions(layout, 0);
      for (size_t i = 0; i < layout.sizes.size(); i++) {
        cross = std::max(cross, offsets[i].second + layout.sizes[i].height);
      }
    }
    if (axis_ == Axis::vertical && !children_.empty()) {
      // Width of the lined-up guides (equals the widest child without explicit guides).
      auto offsets = positions(layout, 0);
      double lo = 0, hi = 0;
      for (size_t i = 0; i < layout.sizes.size(); i++) {
        lo = i == 0 ? offsets[i].first : std::min(lo, offsets[i].first);
        hi = i == 0 ? offsets[i].first + layout.sizes[i].width : std::max(hi, offsets[i].first + layout.sizes[i].width);
      }
      cross = hi - lo;
    }
    return axis_ == Axis::vertical ? Size{cross, main} : Size{main, cross};
  }

 private:
  struct Sizes {
    std::vector<Size> sizes;
    std::vector<Proposal> proposals;
  };

  bool isBaseline() const { return vAlign_ == VAlign::firstBaseline || vAlign_ == VAlign::lastBaseline; }

  /// (x, y) of each child inside a stack whose cross size is `crossSize`.
  std::vector<std::pair<double, double>> positions(const Sizes& layout, double crossSize) const {
    size_t n = children_.size();
    std::vector<std::pair<double, double>> out(n);
    std::vector<double> baseline(n, 0);
    double maxBaseline = 0;
    if (axis_ == Axis::horizontal && isBaseline()) {
      for (size_t i = 0; i < n; i++) {
        auto b = children_[i]->baselines(layout.proposals[i]);
        baseline[i] = vAlign_ == VAlign::firstBaseline ? b.first : b.second;
        maxBaseline = std::max(maxBaseline, baseline[i]);
      }
    }
    std::vector<double> guide(n, 0);
    double lead = 0;
    double contentWidth = 0;
    if (axis_ == Axis::vertical) {
      // Horizontal alignment guides: the children's guides line up (default guide: 0, width / 2
      // or width; `alignmentGuide` sets it).
      double trail = 0;
      for (size_t i = 0; i < n; i++) {
        auto g = children_[i]->explicitGuide(hAlign_, layout.proposals[i]);
        guide[i] = g ? *g : layout.sizes[i].width * alignFactor(hAlign_);
        lead = std::max(lead, guide[i]);
        trail = std::max(trail, layout.sizes[i].width - guide[i]);
      }
      contentWidth = lead + trail;
    }
    double cursor = 0;
    for (size_t i = 0; i < n; i++) {
      Size s = layout.sizes[i];
      if (axis_ == Axis::vertical) {
        out[i] = {(crossSize - contentWidth) * alignFactor(hAlign_) + lead - guide[i], cursor};
        cursor += s.height;
      } else {
        double y = isBaseline() ? maxBaseline - baseline[i] : (crossSize - s.height) * alignFactor(vAlign_);
        out[i] = {cursor, y};
        cursor += s.width;
      }
      if (i < gaps_.size()) {
        cursor += gaps_[i];
      }
    }
    return out;
  }

  double mainOf(Size s) const { return axis_ == Axis::vertical ? s.height : s.width; }
  double crossOf(Size s) const { return axis_ == Axis::vertical ? s.width : s.height; }

  Proposal make(OptD main, OptD cross) const {
    return axis_ == Axis::vertical ? Proposal{cross, main} : Proposal{main, cross};
  }

  Sizes sizes(const Proposal& p) const {
    size_t n = children_.size();
    Sizes out{std::vector<Size>(n), std::vector<Proposal>(n)};
    OptD main = axis_ == Axis::vertical ? p.height : p.width;
    OptD cross = axis_ == Axis::vertical ? p.width : p.height;
    if (!main) {
      for (size_t i = 0; i < n; i++) {
        out.proposals[i] = make(OptD(), cross);
        out.sizes[i] = children_[i]->size(out.proposals[i]);
      }
      return out;
    }
    double remaining = *main - std::accumulate(gaps_.begin(), gaps_.end(), 0.0);
    std::vector<double> minSize(n), distMin(n), flex(n);
    for (size_t i = 0; i < n; i++) {
      double lo = mainOf(children_[i]->size(make(0.0, cross)));
      double hi = mainOf(children_[i]->size(make(kInf, cross)));
      minSize[i] = lo;
      distMin[i] = children_[i]->isSpacer() ? 0 : lo;
      flex[i] = std::isinf(hi) ? kInf : hi - lo;
    }
    // Spacers are sized after the other views of the same priority (observed: a Spacer next to a
    // `frame(maxWidth: .infinity)` keeps its minimum length).
    std::vector<double> priorities;
    for (const auto& c : children_) {
      priorities.push_back(c->priority() - (c->isSpacer() ? 0.5 : 0));
    }
    std::vector<double> levels = priorities;
    std::sort(levels.begin(), levels.end(), std::greater<>());
    levels.erase(std::unique(levels.begin(), levels.end()), levels.end());
    for (double level : levels) {
      std::vector<size_t> group;
      double lowerMin = 0;
      for (size_t i = 0; i < n; i++) {
        if (priorities[i] == level) {
          group.push_back(i);
        } else if (priorities[i] < level) {
          lowerMin += minSize[i];
        }
      }
      std::stable_sort(group.begin(), group.end(), [&](size_t a, size_t b) { return flex[a] < flex[b]; });
      double groupRemaining = remaining - lowerMin;
      size_t left = group.size();
      double groupMin = 0;
      for (size_t i : group) {
        groupMin += distMin[i];
      }
      for (size_t i : group) {
        // Each child gets its minimum plus an equal share of what is left above the minimums of
        // the children not sized yet. A Spacer counts as minimum 0 here (its minLength still
        // applies to its size). Observed: a stack placed at exactly its own size keeps its
        // children's sizes; two Spacers share the free space equally whatever their minLength.
        double extra = std::max(0.0, groupRemaining - groupMin) / static_cast<double>(left);
        double offer = std::max(0.0, distMin[i] + extra);
        groupMin -= distMin[i];
        out.proposals[i] = make(offer, cross);
        out.sizes[i] = children_[i]->size(out.proposals[i]);
        groupRemaining -= mainOf(out.sizes[i]);
        remaining -= mainOf(out.sizes[i]);
        left--;
      }
    }
    return out;
  }

  Context& ctx_;
  Axis axis_;
  std::vector<ViewPtr> children_;
  OptD spacing_;
  HAlign hAlign_;
  VAlign vAlign_;
  std::vector<double> gaps_;
};

class ZStackView : public View {
 public:
  ZStackView(Context& ctx, std::vector<ViewPtr> children, Alignment2D alignment)
      : ctx_(ctx), children_(std::move(children)), alignment_(alignment) {}

  ViewSpacing spacing() const override {
    if (children_.empty()) {
      return controlSpacing(ctx_.m);
    }
    std::vector<Edge> t, b, l, r;
    for (const auto& c : children_) {
      auto s = c->spacing();
      t.push_back(s.top);
      b.push_back(s.bottom);
      l.push_back(s.leading);
      r.push_back(s.trailing);
    }
    return {mergeEdges(t), mergeEdges(b), mergeEdges(l), mergeEdges(r)};
  }

  /// Children are placed with the ZStack's size as the proposal (observed: a Spacer in a ZStack
  /// takes the ZStack's size, not the ZStack's proposal).
  void place(const Rect& rect, const Proposal&, double tx, double ty) override {
    Proposal p{rect.width, rect.height};
    for (const auto& c : children_) {
      placeAligned(*c, rect, c->size(p), p, alignment_, tx, ty);
    }
  }

 protected:
  /// Spacers do not size a ZStack (observed: a ZStack of a Text and a Spacer hugs the Text; the
  /// Spacer then fills the ZStack when placed).
  Size compute(const Proposal& p) override {
    bool onlySpacers = std::all_of(children_.begin(), children_.end(), [](const ViewPtr& c) { return c->isSpacer(); });
    Size out;
    for (const auto& c : children_) {
      if (c->isSpacer() && !onlySpacers) {
        continue;
      }
      Size s = c->size(p);
      out.width = std::max(out.width, s.width);
      out.height = std::max(out.height, s.height);
    }
    return out;
  }

 private:
  Context& ctx_;
  std::vector<ViewPtr> children_;
  Alignment2D alignment_;
};

// ---- Scroll view

class ScrollViewView : public WrapperView {
 public:
  ScrollViewView(ViewPtr content, bool horizontal, bool vertical, double scrollerWidth, double pixelScale,
                 ViewSpacing spacing)
      : WrapperView(std::move(content)),
        horizontal_(horizontal),
        vertical_(vertical),
        scroller_(scrollerWidth),
        scale_(pixelScale),
        spacing_(spacing) {}

  ViewSpacing spacing() const override { return spacing_; }

  void place(const Rect& rect, const Proposal& p, double tx, double ty) override {
    Proposal q = inner(p);
    Size s = child_->size(q);
    Size bars = scrollers(p, s);
    // Content is centered on the axes that do not scroll, pixel-aligned (observed).
    auto snap = [&](double v) { return std::round(v * scale_) / scale_; };
    double x = horizontal_ ? rect.x : snap(rect.x + (rect.width - bars.width - s.width) / 2);
    double y = vertical_ ? rect.y : snap(rect.y + (rect.height - bars.height - s.height) / 2);
    child_->place({x, y, s.width, s.height}, q, tx, ty);
  }

 protected:
  Size compute(const Proposal& p) override {
    Size s = child_->size(inner(p));
    Size bars = scrollers(p, s);
    return {horizontal_ ? p.width.value_or(s.width) : s.width + bars.width,
            vertical_ ? p.height.value_or(s.height) : s.height + bars.height};
  }

 private:
  Proposal inner(const Proposal& p) const {
    return {horizontal_ ? OptD() : p.width, vertical_ ? OptD() : p.height};
  }

  /// Legacy (always visible) scrollers take space when the content overflows (macOS only).
  Size scrollers(const Proposal& p, Size content) const {
    Size out;
    if (scroller_ <= 0) {
      return out;
    }
    if (vertical_ && p.height && content.height > *p.height) out.width = scroller_;
    if (horizontal_ && p.width && content.width > *p.width) out.height = scroller_;
    return out;
  }

  bool horizontal_, vertical_;
  double scroller_;
  double scale_;
  ViewSpacing spacing_;
};

// ---- List / Form

struct SectionBlock {
  std::vector<ViewPtr> header; // header views (title text or header slot)
  bool hasHeader = false;
  std::vector<ViewPtr> rows;
  std::vector<ViewPtr> footer;
};

class SectionListView : public View {
 public:
  SectionListView(Context& ctx, const SectionListMetrics& metrics, std::vector<SectionBlock> sections)
      : ctx_(ctx), lm_(metrics), sections_(std::move(sections)) {}

  ViewSpacing spacing() const override { return controlSpacing(ctx_.m); }

  void place(const Rect& rect, const Proposal&, double tx, double ty) override {
    double rowWidth = std::max(0.0, rect.width - 2 * lm_.insetX);
    double x = rect.x + lm_.insetX;
    walk(rowWidth, [&](View& v, double y, Size s, const Proposal& q) {
      v.place({x, rect.y + y, s.width, s.height}, q, tx, ty);
    });
  }

 protected:
  Size compute(const Proposal& p) override {
    double width = p.width.value_or(320);
    if (!std::isfinite(width)) {
      width = 320;
    }
    double contentHeight = walk(std::max(0.0, width - 2 * lm_.insetX), [](View&, double, Size, const Proposal&) {});
    return {p.width.value_or(width), p.height.value_or(contentHeight)};
  }

 private:
  /// Walks the blocks top to bottom, calling `visit(view, y, size, proposal)` for each row
  /// content, header and footer view; returns the height.
  double walk(double rowWidth, const std::function<void(View&, double, Size, const Proposal&)>& visit) {
    enum class Prev { top, rows, footer } prev = Prev::top;
    double y = 0;
    Proposal q{rowWidth, OptD()};
    auto stack = [&](const std::vector<ViewPtr>& views) {
      for (const auto& v : views) {
        Size s = v->size(q);
        visit(*v, y, s, q);
        y += s.height;
      }
    };
    for (const auto& section : sections_) {
      if (section.rows.empty() && section.header.empty() && section.footer.empty()) {
        continue;
      }
      if (section.hasHeader) {
        y += prev == Prev::top ? lm_.headerFirst : prev == Prev::rows ? lm_.headerAfterRows : lm_.headerAfterFooter;
        stack(section.header);
        y += lm_.headerToRows;
      } else {
        y += prev == Prev::top ? lm_.untitledFirst : prev == Prev::rows ? lm_.untitledAfterRows : lm_.untitledAfterFooter;
      }
      for (const auto& row : section.rows) {
        Size s = row->size(q);
        double box = std::max(lm_.rowMinHeight, s.height + lm_.rowPadding);
        visit(*row, y + (box - s.height) / 2, s, q);
        y += box;
      }
      prev = Prev::rows;
      if (!section.footer.empty()) {
        y += lm_.rowsToFooter;
        stack(section.footer);
        prev = Prev::footer;
      }
    }
    return y;
  }

  Context& ctx_;
  const SectionListMetrics& lm_;
  std::vector<SectionBlock> sections_;
};

// ---------------------------------------------------------------------------------------------
// Builder: Node -> views

double paramLength(const Object& params, const std::string& key, double fallback) {
  auto it = params.find(key);
  if (it == params.end()) {
    return fallback;
  }
  return it->second.length().value_or(fallback);
}

OptD paramOpt(const Object& params, const std::string& key) {
  auto it = params.find(key);
  if (it == params.end()) {
    return std::nullopt;
  }
  return it->second.length();
}

std::string paramString(const Object& params, const std::string& key) {
  auto it = params.find(key);
  return it == params.end() ? std::string() : it->second.asString();
}

const Object* findModifier(const Node& node, const std::string& type) {
  const Object* found = nullptr;
  for (const auto& m : node.modifiers) {
    if (paramString(m, "$type") == type) {
      found = &m;
    }
  }
  return found;
}

std::string propString(const Node& node, const std::string& key) {
  return paramString(node.props, key);
}

bool isVirtualType(const std::string& type) {
  return type == "Group" || type == "Slot" || type == "Section";
}

class Builder {
 public:
  explicit Builder(Context& ctx) : ctx_(ctx) {}

  FontSpec fontFor(const std::string& style) const {
    const auto& s = ctx_.m.style(style);
    FontSpec f;
    f.textStyle = style;
    f.pointSize = s.pointSize;
    f.weight = s.weight;
    f.lineHeight = s.lineHeight;
    f.leading = s.leading;
    f.ascender = s.ascender;
    return f;
  }

  /// The system font at an explicit size.
  FontSpec systemFont(double size) const {
    FontSpec f;
    f.pointSize = size;
    f.weight = "regular";
    f.lineHeight = ctx_.m.lineHeightPerPoint * size;
    f.ascender = ctx_.m.ascenderPerPoint * size;
    return f;
  }

  Env rootEnv() const {
    Env env;
    env.font = ctx_.m.defaultFontIsTextStyle ? fontFor(ctx_.m.defaultTextStyle)
                                             : systemFont(ctx_.m.style(ctx_.m.defaultTextStyle).pointSize);
    return env;
  }

  /// Builds the views for a list of child nodes, expanding virtual nodes (Group, Slot, Section)
  /// into their children, as SwiftUI does for ForEach / Group content.
  void flatten(const std::vector<Node>& nodes, const std::string& basePath, const Env& env, std::vector<ViewPtr>& out,
               const std::vector<const Node*>& wrappers = {}) {
    for (size_t i = 0; i < nodes.size(); i++) {
      flattenNode(nodes[i], basePath + "/" + std::to_string(i), env, out, wrappers);
    }
  }

  /// One child: a virtual node adds its children (wrapped in its modifiers), any other node adds
  /// itself (wrapped in the modifiers of the enclosing virtual nodes, innermost first).
  void flattenNode(const Node& node, const std::string& path, const Env& env, std::vector<ViewPtr>& out,
                   const std::vector<const Node*>& wrappers) {
    if (!isVirtualType(node.type)) {
      ViewPtr v = build(node, path, env);
      if (!v) {
        return;
      }
      for (const Node* w : wrappers) {
        v = applyModifiers(v, *w, path);
      }
      out.push_back(v);
      return;
    }
    auto& entry = ctx_.store.registerNode(path, node.type);
    entry.isVirtual = true;
    entry.accessibilityLabel = accessibilityLabel(node);
    Env inner = envFor(node, env);
    auto innerWrappers = wrappers;
    innerWrappers.insert(innerWrappers.begin(), &node);
    if (node.type != "Section") {
      flatten(node.children, path, inner, out, innerWrappers);
      return;
    }
    // A Section outside List/Form: header, content and footer as plain views.
    for (const char* slot : {"header", "content", "footer"}) {
      if (auto idx = slotIndex(node, slot)) {
        flatten(node.children[*idx].children, path + "/" + std::to_string(*idx), inner, out, innerWrappers);
      }
      if (std::string(slot) == "content") {
        for (size_t k = 0; k < node.children.size(); k++) {
          if (node.children[k].type != "Slot") {
            flattenNode(node.children[k], path + "/" + std::to_string(k), inner, out, innerWrappers);
          }
        }
      }
    }
  }

  /// A node with its content and modifiers, recorded. Returns null for types that render nothing.
  ViewPtr build(const Node& node, const std::string& path, const Env& parentEnv) {
    auto& entry = ctx_.store.registerNode(path, node.type);
    if (node.type == "Text") {
      entry.text = propString(node, "text");
    }
    entry.accessibilityLabel = accessibilityLabel(node);
    Env env = envFor(node, parentEnv);
    ViewPtr content = buildContent(node, path, env);
    if (!content) {
      return nullptr;
    }
    ViewPtr v = std::make_shared<RecordView>(content, ctx_.store, path, true);
    v = applyModifiers(v, node, path);
    return std::make_shared<RecordView>(v, ctx_.store, path, false);
  }

  static std::optional<std::string> accessibilityLabel(const Node& node) {
    if (auto* m = findModifier(node, "accessibilityLabel")) {
      return paramString(*m, "label");
    }
    return std::nullopt;
  }

  static std::optional<size_t> slotIndex(const Node& node, const std::string& name) {
    for (size_t i = 0; i < node.children.size(); i++) {
      if (node.children[i].type == "Slot" && propString(node.children[i], "name") == name) {
        return i;
      }
    }
    return std::nullopt;
  }

  /// The environment for a node's content: its `font` / `buttonStyle` modifiers override the
  /// parent's; the innermost (first in the array) wins.
  Env envFor(const Node& node, const Env& parent) const {
    Env env = parent;
    for (auto it = node.modifiers.rbegin(); it != node.modifiers.rend(); ++it) {
      std::string type = paramString(*it, "$type");
      if (type == "font") {
        env.font = resolveFont(*it);
        env.fontExplicit = true;
      } else if (type == "buttonStyle") {
        env.buttonStyle = paramString(*it, "style");
      } else if (type == "truncationMode") {
        env.truncationMode = paramString(*it, "mode");
      } else if (type == "lineLimit") {
        // LineLimitModifier.swift: {min, max} | {limit, reservesSpace} | {} (no limit).
        OptD min = paramOpt(*it, "min"), max = paramOpt(*it, "max"), limit = paramOpt(*it, "limit");
        auto reserves = it->find("reservesSpace");
        if (min && max) {
          env.lineLimit = static_cast<int>(*max);
          env.minLines = static_cast<int>(*min);
        } else {
          env.lineLimit = limit ? static_cast<int>(*limit) : 0;
          env.minLines = limit && reserves != it->end() && reserves->second.asBool() ? static_cast<int>(*limit) : 0;
        }
      }
    }
    return env;
  }

  FontSpec resolveFont(const Object& params) const {
    FontSpec f;
    std::string family = paramString(params, "family");
    OptD size = paramOpt(params, "size");
    if (size) {
      f = systemFont(*size);
      f.family = family;
    } else {
      std::string style = paramString(params, "textStyle");
      f = fontFor(style.empty() ? "body" : style);
    }
    std::string weight = paramString(params, "weight");
    if (!weight.empty()) {
      f.weight = weight;
    }
    std::string design = paramString(params, "design");
    f.design = design.empty() ? "default" : design;
    return f;
  }

  ViewPtr applyModifiers(ViewPtr v, const Node& node, const std::string& path) {
    for (const auto& params : node.modifiers) {
      std::string type = paramString(params, "$type");
      if (type == "padding") {
        v = padding(v, params);
      } else if (type == "frame") {
        v = frame(v, params);
      } else if (type == "fixedSize") {
        auto h = params.find("horizontal");
        auto vv = params.find("vertical");
        bool hasH = h != params.end() && h->second.isBool();
        bool hasV = vv != params.end() && vv->second.isBool();
        if (!hasH && !hasV) {
          v = std::make_shared<FixedSizeView>(v, true, true);
        } else {
          v = std::make_shared<FixedSizeView>(v, hasH && h->second.asBool(), hasV && vv->second.asBool());
        }
      } else if (type == "layoutPriority") {
        v = std::make_shared<PriorityView>(v, paramLength(params, "priority", 0));
      } else if (type == "alignmentGuide") {
        // Horizontal guides (leading/center/trailing); the list row separator guides change no frame.
        std::string guide = paramString(params, "guide");
        if (guide == "leading" || guide == "center" || guide == "trailing") {
          v = std::make_shared<AlignmentGuideView>(v, parseHAlign(guide, HAlign::leading), paramLength(params, "value", 0));
        }
      } else if (type == "offset") {
        v = std::make_shared<OffsetView>(v, paramLength(params, "x", 0), paramLength(params, "y", 0));
      } else if (type == "background" || type == "cornerRadius" || type == "hidden" || type == "font" ||
                 type == "accessibilityLabel" || type == "toggleStyle" || type == "buttonStyle" ||
                 type == "pickerStyle" || type == "tag" || type == "lineLimit" || type == "truncationMode" ||
                 type == "multilineTextAlignment") {
        // lineLimit and truncationMode are read into the environment; multilineTextAlignment
        // aligns lines inside the Text's frame and changes no frame.
        // No layout effect (font and styles are read into the environment and by the builders).
      } else {
        ctx_.store.noteUnsupported("modifier:" + type, path);
      }
    }
    return v;
  }

  ViewPtr padding(ViewPtr v, const Object& params) {
    const double def = ctx_.m.defaultPadding;
    auto get = [&](const char* edge, const char* axis) -> OptD {
      for (const char* key : {edge, axis, "all"}) {
        auto it = params.find(key);
        if (it != params.end() && !it->second.isNull()) {
          if (it->second.isString() && it->second.asString() == "default") {
            return def;
          }
          return it->second.length().value_or(0);
        }
      }
      return std::nullopt;
    };
    OptD top = get("top", "vertical"), leading = get("leading", "horizontal"), bottom = get("bottom", "vertical"),
         trailing = get("trailing", "horizontal");
    if (!top && !leading && !bottom && !trailing) {
      top = leading = bottom = trailing = def;
    }
    ViewPtr padded =
        std::make_shared<PaddingView>(v, top.value_or(0), leading.value_or(0), bottom.value_or(0), trailing.value_or(0));
    // A padded edge has the default (control) spacing; an edge without padding keeps the child's
    // (observed: padding(0) keeps text spacing, padding(6) spaces like a control).
    ViewSpacing spacing = v->spacing();
    ViewSpacing control = controlSpacing(ctx_.m);
    if (top.value_or(0) != 0) spacing.top = control.top;
    if (bottom.value_or(0) != 0) spacing.bottom = control.bottom;
    if (leading.value_or(0) != 0) spacing.leading = control.leading;
    if (trailing.value_or(0) != 0) spacing.trailing = control.trailing;
    return std::make_shared<SpacingOverrideView>(padded, spacing);
  }

  ViewPtr frame(ViewPtr v, const Object& params) {
    Alignment2D align = parseAlignment(paramString(params, "alignment")).value_or(Alignment2D{});
    OptD width = paramOpt(params, "width"), height = paramOpt(params, "height");
    ViewPtr out;
    if (width || height) {
      out = std::make_shared<FixedFrameView>(v, width, height, align);
    } else {
      out = std::make_shared<FlexFrameView>(
          v, FlexFrameView::Axis1{paramOpt(params, "minWidth"), paramOpt(params, "idealWidth"), paramOpt(params, "maxWidth")},
          FlexFrameView::Axis1{paramOpt(params, "minHeight"), paramOpt(params, "idealHeight"), paramOpt(params, "maxHeight")},
          align);
    }
    return std::make_shared<SpacingOverrideView>(out, controlSpacing(ctx_.m));
  }

  ViewPtr text(const std::string& s, const Env& env) {
    return std::make_shared<TextView>(ctx_, s, env.font, env.lineLimit, env.minLines, env.truncationMode);
  }

  Size textSize(const std::string& s, const Env& env, const Proposal& p = {}) {
    return text(s, env)->size(p);
  }

  Size symbolSize(const std::string& name, const Env& env) {
    if (ctx_.m.iosSymbolTable) {
      if (auto size = iosSymbolSize(name, env.font.pointSize, env.font.weight)) {
        return *size;
      }
    }
    Size s = ctx_.measurer.measureSymbol(name, env.font);
    double k = ctx_.m.pixelScale;
    return {ceilTo(s.width, k), ceilTo(s.height, k)};
  }

  ViewSpacing imageSpacing() const {
    const auto& m = ctx_.m;
    ViewSpacing s;
    s.top = Edge{Cat::image, 0, m.imageTopVsControl, 0};
    s.bottom = Edge{Cat::image, 0, m.imageBottomVsControl, 0};
    s.leading = s.trailing = Edge{Cat::image, m.horizontalSpacing, m.horizontalSpacing, m.horizontalSpacing};
    return s;
  }

  ViewPtr leaf(std::function<Size(const Proposal&)> fn) {
    return std::make_shared<LeafView>(std::move(fn), controlSpacing(ctx_.m));
  }

  std::vector<ViewPtr> childViews(const Node& node, const std::string& path, const Env& env, Axis axis) {
    Env inner = env;
    inner.axis = axis;
    if (inner.row && !inner.row->nestedControlsUseRowStyle) {
      inner.nestedInRow = true;
      inner.row = nullptr;
    }
    std::vector<ViewPtr> out;
    flatten(node.children, path, inner, out);
    return out;
  }

  ViewPtr buildContent(const Node& node, const std::string& path, const Env& env) {
    const auto& m = ctx_.m;
    const std::string& t = node.type;
    if (t == "VStack" || t == "HStack") {
      bool vertical = t == "VStack";
      Axis axis = vertical ? Axis::vertical : Axis::horizontal;
      auto kids = childViews(node, path, env, axis);
      return std::make_shared<StackView>(ctx_, axis, std::move(kids), paramOpt(node.props, "spacing"),
                                         parseHAlign(propString(node, "alignment"), HAlign::center),
                                         parseVAlign(propString(node, "alignment"), VAlign::center));
    }
    if (t == "ZStack") {
      auto kids = childViews(node, path, env, Axis::none);
      return std::make_shared<ZStackView>(ctx_, std::move(kids),
                                          parseAlignment(propString(node, "alignment")).value_or(Alignment2D{}));
    }
    if (t == "Spacer") {
      return std::make_shared<SpacerView>(env.axis, paramOpt(node.props, "minLength").value_or(m.spacerMinLength));
    }
    if (t == "Divider") {
      Axis axis = env.axis;
      double thick = m.dividerThickness;
      return leaf([axis, thick](const Proposal& p) -> Size {
        if (axis == Axis::horizontal) {
          return {thick, p.height.value_or(0)};
        }
        return {p.width.value_or(0), thick};
      });
    }
    if (t == "Text") {
      // Nested Text children are concatenated (TextView.swift `buildText`).
      std::function<std::string(const Node&)> content = [&](const Node& n) {
        std::string out = propString(n, "text");
        for (const auto& child : n.children) {
          if (child.type == "Text") {
            out += content(child);
          }
        }
        return out;
      };
      return text(content(node), env);
    }
    if (t == "RNHost") {
      // React Native content in an RNHostView: a leaf of its measured (Yoga) size.
      Size s{paramLength(node.props, "width", 0), paramLength(node.props, "height", 0)};
      return leaf([s](const Proposal&) { return s; });
    }
    if (t == "Image") {
      std::string name = propString(node, "systemName");
      if (name.empty()) {
        ctx_.store.noteUnsupported("prop:Image without systemName", path);
        return nullptr;
      }
      Size s = symbolSize(name, env);
      return std::make_shared<LeafView>([s](const Proposal&) { return s; }, imageSpacing());
    }
    if (t == "Label") {
      return label(propString(node, "title"), propString(node, "systemImage"), env);
    }
    if (t == "ScrollView") {
      std::string axes = propString(node, "axes");
      bool horizontal = axes == "horizontal" || axes == "both";
      bool vertical = axes != "horizontal";
      Axis stackAxis = horizontal && !vertical ? Axis::horizontal : Axis::vertical;
      auto kids = childViews(node, path, env, stackAxis);
      ViewPtr content = kids.size() == 1
                            ? kids.front()
                            : std::make_shared<StackView>(ctx_, stackAxis, std::move(kids), OptD(), HAlign::center,
                                                          VAlign::center);
      auto shows = node.props.find("showsIndicators");
      bool showsIndicators = shows == node.props.end() || shows->second.asBool(true);
      return std::make_shared<ScrollViewView>(content, horizontal, vertical, showsIndicators ? m.scrollerWidth : 0,
                                              m.pixelScale, controlSpacing(m));
    }
    if (t == "List" || t == "Form") {
      return sectionList(node, path, env, t == "Form" ? m.form : m.list);
    }
    if (t == "Button") {
      return button(node, path, env);
    }
    if (t == "Toggle") {
      return toggle(node, path, env);
    }
    if (t == "Slider") {
      const SectionListMetrics* row = env.row;
      double height = m.sliderHeight;
      double ideal = m.sliderIdealWidth;
      return leaf([row, height, ideal](const Proposal& p) -> Size {
        if (row && row->controlsFillRow) {
          return {p.width.value_or(ideal), row->sliderRowHeight >= 0 ? row->sliderRowHeight : height};
        }
        return {p.width.value_or(ideal), height};
      });
    }
    if (t == "TextField" || t == "SecureField") {
      double textW = std::max(textSize(propString(node, "text"), env).width,
                              textSize(propString(node, "placeholder"), env).width);
      double ideal = std::max(m.textFieldMinWidth, textW + m.textFieldPaddingX);
      const SectionListMetrics* row = env.row;
      double height = m.textFieldHeight;
      return leaf([row, height, ideal](const Proposal& p) -> Size {
        if (row && row->controlsFillRow) {
          return {p.width.value_or(ideal), row->textFieldRowHeight >= 0 ? row->textFieldRowHeight : height};
        }
        return {p.width.value_or(ideal), height};
      });
    }
    if (t == "Picker") {
      return picker(node, path, env);
    }
    ctx_.store.noteUnsupported("type:" + t, path);
    return nullptr;
  }

  ViewPtr label(const std::string& title, const std::string& systemImage, const Env& env) {
    if (systemImage.empty()) {
      return text(title, env);
    }
    Size icon = symbolSize(systemImage, env);
    auto titleView = text(title, env);
    double gap = env.row && env.row->labelIconGap >= 0 ? env.row->labelIconGap : ctx_.m.labelIconGap;
    if (env.row && env.row->labelIconSlot > 0) {
      // Rows put the icon in a fixed-width column (observed on iOS).
      gap = std::max(0.0, env.row->labelIconSlot - icon.width);
    } else if (env.row && env.row->labelIconMinWidth > icon.width) {
      // macOS rows: the icon column is at least labelIconMinWidth wide.
      gap += env.row->labelIconMinWidth - icon.width;
    }
    auto spacing = titleView->spacing();
    return std::make_shared<LeafView>(
        [icon, titleView, gap](const Proposal& p) -> Size {
          Proposal q = p;
          if (q.width) q.width = std::max(0.0, *q.width - icon.width - gap);
          Size s = titleView->size(q);
          return {icon.width + gap + s.width, std::max(icon.height, s.height)};
        },
        spacing);
  }

  ViewPtr button(const Node& node, const std::string& path, const Env& env) {
    const auto& m = ctx_.m;
    ViewPtr labelView;
    std::string title = propString(node, "label");
    if (!title.empty()) {
      labelView = label(title, propString(node, "systemImage"), env);
    } else {
      auto kids = childViews(node, path, env, Axis::horizontal);
      labelView = kids.size() == 1 ? kids.front()
                                   : std::make_shared<StackView>(ctx_, Axis::horizontal, std::move(kids),
                                                                 OptD(m.buttonChildrenSpacing), HAlign::center,
                                                                 VAlign::center);
    }
    bool plain = env.buttonStyle == "borderless" || env.buttonStyle == "plain" ||
                 ((env.buttonStyle.empty() || env.buttonStyle == "automatic") && !m.buttonDefaultBordered);
    double px = plain ? 0 : m.buttonPaddingX;
    double py = plain ? 0 : m.buttonPaddingY;
    double minH = plain ? 0 : m.buttonMinHeight;
    // A plain button on iOS spaces like its label (observed); bordered buttons like controls.
    ViewSpacing spacing = plain && !m.buttonDefaultBordered ? labelView->spacing() : controlSpacing(m);
    return std::make_shared<ControlBox>(labelView, px, py, minH, spacing);
  }

  /// A control drawn around a label: label + padding, at least `minHeight` tall; the label is
  /// centered.
  class ControlBox : public WrapperView {
   public:
    ControlBox(ViewPtr label, double px, double py, double minHeight, ViewSpacing spacing)
        : WrapperView(std::move(label)), px_(px), py_(py), minHeight_(minHeight), spacing_(spacing) {}
    ViewSpacing spacing() const override { return spacing_; }
    double priority() const override { return 0; }
    bool isSpacer() const override { return false; }
    void place(const Rect& rect, const Proposal& p, double tx, double ty) override {
      Proposal q = inner(p);
      placeAligned(*child_, rect, child_->size(q), q, {HAlign::center, VAlign::center}, tx, ty);
    }

   protected:
    Size compute(const Proposal& p) override {
      Size s = child_->size(inner(p));
      return {s.width + 2 * px_, std::max(minHeight_, s.height + 2 * py_)};
    }

   private:
    Proposal inner(const Proposal& p) const {
      Proposal q;
      if (p.width) q.width = std::max(0.0, *p.width - 2 * px_);
      if (p.height) q.height = std::max(0.0, *p.height - 2 * py_);
      return q;
    }
    double px_, py_, minHeight_;
    ViewSpacing spacing_;
  };

  ViewPtr toggle(const Node& node, const std::string& path, const Env& env) {
    const auto& m = ctx_.m;
    std::string style = "switch";
    if (auto* mod = findModifier(node, "toggleStyle")) {
      style = paramString(*mod, "style");
    }
    if (style != "button" && m.toggleAutomaticIsSwitch) {
      style = "switch";
    }
    ViewPtr labelView;
    std::string title = propString(node, "label");
    if (!title.empty()) {
      labelView = label(title, propString(node, "systemImage"), env);
    } else if (!node.children.empty()) {
      // Children form the label, stacked vertically and leading-aligned (observed).
      auto kids = childViews(node, path, env, Axis::vertical);
      if (!kids.empty()) {
        labelView = kids.size() == 1 ? kids.front()
                                     : std::make_shared<StackView>(ctx_, Axis::vertical, std::move(kids), OptD(),
                                                                   HAlign::leading, VAlign::center);
      }
    }
    const SectionListMetrics* row = env.row;
    double cw = style == "switch" ? m.switchWidth : m.checkboxWidth;
    double ch = style == "switch" ? m.switchHeight : m.checkboxHeight;
    double gap = style == "switch" ? m.switchLabelGap : m.checkboxLabelGap;
    bool fills = style == "switch" && m.switchFillsWidth && !env.nestedInRow;
    bool gapWithoutLabel = style == "switch" && m.switchGapWithoutLabel && !env.nestedInRow;
    return std::make_shared<ToggleBox>(labelView, cw, ch, gap, gapWithoutLabel, fills, row, controlSpacing(m));
  }

  class ToggleBox : public View {
   public:
    ToggleBox(ViewPtr label, double cw, double ch, double gap, bool gapWithoutLabel, bool fills,
              const SectionListMetrics* row, ViewSpacing spacing)
        : label_(std::move(label)),
          cw_(cw),
          ch_(ch),
          gap_(gap),
          gapWithoutLabel_(gapWithoutLabel),
          fills_(fills),
          row_(row),
          spacing_(spacing) {}
    ViewSpacing spacing() const override { return spacing_; }
    void place(const Rect& rect, const Proposal& p, double tx, double ty) override {
      if (!label_) {
        return;
      }
      Proposal q = labelProposal(p);
      Size s = label_->size(q);
      label_->place({rect.x, rect.y + (rect.height - s.height) / 2, s.width, s.height}, q, tx, ty);
    }

   protected:
    Size compute(const Proposal& p) override {
      Size l = label_ ? label_->size(labelProposal(p)) : Size{};
      double w = label_ ? l.width + gap_ + cw_ : cw_ + (gapWithoutLabel_ ? gap_ : 0);
      double h = std::max(l.height, ch_);
      if (row_ && row_->controlsFillRow) {
        return {p.width.value_or(w), row_->toggleRowHeight >= 0 ? row_->toggleRowHeight : h};
      }
      if (fills_ && p.width && std::isfinite(*p.width)) {
        w = std::max(w, *p.width);
      }
      return {w, h};
    }

   private:
    Proposal labelProposal(const Proposal& p) const {
      Proposal q;
      if (p.width) q.width = std::max(0.0, *p.width - gap_ - cw_);
      q.height = p.height;
      return q;
    }
    ViewPtr label_;
    double cw_, ch_, gap_;
    bool gapWithoutLabel_;
    bool fills_;
    const SectionListMetrics* row_;
    ViewSpacing spacing_;
  };

  ViewPtr picker(const Node& node, const std::string& path, const Env& env) {
    const auto& m = ctx_.m;
    // Options: the content slot's children, or the non-slot children. Drawn by the platform
    // control, so they are registered without frames.
    std::vector<const Node*> options;
    std::string optionsPath = path;
    if (auto idx = slotIndex(node, "content")) {
      optionsPath = path + "/" + std::to_string(*idx);
      for (const auto& c : node.children[*idx].children) options.push_back(&c);
    } else {
      for (const auto& c : node.children) {
        if (c.type != "Slot") options.push_back(&c);
      }
    }
    double widest = 0;
    double selected = 0;
    const Value& selection = node.props.count("selection") ? node.props.at("selection") : Value();
    auto tagOf = [](const Node& option, size_t index) {
      if (auto* tag = findModifier(option, "tag")) {
        auto it = tag->find("tag");
        if (it != tag->end()) {
          return it->second.isString() ? it->second.asString() : it->second.serialize();
        }
      }
      return std::to_string(index);
    };
    std::string selectedTag = selection.isString() ? selection.asString() : selection.isNull() ? "" : selection.serialize();
    for (size_t i = 0; i < options.size(); i++) {
      auto& entry = ctx_.store.registerNode(optionsPath + "/" + std::to_string(i), options[i]->type);
      entry.platformRendered = true;
      if (options[i]->type == "Text") {
        entry.text = propString(*options[i], "text");
        double w = textSize(propString(*options[i], "text"), envFor(*options[i], env)).width;
        widest = std::max(widest, w);
        if (tagOf(*options[i], i) == selectedTag) {
          selected = w;
        }
      }
    }
    std::string title = propString(node, "label");
    double labelW = title.empty() || m.pickerMenuShowsSelection ? 0 : textSize(title, env).width;
    std::string style;
    if (auto* mod = findModifier(node, "pickerStyle")) {
      style = paramString(*mod, "style");
    }
    double n = static_cast<double>(options.size());
    bool segmented = style == "segmented";
    double ideal;
    if (segmented) {
      ideal = labelW + (options.size() == 1 ? widest + m.pickerSingleSegmentExtra
                                            : n * (widest + m.pickerSegmentExtra) + m.pickerSegmentedExtra);
    } else {
      ideal = labelW + (m.pickerMenuShowsSelection ? selected : widest) + m.pickerMenuExtra;
    }
    const SectionListMetrics* row = env.row;
    double height = segmented ? m.pickerSegmentedHeight : m.pickerMenuHeight;
    bool fills = segmented && m.pickerSegmentedFills;
    return leaf([row, ideal, height, fills](const Proposal& p) -> Size {
      if (row && row->controlsFillRow) {
        return {p.width.value_or(ideal), row->pickerRowHeight >= 0 ? row->pickerRowHeight : height};
      }
      return {fills ? p.width.value_or(ideal) : ideal, height};
    });
  }

  ViewPtr sectionList(const Node& node, const std::string& path, const Env& env, const SectionListMetrics& lm) {
    Env rowEnv = env;
    rowEnv.axis = Axis::vertical;
    rowEnv.row = &lm;
    std::vector<SectionBlock> sections;
    SectionBlock loose;
    auto flushLoose = [&]() {
      if (!loose.rows.empty()) {
        sections.push_back(std::move(loose));
        loose = SectionBlock();
      }
    };
    for (size_t i = 0; i < node.children.size(); i++) {
      const Node& child = node.children[i];
      std::string childPath = path + "/" + std::to_string(i);
      if (child.type != "Section") {
        std::vector<ViewPtr> rows;
        flattenNode(child, childPath, rowEnv, rows, {});
        if (lm.looseRowsFormSection) {
          for (auto& r : rows) loose.rows.push_back(r);
        } else {
          // List: loose rows continue the previous section.
          if (sections.empty()) {
            sections.emplace_back();
          }
          for (auto& r : rows) sections.back().rows.push_back(r);
        }
        continue;
      }
      flushLoose();
      auto& entry = ctx_.store.registerNode(childPath, "Section");
      entry.isVirtual = true;
      entry.accessibilityLabel = accessibilityLabel(child);
      Env sectionEnv = envFor(child, rowEnv);
      std::vector<const Node*> wrappers{&child};
      SectionBlock block;
      std::string title = propString(child, "title");
      // The title is drawn in the header style; a header slot keeps the section's font (observed).
      Env headerEnv = sectionEnv;
      headerEnv.row = nullptr;
      if (!lm.headerSlotTextStyle.empty()) {
        headerEnv.font = fontFor(lm.headerSlotTextStyle);
        headerEnv.fontExplicit = true;
      }
      if (!lm.headerSlotWeight.empty()) {
        headerEnv.font.weight = lm.headerSlotWeight;
      }
      Env titleEnv = headerEnv;
      titleEnv.font = fontFor(lm.headerTextStyle);
      titleEnv.fontExplicit = true;
      Env footerEnv = sectionEnv;
      footerEnv.font = fontFor(lm.footerTextStyle);
      footerEnv.fontExplicit = true;
      if (!lm.footerWeight.empty()) {
        footerEnv.font.weight = lm.footerWeight;
      }
      footerEnv.row = nullptr;
      if (!title.empty()) {
        block.hasHeader = true;
        block.header.push_back(text(title, titleEnv));
      } else if (auto idx = slotIndex(child, "header")) {
        block.hasHeader = true;
        flatten(child.children[*idx].children, childPath + "/" + std::to_string(*idx), headerEnv, block.header);
      }
      if (auto idx = slotIndex(child, "content")) {
        flatten(child.children[*idx].children, childPath + "/" + std::to_string(*idx), sectionEnv, block.rows, wrappers);
      }
      for (size_t k = 0; k < child.children.size(); k++) {
        if (child.children[k].type != "Slot") {
          flattenNode(child.children[k], childPath + "/" + std::to_string(k), sectionEnv, block.rows, wrappers);
        }
      }
      if (auto idx = slotIndex(child, "footer")) {
        flatten(child.children[*idx].children, childPath + "/" + std::to_string(*idx), footerEnv, block.footer);
      }
      sections.push_back(std::move(block));
    }
    flushLoose();
    return std::make_shared<SectionListView>(ctx_, lm, std::move(sections));
  }

 private:
  Context& ctx_;
};

} // namespace

// ---------------------------------------------------------------------------------------------
// Public API

Node Node::fromValue(const Value& value) {
  Node node;
  node.type = value["type"].asString();
  node.props = value["props"].asObject();
  for (const auto& m : value["modifiers"].asArray()) {
    node.modifiers.push_back(m.asObject());
  }
  for (const auto& c : value["children"].asArray()) {
    node.children.push_back(fromValue(c));
  }
  return node;
}

HostSpec HostSpec::fromValue(const Value& value) {
  HostSpec host;
  if (auto w = value["width"].length()) host.width = *w;
  if (auto h = value["height"].length()) host.height = *h;
  const Value& match = value["matchContents"];
  if (match.isBool()) {
    host.matchContentsHorizontal = host.matchContentsVertical = match.asBool();
  } else if (match.isObject()) {
    host.matchContentsHorizontal = match["horizontal"].asBool();
    host.matchContentsVertical = match["vertical"].asBool();
  }
  host.rightToLeft = value["layoutDirection"].asString() == "rightToLeft";
  return host;
}

const TextStyleMetrics& ControlMetrics::style(const std::string& name) const {
  auto it = textStyles.find(name);
  if (it != textStyles.end()) {
    return it->second;
  }
  return textStyles.at(defaultTextStyle);
}

ControlMetrics ControlMetrics::macos() {
  // Measured with native/tools/swiftui-ref on macOS 26.5 (Xcode 26.6).
  ControlMetrics m;
  m.platform = Platform::macos;
  m.verified = true;
  m.pixelScale = 1;
  // Text styles: NSFont.preferredFont(forTextStyle:) sizes. Heights come from the measurer
  // (ceil of NSAttributedString.boundingRect). Spacing: default VStack spacing observed against a
  // Divider/Button (control) and a Text above in the same style.
  auto style = [](double size, const char* weight, double topText, double topCtl, double bottomCtl) {
    TextStyleMetrics s;
    s.pointSize = size;
    s.weight = weight;
    s.spacing = {topText, topCtl, bottomCtl};
    return s;
  };
  m.textStyles = {
      {"largeTitle", style(26, "regular", 2, 9.484, 16.302)},
      {"title", style(22, "regular", 1, 7.641, 13.409)},
      {"title2", style(17, "regular", 2, 6.586, 11.043)},
      {"title3", style(15, "regular", 3, 5.164, 9.098)},
      {"headline", style(13, "bold", 1, 4.742, 8.151)},
      {"subheadline", style(11, "regular", 2, 4.32, 7.205)},
      {"body", style(13, "regular", 1, 4.742, 8.151)},
      {"callout", style(12, "regular", 1, 4.531, 7.678)},
      {"footnote", style(10, "regular", 2, 4.109, 6.731)},
      {"caption", style(10, "regular", 2, 4.11, 6.731)},
      {"caption2", style(10, "medium", 2, 4.11, 6.731)},
  };
  m.defaultTextStyle = "body";
  m.defaultFontIsTextStyle = false;
  m.textHeightFromMetrics = false;

  m.horizontalSpacing = 8;
  m.controlSpacing = 8;
  m.imageTopVsControl = 2;
  m.imageBottomVsControl = 3;
  m.spacerMinLength = 8;
  m.defaultPadding = 16;
  m.buttonDefaultBordered = true;
  m.buttonPaddingX = 12;
  m.buttonPaddingY = 4;
  m.buttonMinHeight = 24;
  m.buttonChildrenSpacing = 4;
  m.switchWidth = 54; // the harness applies .switch; the macOS default is a checkbox
  m.switchHeight = 24;
  m.switchLabelGap = 8;
  m.switchFillsWidth = false;
  m.checkboxWidth = 16;
  m.checkboxHeight = 16;
  m.checkboxLabelGap = 5;
  m.sliderHeight = 16;
  m.sliderIdealWidth = 0;
  m.textFieldPaddingX = 12;
  m.textFieldMinWidth = 0;
  m.textFieldHeight = 24;
  m.pickerMenuExtra = 56;
  m.pickerSegmentExtra = 21;
  m.pickerSegmentedExtra = 8;
  m.pickerSingleSegmentExtra = 28;
  m.pickerSegmentedHeight = 24;
  m.pickerMenuHeight = 24;
  m.pickerMenuShowsSelection = false;
  m.pickerSegmentedFills = false;
  m.labelIconGap = 8;
  m.dividerThickness = 1;
  // Legacy scrollers (the offscreen harness gets them; with a trackpad macOS uses overlay ones).
  m.scrollerWidth = 17;

  // Grouped Form (swiftui-ref applies .formStyle(.grouped)).
  m.form.insetX = 30;
  m.form.rowPadding = 21;
  m.form.rowMinHeight = 0;
  m.form.untitledFirst = 19.5;
  m.form.headerFirst = 20.25;
  m.form.untitledAfterRows = 9;
  m.form.untitledAfterFooter = 29.5;
  m.form.headerAfterRows = 29.5;
  m.form.headerAfterFooter = 30;
  m.form.headerToRows = 9.5;
  m.form.rowsToFooter = 9.5;
  m.form.headerTextStyle = "headline";
  m.form.headerSlotWeight = "semibold";
  m.form.footerTextStyle = "subheadline";
  m.form.labelIconGap = 10;
  m.form.labelIconMinWidth = 16;
  m.form.looseRowsFormSection = true;
  m.form.nestedControlsUseRowStyle = true;
  m.form.controlsFillRow = true;
  m.form.toggleRowHeight = 16;
  m.form.textFieldRowHeight = 16;
  m.form.sliderRowHeight = 16;
  m.form.pickerRowHeight = 17.5;

  // List (macOS default style).
  m.list.insetX = 16;
  m.list.rowPadding = 8;
  m.list.rowMinHeight = 0;
  m.list.untitledFirst = 10;
  m.list.headerFirst = 10;
  m.list.untitledAfterRows = 20;
  m.list.untitledAfterFooter = 20;
  m.list.headerAfterRows = 27;
  m.list.headerAfterFooter = 34;
  m.list.headerToRows = 7;
  m.list.rowsToFooter = 7;
  m.list.headerTextStyle = "subheadline";
  m.list.headerSlotTextStyle = "subheadline";
  m.list.headerSlotWeight = "semibold";
  m.list.footerTextStyle = "subheadline";
  m.list.footerWeight = "semibold";
  m.list.labelIconGap = 7;
  m.list.looseRowsFormSection = false;
  m.list.nestedControlsUseRowStyle = true;
  m.list.controlsFillRow = true; // a Toggle row fills the row width (own height)
  return m;
}

ControlMetrics ControlMetrics::ios() {
  // Measured with native/tools/swiftui-ref/scripts/run-ios.sh on the iOS 26.5 simulator
  // (iPhone 17 Pro, scale 3, default Dynamic Type size). Text styles: UIFont.preferredFont
  // point size, lineHeight (ascender + descender), leading and ascender.
  ControlMetrics m;
  m.platform = Platform::ios;
  m.verified = true;
  m.pixelScale = 3;
  auto style = [](double size, const char* weight, double lineHeight, double leading, double ascender, double topText,
                  double topCtl, double bottomCtl) {
    TextStyleMetrics s;
    s.pointSize = size;
    s.weight = weight;
    s.lineHeight = lineHeight;
    s.leading = leading;
    s.ascender = ascender;
    s.spacing = {topText, topCtl, bottomCtl};
    return s;
  };
  m.textStyles = {
      {"largeTitle", style(34, "regular", 40.574, 0.426, 32.373, 0.667, 12.535, 20.951)},
      {"title", style(28, "regular", 33.414, 0.586, 26.660, 0.667, 10.421, 17.351)},
      {"title2", style(22, "regular", 26.254, 1.746, 20.947, 2, 7.973, 13.42)},
      {"title3", style(20, "regular", 23.867, 1.133, 19.043, 1.334, 7.491, 12.442)},
      {"headline", style(17, "semibold", 20.287, 1.713, 16.187, 2, 6.434, 10.643)},
      {"subheadline", style(15, "regular", 17.900, 2.100, 14.282, 2.333, 5.619, 9.331)},
      {"body", style(17, "regular", 20.287, 1.713, 16.187, 2, 6.434, 10.643)},
      {"callout", style(16, "regular", 19.094, 1.906, 15.234, 2, 5.86, 9.821)},
      {"footnote", style(13, "regular", 15.514, 2.486, 12.378, 2.667, 4.803, 8.02)},
      {"caption", style(12, "regular", 14.320, 1.680, 11.426, 2, 4.562, 7.533)},
      {"caption2", style(11, "regular", 13.127, -0.127, 10.474, 0, 3.987, 6.71)},
  };
  m.defaultTextStyle = "body";
  m.defaultFontIsTextStyle = true;
  m.textHeightFromMetrics = true;
  m.lineHeightPerPoint = 20.287 / 17;
  m.ascenderPerPoint = 16.187 / 17;

  m.horizontalSpacing = 8;
  m.controlSpacing = 8;
  m.imageTopVsControl = 2.333;
  m.imageBottomVsControl = 3.333;
  m.spacerMinLength = 8;
  m.defaultPadding = 16;
  m.buttonDefaultBordered = false; // .automatic is a plain text button
  m.buttonPaddingX = 12; // .bordered / .borderedProminent
  m.buttonPaddingY = 7;
  m.buttonMinHeight = 0;
  m.buttonChildrenSpacing = 8;
  m.switchWidth = 61; // observed: 69 = gap + switch without a label, 61 when nested in a Form row
  m.switchHeight = 28;
  m.switchLabelGap = 8;
  m.switchFillsWidth = true;
  m.switchGapWithoutLabel = true;
  m.toggleAutomaticIsSwitch = true;
  m.checkboxWidth = m.switchWidth;
  m.checkboxHeight = m.switchHeight;
  m.checkboxLabelGap = m.switchLabelGap;
  m.sliderHeight = 31;
  m.sliderIdealWidth = 0;
  m.textFieldPaddingX = 0;
  m.textFieldMinWidth = 5;
  m.textFieldHeight = 22;
  m.pickerMenuExtra = 40.333;
  m.pickerMenuShowsSelection = true;
  m.pickerMenuHeight = 34.333;
  m.pickerSegmentedFills = true;
  m.pickerSegmentedHeight = 31;
  m.labelIconGap = 8;
  m.dividerThickness = 1.0 / 3;
  m.scrollerWidth = 0; // overlay indicators
  m.iosSymbolTable = true;

  // Form (inset grouped); List's default style on iOS is the same.
  SectionListMetrics f;
  f.insetX = 32;
  f.rowPadding = 30;
  f.rowMinHeight = 52;
  f.untitledFirst = 35;
  f.headerFirst = 10;
  f.untitledAfterRows = 35;
  f.untitledAfterFooter = 23.667;
  f.headerAfterRows = 27.333;
  f.headerAfterFooter = 16;
  f.headerToRows = 10;
  f.rowsToFooter = 8;
  f.headerTextStyle = "body";
  f.headerSlotWeight = "semibold";
  f.footerTextStyle = "footnote";
  f.labelIconSlot = 40.333;
  f.looseRowsFormSection = true;
  f.nestedControlsUseRowStyle = false;
  f.controlsFillRow = true;
  f.toggleRowHeight = 20.333;
  f.textFieldRowHeight = -1;
  f.sliderRowHeight = -1;
  f.pickerRowHeight = 20.333;
  m.form = f;
  m.list = f;
  return m;
}

LayoutResult layout(const HostSpec& host, const Node& root, TextMeasurer& measurer, const ControlMetrics& metrics) {
  Store store;
  Context ctx{measurer, metrics, store};
  Builder builder(ctx);
  Env env = builder.rootEnv();

  std::vector<ViewPtr> children;
  builder.flattenNode(root, "0", env, children, {});

  auto zstack = std::make_shared<ZStackView>(ctx, children, Alignment2D{host.rightToLeft ? HAlign::trailing : HAlign::leading, VAlign::top});
  ViewPtr v = std::make_shared<FixedSizeView>(zstack, host.matchContentsHorizontal, host.matchContentsVertical);
  v = std::make_shared<RecordView>(v, store, "host.content", false);
  v = std::make_shared<FlexFrameView>(
      v, FlexFrameView::Axis1{host.matchContentsHorizontal ? OptD(0.0) : OptD(), OptD(), kInf},
      FlexFrameView::Axis1{host.matchContentsVertical ? OptD(0.0) : OptD(), OptD(), kInf},
      Alignment2D{host.rightToLeft ? HAlign::trailing : HAlign::leading, VAlign::top});
  v = std::make_shared<RecordView>(v, store, "host", false);

  Proposal p{host.width, host.height};
  Size s = v->size(p);
  v->place({(host.width - s.width) / 2, (host.height - s.height) / 2, s.width, s.height}, p, 0, 0);

  Rect hostFrame = store.frames["host"];
  Rect contentFrame = store.frames.count("host.content") ? store.frames["host.content"] : hostFrame;

  LayoutResult result;
  result.host.width = host.matchContentsHorizontal ? contentFrame.width : host.width;
  result.host.height = host.matchContentsVertical ? contentFrame.height : host.height;
  result.unsupported = store.unsupported;

  auto relative = [&](Rect r) { return Rect{r.x - hostFrame.x, r.y - hostFrame.y, r.width, r.height}; };

  std::map<std::string, NodeLayout> nodes;
  for (auto& [path, node] : store.nodes) {
    NodeLayout out = node;
    if (!node.isVirtual && !node.platformRendered) {
      auto f = store.frames.find(path);
      if (f != store.frames.end()) {
        out.frame = relative(f->second);
      }
      auto c = store.contentFrames.find(path);
      if (c != store.contentFrames.end() && out.frame) {
        Rect cr = relative(c->second);
        const Rect& fr = *out.frame;
        if (cr.x != fr.x || cr.y != fr.y || cr.width != fr.width || cr.height != fr.height) {
          out.contentFrame = cr;
        }
      }
    }
    nodes[path] = out;
  }
  // Virtual nodes: union of descendant frames.
  for (auto& [path, node] : nodes) {
    if (!node.isVirtual) {
      continue;
    }
    std::optional<Rect> u;
    std::string prefix = path + "/";
    for (const auto& [p2, n2] : nodes) {
      if (p2.compare(0, prefix.size(), prefix) != 0 || n2.isVirtual || !n2.frame) {
        continue;
      }
      const Rect& f = *n2.frame;
      if (!u) {
        u = f;
      } else {
        double x0 = std::min(u->x, f.x), y0 = std::min(u->y, f.y);
        double x1 = std::max(u->x + u->width, f.x + f.width), y1 = std::max(u->y + u->height, f.y + f.height);
        u = Rect{x0, y0, x1 - x0, y1 - y0};
      }
    }
    node.frame = u;
  }
  for (auto& [path, node] : nodes) {
    result.nodes.push_back(node);
  }
  auto key = [](const std::string& path) {
    std::vector<long> parts;
    size_t start = 0;
    while (start <= path.size()) {
      size_t end = path.find('/', start);
      if (end == std::string::npos) end = path.size();
      parts.push_back(std::stol(path.substr(start, end - start)));
      start = end + 1;
    }
    return parts;
  };
  std::sort(result.nodes.begin(), result.nodes.end(),
            [&](const NodeLayout& a, const NodeLayout& b) { return key(a.path) < key(b.path); });
  return result;
}

Value LayoutResult::toValue() const {
  auto round3 = [](double v) { return std::round(v * 1000) / 1000; };
  auto rect = [&](const Rect& r) {
    return Value(Object{{"x", round3(r.x)}, {"y", round3(r.y)}, {"width", round3(r.width)}, {"height", round3(r.height)}});
  };
  Array list;
  for (const auto& n : nodes) {
    Object o{{"path", n.path}, {"type", n.type}};
    o["frame"] = n.frame ? rect(*n.frame) : Value();
    if (n.contentFrame) o["contentFrame"] = rect(*n.contentFrame);
    if (n.isVirtual) o["virtual"] = true;
    if (n.platformRendered) o["platformRendered"] = true;
    if (n.text) o["text"] = *n.text;
    if (n.accessibilityLabel) o["accessibilityLabel"] = *n.accessibilityLabel;
    list.push_back(Value(std::move(o)));
  }
  Object out{{"host", Value(Object{{"width", round3(host.width)}, {"height", round3(host.height)}})}, {"nodes", Value(std::move(list))}};
  if (!unsupported.empty()) {
    Object u;
    for (const auto& [k, paths] : unsupported) {
      Array a;
      for (const auto& p : paths) a.push_back(Value(p));
      u[k] = Value(std::move(a));
    }
    out["unsupported"] = Value(std::move(u));
  }
  return Value(std::move(out));
}

} // namespace expoui::layout
