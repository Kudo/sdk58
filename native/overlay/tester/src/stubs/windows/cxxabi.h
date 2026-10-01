/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// <cxxabi.h> for the MSVC STL (Windows host): react-native-worklets and
// react-native-reanimated demangle typeid(T).name() for log messages. MSVC
// type names are not mangled, so the name is returned as it is.

#pragma once

#include <cstdlib>
#include <cstring>

namespace __cxxabiv1 {

inline char* __cxa_demangle(const char* mangledName, char* /*outputBuffer*/, size_t* length, int* status) {
  char* result = _strdup(mangledName);
  if (length != nullptr) {
    *length = std::strlen(mangledName);
  }
  if (status != nullptr) {
    *status = result != nullptr ? 0 : -1;
  }
  return result;
}

} // namespace __cxxabiv1

namespace abi = __cxxabiv1;
