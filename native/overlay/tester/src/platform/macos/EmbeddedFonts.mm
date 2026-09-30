/*
 * See EmbeddedFonts.h. The byte arrays come from a source that the build
 * generates with cmake/embed-files.cmake (gzip streams, see native/fonts/roboto).
 */

#include "EmbeddedFonts.h"

#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>
#include <compression.h>

#include <cstddef>
#include <cstdint>
#include <mutex>
#include <vector>

extern const unsigned char fantom_roboto_regular[];
extern const std::size_t fantom_roboto_regular_size;
extern const unsigned char fantom_roboto_medium[];
extern const std::size_t fantom_roboto_medium_size;
extern const unsigned char fantom_roboto_bold[];
extern const std::size_t fantom_roboto_bold_size;
extern const unsigned char fantom_roboto_italic[];
extern const std::size_t fantom_roboto_italic_size;

namespace facebook::react {

namespace {

/// Inflates a gzip stream (RFC 1952) with libcompression's raw deflate decoder.
std::vector<uint8_t> gunzip(const unsigned char *data, std::size_t size)
{
  if (size < 18 || data[0] != 0x1f || data[1] != 0x8b || data[2] != 8) {
    return {};
  }
  uint8_t flags = data[3];
  std::size_t offset = 10;
  if (flags & 0x04) { // FEXTRA
    if (offset + 2 > size) return {};
    offset += 2 + (data[offset] | (data[offset + 1] << 8));
  }
  for (uint8_t bit : {uint8_t{0x08}, uint8_t{0x10}}) { // FNAME, FCOMMENT
    if (flags & bit) {
      while (offset < size && data[offset] != 0) offset++;
      offset++;
    }
  }
  if (flags & 0x02) { // FHCRC
    offset += 2;
  }
  if (offset + 8 > size) {
    return {};
  }
  const unsigned char *trailer = data + size - 4;
  std::size_t inflatedSize = trailer[0] | (trailer[1] << 8) | (trailer[2] << 16) | (std::size_t(trailer[3]) << 24);
  std::vector<uint8_t> out(inflatedSize);
  std::size_t written =
      compression_decode_buffer(out.data(), out.size(), data + offset, size - offset - 8, nullptr, COMPRESSION_ZLIB);
  if (written != inflatedSize) {
    return {};
  }
  return out;
}

bool registerFont(const unsigned char *data, std::size_t size)
{
  std::vector<uint8_t> bytes = gunzip(data, size);
  if (bytes.empty()) {
    return false;
  }
  CFDataRef cfData = CFDataCreate(nullptr, bytes.data(), static_cast<CFIndex>(bytes.size()));
  CGDataProviderRef provider = CGDataProviderCreateWithCFData(cfData);
  CGFontRef font = CGFontCreateWithDataProvider(provider);
  bool ok = false;
  if (font != nullptr) {
    CFErrorRef error = nullptr;
    // CTFontManagerRegisterGraphicsFont is deprecated, but it is the synchronous way to register
    // in-memory font data so that family lookups (NSFontManager, CTFontDescriptor) find it; the
    // replacements need a file URL or register asynchronously.
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    ok = CTFontManagerRegisterGraphicsFont(font, &error);
#pragma clang diagnostic pop
    if (error != nullptr) {
      CFRelease(error);
    }
    CGFontRelease(font);
  }
  CGDataProviderRelease(provider);
  CFRelease(cfData);
  return ok;
}

} // namespace

int registerEmbeddedFonts()
{
  static std::once_flag once;
  static int registered = 0;
  std::call_once(once, [] {
    struct Blob {
      const unsigned char *data;
      std::size_t size;
    };
    const Blob blobs[] = {
        {fantom_roboto_regular, fantom_roboto_regular_size},
        {fantom_roboto_medium, fantom_roboto_medium_size},
        {fantom_roboto_bold, fantom_roboto_bold_size},
        {fantom_roboto_italic, fantom_roboto_italic_size},
    };
    for (const auto &blob : blobs) {
      if (registerFont(blob.data, blob.size)) {
        registered++;
      }
    }
  });
  return registered;
}

} // namespace facebook::react
