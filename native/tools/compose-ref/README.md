# compose-ref

A command-line tool that lays out an `@expo/ui` Jetpack Compose tree with real
Compose (Compose Multiplatform **Desktop**, JVM) and prints the frames as JSON.
It is the ground truth for the Compose layout emulator in the host, as
[`../swiftui-ref`](../swiftui-ref) is for SwiftUI (see
[`docs/research/expo-ui.md`](../../../docs/research/expo-ui.md)).

```sh
cd native/tools/compose-ref
./fetch-fonts.sh                         # once: Roboto into fonts/ (git-ignored)
./compose-ref < examples/01-task-sample.json
./compose-ref --density 2.75 < examples/07-controls.json
```

`./compose-ref` sets `JAVA_HOME` to `/opt/homebrew/opt/openjdk@17` if it is
not set, runs `./gradlew installDist` when the build is missing or older than
the sources, then runs `build/install/compose-ref/bin/compose-ref`. The first
build downloads Gradle 9.4.1 and the dependencies (a few minutes). One run
takes about 2.7 s (JVM and Skiko start-up). Exit code 1 on bad input, with the
message on stderr.

Versions: Kotlin 2.3.21, Compose Multiplatform 1.10.3 (the desktop build of
androidx Compose 1.10, the line `@expo/ui` sdk-58 uses: foundation / ui
1.10.6), CMP material3 1.10.0-alpha05 (androidx material3 1.5.0-alpha; `@expo/ui`
uses 1.5.0-alpha17), JDK 17 toolchain.

The composition is headless: `ImageComposeScene` with the host size in px, no
window and `java.awt.headless=true`.

## Options

| Option | Default | Meaning |
|---|---|---|
| `--density N` | `1` | `Density.density`. Frames are printed in dp; with `N != 1` each node also has `framePx`. Android phones are often 2.625 or 2.75 |
| `--font-scale N` | `1` | `Density.fontScale` |
| `--fonts DIR` | `fonts/` next to `build.gradle.kts`, else `./fonts` | directory with `Roboto-*.ttf` |
| `--system-font` | off | do not load Roboto; use the macOS default font |
| `--no-touch-target` | off | `LocalMinimumInteractiveComponentSize = Dp.Unspecified`: controls without the 48 dp minimum touch target, to read their visual size |

## Input

The same shape as `swiftui-ref`, with the Compose names:

```jsonc
{
  "host": {
    "width": 390, "height": 844,              // the Host's Yoga size in dp (default 390x844)
    "matchContents": {"horizontal": false, "vertical": true},  // or true / false
    "layoutDirection": "leftToRight"          // or "rightToLeft"
  },
  "root": {
    "type": "Column",                         // @expo/ui/jetpack-compose component name
    "props": {"verticalArrangement": {"spacedBy": 8}, "horizontalAlignment": "start"},
    "modifiers": [{"$type": "paddingAll", "all": 16}],   // the modifier objects, in order
    "children": [ /* nodes */ ]
  }
}
```

Props and modifier params use the names that `@expo/ui/jetpack-compose` sends
(sdk-58, `src/jetpack-compose/**`) and that the Kotlin side reads
(`android/src/main/java/expo/modules/ui/**`). Named children use a `Slot`
node, as `@expo/ui` does: `{"type": "Slot", "props": {"name": "label"},
"children": [...]}`.

Params that are `Int` in the Kotlin records (`padding*`, `size`, `width`,
`height`, `offset`, `spacedBy`) are truncated like expo-modules-core does
(`12.7` -> `12`). `fraction`, `weight`, `defaultMinSize`, `fontSize` and
Button `contentPadding` are floats.

### Supported

| Kind | Names | Props / params |
|---|---|---|
| Containers | `Row` | `horizontalArrangement` (`start`, `end`, `center`, `spaceBetween`, `spaceAround`, `spaceEvenly`, `{spacedBy}`), `verticalAlignment` (`top`, `center`, `bottom`) |
| | `Column` | `verticalArrangement` (`top`, `bottom`, `center`, `space*`, `{spacedBy}`), `horizontalAlignment` (`start`, `center`, `end`) |
| | `Box` | `contentAlignment` (`topStart` ... `bottomEnd`) |
| | `FlowRow` | `horizontalArrangement`, `verticalArrangement` |
| | `Spacer` | |
| | `Slot` | `name` (only under `TextField`: `label`, `placeholder`, `leadingIcon`, `trailingIcon`, `prefix`, `suffix`, `supportingText`) |
| Leaves | `Text` | `text`, `typography` (M3 names), `fontSize`, `fontWeight`, `fontStyle`, `fontFamily` (`default`, `sansSerif`, `serif`, `monospace`, `cursive`), `letterSpacing`, `lineHeight`, `textAlign`, `overflow`, `softWrap`, `maxLines`, `minLines` |
| | `Button`, `FilledTonalButton`, `OutlinedButton`, `ElevatedButton`, `TextButton` | `enabled`, `contentPadding` `{start, top, end, bottom}`; children are the content (RowScope) |
| | `Switch` | `value`, `enabled` |
| | `Checkbox` | `value`, `enabled`, `nativeClickable` |
| | `Slider` | `value`, `min`, `max`, `steps`, `enabled` |
| | `TextField` | `value` (a string here; `@expo/ui` uses an `ObservableState`), `variant` (`filled`, `outlined`), `singleLine`, `maxLines`, `minLines`, `enabled`, `readOnly`, `isError`, slots |
| | `Icon` | `size`, `contentDescription` (the painter is empty; see below) |
| Modifiers | `paddingAll` `{all}`, `padding` `{start, top, end, bottom}` | |
| | `size` `{width, height}`, `width` `{width: number \| "min" \| "max"}`, `height` `{height}` | |
| | `fillMaxSize`, `fillMaxWidth`, `fillMaxHeight` `{fraction}` | default fraction 1 |
| | `defaultMinSize` `{minWidth, minHeight}` | |
| | `wrapContentWidth` `{alignment: start \| centerHorizontally \| end}`, `wrapContentHeight` `{alignment: top \| centerVertically \| bottom}` | default: centered |
| | `offset` `{x, y}` | |
| | `weight` `{weight}` | Row, Column, FlowRow and Button children only |
| | `align` `{alignment}` | Box: `topStart` ... `bottomEnd`; Row: `top`, `centerVertically`, `bottom`; Column: `start`, `centerHorizontally`, `end`. Other names are ignored, as in `@expo/ui` |
| | `matchParentSize` | Box children only |
| | `verticalScroll`, `horizontalScroll` | |
| | `border` `{borderWidth, borderColor}` | drawn, no layout effect |
| | `background`, `clip`, `testID`, `semantics`, `alpha`, `shadow`, `rotate`, `zIndex`, `clickable`, ... | accepted; no layout effect. `testID` is copied to the node |

Test-only extensions (not in `@expo/ui` sdk-58; they exist so that the C++
engine in [`../compose-layout-test`](../compose-layout-test) can be checked):
modifiers `sizeIn` `{minWidth, minHeight, maxWidth, maxHeight}`, `requiredSize`
`{width, height}`, `requiredWidth`, `requiredHeight`, `aspectRatio` `{ratio,
matchHeightConstraintsFirst}`, `wrapContentSize` `{alignment, unbounded}`, and
the Box prop `propagateMinConstraints`. An input may also have a top-level
`args` array (for example `["--no-touch-target"]`); compose-ref ignores it and
the comparison script passes it to both tools.

Other types render nothing; other modifiers are skipped. Both are listed in
`unsupported`, with the scope-dependent modifiers that `@expo/ui` ignores
(for example `weight` outside a Row or Column).

## Output

```jsonc
{
  "host": {"width": 390, "height": 176},     // matchContents axes: content size; others: input size
  "fittingSize": {"width": 390, "height": 176},  // size of the Host's content (MaybeMatchContentsLayout)
  "density": 1,
  "font": "Roboto 2.138",                     // or "system default"
  "nodes": [
    {
      "path": "0/1",                          // "0" is the root; child indexes joined by "/"
      "type": "Button",
      "frame": {"x": 16, "y": 40, "width": 66, "height": 48},  // outside the modifiers, relative to the Host, dp
      "contentFrame": {...},                  // inside the modifiers, only if different
      "framePx": {...},                       // only with --density != 1
      "text": "Go",                           // Text nodes
      "testID": "...",
      "virtual": true                         // Slot: frame = union of the children
    }
  ],
  "unsupported": {"type:Unknown": ["0/18"], "modifier:glassEffect": ["0/18", "0/19"]}
}
```

`frame` and `contentFrame` come from two `Modifier.onGloballyPositioned`
recorders: one before the node's modifiers and one after them
(`positionInRoot`, px / density, rounded to 0.001). The Compose modifier chain
is outside-in, so `frame` includes padding and keeps the layout position under
`offset`; `contentFrame` is the box the component itself gets (after padding,
at the offset position). For controls the inner recorder is before the
material3 internals, so both frames include the 48 dp touch target.

## How it works

- `Main.kt` copies `@expo/ui`'s `HostView.kt` (sdk-58): `LocalLayoutDirection`
  and `LocalContentColor`, `MaterialExpressiveTheme` with `lightColorScheme()`
  (no dynamic color on desktop), then `MaybeMatchContentsLayout`
  (children at (0, 0), content size = the largest child,
  `wrapContentWidth/Height` on the `matchContents` axes).
  `useViewportSizeMeasurement` and the seed color are not copied.
- Around it, `ComposeViewEmulation` gives the constraints that the Android
  `ComposeView` gets from React Native: fixed (min = max = host size in px,
  `round(dp * density)`) on the normal axes, `0..Infinity` on the
  `matchContents` axes. So on a normal axis the root node is always the host
  size, as on Android.
- `Builder.kt` builds each node as the `@expo/ui` Kotlin `*Content` function
  does (comments name the source file) and applies the modifiers in array
  order, like `ModifierRegistry.applyModifiers`, with the child scope
  (`UIComposableScope`) of the parent.
- The scene renders 4 frames (t = 0, 16 ms, 1 s, 5 s) and the recorded
  frames are printed.

## Observed Material 3 metrics

From `examples/07-controls.json` (density 1, Roboto, CMP 1.10.3 / material3
1.10.0-alpha05). Values in dp. "Layout" includes the 48 dp minimum touch
target (the default); "visual" is with `--no-touch-target`.

| Component | Layout | Visual | Notes |
|---|---|---|---|
| `Switch` (on, off, disabled) | 52 x 48 | 52 x 32 | `@expo/ui` always passes `onCheckedChange`, so the touch target applies |
| `Checkbox` | 48 x 48 | 24 x 24 | 20 dp box + 2 dp padding on each side |
| `Checkbox` `nativeClickable: false` | 24 x 24 | 24 x 24 | `onCheckedChange = null`: no touch target |
| `Button` "Go" | 66 x 48 | 66 x 40 | content padding 24 / 8 (start/end, top/bottom); text 18 x 16 at (24, 12) of the 40 dp box |
| `Button` "A longer button label" | 177 x 48 | 177 x 40 | 129 + 2 x 24 |
| `OutlinedButton` "Go" | 66 x 48 | 66 x 40 | same metrics as Button |
| `TextButton` "Go" | 58 x 48 | 58 x 40 | content padding 12 / 8; min width 58 wins (18 + 24 = 42) |
| `Button` `contentPadding` all 0 | 58 x 48 | 58 x 40 | min size 58 x 40 still applies; the text is centered |
| `Slider` | fill width x 48 | fill width x 44 | fills the max width; with `width(120)`: 120 x 48 |
| `TextField` (filled, outlined) | 280 x 56 | 280 x 56 | `TextFieldDefaults.MinWidth` x `MinHeight`; `fillMaxWidth` gives the full width |
| `Icon` (no size) | 24 x 24 | | empty painter: 24 dp default; with `size: 60`: 60 x 60 |
| `Text` 14 sp (`TextStyle.Default`) | height 16 | | "Body text" 59 x 16 |
| `Text` `bodyLarge` / `labelLarge` / `titleMedium` | heights 24 / 20 / 24 | | the M3 `lineHeight` values |
| `Text` `fontSize: 20` | height 23 | | |
| `Text` `headlineLarge` / `labelSmall` | heights 40 / 16 | | from `02-rows-spacers.json` |

Layout results worth knowing (from the other examples):

- `01`: a `Spacer` with `weight(1)` in a Column with unbounded height
  (`matchContents.vertical`) is 0 high.
- `03`: `width("max")` (IntrinsicSize.Max) on a Column makes it as wide as its
  widest child (127); `fillMaxWidth` children then use that width.
- `04`: a Row without weights measures children in order: the first Text takes
  its one-line width (204 of 300) and the second wraps into the rest (96 x 48).
  With `weight(1)` on both, each gets 150. `weight 2 / weight 1 / fixed` in 300
  gives 180 / 90 / 30.
- `05`: `align(centerVertically)` inside a Box is ignored (Box needs a 2-D
  alignment) and listed in `unsupported`. `matchParentSize` takes the Box size
  that the other children give.
- `08`: `horizontalScroll` keeps the Row at the viewport width (390) and the
  content is 556 wide (`contentFrame`); a FlowRow with `spacedBy` 8 / 4 wraps
  OutlinedButtons at 48 + 4 dp rows; a `weight(1)` child in a FlowRow fills the
  rest of its line.

## Desktop differences (read before comparing with Android)

- Text is laid out by Skia's paragraph engine on desktop, not by Android's
  `StaticLayout`. With Roboto the font is the same, but line heights and
  rounding can differ by 1 px. Roboto 2.138 is a static Roboto build; the
  Roboto on a given Android device can be a different version.
  The text sizes above were not checked on a device.
- Without `fonts/` (or with `--system-font`) text uses the macOS default font:
  widths differ (for example "Body text" is 59 dp with Roboto).
- `Icon` uses an empty painter. A real icon (Material Symbols vector) has an
  intrinsic size of 24 dp, which gives the same result.
- No dynamic color, no window insets, no IME. The theme is
  `MaterialExpressiveTheme(lightColorScheme())`; color has no layout effect.
- Colors, shapes, `background`, `clip` and the other non-layout modifiers are
  not drawn (only `border`, in black).

## Examples

| File | What it shows |
|---|---|
| `01-task-sample.json` | Column with `spacedBy`, padding, `defaultMinSize`, Button, Switch, Spacer, weighted Spacer; `matchContents.vertical` |
| `02-rows-spacers.json` | Weighted Spacers in Row and Column, fixed-height Spacer, bottom alignment with mixed typography, `spaceBetween`, `align(end)` |
| `03-nested-padding-size.json` | Per-edge padding, `size`, `width` + `wrapContentWidth`, `defaultMinSize`, `offset`, truncated padding, `fillMaxHeight` / `wrapContentHeight`, `width("max")`; `matchContents: true` |
| `04-weights.json` | Row without weights (wrapping Texts), equal and unequal weights, ellipsis, `spaceEvenly` in a fixed-height Column |
| `05-box-alignment.json` | Box `contentAlignment`, `align` per child, an ignored alignment, `matchParentSize`, Icon with `size` |
| `06-form.json` | Form-like Column: TextField with a label slot, outlined TextField with a placeholder slot, Switch row, Checkbox row, Slider |
| `07-controls.json` | Control sizes (see the table above); an unknown type and modifier |
| `08-flowrow-scroll.json` | `horizontalScroll` Row, FlowRow with `spacedBy` and a weighted child, `verticalScroll` Column |
