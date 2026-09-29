/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomScreens.h"

#include <atomic>

#ifdef FANTOM_WITH_RNSCREENS
#include <react/renderer/components/rnscreens/ComponentDescriptors.h>
#include <react/renderer/components/rnscreens/RNSFormSheetHostComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSFullWindowOverlayComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSModalScreenComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSSafeAreaViewComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSScreenComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSScreenStackHeaderConfigComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSScreenStackHeaderSubviewComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSStackHeaderConfigComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSStackHeaderItemComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSStackHeaderSubviewComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSStackScreenComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSTabsBottomAccessoryComponentDescriptor.h>
#include <react/renderer/components/rnscreens/RNSTabsHostComponentDescriptor.h>
#include <react/renderer/core/LayoutableShadowNode.h>

#include <cstring>
#endif

namespace facebook::react {

namespace {
std::atomic<Float> screensHeaderHeight{56};
} // namespace

void setScreensHeaderHeight(Float headerHeight) {
  screensHeaderHeight = headerHeight;
}

Float getScreensHeaderHeight() {
  return screensHeaderHeight;
}

#ifdef FANTOM_WITH_RNSCREENS

void registerScreensComponentDescriptors(
    const std::shared_ptr<ComponentDescriptorProviderRegistry>&
        providerRegistry) {
  rnscreens_registerComponentDescriptorsFromCodegen(providerRegistry);
  providerRegistry->add(
      concreteComponentDescriptorProvider<RNSFormSheetHostComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<RNSFullWindowOverlayComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<RNSModalScreenComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<RNSSafeAreaViewComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<RNSScreenComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<
          RNSScreenStackHeaderConfigComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<
          RNSScreenStackHeaderSubviewComponentDescriptor>());
  registerScreensSplitScreenComponentDescriptor(providerRegistry);
  providerRegistry->add(
      concreteComponentDescriptorProvider<
          RNSStackHeaderConfigComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<
          RNSStackHeaderItemComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<
          RNSStackHeaderSubviewComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<RNSStackScreenComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<
          RNSTabsBottomAccessoryComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<RNSTabsHostComponentDescriptor>());
}

void insertScreensContextEntries(const ContextContainer& contextContainer) {
  // Only stored as a weak pointer by the header config state (for header
  // images, which the host does not load).
  contextContainer.insert("RCTImageLoader", std::shared_ptr<void>{});
}

namespace {

bool isComponent(const ShadowNode& node, const char* name) {
  return std::strcmp(node.getComponentName(), name) == 0;
}

Size frameSizeOf(const ShadowNode& node) {
  if (const auto* layoutable =
          dynamic_cast<const LayoutableShadowNode*>(&node)) {
    return layoutable->getLayoutMetrics().frame.size;
  }
  return {};
}

const ShadowNode* findHeaderConfig(const ShadowNode& screen) {
  for (const auto& child : screen.getChildren()) {
    if (isComponent(*child, "RNSScreenStackHeaderConfig")) {
      return child.get();
    }
  }
  return nullptr;
}

bool isHeaderVisible(const ShadowNode& headerConfig) {
  const auto& props = static_cast<const RNSScreenStackHeaderConfigProps&>(
      *headerConfig.getProps());
  return !props.hidden;
}

bool headerOffsetsContent(const ShadowNode& headerConfig) {
  const auto& props = static_cast<const RNSScreenStackHeaderConfigProps&>(
      *headerConfig.getProps());
  // RNSScreen.mm updateBounds: no offset for large title or translucent.
  return !props.hidden && !props.translucent && !props.largeTitle;
}

int updateScreen(
    const ShadowNode& screen,
    const ShadowNode& parent,
    Float headerHeight) {
  const auto* screenShadowNode =
      dynamic_cast<const RNSScreenShadowNode*>(&screen);
  if (screenShadowNode == nullptr) {
    return 0;
  }

  auto parentSize = frameSizeOf(parent);
  if (parentSize.width <= 0 || parentSize.height <= 0) {
    return 0;
  }

  const auto* headerConfig = findHeaderConfig(screen);
  bool inStack = isComponent(parent, "RNSScreenStack");
  Float contentOffsetY =
      inStack && headerConfig != nullptr && headerOffsetsContent(*headerConfig)
      ? headerHeight
      : 0;

  int updates = 0;

  const auto& screenData = screenShadowNode->getStateData();
  if (screenData.frameSize != parentSize ||
      screenData.contentOffset != Point{0, contentOffsetY}) {
    auto state =
        std::static_pointer_cast<const RNSScreenShadowNode::ConcreteState>(
            screen.getState());
    state->updateState(RNSScreenState{parentSize, {0, contentOffsetY}});
    updates++;
  }

  if (headerConfig != nullptr && inStack && isHeaderVisible(*headerConfig)) {
    const auto* headerShadowNode =
        dynamic_cast<const RNSScreenStackHeaderConfigShadowNode*>(
            headerConfig);
    if (headerShadowNode != nullptr) {
      auto newData = RNSScreenStackHeaderConfigState(
          Size{parentSize.width, headerHeight},
          EdgeInsets{0, 0, 0, 0},
          Point{0, -contentOffsetY});
      auto oldData = headerShadowNode->getStateData();
      if (oldData != newData) {
        auto state = std::static_pointer_cast<
            const RNSScreenStackHeaderConfigShadowNode::ConcreteState>(
            headerConfig->getState());
        state->updateState(std::move(newData));
        updates++;
      }
    }
  }

  return updates;
}

int updateSubtree(const ShadowNode& node, Float headerHeight) {
  int updates = 0;
  for (const auto& child : node.getChildren()) {
    if (isComponent(*child, "RNSScreen")) {
      updates += updateScreen(*child, node, headerHeight);
    }
    updates += updateSubtree(*child, headerHeight);
  }
  return updates;
}

} // namespace

int updateScreenStates(const ShadowNode& rootShadowNode) {
  return updateSubtree(rootShadowNode, getScreensHeaderHeight());
}

#else

void registerScreensComponentDescriptors(
    const std::shared_ptr<ComponentDescriptorProviderRegistry>&
    /*providerRegistry*/) {}

void insertScreensContextEntries(const ContextContainer& /*contextContainer*/) {
}

int updateScreenStates(const ShadowNode& /*rootShadowNode*/) {
  return 0;
}

#endif

} // namespace facebook::react
