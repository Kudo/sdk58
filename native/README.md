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
| `tester/CMakeLists.txt` | Adds `react/renderer/components/textinput` (only its cross-platform sources: all `platform/android/.../androidtextinput/*.cpp` files are removed from `rrc_textinput`), `src/components/*.cpp`, and links `rrc_textinput`. Builds the native libraries from npm (react-native-screens, react-native-safe-area-context, react-native-gesture-handler) when they are found (see Native libraries). With `FANTOM_STATIC_HOST` (default `ON`) Hermes (its static archives from the Hermes build), JSI (the `jsi` target defined as `STATIC` here, instead of `ReactCommon/jsi`'s `SHARED` one) are linked statically, and SHA-256 goes through a CommonCrypto shim instead of OpenSSL (`src/stubs/crypto`, `FANTOM_OPENSSL_SHIM`): one executable without dylibs and without Homebrew OpenSSL (see `docs/build-analysis.md`). `FANTOM_HERMES_BUILD_DIR` selects the Hermes build to link (the x86_64 one for `RN_A11Y_HOST_ARCH=x86_64`). The tester source glob uses `CONFIGURE_DEPENDS`, so new source files are found without a manual reconfigure. On macOS (option `FANTOM_MACOS_TEXT_LAYOUT`, default `ON`): enables `OBJCXX`, removes the stub `platform/cxx/.../TextLayoutManager.cpp` from `react_renderer_textlayoutmanager`, adds `src/platform/macos/TextLayoutManager.mm`, and links AppKit, CoreText and Foundation. |
| `tester/src/platform/macos/TextLayoutManager.mm` (new) | Text measurement with AppKit/TextKit 1 (`NSLayoutManager`). Port of the iOS `RCTTextLayoutManager.mm`, `RCTAttributedTextUtils.mm` and `RCTFontUtils.mm`. The upstream stub returns the minimum size (height 0) for all text. |
| `tester/src/render/A11yTree.h`, `A11yTree.cpp` (new) | Serializes the shadow tree (not the mounted tree, so views are not flattened) to typed JSON. |
| `tester/src/components/FantomTextInput.h`, `FantomSwitch.h`, `FantomComponents.cpp` (new) | Shadow nodes for `AndroidTextInput` and `AndroidSwitch` (see below). |
| `tester/src/components/FantomScreens.h`, `FantomScreens.cpp`, `FantomScreensSplitScreen.cpp` (new) | react-native-screens: descriptor registration, context entry, emulated native state updates (see Screens). |
| `tester/src/components/FantomGestureHandler.h`, `FantomGestureHandler.cpp` (new) | react-native-gesture-handler: descriptor registration and the no-op `RNGestureHandlerModule` TurboModule (see Gesture handler). |
| `tester/src/components/FantomExpo.h`, `FantomExpo.cpp` (new) | Expo module views (`@expo/ui`): descriptor provider request for `ViewManagerAdapter_*`, Host shadow node that writes the emulated frames, `matchContents` state, `onGlobalEvent`, tree info (see Expo UI). |
| `tester/src/components/FantomExpoText.h`, `FantomExpoText.cpp` (new) | Text measurement for the @expo/ui layout engine (CoreText through the TextLayoutManager) and the SwiftUI text style sizes. |
| `tester/src/platform/oss/TesterTurboModuleProvider.cpp` | Provides `RNGestureHandlerModule`, `RNCSafeAreaContext` and `StatusBarManager`. |
| `tester/src/components/FantomStatusBarManager.h`, `FantomStatusBarManager.cpp` (new) | `StatusBarManager` TurboModule (union of the Android and iOS specs): `getConstants()` returns `{HEIGHT, DEFAULT_BACKGROUND_COLOR: 0}` with `HEIGHT` = the safe area top inset (`setSafeAreaInsets`, default 0); `getHeight(callback)` calls `callback({height})`; `setStyle`, `setHidden`, `setColor`, `setTranslucent`, `setNetworkActivityIndicatorVisible`, `addListener`, `removeListeners` are no-ops. `StatusBar` caches the constants when it is first evaluated. |
| `tester/src/components/FantomSafeArea.h`, `FantomSafeArea.cpp` (new) | react-native-safe-area-context: descriptor registration, `onInsetsChange` events and `RNCSafeAreaView` state (see Safe area). |
| `tester/src/reanimated/` (new) | react-native-reanimated + react-native-worklets host: `WorkletsModule` and `ReanimatedModule` C++ TurboModules, UI scheduler, frame loop, platform functions (see Reanimated). Built into the `reanimated` library, not into `fantom_tester`. |
| `config/metro-babel-transformer.flow.js` | Adds `react-native-worklets/plugin` (last plugin) to Fantom test bundles when it resolves (see Reanimated). |
| `tester/scripts/codegen-lib.sh` (new) | Runs React Native codegen for a native library (used by CMake for the native libraries). |
| `tester/src/stubs/StubComponentRegistryFactory.h` | Registers the TextInput/Switch descriptors above and the native library descriptors. |
| `tester/src/TesterAppDelegate.cpp` | Adds the react-native-screens context entry and runs the screens and safe-area updates after every mount. With reanimated: provides its TurboModules, sets its clock and produces its frames (see Reanimated). `loadScript` flushes the message queue until the JS runtime pointer is set (at most 30 s, then a fatal error). Upstream flushes once; when the runtime task was queued after that flush, `loadScriptAndRunTests` crashed with SIGSEGV (null `runtime_`, `TesterAppDelegate.cpp:187`). |
| `tester/src/TesterMountingManager.h`, `TesterMountingManager.cpp` | Records the number of the last mounted transaction per surface (`getMountedRevision`). |
| `tester/src/render/HitTest.h`, `HitTest.cpp` (new) | Hit testing with `hitSlop`, and tag lookup in the shadow tree. |
| `tester/src/NativeFantom.h`, `NativeFantom.cpp` | Adds `getA11yTree`, `hitTest`, `enqueueNativeEventByTag`, `enqueueScrollEventByTag`, `setTextInputTextByTag`, `updateScreenStates` (also registered as `updateNativeStates`), `setScreensHeaderHeight`, `setSafeAreaInsets` and `getCapabilities`. They are registered in `methodMap_` in the constructor, not in the codegen spec, so the overlay does not need a change to `packages/react-native`. |

Signatures of the added `NativeFantom` methods (Flow):

```js
// includeMountedProps defaults to true (see "Mounted values" below).
getA11yTree: (
  surfaceId: RootTag,
  includeDebugProps?: ?boolean,
  includeMountedProps?: ?boolean,
) => string;
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
// JSON array of feature strings: always "getA11yTree", "getA11yTree.mounted",
// "mountedProps", "hitTest", "eventsByTag", "setTextInputText",
// "updateNativeStates", "statusBarManager", "textInput", "switch",
// "shadowTreeRevision", "mountedRevision", "effectiveBackground"; and, when
// built in, "textLayout" (macOS text measurement), "safeArea", "screens",
// "gestureHandler", "worklets", "reanimated".
getCapabilities: () => string;
// Number of the surface's current shadow tree revision (increases on every
// commit, including state updates) and of the last mounted transaction (-1
// before the first mount). Equal numbers: everything committed is mounted.
getShadowTreeRevision: (surfaceId: RootTag) => number;
getMountedRevision: (surfaceId: RootTag) => number;
```

The by-tag methods throw a `JSError` if the tag is not in the surface's
current shadow tree (or, for the scroll and text methods, if the node is not a
ScrollView / AndroidTextInput). Like the node-based Fantom methods, they only
enqueue: call `NativeFantom.flushEventQueue()` and then `Fantom.runWorkLoop()`
(this is what `Fantom.runOnUIThread` + `runWorkLoop` do).

## Host protocol and host info

`getCapabilities()` contains `"protocolVersion:<n>"` (currently
`"protocolVersion:1"`), and `NativeFantom.getHostInfo()` returns a JSON
string:

```json
{"protocolVersion": 1, "rnVersion": "0.88.0-rc.3", "buildType": "Release",
 "sanitize": false, "engines": {"swiftui": true, "compose": true},
 "fonts": {"roboto": true}}
```

`buildType` is the tester's `CMAKE_BUILD_TYPE`; `sanitize` is true in an
AddressSanitizer / UndefinedBehaviorSanitizer build; `engines` are the
@expo/ui layout engines compiled in; `fonts.roboto` says whether the embedded
Roboto registered (calling `getHostInfo()` registers it if needed). The CLI
compares `protocolVersion` with `host-version.json` / `SUPPORTED_PROTOCOL` in
`src/host.ts`.

`protocolVersion` (`kHostProtocolVersion` in `tester/src/NativeFantom.cpp`)
is bumped when a change is incompatible for the CLI: a NativeFantom method is
removed or renamed, its arguments or return value change meaning, or the
`getA11yTree` node shape changes (a field removed, renamed or with another
type). New methods, new capabilities and new optional node fields do not bump
it; they are announced through `getCapabilities()`.

## Device metrics (Dimensions, PixelRatio)

ReactCxxPlatform's `DeviceInfoModule` returns a fixed 1280x720 with scale 0
(so `Dimensions.get('window')` was 1280x720 and `PixelRatio.get()` 0 under
every preset). The tester registers its own `DeviceInfo` TurboModule
(`components/FantomDeviceInfo.{h,cpp}`, the `NativeDeviceInfo` spec) before
it:

- `getConstants()` → `{Dimensions: {window, screen}}`, both
  `{width, height, scale, fontScale}` from the current device metrics.
- Defaults: the last started surface (its viewport size and
  `devicePixelRatio`, font scale 1); before the first surface the tester
  window size (1280x720), scale 3, font scale 1.
- `NativeFantom.setDeviceMetrics({width, height, scale?, fontScale?})` sets
  them (missing fields keep their values; later surfaces no longer change
  them). A change emits `didUpdateDimensions` with `{window, screen}` through
  `__rctDeviceEventEmitter` (TurboModule::emitDeviceEvent), so `Dimensions`
  listeners and `useWindowDimensions()` update.
- The safe-area `initialWindowMetrics` frame uses the same metrics.
- `getCapabilities()` has `"deviceMetrics"`.

`tests/FantomDeviceMetrics-itest.js`: default 390x844 scale 3 for a 390x844
surface; after `setDeviceMetrics({width: 412, height: 915, scale: 2.625,
fontScale: 1.3})`, `Dimensions` (window and screen), `PixelRatio.get()` /
`getFontScale()` and a `useWindowDimensions()` component return the new values;
a later surface does not override them.

## Mounted values in getA11yTree

`getA11yTree` serializes the shadow tree. Some changes only reach the mounted
views: Reanimated layout animations (`entering`, `exiting`, layout
transitions) are applied as mounting overrides and never change the shadow
tree. With `includeMountedProps` (third argument, default `true`), every node
whose mounted view (the Fantom mounting manager's view tree, the data of
`getRenderedOutput`) differs from the shadow node gets
`mounted: {opacity?, transform?, backgroundColor?, frame?}` with the mounted
values. Only these four fields are compared. `frame` is compared only when the
mounted parent is the shadow parent (a flattened ancestor changes the mounted
origin). Flattened nodes have no mounted view and never get `mounted`. Example
(`entering={FadeIn}`): after 150 ms of frames the node has no `opacity` (1 in
the shadow tree) and `mounted: {opacity: 0.5}`; when the animation is done,
`mounted` is absent.

`hitTest` uses the shadow tree only (not the mounted values), so a view in the
middle of a layout animation is hit at its final layout.

## effectiveBackground in getA11yTree

`effectiveBackground` (`rgba(r, g, b, a)`) is the background behind a node's
content: the `backgroundColor` of every ancestor and of the node (the mounted
value when it differs, see above), alpha-composited (source over) in order,
starting from the window background, white `rgba(255, 255, 255, 1)`. Opacity,
images, gradients, borders and shadows are not included. It is emitted on
every `Paragraph` and on other laid-out nodes when it differs from the node's
own `backgroundColor` (so an opaque background is not repeated). Example:
white text in a `#1e6fff` button has `effectiveBackground`
`rgba(30, 111, 255, 1)`; a `rgba(0, 0, 255, 0.5)` view on white gives
`rgba(127, 127, 255, 1)`.

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
| `react-native-worklets` `0.13.0` + `react-native-reanimated` `4.7.0` | `worklets`, `reanimated` (both packages or neither) | worklets `Common/cpp/worklets/**/*.cpp`; reanimated `Common/cpp/reanimated/**/*.cpp`, `Common/NativeView/.../rnreanimated/*.cpp` (its `ComponentDescriptors.h` shadows the codegen one) and `tester/src/reanimated/*.cpp` |
| `expo-modules-core` `~58.0.9` (with `@expo/ui` `~58.0.9`: `FANTOM_WITH_EXPO_UI`) | `expomodulescore` (no codegen) | `common/cpp/fabric/*.cpp` |
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
  `frameSize` is the Yoga size; the offset is the screen's content origin
  offset (like iOS, the screen covers the whole stack and its content starts
  below the header). The host registers its own `RNSScreen` descriptor (the
  library's non-Android `adopt` plus a bottom padding of `contentOffset.y`),
  so the content wrapper ends at the bottom of the screen: its height is the
  screen height minus the offset (844 - 103 = 741 with a 47 dp top inset and
  a 56 dp header), the area shown below the header. No padding when the
  offset is 0 (translucent, large title, hidden header).
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

Screen events (also after every mount): `onHeaderHeightChange`
`{headerHeight}` (top inset + header height; 0 without a visible header)
when it changes; and for each `RNSScreenStack` whose top screen (the last
`RNSScreen` child) changed, what a native stack sends for a push/pop without
animation: `onWillDisappear` to the previous top (if it is still in the
stack), `onWillAppear` to the new top, then `onDisappear` and `onAppear`.
The initial top screen gets `onWillAppear` + `onAppear`. No `onDismissed`
(screens removed by JS are already unmounted; a dismissal from the native
side does not exist here), no `onTransitionProgress`. With
`@react-navigation/native-stack` this gives `transitionStart`/`transitionEnd`
events; `focus`/`blur` and `useFocusEffect` come from the navigation state.

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
- The `RNCSafeAreaContext` TurboModule is provided: `getConstants()`
  returns `{initialWindowMetrics: {frame: {x: 0, y: 0, width, height},
  insets}}` with the size of the most recently started surface (or the
  tester's `--windowWidth`/`--windowHeight`) and the current insets. The JS
  reads it once, when `react-native-safe-area-context` is first evaluated, so
  call `setSafeAreaInsets` before that.

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

## Reanimated (react-native-reanimated, react-native-worklets)

The Common C++ of both packages runs with host code in
`tester/src/reanimated/` (C++ versions of the iOS `WorkletsModule.mm`,
`ReanimatedModule.mm`, `IOSUIScheduler.mm` and `PlatformDepMethodsHolderImpl.mm`).
Guard: `FANTOM_WITH_REANIMATED`.

- TurboModules: `WorkletsModule.installTurboModule(false)` creates the
  `WorkletsModuleProxyInitializer`, runs `prepareProxy()` synchronously (it
  creates the UI worklet runtime, a second Hermes runtime) and `finalize()`;
  `start()` starts the UI runtime. `ReanimatedModule.installTurboModule()`
  gets the UI runtime and UI scheduler from `__UI_WORKLET_RUNTIME_HOLDER` /
  `__UI_SCHEDULER_HOLDER`, creates `ReanimatedModuleProxy` + `init`, calls
  `RNRuntimeDecorator::decorate`, `initializeFabric(scheduler->getUIManager())`,
  adds a Scheduler `EventListener` (`handleRawEvent`), and registers
  `performOperations` with the frame loop. `REASharedTransitionBoundary` is
  registered.
- Threads: the Fantom main thread is the JS thread and the UI thread.
  `scheduleOnUI` runs the job immediately (like iOS on the main thread); a
  job from another thread is queued until the next frame.
- Frames (`FrameLoop`): a frame drains queued UI jobs, runs the worklets
  `requestAnimationFrame` callbacks, then the reanimated `requestRender`
  callbacks (both with the frame time in ms), then
  `ReanimatedModuleProxy::performOperations()`, which commits the animated
  props to the shadow tree (`mountSynchronously`). Frames are produced:
  - once per 16.333 ms step of `NativeFantom.produceFramesForDuration` (after
    the UI tick), so the CLI `wait` action advances animations;
  - once at the end of every `flushMessageQueue` (every `Fantom.runWorkLoop`),
    at the current time, so a shared value set from JS is in the tree after
    the work loop. If the frame queues JS work (`runOnJS`), the queue is
    flushed again (at most 8 times).
  `_maybeFlushUIUpdatesQueue` calls `performOperations` at once when no frame
  runs and no `requestRender` callback waits (iOS: display link paused).
- Clock: `_getAnimationTimestamp` and frame times are `StubClock` in ms (the
  clock of C++ Animated). Only `produceFramesForDuration` moves it; the mocked
  JS timers are separate (the CLI advances both by the same slice).
- Defines, from the packages: `WORKLETS_VERSION` and `REANIMATED_VERSION`
  (`package.json`; the JS checks them), `WORKLETS_FEATURE_FLAGS` and
  `REANIMATED_FEATURE_FLAGS` (`"[NAME:value]..."` from
  `src/featureFlags/staticFlags.json` defaults, as the podspecs build them).
  So `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` and `USE_ANIMATION_BACKEND` are false:
  all updates are shadow tree commits. Debug build (no `NDEBUG`). Library
  warnings are off (`-Wno-everything`).
- No-ops: sensors, keyboard events, gesture handler state, pseudo selectors
  (`:hover` etc.), `forceScreenSnapshot`, `synchronouslyUpdateUIProps` (logs a
  warning; not called with the flags above), slow animations. Worklet
  `fetch` fails with a network error. Bundle Mode is not supported
  (`installTurboModule(true)` throws). Worklets logging (`PlatformLogger`,
  `nativeLoggingHook`) goes to glog (stderr).
- Layout animations (`entering`, `exiting`, `layout`) change the mounting
  transaction, not the shadow tree: `getA11yTree` shows the final props
  during the animation; `getRenderedOutput` (the mounted views) shows the
  animated ones (`FadeIn`: opacity 0, 0.5 at half time, then no `opacity`).
- Transforms are in `getA11yTree` as `transform` (4x4 matrix, translateX at
  index 12); `frame` is the untransformed layout.

Fantom tests (`tests/FantomReanimated-itest.js`):

- Fantom defines `global.jest = {fn}`. Reanimated then thinks it runs in
  Jest (`IS_JEST`) and uses its JS implementation. Import
  `tests/fantomReanimatedPrelude.js` (it deletes `global.jest`) before
  reanimated.
- The modules serialize worklets when they load, which creates WeakRefs;
  Fantom allows that only inside the event loop. Load them with `require`
  inside `Fantom.runTask` (the test does it in `beforeAll`).
- The Babel plugin runs before Flow types are removed and parses the worklet
  source again: a `'worklet'` function with Flow annotations fails with
  `[Worklets] Babel plugin exception: ... Unexpected token, expected ","`.
  TypeScript is not affected.

The test checks: `withTiming(200, {duration: 300})` on `width` is 100 after
150 ms of frames and 200 after 350 ms; a shared value set from JS gives
`transform[12] === 42`; `entering={FadeIn}` gives mounted opacity 0, 0.5,
then 1; `runOnUI` + `runOnJS` returns from the UI runtime; frames and mocked
timers advanced together (as the CLI) agree.

## Expo UI (@expo/ui, expo-modules-core)

Step 1 (load and render). Every `@expo/ui` primitive is a Fabric view named
`ViewManagerAdapter_ExpoUI_<View>` (`requireNativeView('ExpoUI', '<View>')`),
all with expo-modules-core's `expo::ExpoViewComponentDescriptor<>`
(`common/cpp/fabric`, built as the `expomodulescore` library).

Native:

- Registration: a `ComponentDescriptorProviderRegistry` request handler
  (`registerExpoViewComponentDescriptors`): the first time an unknown
  component name starting with `ViewManagerAdapter_` is used, it registers
  `ExpoViewComponentDescriptor` with that name as flavor, as on iOS
  (`ExpoFabricViewObjC componentDescriptorProvider`). So every Expo module
  view, of either name set, works without a list:
  - iOS (SwiftUI, `ios/ExpoUIModule.swift`, 69 views): `HostView`,
    `VStackView`, `HStackView`, `ZStackView`, `TextView`, `Button`,
    `ToggleView`, `SliderView`, `SpacerView`, `ImageView`, `ListView`, ...
  - Android (Compose, `android/.../ExpoUIModule.kt`, 93 views): `HostView`,
    `ColumnView`, `RowView`, `BoxView`, `TextView`, `Button`,
    `OutlinedButton`, `TextButton`, `SwitchView`, `CheckboxView`,
    `SliderView`, `SpacerView`, ...
  - The Android bundle (`--platform android`) with the universal entry
    (`@expo/ui`) resolves `index.android.tsx` and emits the Compose names
    (Host → `HostView`, Column → `ColumnView`, Text → `TextView`, Button →
    `Button`, Switch → `SwitchView` + a `RowView`/`TextView` for its label).
    `@expo/ui/swift-ui` emits the SwiftUI names on any platform.
- Props: `ExpoViewProps::propsMap`, every raw prop (including RN style
  props such as `flex`).
- `getA11yTree`: `type` is `ExpoUI.<View>` (`Expo.<Module>_<View>` for
  other Expo module views); `expo` is the full `propsMap` (with `modifiers`
  verbatim); `accessibilityLabel`, `accessibilityHint`, `accessibilityValue`
  (`{text}`) and `testID` come from the modifiers `accessibilityLabel`
  (`label`), `accessibilityHint` (`hint`), `accessibilityValue` (`value`),
  Compose `semantics` (`contentDescription`), `testID` (`testID`) and
  `accessibilityIdentifier` (`identifier`) when they are not props.
  `layout`: `"emulated"` on a Host sized by `matchContents`,
  `"placeholder"` on the other `@expo/ui` views: their frames are Yoga's
  (no SwiftUI/Compose layout yet; usually height 0), not the drawn frames.
- Frames (layout emulation): `ViewManagerAdapter_ExpoUI_HostView` gets
  `ExpoViewComponentDescriptor<FantomExpoHostShadowNode>`. Its `layout()`
  override runs the Yoga pass first (the Host's own frame comes from its RN
  style; the nested Expo views get placeholder frames), then calls
  `layoutExpoHostSubtree(host, hostSize)`, which returns the frame of every
  Expo view under the Host (relative to its parent) and the content size,
  and writes them: each such child is cloned (`clone({})`, a new unsealed
  node: the Yoga pass can leave shared, sealed nodes in the subtree), its
  `LayoutMetrics.frame` is replaced (displayType, layoutDirection and
  pointScaleFactor stay the Yoga ones), and it replaces the old child with
  `YogaLayoutableShadowNode::replaceChild` (keeps the Yoga tree in sync),
  recursively. `getA11yTree`, `hitTest` and `getBoundingClientRect` read
  these frames. When the subtree is not dirty, the Host's `layout()` is not
  called and the frames of the previous revision stay (the nodes are shared).
- `RNHostView` (RN content in SwiftUI/Compose) stays a Yoga leaf that
  measures its first child (the library's `expoInternalSizeFromChildren`
  path); the emulated layout places it (its frame gets the emulated origin
  and its measured size) and its RN children keep their Yoga layout relative
  to it. No content origin offset is needed because the frame itself is the
  emulated one.
- `layoutExpoHostSubtree` runs the layout engine. A Host whose subtree has
  only SwiftUI view names (the iOS names, plus the names both platforms use:
  `TextView`, `Button`, `SpacerView`, ...) goes through the SwiftUI engine
  (`tester/src/expoui/layout/`, built with `FANTOM_EXPO_UI_LAYOUT_ENGINE`
  when `FANTOM_WITH_EXPO_UI`; `getCapabilities()` has
  `"expoUI.swiftUILayout"`):
  - Input: each Expo view becomes an engine node: `type` from the view name
    (`VStackView` → `VStack`, `TextView` → `Text`, `ToggleView` → `Toggle`,
    `ScrollViewComponent` → `ScrollView`, `SlotView` → `Slot`, ...; others
    drop the `View` suffix and are reported unsupported), `props` =
    `propsMap` without `modifiers`, `modifiers` = `propsMap.modifiers`,
    children in order (non-Expo children are skipped). The Host's children
    are the root's children. An `RNHostView` becomes a leaf `RNHost` with
    its measured Yoga size (`props.width`/`height`).
  - Metrics: `ControlMetrics::ios()` by default,
    `NativeFantom.setExpoUIPlatform('macos')` for `ControlMetrics::macos()`
    (`'ios'` to go back; applies at the next layout of a Host). The pixel
    grid is the Host's `pointScaleFactor`.
  - Text: `measureExpoText` (CoreText TextLayoutManager) at the engine's
    point sizes. SF Symbols: a table of sizes measured on the iOS 26.5
    simulator at 17 pt (star, heart, gearshape, chevron.right, ...), scaled
    by the point size; other names are 1.2 x 1.1 times the point size.
  - Output: the engine's frames are relative to the Host; they are converted
    to frames relative to the parent. Nodes without an engine frame (Slot
    views, nested Text spans, Picker options, unsupported views) get the
    union of their children's frames, or an empty frame at the parent's
    origin. The engine's `host` size is the `matchContents` content size.
  Any other Host (a Compose-only name such as `ColumnView`, `RowView`,
  `SwitchView`) goes through the Compose engine (`tester/src/expoui/compose/`,
  `FANTOM_EXPO_UI_COMPOSE_ENGINE`, built when the embedded fonts are;
  `getCapabilities()` has `"expoUI.composeLayout"`; checked against real
  Compose Desktop by `tools/compose-layout-test`):
  - Input: as above with the Android names (`ColumnView` → `Column`,
    `RowView` → `Row`, `BoxView` → `Box`, `FlowRowView` → `FlowRow`,
    `SpacerView` → `Spacer`, `TextView` → `Text`, `SwitchView` → `Switch`,
    `CheckboxView` → `Checkbox`, `SliderView` → `Slider`, `TextFieldView` →
    `TextField`, `IconView` → `Icon`, `SlotView` → `Slot` (its `slotName`),
    `RNHostView` → `RNHost`; the button names stay). The root is a `Host`
    node whose children are the Host's children (a Compose Host can have
    several). A Text with `spans` (nested Text) is measured as the
    concatenated text without the span styles (reported unsupported).
  - Metrics: `compose::ControlMetrics` (Material 3, observed with
    compose-ref) with density = the Host's `pointScaleFactor` (px =
    `round(dp * density)`, as on Android), font scale 1, 48 dp touch targets.
  - Text: `FantomComposeText` (CoreText with the embedded Roboto, see below):
    widths and line counts; the engine computes line heights like Skia.
  - Output: converted as above.
  A Host with only shared names (for example a single `TextView`) goes to the
  SwiftUI engine. Without the engines the Expo views keep their Yoga frames
  (empty hook result).
- Embedded Roboto (`native/fonts/roboto`: Roboto 2.138 Regular, Medium,
  Bold, Italic, Apache 2.0): `tester/cmake/embed-files.cmake` gzips the TTFs
  at build time into a generated source of byte arrays (the
  `fantom_embedded_fonts` library, 834 KB; linked into the TextLayoutManager
  target with `FANTOM_WITH_EMBEDDED_FONTS`), and
  `platform/macos/EmbeddedFonts.mm` inflates them (libcompression) and
  registers them for the process (`CTFontManagerRegisterGraphicsFont`) on
  first use: the first `fontFamily: "Roboto…"` text or the first Compose
  Host (about 6 ms). `fontFamily: "Roboto"` in React Native text then
  resolves to Android's font (`tests/FantomRoboto-itest.js`: "Hello world"
  at 14 pt is 70.33 wide, 72.67 in the system font). Other weights map to
  the nearest face (100-450 Regular, 500 Medium, 600-900 Bold); every italic
  uses Italic (Roboto-MediumItalic and -BoldItalic are not embedded, about
  460 KB more gzipped), so italic text at weight 500 or more is measured with
  the regular Italic: 1-2 px narrower than on Android at 14 sp (compose-ref,
  densities 1 to 3.5). `FANTOM_FONTS_DIR` overrides the fonts directory (default
  `<node_modules>/../native/fonts`).
- Host `matchContents` (`matchContentsHorizontal`/`matchContentsVertical`
  props): after every mount (and on `updateNativeStates`) the host dispatches
  `ExpoViewState::withStyleDimensions` with the content size of
  `layoutExpoHostSubtree` (proposal: the Host's width, unbounded height),
  like the platform's `ShadowNodeProxy.setStyleSize`, and the library's
  `ExpoViewComponentDescriptor::adopt` writes it into the Yoga width/height.
- Text measurement for the engine: `measureExpoText(text, options)`
  (`components/FantomExpoText.h`; `fontFamily`, `size`, `weight`, `italic`,
  `design` rounded/serif/monospaced, `maxWidth`, `maxLines`) on the
  CoreText TextLayoutManager, and `swiftUITextStyle(name)`: largeTitle 34,
  title 28, title2 22, title3 20, headline 17 semibold, body 17, callout 16,
  subheadline 15, footnote 13, caption 12, caption2 11 (iOS sizes at the
  default Dynamic Type size). Also callable from JS:
  `NativeFantom.measureExpoText(text, {textStyle?, size?, weight?, italic?,
  design?, fontFamily?, maxWidth?, maxLines?, pointScaleFactor?})` →
  `{width, height}`. "Hello" on macOS (SF, pointScaleFactor 3): body
  39 x 20.33, title 62.33 x 33.33, largeTitle 75.33 x 40.33, headline 41 x
  20.33, caption 29 x 15.33.
- Modifier callbacks (`onGlobalEvent`):
  `NativeFantom.dispatchExpoModifierEvent(tag, type, params?)` dispatches
  the direct event `globalEvent` with `{[type]: params, payload: [type,
  params]}` (the SwiftUI JS reads the top-level keys, the Compose JS reads
  `payload`), for example `('onTapGesture', {})` for the `onTapGesture`
  modifier. Modifier callbacks are functions in JS; in `propsMap` they are
  `"eventListener": null`, so a runner can find them by `$type`. The tag is
  searched in all surfaces; it throws if the node is not an Expo view.
- Events: `onX` props are direct events `topX`; send them with
  `enqueueNativeEventByTag(surfaceId, tag, 'x', payload)`: SwiftUI Button
  `buttonPress`, Compose Button `buttonPressed`, Compose Switch
  `checkedChange` `{value}`, SwiftUI Toggle `isOnChange` ... (the name
  without `on`, first letter lower case). They reach the JS callbacks
  (`onPress`, `onValueChange`).
- `getCapabilities()` has `"expoUI"`.

JS prelude (`tests/fantomExpoUIPrelude.js`; import it before anything that
imports `expo`, `expo-modules-core` or `@expo/ui`):

1. `installExpoGlobalPolyfill()` from
   `expo-modules-core/src/polyfill/dangerous-internal` (the web
   `globalThis.expo`: `EventEmitter`, `NativeModule`, `SharedObject`,
   `SharedRef`, `modules: {}`).
2. `globalThis.expo.getViewConfig(moduleName, viewName)`: the per-view
   config from `native/tools/expo-view-configs/out/viewConfigs.json` (the
   generator in that directory, 152 view names), entry
   `views['ViewManagerAdapter_<module>_<view>']`, with the `ios` and
   `android` `validAttributes` and `directEventTypes` merged (the JS
   component's platform, swift-ui or jetpack-compose, is not the bundle
   platform). Views not in the table fall back to the union of all @expo/ui
   prop names (`validAttributes[name] = true`) and event names
   (`directEventTypes['top' + name.slice(2)] = {registrationName: name}`)
   from `tests/fantomExpoUIViewConfig.json` (367 props, 46 events,
   `native/scripts/gen-expo-ui-view-config.py node_modules/@expo/ui`). The
   Fantom test uses a copy of `viewConfigs.json` named
   `fantomExpoUIViewConfigs.json` next to the prelude.
   React Native (bridgeless) merges these with the base View config, so
   style props still work; a prop that is not in `validAttributes` is not
   sent to native. `children`, `key`, `ref` and `style` must not be in the
   list (a React element prop fails with "JS Symbols are not convertible to
   dynamic").
3. Module stubs in `globalThis.expo.modules` (`requireNativeModule` reads
   them): `ExpoUI` (`ObservableState` and `WorkletCallback` classes extending
   `SharedObject`, `ViewPrototypes: {}`, `completeRefresh`, `withAnimation`,
   `isDynamicColorAvailable: false`, `getMaterialColors: () => ({})`,
   `SwitchDefaultIconSize`, `ToggleButtonIconSize`,
   `ToggleButtonIconSpacing`), `ExpoAsset` (`downloadAsync`),
   `ExponentConstants`/`ExpoConstants` (`manifest: null`, ...).
4. Development bundles only (`__DEV__`, the Fantom tests): `expo`'s
   `Expo.fx` opens a dev-server socket from the SourceCode `scriptURL`, which
   is `''` in the host (`new URL('')` throws). The prelude sets
   `NativeSourceCode.getConstants = () => ({scriptURL: null})`. Production
   bundles (the CLI) do not need it.
5. Load `@expo/ui` inside the event loop (`Fantom.runTask`) in Fantom tests,
   like reanimated.

No resolver alias is needed: `expo` (58.0.0) resolves normally, and the
`@expo/ui/swift-ui`, `@expo/ui/jetpack-compose` subpaths through the
package `exports`.

`tests/FantomExpoUI-itest.js` (needs `expo`, `@expo/ui` in the React Native
checkout; CI does both steps):

```sh
cp native/tools/expo-view-configs/out/viewConfigs.json \
  third_party/react-native/packages/react-native/Libraries/Components/View/__tests__/fantomExpoUIViewConfigs.json
(cd third_party/react-native && corepack yarn@1.22.22 add -W --ignore-scripts --no-lockfile \
  expo@58.0.0 expo-modules-core@58.0.9 @expo/ui@58.0.9)
```

The test: universal `<Host matchContents><Column spacing={8}><Text>Hello</Text>
<Button label="Go"/><Switch value label="Remember"/></Column></Host>` gives
`ExpoUI.HostView > ExpoUI.ColumnView > [ExpoUI.TextView, ExpoUI.Button >
ExpoUI.TextView, ExpoUI.RowView > [ExpoUI.TextView, ExpoUI.SwitchView]]`;
`buttonPressed` calls `onPress`, `checkedChange {value: false}` calls
`onValueChange(false)`. SwiftUI `<Host style={{flex: 1}}><VStack spacing={8}>
<Text modifiers={[accessibilityLabel('Greeting'), ...]}>Hello</Text><Button
label="Go"/><Toggle isOn label="Remember"/></VStack></Host>` gives
`ExpoUI.HostView > ExpoUI.VStackView > [ExpoUI.TextView, ExpoUI.Button,
ExpoUI.ToggleView]` with the Text's `accessibilityLabel`/`accessibilityHint`;
`buttonPress` calls `onPress`. Compose engine frames (pointScaleFactor 3,
relative to the parent) of the universal tree: Host and Column 128.333 x
128.333 (`matchContents` on both axes), Text "Hello" 32.333 x 16.333 (14 sp),
Button (0, 24.333) 65.667 x 48 with its Text at (24, 16), Row (0, 80.333)
128.333 x 48 with Text "Remember" at (0, 16) 68.333 x 16.333 and the Switch
at (76.333, 0) 52 x 48; `hitTest` at the Button's center returns its Text
child (path contains the Button); the SwiftUI Text's `onTapGesture` fires
through `dispatchExpoModifierEvent`. An `RNHostView` with a 100x30
`Pressable` under a SwiftUI Text is placed below it, 100x30, and `hitTest`
reaches the `Pressable`. `measureExpoText` sizes are logged.

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

iOS bundles (`--platform ios`, e.g. `--preset ios-phone`) render
`RCTSinglelineTextInputView` / `RCTMultilineTextInputView`, which Fabric maps
to `TextInput` (`componentNameByReactViewName`), and `RCTSwitch` (Fabric:
`Switch`):

- `TextInput`: ReactCommon's iOS `TextInputComponentDescriptor` /
  `TextInputShadowNode` / `TextInputProps`, registered as they are (plain C++;
  the tester CMake compiles `platform/ios/.../iostextinput/*.cpp`, since
  `rrc_textinput` only builds the Android variant). Measured with the macOS
  TextLayoutManager like `AndroidTextInput`; `setTextInputTextByTag` and the
  typed-text readback work for both.
- `Switch`: tester-side leaf on the codegen `SwitchProps` /
  `SwitchEventEmitter`, 51x31 (UISwitch); iOS `Switch.js` also styles it
  51x31.

`getA11yTree` keys: `AndroidTextInput` gives `text`, `placeholder` (if not
empty), `defaultValue` (if set; Android JS sends `defaultValue` as `text`),
`editable`, `secureTextEntry`, `multiline`. `AndroidSwitch` gives `value` and
`disabled: true` when disabled. The iOS `TextInput` and `Switch` give the same
keys (`editable` / `secureTextEntry` from the iOS `traits`).

Known differences from a device:

- No Android `EditText` theme padding. The Android descriptor reads it through
  JNI, so a TextInput without padding styles has 0 padding.
- `secureTextEntry` text is measured unmasked (Android measures bullets).
- 51x31 is the intrinsic size of iOS `UISwitch`, not an Android measurement.
- iOS: a multiline TextInput measures taller than a single-line one with the
  same text (22.333 vs 17.333 for a one-line placeholder at 14 pt); this comes
  from ReactCommon's iOS `TextInputShadowNode`, measured here with CoreText,
  and was not compared with a device.
- Baseline alignment of TextInput is not supported (the TextLayoutManager has
  no `measureLines`); Yoga gets only the top padding and border.

## Build

`bun run build:host` (`scripts/build-host.sh`) builds the host into
`native/dist/<arch>/rn-a11y-host`, a single executable that only links
system libraries (`FANTOM_STATIC_HOST`). `RN_A11Y_HOST_BUILD_TYPE` selects the tester build type:
`Release` (default; ThinLTO, `-dead_strip`, `strip -x`), `MinSizeRel` (same with
`-Os`) or `Debug`. Gradle only builds the prerequisites
(`:private:react-native-fantom:prepareAllDependencies`: Hermes, third-party
sources, codegen), because its `configureFantomTester` task hardcodes
`CMAKE_BUILD_TYPE=Debug`; the script configures the tester with the same
arguments into `private/react-native-fantom/build/tester-<type>` with Ninja.
Times and sizes: `docs/build-analysis.md`.

`RN_A11Y_HOST_ARCH=arm64|x86_64|universal` (default: the build machine's
architecture). A foreign architecture (x86_64 on an arm64 Mac) is cross-built
with `CMAKE_OSX_ARCHITECTURES`: first Hermes for it
(`ReactAndroid/hermes-engine/build/hermes-<arch>`, rebuilt when the Hermes
source revision changes; its build imports the native hermesc through
`IMPORT_HOST_COMPILERS`, so no Rosetta is needed to build), then the tester in
`build/tester-<type>-<arch>`, into `native/dist/<arch>/rn-a11y-host` (+ dSYM).
`universal` builds both slices and joins them (and the dSYMs) with `lipo` into
`native/dist/universal/`. `scripts/release-host.ts --pack` makes its own
universal file when `native/dist/arm64` and `native/dist/x86_64` both exist.
Running the x86_64 slice on an arm64 Mac needs Rosetta; CI checks it on an
Intel runner.

Release and MinSizeRel compile with `-g`; the script writes
`native/dist/<arch>/rn-a11y-host.dSYM` (about 170 MB) before stripping the
binary, so crash reports can be symbolicated with `atos -o
rn-a11y-host.dSYM/Contents/Resources/DWARF/rn-a11y-host -arch arm64 -l <load
address> <addresses>`. CMake is re-configured when the script's arguments change.

`RN_A11Y_HOST_SANITIZE=1 bun run build:host` builds a host with
AddressSanitizer and UndefinedBehaviorSanitizer into
`private/react-native-fantom/build/tester-<type>-sanitize/fantom_tester`
(Debug by default; `RN_A11Y_HOST_BUILD_TYPE=Release` keeps `NDEBUG`, which
matters: React Native's release code paths differ, for example
`ShadowNode::getSealed()` is always true; not copied to `native/dist`; with `-DFANTOM_SANITIZE=ON` folly's
`SanitizeLeak.cpp` is compiled in). Run it through the CLI with
`RN_A11Y_HOST_BIN=<that path> ASAN_OPTIONS=detect_leaks=0:detect_container_overflow=0`
(container-overflow reports are false positives: Hermes' static libraries are
not instrumented). The sanitizer flags name `vptr` explicitly
(clang 21 / Xcode 26.6 leaves it out of `undefined`, Xcode 26.3 includes it).
It is turned off for the `reanimated` and `rngesturehandler` targets only:
both cast shadow nodes to a sibling type on purpose to reach protected
`ShadowNode` members (`ReanimatedCommitHook` casts the root to
`ReanimatedCommitShadowNode`; `RNGestureHandlerDetectorShadowNode::unflattenNode`
casts each child to the detector type); the types add no data and only base
members are touched. Our own code keeps the check. `RN_A11Y_OVERLAY_DIR` builds from another copy of the
overlay (for example `git checkout-index --prefix=/tmp/idx/ -- $(git ls-files native/overlay)`).

### Linux

On Linux (x86_64; CI: `.github/workflows/linux-host.yml` on `ubuntu-24.04`)
`bun run build:host` writes `native/dist/x86_64/rn-a11y-host` (Linux arm64:
`native/dist/arm64/`). Requirements: JDK 17 (`JAVA_HOME`, default: the JDK of
`java` on `PATH`), the Android SDK (`ANDROID_HOME`, default
`~/Android/Sdk`; only its CMake 3.30.5 and an NDK are used), clang (`CC`/`CXX`
default to `clang`/`clang++`), `ld.lld` (used when it is on `PATH`), the static
ICU and OpenSSL archives (Ubuntu: `libicu-dev`, `libssl-dev`) and `rsync`. On
arm64, where the SDK CMake does not run, the script puts the system `cmake` and
`ninja` in its place. Release links with `-ffunction-sections -fdata-sections`
and `--gc-sections`, without ThinLTO and `-g`; the stripped binary has its
symbol table in `rn-a11y-host.debug` next to it (GNU debug link).

The binary links only glibc dynamically. The tester CMake does this for the
static host off Apple: `-static-libstdc++ -static-libgcc`, `libatomic.a`
(at the end of the link line), and ICU (`FANTOM_STATIC_ICU`, default ON:
`libicui18n.a libicuuc.a libicudata.a`; Hermes uses ICU for collation,
normalization, case mapping and date formatting where macOS uses
CoreFoundation).

Text: `FANTOM_TEXT_LAYOUT` selects the TextLayoutManager (`macos`: CoreText,
the default on Apple; `cxx`: the upstream `platform/cxx` stub, the default
elsewhere, which measures every text as 0x0). `build-host.sh` passes
`RN_A11Y_HOST_TEXT_LAYOUT` (default `cxx`) on Linux. Without `macos` there is
no `textLayout` capability and no `expoUI.composeLayout` (the Compose engine
needs the CoreText text adapter).

Third-party code that builds only with libc++ or only on Apple is fixed off
Apple in the tester CMake, without changes in `node_modules` or the submodule:

- `src/platform/compat/StdIncludes.h` is force-included
  (`fantom_force_std_includes`) into `jsinspector_network`, `react_debug`,
  `worklets` and `reanimated`: standard headers that libc++ includes
  transitively and libstdc++ does not (`<cstdint>`, `<algorithm>`, ...).
- `tester/patches/*.patch` are applied at configure time to copies in
  `<build>/patched/<package>/` (`fantom_patched_copy`; a patch that does not
  apply stops the configure): reanimated's `PlatformDepMethodsHolder.h` (the
  Apple `SynchronouslyUpdateUIPropsFunction` for every non-Android platform;
  the copy comes first in the include path) and worklets'
  `AsyncQueueImpl.cpp` (the glibc `pthread_setname_np(thread, name)`; the
  copy is compiled instead of the original).
- `folly_runtime`: `-Wno-error=deprecated-declarations`
  (`std::unexpected_handler` is deprecated in libstdc++ 14).
- Our code: `FantomExpo.cpp` includes `<math.h>` before
  `ExpoViewComponentDescriptor.h` (unqualified `isnan`), and
  `composeEngineType` is compiled only with the Compose engine.

The manual steps below build the Debug tester the upstream way (gradle,
`build/tester`), which the Fantom tests in a React Native checkout use:

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
cp native/tests/* third_party/react-native/packages/react-native/Libraries/Components/View/__tests__/
cd third_party/react-native
yarn fantom FantomProbe       # View layout and getRenderedOutput with layout metrics
yarn fantom FantomTextProbe   # Text measurement (needs the macOS TextLayoutManager)
yarn fantom FantomA11yTree    # NativeFantom.getA11yTree
yarn fantom FantomInputs      # TextInput measurement and Switch size
yarn fantom FantomInteraction # hitTest, by-tag events, typing, scrolling
yarn fantom FantomScreens     # react-native-screens native stack (see Screens)
yarn fantom FantomGestureHandler # gesture-handler detector (see Gesture handler)
yarn fantom FantomExpoUI      # @expo/ui load, render, events, SwiftUI/Compose frames (see Expo UI; prerequisites there)
yarn fantom FantomRoboto      # fontFamily "Roboto" with the embedded font (see Expo UI)
yarn fantom FantomReanimated  # reanimated/worklets (see Reanimated; needs both packages in the checkout)
FANTOM_PRINT_OUTPUT=1 yarn fantom FantomA11yTree   # also print the raw binary stdout
```

Note: a full `yarn fantom` run rewrites 12 LogBox `.snap` files (it adds
`maxFontSizeMultiplier` props). Revert them with `git checkout` after the run.
