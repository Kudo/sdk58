/*
 * See FantomComposeText.h.
 *
 * Widths and line counts only; the Compose engine computes paragraph heights
 * from the line count and lineHeight() (ascent + descent). Observed with
 * compose-ref (Skia): the width is the advance sum with kerning, plus the
 * letter spacing after every glyph, which is what CoreText tracking does
 * (kCTKernAttributeName = 0 would turn the font's kerning off).
 */

#include "FantomComposeText.h"

#import <CoreText/CoreText.h>
#import <Foundation/Foundation.h>

#include <algorithm>
#include <cmath>
#include <map>
#include <mutex>
#include <vector>

#include "platform/macos/EmbeddedFonts.h"

namespace facebook::react {

namespace {

using expoui::compose::ResolvedTextStyle;

/// The embedded faces are Regular, Medium, Bold and Italic (native/fonts/roboto). Font matching
/// as in CSS: below 400 lighter first, else heavier first; italic has one weight.
std::string postScriptName(int weight, bool italic)
{
  if (italic) {
    return "Roboto-Italic";
  }
  if (weight <= 450) {
    return "Roboto-Regular";
  }
  if (weight <= 500) {
    return "Roboto-Medium";
  }
  return "Roboto-Bold";
}

CTFontRef font(const ResolvedTextStyle &style)
{
  static std::mutex mutex;
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
  std::lock_guard<std::mutex> lock(mutex);
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

CFAttributedStringRef attributed(const std::string &text, const ResolvedTextStyle &style)
{
  CFStringRef s = CFStringCreateWithCString(nullptr, text.c_str(), kCFStringEncodingUTF8);
  if (s == nullptr) {
    s = CFSTR("");
  }
  CGFloat tracking = style.letterSpacingPx;
  CFNumberRef trackingNumber = CFNumberCreate(nullptr, kCFNumberCGFloatType, &tracking);
  const void *keys[] = {kCTFontAttributeName, kCTTrackingAttributeName};
  const void *values[] = {font(style), trackingNumber};
  CFDictionaryRef attrs = CFDictionaryCreate(
      nullptr, keys, values, tracking != 0 ? 2 : 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFAttributedStringRef a = CFAttributedStringCreate(nullptr, s, attrs);
  CFRelease(attrs);
  CFRelease(trackingNumber);
  CFRelease(s);
  return a;
}

float lineWidth(const std::string &text, const ResolvedTextStyle &style)
{
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

std::vector<std::string> split(const std::string &text, char sep)
{
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

ResolvedTextStyle fromFontSpec(const expoui::layout::FontSpec &spec)
{
  static const std::map<std::string, int> weights = {
      {"thin", 100},
      {"ultraLight", 200},
      {"light", 300},
      {"regular", 400},
      {"medium", 500},
      {"semibold", 600},
      {"bold", 700},
      {"heavy", 800},
      {"black", 900},
  };
  ResolvedTextStyle style;
  style.fontSizePx = static_cast<float>(spec.pointSize);
  auto it = weights.find(spec.weight);
  style.fontWeight = it == weights.end() ? 400 : it->second;
  style.letterSpacingPx = static_cast<float>(spec.letterSpacing);
  style.italic = spec.italic;
  if (spec.design == "serif") {
    style.fontFamily = "serif";
  } else if (spec.design == "monospaced") {
    style.fontFamily = "monospace";
  } else if (spec.family == "cursive") {
    style.fontFamily = "cursive";
  }
  return style;
}

} // namespace

FantomComposeTextMeasurer::FantomComposeTextMeasurer() : hasRoboto_(registerEmbeddedFonts() > 0) {}

expoui::layout::TextMeasurement FantomComposeTextMeasurer::measureComposeText(
    const std::string &text,
    const ResolvedTextStyle &style,
    double maxWidth,
    int maxLines)
{
  int lines = 0;
  float widest = 0;
  for (const auto &paragraph : split(text, '\n')) {
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
  expoui::layout::TextMeasurement m;
  m.lines = std::max(lines, 1);
  m.width = widest;
  CTFontRef f = font(style);
  m.height = (CTFontGetAscent(f) + CTFontGetDescent(f)) * m.lines;
  m.firstBaseline = CTFontGetAscent(f);
  return m;
}

double FantomComposeTextMeasurer::composeFontHeight(const ResolvedTextStyle &style)
{
  CTFontRef f = font(style);
  return CTFontGetAscent(f) + CTFontGetDescent(f);
}

expoui::layout::TextMeasurement FantomComposeTextMeasurer::measureText(
    const std::string &text,
    const expoui::layout::FontSpec &spec,
    double maxWidth,
    int maxLines)
{
  return measureComposeText(text, fromFontSpec(spec), maxWidth, maxLines);
}

double FantomComposeTextMeasurer::lineHeight(const expoui::layout::FontSpec &spec)
{
  return composeFontHeight(fromFontSpec(spec));
}

expoui::layout::Size FantomComposeTextMeasurer::measureSymbol(const std::string &, const expoui::layout::FontSpec &)
{
  return {};
}

} // namespace facebook::react
