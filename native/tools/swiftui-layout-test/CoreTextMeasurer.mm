// TextMeasurer for macOS tests: the same text layout SwiftUI uses on macOS.
//
// Observed with swiftui-ref: SwiftUI's Text sizes on macOS equal
// ceil(NSAttributedString.boundingRect(with:options: .usesLineFragmentOrigin)) (not
// NSLayoutManager, not CTLine bounds), with the text style fonts from
// NSFont.preferredFont(forTextStyle:) and NSLineBreakStrategyStandard (a last line is never a
// single word when it can be avoided). Truncated lines match CTLineCreateTruncatedLine.

#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>

#include "CoreTextMeasurer.h"

#include <cmath>
#include <map>

namespace expoui::layout {

namespace {

NSFontTextStyle textStyle(const std::string& name) {
  static const std::map<std::string, NSFontTextStyle> styles = {
      {"largeTitle", NSFontTextStyleLargeTitle}, {"title", NSFontTextStyleTitle1},
      {"title2", NSFontTextStyleTitle2},         {"title3", NSFontTextStyleTitle3},
      {"headline", NSFontTextStyleHeadline},     {"subheadline", NSFontTextStyleSubheadline},
      {"body", NSFontTextStyleBody},             {"callout", NSFontTextStyleCallout},
      {"footnote", NSFontTextStyleFootnote},     {"caption", NSFontTextStyleCaption1},
      {"caption2", NSFontTextStyleCaption2},
  };
  auto it = styles.find(name);
  return it == styles.end() ? NSFontTextStyleBody : it->second;
}

NSFontWeight weight(const std::string& name) {
  static const std::map<std::string, NSFontWeight> weights = {
      {"ultraLight", NSFontWeightUltraLight}, {"thin", NSFontWeightThin},   {"light", NSFontWeightLight},
      {"regular", NSFontWeightRegular},       {"medium", NSFontWeightMedium}, {"semibold", NSFontWeightSemibold},
      {"bold", NSFontWeightBold},             {"heavy", NSFontWeightHeavy}, {"black", NSFontWeightBlack},
  };
  auto it = weights.find(name);
  return it == weights.end() ? NSFontWeightRegular : it->second;
}

NSFont* resolve(const FontSpec& spec, bool useTextStyles) {
  NSFont* font;
  if (useTextStyles && !spec.textStyle.empty()) {
    font = [NSFont preferredFontForTextStyle:textStyle(spec.textStyle) options:@{}];
    // A weight other than the style's own.
    std::string styleWeight = spec.textStyle == "headline" ? "bold" : spec.textStyle == "caption2" ? "medium" : "regular";
    if (!spec.weight.empty() && spec.weight != styleWeight) {
      NSFontDescriptor* d = [font.fontDescriptor fontDescriptorByAddingAttributes:@{
        NSFontTraitsAttribute : @{NSFontWeightTrait : @(weight(spec.weight))}
      }];
      font = [NSFont fontWithDescriptor:d size:font.pointSize] ?: font;
    }
  } else if (!spec.family.empty()) {
    font = [NSFont fontWithName:[NSString stringWithUTF8String:spec.family.c_str()] size:spec.pointSize]
        ?: [NSFont systemFontOfSize:spec.pointSize weight:weight(spec.weight)];
  } else {
    font = [NSFont systemFontOfSize:spec.pointSize weight:weight(spec.weight)];
  }
  if (!spec.design.empty() && spec.design != "default") {
    NSFontDescriptorSystemDesign design = spec.design == "rounded" ? NSFontDescriptorSystemDesignRounded
        : spec.design == "serif"                                  ? NSFontDescriptorSystemDesignSerif
                                                                  : NSFontDescriptorSystemDesignMonospaced;
    NSFontDescriptor* d = [font.fontDescriptor fontDescriptorWithDesign:design];
    if (d) {
      font = [NSFont fontWithDescriptor:d size:font.pointSize] ?: font;
    }
  }
  return font;
}

NSSize boundingSize(NSString* text, NSFont* font, double maxWidth) {
  // SwiftUI wraps with the standard line break strategy (no single-word last line: "push out").
  static NSParagraphStyle* paragraph = [] {
    NSMutableParagraphStyle* p = [NSMutableParagraphStyle new];
    p.lineBreakStrategy = NSLineBreakStrategyStandard;
    return p;
  }();
  NSAttributedString* a = [[NSAttributedString alloc]
      initWithString:text
          attributes:@{NSFontAttributeName : font, NSParagraphStyleAttributeName : paragraph}];
  // A width of exactly 0 means "unlimited" to NSStringDrawing; SwiftUI wraps every cluster.
  CGFloat w = std::isfinite(maxWidth) ? std::max(maxWidth, 0.001) : CGFLOAT_MAX;
  return [a boundingRectWithSize:NSMakeSize(w, CGFLOAT_MAX) options:NSStringDrawingUsesLineFragmentOrigin].size;
}

double truncatedWidth(NSString* text, NSFont* font, double maxWidth) {
  NSDictionary* attrs = @{NSFontAttributeName : font};
  NSAttributedString* a = [[NSAttributedString alloc] initWithString:text attributes:attrs];
  NSAttributedString* e = [[NSAttributedString alloc] initWithString:@"…" attributes:attrs];
  CTLineRef line = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)a);
  CTLineRef ellipsis = CTLineCreateWithAttributedString((__bridge CFAttributedStringRef)e);
  CTLineRef truncated = CTLineCreateTruncatedLine(line, maxWidth, kCTLineTruncationEnd, ellipsis);
  double width = truncated ? CTLineGetTypographicBounds(truncated, nullptr, nullptr, nullptr) : 0;
  if (truncated) CFRelease(truncated);
  CFRelease(ellipsis);
  CFRelease(line);
  return width;
}

/// Width of `text` laid out in at most `maxLines` lines, the last one truncated (TextKit 1).
double truncatedWidth(NSString* text, NSFont* font, double maxWidth, int maxLines) {
  NSMutableParagraphStyle* paragraph = [NSMutableParagraphStyle new];
  paragraph.lineBreakStrategy = NSLineBreakStrategyStandard;
  NSTextStorage* storage = [[NSTextStorage alloc]
      initWithString:text
          attributes:@{NSFontAttributeName : font, NSParagraphStyleAttributeName : paragraph}];
  NSLayoutManager* layout = [NSLayoutManager new];
  layout.usesFontLeading = NO;
  NSTextContainer* container = [[NSTextContainer alloc] initWithSize:NSMakeSize(maxWidth, CGFLOAT_MAX)];
  container.lineFragmentPadding = 0;
  container.maximumNumberOfLines = static_cast<NSUInteger>(maxLines);
  container.lineBreakMode = NSLineBreakByTruncatingTail;
  [layout addTextContainer:container];
  [storage addLayoutManager:layout];
  [layout ensureLayoutForTextContainer:container];
  __block double width = 0;
  NSRange glyphs = [layout glyphRangeForTextContainer:container];
  [layout enumerateLineFragmentsForGlyphRange:glyphs
                                   usingBlock:^(NSRect, NSRect used, NSTextContainer*, NSRange, BOOL*) {
                                     width = std::max(width, static_cast<double>(used.size.width));
                                   }];
  return width;
}

} // namespace

TextMeasurement CoreTextMeasurer::measureText(const std::string& text, const FontSpec& spec, double maxWidth, int maxLines) {
  @autoreleasepool {
    NSFont* font = resolve(spec, useTextStyles_);
    NSString* s = [NSString stringWithUTF8String:text.c_str()] ?: @"";
    NSSize full = boundingSize(s, font, maxWidth);
    double line = boundingSize(@"A", font, INFINITY).height;
    TextMeasurement m;
    m.width = full.width;
    m.firstBaseline = font.ascender;
    int lines = static_cast<int>(std::lround(full.height / line));
    m.lines = std::max(1, lines);
    m.height = full.height;
    if (maxLines > 0 && lines > maxLines) {
      double w = std::isfinite(maxWidth) ? maxWidth : CGFLOAT_MAX;
      m.width = maxLines == 1 ? truncatedWidth(s, font, w) : truncatedWidth(s, font, w, maxLines);
      m.lines = maxLines;
      m.height = line * maxLines;
    }
    return m;
  }
}

double CoreTextMeasurer::lineHeight(const FontSpec& spec) {
  @autoreleasepool {
    return std::ceil(boundingSize(@"A", resolve(spec, useTextStyles_), INFINITY).height);
  }
}

Size CoreTextMeasurer::measureSymbol(const std::string& name, const FontSpec& spec) {
  @autoreleasepool {
    NSFont* font = resolve(spec, useTextStyles_);
    NSImage* image = [NSImage imageWithSystemSymbolName:[NSString stringWithUTF8String:name.c_str()]
                               accessibilityDescription:nil];
    if (!image) {
      return {};
    }
    NSImageSymbolConfiguration* config =
        [NSImageSymbolConfiguration configurationWithPointSize:font.pointSize
                                                        weight:spec.weight.empty() ? NSFontWeightRegular : weight(spec.weight)
                                                         scale:NSImageSymbolScaleMedium];
    NSImage* configured = [image imageWithSymbolConfiguration:config];
    return {configured.size.width, configured.size.height};
  }
}

} // namespace expoui::layout
