# swiftui-layout-test

Tests the C++ SwiftUI layout engine
([`native/overlay/tester/src/expoui/layout/`](../../overlay/tester/src/expoui/layout/)) against
real SwiftUI ([`swiftui-ref`](../swiftui-ref/)).

```sh
native/tools/swiftui-layout-test/build.sh                          # engine CLI + swiftui-ref
node native/tools/swiftui-layout-test/compare.mjs                  # macOS reference
node native/tools/swiftui-layout-test/compare.mjs --platform ios   # iOS simulator reference (~25 s)
node native/tools/swiftui-layout-test/compare.mjs 13-text -v       # one tree, all differences
```

Every tree in `../swiftui-ref/examples/*.json` and `cases/*.json` goes through the reference and
through `build/swiftui-layout` (the engine with `CoreTextMeasurer`), and every node's `frame`
and `contentFrame` must match within 0.5 pt (`--tolerance`). Exit code 1 if a tree differs.

| File | What |
|---|---|
| `build.sh` | Builds `build/swiftui-layout` (clang++, C++17, AppKit/CoreText) and swiftui-ref |
| `main.mm` | `swiftui-layout [--platform macos\|ios] < tree.json`: the engine, output in the swiftui-ref format |
| `CoreTextMeasurer.{h,mm}` | `TextMeasurer` with the text layout SwiftUI uses on macOS (see below) |
| `compare.mjs` | Runs both and compares |
| `cases/*.json` | Test trees (same input format as swiftui-ref) |

## Text measurement (observed)

- SwiftUI on macOS sizes `Text` like `NSAttributedString.boundingRect(with:options:
  .usesLineFragmentOrigin)` with `NSParagraphStyle.lineBreakStrategy = .standard` (a last line
  is not a single word when that can be avoided), rounded up to whole points. NSLayoutManager
  and CTLine bounds give other heights.
- Text styles use `NSFont.preferredFont(forTextStyle:)`. Text without a `font` modifier uses
  the plain system font (13 pt), which wraps differently from `.font(.body)`.
- A line truncated by a height limit has the width of `CTLineCreateTruncatedLine`.
- `Image(systemName:)` has the size of the `NSImage` symbol at the font's point size.

For `--platform ios`, the measurer uses the system font at the iOS point sizes and the engine takes
line heights from `ControlMetrics::ios()` (UIFont metrics). Widths still come from macOS fonts.

## Results

macOS: 37/37 trees within 0.5 pt. iOS: 28/37 within 0.5 pt, 33/37 within 1 pt. The iOS
differences:

| Trees | Difference | Why |
|---|---|---|
| 05, 07, 18, 25, 26, 29 | SF Symbol sizes 0.3-1.3 pt | iOS symbol sizes are rounded to 1/3 pt and differ from the macOS `NSImage` sizes the measurer reads |
| 10, 13 | Text proposed 13-26 pt wide: one line more | Character-level breaking of a word that does not fit differs between the macOS and iOS fonts |
| 16 | A titled Section after a footer: 22 pt | The header gap after a footer is not consistent between two observed Forms |
