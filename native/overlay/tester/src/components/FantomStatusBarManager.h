/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <ReactCommon/CallInvoker.h>
#include <ReactCommon/TurboModule.h>

namespace facebook::react {

/*
 * `StatusBarManager` TurboModule (union of the Android and iOS specs,
 * NativeStatusBarManagerAndroid.js / NativeStatusBarManagerIOS.js):
 * `getConstants()` returns `{HEIGHT, DEFAULT_BACKGROUND_COLOR: 0}` where HEIGHT
 * is the safe area top inset (setSafeAreaInsets, default 0); `getHeight(cb)`
 * calls `cb({height})`; the setters and listener methods are no-ops.
 */
std::shared_ptr<TurboModule> createStatusBarManagerModule(std::shared_ptr<CallInvoker> jsInvoker);

} // namespace facebook::react
