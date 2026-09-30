/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomScreens.h"
#include "FantomSafeArea.h"

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

#include <algorithm>
#include <cstring>
#include <mutex>
#include <unordered_map>
#include <vector>
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

namespace {

/*
 * RNSScreen descriptor: the non-Android branch of the library's
 * RNSScreenComponentDescriptor (Yoga size = state.frameSize), plus a bottom
 * padding of state.contentOffset.y. The children (the content wrapper) are
 * laid out below the header offset, so the content area ends at the bottom of
 * the screen instead of one header height below it (the area the platform
 * shows below the header). With a translucent or large-title header the
 * offset is 0 (see updateScreen), so there is no padding.
 */
class FantomRNSScreenComponentDescriptor final
    : public ConcreteComponentDescriptor<RNSScreenShadowNode> {
 public:
  using ConcreteComponentDescriptor::ConcreteComponentDescriptor;

  void adopt(ShadowNode& shadowNode) const override {
    auto& screenShadowNode = static_cast<RNSScreenShadowNode&>(shadowNode);
    const auto& stateData = screenShadowNode.getStateData();
    if (stateData.frameSize.width != 0 && stateData.frameSize.height != 0) {
      screenShadowNode.setSize(stateData.frameSize);
      screenShadowNode.setPadding(
          {.left = 0, .top = 0, .right = 0, .bottom = stateData.contentOffset.y});
    }
    ConcreteComponentDescriptor::adopt(shadowNode);
  }
};

} // namespace

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
      concreteComponentDescriptorProvider<FantomRNSScreenComponentDescriptor>());
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

std::mutex lifecycleMutex;
// RNSScreenStack tag -> tags of its RNSScreen children at the last update.
std::unordered_map<Tag, std::vector<Tag>> stackScreens;
// RNSScreen tag -> last header height sent with onHeaderHeightChange.
std::unordered_map<Tag, Float> emittedHeaderHeights;

std::shared_ptr<const RNSScreenEventEmitter> screenEventEmitter(
    const ShadowNode& screen) {
  return std::dynamic_pointer_cast<const RNSScreenEventEmitter>(
      screen.getEventEmitter());
}

/*
 * Events a native stack sends for a push/pop without animation: the new top
 * screen gets onWillAppear and onAppear, the screen that is no longer on top
 * (if still in the stack) gets onWillDisappear and onDisappear. The top
 * screen is the last RNSScreen child. Screens removed by JS get no events
 * (their components are already unmounted; onDismissed is only sent for
 * dismissals that start on the native side, which do not exist here).
 */
int emitStackLifecycleEvents(const ShadowNode& stack) {
  std::vector<std::shared_ptr<const ShadowNode>> screens;
  std::vector<Tag> tags;
  for (const auto& child : stack.getChildren()) {
    if (isComponent(*child, "RNSScreen")) {
      screens.push_back(child);
      tags.push_back(child->getTag());
    }
  }

  std::vector<Tag> previousTags;
  {
    std::lock_guard<std::mutex> lock(lifecycleMutex);
    auto it = stackScreens.find(stack.getTag());
    if (it != stackScreens.end()) {
      previousTags = it->second;
    }
    if (previousTags == tags) {
      return 0;
    }
    stackScreens[stack.getTag()] = tags;
  }

  std::optional<Tag> previousTop =
      previousTags.empty() ? std::nullopt : std::optional{previousTags.back()};
  std::optional<Tag> currentTop =
      tags.empty() ? std::nullopt : std::optional{tags.back()};
  if (previousTop == currentTop) {
    return 0;
  }

  std::shared_ptr<const RNSScreenEventEmitter> disappearing;
  if (previousTop.has_value()) {
    for (const auto& screen : screens) {
      if (screen->getTag() == *previousTop) {
        disappearing = screenEventEmitter(*screen);
      }
    }
  }
  auto appearing =
      screens.empty() ? nullptr : screenEventEmitter(*screens.back());

  int events = 0;
  if (disappearing) {
    disappearing->onWillDisappear({});
    events++;
  }
  if (appearing) {
    appearing->onWillAppear({});
    events++;
  }
  if (disappearing) {
    disappearing->onDisappear({});
    events++;
  }
  if (appearing) {
    appearing->onAppear({});
    events++;
  }
  return events;
}

int updateScreen(
    const ShadowNode& screen,
    const ShadowNode& parent,
    Float screenTopInset,
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
  bool hasVisibleHeader =
      inStack && headerConfig != nullptr && isHeaderVisible(*headerConfig);
  // The native bar is below the status bar (the safe area top inset that
  // overlaps the screen). The content starts below the bar unless the header
  // is translucent or a large title.
  Float contentOffsetY =
      hasVisibleHeader && headerOffsetsContent(*headerConfig)
      ? screenTopInset + headerHeight
      : 0;

  int updates = 0;

  // onHeaderHeightChange: status bar + bar height (iOS calculateHeaderHeight),
  // 0 without a visible header.
  Float emittedHeaderHeight =
      hasVisibleHeader ? screenTopInset + headerHeight : 0;
  bool headerHeightChanged = false;
  {
    std::lock_guard<std::mutex> lock(lifecycleMutex);
    auto it = emittedHeaderHeights.find(screen.getTag());
    if (it == emittedHeaderHeights.end() || it->second != emittedHeaderHeight) {
      emittedHeaderHeights[screen.getTag()] = emittedHeaderHeight;
      headerHeightChanged = true;
    }
  }
  if (headerHeightChanged) {
    if (auto eventEmitter = screenEventEmitter(screen)) {
      eventEmitter->onHeaderHeightChange({.headerHeight = emittedHeaderHeight});
      updates++;
    }
  }

  const auto& screenData = screenShadowNode->getStateData();
  if (screenData.frameSize != parentSize ||
      screenData.contentOffset != Point{0, contentOffsetY}) {
    auto state =
        std::static_pointer_cast<const RNSScreenShadowNode::ConcreteState>(
            screen.getState());
    state->updateState(RNSScreenState{parentSize, {0, contentOffsetY}});
    updates++;
  }

  if (hasVisibleHeader) {
    const auto* headerShadowNode =
        dynamic_cast<const RNSScreenStackHeaderConfigShadowNode*>(
            headerConfig);
    if (headerShadowNode != nullptr) {
      // frameOrigin is relative to the screen's content origin.
      auto newData = RNSScreenStackHeaderConfigState(
          Size{parentSize.width, headerHeight},
          EdgeInsets{0, 0, 0, 0},
          Point{0, screenTopInset - contentOffsetY});
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

// `contentOrigin`: origin of `node`'s children in root coordinates.
int updateSubtree(
    const ShadowNode& node,
    Point contentOrigin,
    Float windowTopInset,
    Float headerHeight) {
  int updates = 0;
  for (const auto& child : node.getChildren()) {
    const auto* layoutable =
        dynamic_cast<const LayoutableShadowNode*>(child.get());
    if (layoutable == nullptr) {
      continue;
    }
    auto origin = contentOrigin + layoutable->getLayoutMetrics().frame.origin;
    if (isComponent(*child, "RNSScreenStack")) {
      updates += emitStackLifecycleEvents(*child);
    }
    if (isComponent(*child, "RNSScreen")) {
      auto screenTopInset = std::max<Float>(0, windowTopInset - origin.y);
      updates += updateScreen(*child, node, screenTopInset, headerHeight);
    }
    updates += updateSubtree(
        *child,
        origin + layoutable->getContentOriginOffset(false),
        windowTopInset,
        headerHeight);
  }
  return updates;
}

} // namespace

int updateScreenStates(const ShadowNode& rootShadowNode) {
  return updateSubtree(
      rootShadowNode,
      Point{0, 0},
      getSafeAreaInsets().top,
      getScreensHeaderHeight());
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
