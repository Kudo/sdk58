# @expo/ui layout status

How the host lays out `@expo/ui` views, as of commit `041962f` (SwiftUI engine) and `a610f1d`
(Compose engine). Every `@expo/ui` primitive is a Fabric node `ViewManagerAdapter_ExpoUI_<View>`;
the Host (`HostView`) runs one of two layout engines over its subtree and writes the frames
(`native/README.md`, "Expo UI"):

- SwiftUI engine: `native/overlay/tester/src/expoui/layout/` (`ControlMetrics::ios()` by
  default, `macos()` with `NativeFantom.setExpoUIPlatform('macos')`). Used for a Host whose subtree
  has only SwiftUI names or names both platforms use. Capability `expoUI.swiftUILayout`.
- Compose engine: `native/overlay/tester/src/expoui/compose/` (Material 3 metrics, density = the
  Host's `pointScaleFactor`). Used for any other Host. Capability `expoUI.composeLayout`.

View names come from `native/tools/expo-view-configs/out/viewConfigs.json` (152 names: 69
SwiftUI, 93 Compose, 10 on both).

## Status values

| Status | Meaning |
|---|---|
| engine | The engine lays the view out with metrics measured against the real toolkit (`native/tools/swiftui-ref`, `native/tools/compose-ref`) |
| approximate | Laid out with a fallback size (given in the table) |
| passthrough | No layout of its own: the frame is the union of its children's frames (or an empty frame at the parent's origin) |
| unsupported | The engine reports `type:<Name>` in `unsupported` and gives the view no frame; the host writes the union of its children's frames, or an empty frame at the parent's origin |

## Views laid out

"—" = the name does not exist on that platform.

| View | SwiftUI | Compose |
|---|---|---|
| `BoxView` | — | engine |
| `Button` | engine | engine |
| `CheckboxView` | — | engine |
| `ColumnView` | — | engine |
| `DividerView` | engine | — |
| `ElevatedButton` | — | engine |
| `FilledTonalButton` | — | engine |
| `FlowRowView` | — | engine |
| `FormView` | engine (fitted row metrics) | — |
| `GroupView` | passthrough | — |
| `HostView` | engine | engine |
| `HStackView` | engine | — |
| `IconView` | — | approximate (24 dp, no painter size) |
| `ImageView` | engine (`systemName`); approximate off-table symbols; unsupported other sources | unsupported |
| `LabelView` | engine | — |
| `ListView` | engine (fitted row metrics) | — |
| `OutlinedButton` | — | engine |
| `PickerView` | engine (options: no frame) | — |
| `RNHostView` | engine (Yoga-measured leaf) | engine (Yoga-measured leaf) |
| `RowView` | — | engine |
| `ScrollViewComponent` | engine | — |
| `SectionView` | passthrough (header/footer/rows laid out by List/Form) | — |
| `SecureFieldView` | engine | — |
| `SliderView` | engine | engine |
| `SlotView` | passthrough | passthrough |
| `SpacerView` | engine | engine |
| `SwitchView` | — | engine |
| `TextButton` | — | engine |
| `TextFieldView` | engine | engine (label, placeholder) |
| `TextView` | engine | engine |
| `ToggleView` | engine | — |
| `VStackView` | engine | — |
| `ZStackView` | engine | — |

Unsupported SwiftUI views (47): `AccessoryWidgetBackgroundView`, `AlertView`, `BackgroundView`, `BottomSheetView`, `CapsuleView`, `ChartView`, `CircleView`, `ColorPickerView`, `ConcentricRectangleView`, `ConfirmationDialogView`, `ContentUnavailableView`, `ContextMenu`, `ControlGroupView`, `DataListForEachItemView`, `DataListForEachPoolView`, `DataListForEachView`, `DatePickerView`, `DisclosureGroupView`, `EllipseView`, `GaugeView`, `GlassEffectContainerView`, `GridRowView`, `GridView`, `LabeledContentView`, `LazyHStackView`, `LazyVStackView`, `LinkView`, `ListForEachView`, `MaskView`, `MenuView`, `NamespaceView`, `NavigationLinkView`, `NavigationSplitViewView`, `NavigationStackView`, `OverlayView`, `PopoverView`, `ProgressView`, `RectangleView`, `RoundedRectangleView`, `ShareLinkView`, `StepperView`, `SwipeActionsView`, `SyncToggleView`, `Tab`, `TabView`, `ToolbarView`, `UnevenRoundedRectangleView`.

Unsupported Compose views (74): `AlertDialogView`, `AnimatedVisibilityView`, `AssistChipView`, `BadgedBoxView`, `BadgeView`, `BasicAlertDialogView`, `BasicTextFieldView`, `CardView`, `CircularProgressIndicatorView`, `CircularWavyProgressIndicatorView`, `ContainedLoadingIndicatorView`, `DatePickerDialogView`, `DateRangePickerDialogView`, `DateRangePickerView`, `DateTimePickerView`, `DockedSearchBarView`, `DropdownMenuItemView`, `DropdownMenuView`, `ElevatedCardView`, `ExposedDropdownMenuBoxView`, `ExposedDropdownMenuView`, `FilledIconButton`, `FilledIconToggleButton`, `FilledTonalIconButton`, `FilterChipView`, `FloatingActionButtonView`, `HorizontalCenteredHeroCarouselView`, `HorizontalDividerView`, `HorizontalFloatingToolbarView`, `HorizontalMultiBrowseCarouselView`, `HorizontalPagerView`, `HorizontalUncontainedCarouselView`, `IconButton`, `IconToggleButton`, `ImageView`, `InnerTextFieldView`, `InputChipView`, `LazyColumnView`, `LazyItemsPoolView`, `LazyItemsSlotView`, `LazyItemsView`, `LazyRowView`, `LinearProgressIndicatorView`, `LinearWavyProgressIndicatorView`, `ListItemView`, `LoadingIndicatorView`, `MaskView`, `ModalBottomSheetView`, `MultiChoiceSegmentedButtonRowView`, `NavigationBarItemView`, `NavigationBarView`, `OutlinedCardView`, `OutlinedIconButton`, `OutlinedIconToggleButton`, `PlaceholderView`, `PlainTooltipView`, `PullToRefreshBoxView`, `RadioButtonView`, `RichTooltipView`, `SearchBarView`, `SegmentedButtonView`, `ShapeView`, `SingleChoiceSegmentedButtonRowView`, `SnackbarHostView`, `SnackbarView`, `SuggestionChipView`, `SurfaceView`, `SyncSwitchView`, `TimePickerDialogView`, `ToggleButton`, `TooltipBoxView`, `TriStateCheckboxView`, `VerticalDividerView`, `VerticalSliderView`.

Notes:

- SwiftUI `ImageView`: `systemName` only. On iOS, 108 SF Symbol names have measured sizes
  (`expoui/layout/Symbols.cpp`, exact at every text style size, up to 2/3 pt off between them).
  Other names: the measurer's size (host: 17 measured names scaled by point size, else 1.2 x 1.1
  times the point size; macOS tests: the `NSImage` symbol size). `uiImage` / `assetName` images
  are unsupported (no frame).
- SwiftUI `PickerView`: menu and segmented styles; the options are drawn by the platform control
  and have no frame.
- SwiftUI `ListView` / `FormView`: row boxes, section and header/footer offsets are fitted to the
  reference (iOS: inset grouped, 52 pt minimum rows; macOS: grouped Form, default List).
- A Host with only shared names (for example a single `TextView`) goes to the SwiftUI engine.

## Modifiers

SwiftUI (`@expo/ui/swift-ui/modifiers`, 152 types):

| Effect | Modifiers |
|---|---|
| Layout | `padding` (all/edges/`"default"`), `frame` (fixed; min/ideal/max; alignment), `fixedSize`, `layoutPriority`, `offset` (drawn position only), `alignmentGuide` (leading/center/trailing in a VStack) |
| Environment | `font` (text styles, size, weight, design, family), `lineLimit` (n, `reservesSpace`, min...max), `truncationMode`, `buttonStyle`, `toggleStyle`, `pickerStyle`, `tag` |
| No layout effect | `background`, `cornerRadius`, `hidden` (keeps its space), `multilineTextAlignment`, `accessibilityLabel` |
| Everything else | reported as `modifier:<type>` in `unsupported` and ignored |

Compose (`@expo/ui/jetpack-compose/modifiers`, 43 types):

| Effect | Modifiers |
|---|---|
| Layout | `padding`, `paddingAll`, `size`, `width`, `height`, `sizeIn`, `requiredSize` / `requiredWidth` / `requiredHeight`, `fillMaxSize` / `fillMaxWidth` / `fillMaxHeight` (fraction), `wrapContentSize` / `wrapContentWidth` / `wrapContentHeight`, `defaultMinSize`, `offset`, `weight`, `align`, `matchParentSize`, `aspectRatio`, `border`, `verticalScroll`, `horizontalScroll` |
| No layout effect | `background`, `shadow`, `dropShadow`, `innerShadow`, `alpha`, `blur`, `cornerRadius`, `rotate`, `graphicsLayer`, `zIndex`, `animateContentSize`, `testID`, `semantics`, `clip`, `maskClip`, `onVisibilityChanged`, `onSizeChanged`, `onGloballyPositioned`, `clickable`, `combinedClickable`, `selectable`, `selectableGroup`, `toggleable`, `menuAnchor`, `imePadding` |
| Everything else | reported in `unsupported` and ignored |

## Test results

| Engine | Reference | Trees | Result |
|---|---|---|---|
| SwiftUI, `macos()` | swiftui-ref (SwiftUI on macOS 26.5) | 43 | 42 within 0.5 pt |
| SwiftUI, `ios()` | swiftui-ref on the iOS 26.5 simulator (scale 3) | 43 | 41 within 0.5 pt |
| Compose | compose-ref (Compose Desktop, CMP 1.10.3, material3 1.10.0-alpha05) | 28 | 28 exact (0 px) at densities 1, 2.75, 2.625, 3.5 |

Commands: `native/tools/swiftui-layout-test/build.sh && node native/tools/swiftui-layout-test/compare.mjs [--platform ios]`;
`cd native/tools/compose-layout-test && ./build.sh && node compare.mjs`. Host test:
`yarn fantom FantomExpoUI` (see `native/README.md`); e2e: `e2e/expo-ui.test.ts`.

## Known deviations

| Deviation | Where | Size | Cause |
|---|---|---|---|
| Label with a symbol taller than its text | SwiftUI, macOS (case 41) | 0.84 pt | macOS aligns the icon on the text's cap height; the engine uses the taller of icon and text |
| Text proposed 13-26 pt wide wraps to one more line | SwiftUI, iOS (cases 10, 13) | one line | Character-level breaking of a word that does not fit uses macOS fonts (tests and host measure iOS text with macOS fonts) |
| Italic text at weight 500 or more | Compose | 1-2 px narrower at 14 sp | Only Roboto Regular, Medium, Bold and Italic are embedded; MediumItalic / BoldItalic fall back to Italic |
| TextField slots | Compose | not laid out | Only `label` and `placeholder` are modeled; leading/trailing icons, prefix, suffix, supporting text, focused state, `textFieldMinSize` are not |
| Icon painters | Compose | 24 dp | The size of a real painter (its intrinsic size) is not known; every Icon is 24 x 24 dp |
| Body text height with macOS metrics in the host | SwiftUI, `setExpoUIPlatform('macos')` | 16.667 vs 16 | The host measures with the React Native TextLayoutManager at the Host's scale (3), which rounds up to 1/3 pt; SwiftUI on macOS rounds up to whole points |
| Letter spacing in the host | both | small | The host TextLayoutManager applies letter spacing as `NSKernAttributeName` (kerning off); the test measurers use tracking |
| Symbols not in the iOS table | SwiftUI, host | varies | 1.2 x 1.1 times the point size |
| List/Form rows below the viewport | SwiftUI, iOS reference | n/a | iOS lays them out lazily; reference frames there are estimates, so test trees keep rows on screen |

## Adding a component

1. Engine: map the view in `buildContent` (`expoui/layout/Layout.cpp`) or the Compose node
   builder (`expoui/compose/ComposeLayout.cpp`), with its sizes in `ControlMetrics`
   (`Layout.h` / `ComposeLayout.h`). Props and modifier params use the `@expo/ui` names (see
   `viewConfigs.json` and `packages/expo-ui/ios/*.swift` / `android/.../*.kt` at sdk-58).
2. Host: add the view name to the name table in `components/FantomExpo.cpp` (`engineType` for
   SwiftUI, `composeEngineType` for Compose, and `swiftUIViewNames` for a SwiftUI-only name).
3. Reference: add the component to the harness builder (`native/tools/swiftui-ref/Sources/swiftui-ref/Builder.swift`,
   mirroring the `@expo/ui` Swift view; `native/tools/compose-ref/src/main/kotlin/Builder.kt`).
4. Cases: add trees under `native/tools/swiftui-layout-test/cases/` or
   `native/tools/compose-layout-test/cases/` and run `compare.mjs` (for SwiftUI also
   `--platform ios`).
5. Host test: extend `native/tests/FantomExpoUI-itest.js` with frames from the engine, then
   `yarn build:host` and `yarn check`.

## Re-measuring iOS metrics

```sh
native/tools/swiftui-ref/scripts/run-ios.sh out.json native/tools/swiftui-layout-test/cases/*.json
SWIFTUI_REF_SYMBOLS=star,heart,gear native/tools/swiftui-ref/scripts/run-ios.sh out.json any-tree.json
```

`run-ios.sh` builds the harness as a simulator app, installs it on a dedicated simulator named
`swiftui-ref` (created on first use from `$SWIFTUI_REF_DEVICE_TYPE`, default iPhone 17 Pro, newest
iOS runtime) and lays out every input in one launch. `out.json` maps each input path to its frames,
plus `_device` (screen scale, iOS version, `UIFont.preferredFont` metrics per text style) and, with
`SWIFTUI_REF_SYMBOLS`, `_symbols` (UIImage sizes at 11-100 pt, regular and semibold). The iOS values
live in `ControlMetrics::ios()` (`expoui/layout/Layout.cpp`) and `expoui/layout/Symbols.cpp`;
after a change run `node native/tools/swiftui-layout-test/compare.mjs --platform ios`.
