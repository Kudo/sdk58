/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/graphics/Float.h>
#include <react/utils/ContextContainer.h>

namespace facebook::react {

/*
 * react-native-screens support. Everything is a no-op when the tester is built
 * without react-native-screens (FANTOM_WITH_RNSCREENS not defined).
 */

// Registers the custom (common/cpp) and codegen descriptors of
// react-native-screens.
void registerScreensComponentDescriptors(const std::shared_ptr<ComponentDescriptorProviderRegistry> &providerRegistry);

// Registers RNSSplitScreen (in its own translation unit: its header and
// RNSFullWindowOverlayShadowNode.h both declare a namespace-level
// `ConcreteViewShadowNodeSuperType` alias with different types).
void registerScreensSplitScreenComponentDescriptor(
    const std::shared_ptr<ComponentDescriptorProviderRegistry> &providerRegistry);

// Adds the context entries the screens descriptors read in adopt()
// ("RCTImageLoader" in the non-Android branch; an empty placeholder).
void insertScreensContextEntries(const ContextContainer &contextContainer);

// Height of the emulated native stack header (default 56, the Android
// toolbar height; 44 is the iOS navigation bar without status bar).
void setScreensHeaderHeight(Float headerHeight);
Float getScreensHeaderHeight();

/*
 * Emulates the state updates the native views send after layout (iOS
 * RNSScreen.mm updateBounds, RNSScreenStackHeaderConfig.mm
 * updateShadowStateWithSize):
 *  - RNSScreen: frameSize = frame size of its parent (the stack or container);
 *    contentOffset = (0, header height) when the screen is in an
 *    RNSScreenStack and has a visible, non-translucent, non-large-title
 *    RNSScreenStackHeaderConfig child, otherwise (0, 0).
 *  - RNSScreenStackHeaderConfig (visible): frameSize = (screen width, header
 *    height), no insets, frameOrigin = (0, -contentOffset.y), so the header
 *    is placed at the top of the screen, where the native bar is drawn.
 * Updates are dispatched with ConcreteState::updateState (asynchronous, like
 * the platform); they are committed when the event queue is flushed. Only
 * changed states are dispatched. Returns the number of dispatched updates.
 */
int updateScreenStates(const ShadowNode &rootShadowNode);

} // namespace facebook::react
