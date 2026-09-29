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

namespace facebook::react {

/*
 * react-native-gesture-handler support. No-ops when the tester is built
 * without it (FANTOM_WITH_RNGESTUREHANDLER not defined).
 */

// Registers RNGestureHandlerDetector (custom shadow node from
// shared/shadowNodes), RNGestureHandlerRootView and RNGestureHandlerButton.
void registerGestureHandlerComponentDescriptors(
    const std::shared_ptr<ComponentDescriptorProviderRegistry> &providerRegistry);

/*
 * `RNGestureHandlerModule` TurboModule: a safety net for
 * `TurboModuleRegistry.getEnforcing('RNGestureHandlerModule')`. All methods
 * are no-ops (gesture recognition runs in JS), `installUIRuntimeBindings`
 * returns true. Returns nullptr without gesture-handler.
 */
std::shared_ptr<TurboModule> createGestureHandlerModule(std::shared_ptr<CallInvoker> jsInvoker);

} // namespace facebook::react
