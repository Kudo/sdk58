/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// See openssl/sha.h in this directory.

#include "openssl/sha.h"

#include <CommonCrypto/CommonDigest.h>

static_assert(sizeof(SHA256_CTX) >= sizeof(CC_SHA256_CTX), "SHA256_CTX is too small for CC_SHA256_CTX");
static_assert(SHA256_DIGEST_LENGTH == CC_SHA256_DIGEST_LENGTH, "SHA-256 digest length");

int SHA256_Init(SHA256_CTX* c) {
  return CC_SHA256_Init(reinterpret_cast<CC_SHA256_CTX*>(c));
}

int SHA256_Update(SHA256_CTX* c, const void* data, size_t len) {
  return CC_SHA256_Update(reinterpret_cast<CC_SHA256_CTX*>(c), data, static_cast<CC_LONG>(len));
}

int SHA256_Final(unsigned char* md, SHA256_CTX* c) {
  return CC_SHA256_Final(md, reinterpret_cast<CC_SHA256_CTX*>(c));
}
