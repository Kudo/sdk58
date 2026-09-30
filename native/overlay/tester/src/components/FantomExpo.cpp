/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomExpo.h"

#ifdef FANTOM_WITH_EXPOMODULESCORE
#include <ExpoViewComponentDescriptor.h>
#include <jsi/JSIDynamic.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/LayoutableShadowNode.h>

#include <atomic>
#include <cmath>
#include <functional>
#include <limits>
#include <mutex>
#include <string_view>
#include <unordered_map>
#include <unordered_set>

#ifdef FANTOM_EXPO_UI_LAYOUT_ENGINE
#include "FantomExpoText.h"
#include "expoui/layout/Layout.h"
#endif
#endif

namespace facebook::react {

#ifdef FANTOM_WITH_EXPOMODULESCORE

namespace {

constexpr std::string_view kExpoViewPrefix = "ViewManagerAdapter_";
constexpr std::string_view kExpoUIPrefix = "ViewManagerAdapter_ExpoUI_";
constexpr std::string_view kExpoUIHostName = "ViewManagerAdapter_ExpoUI_HostView";

using ExpoShadowNode = expo::ExpoViewShadowNode<expo::ExpoViewProps, expo::ExpoViewState>;

bool startsWith(std::string_view value, std::string_view prefix) {
  return value.substr(0, prefix.size()) == prefix;
}

const expo::ExpoViewProps* expoProps(const ShadowNode& shadowNode) {
  return dynamic_cast<const expo::ExpoViewProps*>(shadowNode.getProps().get());
}

bool propIsTrue(const expo::ExpoViewProps& props, const char* name) {
  auto it = props.propsMap.find(name);
  return it != props.propsMap.end() && it->second.isBool() && it->second.getBool();
}

constexpr std::string_view kExpoUIRNHostViewName =
    "ViewManagerAdapter_ExpoUI_RNHostView";

bool isExpoView(const ShadowNode& shadowNode) {
  return expoProps(shadowNode) != nullptr;
}

/*
 * Writes the emulated frames into the Expo views under `parent`. Each child
 * with a frame is cloned (`clone({})`: a new, unsealed node; the ones from the
 * Yoga pass may be shared with the previous revision), its layout metrics
 * get the frame (displayType, layoutDirection, pointScaleFactor stay the
 * Yoga pass's), and it replaces the child in `parent`
 * (YogaLayoutableShadowNode::replaceChild keeps the Yoga tree in sync). The
 * children of an RNHostView (RN content) keep their Yoga layout.
 */
void writeFrames(
    ShadowNode& parent,
    const std::unordered_map<Tag, Rect>& frames) {
  auto children = parent.getChildren();
  for (size_t index = 0; index < children.size(); index++) {
    const auto& child = children[index];
    auto it = frames.find(child->getTag());
    if (it == frames.end()) {
      continue;
    }
    auto clone = child->clone({});
    auto* layoutable = dynamic_cast<LayoutableShadowNode*>(clone.get());
    if (layoutable == nullptr) {
      continue;
    }
    auto metrics = layoutable->getLayoutMetrics();
    metrics.frame = it->second;
    layoutable->setLayoutMetrics(metrics);
    if (clone->getComponentName() != kExpoUIRNHostViewName) {
      writeFrames(*clone, frames);
    }
    parent.replaceChild(*child, clone, index);
  }
}

/*
 * @expo/ui Host: after the Yoga pass (which lays out the Host from its RN
 * style and gives the nested Expo views placeholder frames), runs the
 * emulated layout of the subtree for the Host's size and writes the frames.
 */
class FantomExpoHostShadowNode final : public ExpoShadowNode {
 public:
  using ExpoShadowNode::ExpoShadowNode;

  void layout(LayoutContext layoutContext) override {
    ExpoShadowNode::layout(layoutContext);
    auto result =
        layoutExpoHostSubtree(*this, getLayoutMetrics().frame.size);
    writeFrames(*this, result.frames);
  }
};

} // namespace

void registerExpoViewComponentDescriptors(
    const std::shared_ptr<ComponentDescriptorProviderRegistry>&
        providerRegistry) {
  std::weak_ptr<ComponentDescriptorProviderRegistry> weakRegistry =
      providerRegistry;
  providerRegistry->setComponentDescriptorProviderRequest(
      [weakRegistry](ComponentName componentName) {
        if (!startsWith(componentName, kExpoViewPrefix)) {
          return;
        }
        auto registry = weakRegistry.lock();
        if (!registry) {
          return;
        }
        // One flavor per name, kept for the process lifetime (the component
        // handle is the name pointer).
        static std::mutex flavorsMutex;
        static std::unordered_map<std::string, std::shared_ptr<const std::string>>
            flavors;
        std::shared_ptr<const std::string> flavor;
        {
          std::lock_guard<std::mutex> lock(flavorsMutex);
          auto& entry = flavors[componentName];
          if (!entry) {
            entry = std::make_shared<const std::string>(componentName);
          }
          flavor = entry;
        }
        ComponentName name = flavor->c_str();
        registry->add(ComponentDescriptorProvider{
            reinterpret_cast<ComponentHandle>(name),
            name,
            flavor,
            componentName == kExpoUIHostName
                ? &concreteComponentDescriptorConstructor<
                      expo::ExpoViewComponentDescriptor<FantomExpoHostShadowNode>>
                : &concreteComponentDescriptorConstructor<
                      expo::ExpoViewComponentDescriptor<>>});
      });
}

namespace {

// Fake layout (see FantomExpo.h). Returns the height of `node`'s rows.
Float fakeLayoutChildren(
    const ShadowNode& node,
    Float width,
    std::unordered_map<Tag, Rect>& frames) {
  constexpr Float kRowHeight = 40;
  Float y = 0;
  for (const auto& child : node.getChildren()) {
    if (!isExpoView(*child)) {
      continue;
    }
    Size size;
    if (child->getComponentName() == kExpoUIRNHostViewName) {
      const auto* layoutable =
          dynamic_cast<const LayoutableShadowNode*>(child.get());
      size = layoutable != nullptr ? layoutable->getLayoutMetrics().frame.size
                                   : Size{};
    } else {
      auto rows = fakeLayoutChildren(*child, width, frames);
      size = Size{width, rows > 0 ? rows : kRowHeight};
    }
    frames[child->getTag()] = Rect{Point{0, y}, size};
    y += size.height;
  }
  return y;
}

#ifdef FANTOM_EXPO_UI_LAYOUT_ENGINE

namespace layout = expoui::layout;

std::atomic<bool> gExpoUIMacOS{false};

// The @expo/ui view names of the SwiftUI views (ios/ExpoUIModule.swift) and the
// names both platforms use. A Host whose subtree has only these names is laid
// out by the SwiftUI engine; any other name (ColumnView, RowView, SwitchView,
// ...) makes it a Compose Host.
const std::unordered_set<std::string_view>& swiftUIViewNames() {
  static const std::unordered_set<std::string_view> names = {
      // SwiftUI only
      "AccessoryWidgetBackgroundView", "AlertView", "BackgroundView", "BottomSheetView", "CapsuleView",
      "ChartView", "CircleView", "ColorPickerView", "ConcentricRectangleView", "ConfirmationDialogView",
      "ContentUnavailableView", "ContextMenu", "ControlGroupView", "DataListForEachItemView",
      "DataListForEachPoolView", "DataListForEachView", "DatePickerView", "DisclosureGroupView", "DividerView",
      "EllipseView", "FormView", "GaugeView", "GlassEffectContainerView", "GridRowView", "GridView", "GroupView",
      "HStackView", "LabeledContentView", "LabelView", "LazyHStackView", "LazyVStackView", "LinkView",
      "ListForEachView", "ListView", "MenuView", "NamespaceView", "NavigationLinkView", "NavigationSplitViewView",
      "NavigationStackView", "OverlayView", "PickerView", "PopoverView", "ProgressView", "RectangleView",
      "RoundedRectangleView", "ScrollViewComponent", "SectionView", "SecureFieldView", "ShareLinkView",
      "StepperView", "SwipeActionsView", "SyncToggleView", "Tab", "TabView", "ToggleView", "ToolbarView",
      "UnevenRoundedRectangleView", "VStackView", "ZStackView",
      // both platforms
      "Button", "HostView", "ImageView", "MaskView", "RNHostView", "SliderView", "SlotView", "SpacerView",
      "TextFieldView", "TextView",
  };
  return names;
}

std::string_view viewName(const ShadowNode& node) {
  std::string_view name = node.getComponentName();
  return startsWith(name, kExpoUIPrefix) ? name.substr(kExpoUIPrefix.size()) : std::string_view{};
}

bool isSwiftUISubtree(const ShadowNode& node) {
  for (const auto& child : node.getChildren()) {
    if (!isExpoView(*child)) {
      continue;
    }
    auto name = viewName(*child);
    if (name.empty() || swiftUIViewNames().count(name) == 0) {
      return false;
    }
    if (name != "RNHostView" && !isSwiftUISubtree(*child)) {
      return false;
    }
  }
  return true;
}

// The engine's component name for an @expo/ui SwiftUI view name (the names of
// the @expo/ui components: VStackView -> VStack, ScrollViewComponent ->
// ScrollView, ...). Unknown names keep their name minus "View"; the engine
// reports them as unsupported and gives them no frame.
std::string engineType(std::string_view view) {
  static const std::unordered_map<std::string_view, std::string_view> names = {
      {"VStackView", "VStack"}, {"HStackView", "HStack"}, {"ZStackView", "ZStack"},
      {"TextView", "Text"}, {"Button", "Button"}, {"ToggleView", "Toggle"},
      {"SliderView", "Slider"}, {"SpacerView", "Spacer"}, {"ImageView", "Image"},
      {"ListView", "List"}, {"FormView", "Form"}, {"SectionView", "Section"},
      {"GroupView", "Group"}, {"ScrollViewComponent", "ScrollView"}, {"PickerView", "Picker"},
      {"TextFieldView", "TextField"}, {"SecureFieldView", "SecureField"}, {"DividerView", "Divider"},
      {"LabelView", "Label"}, {"SlotView", "Slot"}, {"RNHostView", "RNHost"},
  };
  auto it = names.find(view);
  if (it != names.end()) {
    return std::string(it->second);
  }
  std::string name(view);
  if (name.size() > 4 && name.compare(name.size() - 4, 4, "View") == 0) {
    name.resize(name.size() - 4);
  }
  return name;
}

layout::Value toValue(const folly::dynamic& value) {
  switch (value.type()) {
    case folly::dynamic::Type::BOOL:
      return layout::Value(value.getBool());
    case folly::dynamic::Type::INT64:
      return layout::Value(static_cast<double>(value.getInt()));
    case folly::dynamic::Type::DOUBLE:
      return layout::Value(value.getDouble());
    case folly::dynamic::Type::STRING:
      return layout::Value(value.getString());
    case folly::dynamic::Type::ARRAY: {
      layout::Array array;
      for (const auto& item : value) {
        array.push_back(toValue(item));
      }
      return layout::Value(std::move(array));
    }
    case folly::dynamic::Type::OBJECT: {
      layout::Object object;
      for (const auto& [key, item] : value.items()) {
        object[key.asString()] = toValue(item);
      }
      return layout::Value(std::move(object));
    }
    default:
      return layout::Value();
  }
}

/*
 * Shadow tree -> engine input. `paths` maps each engine path ("0/1/2") to the
 * tag of its shadow node. An RNHostView becomes a leaf `RNHost` with its
 * measured (Yoga) size as props.width/height; RN content inside it is not
 * part of the input.
 */
void buildEngineNode(
    const ShadowNode& shadowNode,
    const std::string& path,
    layout::Node& out,
    std::unordered_map<std::string, Tag>& paths) {
  paths[path] = shadowNode.getTag();
  out.type = engineType(viewName(shadowNode));
  if (const auto* props = expoProps(shadowNode)) {
    for (const auto& [key, value] : props->propsMap) {
      if (key == "modifiers") {
        if (value.isArray()) {
          for (const auto& modifier : value) {
            if (modifier.isObject()) {
              out.modifiers.push_back(toValue(modifier).asObject());
            }
          }
        }
      } else {
        out.props[key] = toValue(value);
      }
    }
  }
  if (out.type == "RNHost") {
    const auto* layoutable = dynamic_cast<const LayoutableShadowNode*>(&shadowNode);
    Size size = layoutable != nullptr ? layoutable->getLayoutMetrics().frame.size : Size{};
    out.props["width"] = layout::Value(static_cast<double>(size.width));
    out.props["height"] = layout::Value(static_cast<double>(size.height));
    return;
  }
  for (const auto& child : shadowNode.getChildren()) {
    if (!isExpoView(*child)) {
      continue;
    }
    layout::Node node;
    buildEngineNode(*child, path + "/" + std::to_string(out.children.size()), node, paths);
    out.children.push_back(std::move(node));
  }
}

int weightNumber(const std::string& weight) {
  static const std::unordered_map<std::string, int> weights = {
      {"ultraLight", 100}, {"thin", 200}, {"light", 300}, {"regular", 400}, {"medium", 500},
      {"semibold", 600}, {"bold", 700}, {"heavy", 800}, {"black", 900},
  };
  auto it = weights.find(weight);
  return it == weights.end() ? 400 : it->second;
}

/*
 * TextMeasurer on the host's CoreText TextLayoutManager (measureExpoText).
 * SF Symbols: sizes measured on the iOS 26.5 simulator at 17 pt, scaled by
 * the point size; other names get a box of 1.2 x 1.1 times the point size.
 */
class HostTextMeasurer final : public layout::TextMeasurer {
 public:
  explicit HostTextMeasurer(Float pointScaleFactor) : scale_(pointScaleFactor) {}

  layout::TextMeasurement measureText(
      const std::string& text,
      const layout::FontSpec& font,
      double maxWidth,
      int maxLines) override {
    auto options = optionsFor(font);
    options.maxWidth = std::isfinite(maxWidth) ? static_cast<Float>(maxWidth)
                                               : std::numeric_limits<Float>::infinity();
    options.maxLines = maxLines;
    auto size = measureExpoText(text, options, scale_);
    double line = lineHeight(font);
    layout::TextMeasurement m;
    m.width = size.width;
    m.height = size.height;
    m.lines = line > 0 ? std::max(1, static_cast<int>(std::lround(size.height / line))) : 1;
    m.firstBaseline = font.ascender > 0 ? font.ascender : font.pointSize * 0.95;
    return m;
  }

  double lineHeight(const layout::FontSpec& font) override {
    return measureExpoText("A", optionsFor(font), scale_).height;
  }

  layout::Size measureSymbol(const std::string& name, const layout::FontSpec& font) override {
    static const std::unordered_map<std::string, std::pair<double, double>> kSymbols17 = {
        {"star", {22, 20}}, {"star.fill", {22, 20}}, {"heart", {20.667, 17.333}},
        {"heart.fill", {20.667, 17.333}}, {"speaker.wave.2", {24, 16.667}},
        {"speaker.wave.3", {27.667, 18.333}}, {"chevron.right", {12.667, 16.667}},
        {"gearshape", {20.667, 20}}, {"person.crop.circle", {19.667, 19}},
        {"square.and.arrow.up", {19, 22}}, {"trash", {19, 20.667}}, {"wifi", {22.667, 16}},
        {"bell", {19, 19.333}}, {"minus", {18, 3.667}}, {"plus", {18, 16}},
        {"ellipsis", {18.333, 5.333}}, {"envelope", {24.333, 16.333}},
    };
    double k = font.pointSize / 17;
    auto it = kSymbols17.find(name);
    auto base = it != kSymbols17.end() ? it->second : std::pair<double, double>{1.2 * 17, 1.1 * 17};
    return {base.first * k, base.second * k};
  }

 private:
  ExpoTextMeasureOptions optionsFor(const layout::FontSpec& font) const {
    ExpoTextMeasureOptions options;
    options.fontFamily = font.family;
    options.size = static_cast<Float>(font.pointSize);
    options.weight = weightNumber(font.weight);
    options.design = font.design == "default" ? "" : font.design;
    return options;
  }

  Float scale_;
};

ExpoLayoutResult layoutSwiftUIHost(const ShadowNode& host, Size proposal) {
  ExpoLayoutResult result;
  const auto* props = expoProps(host);
  const auto* layoutable = dynamic_cast<const LayoutableShadowNode*>(&host);
  Float scale = layoutable != nullptr ? layoutable->getLayoutMetrics().pointScaleFactor : 3;
  if (!(scale > 0)) {
    scale = 3;
  }

  layout::HostSpec spec;
  spec.matchContentsHorizontal = props != nullptr && propIsTrue(*props, "matchContentsHorizontal");
  spec.matchContentsVertical = props != nullptr && propIsTrue(*props, "matchContentsVertical");
  if (props != nullptr) {
    auto it = props->propsMap.find("layoutDirection");
    spec.rightToLeft = it != props->propsMap.end() && it->second.isString() &&
        it->second.getString() == "rightToLeft";
  }
  // An unbounded proposal (matchContents measuring) cannot size the Host's
  // filling frame; 0 keeps the content's own size on the matchContents axes.
  spec.width = std::isfinite(proposal.width) ? proposal.width : 0;
  spec.height = std::isfinite(proposal.height) ? proposal.height : 0;

  // The Host's children are the content of a top-leading ZStack; a Group root
  // (path "0") holds them.
  layout::Node root;
  root.type = "Group";
  std::unordered_map<std::string, Tag> paths;
  for (const auto& child : host.getChildren()) {
    if (!isExpoView(*child)) {
      continue;
    }
    layout::Node node;
    buildEngineNode(*child, "0/" + std::to_string(root.children.size()), node, paths);
    root.children.push_back(std::move(node));
  }

  auto metrics = gExpoUIMacOS.load() ? layout::ControlMetrics::macos() : layout::ControlMetrics::ios();
  metrics.pixelScale = scale;
  HostTextMeasurer measurer(scale);
  auto layoutResult = layout::layout(spec, root, measurer, metrics);
  result.contentSize = Size{
      static_cast<Float>(layoutResult.host.width), static_cast<Float>(layoutResult.host.height)};

  // Engine frames are relative to the Host; the hook's are relative to the
  // parent. Nodes without an engine frame (slots, nested Text spans, Picker
  // options, unsupported views) get the union of their children's frames, or
  // an empty frame at their parent's origin.
  std::unordered_map<Tag, Rect> absolute;
  for (const auto& node : layoutResult.nodes) {
    auto it = paths.find(node.path);
    if (it == paths.end() || !node.frame) {
      continue;
    }
    const auto& f = *node.frame;
    absolute[it->second] = Rect{
        Point{static_cast<Float>(f.x), static_cast<Float>(f.y)},
        Size{static_cast<Float>(f.width), static_cast<Float>(f.height)}};
  }
  std::function<std::optional<Rect>(const ShadowNode&)> unionOf = [&](const ShadowNode& node) {
    std::optional<Rect> own;
    auto it = absolute.find(node.getTag());
    if (it != absolute.end()) {
      own = it->second;
    }
    std::optional<Rect> children;
    if (node.getComponentName() != kExpoUIRNHostViewName) {
      for (const auto& child : node.getChildren()) {
        if (!isExpoView(*child)) {
          continue;
        }
        if (auto rect = unionOf(*child)) {
          if (children) {
            children->unionInPlace(*rect);
          } else {
            children = *rect;
          }
        }
      }
    }
    if (!own && children) {
      absolute[node.getTag()] = *children;
      own = children;
    }
    return own;
  };
  std::function<void(const ShadowNode&, Point)> relative = [&](const ShadowNode& node, Point parentOrigin) {
    for (const auto& child : node.getChildren()) {
      if (!isExpoView(*child)) {
        continue;
      }
      auto it = absolute.find(child->getTag());
      Rect abs = it != absolute.end() ? it->second : Rect{parentOrigin, Size{0, 0}};
      result.frames[child->getTag()] =
          Rect{Point{abs.origin.x - parentOrigin.x, abs.origin.y - parentOrigin.y}, abs.size};
      if (child->getComponentName() != kExpoUIRNHostViewName) {
        relative(*child, abs.origin);
      }
    }
  };
  for (const auto& child : host.getChildren()) {
    if (isExpoView(*child)) {
      unionOf(*child);
    }
  }
  relative(host, Point{0, 0});
  return result;
}
#endif

} // namespace

ExpoLayoutResult layoutExpoHostSubtree(
    const ShadowNode& hostShadowNode,
    Size proposal) {
  ExpoLayoutResult result;
#ifdef FANTOM_EXPO_UI_LAYOUT_ENGINE
  if (isSwiftUISubtree(hostShadowNode)) {
    return layoutSwiftUIHost(hostShadowNode, proposal);
  }
  // Compose Hosts: the Compose engine is not wired in yet; the fake layout
  // below keeps them usable.
#endif
  auto height = fakeLayoutChildren(hostShadowNode, proposal.width, result.frames);
  result.contentSize = Size{proposal.width, height};
  return result;
}

void setExpoUIPlatform(const std::string& platform) {
#ifdef FANTOM_EXPO_UI_LAYOUT_ENGINE
  gExpoUIMacOS.store(platform == "macos");
#else
  (void)platform;
#endif
}

namespace {

bool sameDimension(Float lhs, Float rhs) {
  if (std::isnan(lhs) || std::isnan(rhs)) {
    return std::isnan(lhs) && std::isnan(rhs);
  }
  return std::abs(lhs - rhs) < 0.01;
}

int updateHostSizes(const ShadowNode& node) {
  int updates = 0;
  for (const auto& child : node.getChildren()) {
    if (child->getComponentName() == kExpoUIHostName) {
      const auto* props = expoProps(*child);
      const auto* host = dynamic_cast<const ExpoShadowNode*>(child.get());
      if (props != nullptr && host != nullptr) {
        bool horizontal = propIsTrue(*props, "matchContentsHorizontal");
        bool vertical = propIsTrue(*props, "matchContentsVertical");
        if (horizontal || vertical) {
          const auto& hostFrame = host->getLayoutMetrics().frame;
          auto size = layoutExpoHostSubtree(
                          *child,
                          Size{
                              hostFrame.size.width,
                              std::numeric_limits<Float>::infinity()})
                          .contentSize;
          constexpr Float kNaN = std::numeric_limits<Float>::quiet_NaN();
          Float width = horizontal ? size.width : kNaN;
          Float height = vertical ? size.height : kNaN;
          const auto& state = host->getStateData();
          if (!sameDimension(state._styleWidth, width) ||
              !sameDimension(state._styleHeight, height)) {
            auto concreteState =
                std::static_pointer_cast<const ExpoShadowNode::ConcreteState>(
                    child->getState());
            concreteState->updateState(
                expo::ExpoViewState::withStyleDimensions(width, height));
            updates++;
          }
        }
      }
    }
    updates += updateHostSizes(*child);
  }
  return updates;
}

} // namespace

int updateExpoHostSizes(const ShadowNode& rootShadowNode) {
  return updateHostSizes(rootShadowNode);
}

bool dispatchExpoModifierEvent(
    const ShadowNode& shadowNode,
    const std::string& type,
    const folly::dynamic& params) {
  if (!isExpoView(shadowNode)) {
    return false;
  }
  auto eventEmitter = std::dynamic_pointer_cast<const expo::ExpoViewEventEmitter>(
      shadowNode.getEventEmitter());
  if (eventEmitter == nullptr) {
    return false;
  }
  // SwiftUI (modifiers/utils.ts) reads `{[type]: params}`; Compose reads
  // `payload` as `[type, params]` (jetpack-compose/modifiers/utils.ts).
  folly::dynamic payload = folly::dynamic::object(type, params)(
      "payload", folly::dynamic::array(type, params));
  eventEmitter->dispatch(
      "globalEvent", [payload](jsi::Runtime& runtime) {
        return jsi::valueFromDynamic(runtime, payload);
      });
  return true;
}

std::optional<ExpoViewInfo> getExpoViewInfo(const ShadowNode& shadowNode) {
  const auto* props = expoProps(shadowNode);
  if (props == nullptr) {
    return std::nullopt;
  }
  std::string_view name = shadowNode.getComponentName();
  ExpoViewInfo info;
  if (startsWith(name, kExpoUIPrefix)) {
    info.type = "ExpoUI." + std::string(name.substr(kExpoUIPrefix.size()));
    if (name == kExpoUIHostName &&
        (propIsTrue(*props, "matchContentsHorizontal") ||
         propIsTrue(*props, "matchContentsVertical"))) {
      info.layout = "emulated";
    } else if (name != kExpoUIHostName) {
      info.layout = "placeholder";
    }
  } else if (startsWith(name, kExpoViewPrefix)) {
    info.type = "Expo." + std::string(name.substr(kExpoViewPrefix.size()));
  } else {
    info.type = std::string(name);
  }
  info.props = folly::dynamic::object();
  for (const auto& [key, value] : props->propsMap) {
    info.props[key] = value;
  }
  return info;
}

#else

void registerExpoViewComponentDescriptors(
    const std::shared_ptr<ComponentDescriptorProviderRegistry>&
    /*providerRegistry*/) {}

ExpoLayoutResult layoutExpoHostSubtree(
    const ShadowNode& /*hostShadowNode*/,
    Size /*proposal*/) {
  return {};
}

bool dispatchExpoModifierEvent(
    const ShadowNode& /*shadowNode*/,
    const std::string& /*type*/,
    const folly::dynamic& /*params*/) {
  return false;
}

int updateExpoHostSizes(const ShadowNode& /*rootShadowNode*/) {
  return 0;
}

std::optional<ExpoViewInfo> getExpoViewInfo(const ShadowNode& /*shadowNode*/) {
  return std::nullopt;
}

void setExpoUIPlatform(const std::string& /*platform*/) {}

#endif

} // namespace facebook::react
