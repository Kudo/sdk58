/*
 * rn-a11y: reanimated
 */

#include "WorkletsTurboModule.h"

#include "FrameLoop.h"
#include "HostUIScheduler.h"

#include <glog/logging.h>
#include <worklets/NativeModules/WorkletsModuleProxyInitializer.h>
#include <worklets/Networking/NetworkingBackend.h>
#include <worklets/Tools/JSScheduler.h>
#include <worklets/Tools/RNRuntimeStatus.h>
#include <worklets/WorkletRuntime/BundleModeConfig.h>
#include <worklets/WorkletRuntime/RuntimeBindings.h>

#include <stdexcept>
#include <string>
#include <thread>
#include <utility>

namespace facebook::react::fantom_reanimated {

namespace {

// `fetch` on worklet runtimes: every request fails with a network error.
class StubNetworkingBackend : public worklets::NetworkingBackend {
 public:
  void sendRequest(
      uint64_t /*requestId*/,
      worklets::RequestConfig && /*config*/,
      const std::shared_ptr<worklets::NetworkRequestListener> &listener)
      override {
    listener->onError(
        worklets::RequestError::Network,
        "[Fantom] Networking is not available on worklet runtimes");
  }

  void abortRequest(uint64_t /*requestId*/) override {}
};

// Used by worklet runtimes in Bundle Mode (RuntimeBindings.h). Level values
// are the RN log levels (0 trace/log, 1 info, 2 warn, 3 error).
jsi::Value nativeLoggingHook(
    jsi::Runtime &rt,
    const jsi::Value & /*thisVal*/,
    const jsi::Value *args,
    size_t count) {
  if (count != 2) {
    throw std::invalid_argument("nativeLoggingHook takes 2 arguments");
  }
  const auto message = args[0].asString(rt).utf8(rt);
  const auto level = static_cast<int>(args[1].asNumber());
  if (level >= 3) {
    LOG(ERROR) << "[worklets] " << message;
  } else if (level == 2) {
    LOG(WARNING) << "[worklets] " << message;
  } else {
    LOG(INFO) << "[worklets] " << message;
  }
  return jsi::Value::undefined();
}

WorkletsTurboModule &asModule(TurboModule &turboModule) {
  return static_cast<WorkletsTurboModule &>(turboModule);
}

} // namespace

WorkletsTurboModule::WorkletsTurboModule(std::shared_ptr<CallInvoker> jsInvoker)
    : TurboModule(kModuleName, std::move(jsInvoker)),
      rnRuntimeStatus_(std::make_shared<worklets::RNRuntimeStatus>()) {
  methodMap_["installTurboModule"] =
      MethodMetadata{.argCount = 1, .invoker = installTurboModule};
  methodMap_["prepareBundleMode"] =
      MethodMetadata{.argCount = 0, .invoker = prepareBundleMode};
  methodMap_["toggleSlowAnimationsOnUIRuntime"] = MethodMetadata{
      .argCount = 0, .invoker = toggleSlowAnimationsOnUIRuntime};
  methodMap_["start"] = MethodMetadata{.argCount = 0, .invoker = start};
}

WorkletsTurboModule::~WorkletsTurboModule() {
  rnRuntimeStatus_->setDead();
  FrameLoop::get().reset();
  if (initializer_) {
    initializer_->invalidate();
    initializer_.reset();
  }
  workletsModuleProxy_.reset();
}

jsi::Value WorkletsTurboModule::installTurboModule(
    jsi::Runtime &rt,
    TurboModule &turboModule,
    const jsi::Value *args,
    size_t count) {
  auto &self = asModule(turboModule);
  const bool bundleModeEnabled = count > 0 && args[0].isBool() && args[0].getBool();
  if (bundleModeEnabled) {
    throw jsi::JSError(rt, "[Fantom] Worklets Bundle Mode is not supported");
  }
  if (self.workletsModuleProxy_) {
    return jsi::Value(true);
  }

  // The same thread runs JS and the UI runtime.
  auto jsScheduler = std::make_shared<worklets::JSScheduler>(
      rt,
      self.jsInvoker_,
      [jsThread = std::this_thread::get_id()]() -> bool {
        return std::this_thread::get_id() == jsThread;
      });
  self.uiScheduler_ = std::make_shared<HostUIScheduler>();

  auto runtimeBindings =
      std::make_shared<worklets::RuntimeBindings>(worklets::RuntimeBindings{
          .requestAnimationFrame =
              [](std::function<void(const double)> &&callback) {
                FrameLoop::get().requestAnimationFrame(std::move(callback));
              },
          .nativeLoggingHook = nativeLoggingHook,
          .networkingBackend = std::make_shared<StubNetworkingBackend>(),
      });

  self.initializer_ = std::make_shared<worklets::WorkletsModuleProxyInitializer>(
      jsScheduler, self.uiScheduler_, runtimeBindings, self.rnRuntimeStatus_);
  // iOS runs prepareProxy on a background queue when the module is created;
  // here it runs synchronously (it creates the UI runtime).
  self.initializer_->prepareProxy();
  self.workletsModuleProxy_ = self.initializer_->finalize(
      rt, /* bundleModeEnabled */ false, []() {
        return worklets::BundleModeConfig{.enabled = false};
      });

  FrameLoop::get().setUIScheduler(self.uiScheduler_);
  return jsi::Value(true);
}

jsi::Value WorkletsTurboModule::prepareBundleMode(
    jsi::Runtime & /*rt*/,
    TurboModule & /*turboModule*/,
    const jsi::Value * /*args*/,
    size_t /*count*/) {
  return jsi::Value(false);
}

jsi::Value WorkletsTurboModule::toggleSlowAnimationsOnUIRuntime(
    jsi::Runtime & /*rt*/,
    TurboModule & /*turboModule*/,
    const jsi::Value * /*args*/,
    size_t /*count*/) {
  return jsi::Value(false);
}

jsi::Value WorkletsTurboModule::start(
    jsi::Runtime &rt,
    TurboModule &turboModule,
    const jsi::Value * /*args*/,
    size_t /*count*/) {
  auto &self = asModule(turboModule);
  if (!self.workletsModuleProxy_) {
    throw jsi::JSError(
        rt, "[Fantom] WorkletsModule.start called before installTurboModule");
  }
  self.workletsModuleProxy_->start();
  return jsi::Value(true);
}

} // namespace facebook::react::fantom_reanimated
