/*
 * The portable counterpart of components/FantomComposeText.mm (same class,
 * FantomComposeText.h): the embedded Roboto through the portable text layout
 * (PortableTextLayout.h) instead of CoreText.
 *
 * Widths and line counts only, as in the CoreText version: the width is the
 * advance sum with kerning plus the letter spacing after every glyph, lines
 * break at word boundaries, trailing spaces do not count; the Compose engine
 * computes paragraph heights from the line count and lineHeight() (ascent +
 * descent, not rounded).
 */

#include "components/FantomComposeText.h"

#include "EmbeddedFonts.h"
#include "PortableFonts.h"
#include "PortableTextLayout.h"

#include <algorithm>
#include <cmath>
#include <map>

namespace facebook::react {

namespace {

namespace pt = portabletext;
using expoui::compose::ResolvedTextStyle;

/// The embedded faces are Regular, Medium, Bold and Italic: as in
/// FantomComposeText.mm, weight <= 450 Regular, <= 500 Medium, else Bold;
/// italic has one weight. "serif" and "cursive" have no embedded face (CoreText
/// uses Times and Snell Roundhand) and use Roboto; "monospace" uses the fixed
/// 0.6 em advances (Menlo's).
pt::Font font(const ResolvedTextStyle &style) {
  if (style.fontFamily == "monospace") {
    return pt::resolveFont("monospace", style.fontWeight, style.italic);
  }
  int weight = style.fontWeight <= 450 ? 400 : style.fontWeight <= 500 ? 500 : 700;
  return pt::resolveFont("Roboto", weight, style.italic);
}

ResolvedTextStyle fromFontSpec(const expoui::layout::FontSpec &spec) {
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
    int maxLines) {
  pt::Run run;
  run.text = pt::decodeUtf8(text);
  run.font = font(style);
  run.fontSize = style.fontSizePx;
  if (style.letterSpacingPx != 0) {
    run.letterSpacing = style.letterSpacingPx;
  }
  pt::LayoutInput input;
  input.runs.push_back(std::move(run));
  input.maxWidth = std::isfinite(maxWidth) ? static_cast<float>(maxWidth) : std::numeric_limits<float>::infinity();
  input.trailingSpacesCount = false;
  pt::LayoutResult layout = pt::layoutText(input);

  float widest = 0;
  for (const auto &line : layout.lines) {
    widest = std::max(widest, line.width);
  }
  int lines = layout.totalLines;
  if (maxLines > 0) {
    lines = std::min(lines, maxLines);
  }
  const pt::Font f = font(style);
  expoui::layout::TextMeasurement m;
  m.lines = std::max(lines, 1);
  m.width = widest;
  m.height = (f.ascent() + f.descent()) * style.fontSizePx * m.lines;
  m.firstBaseline = f.ascent() * style.fontSizePx;
  return m;
}

double FantomComposeTextMeasurer::composeFontHeight(const ResolvedTextStyle &style) {
  const pt::Font f = font(style);
  return (f.ascent() + f.descent()) * style.fontSizePx;
}

expoui::layout::TextMeasurement FantomComposeTextMeasurer::measureText(
    const std::string &text,
    const expoui::layout::FontSpec &spec,
    double maxWidth,
    int maxLines) {
  return measureComposeText(text, fromFontSpec(spec), maxWidth, maxLines);
}

double FantomComposeTextMeasurer::lineHeight(const expoui::layout::FontSpec &spec) {
  return composeFontHeight(fromFontSpec(spec));
}

expoui::layout::Size FantomComposeTextMeasurer::measureSymbol(const std::string &, const expoui::layout::FontSpec &) {
  return {};
}

} // namespace facebook::react
