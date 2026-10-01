/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// See openssl/sha.h in this directory. Windows: SHA-256 through CNG (BCrypt).

#include "openssl/sha.h"

#include <windows.h>

#include <bcrypt.h>

namespace {
struct BCryptSha256 {
  BCRYPT_ALG_HANDLE algorithm;
  BCRYPT_HASH_HANDLE hash;
};
} // namespace

static_assert(sizeof(SHA256_CTX) >= sizeof(BCryptSha256), "SHA256_CTX is too small for the BCrypt handles");

int SHA256_Init(SHA256_CTX* c) {
  auto* state = reinterpret_cast<BCryptSha256*>(c);
  state->algorithm = nullptr;
  state->hash = nullptr;
  if (!BCRYPT_SUCCESS(BCryptOpenAlgorithmProvider(&state->algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0))) {
    return 0;
  }
  if (!BCRYPT_SUCCESS(BCryptCreateHash(state->algorithm, &state->hash, nullptr, 0, nullptr, 0, 0))) {
    BCryptCloseAlgorithmProvider(state->algorithm, 0);
    return 0;
  }
  return 1;
}

int SHA256_Update(SHA256_CTX* c, const void* data, size_t len) {
  auto* state = reinterpret_cast<BCryptSha256*>(c);
  auto* bytes = static_cast<PUCHAR>(const_cast<void*>(data));
  while (len > 0) {
    ULONG chunk = len > 0x40000000 ? 0x40000000 : static_cast<ULONG>(len);
    if (!BCRYPT_SUCCESS(BCryptHashData(state->hash, bytes, chunk, 0))) {
      return 0;
    }
    bytes += chunk;
    len -= chunk;
  }
  return 1;
}

int SHA256_Final(unsigned char* md, SHA256_CTX* c) {
  auto* state = reinterpret_cast<BCryptSha256*>(c);
  bool ok = BCRYPT_SUCCESS(BCryptFinishHash(state->hash, md, SHA256_DIGEST_LENGTH, 0));
  BCryptDestroyHash(state->hash);
  BCryptCloseAlgorithmProvider(state->algorithm, 0);
  return ok ? 1 : 0;
}
