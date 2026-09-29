/*
 * rn-a11y: reanimated
 *
 * worklets::PlatformLogger for the Fantom host (Apple: NSLog, Android:
 * logcat). Writes to glog (stderr).
 */

#include <worklets/Tools/PlatformLogger.h>

#include <glog/logging.h>

namespace worklets {

void PlatformLogger::log(const char *str) {
  LOG(INFO) << "[worklets] " << str;
}

void PlatformLogger::log(const std::string &str) {
  log(str.c_str());
}

void PlatformLogger::log(const double d) {
  LOG(INFO) << "[worklets] " << d;
}

void PlatformLogger::log(const int i) {
  LOG(INFO) << "[worklets] " << i;
}

void PlatformLogger::log(const bool b) {
  log(b ? "true" : "false");
}

} // namespace worklets
