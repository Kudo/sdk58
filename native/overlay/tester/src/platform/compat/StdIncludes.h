// Force-included (CMakeLists.txt: fantom_force_std_includes) into the C++ of
// the third-party targets that use standard names without including their
// header, off Apple only. libc++ declares these names through other headers;
// libstdc++ does not. The first error of each, on Ubuntu 24.04 (clang 18,
// libstdc++ 14):
//   ReactCommon jsinspector-modern/network/HttpUtils.h       uint16_t
//   ReactCommon react/debug/redbox/AnsiParser.h              uint8_t
//   react-native-worklets RunLoop/EventLoop.cpp              std::remove_if, std::upper_bound
//   react-native-worklets Tools/FeatureFlags.h               std::logic_error
//   react-native-worklets Tools/JSISerializer.cpp            std::find
//   react-native-worklets Tools/WorkletsJSIUtils.cpp         std::istream_iterator
//   react-native-reanimated CSS/common/transforms/vectors.h  size_t, std::hypot
//   react-native-reanimated CSS/common/filters/FilterOp.h    uint8_t, std::invalid_argument
// With the MSVC STL (Windows, clang-cl), in addition:
//   react-native-worklets RunLoop/EventLoop.cpp              std::chrono::system_clock
// Remove an entry when the library includes the header itself.
#pragma once

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <iterator>
#include <stdexcept>
