# native/

Native changes to React Native's Fantom tester (`private/react-native-fantom/`
in `third_party/react-native`, 0.88-stable at 6007151).

## overlay/

`overlay/` mirrors `private/react-native-fantom/`. Copy it over the submodule
before the gradle build:

```sh
rsync -a native/overlay/ third_party/react-native/private/react-native-fantom/
```

Every file is a full copy of the upstream file with changes, or a new file:

| File | Change |
|---|---|
| `tester/third-party/nlohmann_json/CMakeLists.txt` | `SYSTEM` include directory. Apple clang 21 with `-Werror` fails on `-Wdeprecated-literal-operator` in the bundled `json.hpp`. |
| `tester/CMakeLists.txt` | Adds `react/renderer/components/textinput` (only its cross-platform sources: all `platform/android/.../androidtextinput/*.cpp` files are removed from `rrc_textinput`), `src/components/*.cpp`, and links `rrc_textinput`. Builds the native libraries from npm (react-native-screens, react-native-safe-area-context, react-native-gesture-handler) when they are found (see Native libraries). The tester source glob uses `CONFIGURE_DEPENDS`, so new source files are found without a manual reconfigure. On macOS (option `FANTOM_MACOS_TEXT_LAYOUT`, default `ON`): enables `OBJCXX`, removes the stub `platform/cxx/.../TextLayoutManager.cpp` from `react_renderer_textlayoutmanager`, adds `src/platform/macos/TextLayoutManager.mm`, and links AppKit, CoreText and Foundation. |
| `tester/src/platform/macos/TextLayoutManager.mm` (new) | Text measurement with AppKit/TextKit 1 (`NSLayoutManager`). Port of the iOS `RCTTextLayoutManager.mm`, `RCTAttributedTextUtils.mm` and `RCTFontUtils.mm`. The upstream stub returns the minimum size (height 0) for all text. |
| `tester/src/render/A11yTree.h`, `A11yTree.cpp` (new) | Serializes the shadow tree (not the mounted tree, so views are not flattened) to typed JSON. |
| `tester/src/components/FantomTextInput.h`, `FantomSwitch.h`, `FantomComponents.cpp` (new) | Shadow nodes for `AndroidTextInput` and `AndroidSwitch` (see below). |
| `tester/src/components/FantomScreens.h`, `FantomScreens.cpp`, `FantomScreensSplitScreen.cpp` (new) | react-native-screens: descriptor registration, context entry, emulated native state updates (see Screens). |
| `tester/src/components/FantomGestureHandler.h`, `FantomGestureHandler.cpp` (new) | react-native-gesture-handler: descriptor registration and the no-op `RNGestureHandlerModule` TurboModule (see Gesture handler). |
| `tester/src/platform/oss/TesterTurboModuleProvider.cpp` | Provides `RNGestureHandlerModule`. |
| `tester/src/components/FantomSafeArea.h`, `FantomSafeArea.cpp` (new) | react-native-safe-area-context: descriptor registration, `onInsetsChange` events and `RNCSafeAreaView` state (see Safe area). |
| `tester/scripts/codegen-lib.sh` (new) | Runs React Native codegen for a native library (used by CMake for the native libraries). |
| `tester/src/stubs/StubComponentRegistryFactory.h` | Registers the TextInput/Switch descriptors above and the native library descriptors. |
| `tester/src/TesterAppDelegate.cpp` | Adds the react-native-screens context entry and runs the screens and safe-area updates after every mount. `loadScript` flushes the message queue until the JS runtime pointer is set (at most 30 s, then a fatal error). Upstream flushes once; when the runtime task was queued after that flush, `loadScriptAndRunTests` crashed with SIGSEGV (null `runtime_`, `TesterAppDelegate.cpp:187`). |
| `tester/src/render/HitTest.h`, `HitTest.cpp` (new) | Hit testing with `hitSlop`, and tag lookup in the shadow tree. |
| `tester/src/NativeFantom.h`, `NativeFantom.cpp` | Adds `getA11yTree`, `hitTest`, `enqueueNativeEventByTag`, `enqueueScrollEventByTag`, `setTextInputTextByTag`, `updateScreenStates` (also registered as `updateNativeStates`), `setScreensHeaderHeight` and `setSafeAreaInsets`. They are registered in `methodMap_` in the constructor, not in the codegen spec, so the overlay does not need a change to `packages/react-native`. |

Signatures of the added `NativeFantom` methods (Flow):

```js
getA11yTree: (surfaceId: RootTag, includeDebugProps?: ?boolean) => string;
// JSON: {"tag", "type", "path": [root tag, ..., tag], "viaHitSlop"} or "null".
hitTest: (surfaceId: RootTag, x: number, y: number) => string;
enqueueNativeEventByTag: (
  surfaceId: RootTag,
  tag: number,
  type: string,
  payload?: ?{[string]: unknown},
  category?: ?NativeEventCategory,
  isUnique?: ?boolean,
) => void;
enqueueScrollEventByTag: (
  surfaceId: RootTag,
  tag: number,
  options: {x: number, y: number, zoomScale?: ?number},
) => void;
setTextInputTextByTag: (surfaceId: RootTag, tag: number, text: string) => void;
// Dispatches the screens state updates and safe-area events/state updates
// (they also run after every mount); returns their number.
updateScreenStates: (surfaceId: RootTag) => number;
updateNativeStates: (surfaceId: RootTag) => number; // same function
setScreensHeaderHeight: (height: number) => void;
// Window safe area insets, default 0. Applied at the next mount or
// updateNativeStates call.
setSafeAreaInsets: (insets: {top?: number, left?: number, right?: number, bottom?: number}) => void;
```

The by-tag methods throw a `JSError` if the tag is not in the surface's
current shadow tree (or, for the scroll and text methods, if the node is not a
ScrollView / AndroidTextInput). Like the node-based Fantom methods, they only
enqueue: call `NativeFantom.flushEventQueue()` and then `Fantom.runWorkLoop()`
(this is what `Fantom.runOnUIThread` + `runWorkLoop` do).

## Interactions

`hitTest` points are in root coordinates (dp). It uses the algorithm of
`LayoutableShadowNode::findNodeAtPoint`, which already handles:

- `pointerEvents` (`canBeTouchTarget` / `canChildrenBeTouchTarget` of
  `ConcreteViewShadowNode`): `none` skips the node and its subtree, `box-none`
  lets only children be targets, `box-only` lets only the node be the target.
- Transforms (the frame is transformed; inverted lists are handled).
- Clipping: children outside the frame are hit only through `overflowInset`,
  which is empty for `overflow: hidden`/`scroll`.
- ScrollView content offset (`getContentOriginOffset`).
- Order: children are tested last to first, sorted by `zIndex` (only for
  non-static positions).

`findNodeAtPoint` does not handle `hitSlop` and `display: none`. `hitTest`
adds both: a node's own bounds are extended by its `hitSlop` (as on Android
`TouchTargetHelper` and iOS `pointInside`), and `display: none` nodes are
skipped. It also returns a node only if the point is inside its own (hitSlop)
bounds; `findNodeAtPoint` can return a parent for a point that is only inside
its children's overflow area. `viaHitSlop` is true when `findNodeAtPoint`
gives a different result. Non-layoutable nodes (`Text`, `RawText`) are never
hit; the `Paragraph` is.

Events that worked in `tests/FantomInteraction-itest.js` (Pressable with
`onPress`):

- `click` (payload `{}`) dispatched to the Pressable's View calls `onPress`.
  Dispatched to a child (for example the `Paragraph` inside it), it does not.
- `touchStart` then `touchEnd` call `onPress`, also when dispatched to a child
  (the JS responder system bubbles). Payload:
  `{touches, changedTouches, targetTouches}` with touches
  `{pageX, pageY, locationX, locationY, screenX, screenY, identifier, target, timestamp, force}`;
  for `touchEnd`, `touches` and `targetTouches` are empty.
- TextInput: `setTextInputTextByTag(surfaceId, tag, text)`, then
  `change` with `{text, eventCount, target}` calls `onChangeText`.
  `setTextInputTextByTag` updates `TextInputState` with
  `ConcreteState::updateState` (the platform path for native text changes);
  the UIManager commits the new state, and the node is measured again.
  `getA11yTree` then shows the new `text` and width.
- `enqueueScrollEventByTag` calls `onScroll` and updates the ScrollView state;
  `getA11yTree` reads `contentOffset` (and `contentSize`) from the state.
  The `onScroll` payload has `contentSize` from the ScrollView state (the
  children's layout), `layoutMeasurement` from the ScrollView frame, and
  `zoomScale` 1 unless the caller passes one (upstream Fantom sends 0, the
  `ScrollEvent` default, also through `enqueueScrollEvent`). Sizes are Yoga
  floats, so they can be off by about 1e-4 (for example 1000.00006).

## Native libraries

CMake builds native libraries from npm when it finds them in
`$RN_NATIVE_LIBS_DIR` (a `node_modules` directory; not `FANTOM_*`, because the
Fantom runner rejects unknown `FANTOM_*` variables), else in the
`node_modules` next to the React Native checkout (for this repo: the root
`node_modules`). A library that is not found is skipped. For each library, at
configure time, `tester/scripts/codegen-lib.sh` runs React Native codegen
(`combine-js-to-schema-cli.js` + `generate-specs-cli.js -p android`, spec
directory and Java package from the package's `codegenConfig`) into
`build/tester/codegen-libs/<name>/`, and CMake compiles that output plus the
library's C++ into an OBJECT library (warnings are not errors there) linked
into the tester, which gets `FANTOM_WITH_<LIBRARY>=1`
(`fantom_add_native_library` in `tester/CMakeLists.txt`).
`native/scripts/codegen-lib.sh` runs the same codegen by hand. No file of the
packages is patched.

| Library (Expo SDK 58 pin) | CMake target | C++ |
|---|---|---|
| `react-native-screens` `~4.28.0` | `rnscreens` | `common/cpp/react/renderer/components/rnscreens/*.cpp` |
| `react-native-safe-area-context` `~5.9.1` | `safeareacontext` | `common/cpp/react/renderer/components/safeareacontext/*.cpp` |
| `react-native-gesture-handler` `~3.2.1` | `rngesturehandler` | `shared/shadowNodes/react/renderer/components/rngesturehandler_codegen/*.cpp` (its `ComponentDescriptors.h` shadows the codegen one: `shared/shadowNodes` is first on the include path) |

## Screens (react-native-screens)

Branch: the non-Android branch of `common/cpp` (no `ANDROID` define). The
Android branch needs JNI (`JFabricUIManager`, `ScreenDummyLayoutHelper`). The
non-Android branch reads `"RCTImageLoader"` from the context container in
three descriptors; the host inserts an empty placeholder (header images are
not loaded). Component names: `RNSScreen`, `RNSScreenStack`,
`RNSScreenStackHeaderConfig`, `RNSScreenStackHeaderSubview`,
`RNSScreenContentWrapper`, `RNSScreenContainer`, `RNSModalScreen`,
`RNSFullWindowOverlay`, `RNSSafeAreaView`, ... are the same on both platforms,
so the native stack of the Android JS works. The tabs and "gamma" stack
components are registered with their iOS names (`RNSTabsHostIOS`,
`RNSStackHeaderConfigIOS`, `RNSStackHeaderItemIOS`); the Android JS renders
`RNSTabsHostAndroid`, `RNSStackHeaderConfigAndroid`,
`RNSStackHeaderSubviewAndroid`, which fall back to the legacy interop (no
layout from the library).

Native state: on a device, the native views send state updates after layout.
The host emulates them after every mount (and on `updateScreenStates`):

- `RNSScreen`: `frameSize` = frame size of the parent (stack or container),
  `contentOffset` = (0, top inset + header height) if the parent is an
  `RNSScreenStack` and the screen has a visible `RNSScreenStackHeaderConfig`
  that is not translucent and not a large title (the rule of `RNSScreen.mm`),
  else (0, 0). The top inset is the part of the safe area top inset
  (`setSafeAreaInsets`) that overlaps the screen: the status bar above the
  native bar.
  The library's descriptor applies `frameSize` as the Yoga size; the offset is
  the screen's content origin offset (like iOS, the screen covers the whole
  stack and its content starts below the header, so the content wrapper
  extends one header height below the screen).
- `RNSScreenStackHeaderConfig` (visible, in a stack): `frameSize` = (screen
  width, header height), no edge insets, `frameOrigin` = (0, top inset -
  contentOffset), so the header is below the status bar at the top of the
  screen, where the native bar is drawn.

Constants: the header height is 56 (Android toolbar) by default;
`setScreensHeaderHeight(44)` gives the iOS navigation bar height. There is no
status bar or safe area inset, no large-title height, no back-button inset,
and no header subview layout. The status bar height comes from the safe
area top inset (default 0). The updates are asynchronous
(`ConcreteState::updateState`, as on the platform): they are committed when
the event queue is flushed (`NativeFantom.flushEventQueue()`), so settle after
a render.

`getA11yTree` for screens: `RNSScreen` has `activityState` (0 inactive, 1
transitioning, 2 active), `stackPresentation`, `stackAnimation`,
`gestureEnabled`, `screenId`, and the emulated state (`stateFrameSize`,
`stateContentOffset`); `RNSScreenStackHeaderConfig` has `title`, and
`hidden`, `translucent`, `largeTitle`, `backTitle`, `backgroundColor`,
`hideBackButton` when set. Every node with a
non-zero content origin offset has `contentOriginOffset` (ScrollView:
-contentOffset; RNSScreen: the header offset). Absolute position of a child =
parent position + parent `contentOriginOffset` + child `frame` origin.
`hitTest` uses the same offsets.

TurboModules: the JS asks for `RNSModule` with `TurboModuleRegistry.get`
(not enforcing; empty spec), and it is not provided. Nothing else is needed
for the native stack. `global.RNScreensTurboModule` is only used by the
gesture-handler screen transitions and is not installed.

`tests/FantomScreens-itest.js` (needs `react-native-screens`,
`@react-navigation/native`, `@react-navigation/native-stack` and
`react-native-safe-area-context` in the React Native checkout, and
`FantomNavigationStackApp.tsx`, a copy of `examples/navigation-stack/App.tsx`,
next to it) sets the safe area insets to top 47 / bottom 34, renders the app,
taps "go-details" with a touch pair, settles, and checks the tree: the
provider `insets`, two `RNSScreen` under `RNSScreenStack` with the second one
filling the stack, the Details header config with `title` "Details", the Home
screen still present, and one screen after tapping "go-back".

## Safe area (react-native-safe-area-context)

- `RNCSafeAreaProvider` (codegen descriptor): after every mount (and on
  `updateNativeStates`) the host emits `onInsetsChange` with
  `{insets: {top, right, bottom, left}, frame: {x, y, width, height}}` when it
  changed. `frame` is the provider's frame in root coordinates; `insets` are
  the window insets (`setSafeAreaInsets`, default 0) that overlap the provider,
  like `UIView.safeAreaInsets`. `SafeAreaProvider` renders its children only
  after the first event (unless it has `initialMetrics`), so settle (flush the
  event queue) after a render.
- `RNCSafeAreaView` (custom descriptor from `common/cpp`): the host sets
  `RNCSafeAreaViewState.insets` to the insets of the nearest provider (or the
  overlapping window insets without a provider); the library applies them as
  padding or margin according to `mode` and `edges`.
- `getA11yTree`: the provider has `insets` (the last emitted ones) and
  `RNCSafeAreaView` has `insets` (its state).
- The `RNCSafeAreaContext` TurboModule (`getConstants` with
  `initialWindowMetrics`) is not provided; the JS asks for it with
  `TurboModuleRegistry.get`, so `initialWindowMetrics` is null.

## Gesture handler (react-native-gesture-handler)

- Descriptors: `RNGestureHandlerDetector` (custom shadow node from
  `shared/shadowNodes`: it keeps its children unflattened and sets its frame
  to the bounding box of its children, so a detector with
  `display: 'contents'` still has a real frame), `RNGestureHandlerRootView`
  and `RNGestureHandlerButton` (codegen).
- `RNGestureHandlerModule` TurboModule: a safety net for
  `TurboModuleRegistry.getEnforcing('RNGestureHandlerModule')`. All methods
  (`createGestureHandler`, `attachGestureHandler`, `setGestureHandlerConfig`,
  `updateGestureHandlerConfig`, `configureRelations`, `dropGestureHandler`,
  `flushOperations`) are no-ops; `installUIRuntimeBindings` returns `true`.
  Gesture recognition is done in JS (the host repo's runtime replaces the
  module on the JS side). The runtime decorator (`shared/runtime`) is not
  built.
- `getA11yTree`: the detector has `handlerTags`, `moduleId` and
  `virtualChildren` (if any); the root view has `moduleId`; the button has
  `handlerTag`, `moduleId`, `enabled`, `exclusive`, `activeOpacity`, and
  `hasLongPressHandler`, `gestureTestID`, `rippleColor` when set.
- The v3 detector events are direct events of the codegen event emitter.
  `enqueueNativeEventByTag(surfaceId, detectorTag, type, payload)` with
  `type` `gestureHandlerStateChange`, `gestureHandlerEvent` or
  `gestureHandlerTouchEvent` reaches the `onGestureHandlerStateChange`,
  `onGestureHandlerEvent` and `onGestureHandlerTouchEvent` props. The
  payload arrives unchanged in `nativeEvent` (plus `target` and
  `timeStamp`):
  - state change: `{handlerTag, state, oldState, handlerData: {numberOfPointers, pointerType, x, y, absoluteX, absoluteY, ...}}`
  - update: `{handlerTag, state, handlerData}`
  - touch: `{handlerTag, state, eventType, numberOfTouches, pointerType, changedTouches: [{id, x, y, absoluteX, absoluteY}], allTouches}`
  With `useTapGesture`, the state changes BEGAN → ACTIVE → END to the
  detector call `onBegin`, `onActivate` (with the flattened handler data),
  `onDeactivate` and `onFinalize`.
- The legacy API (`Gesture.Tap()` with `GestureDetector`) renders no
  detector node: it attaches handlers to the child view through the module
  (`attachGestureHandler`), which is a no-op here.

`tests/FantomGestureHandler-itest.js` (needs `react-native-gesture-handler`
in the React Native checkout) checks the v3 detector frame (100x100 at
20,20 around a 100x100 view), the event delivery and payloads, and the
legacy tree.

## TextInput and Switch

The JS bundle uses the Android implementations, which render the native
components `AndroidTextInput` and `AndroidSwitch`. Upstream Fantom does not
register them, so they fell back to the legacy interop with 0-width frames.
The ReactCommon Android versions cannot compile here: they need JNI
(`FabricUIManager.getThemeData`, `AndroidSwitchMeasurementsManager`), the
Android TextLayoutManager API (`measureCachedSpannableById`, `measureLines`) and
`RN_SERIALIZABLE_STATE`. The iOS `TextInputComponentDescriptor` has the name
`TextInput`, which only the iOS JS (`SinglelineTextInputView` /
`MultilineTextInputView`) uses.

- `AndroidTextInput`: `BaseTextInputShadowNode` (the base of the iOS
  `TextInputShadowNode`) with `BaseTextInputProps` + `secureTextEntry`. It
  measures the text, or the placeholder if the text is empty, with the macOS
  TextLayoutManager. Single-line inputs measure with unlimited width; multiline
  inputs wrap to their width.
- `AndroidSwitch`: codegen `AndroidSwitchProps`, leaf node with a fixed
  intrinsic size of 51x31. Explicit `width`/`height` styles override it.

`getA11yTree` keys: `AndroidTextInput` gives `text`, `placeholder` (if not
empty), `defaultValue` (if set; Android JS sends `defaultValue` as `text`),
`editable`, `secureTextEntry`, `multiline`. `AndroidSwitch` gives `value` and
`disabled: true` when disabled.

Known differences from a device:

- No Android `EditText` theme padding. The Android descriptor reads it through
  JNI, so a TextInput without padding styles has 0 padding.
- `secureTextEntry` text is measured unmasked (Android measures bullets).
- 51x31 is the intrinsic size of iOS `UISwitch`, not an Android measurement.
- Baseline alignment of TextInput is not supported (the TextLayoutManager has
  no `measureLines`); Yoga gets only the top padding and border.

## Build

```sh
export JAVA_HOME=/opt/homebrew/opt/openjdk@17 PATH=/opt/homebrew/opt/openjdk@17/bin:$PATH
export ANDROID_HOME=$HOME/Library/Android/sdk ANDROID_SDK_ROOT=$HOME/Library/Android/sdk
# Android SDK cmake 3.30.5 (the default of the gradle files):
#   $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --install "cmake;3.30.5"
# `yarn` on PATH must be yarn 1 (react-native-codegen's build.sh runs `yarn install`
# in a temp directory; yarn 4 uses PnP there and the build fails).
cd third_party/react-native
yarn install
./gradlew :private:react-native-fantom:buildFantomTester --no-daemon
# Output: private/react-native-fantom/build/tester/fantom_tester
```

The gradle task does not rebuild when only `.cpp`/`.mm` files change (its
inputs are the CMake files). For incremental builds, run CMake directly (new
files are picked up through `CONFIGURE_DEPENDS`):

```sh
$ANDROID_HOME/cmake/3.30.5/bin/cmake --build private/react-native-fantom/build/tester --target fantom_tester -j 10
```

## tests/

These Fantom tests are not part of the overlay. To run them, copy them into the
React Native checkout (any `__tests__` directory that the Fantom Jest config
covers) and run `yarn fantom <name>` from the React Native root. In a checkout
without a `BUCK` file, `yarn fantom` uses `private/react-native-fantom/build/tester/fantom_tester`.

```sh
cp native/tests/*-itest.js third_party/react-native/packages/react-native/Libraries/Components/View/__tests__/
cd third_party/react-native
yarn fantom FantomProbe       # View layout and getRenderedOutput with layout metrics
yarn fantom FantomTextProbe   # Text measurement (needs the macOS TextLayoutManager)
yarn fantom FantomA11yTree    # NativeFantom.getA11yTree
yarn fantom FantomInputs      # TextInput measurement and Switch size
yarn fantom FantomInteraction # hitTest, by-tag events, typing, scrolling
yarn fantom FantomScreens     # react-native-screens native stack (see Screens)
yarn fantom FantomGestureHandler # gesture-handler detector (see Gesture handler)
FANTOM_PRINT_OUTPUT=1 yarn fantom FantomA11yTree   # also print the raw binary stdout
```

Note: a full `yarn fantom` run rewrites 12 LogBox `.snap` files (it adds
`maxFontSizeMultiplier` props). Revert them with `git checkout` after the run.
