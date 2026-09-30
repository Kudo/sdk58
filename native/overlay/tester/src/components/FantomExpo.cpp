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

#include <cmath>
#include <limits>
#include <mutex>
#include <string_view>
#include <unordered_map>
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

#ifndef FANTOM_EXPO_UI_LAYOUT_ENGINE
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
#endif

} // namespace

ExpoLayoutResult layoutExpoHostSubtree(
    const ShadowNode& hostShadowNode,
    Size proposal) {
  ExpoLayoutResult result;
#ifndef FANTOM_EXPO_UI_LAYOUT_ENGINE
  auto height = fakeLayoutChildren(hostShadowNode, proposal.width, result.frames);
  result.contentSize = Size{proposal.width, height};
#endif
  return result;
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
  folly::dynamic payload = folly::dynamic::object(type, params)(
      "payload", folly::dynamic::object(type, params));
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

#endif

} // namespace facebook::react
