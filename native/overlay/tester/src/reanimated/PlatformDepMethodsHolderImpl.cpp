/*
 * rn-a11y: reanimated
 */

#include "PlatformDepMethodsHolderImpl.h"

#include "FrameLoop.h"

#include <glog/logging.h>

#include <utility>

namespace facebook::react::fantom_reanimated {

reanimated::PlatformDepMethodsHolder makePlatformDepMethodsHolder() {
  reanimated::PlatformDepMethodsHolder holder;

  // iOS: REANodesManager postOnAnimation; the callback gets the frame time.
  holder.requestRender = [](std::function<void(const double)> onRender) {
    FrameLoop::get().requestRender(std::move(onRender));
  };

#ifdef __APPLE__
  // Only used for RNSScreen snapshots during layout animations.
  holder.forceScreenSnapshotFunction = [](Tag /*tag*/) {};
#endif

  // Only called when IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS is true (it is false),
  // so all updates go through shadow tree commits.
  holder.synchronouslyUpdateUIPropsFunction =
      [](const int viewTag, const folly::dynamic & /*props*/) {
        LOG(WARNING) << "[reanimated] synchronouslyUpdateUIProps(" << viewTag
                     << ") is not supported in Fantom";
      };

  holder.getAnimationTimestamp = []() { return FrameLoop::get().now(); };

  // No sensors, gesture handler, keyboard or pseudo selectors (:hover etc.).
  holder.registerSensor = [](int /*sensorType*/,
                             int /*interval*/,
                             int /*iosReferenceFrame*/,
                             std::function<void(double[], int)> /*setter*/) {
    return -1;
  };
  holder.unregisterSensor = [](int /*sensorId*/) {};
  holder.setGestureStateFunction = [](int /*handlerTag*/, int /*newState*/) {};
  holder.subscribeForKeyboardEvents =
      [](std::function<void(int, int)> /*keyboardEventDataUpdater*/,
         bool /*isStatusBarTranslucent*/,
         bool /*isNavigationBarTranslucent*/) { return -1; };
  holder.unsubscribeFromKeyboardEvents = [](int /*listenerId*/) {};
  holder.maybeFlushUIUpdatesQueueFunction = []() {
    FrameLoop::get().maybeFlushUIUpdatesQueue();
  };
  holder.attachPseudoSelector = [](Tag /*tag*/,
                                   reanimated::PseudoSelector /*selector*/,
                                   std::function<void(bool)> /*callback*/) {};
  holder.detachPseudoSelector =
      [](Tag /*tag*/, reanimated::PseudoSelector /*selector*/) {};

  // CSS transitions and animations run on the C++ loop.
  holder.platformTransitionBackend = nullptr;
  holder.platformAnimationFactory = nullptr;
  return holder;
}

} // namespace facebook::react::fantom_reanimated
