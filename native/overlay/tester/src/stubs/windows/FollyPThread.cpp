/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The one function of folly/portability/PThread.cpp that the host links
// (folly::setThreadName(pthread_t, ...) in folly/system/ThreadName.cpp).
// PThread.cpp itself is not compiled on Windows: it needs boost::thread, a
// compiled boost library.

#include <folly/portability/PThread.h>

namespace folly::portability::pthread {

DWORD pthread_getw32threadid_np(pthread_t thread) {
  return thread->threadID;
}

} // namespace folly::portability::pthread
