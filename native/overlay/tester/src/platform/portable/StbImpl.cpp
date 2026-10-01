/*
 * The implementations of the vendored stb headers (third_party/stb), compiled
 * once for the portable text layout: stb_truetype for the font tables and the
 * zlib decoder of stb_image (no image formats) for the embedded gzip fonts.
 */

#define STB_TRUETYPE_IMPLEMENTATION
#define STBTT_STATIC
#include "stb_truetype.h"

#define STB_IMAGE_IMPLEMENTATION
#define STB_IMAGE_STATIC
#define STBI_NO_STDIO
#define STBI_NO_JPEG
#define STBI_NO_PNG
#define STBI_NO_BMP
#define STBI_NO_PSD
#define STBI_NO_TGA
#define STBI_NO_GIF
#define STBI_NO_HDR
#define STBI_NO_PIC
#define STBI_NO_PNM
#define STBI_NO_LINEAR
#define STBI_SUPPORT_ZLIB
#include "stb_image.h"

#include "PortableFonts.h"

#include <cstdlib>

namespace facebook::react::portabletext::detail {

// stb_truetype is compiled with STBTT_STATIC (internal linkage), so the parsing
// is wrapped here for PortableFonts.cpp.
struct StbFont {
  stbtt_fontinfo info;
};

StbFont *stbOpenFont(const unsigned char *data) {
  auto *font = new StbFont();
  if (stbtt_InitFont(&font->info, data, stbtt_GetFontOffsetForIndex(data, 0)) == 0) {
    delete font;
    return nullptr;
  }
  return font;
}

void stbCloseFont(StbFont *font) {
  delete font;
}

int stbUnitsPerEm(const StbFont *font) {
  // head.unitsPerEm (offset 18 of the head table).
  const stbtt_fontinfo &info = font->info;
  const unsigned char *p = info.data + info.head + 18;
  return (p[0] << 8) | p[1];
}

void stbVerticalMetrics(const StbFont *font, int *ascent, int *descent, int *lineGap) {
  stbtt_GetFontVMetrics(&font->info, ascent, descent, lineGap);
}

int stbGlyphIndex(const StbFont *font, char32_t codepoint) {
  return stbtt_FindGlyphIndex(&font->info, static_cast<int>(codepoint));
}

int stbGlyphAdvance(const StbFont *font, int glyph) {
  int advance = 0;
  int leftSideBearing = 0;
  stbtt_GetGlyphHMetrics(&font->info, glyph, &advance, &leftSideBearing);
  return advance;
}

int stbGlyphKerning(const StbFont *font, int glyph1, int glyph2) {
  return stbtt_GetGlyphKernAdvance(&font->info, glyph1, glyph2);
}

std::vector<uint8_t> inflateRaw(const unsigned char *data, std::size_t size, std::size_t expectedSize) {
  std::vector<uint8_t> out(expectedSize);
  int written = stbi_zlib_decode_noheader_buffer(
      reinterpret_cast<char *>(out.data()),
      static_cast<int>(out.size()),
      reinterpret_cast<const char *>(data),
      static_cast<int>(size));
  if (written < 0 || static_cast<std::size_t>(written) != expectedSize) {
    return {};
  }
  return out;
}

} // namespace facebook::react::portabletext::detail
