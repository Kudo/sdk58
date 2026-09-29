/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// macOS (AppKit / TextKit 1) implementation of the cross-platform
// `TextLayoutManager` facade, used by the Fantom tester instead of the stub in
// ReactCommon/react/renderer/textlayoutmanager/platform/cxx. It mirrors the
// iOS implementation (RCTTextLayoutManager.mm, RCTAttributedTextUtils.mm and
// RCTFontUtils.mm) for everything that affects measurement.

#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>

#include <react/debug/react_native_assert.h>
#include <react/featureflags/ReactNativeFeatureFlags.h>
#include <react/renderer/attributedstring/PlaceholderAttributedString.h>
#include <react/renderer/telemetry/TransactionTelemetry.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/textlayoutmanager/TextMeasurementRounding.h>

#include <algorithm>
#include <array>
#include <cmath>
#include <mutex>

using namespace facebook::react;

// Inline views (attachments) are laid out with the size of their shadow view.
@interface RCTFantomTextAttachmentCell : NSTextAttachmentCell
@property (nonatomic, assign) NSRect attachmentBounds;
@end

@implementation RCTFantomTextAttachmentCell

- (NSSize)cellSize
{
  return self.attachmentBounds.size;
}

- (NSPoint)cellBaselineOffset
{
  return self.attachmentBounds.origin;
}

- (NSRect)cellFrameForTextContainer:(NSTextContainer *)textContainer
               proposedLineFragment:(NSRect)lineFrag
                      glyphPosition:(NSPoint)position
                     characterIndex:(NSUInteger)charIndex
{
  return self.attachmentBounds;
}

@end

namespace {

#pragma mark - Fonts (port of RCTFontUtils.mm)

enum class FontStyleResolved { Normal, Italic };

struct FontProperties {
  NSString *family = nil;
  CGFloat size = NAN;
  NSFontWeight weight = NAN;
  std::optional<FontStyleResolved> style;
  std::optional<int> variant;
  NSDictionary<NSNumber *, NSNumber *> *variations = nil;
  CGFloat sizeMultiplier = 1.0;
};

NSString *systemFontFamily()
{
  static NSString *family = [NSFont systemFontOfSize:14].familyName;
  return family;
}

NSFontWeight fontWeightFromInteger(int fontWeight)
{
  static auto weights = std::to_array<NSFontWeight>(
      {/* ~100 */ NSFontWeightUltraLight,
       /* ~200 */ NSFontWeightThin,
       /* ~300 */ NSFontWeightLight,
       /* ~400 */ NSFontWeightRegular,
       /* ~500 */ NSFontWeightMedium,
       /* ~600 */ NSFontWeightSemibold,
       /* ~700 */ NSFontWeightBold,
       /* ~800 */ NSFontWeightHeavy,
       /* ~900 */ NSFontWeightBlack});
  // Converts something like 760 or 830 to 7.
  auto index = std::clamp((fontWeight + 50) / 100 - 1, 0, 8);
  return weights[index];
}

NSFontWeight fontWeightOfFont(NSFont *font)
{
  NSDictionary *traits = [font.fontDescriptor objectForKey:NSFontTraitsAttribute];
  NSNumber *weight = traits[NSFontWeightTrait];
  return weight != nil ? (NSFontWeight)weight.doubleValue : NSFontWeightRegular;
}

FontStyleResolved fontStyleOfFont(NSFont *font)
{
  return (font.fontDescriptor.symbolicTraits & NSFontDescriptorTraitItalic) != 0u ? FontStyleResolved::Italic
                                                                                 : FontStyleResolved::Normal;
}

NSArray<NSDictionary *> *fontFeatures(int variant)
{
  NSMutableArray<NSDictionary *> *features = [NSMutableArray array];
  auto add = [&](int type, int selector) {
    [features addObject:@{NSFontFeatureTypeIdentifierKey : @(type), NSFontFeatureSelectorIdentifierKey : @(selector)}];
  };
  if ((variant & static_cast<int>(FontVariant::SmallCaps)) != 0) {
    add(kLowerCaseType, kLowerCaseSmallCapsSelector);
  }
  if ((variant & static_cast<int>(FontVariant::OldstyleNums)) != 0) {
    add(kNumberCaseType, kLowerCaseNumbersSelector);
  }
  if ((variant & static_cast<int>(FontVariant::LiningNums)) != 0) {
    add(kNumberCaseType, kUpperCaseNumbersSelector);
  }
  if ((variant & static_cast<int>(FontVariant::TabularNums)) != 0) {
    add(kNumberSpacingType, kMonospacedNumbersSelector);
  }
  if ((variant & static_cast<int>(FontVariant::ProportionalNums)) != 0) {
    add(kNumberSpacingType, kProportionalNumbersSelector);
  }
  // StylisticOne (1 << 6) ... StylisticTwenty (1 << 25). The "on" selector of
  // stylistic alternative N is 2 * N (kStylisticAltOneOnSelector == 2).
  for (int n = 1; n <= 20; n++) {
    if ((variant & (1 << (5 + n))) != 0) {
      add(kStylisticAlternativesType, 2 * n);
    }
  }
  return features;
}

NSDictionary<NSNumber *, NSNumber *> *parseFontVariationSettings(NSString *variationSettings)
{
  NSString *trimmed = [variationSettings stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
  if (trimmed.length == 0 || [trimmed isEqualToString:@"normal"]) {
    return @{};
  }

  static NSRegularExpression *expression = [NSRegularExpression
      regularExpressionWithPattern:@R"(\s*(['"])([ -~]{4})\1\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*(,|$))"
                           options:0
                             error:nil];

  NSMutableDictionary<NSNumber *, NSNumber *> *variations = [NSMutableDictionary dictionary];
  NSUInteger location = 0;
  while (location < variationSettings.length) {
    NSTextCheckingResult *match =
        [expression firstMatchInString:variationSettings
                               options:NSMatchingAnchored
                                 range:NSMakeRange(location, variationSettings.length - location)];
    if (match == nil || match.range.location != location) {
      return @{};
    }
    NSString *axis = [variationSettings substringWithRange:[match rangeAtIndex:2]];
    uint32_t axisIdentifier = (uint32_t)[axis characterAtIndex:0] << 24 | (uint32_t)[axis characterAtIndex:1] << 16 |
        (uint32_t)[axis characterAtIndex:2] << 8 | (uint32_t)[axis characterAtIndex:3];
    double value = [variationSettings substringWithRange:[match rangeAtIndex:3]].doubleValue;
    if (!std::isfinite(value)) {
      return @{};
    }
    variations[@(axisIdentifier)] = @(value);
    location = NSMaxRange(match.range);
  }
  return variations;
}

NSFont *orFallback(NSFont *font, NSFont *fallback)
{
  return font != nil ? font : fallback;
}

NSFont *withTraits(NSFont *font, NSFontDescriptorSymbolicTraits traits, CGFloat size)
{
  NSFontDescriptor *descriptor =
      [font.fontDescriptor fontDescriptorWithSymbolicTraits:font.fontDescriptor.symbolicTraits | traits];
  NSFont *result = [NSFont fontWithDescriptor:descriptor size:size];
  return result != nil ? result : font;
}

NSFont *defaultFontWithProperties(const FontProperties &properties, CGFloat effectiveSize)
{
  static NSCache *cache = [NSCache new];
  static std::mutex cacheMutex;

  bool isItalic = properties.style == FontStyleResolved::Italic;
  bool isCondensed = [properties.family isEqualToString:@"SystemCondensed"];
  NSString *key = [NSString
      stringWithFormat:@"%.1f/%.2f/%d/%d", effectiveSize, properties.weight, (int)isItalic, (int)isCondensed];

  {
    std::lock_guard<std::mutex> lock(cacheMutex);
    NSFont *cached = [cache objectForKey:key];
    if (cached != nil) {
      return cached;
    }
  }

  NSFont *font = [NSFont systemFontOfSize:effectiveSize weight:properties.weight];
  NSFontDescriptorSymbolicTraits traits = 0;
  if (isItalic) {
    traits |= NSFontDescriptorTraitItalic;
  }
  if (isCondensed) {
    traits |= NSFontDescriptorTraitCondensed;
  }
  if (traits != 0) {
    font = withTraits(font, traits, effectiveSize);
  }

  {
    std::lock_guard<std::mutex> lock(cacheMutex);
    [cache setObject:font forKey:key];
  }
  return font;
}

NSFontDescriptorSystemDesign systemDesignForFamily(NSString *family)
{
  static NSDictionary<NSString *, NSFontDescriptorSystemDesign> *designs = @{
    @"system-ui" : NSFontDescriptorSystemDesignDefault,
    @"ui-sans-serif" : NSFontDescriptorSystemDesignDefault,
    @"ui-serif" : NSFontDescriptorSystemDesignSerif,
    @"ui-rounded" : NSFontDescriptorSystemDesignRounded,
    @"ui-monospace" : NSFontDescriptorSystemDesignMonospaced,
  };
  return designs[family];
}

NSFont *fontWithProperties(FontProperties properties)
{
  // Defaults match RCTDefaultFontProperties() on iOS.
  if (properties.family.length == 0) {
    properties.family = systemFontFamily();
  }
  if (std::isnan(properties.size)) {
    properties.size = 14;
  }
  if (std::isnan(properties.weight)) {
    properties.weight = NSFontWeightRegular;
  }
  if (!properties.style.has_value()) {
    properties.style = FontStyleResolved::Normal;
  }
  if (!properties.variant.has_value()) {
    properties.variant = static_cast<int>(FontVariant::Default);
  }

  CGFloat effectiveSize = properties.sizeMultiplier * properties.size;
  NSFont *font = nil;
  NSFontDescriptorSystemDesign design = systemDesignForFamily(properties.family.lowercaseString);

  if (design != nil) {
    font = defaultFontWithProperties(properties, effectiveSize);
    NSFontDescriptor *descriptor = [font.fontDescriptor fontDescriptorWithDesign:design];
    if (descriptor != nil) {
      font = orFallback([NSFont fontWithDescriptor:descriptor size:effectiveSize], font);
    }
  } else if (
      [properties.family isEqualToString:systemFontFamily()] ||
      [properties.family isEqualToString:@"System"] || [properties.family isEqualToString:@"SystemCondensed"]) {
    font = defaultFontWithProperties(properties, effectiveSize);
  } else {
    NSFontManager *fontManager = NSFontManager.sharedFontManager;
    // Each member is [PostScript name, style name, weight, traits].
    NSArray<NSArray *> *members = [fontManager availableMembersOfFontFamily:properties.family];
    NSFontWeight fontWeight = properties.weight;

    if (members.count == 0) {
      // Gracefully handle being given a font name rather than a family name.
      font = [NSFont fontWithName:properties.family size:effectiveSize];
      if (font != nil) {
        members = [fontManager availableMembersOfFontFamily:font.familyName];
      } else {
        font = defaultFontWithProperties(properties, effectiveSize);
      }
    }

    if (members.count > 0) {
      NSFont *bestMatch = nil;
      CGFloat closestWeight = INFINITY;
      for (NSArray *member in members) {
        NSFont *candidate = [NSFont fontWithName:member[0] size:effectiveSize];
        if (candidate == nil || fontStyleOfFont(candidate) != properties.style) {
          continue;
        }
        CGFloat testWeight = fontWeightOfFont(candidate);
        if (std::abs(testWeight - fontWeight) < std::abs(closestWeight - fontWeight)) {
          bestMatch = candidate;
          closestWeight = testWeight;
        }
      }
      if (bestMatch != nil) {
        font = bestMatch;
      } else if (font == nil) {
        // Support single-font families like Zapfino.
        font = [NSFont fontWithName:members[0][0] size:effectiveSize];
      }
    }
  }

  if (font == nil) {
    font = defaultFontWithProperties(properties, effectiveSize);
  }

  if (*properties.variant != static_cast<int>(FontVariant::Default)) {
    NSFontDescriptor *descriptor = [font.fontDescriptor
        fontDescriptorByAddingAttributes:@{NSFontFeatureSettingsAttribute : fontFeatures(*properties.variant)}];
    font = orFallback([NSFont fontWithDescriptor:descriptor size:effectiveSize], font);
  }

  if (properties.variations.count > 0) {
    NSFontDescriptor *descriptor = [font.fontDescriptor
        fontDescriptorByAddingAttributes:@{(NSFontDescriptorAttributeName)kCTFontVariationAttribute :
                                               properties.variations}];
    font = orFallback([NSFont fontWithDescriptor:descriptor size:effectiveSize], font);
  }

  return font;
}

#pragma mark - Attributed strings (port of RCTAttributedTextUtils.mm)

CGFloat effectiveFontSizeMultiplier(const TextAttributes &textAttributes)
{
  if (!textAttributes.allowFontScaling.value_or(true)) {
    return 1.0;
  }
  // There is no Dynamic Type on macOS; the content size category is always
  // the default one, so `dynamicTypeRamp` does not scale the font.
  CGFloat fontSizeMultiplier =
      !std::isnan(textAttributes.fontSizeMultiplier) ? textAttributes.fontSizeMultiplier : 1.0;
  CGFloat maxFontSizeMultiplier =
      !std::isnan(textAttributes.maxFontSizeMultiplier) ? textAttributes.maxFontSizeMultiplier : 0.0;
  return maxFontSizeMultiplier >= 1.0 ? std::fmin(maxFontSizeMultiplier, fontSizeMultiplier) : fontSizeMultiplier;
}

NSFont *effectiveFont(const TextAttributes &textAttributes)
{
  FontProperties properties;
  properties.family = [NSString stringWithUTF8String:textAttributes.fontFamily.c_str()];
  properties.size = textAttributes.fontSize;
  if (textAttributes.fontStyle.has_value()) {
    properties.style = textAttributes.fontStyle.value() == FontStyle::Normal ? FontStyleResolved::Normal
                                                                             : FontStyleResolved::Italic;
  }
  if (textAttributes.fontVariant.has_value()) {
    properties.variant = static_cast<int>(textAttributes.fontVariant.value());
  }
  if (textAttributes.fontWeight.has_value()) {
    properties.weight = fontWeightFromInteger(static_cast<int>(textAttributes.fontWeight.value()));
  }
  if (textAttributes.fontVariationSettings.has_value()) {
    properties.variations =
        parseFontVariationSettings([NSString stringWithUTF8String:textAttributes.fontVariationSettings->c_str()]);
  }
  properties.sizeMultiplier = effectiveFontSizeMultiplier(textAttributes);
  return fontWithProperties(properties);
}

TextAlignment resolveTextAlignment(TextAlignment textAlignment, bool isRTL)
{
  switch (textAlignment) {
    case TextAlignment::Natural:
    case TextAlignment::Start:
      return isRTL ? TextAlignment::Right : TextAlignment::Left;
    case TextAlignment::End:
      return isRTL ? TextAlignment::Left : TextAlignment::Right;
    case TextAlignment::Right:
      return isRTL ? TextAlignment::Left : TextAlignment::Right;
    case TextAlignment::Left:
      return isRTL ? TextAlignment::Right : TextAlignment::Left;
    default:
      return textAlignment;
  }
}

NSTextAlignment nsTextAlignment(TextAlignment textAlignment)
{
  switch (textAlignment) {
    case TextAlignment::Natural:
      return NSTextAlignmentNatural;
    case TextAlignment::Left:
    case TextAlignment::Start:
      return NSTextAlignmentLeft;
    case TextAlignment::Right:
    case TextAlignment::End:
      return NSTextAlignmentRight;
    case TextAlignment::Center:
      return NSTextAlignmentCenter;
    case TextAlignment::Justified:
      return NSTextAlignmentJustified;
  }
}

NSWritingDirection nsWritingDirection(WritingDirection writingDirection)
{
  switch (writingDirection) {
    case WritingDirection::Natural:
      return NSWritingDirectionNatural;
    case WritingDirection::LeftToRight:
      return NSWritingDirectionLeftToRight;
    case WritingDirection::RightToLeft:
      return NSWritingDirectionRightToLeft;
  }
}

NSLineBreakStrategy nsLineBreakStrategy(LineBreakStrategy lineBreakStrategy)
{
  switch (lineBreakStrategy) {
    case LineBreakStrategy::None:
      return NSLineBreakStrategyNone;
    case LineBreakStrategy::PushOut:
      return NSLineBreakStrategyPushOut;
    case LineBreakStrategy::HangulWordPriority:
      return NSLineBreakStrategyHangulWordPriority;
    case LineBreakStrategy::Standard:
      return NSLineBreakStrategyStandard;
  }
}

NSLineBreakMode nsLineBreakMode(LineBreakMode lineBreakMode)
{
  switch (lineBreakMode) {
    case LineBreakMode::Word:
      return NSLineBreakByWordWrapping;
    case LineBreakMode::Char:
      return NSLineBreakByCharWrapping;
    case LineBreakMode::Clip:
      return NSLineBreakByClipping;
    case LineBreakMode::Head:
      return NSLineBreakByTruncatingHead;
    case LineBreakMode::Middle:
      return NSLineBreakByTruncatingMiddle;
    case LineBreakMode::Tail:
      return NSLineBreakByTruncatingTail;
  }
}

NSLineBreakMode nsLineBreakModeFromEllipsizeMode(EllipsizeMode ellipsizeMode)
{
  switch (ellipsizeMode) {
    case EllipsizeMode::Clip:
      return NSLineBreakByClipping;
    case EllipsizeMode::Head:
      return NSLineBreakByTruncatingHead;
    case EllipsizeMode::Tail:
      return NSLineBreakByTruncatingTail;
    case EllipsizeMode::Middle:
      return NSLineBreakByTruncatingMiddle;
  }
}

NSDictionary<NSAttributedStringKey, id> *nsTextAttributes(const TextAttributes &textAttributes)
{
  NSMutableDictionary<NSAttributedStringKey, id> *attributes = [NSMutableDictionary dictionaryWithCapacity:4];

  NSFont *font = effectiveFont(textAttributes);
  if (font != nil) {
    attributes[NSFontAttributeName] = font;
  }

  if (!std::isnan(textAttributes.letterSpacing)) {
    attributes[NSKernAttributeName] = @(textAttributes.letterSpacing);
  }

  NSMutableParagraphStyle *paragraphStyle = [NSMutableParagraphStyle new];
  BOOL isParagraphStyleUsed = NO;
  const bool isRTL = textAttributes.layoutDirection == LayoutDirection::RightToLeft;
  if (textAttributes.alignment.has_value() || isRTL) {
    paragraphStyle.alignment =
        nsTextAlignment(resolveTextAlignment(textAttributes.alignment.value_or(TextAlignment::Natural), isRTL));
    isParagraphStyleUsed = YES;
  }
  if (textAttributes.baseWritingDirection.has_value()) {
    paragraphStyle.baseWritingDirection = nsWritingDirection(textAttributes.baseWritingDirection.value());
    isParagraphStyleUsed = YES;
  }
  if (textAttributes.lineBreakStrategy.has_value()) {
    paragraphStyle.lineBreakStrategy = nsLineBreakStrategy(textAttributes.lineBreakStrategy.value());
    isParagraphStyleUsed = YES;
  }
  if (textAttributes.lineBreakMode.has_value()) {
    paragraphStyle.lineBreakMode = nsLineBreakMode(textAttributes.lineBreakMode.value());
    isParagraphStyleUsed = YES;
  }
  if (!std::isnan(textAttributes.lineHeight)) {
    CGFloat lineHeight = textAttributes.lineHeight * effectiveFontSizeMultiplier(textAttributes);
    paragraphStyle.minimumLineHeight = lineHeight;
    paragraphStyle.maximumLineHeight = lineHeight;
    isParagraphStyleUsed = YES;
  }
  if (isParagraphStyleUsed) {
    attributes[NSParagraphStyleAttributeName] = paragraphStyle;
  }

  return attributes;
}

NSString *capitalizeText(NSString *text)
{
  NSArray *words = [text componentsSeparatedByString:@" "];
  NSMutableArray *newWords = [NSMutableArray new];
  NSNumberFormatter *num = [NSNumberFormatter new];
  for (NSString *item in words) {
    NSString *word;
    if ([item length] > 0 && [num numberFromString:[item substringWithRange:NSMakeRange(0, 1)]] == nil) {
      word = [item capitalizedString];
    } else {
      word = [item lowercaseString];
    }
    [newWords addObject:word];
  }
  return [newWords componentsJoinedByString:@" "];
}

NSString *applyTextTransform(NSString *string, TextTransform textTransform)
{
  switch (textTransform) {
    case TextTransform::Uppercase:
      return [string uppercaseString];
    case TextTransform::Lowercase:
      return [string lowercaseString];
    case TextTransform::Capitalize:
      return capitalizeText(string);
    default:
      return string;
  }
}

NSMutableAttributedString *nsAttributedStringFromFragment(const AttributedString::Fragment &fragment)
{
  if (fragment.isAttachment()) {
    auto layoutMetrics = fragment.parentShadowView.layoutMetrics;
    RCTFantomTextAttachmentCell *cell = [RCTFantomTextAttachmentCell new];
    cell.attachmentBounds = NSMakeRect(
        layoutMetrics.frame.origin.x,
        layoutMetrics.frame.origin.y,
        layoutMetrics.frame.size.width,
        layoutMetrics.frame.size.height);

    NSTextAttachment *attachment = [NSTextAttachment new];
    attachment.attachmentCell = cell;
    attachment.bounds = cell.attachmentBounds;
    return [[NSAttributedString attributedStringWithAttachment:attachment] mutableCopy];
  }

  NSString *decoded = [[NSString alloc] initWithBytes:fragment.string.data()
                                               length:fragment.string.size()
                                             encoding:NSUTF8StringEncoding];
  NSString *string = decoded != nil ? decoded : @"";
  if (fragment.textAttributes.textTransform.has_value()) {
    string = applyTextTransform(string, fragment.textAttributes.textTransform.value());
  }
  return [[NSMutableAttributedString alloc] initWithString:string attributes:nsTextAttributes(fragment.textAttributes)];
}

NSMutableAttributedString *nsAttributedStringFromAttributedString(const AttributedString &attributedString)
{
  NSMutableAttributedString *result = [NSMutableAttributedString new];
  [result beginEditing];
  for (const auto &fragment : attributedString.getFragments()) {
    [result appendAttributedString:nsAttributedStringFromFragment(fragment)];
  }
  [result endEditing];
  return result;
}

CGFloat fontLineHeight(NSFont *font)
{
  return font.ascender - font.descender + font.leading;
}

void applyBaselineOffsetForRange(NSMutableAttributedString *attributedText, NSRange range)
{
  __block CGFloat maximumLineHeight = 0;
  [attributedText enumerateAttribute:NSParagraphStyleAttributeName
                             inRange:range
                             options:NSAttributedStringEnumerationLongestEffectiveRangeNotRequired
                          usingBlock:^(NSParagraphStyle *paragraphStyle, NSRange, BOOL *) {
                            if (paragraphStyle != nil) {
                              maximumLineHeight = MAX(paragraphStyle.maximumLineHeight, maximumLineHeight);
                            }
                          }];
  if (maximumLineHeight == 0) {
    return;
  }

  __block CGFloat maximumFontLineHeight = 0;
  [attributedText enumerateAttribute:NSFontAttributeName
                             inRange:range
                             options:NSAttributedStringEnumerationLongestEffectiveRangeNotRequired
                          usingBlock:^(NSFont *font, NSRange, BOOL *) {
                            if (font != nil) {
                              maximumFontLineHeight = MAX(fontLineHeight(font), maximumFontLineHeight);
                            }
                          }];

  if (maximumLineHeight < maximumFontLineHeight && !ReactNativeFeatureFlags::enableIOSCompressedTextFrameAdjustment()) {
    return;
  }

  CGFloat baselineOffset = (maximumLineHeight - maximumFontLineHeight) / 2.0;
  [attributedText addAttribute:NSBaselineOffsetAttributeName value:@(baselineOffset) range:range];
}

void applyBaselineOffset(NSMutableAttributedString *attributedText)
{
  if (ReactNativeFeatureFlags::enableIOSTextBaselineOffsetPerLine()) {
    [attributedText.string enumerateSubstringsInRange:NSMakeRange(0, attributedText.length)
                                              options:NSStringEnumerationByLines |
                                              NSStringEnumerationSubstringNotRequired
                                           usingBlock:^(NSString *, NSRange, NSRange enclosingRange, BOOL *) {
                                             applyBaselineOffsetForRange(attributedText, enclosingRange);
                                           }];
  } else {
    applyBaselineOffsetForRange(attributedText, NSMakeRange(0, attributedText.length));
  }
}

#pragma mark - Measurement (port of RCTTextLayoutManager.mm)

NSTextStorage *textStorageWithAttributedString(
    NSMutableAttributedString *attributedString,
    const ParagraphAttributes &paragraphAttributes,
    CGSize size)
{
  NSTextContainer *textContainer = [[NSTextContainer alloc] initWithSize:size];
  textContainer.lineFragmentPadding = 0.0; // Note, the default value is 5.
  textContainer.lineBreakMode = paragraphAttributes.maximumNumberOfLines > 0
      ? nsLineBreakModeFromEllipsizeMode(paragraphAttributes.ellipsizeMode)
      : NSLineBreakByClipping;
  textContainer.maximumNumberOfLines = paragraphAttributes.maximumNumberOfLines;

  NSLayoutManager *layoutManager = [NSLayoutManager new];
  layoutManager.usesFontLeading = NO;
  [layoutManager addTextContainer:textContainer];

  applyBaselineOffset(attributedString);

  NSTextStorage *textStorage = [[NSTextStorage alloc] initWithAttributedString:attributedString];
  [textStorage addLayoutManager:layoutManager];
  return textStorage;
}

TextMeasurement measureTextStorage(
    NSTextStorage *textStorage,
    const ParagraphAttributes &paragraphAttributes,
    const TextLayoutContext &layoutContext)
{
  NSLayoutManager *layoutManager = textStorage.layoutManagers.firstObject;
  NSTextContainer *textContainer = layoutManager.textContainers.firstObject;
  [layoutManager ensureLayoutForTextContainer:textContainer];

  NSRange glyphRange = [layoutManager glyphRangeForTextContainer:textContainer];
  __block BOOL textDidWrap = NO;
  __block NSUInteger linesEnumerated = 0;
  __block CGFloat enumeratedLinesHeight = 0;
  const auto maximumNumberOfLines = static_cast<NSUInteger>(std::max(paragraphAttributes.maximumNumberOfLines, 0));
  [layoutManager
      enumerateLineFragmentsForGlyphRange:glyphRange
                               usingBlock:^(NSRect, NSRect usedRect, NSTextContainer *, NSRange lineGlyphRange, BOOL *stop) {
                                 NSRange range = [layoutManager characterRangeForGlyphRange:lineGlyphRange
                                                                           actualGlyphRange:nil];
                                 NSUInteger lastCharacterIndex = range.location + range.length - 1;
                                 BOOL endsWithNewLine =
                                     [textStorage.string characterAtIndex:lastCharacterIndex] == '\n';
                                 if (!endsWithNewLine && textStorage.string.length > lastCharacterIndex + 1) {
                                   textDidWrap = YES;
                                 }
                                 if (linesEnumerated++ < maximumNumberOfLines) {
                                   enumeratedLinesHeight = usedRect.origin.y + usedRect.size.height;
                                 }
                                 if (textDidWrap &&
                                     (maximumNumberOfLines == 0 || linesEnumerated >= maximumNumberOfLines)) {
                                   *stop = YES;
                                 }
                               }];

  NSRect usedBounds = [layoutManager usedRectForTextContainer:textContainer];
  CGSize size = usedBounds.size;

  if (textDidWrap) {
    size.width = textContainer.size.width;
  }

  if (maximumNumberOfLines != 0) {
    // See RCTTextLayoutManager.mm: NSTextContainer.maximumNumberOfLines can
    // report N+1 lines when the N+1 line is empty.
    if (linesEnumerated < maximumNumberOfLines) {
      enumeratedLinesHeight += layoutManager.extraLineFragmentUsedRect.size.height;
    }
    size.height = enumeratedLinesHeight;
  }

  facebook::react::Size roundedSize = internal_roundTextMeasurementToPixelGrid(
      {.width = static_cast<Float>(size.width), .height = static_cast<Float>(size.height)},
      layoutContext.pointScaleFactor);

  NSRange visibleGlyphRange = [layoutManager glyphRangeForTextContainer:textContainer];
  __block auto attachments = TextMeasurement::Attachments{};

  [textStorage
      enumerateAttribute:NSAttachmentAttributeName
                 inRange:NSMakeRange(0, textStorage.length)
                 options:0
              usingBlock:^(NSTextAttachment *attachment, NSRange range, BOOL *) {
                if (attachment == nil) {
                  return;
                }

                NSRange attachmentGlyphRange = [layoutManager glyphRangeForCharacterRange:range
                                                                     actualCharacterRange:NULL];
                NSRange truncatedRange =
                    [layoutManager truncatedGlyphRangeInLineFragmentForGlyphAtIndex:attachmentGlyphRange.location];

                BOOL isOutsideVisibleRange = !NSLocationInRange(attachmentGlyphRange.location, visibleGlyphRange);
                BOOL isInTruncatedRange =
                    truncatedRange.location != NSNotFound && attachmentGlyphRange.location >= truncatedRange.location;

                if (isOutsideVisibleRange || isInTruncatedRange) {
                  attachments.push_back(TextMeasurement::Attachment{.frame = {}, .isClipped = true});
                  return;
                }

                CGSize attachmentSize = attachment.bounds.size;
                NSRect glyphRect = [layoutManager boundingRectForGlyphRange:attachmentGlyphRange
                                                            inTextContainer:textContainer];
                NSFont *font = [textStorage attribute:NSFontAttributeName atIndex:range.location effectiveRange:nil];

                attachments.push_back(TextMeasurement::Attachment{
                    .frame =
                        {.origin =
                             {.x = static_cast<Float>(glyphRect.origin.x),
                              .y = static_cast<Float>(
                                  glyphRect.origin.y + glyphRect.size.height - attachmentSize.height +
                                  font.descender)},
                         .size =
                             {.width = static_cast<Float>(attachmentSize.width),
                              .height = static_cast<Float>(attachmentSize.height)}},
                    .isClipped = false});
              }];

  return TextMeasurement{.size = roundedSize, .attachments = attachments};
}

TextMeasurement measureAttributedString(
    const AttributedString &attributedString,
    const ParagraphAttributes &paragraphAttributes,
    const TextLayoutContext &layoutContext,
    const LayoutConstraints &layoutConstraints)
{
  @autoreleasepool {
    NSMutableAttributedString *nsAttributedString = nsAttributedStringFromAttributedString(attributedString);
    if (nsAttributedString.length == 0) {
      return {};
    }

    CGFloat maximumWidth = std::isfinite(layoutConstraints.maximumSize.width) ? layoutConstraints.maximumSize.width
                                                                              : CGFLOAT_MAX;
    NSTextStorage *textStorage =
        textStorageWithAttributedString(nsAttributedString, paragraphAttributes, CGSize{maximumWidth, CGFLOAT_MAX});
    return measureTextStorage(textStorage, paragraphAttributes, layoutContext);
  }
}

} // namespace

namespace facebook::react {

TextLayoutManager::TextLayoutManager(const std::shared_ptr<const ContextContainer> & /*contextContainer*/)
    : textMeasureCache_(kSimpleThreadSafeCacheSizeCap)
{
}

TextMeasurement TextLayoutManager::measure(
    const AttributedStringBox &attributedStringBox,
    const ParagraphAttributes &paragraphAttributes,
    const TextLayoutContext &layoutContext,
    const LayoutConstraints &layoutConstraints) const
{
  react_native_assert(attributedStringBox.getMode() == AttributedStringBox::Mode::Value);
  const auto &originalAttributedString = attributedStringBox.getValue();
  auto attributedString = ensurePlaceholderIfEmpty_DO_NOT_USE(originalAttributedString);

  auto measurement = textMeasureCache_.get(
      {.attributedString = attributedString,
       .paragraphAttributes = paragraphAttributes,
       .layoutConstraints = layoutConstraints,
       .pointScaleFactor = layoutContext.pointScaleFactor},
      [&]() {
        auto telemetry = TransactionTelemetry::threadLocalTelemetry();
        if (telemetry != nullptr) {
          telemetry->willMeasureText();
        }

        auto measurement =
            measureAttributedString(attributedString, paragraphAttributes, layoutContext, layoutConstraints);

        // The placeholder character that represents an empty string must not
        // contribute to the width (same as on iOS).
        if (originalAttributedString.isEmpty()) {
          measurement.size.width = 0;
        }

        if (telemetry != nullptr) {
          telemetry->didMeasureText();
        }
        return measurement;
      });

  measurement.size = layoutConstraints.clamp(measurement.size);
  return measurement;
}

} // namespace facebook::react
