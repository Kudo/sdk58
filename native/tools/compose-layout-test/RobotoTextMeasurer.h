// TextMeasurer for the Compose engine tests: CoreText with Roboto 2.138 (the fonts that
// compose-ref uses), with the line metrics that Compose Desktop's Skia paragraphs give.

#pragma once

#include <string>

#include "ComposeLayout.h"

namespace expoui::compose {

class RobotoTextMeasurer : public TextMeasurer {
 public:
  /// Registers every Roboto-*.ttf in `fontsDir` for this process. Returns false if there is none.
  static bool registerFonts(const std::string& fontsDir);

  float maxIntrinsicWidth(const std::string& text, const ResolvedTextStyle& style) override;
  float minIntrinsicWidth(const std::string& text, const ResolvedTextStyle& style) override;
  TextLayoutResult layout(const std::string& text, const ResolvedTextStyle& style, float width,
                          int maxLines) override;
};

}  // namespace expoui::compose
