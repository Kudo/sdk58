/*
 * rn-a11y: reanimated
 */

#pragma once

#include <worklets/Tools/UIScheduler.h>

#include <functional>
#include <thread>

namespace facebook::react::fantom_reanimated {

// The Fantom main thread (the thread that creates this object, i.e. the JS
// thread) is also the UI thread. Like IOSUIScheduler: a job scheduled on the
// UI thread runs immediately; a job from another thread is queued and runs at
// the next `triggerUI` (called at the start of every frame).
class HostUIScheduler : public worklets::UIScheduler {
 public:
  HostUIScheduler() : uiThread_(std::this_thread::get_id()) {}

  void scheduleOnUI(std::function<void()> job) override;

 protected:
  bool queryIsOnUIThread() const override;

 private:
  const std::thread::id uiThread_;
};

} // namespace facebook::react::fantom_reanimated
