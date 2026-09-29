/*
 * rn-a11y: reanimated
 */

#pragma once

#include <ReactCommon/TurboModule.h>
#include <react/renderer/core/EventListener.h>

#include <memory>

namespace reanimated {
class ReanimatedModuleProxy;
}

namespace facebook::react::fantom_reanimated {

// C++ version of apple/reanimated/apple/ReanimatedModule.mm. Spec
// (src/specs/NativeReanimatedModule.ts): installTurboModule(): boolean.
class ReanimatedTurboModule : public TurboModule {
 public:
  static constexpr const char *kModuleName = "ReanimatedModule";

  explicit ReanimatedTurboModule(std::shared_ptr<CallInvoker> jsInvoker);
  ~ReanimatedTurboModule() override;

 private:
  static jsi::Value installTurboModule(
      jsi::Runtime &rt,
      TurboModule &turboModule,
      const jsi::Value *args,
      size_t count);

  std::shared_ptr<reanimated::ReanimatedModuleProxy> reanimatedModuleProxy_;
  std::shared_ptr<const EventListener> eventListener_;
};

} // namespace facebook::react::fantom_reanimated
