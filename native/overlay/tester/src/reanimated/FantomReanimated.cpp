/*
 * rn-a11y: reanimated
 */

#include "FantomReanimated.h"

#include "FrameLoop.h"
#include "ReanimatedTurboModule.h"
#include "WorkletsTurboModule.h"

#include <react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h>
#include <react/renderer/components/rnreanimated/ComponentDescriptors.h>

#include <utility>

namespace facebook::react::fantom_reanimated {

void setClock(std::function<double()> nowMs) {
  FrameLoop::get().setClock(std::move(nowMs));
}

std::shared_ptr<TurboModule> getTurboModule(
    const std::string &name,
    const std::shared_ptr<CallInvoker> &jsInvoker) {
  if (name == WorkletsTurboModule::kModuleName) {
    return std::make_shared<WorkletsTurboModule>(jsInvoker);
  }
  if (name == ReanimatedTurboModule::kModuleName) {
    return std::make_shared<ReanimatedTurboModule>(jsInvoker);
  }
  return nullptr;
}

void registerComponentDescriptors(ComponentDescriptorProviderRegistry &registry) {
  registry.add(concreteComponentDescriptorProvider<
               REASharedTransitionBoundaryComponentDescriptor>());
}

bool isActive() {
  return FrameLoop::get().isActive();
}

void produceFrame() {
  FrameLoop::get().produceFrame();
}

} // namespace facebook::react::fantom_reanimated
