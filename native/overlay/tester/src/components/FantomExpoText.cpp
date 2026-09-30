/*
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

#include "FantomExpoText.h"

#include <react/renderer/attributedstring/AttributedString.h>
#include <react/renderer/attributedstring/AttributedStringBox.h>
#include <react/renderer/attributedstring/ParagraphAttributes.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/utils/ContextContainer.h>

#include <algorithm>
#include <array>
#include <utility>

namespace facebook::react {

namespace {

const TextLayoutManager& textLayoutManager() {
  static TextLayoutManager manager(std::make_shared<const ContextContainer>());
  return manager;
}

std::string fontFamilyFor(const ExpoTextMeasureOptions& options) {
  if (!options.fontFamily.empty()) {
    return options.fontFamily;
  }
  if (options.design == "rounded") {
    return "ui-rounded";
  }
  if (options.design == "serif") {
    return "ui-serif";
  }
  if (options.design == "monospaced") {
    return "ui-monospace";
  }
  return "";
}

} // namespace

Size measureExpoText(
    const std::string& text,
    const ExpoTextMeasureOptions& options,
    Float pointScaleFactor) {
  TextAttributes textAttributes = TextAttributes::defaultTextAttributes();
  textAttributes.fontFamily = fontFamilyFor(options);
  textAttributes.fontSize = options.size;
  textAttributes.fontWeight =
      static_cast<FontWeight>(std::clamp(options.weight, 100, 900) / 100 * 100);
  textAttributes.fontStyle =
      options.italic ? FontStyle::Italic : FontStyle::Normal;
  if (options.letterSpacing != 0) {
    // The macOS TextLayoutManager applies it as NSKernAttributeName, like
    // React Native <Text> on iOS (the font's kerning is off for that text).
    textAttributes.letterSpacing = options.letterSpacing;
  }

  AttributedString attributedString;
  attributedString.setBaseTextAttributes(textAttributes);
  attributedString.appendFragment(
      AttributedString::Fragment{
          .string = text, .textAttributes = textAttributes, .parentShadowView = {}});

  ParagraphAttributes paragraphAttributes;
  paragraphAttributes.maximumNumberOfLines = options.maxLines;

  LayoutConstraints constraints{
      .minimumSize = {0, 0},
      .maximumSize =
          {options.maxWidth, std::numeric_limits<Float>::infinity()}};

  return textLayoutManager()
      .measure(
          AttributedStringBox{attributedString},
          paragraphAttributes,
          TextLayoutContext{.pointScaleFactor = pointScaleFactor},
          constraints)
      .size;
}

std::optional<SwiftUITextStyle> swiftUITextStyle(std::string_view name) {
  static constexpr std::array<std::pair<std::string_view, SwiftUITextStyle>, 11>
      kStyles{{
          {"largeTitle", {34, 400}},
          {"title", {28, 400}},
          {"title2", {22, 400}},
          {"title3", {20, 400}},
          {"headline", {17, 600}},
          {"body", {17, 400}},
          {"callout", {16, 400}},
          {"subheadline", {15, 400}},
          {"footnote", {13, 400}},
          {"caption", {12, 400}},
          {"caption2", {11, 400}},
      }};
  for (const auto& [styleName, style] : kStyles) {
    if (styleName == name) {
      return style;
    }
  }
  return std::nullopt;
}

} // namespace facebook::react
