// TextMeasurer backed by AppKit text layout (macOS tests; see CoreTextMeasurer.mm).

#pragma once

#include "Layout.h"

namespace expoui::layout {

class CoreTextMeasurer : public TextMeasurer {
 public:
  /// `useTextStyles`: resolve `FontSpec::textStyle` with NSFont.preferredFont (macOS text
  /// styles). Without it, fonts are the system font at `pointSize` / `weight` (for iOS metrics,
  /// whose text style sizes differ from macOS).
  explicit CoreTextMeasurer(bool useTextStyles = true) : useTextStyles_(useTextStyles) {}

  TextMeasurement measureText(const std::string& text, const FontSpec& font, double maxWidth, int maxLines) override;
  TextMeasurement measureTextTruncated(const std::string& text, const FontSpec& font, double maxWidth, int maxLines,
                                       const std::string& truncationMode) override;
  double lineHeight(const FontSpec& font) override;
  Size measureSymbol(const std::string& name, const FontSpec& font) override;

 private:
  bool useTextStyles_;
};

} // namespace expoui::layout
