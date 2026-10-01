/*
 * See PortableTextLayout.h.
 */

#include "PortableTextLayout.h"

#include <algorithm>
#include <cmath>

namespace facebook::react::portabletext {

namespace {

constexpr float kWrapEpsilon = 0.001f;
// Placeholder for the code points merged into a ligature (a noncharacter).
constexpr char32_t kLigaturePart = 0xFDD0;

bool inRange(char32_t c, char32_t first, char32_t last) {
  return c >= first && c <= last;
}

bool isLineSeparator(char32_t c) {
  return c == 0x0A || c == 0x0D || c == 0x2028 || c == 0x2029 || c == 0x85;
}

/// Breakable spaces (U+00A0, U+2007, U+202F are no-break spaces).
bool isSpace(char32_t c) {
  return c == 0x20 || c == 0x09 || c == 0x1680 || c == 0x3000 || c == 0x205F ||
      (inRange(c, 0x2000, 0x200A) && c != 0x2007);
}

bool isCJK(char32_t c) {
  return inRange(c, 0x1100, 0x115F) || inRange(c, 0x2E80, 0x303E) || inRange(c, 0x3040, 0x30FF) ||
      inRange(c, 0x3100, 0x312F) || inRange(c, 0x3130, 0x318F) || inRange(c, 0x3190, 0x4DBF) ||
      inRange(c, 0x4E00, 0x9FFF) || inRange(c, 0xA000, 0xA4CF) || inRange(c, 0xAC00, 0xD7A3) ||
      inRange(c, 0xF900, 0xFAFF) || inRange(c, 0xFE30, 0xFE4F) || inRange(c, 0xFF00, 0xFFEF) ||
      inRange(c, 0x20000, 0x3FFFD);
}

/// No line break before these (UAX #14 CL, CP, EX, IS and CJK closing marks).
bool isClosing(char32_t c) {
  switch (c) {
    case ')':
    case ']':
    case '}':
    case '!':
    case '?':
    case ',':
    case '.':
    case ':':
    case ';':
    case 0x3001: // 、
    case 0x3002: // 。
    case 0x3009:
    case 0x300B:
    case 0x300D: // 」
    case 0x300F: // 』
    case 0x3011: // 】
    case 0x3015:
    case 0x3017:
    case 0x3019:
    case 0x301B:
    case 0x30FC: // ー
    case 0xFF01:
    case 0xFF09:
    case 0xFF0C:
    case 0xFF0E:
    case 0xFF1A:
    case 0xFF1B:
    case 0xFF1F:
    case 0xFF3D:
    case 0xFF5D:
      return true;
    default:
      return false;
  }
}

/// No line break after these (UAX #14 OP and CJK opening marks).
bool isOpening(char32_t c) {
  switch (c) {
    case '(':
    case '[':
    case '{':
    case 0x3008:
    case 0x300A:
    case 0x300C: // 「
    case 0x300E: // 『
    case 0x3010: // 【
    case 0x3014:
    case 0x3016:
    case 0x3018:
    case 0x301A:
    case 0xFF08:
    case 0xFF3B:
    case 0xFF5B:
      return true;
    default:
      return false;
  }
}

/// Code points that join the previous one (no break before them).
bool isExtending(char32_t c) {
  return c == kLigaturePart || c == 0x200C || c == 0x200D || inRange(c, 0x0300, 0x036F) || inRange(c, 0x1AB0, 0x1AFF) ||
      inRange(c, 0x1DC0, 0x1DFF) || inRange(c, 0x20D0, 0x20FF) || inRange(c, 0xFE00, 0xFE0F) ||
      inRange(c, 0xFE20, 0xFE2F) || inRange(c, 0x1F3FB, 0x1F3FF) || inRange(c, 0xE0020, 0xE007F) ||
      inRange(c, 0xE0100, 0xE01EF);
}

enum class Script { Common, Latin, Greek, Cyrillic, Other };

Script scriptOf(char32_t c) {
  if (inRange(c, 'A', 'Z') || inRange(c, 'a', 'z') || inRange(c, 0xC0, 0x24F) || inRange(c, 0x1E00, 0x1EFF)) {
    return c == 0xD7 || c == 0xF7 ? Script::Common : Script::Latin;
  }
  if (inRange(c, 0x370, 0x3FF) || inRange(c, 0x1F00, 0x1FFF)) {
    return Script::Greek;
  }
  if (inRange(c, 0x400, 0x52F)) {
    return Script::Cyrillic;
  }
  if (c < 0x370 || inRange(c, 0x2000, 0x2BFF) || inRange(c, 0x3000, 0x3003) || c == kLigaturePart) {
    return Script::Common;
  }
  return Script::Other;
}

bool isRegionalIndicator(char32_t c) {
  return inRange(c, 0x1F1E6, 0x1F1FF);
}

/// The standard Latin ligatures (ff, fi, fl, ffi, ffl), which TextKit forms
/// by default, also with letter spacing (which then follows the ligature
/// glyph): replaced by their presentation forms (U+FB00..U+FB04) when the
/// face maps them, followed by zero-width U+200B placeholders so that indices
/// and break opportunities stay as they were (no break inside a ligature).
std::u32string withLigatures(const Run &run) {
  if (run.font.face == nullptr || run.font.fixedAdvanceEm > 0) {
    return run.text;
  }
  const Face &face = *run.font.face;
  std::u32string out = run.text;
  for (std::size_t i = 0; i + 1 < out.size(); i++) {
    if (out[i] != 'f') {
      continue;
    }
    char32_t b = out[i + 1];
    char32_t c = i + 2 < out.size() ? out[i + 2] : 0;
    char32_t ligature = 0;
    std::size_t length = 2;
    if (b == 'f' && c == 'i') {
      ligature = 0xFB03;
      length = 3;
    } else if (b == 'f' && c == 'l') {
      ligature = 0xFB04;
      length = 3;
    } else if (b == 'f') {
      ligature = 0xFB00;
    } else if (b == 'i') {
      ligature = 0xFB01;
    } else if (b == 'l') {
      ligature = 0xFB02;
    }
    if (ligature == 0 || face.glyph(ligature) == 0) {
      continue;
    }
    out[i] = ligature;
    for (std::size_t k = 1; k < length; k++) {
      out[i + k] = kLigaturePart;
    }
    i += length - 1;
  }
  return out;
}

struct Item {
  char32_t c = 0;
  std::size_t run = 0;
  float advance = 0;
  bool space = false;
  bool newline = false;
};

struct Paragraph {
  std::size_t start = 0;
  std::size_t end = 0; // excluding the line separator
  std::size_t next = 0; // after the line separator
  bool hasSeparator = false;
};

// TextKit's default line height is round(ascent) + round(descent) (checked
// with Roboto and SF from 6 to 60 pt in 0.25 pt steps).
float runAscent(const Run &run) {
  return std::round(run.font.ascent() * run.fontSize);
}

float runDescent(const Run &run) {
  return std::round(run.font.descent() * run.fontSize);
}

} // namespace

std::u32string decodeUtf8(const std::string &utf8) {
  std::u32string out;
  out.reserve(utf8.size());
  std::size_t i = 0;
  const std::size_t n = utf8.size();
  while (i < n) {
    auto byte = static_cast<unsigned char>(utf8[i]);
    char32_t c = 0xFFFD;
    std::size_t length = 1;
    if (byte < 0x80) {
      c = byte;
    } else if ((byte >> 5) == 0x6) {
      length = 2;
    } else if ((byte >> 4) == 0xE) {
      length = 3;
    } else if ((byte >> 3) == 0x1E) {
      length = 4;
    }
    if (length > 1) {
      if (i + length > n) {
        length = 1;
      } else {
        char32_t value = byte & (0x7F >> length);
        bool ok = true;
        for (std::size_t k = 1; k < length; k++) {
          auto next = static_cast<unsigned char>(utf8[i + k]);
          if ((next & 0xC0) != 0x80) {
            ok = false;
            break;
          }
          value = (value << 6) | (next & 0x3F);
        }
        if (ok) {
          c = value;
        } else {
          length = 1;
        }
      }
    }
    out.push_back(c);
    i += length;
  }
  return out;
}

char32_t toUpper(char32_t c) {
  if (inRange(c, 'a', 'z')) {
    return c - 32;
  }
  if (c < 0x80) {
    return c;
  }
  if ((inRange(c, 0xE0, 0xFE) && c != 0xF7)) {
    return c - 32;
  }
  if (c == 0xFF) {
    return 0x178;
  }
  if (inRange(c, 0x100, 0x17F)) {
    bool oddLower = !(inRange(c, 0x139, 0x148) || inRange(c, 0x179, 0x17E));
    if (c == 0x131 || c == 0x138 || c == 0x149 || c == 0x17F) {
      return c == 0x131 ? 'I' : c;
    }
    if (oddLower) {
      return (c % 2 == 1) ? c - 1 : c;
    }
    return (c % 2 == 0) ? c - 1 : c;
  }
  if (inRange(c, 0x3B1, 0x3C9) && c != 0x3C2) {
    return c - 32;
  }
  if (c == 0x3C2) {
    return 0x3A3;
  }
  if (inRange(c, 0x430, 0x44F)) {
    return c - 32;
  }
  if (inRange(c, 0x450, 0x45F)) {
    return c - 80;
  }
  return c;
}

char32_t toLower(char32_t c) {
  if (inRange(c, 'A', 'Z')) {
    return c + 32;
  }
  if (c < 0x80) {
    return c;
  }
  if (inRange(c, 0xC0, 0xDE) && c != 0xD7) {
    return c + 32;
  }
  if (c == 0x178) {
    return 0xFF;
  }
  if (inRange(c, 0x100, 0x17F)) {
    bool oddLower = !(inRange(c, 0x139, 0x148) || inRange(c, 0x179, 0x17E));
    if (c == 0x130) {
      return 'i';
    }
    if (c == 0x131 || c == 0x138 || c == 0x149 || c == 0x17F) {
      return c;
    }
    if (oddLower) {
      return (c % 2 == 0) ? c + 1 : c;
    }
    return (c % 2 == 1) ? c + 1 : c;
  }
  if (inRange(c, 0x391, 0x3A9) && c != 0x3A2) {
    return c + 32;
  }
  if (inRange(c, 0x410, 0x42F)) {
    return c + 32;
  }
  if (inRange(c, 0x400, 0x40F)) {
    return c + 80;
  }
  return c;
}

LayoutResult layoutText(const LayoutInput &input) {
  LayoutResult result;
  const auto &runs = input.runs;
  if (runs.empty()) {
    return result;
  }

  // 1. Code points with their advances (kerning applied to the left glyph of
  //    each pair, letter spacing after every glyph cluster).
  std::vector<Item> items;
  std::size_t attachmentCount = 0;
  for (std::size_t r = 0; r < runs.size(); r++) {
    const Run &run = runs[r];
    if (run.isAttachment) {
      Item item;
      item.c = 0xFFFC;
      item.run = r;
      item.advance = run.attachmentWidth;
      items.push_back(item);
      attachmentCount++;
      continue;
    }
    // TextKit keeps the font's kerning with a non-zero NSKernAttributeName
    // (observed: the kerned width plus the spacing after every glyph); 0
    // turns kerning off.
    const float spacing = std::isnan(run.letterSpacing) ? 0 : run.letterSpacing;
    const bool kerning = std::isnan(run.letterSpacing) || run.letterSpacing != 0;
    const float widthScale = run.font.widthScale(run.fontSize);
    int previousGlyph = 0;
    std::size_t previousIndex = 0;
    // Kerning applies within a script run (CoreText shapes each run
    // separately); spaces and punctuation take the script before them.
    Script script = Script::Common;
    Script previousScript = Script::Common;
    bool joinNext = false;
    bool regionalPending = false;
    const std::u32string text = withLigatures(run);
    for (char32_t c : text) {
      Item item;
      item.c = c;
      item.run = r;
      if (isLineSeparator(c)) {
        item.newline = true;
        items.push_back(item);
        previousGlyph = 0;
        joinNext = false;
        regionalPending = false;
        continue;
      }
      if (c == kLigaturePart) {
        items.push_back(item);
        continue;
      }
      int glyph = 0;
      float advance = codepointAdvance(run.font, c, glyph) * run.fontSize;
      if (glyph != 0) {
        advance *= widthScale;
      }
      // An emoji after a zero-width joiner, the second regional indicator of a
      // flag: one glyph with the previous code point.
      bool joined = joinNext && advance > 0 && glyph == 0;
      if (isRegionalIndicator(c)) {
        joined = regionalPending;
        regionalPending = !regionalPending;
      } else {
        regionalPending = false;
      }
      joinNext = c == 0x200D;
      if (joined) {
        advance = 0;
      }
      if (advance > 0 || c == 0x20) {
        Script own = scriptOf(c);
        if (own != Script::Common) {
          script = own;
        }
        bool sameRun = previousScript == Script::Common || own == Script::Common || own == previousScript;
        if (kerning && previousGlyph != 0 && glyph != 0 && run.font.fixedAdvanceEm == 0 && sameRun) {
          items[previousIndex].advance += run.font.face->kerning(previousGlyph, glyph) * run.fontSize * widthScale;
        }
        previousScript = script;
        advance += spacing;
        previousGlyph = glyph;
        previousIndex = items.size();
      }
      item.space = isSpace(c);
      item.advance = advance;
      items.push_back(item);
    }
  }
  if (items.empty()) {
    return result;
  }

  // 2. Paragraphs.
  std::vector<Paragraph> paragraphs;
  {
    std::size_t start = 0;
    for (std::size_t i = 0; i < items.size(); i++) {
      if (!items[i].newline) {
        continue;
      }
      std::size_t next = i + 1;
      if (items[i].c == 0x0D && next < items.size() && items[next].c == 0x0A) {
        next++;
      }
      paragraphs.push_back({start, i, next, true});
      start = next;
      i = next - 1;
    }
    // The text after the last separator; an empty one is TextKit's extra line
    // fragment after a trailing line break.
    paragraphs.push_back({start, items.size(), items.size(), false});
  }

  // 3. Break opportunities: breakAfter[i] allows a break between i and i + 1.
  std::vector<bool> breakAfter(items.size(), false);
  for (std::size_t i = 0; i + 1 < items.size(); i++) {
    const Item &a = items[i];
    const Item &b = items[i + 1];
    if (a.newline || b.newline || b.space || isExtending(b.c) || b.advance == 0) {
      continue;
    }
    if (input.wrap == WrapMode::Char) {
      breakAfter[i] = true;
      continue;
    }
    if (isClosing(b.c)) {
      continue;
    }
    if (a.space || a.c == 0x200B || a.c == 0xFFFC || b.c == 0xFFFC) {
      breakAfter[i] = true;
    } else if (a.c == 0x2010 || a.c == 0x2013 || a.c == 0x2014 || b.c == 0x2014) {
      breakAfter[i] = true;
    } else if (a.c == '-') {
      bool afterWord = i > 0 && !items[i - 1].space && !items[i - 1].newline;
      breakAfter[i] = afterWord && !inRange(b.c, '0', '9');
    } else if ((isCJK(a.c) || isCJK(b.c)) && !isOpening(a.c)) {
      breakAfter[i] = true;
    }
  }

  // 4. Lines (greedy).
  struct PendingLine {
    std::size_t start;
    std::size_t end;
    bool endsParagraph;
    std::size_t paragraph;
  };
  std::vector<PendingLine> pending;
  const bool wraps = input.wrap != WrapMode::None && std::isfinite(input.maxWidth);
  for (std::size_t p = 0; p < paragraphs.size(); p++) {
    const Paragraph &paragraph = paragraphs[p];
    std::size_t lineStart = paragraph.start;
    if (wraps) {
      float width = 0;
      std::size_t lastBreak = 0; // 0: none (a break is never before lineStart)
      std::size_t i = lineStart;
      while (i < paragraph.end) {
        const Item &item = items[i];
        if (!item.space && i > lineStart && width + item.advance > input.maxWidth + kWrapEpsilon) {
          std::size_t breakAt = lastBreak > lineStart ? lastBreak : i;
          // Do not split a cluster (zero-width code points stay with their base).
          while (breakAt > lineStart + 1 && (items[breakAt].advance == 0 || isExtending(items[breakAt].c))) {
            breakAt--;
          }
          pending.push_back({lineStart, breakAt, false, p});
          lineStart = breakAt;
          // Rescan the rest of the current word on the new line.
          width = 0;
          lastBreak = 0;
          for (std::size_t k = lineStart; k < i; k++) {
            width += items[k].advance;
            if (breakAfter[k]) {
              lastBreak = k + 1;
            }
          }
          continue;
        }
        width += item.advance;
        if (breakAfter[i]) {
          lastBreak = i + 1;
        }
        i++;
      }
    }
    pending.push_back({lineStart, paragraph.hasSeparator ? paragraph.next : paragraph.end, true, p});
  }
  // 5. Line metrics.
  result.totalLines = static_cast<int>(pending.size());
  const std::size_t visible = input.maxLines > 0
      ? std::min<std::size_t>(pending.size(), static_cast<std::size_t>(input.maxLines))
      : pending.size();
  float top = 0;
  float widest = 0;
  for (std::size_t l = 0; l < visible; l++) {
    const PendingLine &line = pending[l];
    const Paragraph &paragraph = paragraphs[line.paragraph];
    LineBox box;
    box.start = line.start;
    box.end = line.end;
    box.endsParagraph = line.endsParagraph;
    box.top = top;
    float ascent = 0;
    float descent = 0;
    bool any = false;
    for (std::size_t k = line.start; k < line.end; k++) {
      const Run &run = runs[items[k].run];
      if (run.isAttachment) {
        ascent = std::max(ascent, std::round(run.attachmentHeight));
        continue;
      }
      ascent = std::max(ascent, runAscent(run));
      descent = std::max(descent, runDescent(run));
      any = true;
    }
    if (!any) {
      // An empty line (or attachments only): the font of the character before it.
      std::size_t index = line.start < items.size() ? line.start : items.size() - 1;
      const Run &run = runs[items[index].run];
      ascent = std::max(ascent, runAscent(run));
      descent = std::max(descent, runDescent(run));
    }
    box.ascent = ascent;
    box.descent = descent;
    std::size_t first = std::min(paragraph.start, items.size() - 1);
    float paragraphLineHeight = runs[items[first].run].lineHeight;
    box.height = !std::isnan(paragraphLineHeight) && paragraphLineHeight > 0 ? paragraphLineHeight : ascent + descent;

    // Width without the separator. Spaces at the end count (TextKit's used
    // rect has them); for a wrapped line the result is maxWidth anyway.
    std::size_t end = line.end;
    while (end > line.start && (items[end - 1].newline || (!input.trailingSpacesCount && items[end - 1].space))) {
      end--;
    }
    float width = 0;
    for (std::size_t k = line.start; k < end; k++) {
      width += items[k].advance;
    }
    box.width = width;
    widest = std::max(widest, width);

    if (!line.endsParagraph && line.end < items.size()) {
      result.wrapped = true;
    }
    top += box.height;
    result.lines.push_back(box);
  }
  // maxLines cuts the last visible line in the middle of its paragraph: TextKit
  // truncates it (tail ellipsis, the rest of the paragraph on the same line
  // fragment), so that line does not count as wrapped and its width is the
  // characters that fit with the ellipsis.
  if (visible < pending.size() && visible > 0 && !pending[visible - 1].endsParagraph) {
    LineBox &last = result.lines.back();
    if (visible > 1 && result.wrapped) {
      // Wrapped before: the width is maxWidth anyway.
    } else {
      result.wrapped = false;
      for (std::size_t l = 0; l + 1 < visible; l++) {
        if (!result.lines[l].endsParagraph) {
          result.wrapped = true;
        }
      }
    }
    if (!result.wrapped) {
      const Run &run = runs[items[last.start].run];
      int glyph = 0;
      float ellipsis = codepointAdvance(run.font, 0x2026, glyph) * run.fontSize * run.font.widthScale(run.fontSize) +
          (std::isnan(run.letterSpacing) ? 0 : run.letterSpacing);
      float width = 0;
      float fitted = 0;
      for (std::size_t k = last.start; k < items.size() && !items[k].newline; k++) {
        if (width + items[k].advance + ellipsis > input.maxWidth + kWrapEpsilon) {
          break;
        }
        width += items[k].advance;
        fitted = width;
      }
      last.width = fitted + ellipsis;
      widest = 0;
      for (const auto &line : result.lines) {
        widest = std::max(widest, line.width);
      }
    }
  }
  result.height = top;
  result.width = result.wrapped && std::isfinite(input.maxWidth) ? input.maxWidth : widest;

  // 6. Attachments.
  if (attachmentCount > 0) {
    const float available = std::isfinite(input.maxWidth) ? input.maxWidth : result.width;
    std::vector<int> lineOf(items.size(), -1);
    for (std::size_t l = 0; l < result.lines.size(); l++) {
      for (std::size_t k = result.lines[l].start; k < result.lines[l].end && k < items.size(); k++) {
        lineOf[k] = static_cast<int>(l);
      }
    }
    for (std::size_t k = 0; k < items.size(); k++) {
      const Run &run = runs[items[k].run];
      if (!run.isAttachment) {
        continue;
      }
      AttachmentBox box;
      box.width = run.attachmentWidth;
      box.height = run.attachmentHeight;
      int l = lineOf[k];
      if (l < 0) {
        box.clipped = true;
        result.attachments.push_back(box);
        continue;
      }
      const LineBox &line = result.lines[static_cast<std::size_t>(l)];
      float x = 0;
      for (std::size_t j = line.start; j < k; j++) {
        x += items[j].advance;
      }
      float offset = 0;
      if (input.alignment == Alignment::Center) {
        offset = (available - line.width) / 2;
      } else if (input.alignment == Alignment::Right) {
        offset = available - line.width;
      }
      box.x = x + std::max(offset, 0.0f);
      box.y = line.top + line.height - box.height - runDescent(run);
      bool lastVisible = static_cast<std::size_t>(l) + 1 == result.lines.size() &&
          result.lines.size() < static_cast<std::size_t>(result.totalLines);
      box.clipped = lastVisible && std::isfinite(input.maxWidth) && x + box.width > input.maxWidth;
      result.attachments.push_back(box);
    }
  }
  return result;
}

} // namespace facebook::react::portabletext
