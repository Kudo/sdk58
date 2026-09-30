# swiftui-ref

A macOS command-line tool that lays out an `@expo/ui`-style SwiftUI tree with
real SwiftUI and prints the frames as JSON. It is the ground truth for the
SwiftUI layout emulator in the host (see
[`docs/research/expo-ui.md`](../../../docs/research/expo-ui.md)).

```sh
cd native/tools/swiftui-ref
swift build -c release                      # macOS 13.4+, Xcode 15+ (Swift 5.9)
.build/release/swiftui-ref < examples/01-task-sample.json
```

One run takes about 0.5 s. Exit code 1 on bad input, with the message on
stderr.

## Input

```jsonc
{
  "host": {
    "width": 390, "height": 844,              // the Host's Yoga size (default 390x844)
    "matchContents": {"horizontal": false, "vertical": true},  // or true / false
    "layoutDirection": "leftToRight"          // or "rightToLeft"
  },
  "root": {
    "type": "VStack",                         // @expo/ui component name
    "props": {"spacing": 8, "alignment": "leading"},
    "modifiers": [{"$type": "padding", "all": 16}],   // the @expo/ui modifier objects, in order
    "children": [ /* nodes */ ]
  }
}
```

Props and modifier params use the `@expo/ui` names (sdk-58,
`packages/expo-ui/src/swift-ui/**`, `ios/**`). JSON has no `Infinity`: use
`"infinity"` (or any number >= 1e9) where JS would pass `Infinity`, for
example `{"$type": "frame", "maxWidth": "infinity"}`.

Named children use a `Slot` node, as `@expo/ui` does:
`{"type": "Slot", "props": {"name": "header"}, "children": [...]}` (Section
`header` / `footer` / `content`, Picker `content`).

### Supported

| Kind | Names | Props / params |
|---|---|---|
| Containers | `VStack`, `HStack` | `alignment`, `spacing` |
| | `ZStack` | `alignment` (AlignmentOptions names) |
| | `Spacer` | `minLength` |
| | `Group`, `Slot` | |
| | `ScrollView` | `axes` (`vertical`, `horizontal`, `both`), `showsIndicators` |
| | `List`, `Form` | children are rows |
| | `Section` | `title`, or `header` / `content` / `footer` slots |
| Leaves | `Text` | `text` |
| | `Button` | `label`, `systemImage`, `role`, or children as the label |
| | `Toggle` | `isOn`, `label`, `systemImage`, or children as the label |
| | `Slider` | `value`, `min`, `max`, `step` |
| | `Picker` | `label`, `selection`; options are children with a `tag` modifier |
| | `TextField`, `SecureField` | `placeholder`, `text` (a string here; `@expo/ui` uses an `ObservableState`) |
| | `Image` | `systemName` |
| | `Divider` | |
| | `Label` | `title`, `systemImage` |
| Modifiers | `padding` | `all`, `horizontal`, `vertical`, `top`, `leading`, `bottom`, `trailing` (number or `"default"`); no params = `.padding()` |
| | `frame` | `width`, `height`, `minWidth`, `idealWidth`, `maxWidth`, `minHeight`, `idealHeight`, `maxHeight`, `alignment`. Like `@expo/ui`, the flexible values are ignored if `width` or `height` is set |
| | `fixedSize` | `horizontal`, `vertical`; no params = both |
| | `layoutPriority` | `priority` |
| | `offset` | `x`, `y` |
| | `background` | `style: {type: "color", color}` (what `resolveShapeStyle` sends) or a color string; hex or `@expo/ui` color names |
| | `cornerRadius` | `radius` |
| | `hidden` | `hidden` (default `true`) |
| | `font` | `textStyle`, `size`, `weight`, `design`, `family` |
| | `accessibilityLabel` | `label` |
| | `toggleStyle`, `buttonStyle`, `pickerStyle` (`segmented`, `menu`, `inline`), `tag` | `style` / `tag` |

Other types render as `EmptyView`; other modifiers are skipped. Both are
listed in `unsupported` in the output.

## Output

```jsonc
{
  "host": {"width": 390, "height": 128},     // matchContents axes: content size; others: input size
  "fittingSize": {"width": 132, "height": 128},  // NSHostingView.fittingSize
  "nodes": [
    {
      "path": "0/1",                          // "0" is the root; child indexes joined by "/"
      "type": "Text",
      "frame": {"x": 16, "y": 16, "width": 100, "height": 16},  // after the modifiers, relative to the Host
      "contentFrame": {...},                  // before the modifiers, only if different
      "text": "Hello",
      "accessibilityLabel": "...",
      "virtual": true,                        // Group / Slot / Section: frame = union of the children
      "platformRendered": true                // Picker options: drawn by AppKit, frame is null
    }
  ],
  "unsupported": {"type:Unknown": ["0/15"], "modifier:glassEffect": ["0/15"]}
}
```

## How it works

- `main.swift` copies the body of `@expo/ui`'s `HostView` (sdk-58
  `packages/expo-ui/ios/HostView.swift`): a top-leading `ZStack`, `fixedSize`
  on the `matchContents` axes, then the fill / pin frame.
  `useViewportSizeMeasurement`, color scheme and seed color are not copied.
- `Builder.swift` builds each node the way the `@expo/ui` Swift view does
  (comments name the source file) and applies the modifiers in array order,
  like `applyModifiers`.
- Every node gets a `GeometryReader` background before and after its
  modifiers. The reader writes its `.global` frame into a store while SwiftUI
  lays it out. A side effect is used instead of a preference key because List
  and Form rows live in NSTableView cells, and preferences do not leave them.
- The tree is put in an `NSHostingView` of the host size, in a borderless
  window at (-10000, -10000). The window is ordered front (List and Form rows
  are laid out only in a window on screen). The app has
  `activationPolicy = .prohibited`, so no Dock icon appears. The run loop runs
  5 x 20 ms, with `layoutSubtreeIfNeeded` between the runs.

## macOS differences (read before comparing with iOS)

This is SwiftUI on **macOS**. Controls, fonts and system styles are the macOS
ones. The emulator must substitute iOS values.

Observed on macOS 26.5.2 (Xcode 26.6), from `examples/07-controls.json`
(frames in points):

| Control | Observed on macOS | Notes |
|---|---|---|
| `Toggle` with no label, `.switch` style (default here) | 54 x 24 | macOS default is a checkbox, so the tool applies `.switch` unless a `toggleStyle` modifier is given |
| `Toggle` with no label, `toggleStyle('automatic')` | 16 x 16 | checkbox |
| `Toggle` label "Wifi", `.switch` | 86 x 24 | |
| `Button` "Go" (automatic and `borderedProminent`) | 42 x 24 | |
| `Button` "Go", `borderless` | 18 x 16 | |
| `Slider` | full proposed width x 16 | with `fixedSize()` the width is 0 |
| `Picker` segmented, 3 options, label "Size" | 133 x 24 | |
| `Picker` menu, label "Size" | 131 x 24 | |
| `TextField` | full proposed width x 24 | |
| `Divider` in a VStack | full width x 1 | |
| `Image(systemName: "heart")` | 17 x 14 | |
| `Text` body, one line | height 16 | macOS body font is 13 pt |
| `Text` `largeTitle` / `caption` | heights 31 / 13 | |

For iOS the task gives the switch size as 51 x 31 (Apple HIG). This was not
checked here. The other iOS control sizes still have to be measured on a
simulator.

Other differences:

- Form: the macOS default form style is `.columns`; the tool applies
  `.formStyle(.grouped)`, which is closer to an iOS Form. Row heights and
  insets are still the macOS ones.
- List and Form rows are NSTableView rows. Section is not a view: its
  modifiers go to each row, so its frame is the union of its rows.
- Picker options are AppKit segments or menu items, not SwiftUI views.
- `offset`: `frame` (recorded after the modifier) keeps the layout position;
  `contentFrame` shows the offset position.
- `hidden`: the view keeps its space.
- `Slot` nodes under `Section` and `Picker` are not in `nodes`; their
  children are, with the slot's index in their path.

## Examples

| File | What it shows |
|---|---|
| `01-task-sample.json` | VStack with padding, frame(minWidth), Button, Toggle, Spacer; `matchContents.vertical` |
| `02-stacks-spacers.json` | Spacers in HStack/VStack, `minLength`, bottom alignment with mixed fonts |
| `03-nested-padding-frame.json` | Padding per edge and `"default"`, fixed / flexible / ideal frames, `fixedSize`, `offset`, `hidden`, background, cornerRadius, accessibilityLabel; `matchContents: true` |
| `04-layout-priority.json` | Two wrapping Texts in an HStack, with and without `layoutPriority` |
| `05-zstack-alignment.json` | ZStack alignments, SF Symbol with a font size |
| `06-form-section.json` | Form with a titled Section and a Section with header / footer slots |
| `07-controls.json` | Control sizes (see the table above); an unknown type and modifier |
| `08-list-scrollview.json` | Horizontal ScrollView, List with a Section |
