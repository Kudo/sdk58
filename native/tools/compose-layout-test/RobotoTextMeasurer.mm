// See RobotoTextMeasurer.h.
//
// Observed with compose-ref (Skia paragraphs, Roboto 2.138):
// - one line without a lineHeight is round(ascent + descent) px high, and each extra line adds the
//   same rounded amount (14 sp at density 1: 16.4 -> 16; 2 lines 32);
// - with a lineHeight, each line is the lineHeight; with LineHeightStyle.Trim.Both (the
//   TextStyle.Default) the first line's extra top and the last line's extra bottom are removed:
//   (lines - 1) * lineHeight + ascent + descent, not rounded (30 sp over 2 lines at 14 sp: 46.4);
// - the width is the advance sum with kerning, plus letterSpacing after every glyph.

#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>

#include "RobotoTextMeasurer.h"

#include <algorithm>
#include <cmath>
#include <map>
#include <vector>

namespace expoui::compose {

namespace {

std::string postScriptName(int weight, bool italic) {
  // Font matching over the Roboto faces (CSS order: lighter first below 400, heavier above 500).
  const char* face = weight <= 200   ? "Thin"
                     : weight <= 300 ? "Light"
                     : weight <= 400 ? "Regular"
                     : weight <= 500 ? "Medium"
                     : weight <= 700 ? "Bold"
                                     : "Black";
  std::string name = std::string("Roboto-") + face;
  if (italic) {
    name = std::string(face) == "Regular" ? "Roboto-Italic" : name + "Italic";
  }
  return name;
}

CTFontRef font(const ResolvedTextStyle& style) {
  static std::map<std::pair<std::string, float>, CTFontRef> cache;
  std::string name;
  if (style.fontFamily == "serif") {
    name = "Times-Roman";
  } else if (style.fontFamily == "monospace") {
    name = "Menlo-Regular";
  } else if (style.fontFamily == "cursive") {
    name = "SnellRoundhand";
  } else {
    name = postScriptName(style.fontWeight, style.italic);
  }
  auto key = std::make_pair(name, style.fontSizePx);
  auto it = cache.find(key);
  if (it != cache.end()) {
    return it->second;
  }
  CFStringRef cfName = CFStringCreateWithCString(nullptr, name.c_str(), kCFStringEncodingUTF8);
  CTFontRef f = CTFontCreateWithName(cfName, style.fontSizePx, nullptr);
  CFRelease(cfName);
  cache[key] = f;
  return f;
}

CFAttributedStringRef attributed(const std::string& text, const ResolvedTextStyle& style) {
  CFStringRef s = CFStringCreateWithCString(nullptr, text.c_str(), kCFStringEncodingUTF8);
  if (!s) {
    s = CFSTR("");
  }
  // Letter spacing as tracking: kCTKernAttributeName = 0 would turn the font's kerning off.
  CGFloat tracking = style.letterSpacingPx;
  CFNumberRef trackingNumber = CFNumberCreate(nullptr, kCFNumberCGFloatType, &tracking);
  const void* keys[] = {kCTFontAttributeName, kCTTrackingAttributeName};
  const void* values[] = {font(style), trackingNumber};
  CFDictionaryRef attrs = CFDictionaryCreate(nullptr, keys, values, tracking != 0 ? 2 : 1,
                                             &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFAttributedStringRef a = CFAttributedStringCreate(nullptr, s, attrs);
  CFRelease(attrs);
  CFRelease(trackingNumber);
  CFRelease(s);
  return a;
}

float lineWidth(const std::string& text, const ResolvedTextStyle& style) {
  if (text.empty()) {
    return 0;
  }
  CFAttributedStringRef a = attributed(text, style);
  CTLineRef line = CTLineCreateWithAttributedString(a);
  double w = CTLineGetTypographicBounds(line, nullptr, nullptr, nullptr);
  CFRelease(line);
  CFRelease(a);
  return static_cast<float>(w);
}

std::vector<std::string> split(const std::string& text, char sep) {
  std::vector<std::string> out;
  size_t start = 0;
  while (true) {
    size_t end = text.find(sep, start);
    out.push_back(text.substr(start, end == std::string::npos ? std::string::npos : end - start));
    if (end == std::string::npos) {
      return out;
    }
    start = end + 1;
  }
}

float lineHeight(const ResolvedTextStyle& style) {
  if (!std::isnan(style.lineHeightPx)) {
    return std::round(style.lineHeightPx);
  }
  CTFontRef f = font(style);
  return std::round(static_cast<float>(CTFontGetAscent(f) + CTFontGetDescent(f)));
}

}  // namespace

bool RobotoTextMeasurer::registerFonts(const std::string& fontsDir) {
  NSString* dir = [NSString stringWithUTF8String:fontsDir.c_str()];
  NSArray<NSString*>* files = [[NSFileManager defaultManager] contentsOfDirectoryAtPath:dir error:nil];
  int count = 0;
  for (NSString* file in files) {
    if (![file hasPrefix:@"Roboto-"] || ![file hasSuffix:@".ttf"]) {
      continue;
    }
    NSURL* url = [NSURL fileURLWithPath:[dir stringByAppendingPathComponent:file]];
    CFErrorRef error = nullptr;
    if (CTFontManagerRegisterFontsForURL((__bridge CFURLRef)url, kCTFontManagerScopeProcess, &error)) {
      count++;
    } else if (error) {
      // Already registered is fine.
      CFRelease(error);
      count++;
    }
  }
  return count > 0;
}

float RobotoTextMeasurer::maxIntrinsicWidth(const std::string& text, const ResolvedTextStyle& style) {
  float w = 0;
  for (const auto& line : split(text, '\n')) {
    w = std::max(w, lineWidth(line, style));
  }
  return w;
}

float RobotoTextMeasurer::minIntrinsicWidth(const std::string& text, const ResolvedTextStyle& style) {
  float w = 0;
  for (const auto& line : split(text, '\n')) {
    for (const auto& word : split(line, ' ')) {
      w = std::max(w, lineWidth(word, style));
    }
  }
  return w;
}

TextLayoutResult RobotoTextMeasurer::layout(const std::string& text, const ResolvedTextStyle& style, float width,
                                            int maxLines) {
  int lines = 0;
  for (const auto& paragraph : split(text, '\n')) {
    if (paragraph.empty() || std::isinf(width)) {
      lines++;
      continue;
    }
    CFAttributedStringRef a = attributed(paragraph, style);
    CTTypesetterRef ts = CTTypesetterCreateWithAttributedString(a);
    CFIndex length = CFAttributedStringGetLength(a);
    CFIndex start = 0;
    while (start < length) {
      CFIndex count = CTTypesetterSuggestLineBreak(ts, start, width);
      if (count <= 0) {
        count = 1;
      }
      start += count;
      lines++;
    }
    CFRelease(ts);
    CFRelease(a);
  }
  lines = std::min(std::max(lines, 1), std::max(maxLines, 1));
  TextLayoutResult r;
  r.lineCount = lines;
  if (!std::isnan(style.lineHeightPx) && style.trimLineHeight) {
    CTFontRef f = font(style);
    float fontHeight = static_cast<float>(CTFontGetAscent(f) + CTFontGetDescent(f));
    r.height = style.lineHeightPx * static_cast<float>(lines - 1) + fontHeight;
  } else {
    r.height = lineHeight(style) * static_cast<float>(lines);
  }
  return r;
}

}  // namespace expoui::compose
