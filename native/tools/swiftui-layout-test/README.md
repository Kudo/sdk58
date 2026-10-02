# swiftui-layout-test

Tests the C++ SwiftUI layout engine
([`native/overlay/tester/src/expoui/layout/`](../../overlay/tester/src/expoui/layout/)) against
real SwiftUI ([`swiftui-ref`](../swiftui-ref/)).

```sh
native/tools/swiftui-layout-test/build.sh                          # engine CLI + swiftui-ref
bun native/tools/swiftui-layout-test/compare.ts                  # macOS reference
bun native/tools/swiftui-layout-test/compare.ts --platform ios   # iOS simulator reference (~25 s)
bun native/tools/swiftui-layout-test/compare.ts 13-text -v       # one tree, all differences
```

Every tree in `../swiftui-ref/examples/*.json` and `cases/*.json` goes through the reference and
through `build/swiftui-layout` (the engine with `CoreTextMeasurer`), and every node's `frame`
and `contentFrame` must match within 0.5 pt (`--tolerance`). Exit code 1 if a tree differs.

| File | What |
|---|---|
| `build.sh` | Builds `build/swiftui-layout` (clang++, C++17, AppKit/CoreText) and swiftui-ref |
| `main.mm` | `swiftui-layout [--platform macos\|ios] < tree.json`: the engine, output in the swiftui-ref format |
| `CoreTextMeasurer.{h,mm}` | `TextMeasurer` with the text layout SwiftUI uses on macOS (see below) |
| `compare.ts` | Runs both and compares |
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

| Platform | Trees | Within 0.5 pt | Within 1 pt |
|---|---|---|---|
| macOS (swiftui-ref) | 43 | 42 | 43 |
| iOS 26.5 simulator (`--platform ios`) | 43 | 41 | 41 |

macOS results were rechecked at `88ddd44` on macOS 26.5.2, Xcode 26.6,
SDK 26.5 (arm64), without a simulator. The 0.5 pt run exits 1; all cases
pass at 1 pt. These desktop results do not revalidate the historical iOS row.

The remaining differences:

| Tree | Platform | Difference | Why |
|---|---|---|---|
| 41 | macOS | a Label with a symbol taller than its `largeTitle` text: 0.84 pt taller | macOS aligns the symbol on the text's cap height; the engine takes the taller of the two |
| 10, 13 | iOS | Text proposed 13-26 pt wide: one line more | Character-level breaking of a word that does not fit differs between the macOS and iOS fonts (the test measures iOS text with macOS fonts) |

## SF Symbols on iOS

`ControlMetrics::ios()` takes symbol sizes from `Symbols.cpp` (108 names: the symbols used in the
`@expo/ui` docs and examples plus common ones), generated from `UIImage(systemName:)` sizes on the
simulator, which equal SwiftUI's `Image(systemName:)` frames. To add names:

```sh
SWIFTUI_REF_SYMBOLS=star,heart,... native/tools/swiftui-ref/scripts/run-ios.sh out.json any-tree.json
```

`out.json` then has `_symbols`: `{name: {"<pt> regular" | "<pt> semibold": [w, h]}}` at 11, 12,
13, 15, 16, 17, 20, 22, 28, 34, 48, 64 and 100 pt; `Symbols.cpp` stores them in pixels at scale 3.

## Notes

- List and Form rows outside the viewport are laid out lazily on iOS; their reference frames are
  estimates. Trees keep all rows on screen (case 16 uses a 1100 pt tall host).
