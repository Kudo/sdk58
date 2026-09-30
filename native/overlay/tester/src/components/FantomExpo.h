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
#include <react/renderer/graphics/Size.h>

#include <optional>

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
 * The size of an @expo/ui Host's content. Step 1 placeholder: the bounding box
 * of the Host's children's Yoga frames. This is where the SwiftUI / Compose
 * layout emulation will go (it will also write the children's frames).
 */
Size layoutExpoHostSubtree(const ShadowNode &hostShadowNode);

/*
 * `matchContents`: for every @expo/ui Host with matchContentsHorizontal or
 * matchContentsVertical, dispatches ExpoViewState::withStyleDimensions with
 * the content size (layoutExpoHostSubtree) when it changed, like the
 * platform's ShadowNodeProxy.setStyleSize; ExpoViewComponentDescriptor::adopt
 * writes it into the Yoga width/height. Asynchronous (committed when the
 * event queue is flushed). Returns the number of dispatched updates.
 */
int updateExpoHostSizes(const ShadowNode &rootShadowNode);

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
