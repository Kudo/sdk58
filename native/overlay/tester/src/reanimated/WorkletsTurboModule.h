/*
 * rn-a11y: reanimated
 */

#pragma once

#include <ReactCommon/TurboModule.h>

#include <memory>

namespace worklets {
class RNRuntimeStatus;
class WorkletsModuleProxy;
class WorkletsModuleProxyInitializer;
} // namespace worklets

namespace facebook::react::fantom_reanimated {

class HostUIScheduler;

// C++ version of apple/worklets/apple/WorkletsModule.mm. Spec
// (src/specs/NativeWorkletsModule.ts):
//   installTurboModule(bundleModeEnabled: boolean): boolean
//   prepareBundleMode(): boolean
//   toggleSlowAnimationsOnUIRuntime(): boolean
//   start(): boolean
// Bundle Mode is not supported.
class WorkletsTurboModule : public TurboModule {
 public:
  static constexpr const char *kModuleName = "WorkletsModule";

  explicit WorkletsTurboModule(std::shared_ptr<CallInvoker> jsInvoker);
  ~WorkletsTurboModule() override;

 private:
  static jsi::Value installTurboModule(
      jsi::Runtime &rt,
      TurboModule &turboModule,
      const jsi::Value *args,
      size_t count);
  static jsi::Value prepareBundleMode(
      jsi::Runtime &rt,
      TurboModule &turboModule,
      const jsi::Value *args,
      size_t count);
  static jsi::Value toggleSlowAnimationsOnUIRuntime(
      jsi::Runtime &rt,
      TurboModule &turboModule,
      const jsi::Value *args,
      size_t count);
  static jsi::Value
  start(jsi::Runtime &rt, TurboModule &turboModule, const jsi::Value *args, size_t count);

  std::shared_ptr<HostUIScheduler> uiScheduler_;
  std::shared_ptr<worklets::RNRuntimeStatus> rnRuntimeStatus_;
  std::shared_ptr<worklets::WorkletsModuleProxyInitializer> initializer_;
  std::shared_ptr<worklets::WorkletsModuleProxy> workletsModuleProxy_;
};

} // namespace facebook::react::fantom_reanimated
