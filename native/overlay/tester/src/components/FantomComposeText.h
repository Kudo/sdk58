/*
 * Text measurement for the @expo/ui Jetpack Compose layout engine
 * (expoui/compose): CoreText with the embedded Roboto (platform/macos/
 * EmbeddedFonts.h), behind the engines' shared layout::TextMeasurer. FontSpec:
 * pointSize in px, named weight, letterSpacing (px, tracking), italic. Checked against real Compose Desktop by
 * native/tools/compose-layout-test, which builds this file.
 */

#pragma once

#include <string>

#include "expoui/compose/ComposeLayout.h"

namespace facebook::react {

class FantomComposeTextMeasurer : public expoui::layout::TextMeasurer {
 public:
  /// Registers the embedded fonts (once per process).
  FantomComposeTextMeasurer();

  /// Whether the embedded Roboto is available (false: the system font is used and sizes will
  /// not match Android).
  bool hasRoboto() const { return hasRoboto_; }

  expoui::layout::TextMeasurement
  measureText(const std::string &text, const expoui::layout::FontSpec &font, double maxWidth, int maxLines) override;
  double lineHeight(const expoui::layout::FontSpec &font) override;
  expoui::layout::Size measureSymbol(const std::string &name, const expoui::layout::FontSpec &font) override;

  /// The same with the style in px; the other methods convert FontSpec to it.
  expoui::layout::TextMeasurement measureComposeText(
      const std::string &text,
      const expoui::compose::ResolvedTextStyle &style,
      double maxWidth,
      int maxLines);
  /// ascent + descent, px, not rounded.
  double composeFontHeight(const expoui::compose::ResolvedTextStyle &style);

 private:
  bool hasRoboto_ = false;
};

} // namespace facebook::react
