# @expo/ui and expo-modules-core in the Fantom host

Research notes for supporting `@expo/ui` (SwiftUI on iOS, Jetpack Compose on
Android) in the headless host. Source: the Expo monorepo at `origin/sdk-58`
(`cfbcecdb68`), checked out in `/tmp/expo-sdk58`. Paths are relative to that
checkout unless stated otherwise. Versions: `@expo/ui` 58.0.8,
`expo-modules-jsi` 58.0.4.

Statements marked **(estimate)** or **(to verify)** are not observed facts.

## 0. Summary of the architecture

- Every `@expo/ui` primitive is a React host component, made with
  `requireNativeView('ExpoUI', '<ViewName>')`. React renders the tree
  `<Host><VStack><Text/></VStack></Host>` as nested Fabric nodes. Nothing is
  serialized into one description.
- The Fabric component name is `ViewManagerAdapter_ExpoUI_<ViewName>`. All of
  them use one C++ descriptor class (`expo::ExpoViewComponentDescriptor`) with
  a per-name "flavor". Props are stored untyped in
  `ExpoViewProps::propsMap` (`folly::dynamic`).
- Only `Host` is a real platform view (a `UIHostingController` / `ComposeView`).
  The other nodes are "virtual": the platform mounting layer collects them as
  children of the SwiftUI / Compose tree under `Host`. SwiftUI or Compose does
  the layout. The Yoga frames of the nested nodes are not the drawn frames.
- `Host` reports a size back to Yoga only with `matchContents`, through the
  shadow node state (`setStyleSize`).
- Modifiers are a JS array of plain objects `{$type, ...params}` in the
  `modifiers` prop. Callbacks stay in JS; native sends one `onGlobalEvent`
  event and JS dispatches it by `$type`.

## 1. JS surface

### Entry points (`packages/expo-ui/package.json` `exports`)

| Entry | Source | Notes |
|---|---|---|
| `@expo/ui` | `src/universal/index.ts` | Universal components; `.ios.tsx` uses swift-ui, `.android.tsx` uses jetpack-compose, `.tsx` is a web implementation |
| `@expo/ui/swift-ui` | `src/swift-ui/index.tsx` | 60 `export` lines |
| `@expo/ui/swift-ui/modifiers` | `src/swift-ui/modifiers/index.ts` (1959 lines) | |
| `@expo/ui/jetpack-compose` | `src/jetpack-compose/index.ts` | 52 `export` lines |
| `@expo/ui/jetpack-compose/modifiers` | `src/jetpack-compose/modifiers/index.ts` (636 lines) | |
| `@expo/ui/community/*` | `src/community/{datetime-picker,bottom-sheet,masked-view,menu,pager-view,picker,segmented-control,slider}` | Drop-in replacements for community libraries |

### `@expo/ui/swift-ui` components (`src/swift-ui/<Name>/index.tsx`)

AccessoryWidgetBackground, Alert, Background, BottomSheet, Button, Chart,
ColorPicker, ConfirmationDialog, ContentUnavailableView, ContextMenu,
ControlGroup, DatePicker, DisclosureGroup, Divider, Form, Gauge,
GlassEffectContainer, Grid (+ GridRow), Group, HStack, Host, Image, Label,
LabeledContent, LazyHStack, LazyVStack, Link, List (+ ForEach variants), Mask,
Menu, Namespace, NavigationDestination, NavigationLink, NavigationSplitView,
NavigationStack, Overlay, Picker, Popover, ProgressView, RNHostView,
ScrollView, Section, SecureField, Shapes (Rectangle, RoundedRectangle, Circle,
Capsule, Ellipse, UnevenRoundedRectangle, ConcentricRectangle), ShareLink,
Slider, Spacer, Stepper, SwipeActions, SyncToggle, TabView (+ Tab), Text,
TextField, Toggle, Toolbar, VStack, ZStack. Also `useNativeState`,
`withAnimation`.

Native side: `ios/ExpoUIModule.swift` declares **69** views
(`View(...)` / `ExpoUIView(...)`, lines 10-200). Common prop types:
`src/swift-ui/types.ts` (`CommonViewModifierProps` = `testID`, `modifiers`;
`Alignment`, `FrameProps`, `PaddingProps`).

Examples of props:

| Component | Props (JS) | Native view |
|---|---|---|
| Host | `matchContents` (bool or `{vertical, horizontal}`), `useViewportSizeMeasurement`, `onLayoutContent`, `colorScheme`, `seedColor`, `layoutDirection`, `ignoreSafeArea`, `style` | `HostView` (`src/swift-ui/Host/index.tsx:70`) |
| VStack / HStack | `alignment`, `spacing` | `VStackView` / `HStackView` |
| ZStack | `alignment` | `ZStackView` |
| Spacer | `minLength` | `SpacerView` |
| Text | children (strings or nested `Text`), `markdownEnabled`, `date`, `dateStyle`, `timerInterval`, `countsDown`, `pauseTime` | `TextView` (`src/swift-ui/Text/index.tsx:70`) |
| Button | `label`, `systemImage`, `role`, `onPress` (native event `onButtonPress`), children | `Button` |
| Toggle | `isOn`, `label`, `systemImage`, `onValueChange` | `ToggleView` |
| Slider | `value`, `step`, `min`, `max`, `lowerLimit`, `upperLimit` | `SliderView` |
| TextField | `text: ObservableState<string>`, `selection`, `placeholder`, `axis`, `maxLength`, `autoFocus` | `TextFieldView` |

Text: plain string children become one `TextView` with a `text` prop
(`Text/index.tsx:104-117`); mixed children become nested `TextView` nodes.

### `@expo/ui/jetpack-compose` components

AlertDialog, AnimatedVisibility, Badge, BadgedBox, BasicAlertDialog, Box,
Button (+ FilledTonal/Outlined/Elevated/Text), Card (+ Elevated/Outlined),
Carousel, Checkbox (+ TriState), Chip (Assist/Filter/Input/Suggestion), Column,
DatePicker, Divider, DockedSearchBar, DropdownMenu, ExposedDropdownMenuBox,
FloatingActionButton, FlowRow, HorizontalFloatingToolbar, HorizontalPager,
Host, Icon, IconButton, Image, LazyColumn, LazyRow, ListItem,
LoadingIndicator, ModalBottomSheet, MultiChoiceSegmentedButtonRow,
NavigationBar, Progress (Linear/Circular/Wavy), PullToRefreshBox,
RadioButton, RNHostView, Row, SearchBar, SegmentedButton, Shape,
SingleChoiceSegmentedButtonRow, Slider, Snackbar, Spacer, Surface, Switch,
SyncSwitch, Text, TextField (+ Outlined, Basic), ToggleButton, Tooltip.

Native side: `android/.../expo/modules/ui/ExpoUIModule.kt` declares **93**
views. Some JS files create components from a name (`createButtonComponent`,
`createCardComponent`), so grepping `requireNativeView(` does not find all
names.

Layout props (`src/jetpack-compose/layout-types.ts`): `horizontalArrangement`
/ `verticalArrangement` (`start|end|center|spaceBetween|spaceAround|spaceEvenly|{spacedBy}`),
`horizontalAlignment`, `verticalAlignment`, `contentAlignment` (Box).
`transformProps` (`layout-types.ts:41`) adds `onGlobalEvent`.

### Universal entry (`@expo/ui`)

Host, Column, Row, Text, Button, ScrollView, Switch, Slider, Checkbox,
BottomSheet, Collapsible, FieldGroup, Icon, List, ListItem, Picker,
RNHostView, Spacer, TextInput (`src/universal/index.ts`). Each has
`index.ios.tsx`, `index.android.tsx`, `index.tsx`:

- `Column/index.ios.tsx` renders swift-ui `VStack`, with RN-like `style`
  converted to modifiers by `transformToModifiers`
  (`src/universal/transformStyle.ios.ts`).
- `Column/index.android.tsx` renders compose `Column`.
- `index.tsx` is the web implementation. `Host/index.tsx` renders a
  `<style>` element and CSS values (`100dvh`, `env(safe-area-inset-*)`), so
  it is not usable as a native fallback.

With our resolver, `--platform android` and `a11ytree` resolve to the
`.android.tsx` (Compose) files; `--platform ios` resolves to SwiftUI.

### Code path of `<Host><VStack><Text>Hi</Text></VStack></Host>`

1. `Host` renders `HostNativeView` = `requireNativeView('ExpoUI', 'HostView')`
   (`src/swift-ui/Host/index.tsx:70`). `requireNativeView` is
   `requireNativeViewManager` re-exported by `expo` (`packages/expo/src/Expo.ts:20`).
2. `requireNativeViewManager` (`packages/expo-modules-core/src/NativeViewManagerAdapter.native.tsx:134`)
   registers `ViewManagerAdapter_ExpoUI_HostView` with
   `NativeComponentRegistry.get` (lines 54-75) and wraps it in a
   `PureComponent`.
3. Fabric creates a ShadowNode with the descriptor registered for that name.
   On iOS: `ExpoFabricViewObjC.componentDescriptorProvider`
   (`packages/expo-modules-core/ios/Fabric/ExpoFabricViewObjC.mm:176-196`)
   returns `concreteComponentDescriptorConstructor<expo::ExpoViewComponentDescriptor<>>`
   with the class name as flavor.
4. Mounting (iOS): `HostView` is a `WithHostingView` view, so
   `SwiftUIViewDefinition.createView` makes an `ExpoSwiftUI.HostingView`
   (`ios/Core/Views/SwiftUI/SwiftUIViewDefinition.swift:111-115`). `VStackView`
   and `TextView` become `SwiftUIVirtualView` objects (`NSObject`, not
   `UIView`; lines 118-126). `mountChildComponentView` appends the child to
   `props.children` (`SwiftUIVirtualView.swift:367-379`); the parent's body
   calls `Children()` (`SwiftUIViewDefinition.swift:22-27`), a `ForEach` over
   them in React order.
5. SwiftUI: `HostView.body` = `ZStackLayout(alignment: .topLeading)` around
   `Children()`, then `.fixedSize(matchContents...)`, environment modifiers,
   `applyModifiers`, `GeometryChangeModifier`, `FillAlignmentModifier`
   (`packages/expo-ui/ios/HostView.swift:52-113`). `VStackView.body` =
   `VStack(alignment:spacing:) { Children() }` (`ios/VStackView.swift:35-41`).
   Every `ExpoUIView` is wrapped in `UIBaseView`, which applies
   `accessibilityIdentifier(testID)` and `applyModifiers`
   (`ios/UIBaseView.swift:18-22`).
6. Android: `ExpoComposeView.Children()` iterates the Android child views and
   calls each child's `Content()` composable
   (`packages/expo-modules-core/android/src/compose/expo/modules/kotlin/views/ExpoComposeView.kt:152-168`).
   Only `Host` (`withHostingView = true`) owns a `ComposeView`.

## 2. Modifiers

### SwiftUI

- Factory: `createModifier(type, params) => ({ $type: type, ...params })`
  (`src/swift-ui/modifiers/createModifier.ts:28`).
  `createModifierWithEventListener` adds an `eventListener` function field.
- The array goes to native unchanged as the `modifiers` prop.
  `createViewModifierEventListener` (`src/swift-ui/modifiers/utils.ts`) adds
  an `onGlobalEvent` prop. The native payload is `{[$type]: params}`, for
  example `{"onTapGesture": {}}` (`ios/Modifiers/ViewModifierRegistry.swift:478-484`).
- Native: `applyModifiers` folds the array in order; each `$type` is looked up
  in `ViewModifierRegistry` (152 `register("...")` calls). Array order = SwiftUI
  modifier order (`ios/Modifiers/View+ModifierArray.swift:14-32`).
- Colors: `Color = string | ColorValue | NamedColor`
  (`modifiers/types.ts`). `ShapeStyle` resolves to
  `{type: 'color'|'hierarchical'|'material'|'linearGradient'|'radialGradient'|'angularGradient', ...}`
  (`modifiers/shapeStyle.ts`).
- `modifiers/index.ts:29` calls `requireNativeModule('ExpoUI')` at import.

152 distinct `$type` values are created in `src/swift-ui/modifiers/*`.
Layout- and a11y-relevant ones with parameters:

| Factory | Serialized params | Native |
|---|---|---|
| `padding(p?)` | `top, bottom, leading, trailing, horizontal, vertical, all` (number or `'default'`) | edge wins over `horizontal`/`vertical` over `all` (`ViewModifierRegistry.swift:85-106`) |
| `frame(p)` | `width, height, minWidth, idealWidth, maxWidth, minHeight, idealHeight, maxHeight, alignment` | `.frame(width:height:alignment:)` if width or height set, else the flexible form (`ViewModifierRegistry.swift:57-83`) |
| `fixedSize(p?)` | `horizontal, vertical` | `.fixedSize` |
| `layoutPriority(n)` | `priority` | |
| `offset(p)` | `x, y` | `.offset(x:y:)` (line 189) |
| `aspectRatio(p)` | `ratio, contentMode` | |
| `containerRelativeFrame(p)` | `axes, count, span, spacing, alignment` | |
| `ignoreSafeArea(p?)` | `regions, edges` | |
| `hidden(b)` | `hidden` | `.hidden()` (line 250) |
| `font(p)` | `family, size, weight, design, textStyle` | `Font.system(textStyle, design:)` / `Font.custom` (`FontModifier.swift`) |
| `lineLimit`, `lineSpacing`, `multilineTextAlignment`, `truncationMode`, `minimumScaleFactor`, `allowsTightening`, `kerning`, `bold`, `italic`, `textCase`, `monospacedDigit`, `dynamicTypeSize` | | text layout |
| `background(style, shape?/options)` | `style`, shape fields, `ignoresSafeAreaEdges` | `BackgroundModifier.swift` |
| `overlay(p)` | `color, alignment` | |
| `border(p)` | `content`, `width` | line 393 |
| `cornerRadius(r)`, `clipShape`, `clipped`, `mask`, `shadow`, `opacity`, `blur`, `scaleEffect`, `rotationEffect`, `zIndex` | | drawing / transform |
| `controlSize`, `buttonStyle`, `toggleStyle`, `pickerStyle`, `listStyle`, `labelsHidden`, `textFieldStyle`, `progressViewStyle`, `gaugeStyle`, `datePickerStyle` | `size` / `style` | change control metrics |
| `listRowInsets`, `listRowSpacing`, `listSectionSpacing`, `listSectionMargins`, `headerProminence`, `gridCell*`, `alignmentGuide` | | container layout |
| `onTapGesture(fn)`, `onLongPressGesture(fn, d)`, `onAppear`, `onDisappear`, `onSubmit`, `refreshable`, `onScrollGeometryChange` | event listener (+ `minimumDuration`) | via `onGlobalEvent` |
| `accessibilityLabel(label)`, `accessibilityHint(hint)`, `accessibilityValue(value)`, `accessibilityIdentifier(identifier)`, `accessibilityHidden(hidden)`, `accessibilityElement(children)`, `accessibilityAddTraits(traits)`, `accessibilityRemoveTraits(traits)`, `accessibilityInputLabels(inputLabels)` | as named | `View+AccessibilityModifiers.swift`; traits: `isButton, isHeader, isImage, isSelected, isLink, isModal, isToggle, isStaticText, isSearchField, ...` (`modifiers/index.ts:1040-1057`) |
| `disabled(b)` | `disabled` | |

### Jetpack Compose

Same shape: `{$type, ...params}` (`src/jetpack-compose/modifiers/createModifier.ts`),
in the `modifiers` prop. The global event payload is different:
`nativeEvent.payload = [eventName, params]`
(`src/jetpack-compose/modifiers/utils.ts:5`). The native registry has 43
types (`android/.../ModifierRegistry.kt`):

`paddingAll(all)`, `padding(start, top, end, bottom)`, `size(width, height)`,
`fillMaxSize/fillMaxWidth/fillMaxHeight(fraction)`, `width(width)`,
`height(height)`, `defaultMinSize(minWidth, minHeight)`,
`wrapContentWidth/Height(alignment)`, `imePadding`, `offset(x, y)`,
`background(color, animationSpec)`, `border(borderWidth, borderColor)`,
`shadow(elevation)`, `dropShadow/innerShadow(shape, radius, spread, color, offsetX, offsetY, alpha)`,
`alpha`, `blur(radius)`, `cornerRadius(radius)`, `rotate(degrees)`,
`graphicsLayer(...)`, `zIndex(index)`, `animateContentSize`, `weight(weight)`,
`align(alignment)`, `matchParentSize`, `testID(testID)`,
`semantics(contentType, contentDescription)`, `clip(shape)`, `maskClip`,
`onVisibilityChanged`, `onSizeChanged`, `onGloballyPositioned`,
`clickable(indication)`, `combinedClickable`, `selectable(selected, role)`,
`selectableGroup`, `toggleable(value, role)`, `menuAnchor`,
`verticalScroll`, `horizontalScroll`. Shapes: `{type: 'rectangle'|'circle'|'roundedCorner'|'cutCorner'|'material', ...}`.
In Kotlin, the chain is `ModifierRegistry.applyModifiers(props.modifiers, ...)`
passed as `modifier =` (`android/.../ComposeViews.kt:57-135`).

## 3. Native side (for a layout emulator)

### SwiftUI views per component (`packages/expo-ui/ios/`)

| Component | SwiftUI (file) |
|---|---|
| Host | `ZStackLayout(alignment: .topLeading/.topTrailing)` or `ViewportSizeMeasurementLayout`, `.fixedSize(h, v)`, `.frame(min/max ... .infinity)` fill (`HostView.swift`) |
| VStack | `VStack(alignment: ?? .center, spacing:)` (`VStackView.swift:36`) |
| HStack | `HStack(alignment:spacing:)` (`HStackView.swift:42`) |
| ZStack | `ZStack(alignment: ?? .center)` (`ZStackView.swift:18`) |
| Spacer | `Spacer(minLength:)` (`SpacerView.swift:18`) |
| Text | `Text(...)`, concatenated for nested children; text modifiers through `applyTextModifiers` (`TextView.swift`) |
| Button | `SwiftUI.Button(label, systemImage:, role:)` or `Button(role:, action:) { Children() }` (`Button/Button.swift:16-41`) |
| Toggle | `Toggle(label, systemImage:, isOn:)`, `Toggle(label, isOn:)`, `Toggle(isOn:) { Children() }` (`Toggle/ToggleView.swift:40-44`) |
| Slider | `Slider(value:in:step:)` variants (`SliderView.swift:70-133`) |
| Picker | `Picker(label, systemImage:, selection:)` (`Picker/PickerView.swift:28-32`) |
| List | `List(selection:) { Children() }` / `List { Children() }` (`ListView.swift:17,30`) |
| Form | `Form { ... }` (`FormView.swift:13`) |
| Section | `Section(title) { }`, `Section(title, isExpanded:)` (`SectionView.swift:49-88`) |
| Image | `Image(systemName:)`, `Image(uiImage:)` (`ImageView.swift`) |
| TextField | `TextField(...)` with `ObservableState` text (`TextFieldView.swift:152-249`) |
| Divider, Label, LabeledContent, Stepper, ProgressView, ScrollView | `Divider()`, `Label(title, systemImage:)`, `LabeledContent(label)`, `Stepper(label, value:in:step:)`, `ProgressView`, `ScrollView(axes, showsIndicators:)` |

### Sizing and events

- `Host` size: with `matchContentsHorizontal/Vertical`, `GeometryChangeModifier`
  calls `shadowNodeProxy.setStyleSize(width, height)` and dispatches
  `onLayoutContent {width, height}` (`HostView.swift:174-188`). The ObjC side
  commits `ExpoViewState::withStyleDimensions` (`ExpoFabricViewObjC.mm:400-409`).
  `ExpoViewComponentDescriptor::adopt` writes it into the Yoga style width /
  height (`common/cpp/fabric/ExpoViewComponentDescriptor.h:87-109`).
  Android does the same through `ShadowNodeProxy.setStyleSize`
  (`android/.../HostView.kt`, `expo-modules-core/android/.../ShadowNodeProxy.kt:25`).
- Without `matchContents`, the Host's size comes from its RN `style` (Yoga) and
  the content fills it (`FillAlignmentModifier`, `HostView.swift:210-236`).
- Nested nodes (`VStackView`, `TextView`, ...) keep the default
  `ExpoViewShadowNode`: no `measureContent` unless the prop
  `expoInternalSizeFromChildren` is set (only `RNHostView`,
  `ExpoViewShadowNode.h:86-115`). So their Yoga frames are not the SwiftUI
  frames. A host that wants real boxes has to compute them.
- `RNHostView` (RN content inside SwiftUI) is a Yoga leaf that measures its
  first child (`ExpoViewComponentDescriptor.h:38-57`) and reports the SwiftUI
  position through `ContentOriginRegistry` / `getContentOriginOffset`
  (`ExpoViewShadowNode.h:66-84`).
- Events: a Swift `EventDispatcher` named `onX` goes to
  `ExpoFabricViewObjC.dispatchEvent`, which strips `on` (`onButtonPress` ->
  `buttonPress`, `ExpoFabricViewObjC.mm:138-145`) and calls
  `ExpoViewEventEmitter::dispatch`. JS registers `topButtonPress` ->
  `onButtonPress` from `getViewConfig` (`RCTNormalizeInputEventName`,
  `ios/Core/Modules/CoreModule.swift:106-113`).

## 4. expo-modules-core requirements

### JS

- `requireNativeViewManager(module, view)` needs `globalThis.expo.getViewConfig(module, view)`
  returning `{validAttributes, directEventTypes}`. Without it, it logs a warning
  and registers the name with no attributes (`NativeViewManagerAdapter.native.tsx:59-67`).
  Each attribute gets `{process}` that turns a `SharedObject` into its
  `__expo_shared_object_id__` (lines 82-109). There is no `proxiedProperties`
  object any more (only an old comment at lines 18-21). Props go straight to
  Fabric.
- The name suffix `_${expo.__expo_app_identifier__}` is added only when that
  field is set (lines 51-56).
- It also reads `requireNativeModule(module).ViewPrototypes['ExpoUI_<View>']`
  inside a `try` (lines 165-179).
- `requireOptionalNativeModule` reads `globalThis.expo.modules[name]`, then
  `NativeModulesProxy`, then `TurboModuleRegistry` (`requireNativeModule.ts:32-48`).
  `ensureNativeModulesAreInstalled` returns early if `globalThis.expo` exists.
- `EventEmitter`, `SharedObject`, `NativeModule`, `SharedRef` exports are read
  from `globalThis.expo` at import (`src/EventEmitter.ts`, `SharedObject.ts`, ...).
- A pure-JS `globalThis.expo` exists for web:
  `src/polyfill/dangerous-internal.ts` `installExpoGlobalPolyfill()` with JS
  classes from `src/polyfill/CoreModule.ts` and `uuid/index.web`. On native,
  `polyfill/index.ts` is a no-op, so we would install it from our entry.
- `ExpoUI` module members used by JS: `ObservableState` (class, a
  `SharedObject`), `WorkletCallback`, `completeRefresh`, `withAnimation`
  (iOS); `getMaterialColors`, `isDynamicColorAvailable`,
  `SwitchDefaultIconSize`, `ToggleButtonIconSize`, `ToggleButtonIconSpacing`
  (Android). `requireNativeModule('ExpoUI')` runs at import in
  `swift-ui/modifiers/index.ts:29`, `State/useNativeState.ts:6`,
  `State/useWorkletProp.ts:9`, `swift-ui/withAnimation.ts:7`,
  `jetpack-compose/ExpoUIModule.ts:3`. It throws if the module is missing.
- `State/index.fx.ts` calls `installOnUIRuntime` only if
  `react-native-worklets` loads, inside `try/catch`.
- `import ... from 'expo'` runs `Expo.fx.tsx`: `./winter`, `./async-require`,
  `expo-asset` (lines 2-4). `expo-asset/src/ExpoAsset.ts:3` calls
  `requireNativeModule('ExpoAsset')` at import, and `PlatformUtils.ts:1`
  imports `expo-constants`. So `@expo/ui` pulls native module requirements
  that are not ExpoUI's. Options: stub those modules, or alias `expo` for
  `@expo/ui` files to a shim that re-exports `expo-modules-core`.

### C++ / JSI

- Cross-platform C++ in `packages/expo-modules-core/common/cpp/`:
  `EventEmitter`, `SharedObject`, `SharedRef`, `NativeModule`, `LazyObject`,
  `JSI/{JSIUtils,TypedArray,MemoryBuffer,ObjectDeallocator}` (811 lines of
  `.cpp`) and `fabric/{ExpoViewProps,ExpoViewShadowNode,ExpoViewState,ExpoViewEventEmitter,ExpoViewComponentDescriptor,ContentOriginRegistry}`.
- Compile check (done here, syntax only, host flags from
  `/tmp/cg/chk.sh` with `-I common/cpp -I common/cpp/JSI -I common/cpp/fabric`):
  all 9 `common/cpp/**/*.cpp` files, the 4 `fabric/*.cpp` files, and a test TU
  that builds a `ComponentDescriptorProvider` with
  `concreteComponentDescriptorConstructor<expo::ExpoViewComponentDescriptor<>>`
  and a flavor: **0 errors**. Script: `/tmp/expochk/chk.sh`, TU:
  `/tmp/expochk/tu.cpp`. Nothing was linked.
- `ExpoViewProps.h:15-20` has a macOS switch only for
  react-native-macos `ViewProps` (`filterObjectKeys`).
- The base component name is `ExpoFabricView`
  (`fabric/ExpoViewShadowNode.cpp`); the real name is the flavor.
- Installing `globalThis.expo` is **not** cross-platform:
  - iOS: Swift `ExpoRuntimeInstaller` (`ios/JS/ExpoRuntimeInstaller.swift`)
    creates `global.expo` and the `modules` host object; `EXJSIInstaller.mm:39-56`
    calls the common C++ `installBaseClass` / `installClass`. The Swift JSI
    layer is the separate package `packages/expo-modules-jsi`
    (`apple/Sources/ExpoModulesJSI` Swift + `ExpoModulesJSI-Cxx`).
  - Android: JNI (`android/src/main/cpp/JSIContext.cpp`,
    `ExpoModulesHostObject.cpp`, `installers/MainRuntimeInstaller.h`).
  - `getViewConfig` is a Swift / Kotlin module function
    (`ios/Core/Modules/CoreModule.swift:95-119`,
    `android/.../defaultmodules/CoreModule.kt:70-98`).
- Android new arch uses its own descriptor
  (`android/src/main/cpp/fabric/AndroidExpoViewComponentDescriptor.*`,
  `ExpoComponentDescriptorFactory.cpp:12-29`, `RawPropsParser(useRawPropsJsiValue=true)`).

## 5. View configs

- `getViewConfig` builds `validAttributes` from the prop names of the view
  definition and `directEventTypes` from its event names. For SwiftUI views the
  names come from `Mirror` over a dummy `Props()` instance: every `@Field`
  (key or label) and every `EventDispatcher` (`SwiftUIViewDefinition.swift:130-146`).
  The base `ViewProps` has `globalEventDispatcher = EventDispatcher("onGlobalEvent")`
  (`SwiftUIViewProps.swift:5,59`). `UIBaseViewProps` adds `testID` and
  `modifiers` (`ios/UIBaseViewProps.swift:11-12`).
- No static form was found:
  - `expo-module.config.json` lists only `ExpoUIModule` classes.
  - `jest-expo/src/preset/moduleMocks/expoModules.js` lists `ExpoUI`
    functions (lines 829-832, 1646-1651) but no ExpoUI entry in
    `viewManagersMetadata` (lines 1728+).
  - `expo-ui/src/__mocks__/expo.ts` mocks `requireNativeView` as an RN `View`.
- Options:
  1. Generate a JSON table at build time by parsing the Swift files:
     `@Field var <name>` / `@Field("<key>")` (499 occurrences in `ios/`,
     including modifier records) and `var on<X> = EventDispatcher()` (34), per
     props class, plus `testID`, `modifiers`, `onGlobalEvent`. Kotlin: the
     constructor parameters of the `@OptimizedComposeProps` data classes.
  2. Take the prop names from the TypeScript `Native*Props` types.
  3. Hand-write the list for a core subset.
- **(to verify)** Whether React Native drops props that are not in
  `validAttributes` in the Fabric payload. If it does, the table must be
  complete for every prop the emulator reads.

## 6. `@expo/agent-cli` (`/Users/bonsai/Developer/expo-agent-cli`)

- Monorepo (Bun workspaces): `packages/@expo/agent-cli` (the CLI, v1.0.2) and
  `packages/expo-agent-cli` (npm alias). Node CLI in TypeScript, bundled with
  `ncc` (`package.json` `build`), tested with Vitest; `bin/cli.js` requires
  `build/cli`.
- Purpose (README): "Agent-native CLI on top of the Expo CLI family". It runs
  `expo`, `eas-cli`, `expo-doctor` as subprocesses and does not import their
  internals. `AGENTS.md` repeats this rule from `llp/0001`.
- Command structure: `src/commandRegistry.ts` is the whole surface as data:
  top-level commands (lazy module per name), groups `group:action` (for
  example `runtime:tree`, `runtime:tap`, `runtime:type`, `runtime:eval`), and
  forwarded `expo` commands. Every entry needs a `summary`, `load` and a
  `help` spec (`src/help/types.ts`) with `--json` keys.
- Subprocesses: `src/utils/subprocess.ts` (modes `inherit`, `capture`, `tee`,
  `capture-stdout`, process groups, runner locks), `src/utils/projectBin.ts`
  (walks `node_modules/.bin` for a project-local bin), `src/utils/expoCli.ts`.
- Nearest existing features: `runtime:tree` / `runtime:tap` / `runtime:type`
  read and drive a **running** app through the dev server's debugger (CDP)
  (`src/runtime/interact/*`, `src/runtime/cdpClient.ts`); `smoke` checks an app
  on a device. No headless render, "preview" or "component check" command was
  found.
- No MCP server: `llp/0008-guardrails.rfc.md:19` ("There is no MCP server")
  and `llp/0017-deferred-commands.reference.md:161` (deferred).
- Plug-in point: a new registry entry (top-level, or a group such as
  `render:*`) whose module spawns the project's `rn-a11y-tree` bin (found with
  `projectBin.ts`, or run with the package runner) through `subprocess.ts` in
  `capture` mode, and passes its JSON through. This matches the subprocess
  rule. A library import would break that rule.

## 7. Size and risks

### A. Emulate SwiftUI / Compose layout in the host

Plan outline: register all `ViewManagerAdapter_ExpoUI_*` names with
`ExpoViewComponentDescriptor` (or a subclass for `HostView`); install
`globalThis.expo` from JS with a generated view-config table and an `ExpoUI`
stub; in the Host's `layout()`, run our own layout over the Host subtree
(props from `propsMap`), write child frames, and set the Host size for
`matchContents`.

Scope for the current API:

| Item | SwiftUI | Compose |
|---|---|---|
| Native views | 69 | 93 |
| Modifier types | 152 | 43 |
| Core layout containers | Host, VStack, HStack, ZStack, Spacer, Group, ScrollView, LazyVStack/LazyHStack, Grid | Host, Row, Column, Box, FlowRow, Spacer, LazyColumn/LazyRow |
| Core layout modifiers | padding, frame (2 forms), fixedSize, layoutPriority, offset, aspectRatio, hidden | padding/paddingAll, size, width, height, fillMax*, wrapContent*, weight, align, offset, defaultMinSize |
| Leaf controls needing metrics | Text, Button, Toggle, Slider, Picker, Stepper, TextField, SecureField, Image (SF Symbols), Label, Divider, ProgressView, Gauge | Text, Button variants, Switch, Checkbox, RadioButton, Slider, TextField, Icon, Chip, Card, ListItem |
| Containers with system styling | List, Form, Section, LabeledContent, DisclosureGroup, NavigationStack, TabView | ListItem, Card, Surface, NavigationBar, ModalBottomSheet |

**(estimate)** A useful first slice is about 10 containers, 12-15 leaves and
10-12 modifiers per platform; the rest can render as zero-size or
content-size nodes with a warning.

Top risks:

1. SwiftUI layout semantics: proposal / flexibility ordering in HStack /
   VStack (least flexible first, `layoutPriority`), `Spacer` minimum length,
   `frame` min/ideal/max rules, `fixedSize`, alignment guides, text wrapping
   under a proposal. Compose: intrinsic measurement, `weight`, `Arrangement`.
2. Control metrics and system styles (Button styles, `controlSize`,
   `List` / `Form` insets, Section headers, Material 3 paddings) are not in
   the Expo code. They come from the OS. **(to verify)** Measure them once on
   a simulator / emulator.
3. Fonts: SwiftUI default text styles (Dynamic Type) and Compose typography
   differ from the macOS fonts that CoreText has. Existing gap for RN text.
4. Accessibility: SwiftUI builds the a11y tree from the view type plus
   `accessibility*` modifiers (`accessibilityElement(children:)`, traits). We
   must map this ourselves. Compose: `semantics`, `testID`, role in
   `selectable` / `toggleable`.
5. Interactions: `onButtonPress`, `onValueChange`, and `onGlobalEvent`
   payloads (different shapes on iOS and Android) must be sent by tag; hit
   testing needs our emulated frames.
6. `ObservableState` / `useNativeState` (TextField) needs a JS
   `SharedObject` stand-in with `getValue` / `setValue` / `setOnChange`, and
   the `process` hook passes its id (`__expo_shared_object_id__`) to native.
7. `import 'expo'` side effects (`expo-asset`, `expo-constants`, winter) as
   described in section 4.
8. The tree output: node types are `ViewManagerAdapter_ExpoUI_*` and the
   custom props are only in `ExpoViewProps::propsMap`. The current dump
   (`native/overlay/tester/src/render/A11yTree.cpp`) has no reference to
   `propsMap` (it reads typed ViewProps and, for `--debug-props`,
   `getDebugProps()`), and `ExpoViewProps.h` does not override
   `getDebugProps`. The dump needs an Expo branch that emits `propsMap`
   (`text`, `label`, `modifiers`, ...) for names and a11y.

### B. Real SwiftUI on macOS

Facts:

- Both podspecs declare macOS: `ExpoModulesCore.podspec` `:osx => '13.4'`,
  `ios/ExpoUI.podspec:13-16` `:osx => '13.4'`. The SPM config of ExpoUI lists
  only `iOS("16.4")` (`packages/expo-ui/spm.config.json`).
- `expo-modules-core/ios/Platform/Platform.swift:1-21` aliases UIKit names to
  AppKit on macOS (`UIView = NSView`, `UIHostingController = NSHostingController`,
  `UIViewRepresentable = NSViewRepresentable`, `UIColor = NSColor`, ...).
- `expo-ui/ios` already has platform branches: 12 `#if os(macOS)`, 8
  `#if !os(macOS)` and more, in 17 files, for example `TextFieldView.swift`,
  `SecureFieldView.swift`, `HostView.swift` (window size via
  `NSApplication`, lines 159-168), `Modifiers/ListStyleModifier.swift`,
  `PickerStyleModifier.swift`, `KeyboardTypeModifier.swift`,
  `TextContentTypeModifier.swift`, `TextInputAutocapitalizationModifier.swift`,
  `TabViewStyleModifier.swift`, `IndexViewStyleModifier.swift`.
- The blocker is React Apple, not UIKit: ExpoModulesCore includes React ObjC
  headers in 16 files, for example `RCTComponentViewFactory.h`,
  `RCTMountingManager.h`, `RCTSurfacePresenter.h`, `RCTHost.h`,
  `RCTBridge.h`, `RCTViewComponentView.h`, `RCTUIManager.h`. Component
  registration calls `[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:`
  (`ExpoFabricViewObjC.mm:526`). Virtual views are driven by
  `mountChildComponentView` from the RN mounting manager. Our host is
  ReactCommon + ReactCxxPlatform without `React-RCTFabric`.
- `globalThis.expo` needs the Swift `AppContext`, `ExpoRuntimeInstaller` and
  `expo-modules-jsi` (Swift / C++ interop over JSI).

Risks for B: build ExpoModulesCore + ExpoModulesJSI + ExpoUI with CMake /
SwiftPM outside CocoaPods; provide or port the React Apple pieces (or write a
mounting bridge that calls the Swift views directly); run an `NSApplication`
and `NSHostingController` headlessly; macOS SwiftUI metrics differ from iOS
(controls, fonts, List / Form styles), so the output is "SwiftUI on macOS",
not iOS. Compose has no equivalent path on macOS in this code base.

## Files

- Checkout: `/tmp/expo-sdk58` (git worktree of `origin/sdk-58`).
- Compile check: `/tmp/expochk/chk.sh`, `/tmp/expochk/tu.cpp`.
