// TextMeasurer for the Compose engine tests: CoreText with Roboto 2.138 (the fonts that
// compose-ref uses). It implements the shared layout::TextMeasurer and the Compose extension
// (italic, letter spacing, numeric weight).

#pragma once

#include <string>

#include "ComposeLayout.h"

namespace expoui::compose {

class RobotoTextMeasurer : public layout::TextMeasurer, public ComposeTextMeasurer {
 public:
  /// Registers every Roboto-*.ttf in `fontsDir` for this process. Returns false if there is none.
  static bool registerFonts(const std::string& fontsDir);

  // layout::TextMeasurer (FontSpec: pointSize in px, weight name, design).
  layout::TextMeasurement measureText(const std::string& text, const layout::FontSpec& font, double maxWidth,
                                      int maxLines) override;
  double lineHeight(const layout::FontSpec& font) override;
  layout::Size measureSymbol(const std::string& name, const layout::FontSpec& font) override;

  // ComposeTextMeasurer
  layout::TextMeasurement measureComposeText(const std::string& text, const ResolvedTextStyle& style,
                                             double maxWidth, int maxLines) override;
  double composeFontHeight(const ResolvedTextStyle& style) override;
};

}  // namespace expoui::compose
