/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#pragma once

#include <ReactCommon/CallInvoker.h>
#include <ReactCommon/TurboModule.h>

#include <memory>

namespace facebook::react {

/*
 * Device metrics for `Dimensions`, `useWindowDimensions` and `PixelRatio`
 * (the DeviceInfo TurboModule) and for the safe-area frame. ReactCxxPlatform's
 * DeviceInfoModule returns a hard-coded 1280x720 with scale 0.
 *
 * Until NativeFantom.setDeviceMetrics is called, the metrics follow the last
 * started surface (its viewport size and devicePixelRatio, font scale 1); before
 * the first surface they are the tester window size (AppSettings, 1280x720),
 * scale 3, font scale 1. After setDeviceMetrics they stay as set.
 */
struct FantomDeviceMetrics {
  double width;
  double height;
  double scale;
  double fontScale;
};

FantomDeviceMetrics getFantomDeviceMetrics();

// NativeFantom.setDeviceMetrics: sets the metrics (window = screen) and emits
// `didUpdateDimensions` if they changed.
void setFantomDeviceMetrics(const FantomDeviceMetrics &metrics);

// NativeFantom.startSurface: the default metrics follow the surface unless
// setDeviceMetrics was called (emits `didUpdateDimensions` if they changed).
void noteFantomSurfaceStarted(double width, double height, double scale);

// The DeviceInfo TurboModule (NativeDeviceInfo spec).
std::shared_ptr<TurboModule> createDeviceInfoModule(const std::shared_ptr<CallInvoker> &jsInvoker);

} // namespace facebook::react
