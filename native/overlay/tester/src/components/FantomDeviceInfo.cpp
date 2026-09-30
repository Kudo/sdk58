/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomDeviceInfo.h"

#include <FBReactNativeSpec/FBReactNativeSpecJSI.h>

#include <mutex>
#include <vector>

#include "../AppSettings.h"

namespace facebook::react {

namespace {

std::mutex gMutex;
FantomDeviceMetrics gMetrics{0, 0, 3, 1};
bool gInitialized = false;
bool gExplicit = false;

FantomDeviceMetrics currentLocked() {
  if (!gInitialized) {
    gMetrics = FantomDeviceMetrics{
        static_cast<double>(AppSettings::windowWidth),
        static_cast<double>(AppSettings::windowHeight),
        3,
        1};
    gInitialized = true;
  }
  return gMetrics;
}

bool same(const FantomDeviceMetrics& a, const FantomDeviceMetrics& b) {
  return a.width == b.width && a.height == b.height && a.scale == b.scale &&
      a.fontScale == b.fontScale;
}

jsi::Object displayMetrics(jsi::Runtime& rt, const FantomDeviceMetrics& m) {
  jsi::Object object(rt);
  object.setProperty(rt, "width", m.width);
  object.setProperty(rt, "height", m.height);
  object.setProperty(rt, "scale", m.scale);
  object.setProperty(rt, "fontScale", m.fontScale);
  return object;
}

// {window, screen}: the DimensionsPayload of the NativeDeviceInfo spec. The
// window is the whole screen (no split screen or system bars here).
jsi::Object dimensionsPayload(jsi::Runtime& rt, const FantomDeviceMetrics& m) {
  jsi::Object payload(rt);
  payload.setProperty(rt, "window", displayMetrics(rt, m));
  payload.setProperty(rt, "screen", displayMetrics(rt, m));
  return payload;
}

class FantomDeviceInfoModule;

// Live DeviceInfo modules (one per runtime), to emit didUpdateDimensions.
std::vector<std::weak_ptr<FantomDeviceInfoModule>>& modules() {
  static std::vector<std::weak_ptr<FantomDeviceInfoModule>> list;
  return list;
}

class FantomDeviceInfoModule final
    : public NativeDeviceInfoCxxSpec<FantomDeviceInfoModule> {
 public:
  explicit FantomDeviceInfoModule(std::shared_ptr<CallInvoker> jsInvoker)
      : NativeDeviceInfoCxxSpec(std::move(jsInvoker)) {}

  jsi::Object getConstants(jsi::Runtime& rt) {
    jsi::Object constants(rt);
    constants.setProperty(rt, "Dimensions", dimensionsPayload(rt, getFantomDeviceMetrics()));
    return constants;
  }

  void emitDimensions(const FantomDeviceMetrics& metrics) {
    emitDeviceEvent(
        "didUpdateDimensions",
        [metrics](jsi::Runtime& rt, std::vector<jsi::Value>& args) {
          args.emplace_back(dimensionsPayload(rt, metrics));
        });
  }
};

void emitAll(const FantomDeviceMetrics& metrics) {
  std::vector<std::shared_ptr<FantomDeviceInfoModule>> live;
  {
    std::lock_guard<std::mutex> lock(gMutex);
    auto& list = modules();
    for (auto it = list.begin(); it != list.end();) {
      if (auto module = it->lock()) {
        live.push_back(std::move(module));
        ++it;
      } else {
        it = list.erase(it);
      }
    }
  }
  for (auto& module : live) {
    module->emitDimensions(metrics);
  }
}

} // namespace

FantomDeviceMetrics getFantomDeviceMetrics() {
  std::lock_guard<std::mutex> lock(gMutex);
  return currentLocked();
}

void setFantomDeviceMetrics(const FantomDeviceMetrics& metrics) {
  bool changed;
  {
    std::lock_guard<std::mutex> lock(gMutex);
    changed = !same(currentLocked(), metrics);
    gMetrics = metrics;
    gExplicit = true;
  }
  if (changed) {
    emitAll(metrics);
  }
}

void noteFantomSurfaceStarted(double width, double height, double scale) {
  FantomDeviceMetrics metrics{};
  bool changed = false;
  {
    std::lock_guard<std::mutex> lock(gMutex);
    if (gExplicit) {
      return;
    }
    metrics = FantomDeviceMetrics{width, height, scale > 0 ? scale : 3, 1};
    changed = !same(currentLocked(), metrics);
    gMetrics = metrics;
  }
  if (changed) {
    emitAll(metrics);
  }
}

std::shared_ptr<TurboModule> createDeviceInfoModule(const std::shared_ptr<CallInvoker>& jsInvoker) {
  auto module = std::make_shared<FantomDeviceInfoModule>(jsInvoker);
  std::lock_guard<std::mutex> lock(gMutex);
  modules().push_back(module);
  return module;
}

} // namespace facebook::react
