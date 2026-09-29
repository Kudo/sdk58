/*
 * rn-a11y: reanimated
 */

#include "HostUIScheduler.h"

#include <utility>

namespace facebook::react::fantom_reanimated {

void HostUIScheduler::scheduleOnUI(std::function<void()> job) {
  if (isOnUIThread()) {
    job();
    return;
  }
  worklets::UIScheduler::scheduleOnUI(std::move(job));
}

bool HostUIScheduler::queryIsOnUIThread() const {
  return std::this_thread::get_id() == uiThread_;
}

} // namespace facebook::react::fantom_reanimated
