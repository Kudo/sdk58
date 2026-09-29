/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomStatusBarManager.h"

#include "FantomSafeArea.h"

namespace facebook::react {

namespace {

jsi::Value noOp(jsi::Runtime&, TurboModule&, const jsi::Value*, size_t) {
  return jsi::Value::undefined();
}

class FantomStatusBarManagerModule : public TurboModule {
 public:
  explicit FantomStatusBarManagerModule(std::shared_ptr<CallInvoker> jsInvoker)
      : TurboModule("StatusBarManager", std::move(jsInvoker)) {
    methodMap_["getConstants"] = MethodMetadata{
        .argCount = 0,
        .invoker = [](jsi::Runtime& runtime,
                      TurboModule&,
                      const jsi::Value*,
                      size_t) -> jsi::Value {
          auto constants = jsi::Object(runtime);
          constants.setProperty(runtime, "HEIGHT", getSafeAreaInsets().top);
          constants.setProperty(runtime, "DEFAULT_BACKGROUND_COLOR", 0);
          return constants;
        }};
    methodMap_["getHeight"] = MethodMetadata{
        .argCount = 1,
        .invoker = [](jsi::Runtime& runtime,
                      TurboModule&,
                      const jsi::Value* args,
                      size_t count) -> jsi::Value {
          if (count > 0 && args[0].isObject() &&
              args[0].asObject(runtime).isFunction(runtime)) {
            auto result = jsi::Object(runtime);
            result.setProperty(runtime, "height", getSafeAreaInsets().top);
            args[0].asObject(runtime).asFunction(runtime).call(runtime, result);
          }
          return jsi::Value::undefined();
        }};
    // Android: setStyle(style), setHidden(hidden) (older versions also
    // setColor, setTranslucent). iOS: setStyle(style, animated),
    // setHidden(hidden, animation), setNetworkActivityIndicatorVisible,
    // addListener, removeListeners.
    static constexpr std::pair<const char*, size_t> kNoOpMethods[] = {
        {"setStyle", 2},
        {"setHidden", 2},
        {"setColor", 2},
        {"setTranslucent", 1},
        {"setNetworkActivityIndicatorVisible", 1},
        {"addListener", 1},
        {"removeListeners", 1},
    };
    for (const auto& [name, argCount] : kNoOpMethods) {
      methodMap_[name] = MethodMetadata{.argCount = argCount, .invoker = noOp};
    }
  }
};

} // namespace

std::shared_ptr<TurboModule> createStatusBarManagerModule(
    std::shared_ptr<CallInvoker> jsInvoker) {
  return std::make_shared<FantomStatusBarManagerModule>(std::move(jsInvoker));
}

} // namespace facebook::react
