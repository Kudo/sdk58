/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <ReactCommon/CallInvoker.h>
#include <ReactCommon/TurboModule.h>
#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/core/ShadowNode.h>
#include <react/renderer/graphics/RectangleEdges.h>

#include <optional>

namespace facebook::react {

/*
 * react-native-safe-area-context support. No-ops when the tester is built
 * without it (FANTOM_WITH_SAFEAREACONTEXT not defined).
 */

void registerSafeAreaComponentDescriptors(const std::shared_ptr<ComponentDescriptorProviderRegistry> &providerRegistry);

// Safe area insets of the window (root view), default 0 on all edges.
void setSafeAreaInsets(EdgeInsets insets);
EdgeInsets getSafeAreaInsets();

/*
 * Emulates the native side after layout:
 *  - RNCSafeAreaProvider: emits `onInsetsChange` with
 *    {insets, frame} when they change. `frame` is the provider's frame in
 *    root coordinates; `insets` are the window insets that overlap the
 *    provider (like UIView.safeAreaInsets).
 *  - RNCSafeAreaView: sets `RNCSafeAreaViewState.insets` to the insets of the
 *    nearest RNCSafeAreaProvider ancestor (or the window insets that overlap
 *    the view if there is none); the library applies them as padding/margin.
 * Events and state updates are asynchronous (committed/delivered when the
 * event queue is flushed). Returns the number of dispatched events/updates.
 */
int updateSafeAreas(const ShadowNode &rootShadowNode);

// Size of the most recently started surface (used as the window frame of
// `initialWindowMetrics`).
void setSafeAreaWindowSize(Size size);

/*
 * `RNCSafeAreaContext` TurboModule: `getConstants()` returns
 * `{initialWindowMetrics: {frame: {x, y, width, height}, insets}}` with the
 * size of the most recently started surface (or the tester's window size) and
 * the current safe area insets. Returns nullptr without safe-area-context.
 */
std::shared_ptr<TurboModule> createSafeAreaContextModule(std::shared_ptr<CallInvoker> jsInvoker);

// The insets last emitted for the RNCSafeAreaProvider with `tag`.
std::optional<EdgeInsets> getEmittedSafeAreaProviderInsets(Tag tag);

} // namespace facebook::react
