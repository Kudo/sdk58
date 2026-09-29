/*
 * rn-a11y: reanimated
 */

#include "FrameLoop.h"

#include <worklets/Tools/UIScheduler.h>

#include <chrono>
#include <utility>

namespace facebook::react::fantom_reanimated {

FrameLoop &FrameLoop::get() {
  static FrameLoop instance;
  return instance;
}

void FrameLoop::setClock(std::function<double()> nowMs) {
  nowMs_ = std::move(nowMs);
}

double FrameLoop::now() const {
  if (nowMs_) {
    return nowMs_();
  }
  return std::chrono::duration<double, std::milli>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

void FrameLoop::requestAnimationFrame(FrameCallback callback) {
  animationFrameCallbacks_.push_back(std::move(callback));
}

void FrameLoop::requestRender(FrameCallback callback) {
  renderCallbacks_.push_back(std::move(callback));
}

void FrameLoop::maybeFlushUIUpdatesQueue() {
  if (!inFrame_ && renderCallbacks_.empty() && performOperations_) {
    performOperations_();
  }
}

void FrameLoop::setUIScheduler(
    std::shared_ptr<worklets::UIScheduler> uiScheduler) {
  uiScheduler_ = std::move(uiScheduler);
}

void FrameLoop::setPerformOperations(std::function<void()> performOperations) {
  performOperations_ = std::move(performOperations);
}

bool FrameLoop::isActive() const {
  return uiScheduler_ != nullptr;
}

void FrameLoop::produceFrame() {
  if (inFrame_ || !isActive()) {
    return;
  }

  struct FrameScope {
    bool &inFrame;
    explicit FrameScope(bool &flag) : inFrame(flag) {
      inFrame = true;
    }
    ~FrameScope() {
      inFrame = false;
    }
  } scope{inFrame_};

  uiScheduler_->triggerUI();

  const double timestamp = now();

  // Callbacks requested while running belong to the next frame.
  auto animationFrameCallbacks = std::exchange(animationFrameCallbacks_, {});
  for (auto &callback : animationFrameCallbacks) {
    callback(timestamp);
  }

  auto renderCallbacks = std::exchange(renderCallbacks_, {});
  for (auto &callback : renderCallbacks) {
    callback(timestamp);
  }

  if (performOperations_) {
    performOperations_();
  }
}

void FrameLoop::reset() {
  animationFrameCallbacks_.clear();
  renderCallbacks_.clear();
  uiScheduler_.reset();
  performOperations_ = nullptr;
}

} // namespace facebook::react::fantom_reanimated
