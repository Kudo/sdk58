/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomExpo.h"

#ifdef FANTOM_WITH_EXPOMODULESCORE
#include <ExpoViewComponentDescriptor.h>
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
            &concreteComponentDescriptorConstructor<
                expo::ExpoViewComponentDescriptor<>>});
      });
}

Size layoutExpoHostSubtree(const ShadowNode& hostShadowNode) {
  Float minX = std::numeric_limits<Float>::infinity();
  Float minY = std::numeric_limits<Float>::infinity();
  Float maxX = -std::numeric_limits<Float>::infinity();
  Float maxY = -std::numeric_limits<Float>::infinity();
  bool hasChildren = false;
  for (const auto& child : hostShadowNode.getChildren()) {
    const auto* layoutable =
        dynamic_cast<const LayoutableShadowNode*>(child.get());
    if (layoutable == nullptr) {
      continue;
    }
    const auto& frame = layoutable->getLayoutMetrics().frame;
    minX = std::min(minX, frame.origin.x);
    minY = std::min(minY, frame.origin.y);
    maxX = std::max(maxX, frame.origin.x + frame.size.width);
    maxY = std::max(maxY, frame.origin.y + frame.size.height);
    hasChildren = true;
  }
  if (!hasChildren) {
    return {};
  }
  return Size{maxX - minX, maxY - minY};
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
          auto size = layoutExpoHostSubtree(*child);
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

Size layoutExpoHostSubtree(const ShadowNode& /*hostShadowNode*/) {
  return {};
}

int updateExpoHostSizes(const ShadowNode& /*rootShadowNode*/) {
  return 0;
}

std::optional<ExpoViewInfo> getExpoViewInfo(const ShadowNode& /*shadowNode*/) {
  return std::nullopt;
}

#endif

} // namespace facebook::react
