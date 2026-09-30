# compose-layout-test

Checks the C++ Jetpack Compose layout engine
([`native/overlay/tester/src/expoui/compose/`](../../overlay/tester/src/expoui/compose))
against [`compose-ref`](../compose-ref) (real Compose Desktop).

```sh
cd native/tools/compose-layout-test
./build.sh                        # build/compose-layout (clang++, the engine + a CoreText measurer)
node compare.mjs                  # every tree at density 1 and 2.75, tolerance 1 px
node compare.mjs --tolerance 0 --densities 1,2.75,2.625,3.5 -v 17-rtl
```

`build/compose-layout` has compose-ref's interface (`--density`,
`--font-scale`, `--no-touch-target`, `--fonts DIR`; JSON on stdin, the same
output JSON), plus `--shared-measurer` (see Text below). It links the SwiftUI
engine's `layout/Layout.cpp` for the shared types. `compare.mjs` runs both tools on
`../compose-ref/examples/*.json` and `cases/*.json`, compares `host`, every
node's `frame` and `contentFrame` in px, the node set and the `unsupported`
keys. compose-ref takes about 2.7 s per run, so its results are cached in
`build/ref-cache` (keyed by the input, the arguments and the compose-ref jar).
A case can have a top-level `args` array, passed to both tools.

## Engine

API (shared with the SwiftUI engine, `../../overlay/tester/src/expoui/layout/Layout.h`,
so one host adapter feeds both):

```cpp
layout::LayoutResult compose::layout(const layout::HostSpec& host, const layout::Node& root,
                                     layout::TextMeasurer& measurer, const compose::ControlMetrics& metrics);
```

`Node`, `HostSpec`, `Value`, `TextMeasurer`, `LayoutResult` are the `layout::`
types; frames are dp (px / density). `compose::ControlMetrics` holds `density`,
`fontScale`, `touchTarget` and the Material 3 sizes. Text: the engine calls
`measureText(text, FontSpec, maxWidth, maxLines)` for widths and line counts
(FontSpec: family `Roboto`, `pointSize` = px size, named weight) and
`lineHeight(FontSpec)` for ascent + descent, and computes paragraph heights
itself. FontSpec has no italic or letter spacing, so a measurer can also
implement `compose::ComposeTextMeasurer` (found with `dynamic_cast`); without
it, letter spacing is added to single-line widths by the engine and ignored for
line breaks. `node compare.mjs --shared-measurer` runs that fallback: 54/56
(only `18-text-wrapping`, a paragraph with 2 sp letter spacing, breaks
differently).

`ComposeLayout.h/.cpp` (STL only) copies Compose's measure / layout protocol in
integer px:

- `Constraints` with `offset` / `constrain`, `roundToPx` (`Math.round(dp *
  density)`), Kotlin `Double.toInt()` truncation of the `Int` record fields.
- A node is a chain of layout modifiers around a measure policy. Each modifier
  measures the next with its constraints and places it: `PaddingNode`,
  `SizeNode` (size, width, height, sizeIn, required*), `FillNode`,
  `WrapContentNode`, `UnspecifiedConstraintsNode` (defaultMinSize), `OffsetNode`,
  `IntrinsicWidthNode` (`width("min" | "max")`), `ScrollNode`, `AspectRatioNode`,
  material3 `minimumInteractiveComponentSize` and `textFieldLabelMinHeight`.
- The apparent-to-real offset: a child that reports a size outside its
  constraints is centered (requiredSize, touch targets).
- Policies: Row / Column (`RowColumnMeasurePolicy`: weights in a second pass
  with the rounding remainder, `fill`, spacing, arrangements, cross alignment),
  Box (`propagateMinConstraints`, `matchParentSize`, per-child `align`), FlowRow
  (`breakDownItems`, each line measured like a Row), Spacer, Text, and the material3
  controls built from these parts (Button = touch target + Box(propagateMin) +
  Row(defaultMinSize(58, 40).padding(24, 8)); Switch, Checkbox, Slider, Icon;
  TextField / OutlinedTextField port `TextFieldMeasurePolicy` for the label,
  placeholder and input).
- Intrinsics: Row / Column `intrinsicMainAxisSize` / `intrinsicCrossAxisSize`,
  Text, Box, and the default LayoutModifier intrinsics (measure with a child of
  intrinsic size).
- Parent data: the outermost `weight` / `align` wins; for Box, the outermost of
  `align` and `matchParentSize` replaces the other (as `BoxChildDataNode`).
- `ControlMetrics` holds the Material 3 sizes; `TextMeasurer` is the text
  interface; `materialTypography` has the CMP material3 1.10 type scale.

`RobotoTextMeasurer.mm` is the test measurer (both interfaces): CoreText with
the Roboto files from `compose-ref/fonts` (registered with
`CTFontManagerRegisterFontsForURL`). Observed rules, in the engine, that make
it equal to Skia: line height `round(ascent + descent)` per line; with a `lineHeight` and `LineHeightStyle.Trim.Both` (the
`TextStyle.Default`): `(lines - 1) * lineHeight + ascent + descent`; with the
Material typography (Trim.None): `lines * lineHeight`. In the measurer: letter
spacing as `kCTTrackingAttributeName` (`kCTKernAttributeName = 0` would turn off the
font's kerning).

## Results

28 trees (8 compose-ref examples + 20 cases), all equal to compose-ref with
**tolerance 0 px** at densities 1, 2.75, 2.625 and 3.5.

| Tree | What it covers |
|---|---|
| `01`-`08` | the compose-ref examples |
| `09-weights-spacing` | weights with `spacedBy`, weight remainder, fractional weights, weighted Column |
| `10-nested-box-alignment` | 9 `align` values, nested Boxes, `contentAlignment` vs `align` |
| `11-flowrow-wrap` | wrapping, `spacedBy`, `spaceBetween` / `center` with `fillMaxWidth`, mixed heights, `align(bottom)` |
| `12-fill-in-weighted-row` | `fillMaxWidth(fraction)` / `fillMaxHeight` in weighted children, fill before a weight |
| `13-padding-size-order` | padding then size vs size then padding, offset order, double padding, size vs size |
| `14-scroll` | vertical / horizontal scroll, Slider and weights in an unbounded Row, fillMaxHeight in a scroll |
| `15-unbounded-weight` | weighted Spacer and Text in a Column with unbounded height (0 high) |
| `16-arrangements` | all six arrangements in Row and Column, single-child spaceBetween / spaceAround |
| `17-rtl` | `rightToLeft`: arrangements, `spacedBy`, padding, offset, wrapContent, Box, scroll, FlowRow, Button, Checkbox |
| `18-text-wrapping` | wrapping, maxLines, minLines, softWrap, lineHeight (Trim.Both), letterSpacing, hyphens, typography, `\n` |
| `19-size-constraints` | size larger than the parent, requiredSize (centered), sizeIn, defaultMinSize under fixed constraints, wrapContentSize unbounded, aspectRatio |
| `20-button-content` | Icon + Spacer + Text in a Button, weights inside, custom contentPadding, wrapping TextButton |
| `21-controls-no-touch` | `07-controls` with `--no-touch-target` |
| `22-intrinsics` | `width("min")` / `width("max")` with texts, buttons, weights, padding, Switch |
| `23-box-matchparent-propagate` | `propagateMinConstraints`, `matchParentSize`, align / matchParentSize order |
| `24-textfield` | filled and outlined, floating label, placeholder, long value, weighted |
| `25-density-rounding` | weight remainders, truncated Int params, center / spaceEvenly rounding, odd host width |
| `26-matchcontents-both` | `matchContents: true` with weights and fills (unbounded) |
| `27` / `28-flowrow-arrangement(-rtl)` | FlowRow `center` / `end` / `spacedBy` / `spaceAround` lines, LTR and RTL |

## Not matched / not modeled

The ported code follows the CMP 1.10.3 foundation-layout and material3
1.10.0-alpha05 sources (Maven `-sources.jar`): `RowColumnMeasurePolicy`,
`Arrangement` (`spacedBy` = `SpacedAligned` with `Alignment.Start`),
`FlowLayout.breakDownItems` / `placeHelper` (main-axis spacing is
`ceil(spacing.toPx())`, lines are measured with the running
`mainAxisTotalSize` as their min width), `TextFieldMeasurePolicy`,
`OutlinedTextFieldMeasurePolicy`, `TypeScaleTokens` (bodyMedium and
titleMedium tracking 0.2 sp). The text line-height rules are observed, not
from source.

Not modeled (the engine reports them in `unsupported` or ignores them):

- TextField slots other than `label` and `placeholder` (leading / trailing
  icons, prefix, suffix, supporting text), the focused state, `textFieldMinSize`
  (min width of 10 "H"), `isError` text.
- FlowRow `maxItemsInEachRow` / overflow (not in `@expo/ui`), and exact FlowRow
  intrinsics (approximated as a Row; the min width is the widest child).
- Icon with a real painter (the size comes from the painter's intrinsic size;
  compose-ref and the engine use a painter with no size, so 24 dp).
- Baseline alignment, `alignBy` (not in `@expo/ui`).
- Text: `TextMeasurer` is the only platform part. CoreText and Skia agree on
  Roboto Latin text here; other scripts, emoji and fallback fonts were not
  tested. Line breaks use CoreText's (`CTTypesetterSuggestLineBreak`); Skia uses
  ICU. On Android, `StaticLayout` can round line heights differently from Skia
  (see compose-ref's README).
- `animateContentSize`, `graphicsLayer` and other non-layout modifiers are
  ignored (they do not change the layout at rest).
