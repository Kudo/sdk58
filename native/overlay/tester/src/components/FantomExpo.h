/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <folly/dynamic.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/graphics/Rect.h>
#include <react/renderer/graphics/Size.h>

#include <optional>
#include <unordered_map>

namespace facebook::react {

/*
 * Expo module views (expo-modules-core Fabric view; @expo/ui). No-ops when
 * the tester is built without expo-modules-core (FANTOM_WITH_EXPOMODULESCORE
 * not defined).
 */

// Registers a component descriptor provider request: every unknown component
// name starting with "ViewManagerAdapter_" (the Fabric name of an Expo module
// view, for example ViewManagerAdapter_ExpoUI_HostView) gets
// expo::ExpoViewComponentDescriptor with the name as flavor, as on iOS
// (ExpoFabricViewObjC componentDescriptorProvider).
void registerExpoViewComponentDescriptors(const std::shared_ptr<ComponentDescriptorProviderRegistry> &providerRegistry);

/*
 * Layout of an @expo/ui Host subtree (the SwiftUI / Compose layout emulation).
 * `frames` maps the tag of every Expo view under the Host (not the Host
 * itself, not RN content inside an RNHostView) to its frame relative to its
 * parent. `contentSize` is the size of the Host's content for the proposal
 * (used by matchContents).
 */
struct ExpoLayoutResult {
  Size contentSize;
  std::unordered_map<Tag, Rect> frames;
};

/*
 * The layout emulation hook. With FANTOM_EXPO_UI_LAYOUT_ENGINE, a Host whose
 * subtree has only SwiftUI view names is laid out by the SwiftUI engine
 * (tester/src/expoui/layout, ControlMetrics::ios() unless
 * setExpoUIPlatform("macos")). Other Hosts (Compose names), and every Host
 * without the engine, get a fake layout: every child is a row of the
 * proposal's width, stacked vertically; a view without Expo view children is
 * 40 high, a container is as high as its rows; an RNHostView keeps its Yoga
 * (measured) size.
 */
ExpoLayoutResult layoutExpoHostSubtree(const ShadowNode &hostShadowNode, Size proposal);

// Platform metrics of the SwiftUI engine: "ios" (default) or "macos".
void setExpoUIPlatform(const std::string &platform);

/*
 * `matchContents`: for every @expo/ui Host with matchContentsHorizontal or
 * matchContentsVertical, dispatches ExpoViewState::withStyleDimensions with
 * the content size (layoutExpoHostSubtree, proposal: the Host's current width,
 * unbounded height) when it changed, like the
 * platform's ShadowNodeProxy.setStyleSize; ExpoViewComponentDescriptor::adopt
 * writes it into the Yoga width/height. Asynchronous (committed when the
 * event queue is flushed). Returns the number of dispatched updates.
 */
int updateExpoHostSizes(const ShadowNode &rootShadowNode);

/*
 * `onGlobalEvent` of an Expo view (modifier callbacks such as onTapGesture):
 * dispatches the direct event `globalEvent` with
 * `{[type]: params, payload: [type, params]}` (the SwiftUI JS reads the
 * top-level keys, the Compose JS reads `payload`). Returns false if the node
 * is not an Expo view.
 */
bool dispatchExpoModifierEvent(const ShadowNode &shadowNode, const std::string &type, const folly::dynamic &params);

// For getA11yTree: whether `shadowNode` is an Expo module view, its display
// type ("ExpoUI.<View>" or "Expo.<Module>_<View>"), and its props map.
struct ExpoViewInfo {
  std::string type;
  folly::dynamic props;
  // "emulated" for a Host sized by matchContents, "placeholder" for the
  // other @expo/ui views (Yoga frames, not SwiftUI/Compose frames).
  std::string layout;
};
std::optional<ExpoViewInfo> getExpoViewInfo(const ShadowNode &shadowNode);

} // namespace facebook::react
