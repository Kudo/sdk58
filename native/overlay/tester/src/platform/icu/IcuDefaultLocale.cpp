/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Off Apple, Hermes compares strings and formats dates with ICU
// (PlatformUnicodeICU.cpp: ucol_open / udat_open with uloc_getDefault()).
// ICU takes its default locale from LC_ALL / LC_MESSAGES / LANG, so the
// output would depend on the machine, and the host's ICU data has only root
// and en (scripts/icu-data-filter.json): LANG=de_DE.UTF-8 would give root
// formats ("1970 M01 1"). The default locale is set to en_US before main()
// and before any Hermes runtime exists. en_US formats like en_US_POSIX and
// the Mac host for toLocaleDateString / toLocaleTimeString.

#if !defined(__APPLE__)

#include <unicode/uloc.h>

namespace {

[[maybe_unused]] const bool kDefaultLocaleSet = [] {
  UErrorCode error = U_ZERO_ERROR;
  uloc_setDefault(FANTOM_ICU_DEFAULT_LOCALE, &error);
  return U_SUCCESS(error);
}();

} // namespace

#endif
