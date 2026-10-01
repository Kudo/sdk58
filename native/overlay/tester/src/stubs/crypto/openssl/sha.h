/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// The part of OpenSSL's <openssl/sha.h> that ReactCxxPlatform uses
// (react/devsupport/DevServerHelper.cpp: SHA256 of the device id), implemented
// with CommonCrypto on Apple (Sha256Shim.cpp) and in plain C++ elsewhere
// (Sha256Portable.cpp). The static host links this instead of libcrypto.a,
// which Homebrew only has for the build machine's architecture.

#pragma once

#include <cstddef>

#define SHA256_DIGEST_LENGTH 32

// Opaque storage, large enough for CC_SHA256_CTX and the plain C++ state
// (checked in Sha256Shim.cpp and Sha256Portable.cpp).
typedef struct SHA256state_st {
  unsigned int storage[32];
} SHA256_CTX;

int SHA256_Init(SHA256_CTX* c);
int SHA256_Update(SHA256_CTX* c, const void* data, size_t len);
int SHA256_Final(unsigned char* md, SHA256_CTX* c);
