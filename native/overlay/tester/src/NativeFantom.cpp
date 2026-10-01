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
#include <cxxreact/ReactNativeVersion.h>
#include <react/debug/flags.h>
#include <react/renderer/components/modal/ModalHostViewShadowNode.h>
#include <react/renderer/components/scrollview/ScrollViewShadowNode.h>
#include <react/renderer/uimanager/UIManagerBinding.h>
#include <fstream>
#include <iostream>

#include "TesterAppDelegate.h"

#include <jsi/instrumentation.h>
#include "components/FantomDeviceInfo.h"
#include "components/FantomExpo.h"
#include "components/FantomExpoText.h"
#include "components/FantomSafeArea.h"
#include "components/FantomScreens.h"
#include "components/FantomTextInput.h"
#ifdef FANTOM_WITH_EMBEDDED_FONTS
#ifdef FANTOM_WITH_PORTABLE_TEXT_LAYOUT
#include "platform/portable/EmbeddedFonts.h"
#else
#include "platform/macos/EmbeddedFonts.h"
#endif
#endif
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

// getShadowTreeRevision(surfaceId): number
jsi::Value getShadowTreeRevisionHostFunction(
    jsi::Runtime& runtime,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  auto surfaceId = surfaceIdArg(runtime, args, count, "getShadowTreeRevision");
  return jsi::Value(static_cast<double>(
      static_cast<NativeFantom&>(turboModule)
          .getShadowTreeRevision(runtime, surfaceId)));
}

// getMountedRevision(surfaceId): number
jsi::Value getMountedRevisionHostFunction(
    jsi::Runtime& runtime,
    TurboModule& turboModule,
    const jsi::Value* args,
    size_t count) {
  auto surfaceId = surfaceIdArg(runtime, args, count, "getMountedRevision");
  return jsi::Value(static_cast<double>(
      static_cast<NativeFantom&>(turboModule).getMountedRevision(surfaceId)));
}

// measureExpoText(text, {textStyle?, size?, weight?, italic?, design?,
//   fontFamily?, maxWidth?, maxLines?, pointScaleFactor?}): {width, height}
jsi::Value measureExpoTextHostFunction(
    jsi::Runtime& runtime,
    TurboModule& /*turboModule*/,
    const jsi::Value* args,
    size_t count) {
  auto text = stringArg(runtime, args, count, 0, "measureExpoText", "text");
  ExpoTextMeasureOptions options;
  Float pointScaleFactor = 3;
  if (isPresent(args, count, 1)) {
    auto object = args[1].asObject(runtime);
    auto get = [&](const char* name) { return object.getProperty(runtime, name); };
    if (auto style = get("textStyle"); style.isString()) {
      if (auto textStyle = swiftUITextStyle(style.asString(runtime).utf8(runtime))) {
        options.size = textStyle->size;
        options.weight = textStyle->weight;
      }
    }
    if (auto value = get("size"); value.isNumber()) {
      options.size = static_cast<Float>(value.asNumber());
    }
    if (auto value = get("weight"); value.isNumber()) {
      options.weight = static_cast<int>(value.asNumber());
    }
    if (auto value = get("italic"); value.isBool()) {
      options.italic = value.getBool();
    }
    if (auto value = get("design"); value.isString()) {
      options.design = value.asString(runtime).utf8(runtime);
    }
    if (auto value = get("fontFamily"); value.isString()) {
      options.fontFamily = value.asString(runtime).utf8(runtime);
    }
    if (auto value = get("maxWidth"); value.isNumber()) {
      options.maxWidth = static_cast<Float>(value.asNumber());
    }
    if (auto value = get("maxLines"); value.isNumber()) {
      options.maxLines = static_cast<int>(value.asNumber());
    }
    if (auto value = get("pointScaleFactor"); value.isNumber()) {
      pointScaleFactor = static_cast<Float>(value.asNumber());
    }
  }
  auto size = measureExpoText(text, options, pointScaleFactor);
  auto result = jsi::Object(runtime);
  result.setProperty(runtime, "width", size.width);
  result.setProperty(runtime, "height", size.height);
  return result;
}

// dispatchExpoModifierEvent(tag, type, params?): void
jsi::Value dispatchExpoModifierEventHostFunction(
    jsi::Runtime& runtime,
    TurboModule& /*turboModule*/,
    const jsi::Value* args,
    size_t count) {
  constexpr auto kMethod = "dispatchExpoModifierEvent";
  auto tag = static_cast<Tag>(numberArg(runtime, args, count, 0, kMethod, "tag"));
  auto type = stringArg(runtime, args, count, 1, kMethod, "type");
  folly::dynamic params = folly::dynamic::object();
  if (isPresent(args, count, 2)) {
    params = jsi::dynamicFromValue(runtime, args[2]);
  }
  auto uiManagerBinding = UIManagerBinding::getBinding(runtime);
  if (uiManagerBinding == nullptr) {
    throw jsi::JSError(runtime, "UIManagerBinding is not available");
  }
  // The tag is unique across surfaces: search all of them.
  std::shared_ptr<const ShadowNode> shadowNode;
  uiManagerBinding->getUIManager().getShadowTreeRegistry().enumerate(
      [&](const ShadowTree& shadowTree, bool& stop) {
        shadowNode = findShadowNodeByTag(
            shadowTree.getCurrentRevision().rootShadowNode, tag);
        stop = shadowNode != nullptr;
      });
  if (shadowNode == nullptr) {
    throw jsi::JSError(
        runtime, std::string(kMethod) + ": no shadow node with tag " + std::to_string(tag));
  }
  if (!dispatchExpoModifierEvent(*shadowNode, type, params)) {
    throw jsi::JSError(
        runtime,
        std::string(kMethod) + ": node " + std::to_string(tag) + " is not an Expo view");
  }
  return jsi::Value::undefined();
}

// setExpoUIPlatform('ios' | 'macos'): metrics of the SwiftUI layout engine
// (default 'ios'). Applies to the next layout of a Host.
jsi::Value setExpoUIPlatformHostFunction(
    jsi::Runtime& runtime,
    TurboModule& /*turboModule*/,
    const jsi::Value* args,
    size_t count) {
  auto platform = stringArg(runtime, args, count, 0, "setExpoUIPlatform", "platform");
  if (platform != "ios" && platform != "macos") {
    throw jsi::JSError(runtime, "setExpoUIPlatform: expected 'ios' or 'macos'");
  }
  setExpoUIPlatform(platform);
  return jsi::Value::undefined();
}

// The host protocol: bumped when a NativeFantom method signature or the
// getA11yTree node shape changes incompatibly (native/README.md). The CLI
// checks it against host-version.json / SUPPORTED_PROTOCOL in src/host.ts.
constexpr int kHostProtocolVersion = 1;

// getHostInfo(): string (JSON {protocolVersion, rnVersion, buildType,
// sanitize, engines: {swiftui, compose}, fonts: {roboto}, textLayout:
// "macos" | "portable" | "stub"})
jsi::Value getHostInfoHostFunction(
    jsi::Runtime& runtime,
    TurboModule& /*turboModule*/,
    const jsi::Value* /*args*/,
    size_t /*count*/) {
  std::string rnVersion = std::to_string(ReactNativeVersion.Major) + "." +
      std::to_string(ReactNativeVersion.Minor) + "." + std::to_string(ReactNativeVersion.Patch);
  if (!ReactNativeVersion.Prerelease.empty()) {
    rnVersion += "-" + std::string(ReactNativeVersion.Prerelease);
  }
#ifdef FANTOM_BUILD_TYPE
  std::string buildType = FANTOM_BUILD_TYPE;
#else
  std::string buildType = "unknown";
#endif
  bool sanitize = false;
#if defined(__has_feature)
#if __has_feature(address_sanitizer) || __has_feature(undefined_behavior_sanitizer)
  sanitize = true;
#endif
#endif
  bool swiftui = false;
  bool compose = false;
#ifdef FANTOM_EXPO_UI_LAYOUT_ENGINE
  swiftui = true;
#endif
#ifdef FANTOM_EXPO_UI_COMPOSE_ENGINE
  compose = true;
#endif
  bool roboto = false;
#ifdef FANTOM_WITH_EMBEDDED_FONTS
  // Registers the embedded fonts if not done yet (once per process).
  roboto = registerEmbeddedFonts() > 0;
#endif
#if defined(FANTOM_WITH_MACOS_TEXT_LAYOUT)
  std::string textLayout = "macos";
#elif defined(FANTOM_WITH_PORTABLE_TEXT_LAYOUT)
  std::string textLayout = "portable";
#else
  std::string textLayout = "stub";
#endif
  folly::dynamic info = folly::dynamic::object("protocolVersion", kHostProtocolVersion)(
      "rnVersion", rnVersion)("buildType", buildType)("sanitize", sanitize)(
      "engines", folly::dynamic::object("swiftui", swiftui)("compose", compose))(
      "fonts", folly::dynamic::object("roboto", roboto))("textLayout", textLayout);
  return jsi::String::createFromUtf8(runtime, folly::toJson(info));
}

// setDeviceMetrics({width, height, scale?, fontScale?}): the DeviceInfo
// metrics (Dimensions window and screen, PixelRatio) and the safe-area window
// frame. Emits didUpdateDimensions when they change. Defaults for missing
// fields: the current values.
jsi::Value setDeviceMetricsHostFunction(
    jsi::Runtime& runtime,
    TurboModule& /*turboModule*/,
    const jsi::Value* args,
    size_t count) {
  if (count < 1 || !args[0].isObject()) {
    throw jsi::JSError(runtime, "setDeviceMetrics: expected {width, height, scale?, fontScale?}");
  }
  auto object = args[0].asObject(runtime);
  auto metrics = getFantomDeviceMetrics();
  auto read = [&](const char* key, double& out) {
    auto value = object.getProperty(runtime, key);
    if (value.isNumber()) {
      if (!(value.asNumber() > 0)) {
        throw jsi::JSError(runtime, std::string("setDeviceMetrics: ") + key + " must be > 0");
      }
      out = value.asNumber();
    } else if (!value.isUndefined()) {
      throw jsi::JSError(runtime, std::string("setDeviceMetrics: ") + key + " must be a number");
    }
  };
  read("width", metrics.width);
  read("height", metrics.height);
  read("scale", metrics.scale);
  read("fontScale", metrics.fontScale);
  setFantomDeviceMetrics(metrics);
  return jsi::Value::undefined();
}

// getCapabilities(): string (JSON array of the host's feature strings)
jsi::Value getCapabilitiesHostFunction(
    jsi::Runtime& runtime,
    TurboModule& /*turboModule*/,
    const jsi::Value* /*args*/,
    size_t /*count*/) {
  folly::dynamic capabilities = folly::dynamic::array(
      "getA11yTree",
      "getA11yTree.mounted",
      "mountedProps",
      "hitTest",
      "eventsByTag",
      "setTextInputText",
      "updateNativeStates",
      "statusBarManager",
      "textInput",
      "switch",
      "shadowTreeRevision",
      "mountedRevision",
      "effectiveBackground",
      "getHostInfo",
      "deviceMetrics",
      "protocolVersion:" + std::to_string(kHostProtocolVersion));
#ifdef FANTOM_WITH_EXPO_UI
  capabilities.push_back("expoUI");
  capabilities.push_back("expoModifierEvents");
#ifdef FANTOM_EXPO_UI_LAYOUT_ENGINE
  capabilities.push_back("expoUI.swiftUILayout");
  capabilities.push_back("setExpoUIPlatform");
#ifdef FANTOM_EXPO_UI_COMPOSE_ENGINE
  capabilities.push_back("expoUI.composeLayout");
#endif
#endif
#endif
#ifdef FANTOM_WITH_MACOS_TEXT_LAYOUT
  capabilities.push_back("textLayout");
#endif
#ifdef FANTOM_WITH_PORTABLE_TEXT_LAYOUT
  capabilities.push_back("textLayout");
  capabilities.push_back("textLayout.portable");
#endif
#ifdef FANTOM_WITH_SAFEAREACONTEXT
  capabilities.push_back("safeArea");
#endif
#ifdef FANTOM_WITH_RNSCREENS
  capabilities.push_back("screens");
#endif
#ifdef FANTOM_WITH_RNGESTUREHANDLER
  capabilities.push_back("gestureHandler");
#endif
#ifdef FANTOM_WITH_WORKLETS
  capabilities.push_back("worklets");
#endif
#ifdef FANTOM_WITH_REANIMATED
  capabilities.push_back("reanimated");
#endif
  return jsi::String::createFromUtf8(runtime, folly::toJson(capabilities));
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
  methodMap_["getShadowTreeRevision"] = MethodMetadata{
      .argCount = 1, .invoker = getShadowTreeRevisionHostFunction};
  methodMap_["getMountedRevision"] = MethodMetadata{
      .argCount = 1, .invoker = getMountedRevisionHostFunction};
  methodMap_["measureExpoText"] = MethodMetadata{
      .argCount = 2, .invoker = measureExpoTextHostFunction};
  methodMap_["dispatchExpoModifierEvent"] = MethodMetadata{
      .argCount = 3, .invoker = dispatchExpoModifierEventHostFunction};
  methodMap_["setExpoUIPlatform"] = MethodMetadata{
      .argCount = 1, .invoker = setExpoUIPlatformHostFunction};
  methodMap_["getCapabilities"] = MethodMetadata{
      .argCount = 0, .invoker = getCapabilitiesHostFunction};
  methodMap_["setDeviceMetrics"] = MethodMetadata{
      .argCount = 1, .invoker = setDeviceMetricsHostFunction};
  methodMap_["getHostInfo"] = MethodMetadata{
      .argCount = 0, .invoker = getHostInfoHostFunction};
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
  noteFantomSurfaceStarted(viewportWidth, viewportHeight, devicePixelRatio);
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

int64_t NativeFantom::getShadowTreeRevision(
    jsi::Runtime& runtime,
    SurfaceId surfaceId) {
  auto uiManagerBinding = UIManagerBinding::getBinding(runtime);
  if (uiManagerBinding == nullptr) {
    throw jsi::JSError(runtime, "UIManagerBinding is not available");
  }
  std::optional<int64_t> number;
  uiManagerBinding->getUIManager().getShadowTreeRegistry().visit(
      surfaceId, [&](const ShadowTree& shadowTree) {
        number = shadowTree.getCurrentRevision().number;
      });
  if (!number.has_value()) {
    throw jsi::JSError(
        runtime, "No shadow tree for surface " + std::to_string(surfaceId));
  }
  return *number;
}

int64_t NativeFantom::getMountedRevision(SurfaceId surfaceId) {
  return appDelegate_.mountingManager_->getMountedRevision(surfaceId);
}

int NativeFantom::updateScreenStates(
    jsi::Runtime& runtime,
    SurfaceId surfaceId) {
  auto rootShadowNode = getRootShadowNode(runtime, surfaceId);
  return facebook::react::updateScreenStates(*rootShadowNode) +
      updateSafeAreas(*rootShadowNode) + updateExpoHostSizes(*rootShadowNode);
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
