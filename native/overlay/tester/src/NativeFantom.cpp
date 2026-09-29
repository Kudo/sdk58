/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "NativeFantom.h"

#include <hermes/hermes.h>
#include <jsi/JSIDynamic.h>
#include <react/bridging/Bridging.h>
#include <react/debug/flags.h>
#include <react/renderer/components/modal/ModalHostViewShadowNode.h>
#include <react/renderer/components/scrollview/ScrollViewShadowNode.h>
#include <react/renderer/uimanager/UIManagerBinding.h>
#include <fstream>
#include <iostream>

#include "TesterAppDelegate.h"

#include <jsi/instrumentation.h>
#include "render/A11yTree.h"
#include "render/RenderFormatOptions.h"
#include "render/RenderOutput.h"

namespace facebook::react {

namespace {

// getA11yTree(surfaceId: number, includeDebugProps?: ?boolean): string
jsi::Value getA11yTreeHostFunction(
    jsi::Runtime& runtime,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  if (count < 1 || !args[0].isNumber()) {
    throw jsi::JSError(
        runtime, "getA11yTree: expected a surface ID as the first argument");
  }
  auto surfaceId = static_cast<SurfaceId>(args[0].asNumber());
  bool includeDebugProps = count > 1 && args[1].isBool() && args[1].getBool();
  return jsi::String::createFromUtf8(
      runtime,
      static_cast<NativeFantom&>(turboModule)
          .getA11yTree(runtime, surfaceId, includeDebugProps));
}

} // namespace

NativeFantom::NativeFantom(
    TesterAppDelegate& appDelegate,
    std::shared_ptr<CallInvoker> jsInvoker)
    : NativeFantomCxxSpec<NativeFantom>(std::move(jsInvoker)),
      appDelegate_(appDelegate) {
  methodMap_["getA11yTree"] =
      MethodMetadata{.argCount = 2, .invoker = getA11yTreeHostFunction};
}

SurfaceId NativeFantom::startSurface(
    jsi::Runtime& runtime,
    double viewportWidth,
    double viewportHeight,
    double devicePixelRatio,
    double viewportOffsetX,
    double viewportOffsetY) {
  SurfaceId surfaceId = nextSurfaceId_;
  nextSurfaceId_ += 10;
  appDelegate_.startSurface(
      runtime,
      static_cast<float>(viewportWidth),
      static_cast<float>(viewportHeight),
      surfaceId,
      static_cast<float>(devicePixelRatio),
      static_cast<float>(viewportOffsetX),
      static_cast<float>(viewportOffsetY));
  return surfaceId;
}

void NativeFantom::stopSurface(jsi::Runtime& /*runtime*/, SurfaceId surfaceId) {
  appDelegate_.stopSurface(surfaceId);
}

void NativeFantom::produceFramesForDuration(
    jsi::Runtime& /*runtime*/,
    double milliseconds) {
  appDelegate_.produceFramesForDuration(milliseconds);
}

void NativeFantom::setTimerMockEnabled(
    jsi::Runtime& /*runtime*/,
    bool enabled) {
  appDelegate_.setTimerMockEnabled(enabled);
}

void NativeFantom::advanceTimers(jsi::Runtime& /*runtime*/, double deltaMs) {
  appDelegate_.advanceTimers(deltaMs);
}

void NativeFantom::runAllTimers(jsi::Runtime& /*runtime*/) {
  appDelegate_.runAllTimers();
}

double NativeFantom::getPendingTimerCount(jsi::Runtime& /*runtime*/) {
  return static_cast<double>(appDelegate_.getPendingTimerCount());
}

void NativeFantom::flushMessageQueue(jsi::Runtime& /*runtime*/) {
  appDelegate_.flushMessageQueue();
}

void NativeFantom::flushEventQueue(jsi::Runtime& /*runtime*/) {
  appDelegate_.onRender();
}

void NativeFantom::validateEmptyMessageQueue(jsi::Runtime& /*runtime*/) {
  if (appDelegate_.hasPendingTasksInMessageQueue()) {
    throw std::runtime_error("MessageQueue is not empty");
  }
}

std::vector<std::string> NativeFantom::takeMountingManagerLogs(
    jsi::Runtime& /*runtime*/,
    SurfaceId surfaceId) {
  return appDelegate_.mountingManager_->takeMountingLogs(surfaceId);
}

std::string NativeFantom::getRenderedOutput(
    jsi::Runtime& /*runtime*/,
    SurfaceId surfaceId,
    NativeFantomGetRenderedOutputRenderFormatOptions options) {
  RenderFormatOptions formatOptions{
      .includeRoot = options.includeRoot,
      .includeLayoutMetrics = options.includeLayoutMetrics};

  auto viewTree = appDelegate_.mountingManager_->getViewTree(surfaceId);
  return appDelegate_.mountingManager_->renderer()->render(
      viewTree, formatOptions);
}

std::string NativeFantom::getA11yTree(
    jsi::Runtime& runtime,
    SurfaceId surfaceId,
    bool includeDebugProps) {
  auto uiManagerBinding = UIManagerBinding::getBinding(runtime);
  if (uiManagerBinding == nullptr) {
    throw jsi::JSError(runtime, "getA11yTree: UIManagerBinding is not available");
  }

  std::string result;
  bool found = uiManagerBinding->getUIManager().getShadowTreeRegistry().visit(
      surfaceId, [&](const ShadowTree& shadowTree) {
        auto rootShadowNode = shadowTree.getCurrentRevision().rootShadowNode;
        folly::json::serialization_opts opts;
        opts.sort_keys = true;
        result = folly::json::serialize(
            renderA11yTree(
                *rootShadowNode, {.includeDebugProps = includeDebugProps}),
            opts);
      });
  if (!found) {
    throw jsi::JSError(
        runtime,
        "getA11yTree: no shadow tree for surface " +
            std::to_string(surfaceId));
  }
  return result;
}

void NativeFantom::reportTestSuiteResultsJSON(
    jsi::Runtime& /*runtime*/,
    const std::string& testSuiteResultsJSON) {
  std::cout << testSuiteResultsJSON << std::endl;
}

jsi::Object NativeFantom::getDirectManipulationProps(
    jsi::Runtime& runtime,
    const std::shared_ptr<const ShadowNode>& shadowNode) {
  auto props = appDelegate_.mountingManager_->getViewDirectManipulationProps(
      shadowNode->getTag());
  return facebook::jsi::valueFromDynamic(runtime, props).asObject(runtime);
}

jsi::Object NativeFantom::getFabricUpdateProps(
    jsi::Runtime& runtime,
    const std::shared_ptr<const ShadowNode>& shadowNode) {
  auto props = appDelegate_.mountingManager_->getViewFabricUpdateProps(
      shadowNode->getTag());
  return facebook::jsi::valueFromDynamic(runtime, props).asObject(runtime);
}

void NativeFantom::enqueueNativeEvent(
    jsi::Runtime& /*runtime*/,
    std::shared_ptr<const ShadowNode> shadowNode,
    const std::string& type,
    const std::optional<folly::dynamic>& payload,
    std::optional<RawEvent::Category> category,
    std::optional<bool> isUnique) {
  if (isUnique.value_or(false)) {
    shadowNode->getEventEmitter()->dispatchUniqueEvent(
        type, payload.value_or(folly::dynamic::object()));
  } else {
    shadowNode->getEventEmitter()->dispatchEvent(
        type,
        payload.value_or(folly::dynamic::object()),
        category.value_or(RawEvent::Category::Unspecified));
  }
}

void NativeFantom::enqueueScrollEvent(
    jsi::Runtime& /*runtime*/,
    std::shared_ptr<const ShadowNode> shadowNode,
    ScrollOptions options) {
  const auto* scrollViewShadowNode =
      dynamic_cast<const ScrollViewShadowNode*>(&*shadowNode);

  if (scrollViewShadowNode == nullptr) {
    throw std::runtime_error(
        "enqueueScrollEvent() can only be called on <ScrollView />");
  }

  auto point = Point{
      .x = options.x,
      .y = options.y,
  };

  auto scrollEvent = ScrollEvent();

  scrollEvent.contentOffset = point;
  scrollEvent.contentSize =
      scrollViewShadowNode->getStateData().getContentSize();
  scrollEvent.containerSize =
      scrollViewShadowNode->getLayoutMetrics().frame.size;
  scrollEvent.contentInset =
      scrollViewShadowNode->getConcreteProps().contentInset;
  scrollEvent.zoomScale = options.zoomScale.value_or(scrollEvent.zoomScale);

  scrollViewShadowNode->getConcreteEventEmitter().onScroll(scrollEvent);

  auto state =
      std::static_pointer_cast<const ScrollViewShadowNode::ConcreteState>(
          scrollViewShadowNode->getState());
  state->updateState(
      [point](const ScrollViewShadowNode::ConcreteState::Data& oldData)
          -> ScrollViewShadowNode::ConcreteState::SharedData {
        auto newData = oldData;
        newData.contentOffset = point;
        return std::make_shared<
            const ScrollViewShadowNode::ConcreteState::Data>(newData);
      });
}

void NativeFantom::enqueueModalSizeUpdate(
    jsi::Runtime& /*runtime*/,
    std::shared_ptr<const ShadowNode> shadowNode,
    double width,
    double height) {
  const auto* modalHostViewShadowNode =
      dynamic_cast<const ModalHostViewShadowNode*>(&*shadowNode);

  if (modalHostViewShadowNode == nullptr) {
    throw std::runtime_error(
        "enqueueModalSizeUpdate() can only be called on <Modal />");
  }

  auto state =
      std::static_pointer_cast<const ModalHostViewShadowNode::ConcreteState>(
          modalHostViewShadowNode->getState());

  state->updateState(ModalHostViewState(
      {.width = static_cast<Float>(width),
       .height = static_cast<Float>(height)}));
}

jsi::Function NativeFantom::createShadowNodeReferenceCounter(
    jsi::Runtime& runtime,
    std::shared_ptr<const ShadowNode> shadowNode) {
  auto weakShadowNode = std::weak_ptr<const ShadowNode>(shadowNode);

  return jsi::Function::createFromHostFunction(
      runtime,
      jsi::PropNameID::forAscii(runtime, "getReferenceCount"),
      0,
      [weakShadowNode](
          jsi::Runtime&, const jsi::Value&, const jsi::Value*, size_t)
          -> jsi::Value { return {(int)weakShadowNode.use_count()}; });
}

jsi::Function NativeFantom::createShadowNodeRevisionGetter(
    jsi::Runtime& runtime,
    std::shared_ptr<const ShadowNode> shadowNode) {
#if RN_DEBUG_STRING_CONVERTIBLE
  auto weakShadowNode = std::weak_ptr<const ShadowNode>(shadowNode);

  return jsi::Function::createFromHostFunction(
      runtime,
      jsi::PropNameID::forAscii(runtime, "getRevision"),
      0,
      [weakShadowNode](
          jsi::Runtime& runtime, const jsi::Value&, const jsi::Value*, size_t)
          -> jsi::Value {
        if (auto strongShadowNode = weakShadowNode.lock()) {
          const auto& uiManager =
              UIManagerBinding::getBinding(runtime)->getUIManager();

          const auto& currentRevision =
              *uiManager.getNewestCloneOfShadowNode(*strongShadowNode);
          return currentRevision.revision_;
        } else {
          return jsi::Value::null();
        }
      });
#else
  // TODO(T225400348): Remove this when revision_ is available in optimised
  // builds.
  throw std::runtime_error(
      "createShadowNodeRevisionGetter() is only available in debug builds");
#endif
}

void NativeFantom::saveJSMemoryHeapSnapshot(
    jsi::Runtime& runtime,
    const std::string& filePath) {
  runtime.instrumentation().collectGarbage("heapsnapshot");
  runtime.instrumentation().createSnapshotToFile(filePath);
}

#ifdef REACT_NATIVE_DEBUG

void NativeFantom::forceHighResTimeStamp(
    jsi::Runtime& /*runtime*/,
    std::optional<HighResTimeStamp> now) {
  if (now) {
    HighResTimeStamp::setTimeStampProviderForTesting(
        [now] { return now->toChronoSteadyClockTimePoint(); });
  } else {
    HighResTimeStamp::setTimeStampProviderForTesting(nullptr);
  }
}

#else

void NativeFantom::forceHighResTimeStamp(
    jsi::Runtime& runtime,
    std::optional<HighResTimeStamp> /*now*/) {
  throw jsi::JSError(
      runtime, "Mocking timers is not supported in optimized builds");
}

#endif

const int JS_SAMPLING_PROFILER_HZ = 10000;

void NativeFantom::startJSSamplingProfiler(jsi::Runtime& /*runtime*/) {
  auto* hermesRootAPI =
      jsi::castInterface<hermes::IHermesRootAPI>(hermes::makeHermesRootAPI());
  hermesRootAPI->enableSamplingProfiler(JS_SAMPLING_PROFILER_HZ);
}

void NativeFantom::stopJSSamplingProfilerAndSaveToFile(
    jsi::Runtime& runtime,
    const std::string& filePath) {
  auto* hermesRootAPI =
      jsi::castInterface<hermes::IHermesRootAPI>(hermes::makeHermesRootAPI());
  hermesRootAPI->disableSamplingProfiler();
  std::ofstream fileStream(filePath);
  auto* hermesRuntime = dynamic_cast<hermes::HermesRuntime*>(&runtime);
  hermesRuntime->sampledTraceToStreamInDevToolsFormat(fileStream);
}

void NativeFantom::setImageResponse(
    jsi::Runtime& /*rt*/,
    const std::string& uri,
    const NativeFantomSetImageResponseImageResponse& imageResponse) {
  appDelegate_.mountingManager_->imageLoader_->setImageResponse(
      uri,
      {
          .width = imageResponse.width,
          .height = imageResponse.height,
          .cacheStatus = imageResponse.cacheStatus,
          .errorMessage = imageResponse.errorMessage,
      });
}

void NativeFantom::clearImage(jsi::Runtime& /*rt*/, const std::string& uri) {
  appDelegate_.mountingManager_->imageLoader_->clearImage(uri);
}

void NativeFantom::clearAllImages(jsi::Runtime& /*rt*/) {
  appDelegate_.mountingManager_->imageLoader_->clearAllImages();
}

} // namespace facebook::react
