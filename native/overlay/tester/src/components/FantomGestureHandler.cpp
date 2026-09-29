/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomGestureHandler.h"

#ifdef FANTOM_WITH_RNGESTUREHANDLER
#include <react/renderer/components/rngesturehandler_codegen/ComponentDescriptors.h>
#endif

namespace facebook::react {

#ifdef FANTOM_WITH_RNGESTUREHANDLER

void registerGestureHandlerComponentDescriptors(
    const std::shared_ptr<ComponentDescriptorProviderRegistry>&
        providerRegistry) {
  providerRegistry->add(
      concreteComponentDescriptorProvider<
          RNGestureHandlerDetectorComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<
          RNGestureHandlerRootViewComponentDescriptor>());
  providerRegistry->add(
      concreteComponentDescriptorProvider<
          RNGestureHandlerButtonComponentDescriptor>());
}

namespace {

class FantomGestureHandlerModule : public TurboModule {
 public:
  explicit FantomGestureHandlerModule(std::shared_ptr<CallInvoker> jsInvoker)
      : TurboModule("RNGestureHandlerModule", std::move(jsInvoker)) {
    // Methods of src/specs/NativeRNGestureHandlerModule.ts (3.2.1).
    static constexpr std::pair<const char*, size_t> kNoOpMethods[] = {
        {"createGestureHandler", 3},
        {"attachGestureHandler", 3},
        {"setGestureHandlerConfig", 2},
        {"updateGestureHandlerConfig", 2},
        {"configureRelations", 2},
        {"dropGestureHandler", 1},
        {"flushOperations", 0},
    };
    for (const auto& [name, argCount] : kNoOpMethods) {
      methodMap_[name] = MethodMetadata{
          .argCount = argCount,
          .invoker = [](jsi::Runtime&, TurboModule&, const jsi::Value*, size_t)
              -> jsi::Value { return jsi::Value::undefined(); }};
    }
    methodMap_["installUIRuntimeBindings"] = MethodMetadata{
        .argCount = 0,
        .invoker = [](jsi::Runtime&, TurboModule&, const jsi::Value*, size_t)
            -> jsi::Value { return jsi::Value(true); }};
  }
};

} // namespace

std::shared_ptr<TurboModule> createGestureHandlerModule(
    std::shared_ptr<CallInvoker> jsInvoker) {
  return std::make_shared<FantomGestureHandlerModule>(std::move(jsInvoker));
}

#else

void registerGestureHandlerComponentDescriptors(
    const std::shared_ptr<ComponentDescriptorProviderRegistry>&
    /*providerRegistry*/) {}

std::shared_ptr<TurboModule> createGestureHandlerModule(
    std::shared_ptr<CallInvoker> /*jsInvoker*/) {
  return nullptr;
}

#endif

} // namespace facebook::react
