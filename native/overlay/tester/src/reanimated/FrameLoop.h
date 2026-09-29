/*
 * rn-a11y: reanimated
 */

#pragma once

#include <functional>
#include <memory>
#include <vector>

namespace worklets {
class UIScheduler;
}

namespace facebook::react::fantom_reanimated {

// The host display link. One instance per process (Fantom has one React
// instance). All methods run on the Fantom main thread.
class FrameLoop {
 public:
  using FrameCallback = std::function<void(double)>;

  static FrameLoop &get();

  void setClock(std::function<double()> nowMs);
  double now() const;

  // worklets RuntimeBindings::requestAnimationFrame (drives the UI runtime's
  // `requestAnimationFrame` queue, which re-requests every frame).
  void requestAnimationFrame(FrameCallback callback);

  // reanimated PlatformDepMethodsHolder::requestRender (iOS: postOnAnimation).
  void requestRender(FrameCallback callback);

  // reanimated PlatformDepMethodsHolder::maybeFlushUIUpdatesQueueFunction.
  // Like iOS REANodesManager: flush now when no frame is running and no render
  // callback is waiting for the next frame; otherwise the next frame flushes.
  void maybeFlushUIUpdatesQueue();

  void setUIScheduler(std::shared_ptr<worklets::UIScheduler> uiScheduler);
  void setPerformOperations(std::function<void()> performOperations);

  bool isActive() const;

  void produceFrame();

  // Drops all callbacks (module teardown).
  void reset();

 private:
  std::function<double()> nowMs_;
  std::vector<FrameCallback> animationFrameCallbacks_;
  std::vector<FrameCallback> renderCallbacks_;
  std::shared_ptr<worklets::UIScheduler> uiScheduler_;
  std::function<void()> performOperations_;
  bool inFrame_{false};
};

} // namespace facebook::react::fantom_reanimated
