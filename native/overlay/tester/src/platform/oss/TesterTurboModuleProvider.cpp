/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "../TesterTurboModuleProvider.h"

#include "../../components/FantomGestureHandler.h"
#include "../../components/FantomSafeArea.h"
#include "../../components/FantomStatusBarManager.h"

namespace facebook::react {
/* static */ TurboModuleProvider
TesterTurboModuleProvider::getTurboModuleProvider() {
  return TurboModuleProvider{
      [](const std::string& name, const std::shared_ptr<CallInvoker>& jsInvoker)
          -> std::shared_ptr<TurboModule> {
        if (name == "RNGestureHandlerModule") {
          return createGestureHandlerModule(jsInvoker);
        }
        if (name == "RNCSafeAreaContext") {
          return createSafeAreaContextModule(jsInvoker);
        }
        if (name == "StatusBarManager") {
          return createStatusBarManagerModule(jsInvoker);
        }
        return nullptr;
      }};
}
} // namespace facebook::react
