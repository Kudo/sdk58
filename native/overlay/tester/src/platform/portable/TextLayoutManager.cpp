/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Portable implementation of the cross-platform `TextLayoutManager` facade
// (FANTOM_TEXT_LAYOUT=portable): no OS text APIs, so the same code builds on
// Linux and Windows. Fonts and paragraph layout are in PortableFonts.h and
// PortableTextLayout.h; this file maps React Native's attributed strings to
// them the way platform/macos/TextLayoutManager.mm maps them to TextKit
// (font size multiplier, line height, letter spacing, text transform,
// attachments, maximumNumberOfLines, pixel grid rounding).

#include <react/debug/react_native_assert.h>
#include <react/renderer/attributedstring/PlaceholderAttributedString.h>
#include <react/renderer/telemetry/TransactionTelemetry.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/textlayoutmanager/TextMeasurementRounding.h>

#include "PortableFonts.h"
#include "PortableTextLayout.h"

#include <algorithm>
#include <cmath>

namespace facebook::react {

namespace {

namespace pt = portabletext;

Float effectiveFontSizeMultiplier(const TextAttributes &textAttributes) {
  if (!textAttributes.allowFontScaling.value_or(true)) {
    return 1.0;
  }
  // As on macOS: no Dynamic Type, `dynamicTypeRamp` does not scale the font.
  Float fontSizeMultiplier = !std::isnan(textAttributes.fontSizeMultiplier) ? textAttributes.fontSizeMultiplier : 1.0f;
  Float maxFontSizeMultiplier =
      !std::isnan(textAttributes.maxFontSizeMultiplier) ? textAttributes.maxFontSizeMultiplier : 0.0f;
  return maxFontSizeMultiplier >= 1.0f ? std::min(maxFontSizeMultiplier, fontSizeMultiplier) : fontSizeMultiplier;
}

bool isDigit(char32_t c) {
  return c >= '0' && c <= '9';
}

// Same rules as capitalizeText() in the macOS layout: words split at spaces;
// a word starting with a digit is lowercased, else its first letter is
// uppercased and the rest lowercased.
std::u32string applyTextTransform(std::u32string text, TextTransform textTransform) {
  switch (textTransform) {
    case TextTransform::Uppercase:
      std::transform(text.begin(), text.end(), text.begin(), pt::toUpper);
      break;
    case TextTransform::Lowercase:
      std::transform(text.begin(), text.end(), text.begin(), pt::toLower);
      break;
    case TextTransform::Capitalize: {
      bool wordStart = true;
      bool upperWord = false;
      for (auto &c : text) {
        if (c == ' ') {
          wordStart = true;
          continue;
        }
        if (wordStart) {
          upperWord = !isDigit(c);
          c = upperWord ? pt::toUpper(c) : pt::toLower(c);
          wordStart = false;
        } else {
          c = pt::toLower(c);
        }
      }
      break;
    }
    default:
      break;
  }
  return text;
}

pt::Alignment alignmentOf(const TextAttributes &textAttributes) {
  const bool isRTL = textAttributes.layoutDirection == LayoutDirection::RightToLeft;
  switch (textAttributes.alignment.value_or(TextAlignment::Natural)) {
    case TextAlignment::Center:
      return pt::Alignment::Center;
    case TextAlignment::Right:
      return isRTL ? pt::Alignment::Left : pt::Alignment::Right;
    case TextAlignment::End:
      return isRTL ? pt::Alignment::Left : pt::Alignment::Right;
    case TextAlignment::Left:
      return isRTL ? pt::Alignment::Right : pt::Alignment::Left;
    default:
      return isRTL ? pt::Alignment::Right : pt::Alignment::Left;
  }
}

pt::WrapMode wrapModeOf(const TextAttributes &textAttributes) {
  switch (textAttributes.lineBreakMode.value_or(LineBreakMode::Word)) {
    case LineBreakMode::Word:
      return pt::WrapMode::Word;
    case LineBreakMode::Char:
      return pt::WrapMode::Char;
    default:
      // Clipping / truncating paragraph styles do not wrap (NSParagraphStyle).
      return pt::WrapMode::None;
  }
}

pt::Run runFromFragment(const AttributedString::Fragment &fragment) {
  pt::Run run;
  const TextAttributes &attributes = fragment.textAttributes;
  const Float multiplier = effectiveFontSizeMultiplier(attributes);
  const int weight = attributes.fontWeight.has_value() ? static_cast<int>(attributes.fontWeight.value()) : 400;
  const bool italic = attributes.fontStyle.has_value() && attributes.fontStyle.value() != FontStyle::Normal;
  run.font = pt::resolveFont(attributes.fontFamily, weight, italic);
  run.fontSize = static_cast<float>((std::isnan(attributes.fontSize) ? 14.0f : attributes.fontSize) * multiplier);
  if (!std::isnan(attributes.lineHeight)) {
    run.lineHeight = static_cast<float>(attributes.lineHeight * multiplier);
  }
  if (!std::isnan(attributes.letterSpacing)) {
    run.letterSpacing = static_cast<float>(attributes.letterSpacing);
  }
  if (fragment.isAttachment()) {
    const auto &frame = fragment.parentShadowView.layoutMetrics.frame;
    run.isAttachment = true;
    run.attachmentWidth = static_cast<float>(frame.size.width);
    run.attachmentHeight = static_cast<float>(frame.size.height);
    return run;
  }
  run.text = pt::decodeUtf8(fragment.string);
  if (attributes.textTransform.has_value()) {
    run.text = applyTextTransform(std::move(run.text), attributes.textTransform.value());
  }
  return run;
}

TextMeasurement measureAttributedString(
    const AttributedString &attributedString,
    const ParagraphAttributes &paragraphAttributes,
    const TextLayoutContext &layoutContext,
    const LayoutConstraints &layoutConstraints) {
  const auto &fragments = attributedString.getFragments();
  pt::LayoutInput input;
  input.runs.reserve(fragments.size());
  bool hasText = false;
  for (const auto &fragment : fragments) {
    input.runs.push_back(runFromFragment(fragment));
    hasText = hasText || input.runs.back().isAttachment || !input.runs.back().text.empty();
  }
  if (!hasText) {
    return {};
  }
  // Paragraph-level attributes come from the first fragment, like
  // NSParagraphStyle on the first character.
  input.wrap = wrapModeOf(fragments.front().textAttributes);
  input.alignment = alignmentOf(fragments.front().textAttributes);
  input.maxLines = std::max(paragraphAttributes.maximumNumberOfLines, 0);
  input.maxWidth = std::isfinite(layoutConstraints.maximumSize.width)
      ? static_cast<float>(layoutConstraints.maximumSize.width)
      : std::numeric_limits<float>::infinity();

  pt::LayoutResult layout = pt::layoutText(input);

  Size roundedSize = internal_roundTextMeasurementToPixelGrid(
      {.width = static_cast<Float>(layout.width), .height = static_cast<Float>(layout.height)},
      layoutContext.pointScaleFactor);

  TextMeasurement::Attachments attachments;
  attachments.reserve(layout.attachments.size());
  for (const auto &box : layout.attachments) {
    if (box.clipped) {
      attachments.push_back(TextMeasurement::Attachment{.frame = {}, .isClipped = true});
      continue;
    }
    attachments.push_back(TextMeasurement::Attachment{
        .frame =
            {.origin = {.x = static_cast<Float>(box.x), .y = static_cast<Float>(box.y)},
             .size = {.width = static_cast<Float>(box.width), .height = static_cast<Float>(box.height)}},
        .isClipped = false});
  }
  return TextMeasurement{.size = roundedSize, .attachments = attachments};
}

} // namespace

TextLayoutManager::TextLayoutManager(const std::shared_ptr<const ContextContainer> & /*contextContainer*/)
    : textMeasureCache_(kSimpleThreadSafeCacheSizeCap) {}

TextMeasurement TextLayoutManager::measure(
    const AttributedStringBox &attributedStringBox,
    const ParagraphAttributes &paragraphAttributes,
    const TextLayoutContext &layoutContext,
    const LayoutConstraints &layoutConstraints) const {
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
