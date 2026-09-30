// See RobotoTextMeasurer.h.
//
// Widths and line counts only; the engine computes paragraph heights from the line count and
// composeFontHeight (ascent + descent). Observed with compose-ref: the width is the advance sum
// with kerning, plus letterSpacing after every glyph (CoreText tracking does the same).

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

ResolvedTextStyle fromFontSpec(const layout::FontSpec& spec) {
  static const std::map<std::string, int> weights = {
      {"thin", 100}, {"ultraLight", 200}, {"light", 300},  {"regular", 400}, {"medium", 500},
      {"semibold", 600}, {"bold", 700},   {"heavy", 800}, {"black", 900},
  };
  ResolvedTextStyle style;
  style.fontSizePx = static_cast<float>(spec.pointSize);
  auto it = weights.find(spec.weight);
  style.fontWeight = it == weights.end() ? 400 : it->second;
  if (spec.design == "serif") {
    style.fontFamily = "serif";
  } else if (spec.design == "monospaced") {
    style.fontFamily = "monospace";
  } else if (spec.family == "cursive") {
    style.fontFamily = "cursive";
  }
  return style;
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

layout::TextMeasurement RobotoTextMeasurer::measureComposeText(const std::string& text, const ResolvedTextStyle& style,
                                                               double maxWidth, int maxLines) {
  layout::TextMeasurement m;
  int lines = 0;
  float widest = 0;
  for (const auto& paragraph : split(text, '\n')) {
    if (paragraph.empty() || std::isinf(maxWidth)) {
      widest = std::max(widest, lineWidth(paragraph, style));
      lines++;
      continue;
    }
    CFAttributedStringRef a = attributed(paragraph, style);
    CTTypesetterRef ts = CTTypesetterCreateWithAttributedString(a);
    CFIndex length = CFAttributedStringGetLength(a);
    CFIndex start = 0;
    while (start < length) {
      CFIndex count = CTTypesetterSuggestLineBreak(ts, start, maxWidth);
      if (count <= 0) {
        count = 1;
      }
      CTLineRef line = CTTypesetterCreateLine(ts, CFRangeMake(start, count));
      double w = CTLineGetTypographicBounds(line, nullptr, nullptr, nullptr) - CTLineGetTrailingWhitespaceWidth(line);
      CFRelease(line);
      widest = std::max(widest, static_cast<float>(w));
      start += count;
      lines++;
    }
    CFRelease(ts);
    CFRelease(a);
  }
  if (maxLines > 0) {
    lines = std::min(lines, maxLines);
  }
  m.lines = std::max(lines, 1);
  m.width = widest;
  CTFontRef f = font(style);
  m.height = (CTFontGetAscent(f) + CTFontGetDescent(f)) * m.lines;
  m.firstBaseline = CTFontGetAscent(f);
  return m;
}

double RobotoTextMeasurer::composeFontHeight(const ResolvedTextStyle& style) {
  CTFontRef f = font(style);
  return CTFontGetAscent(f) + CTFontGetDescent(f);
}

layout::TextMeasurement RobotoTextMeasurer::measureText(const std::string& text, const layout::FontSpec& spec,
                                                        double maxWidth, int maxLines) {
  return measureComposeText(text, fromFontSpec(spec), maxWidth, maxLines);
}

double RobotoTextMeasurer::lineHeight(const layout::FontSpec& spec) {
  return composeFontHeight(fromFontSpec(spec));
}

layout::Size RobotoTextMeasurer::measureSymbol(const std::string&, const layout::FontSpec&) {
  return {};
}

}  // namespace expoui::compose
