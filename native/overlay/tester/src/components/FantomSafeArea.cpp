/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomSafeArea.h"

#include "FantomDeviceInfo.h"

#include <mutex>
#include <unordered_map>

#ifdef FANTOM_WITH_SAFEAREACONTEXT
#include <react/renderer/components/safeareacontext/ComponentDescriptors.h>
#include <react/renderer/components/safeareacontext/EventEmitters.h>
#include <react/renderer/components/safeareacontext/RNCSafeAreaViewComponentDescriptor.h>
#include <react/renderer/core/LayoutableShadowNode.h>

#include <algorithm>
#include <cstring>
#endif

namespace facebook::react {

namespace {

std::mutex safeAreaMutex;
EdgeInsets windowInsets{};

struct EmittedMetrics {
  EdgeInsets insets;
  Rect frame;
};
std::unordered_map<Tag, EmittedMetrics> emittedMetrics;

} // namespace

void setSafeAreaInsets(EdgeInsets insets) {
  std::lock_guard<std::mutex> lock(safeAreaMutex);
  windowInsets = insets;
}

EdgeInsets getSafeAreaInsets() {
  std::lock_guard<std::mutex> lock(safeAreaMutex);
  return windowInsets;
}

std::optional<EdgeInsets> getEmittedSafeAreaProviderInsets(Tag tag) {
  std::lock_guard<std::mutex> lock(safeAreaMutex);
  auto it = emittedMetrics.find(tag);
  if (it == emittedMetrics.end()) {
    return std::nullopt;
  }
  return it->second.insets;
}

#ifdef FANTOM_WITH_SAFEAREACONTEXT

void registerSafeAreaComponentDescriptors(
    const std::shared_ptr<ComponentDescriptorProviderRegistry>&
        providerRegistry) {
  safeareacontext_registerComponentDescriptorsFromCodegen(providerRegistry);
  providerRegistry->add(
      concreteComponentDescriptorProvider<RNCSafeAreaViewComponentDescriptor>());
}

namespace {

// Window insets that overlap `frame` (root coordinates) in a window of
// `windowSize`.
EdgeInsets overlappingInsets(
    const EdgeInsets& insets,
    const Rect& frame,
    const Size& windowSize) {
  auto clamp = [](Float value) { return std::max<Float>(0, value); };
  return EdgeInsets{
      .left = clamp(insets.left - frame.origin.x),
      .top = clamp(insets.top - frame.origin.y),
      .right = clamp(
          insets.right - (windowSize.width - (frame.origin.x + frame.size.width))),
      .bottom = clamp(
          insets.bottom -
          (windowSize.height - (frame.origin.y + frame.size.height))),
  };
}

struct Walker {
  EdgeInsets windowInsets;
  Size windowSize;
  int updates{0};

  void walk(
      const ShadowNode& node,
      Point parentContentOrigin,
      std::optional<EdgeInsets> providerInsets) {
    const auto* layoutable = dynamic_cast<const LayoutableShadowNode*>(&node);
    if (layoutable == nullptr) {
      return;
    }
    auto metrics = layoutable->getLayoutMetrics();
    auto frame = Rect{
        .origin = parentContentOrigin + metrics.frame.origin,
        .size = metrics.frame.size};

    if (std::strcmp(node.getComponentName(), "RNCSafeAreaProvider") == 0) {
      auto insets = overlappingInsets(windowInsets, frame, windowSize);
      providerInsets = insets;
      emitIfChanged(node, insets, frame);
    } else if (
        const auto* safeAreaView =
            dynamic_cast<const RNCSafeAreaViewShadowNode*>(&node)) {
      auto insets = providerInsets.value_or(
          overlappingInsets(windowInsets, frame, windowSize));
      if (safeAreaView->getStateData().insets != insets) {
        auto state = std::static_pointer_cast<
            const RNCSafeAreaViewShadowNode::ConcreteState>(node.getState());
        RNCSafeAreaViewState data;
        data.insets = insets;
        state->updateState(std::move(data));
        updates++;
      }
    }

    auto contentOrigin =
        frame.origin + layoutable->getContentOriginOffset(false);
    for (const auto& child : node.getChildren()) {
      walk(*child, contentOrigin, providerInsets);
    }
  }

  void emitIfChanged(
      const ShadowNode& node,
      const EdgeInsets& insets,
      const Rect& frame) {
    {
      std::lock_guard<std::mutex> lock(safeAreaMutex);
      auto it = emittedMetrics.find(node.getTag());
      if (it != emittedMetrics.end() && it->second.insets == insets &&
          it->second.frame == frame) {
        return;
      }
      emittedMetrics[node.getTag()] = EmittedMetrics{insets, frame};
    }
    auto eventEmitter =
        std::dynamic_pointer_cast<const RNCSafeAreaProviderEventEmitter>(
            node.getEventEmitter());
    if (eventEmitter == nullptr) {
      return;
    }
    eventEmitter->onInsetsChange(
        RNCSafeAreaProviderEventEmitter::OnInsetsChange{
            .insets =
                {.top = insets.top,
                 .right = insets.right,
                 .bottom = insets.bottom,
                 .left = insets.left},
            .frame = {
                .x = frame.origin.x,
                .y = frame.origin.y,
                .width = frame.size.width,
                .height = frame.size.height}});
    updates++;
  }
};

} // namespace

namespace {

class FantomSafeAreaContextModule : public TurboModule {
 public:
  explicit FantomSafeAreaContextModule(std::shared_ptr<CallInvoker> jsInvoker)
      : TurboModule("RNCSafeAreaContext", std::move(jsInvoker)) {
    methodMap_["getConstants"] = MethodMetadata{
        .argCount = 0,
        .invoker = [](jsi::Runtime& runtime,
                      TurboModule&,
                      const jsi::Value*,
                      size_t) -> jsi::Value {
          // The window frame is the device metrics (FantomDeviceInfo): the
          // started surface's size, or NativeFantom.setDeviceMetrics.
          auto deviceMetrics = getFantomDeviceMetrics();
          Size size{static_cast<Float>(deviceMetrics.width), static_cast<Float>(deviceMetrics.height)};
          EdgeInsets insets;
          {
            std::lock_guard<std::mutex> lock(safeAreaMutex);
            insets = windowInsets;
          }
          auto frame = jsi::Object(runtime);
          frame.setProperty(runtime, "x", 0);
          frame.setProperty(runtime, "y", 0);
          frame.setProperty(runtime, "width", size.width);
          frame.setProperty(runtime, "height", size.height);
          auto insetsObject = jsi::Object(runtime);
          insetsObject.setProperty(runtime, "top", insets.top);
          insetsObject.setProperty(runtime, "right", insets.right);
          insetsObject.setProperty(runtime, "bottom", insets.bottom);
          insetsObject.setProperty(runtime, "left", insets.left);
          auto metrics = jsi::Object(runtime);
          metrics.setProperty(runtime, "frame", frame);
          metrics.setProperty(runtime, "insets", insetsObject);
          auto constants = jsi::Object(runtime);
          constants.setProperty(runtime, "initialWindowMetrics", metrics);
          return constants;
        }};
  }
};

} // namespace

std::shared_ptr<TurboModule> createSafeAreaContextModule(
    std::shared_ptr<CallInvoker> jsInvoker) {
  return std::make_shared<FantomSafeAreaContextModule>(std::move(jsInvoker));
}

int updateSafeAreas(const ShadowNode& rootShadowNode) {
  const auto* root = dynamic_cast<const LayoutableShadowNode*>(&rootShadowNode);
  if (root == nullptr) {
    return 0;
  }
  Walker walker{
      .windowInsets = getSafeAreaInsets(),
      .windowSize = root->getLayoutMetrics().frame.size};
  walker.walk(rootShadowNode, Point{0, 0}, std::nullopt);
  return walker.updates;
}

#else

void registerSafeAreaComponentDescriptors(
    const std::shared_ptr<ComponentDescriptorProviderRegistry>&
    /*providerRegistry*/) {}

int updateSafeAreas(const ShadowNode& /*rootShadowNode*/) {
  return 0;
}

std::shared_ptr<TurboModule> createSafeAreaContextModule(
    std::shared_ptr<CallInvoker> /*jsInvoker*/) {
  return nullptr;
}

#endif

} // namespace facebook::react
