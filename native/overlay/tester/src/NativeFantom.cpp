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
#include "components/FantomSafeArea.h"
#include "components/FantomScreens.h"
#include "components/FantomTextInput.h"
#include "render/A11yTree.h"
#include "render/HitTest.h"
#include "render/RenderFormatOptions.h"
#include "render/RenderOutput.h"

namespace facebook::react {

namespace {

// getA11yTree(surfaceId: number, includeDebugProps?: ?boolean,
//             includeMountedProps?: ?boolean /* default true */): string
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
  bool includeMountedProps =
      !(count > 2 && args[2].isBool() && !args[2].getBool());
  return jsi::String::createFromUtf8(
      runtime,
      static_cast<NativeFantom&>(turboModule)
          .getA11yTree(
              runtime, surfaceId, includeDebugProps, includeMountedProps));
}

SurfaceId surfaceIdArg(jsi::Runtime& runtime, const jsi::Value* args, size_t count, const char* method) {
  if (count < 1 || !args[0].isNumber()) {
    throw jsi::JSError(
        runtime,
        std::string(method) + ": expected a surface ID as the first argument");
  }
  return static_cast<SurfaceId>(args[0].asNumber());
}

double numberArg(
    jsi::Runtime& runtime,
    const jsi::Value* args,
    size_t count,
    size_t index,
    const char* method,
    const char* name) {
  if (count <= index || !args[index].isNumber()) {
    throw jsi::JSError(
        runtime,
        std::string(method) + ": expected a number for `" + name + "`");
  }
  return args[index].asNumber();
}

std::string stringArg(
    jsi::Runtime& runtime,
    const jsi::Value* args,
    size_t count,
    size_t index,
    const char* method,
    const char* name) {
  if (count <= index || !args[index].isString()) {
    throw jsi::JSError(
        runtime,
        std::string(method) + ": expected a string for `" + name + "`");
  }
  return args[index].asString(runtime).utf8(runtime);
}

bool isPresent(const jsi::Value* args, size_t count, size_t index) {
  return count > index && !args[index].isUndefined() && !args[index].isNull();
}

// hitTest(surfaceId: number, x: number, y: number): string
jsi::Value hitTestHostFunction(
    jsi::Runtime& runtime,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  auto surfaceId = surfaceIdArg(runtime, args, count, "hitTest");
  auto x = numberArg(runtime, args, count, 1, "hitTest", "x");
  auto y = numberArg(runtime, args, count, 2, "hitTest", "y");
  return jsi::String::createFromUtf8(
      runtime,
      static_cast<NativeFantom&>(turboModule)
          .hitTest(
              runtime,
              surfaceId,
              static_cast<Float>(x),
              static_cast<Float>(y)));
}

// enqueueNativeEventByTag(surfaceId, tag, type, payload?, category?, isUnique?)
jsi::Value enqueueNativeEventByTagHostFunction(
    jsi::Runtime& runtime,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  constexpr auto kMethod = "enqueueNativeEventByTag";
  auto surfaceId = surfaceIdArg(runtime, args, count, kMethod);
  auto tag = static_cast<Tag>(numberArg(runtime, args, count, 1, kMethod, "tag"));
  auto type = stringArg(runtime, args, count, 2, kMethod, "type");
  std::optional<folly::dynamic> payload;
  if (isPresent(args, count, 3)) {
    payload = jsi::dynamicFromValue(runtime, args[3]);
  }
  std::optional<RawEvent::Category> category;
  if (isPresent(args, count, 4)) {
    category = Bridging<RawEvent::Category>::fromJs(
        runtime, jsi::Value(runtime, args[4]));
  }
  std::optional<bool> isUnique;
  if (isPresent(args, count, 5)) {
    isUnique = args[5].asBool();
  }
  static_cast<NativeFantom&>(turboModule)
      .enqueueNativeEventByTag(
          runtime, surfaceId, tag, type, payload, category, isUnique);
  return jsi::Value::undefined();
}

// enqueueScrollEventByTag(surfaceId, tag, {x, y, zoomScale?})
jsi::Value enqueueScrollEventByTagHostFunction(
    jsi::Runtime& runtime,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  constexpr auto kMethod = "enqueueScrollEventByTag";
  auto surfaceId = surfaceIdArg(runtime, args, count, kMethod);
  auto tag = static_cast<Tag>(numberArg(runtime, args, count, 1, kMethod, "tag"));
  if (count < 3 || !args[2].isObject()) {
    throw jsi::JSError(
        runtime, std::string(kMethod) + ": expected {x, y, zoomScale?}");
  }
  auto options = Bridging<ScrollOptions>::fromJs(
      runtime, args[2].asObject(runtime), nullptr);
  static_cast<NativeFantom&>(turboModule)
      .enqueueScrollEventByTag(runtime, surfaceId, tag, options);
  return jsi::Value::undefined();
}

// setTextInputTextByTag(surfaceId, tag, text)
jsi::Value setTextInputTextByTagHostFunction(
    jsi::Runtime& runtime,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  constexpr auto kMethod = "setTextInputTextByTag";
  auto surfaceId = surfaceIdArg(runtime, args, count, kMethod);
  auto tag = static_cast<Tag>(numberArg(runtime, args, count, 1, kMethod, "tag"));
  auto text = stringArg(runtime, args, count, 2, kMethod, "text");
  static_cast<NativeFantom&>(turboModule)
      .setTextInputTextByTag(runtime, surfaceId, tag, text);
  return jsi::Value::undefined();
}

// updateScreenStates(surfaceId): number
jsi::Value updateScreenStatesHostFunction(
    jsi::Runtime& runtime,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  auto surfaceId = surfaceIdArg(runtime, args, count, "updateScreenStates");
  return jsi::Value(static_cast<NativeFantom&>(turboModule)
                        .updateScreenStates(runtime, surfaceId));
}

// setSafeAreaInsets({top, left, right, bottom}): void
jsi::Value setSafeAreaInsetsHostFunction(
    jsi::Runtime& runtime,
    TurboModule& /*turboModule*/,
    const jsi::Value* args,
    size_t count) {
  if (count < 1 || !args[0].isObject()) {
    throw jsi::JSError(
        runtime, "setSafeAreaInsets: expected {top, left, right, bottom}");
  }
  auto object = args[0].asObject(runtime);
  auto edge = [&](const char* name) -> Float {
    auto value = object.getProperty(runtime, name);
    return value.isNumber() ? static_cast<Float>(value.asNumber()) : 0;
  };
  setSafeAreaInsets(EdgeInsets{
      .left = edge("left"),
      .top = edge("top"),
      .right = edge("right"),
      .bottom = edge("bottom")});
  return jsi::Value::undefined();
}

// setScreensHeaderHeight(height): void
jsi::Value setScreensHeaderHeightHostFunction(
    jsi::Runtime& runtime,
    TurboModule& /*turboModule*/,
    const jsi::Value* args,
    size_t count) {
  auto height = numberArg(
      runtime, args, count, 0, "setScreensHeaderHeight", "height");
  setScreensHeaderHeight(static_cast<Float>(height));
  return jsi::Value::undefined();
}

} // namespace

NativeFantom::NativeFantom(
    TesterAppDelegate& appDelegate,
    std::shared_ptr<CallInvoker> jsInvoker)
    : NativeFantomCxxSpec<NativeFantom>(std::move(jsInvoker)),
      appDelegate_(appDelegate) {
  methodMap_["getA11yTree"] =
      MethodMetadata{.argCount = 3, .invoker = getA11yTreeHostFunction};
  methodMap_["hitTest"] =
      MethodMetadata{.argCount = 3, .invoker = hitTestHostFunction};
  methodMap_["enqueueNativeEventByTag"] = MethodMetadata{
      .argCount = 6, .invoker = enqueueNativeEventByTagHostFunction};
  methodMap_["enqueueScrollEventByTag"] = MethodMetadata{
      .argCount = 3, .invoker = enqueueScrollEventByTagHostFunction};
  methodMap_["setTextInputTextByTag"] = MethodMetadata{
      .argCount = 3, .invoker = setTextInputTextByTagHostFunction};
  methodMap_["updateScreenStates"] = MethodMetadata{
      .argCount = 1, .invoker = updateScreenStatesHostFunction};
  methodMap_["setScreensHeaderHeight"] = MethodMetadata{
      .argCount = 1, .invoker = setScreensHeaderHeightHostFunction};
  methodMap_["updateNativeStates"] = MethodMetadata{
      .argCount = 1, .invoker = updateScreenStatesHostFunction};
  methodMap_["setSafeAreaInsets"] = MethodMetadata{
      .argCount = 1, .invoker = setSafeAreaInsetsHostFunction};
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
  setSafeAreaWindowSize(Size{
      static_cast<Float>(viewportWidth), static_cast<Float>(viewportHeight)});
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
    bool includeDebugProps,
    bool includeMountedProps) {
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
        std::optional<StubViewTree> mountedViewTree;
        if (includeMountedProps) {
          mountedViewTree = appDelegate_.mountingManager_->getViewTree(surfaceId);
        }
        result = folly::json::serialize(
            renderA11yTree(
                *rootShadowNode,
                {.includeDebugProps = includeDebugProps,
                 .mountedViewTree = mountedViewTree.has_value()
                     ? &mountedViewTree.value()
                     : nullptr}),
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

std::shared_ptr<const ShadowNode> NativeFantom::getRootShadowNode(
    jsi::Runtime& runtime,
    SurfaceId surfaceId) {
  auto uiManagerBinding = UIManagerBinding::getBinding(runtime);
  if (uiManagerBinding == nullptr) {
    throw jsi::JSError(runtime, "UIManagerBinding is not available");
  }
  std::shared_ptr<const ShadowNode> rootShadowNode;
  uiManagerBinding->getUIManager().getShadowTreeRegistry().visit(
      surfaceId, [&](const ShadowTree& shadowTree) {
        rootShadowNode = shadowTree.getCurrentRevision().rootShadowNode;
      });
  if (rootShadowNode == nullptr) {
    throw jsi::JSError(
        runtime, "No shadow tree for surface " + std::to_string(surfaceId));
  }
  return rootShadowNode;
}

std::shared_ptr<const ShadowNode> NativeFantom::getShadowNodeByTag(
    jsi::Runtime& runtime,
    SurfaceId surfaceId,
    Tag tag) {
  auto shadowNode =
      findShadowNodeByTag(getRootShadowNode(runtime, surfaceId), tag);
  if (shadowNode == nullptr) {
    throw jsi::JSError(
        runtime,
        "No shadow node with tag " + std::to_string(tag) + " in surface " +
            std::to_string(surfaceId));
  }
  return shadowNode;
}

std::string NativeFantom::hitTest(
    jsi::Runtime& runtime,
    SurfaceId surfaceId,
    Float x,
    Float y) {
  auto result =
      facebook::react::hitTest(getRootShadowNode(runtime, surfaceId), {x, y});
  if (!result.has_value()) {
    return "null";
  }
  folly::dynamic path = folly::dynamic::array();
  for (auto tag : result->path) {
    path.push_back(tag);
  }
  return folly::toJson(
      folly::dynamic::object("tag", result->node->getTag())(
          "type", result->node->getComponentName())("path", path)(
          "viaHitSlop", result->viaHitSlop));
}

void NativeFantom::enqueueNativeEventByTag(
    jsi::Runtime& runtime,
    SurfaceId surfaceId,
    Tag tag,
    const std::string& type,
    const std::optional<folly::dynamic>& payload,
    std::optional<RawEvent::Category> category,
    std::optional<bool> isUnique) {
  enqueueNativeEvent(
      runtime,
      getShadowNodeByTag(runtime, surfaceId, tag),
      type,
      payload,
      category,
      isUnique);
}

void NativeFantom::enqueueScrollEventByTag(
    jsi::Runtime& runtime,
    SurfaceId surfaceId,
    Tag tag,
    ScrollOptions options) {
  auto shadowNode = getShadowNodeByTag(runtime, surfaceId, tag);
  if (dynamic_cast<const ScrollViewShadowNode*>(shadowNode.get()) == nullptr) {
    throw jsi::JSError(
        runtime,
        "enqueueScrollEventByTag: node " + std::to_string(tag) +
            " is not a ScrollView");
  }
  enqueueScrollEvent(runtime, shadowNode, options);
}

void NativeFantom::setTextInputTextByTag(
    jsi::Runtime& runtime,
    SurfaceId surfaceId,
    Tag tag,
    const std::string& text) {
  auto shadowNode = getShadowNodeByTag(runtime, surfaceId, tag);
  if (!setFantomTextInputText(*shadowNode, text)) {
    throw jsi::JSError(
        runtime,
        "setTextInputTextByTag: node " + std::to_string(tag) +
            " is not a TextInput");
  }
}

int NativeFantom::updateScreenStates(
    jsi::Runtime& runtime,
    SurfaceId surfaceId) {
  auto rootShadowNode = getRootShadowNode(runtime, surfaceId);
  return facebook::react::updateScreenStates(*rootShadowNode) +
      updateSafeAreas(*rootShadowNode);
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
  // ScrollEvent's default zoomScale is 0; devices report 1 when not zoomed
  // (VirtualizedList divides/multiplies offsets by it).
  scrollEvent.zoomScale = options.zoomScale.value_or(1);

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
