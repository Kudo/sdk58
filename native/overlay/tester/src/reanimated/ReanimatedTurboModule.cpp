/*
 * rn-a11y: reanimated
 */

#include "ReanimatedTurboModule.h"

#include "FrameLoop.h"
#include "PlatformDepMethodsHolderImpl.h"

#include <react/renderer/core/EventListener.h>
#include <react/renderer/core/RawEvent.h>
#include <react/renderer/scheduler/Scheduler.h>
#include <react/renderer/uimanager/UIManagerBinding.h>
#include <reanimated/Compat/WorkletsApi.h>
#include <reanimated/NativeModules/ReanimatedModuleProxy.h>
#include <reanimated/RuntimeDecorators/RNRuntimeDecorator.h>

#include <utility>

namespace facebook::react::fantom_reanimated {

namespace {

ReanimatedTurboModule &asModule(TurboModule &turboModule) {
  return static_cast<ReanimatedTurboModule &>(turboModule);
}

Scheduler *getScheduler(jsi::Runtime &rt) {
  auto uiManagerBinding = UIManagerBinding::getBinding(rt);
  if (uiManagerBinding == nullptr) {
    return nullptr;
  }
  // The Scheduler is the UIManager delegate (Scheduler.cpp); reanimated
  // relies on the same (ReanimatedModuleProxy::initializeLayoutAnimationsProxyRegistry).
  return dynamic_cast<Scheduler *>(
      uiManagerBinding->getUIManager().getDelegate());
}

} // namespace

ReanimatedTurboModule::ReanimatedTurboModule(
    std::shared_ptr<CallInvoker> jsInvoker)
    : TurboModule(kModuleName, std::move(jsInvoker)) {
  methodMap_["installTurboModule"] =
      MethodMetadata{.argCount = 0, .invoker = installTurboModule};
}

ReanimatedTurboModule::~ReanimatedTurboModule() {
  FrameLoop::get().setPerformOperations(nullptr);
  reanimatedModuleProxy_.reset();
}

jsi::Value ReanimatedTurboModule::installTurboModule(
    jsi::Runtime &rt,
    TurboModule &turboModule,
    const jsi::Value * /*args*/,
    size_t /*count*/) {
  auto &self = asModule(turboModule);
  if (self.reanimatedModuleProxy_) {
    return jsi::Value(true);
  }

  auto *scheduler = getScheduler(rt);
  if (scheduler == nullptr) {
    return jsi::Value(false);
  }

  // 1. UI runtime and UI scheduler from the worklets module (set by
  //    WorkletsModuleProxy::attachToRNRuntime).
  const auto global = rt.global();
  const auto uiWorkletRuntime = worklets::getWorkletRuntimeFromHolder(
      rt, global.getPropertyAsObject(rt, "__UI_WORKLET_RUNTIME_HOLDER"));
  const auto uiScheduler = worklets::getUISchedulerFromHolder(
      rt, global.getPropertyAsObject(rt, "__UI_SCHEDULER_HOLDER"));

  // 2. Proxy + init (iOS: NativeProxy.mm createReanimatedModuleProxy).
  const auto platformDepMethodsHolder = makePlatformDepMethodsHolder();
  auto proxy = std::make_shared<reanimated::ReanimatedModuleProxy>(
      uiWorkletRuntime,
      uiScheduler,
      rt,
      self.jsInvoker_,
      platformDepMethodsHolder,
      /* isReducedMotion */ false);
  proxy->init(platformDepMethodsHolder);

  // 3. global.__reanimatedModuleProxy and the UI runtime globals.
  auto &uiRuntime = worklets::getJSIRuntimeFromWorkletRuntime(uiWorkletRuntime);
  reanimated::RNRuntimeDecorator::decorate(rt, uiRuntime, proxy);

  // 4. Commit and mount hooks, layout animations.
  proxy->initializeFabric(scheduler->getUIManager());

  // 5. Raw events (iOS: attachReactEventListener). The animation clock is the
  //    event time.
  std::weak_ptr<reanimated::ReanimatedModuleProxy> weakProxy = proxy;
  self.eventListener_ = std::make_shared<const EventListener>(
      [weakProxy](const RawEvent &rawEvent) {
        if (auto strongProxy = weakProxy.lock()) {
          return strongProxy->handleRawEvent(
              rawEvent, FrameLoop::get().now());
        }
        return false;
      });
  scheduler->addEventListener(self.eventListener_);

  // 6. Per-frame performOperations (iOS: REANodesManager registerPerformOperations).
  FrameLoop::get().setPerformOperations([weakProxy]() {
    if (auto strongProxy = weakProxy.lock()) {
      strongProxy->performOperations();
    }
  });

  self.reanimatedModuleProxy_ = std::move(proxy);
  return jsi::Value(true);
}

} // namespace facebook::react::fantom_reanimated
