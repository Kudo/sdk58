/*
 * Portable paragraph layout (no OS text APIs): real advances, kerning and
 * vertical metrics from the font files (PortableFonts.h), greedy line breaking
 * and line heights modelled on TextKit 1 (the macOS / iOS TextLayoutManager):
 *
 *  - Paragraphs end at U+000A, U+2028, U+2029 (and CR LF). A trailing line
 *    break adds an empty line (TextKit's extra line fragment).
 *  - Break opportunities: after spaces / tabs / ideographic space, after
 *    hyphens and dashes (U+002D before a non-digit, U+2010, U+2013, U+2014),
 *    after U+200B, before and after CJK ideographs, kana and Hangul (no break
 *    before closing CJK punctuation). Spaces at the end of a line hang (they do
 *    not count for wrapping or for the line width). A word wider than the line
 *    is broken between characters.
 *  - No shaping beyond the Latin ligatures below: one glyph per code point
 *    (complex scripts are not formed), left-to-right only. Joiners, variation
 *    selectors and emoji modifiers have no width; an emoji ZWJ sequence or a
 *    flag is one glyph.
 *  - Line height: the largest round(ascent) + round(descent) (hhea, no line
 *    gap, like NSLayoutManager.usesFontLeading = NO) of the runs on the
 *    line, or the paragraph's lineHeight when set (minimum = maximum line
 *    height). Inline attachments raise the ascent to their height.
 *  - maxLines: the last visible line is truncated (tail) when its paragraph
 *    goes on; its width is the characters that fit plus an ellipsis.
 *  - Kerning (kern / GPOS pairs) within a script run; the standard Latin
 *    ligatures (ff, fi, fl, ffi, ffl) when the face has them.
 *  - Letter spacing: added after every glyph (a ligature is one glyph);
 *    letterSpacing 0 turns kerning off (both as NSKernAttributeName does).
 */

#pragma once

#include "PortableFonts.h"

#include <limits>
#include <string>
#include <vector>

namespace facebook::react::portabletext {

/// A styled range of text, or one inline attachment.
struct Run {
  std::u32string text;
  Font font;
  /// px
  float fontSize = 14;
  /// px after each glyph; NaN: none.
  float letterSpacing = std::numeric_limits<float>::quiet_NaN();
  /// px; NaN: from the font. The value of a paragraph's first run applies to
  /// the whole paragraph (paragraph style).
  float lineHeight = std::numeric_limits<float>::quiet_NaN();
  bool isAttachment = false;
  float attachmentWidth = 0;
  float attachmentHeight = 0;
};

enum class WrapMode { Word, Char, None };
enum class Alignment { Left, Center, Right };

struct LayoutInput {
  std::vector<Run> runs;
  float maxWidth = std::numeric_limits<float>::infinity();
  /// 0: no limit.
  int maxLines = 0;
  WrapMode wrap = WrapMode::Word;
  Alignment alignment = Alignment::Left;
  /// Whether spaces at the end of a line count for its width (TextKit: yes;
  /// CoreText's CTLine minus trailing whitespace and Skia: no).
  bool trailingSpacesCount = true;
};

struct LineBox {
  float top = 0;
  float width = 0; // without hanging spaces
  float height = 0;
  float ascent = 0;
  float descent = 0;
  /// Code point range in the concatenated runs.
  std::size_t start = 0;
  std::size_t end = 0;
  bool endsParagraph = false;
};

struct AttachmentBox {
  float x = 0;
  float y = 0;
  float width = 0;
  float height = 0;
  bool clipped = false;
};

struct LayoutResult {
  /// Like NSLayoutManager's used rect: the widest line, or maxWidth when a
  /// line wrapped; the visible lines' heights.
  float width = 0;
  float height = 0;
  /// Visible lines (at most maxLines).
  std::vector<LineBox> lines;
  /// Lines before maxLines applied.
  int totalLines = 0;
  bool wrapped = false;
  /// One per attachment run, in order.
  std::vector<AttachmentBox> attachments;
};

LayoutResult layoutText(const LayoutInput &input);

/// UTF-8 to code points (invalid bytes become U+FFFD).
std::u32string decodeUtf8(const std::string &utf8);

/// Simple case mapping (Latin, Greek, Cyrillic; no special casing).
char32_t toUpper(char32_t c);
char32_t toLower(char32_t c);

} // namespace facebook::react::portabletext
