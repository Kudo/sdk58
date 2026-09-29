# react-native-screens, react-native-gesture-handler, react-native-reanimated in the Fantom host

Research notes on running these libraries in the headless Fantom host
(Hermes + ReactCommon + ReactCxxPlatform, CMake, macOS). All paths below are
relative to the npm tarballs unless stated otherwise. Tarballs were unpacked in
`/tmp/libs/<name>-<version>/package/`.

## 0. Versions and tools

`expo@58.0.0` `bundledNativeModules.json`:

| Package | Range | Version inspected |
|---|---|---|
| react-native-screens | `~4.28.0` | 4.28.0 (only 4.28.x published) |
| react-native-gesture-handler | `~3.2.1` | 3.2.1 |
| react-native-reanimated | `4.7.0` | 4.7.0 |
| react-native-worklets | `0.13.0` | 0.13.0 |
| babel-preset-expo (dependency of expo 58) | `~58.0.6` | 58.0.6 |

The React Native checkout in `third_party/react-native` is `0.88.0-rc.3`
(`packages/react-native/package.json`), not rc.2.

### Codegen for a library

Two commands. Both work for all three libraries (run from a React Native
checkout; `packages/react-native-codegen/lib` must be built):

```sh
RN=/Users/bonsai/Developer/react-native/packages

# 1. Parse the specs to a schema
node $RN/react-native-codegen/lib/cli/combine/combine-js-to-schema-cli.js \
  /tmp/cg/rnscreens.json <screens>/src/fabric
node $RN/react-native-codegen/lib/cli/combine/combine-js-to-schema-cli.js \
  /tmp/cg/rngh.json <rngh>/src/specs
node $RN/react-native-codegen/lib/cli/combine/combine-js-to-schema-cli.js \
  /tmp/cg/rnreanimated.json <reanimated>/src/specs

# 2. Generate C++ (and Java, which we ignore)
node $RN/react-native/scripts/generate-specs-cli.js -p android \
  -s /tmp/cg/rnscreens.json -o /tmp/cg/rnscreens-android \
  -n rnscreens -j com.swmansion.rnscreens -t all
node $RN/react-native/scripts/generate-specs-cli.js -p android \
  -s /tmp/cg/rngh.json -o /tmp/cg/rngh-android \
  -n rngesturehandler_codegen -j com.swmansion.gesturehandler -t all
node $RN/react-native/scripts/generate-specs-cli.js -p android \
  -s /tmp/cg/rnreanimated.json -o /tmp/cg/rnreanimated-android \
  -n rnreanimated -j com.swmansion.reanimated -t all
```

Output: `OUT/jni/react/renderer/components/<name>/{Props,EventEmitters,ShadowNodes,States,ComponentDescriptors}.{h,cpp}`
plus `<name>JSI.h`. The `-p android` output guards serialization code with
`#ifdef RN_SERIALIZABLE_STATE`; it compiles here without that define.

The app-level wrapper is
`packages/react-native/scripts/generate-codegen-artifacts.js -p <appRoot> -t android|ios|all -o <out> -s app|library`
(it reads `codegenConfig` from every dependency). For the host the two
commands above are simpler.

### Compile check method

Flags and include paths were taken from the existing Fantom build:
`third_party/react-native/private/react-native-fantom/build/tester/CMakeFiles/fantom_tester.dir/flags.make`
(`CXX_FLAGS` with `-Werror` removed, `CXX_INCLUDES`, `-DHERMES_V1_ENABLED=1`).
Each `.cpp` was compiled with `clang++ ... -fsyntax-only`. Saved copies:
`/tmp/cg/fl.txt`, `/tmp/cg/inc.txt`, `/tmp/cg/chk.sh`.

Results (errors only; warnings were not counted):

| Sources | Extra flags / includes | Files | Errors |
|---|---|---|---|
| screens `common/cpp/react/renderer/components/rnscreens/*.cpp` + generated rnscreens `*.cpp` | `-I common/cpp -I /tmp/cg/rnscreens-android/jni` | all | 0 |
| test TU that includes all screens custom descriptors + generated `ComponentDescriptors.h` and calls `providerRegistry->add(concreteComponentDescriptorProvider<...>())` for `RNSScreen`, `RNSScreenStackHeaderConfig`, `RNSScreenStack`, `RNSTabsHost` | same | 1 | 0 |
| worklets `Common/cpp/**/*.cpp` | `-I Common/cpp -DWORKLETS_VERSION=0.13.0` | 49 | 0 (without the define: 1 error in `Tools/WorkletsVersion.cpp:19`, `WORKLETS_VERSION_STRING` undeclared) |
| reanimated `Common/cpp/**/*.cpp` | worklets include + `-I Common/cpp -I Common/NativeView -I /tmp/cg/rnreanimated-android/jni -DREANIMATED_VERSION=4.7.0 -DWORKLETS_VERSION=0.13.0` | 105 | 0 (without the rnreanimated codegen: 11 files fail on `react/renderer/components/rnreanimated/Props.h` not found) |
| reanimated `Common/NativeView/.../REASharedTransitionBoundaryShadowNode.cpp` | same | 1 | 0 |
| RNGH `shared/shadowNodes/.../RNGestureHandlerDetectorShadowNode.cpp`, `shared/runtime/RNGHRuntimeDecorator.cpp` | `-I shared/shadowNodes -I /tmp/cg/rngh-android/jni -DREACT_NATIVE_MINOR_VERSION=88` | 2 | 0 |

This is syntax only; nothing was linked.

## 1. react-native-screens 4.28.0

### Package

- `package.json`: `main: lib/commonjs/index`, `react-native: src/index`,
  no `exports`.
- `codegenConfig`: `{ name: "rnscreens", type: "all", jsSrcsDir: "./src/fabric", android.javaPackageName: "com.swmansion.rnscreens" }`.
  Specs are also in subdirectories `src/fabric/gamma/`, `src/fabric/tabs/`,
  `src/fabric/safe-area/`.
- `react-native.config.js` lists the Android component descriptors.
- `android/src/main/jni/rnscreens.h` includes the custom descriptors so that
  the autolinking registration picks them up (it shadows the codegen header).

### C++ (`common/cpp/react/renderer/components/rnscreens/`, 70 files, 2662 lines)

Custom ShadowNode + State. The spec is `interfaceOnly: true`, so codegen does
not generate a descriptor; we must register the custom one:

| Component name | Shadow node | State |
|---|---|---|
| `RNSScreen` | `RNSScreenShadowNode` | `RNSScreenState { Size frameSize; Point contentOffset; }` |
| `RNSModalScreen` | `RNSModalScreenShadowNode` | `RNSScreenState` |
| `RNSScreenStackHeaderConfig` | `RNSScreenStackHeaderConfigShadowNode` | non-Android: `frameSize, edgeInsets, frameOrigin`, image loader |
| `RNSScreenStackHeaderSubview` | `RNSScreenStackHeaderSubviewShadowNode` | `RNSScreenStackHeaderSubviewState` |
| `RNSFullWindowOverlay` | `RNSFullWindowOverlayShadowNode` | `RNSFullWindowOverlayState` |
| `RNSSafeAreaView` | `RNSSafeAreaViewShadowNode` | `RNSSafeAreaViewState` |
| `RNSFormSheetHost` | `RNSFormSheetHostShadowNode` | `RNSFormSheetHostState` |
| `RNSSplitScreen` | `RNSSplitScreenShadowNode` | `RNSSplitScreenState` |
| `RNSStackScreen` | `RNSStackScreenShadowNode` | `RNSStackScreenState` |
| `RNSTabsBottomAccessory` | `RNSTabsBottomAccessoryShadowNode` | `RNSTabsBottomAccessoryState` |
| `RNSTabsHostIOS` (non-Android) / `RNSTabsHostAndroid` (Android) | `RNSTabsHostShadowNode` (`RNSTabsHostShadowNode.cpp:5-8`) | `RNSTabsHostState` |
| `RNSStackHeaderConfigIOS` / `RNSStackHeaderConfigAndroid` | `RNSStackHeaderConfigShadowNode` | `RNSStackHeaderConfigState` |
| `RNSStackHeaderItemIOS` | `RNSStackHeaderItemShadowNode` | `RNSStackHeaderItemState` |
| `RNSStackHeaderSubviewAndroid` (name in `.cpp`) | `RNSStackHeaderSubviewShadowNode` | `RNSStackHeaderSubviewState` |

Plain codegen `ConcreteViewShadowNode` (descriptors in the generated
`ComponentDescriptors.h`): `RNSScreenContainer`, `RNSScreenContentWrapper`,
`RNSScreenFooter`, `RNSScreenNavigationContainer`, `RNSScreenStack`,
`RNSSearchBar`, `RNSScrollViewMarker`, `RNSFormSheetContentWrapper`,
`RNSScrollToTopGuard`, `RNSSplitHost`, `RNSStackHeaderItemSpacerIOS`,
`RNSStackHost`, `RNSTabsBottomAccessoryContent`, `RNSTabsScreenAndroid`,
`RNSTabsScreenIOS`.

Specs that are `interfaceOnly` but have no custom C++ for a non-Android
build: `RNSTabsHostAndroid`, `RNSStackHeaderConfigAndroid`,
`RNSStackHeaderSubviewAndroid` (Android-only names), and the reverse for an
`ANDROID` build.

### Platform-specific code

- All JNI / fbjni / `folly::dynamic` / MapBuffer code is inside
  `#ifdef ANDROID`. No `RCT*` or UIKit headers in `common/cpp`.
- `RNSScreenShadowNodeCommitHook.h` includes `react/fabric/JFabricUIManager.h`
  unguarded, but it is only included from the `#ifdef ANDROID` block of
  `RNSScreenComponentDescriptor.h:3-7`, and its `.cpp` is wrapped in
  `#ifdef ANDROID`. It compiles to nothing on the host.
- Without `ANDROID` the iOS code paths are used. They compile with only
  ReactCommon headers (see section 0).
- `RNSScreenShadowNode.h` declares `setHeaderHeight` and
  `getFrameCorrectionModes` for all platforms, but they are defined only under
  `ANDROID` (`RNSScreenShadowNode.cpp:148-188`). Nothing calls them in the
  non-Android build.
- Required context key: three descriptors call
  `contextContainer_->at<std::shared_ptr<void>>("RCTImageLoader")` in
  `adopt()`:
  - `RNSScreenStackHeaderConfigComponentDescriptor.h:57`
  - `RNSStackHeaderConfigComponentDescriptor.h:41`
  - `RNSTabsHostComponentDescriptor.h:25`

  `ContextContainer::at` (`ReactCommon/react/utils/ContextContainer.h:79-85`)
  asserts and then calls `instances_.at(key)`, which throws
  `std::out_of_range` when the key is missing. The host must insert the key,
  for example `contextContainer->insert("RCTImageLoader", std::shared_ptr<void>{});`.

### How the platform sets frames and header height

- Non-Android `RNSScreenComponentDescriptor::adopt`
  (`RNSScreenComponentDescriptor.h:112-117`): if `state.frameSize` is non-zero,
  `setSize(frameSize)`. Otherwise Yoga lays out normally.
- `RNSScreenShadowNode::getContentOriginOffset` returns `state.contentOffset`
  (`RNSScreenShadowNode.cpp:11-15`); iOS uses it to push content below the
  native header.
- iOS pushes the state from the view layer:
  - `ios/RNSScreen.mm:148-150`:
    `RNSScreenState{RCTSizeFromCGSize(self.bounds.size), {0, effectiveContentOffsetY}}`
    then `_state->updateState(...)`. `effectiveContentOffsetY` is the header
    height, or 0 for large title, translucent, or native modal.
  - `ios/RNSScreenStackHeaderConfig.mm:170-190`:
    `RNSScreenStackHeaderConfigState(size, edgeInsets, frameOrigin)`.
- `RNSScreenStackHeaderConfigComponentDescriptor::adopt` (non-Android) sets
  size and padding from the state; `RNSScreenStackHeaderConfigShadowNode::layout`
  sets `origin = state.frameOrigin` (`RNSScreenStackHeaderConfigShadowNode.cpp:25-35`).
- Android computes the header height through JNI
  `com/swmansion/rnscreens/utils/ScreenDummyLayoutHelper.computeDummyLayout(fontSize, isTitleEmpty, applyTopInset)`
  (`RNSScreenShadowNode.cpp:29-88`), then sets padding and frame corrections
  (`RNSScreenShadowNode.cpp:90-167`).
- Result for the host: with no extra code, screens fill their parent, no space
  is reserved for a header, and the header config sits at its Yoga position.
  To emulate a header, the host must call `updateState` with
  `RNSScreenState` / `RNSScreenStackHeaderConfigState` (for example from the
  mounting manager or a commit hook), or subclass the descriptors.

### JS

- `src/fabric/NativeScreensModule.ts:8`: `TurboModuleRegistry.get<Spec>('RNSModule')`
  (not enforcing; empty spec). Imported for side effects from
  `src/index.tsx:3`. Safe when missing.
- `global.RNScreensTurboModule` (`src/gesture-handler/RNScreensTurboModule.ts:12`)
  is only used by `src/gesture-handler/ScreenGestureDetector.tsx` (swipe
  transitions with gesture-handler + reanimated). Not used on mount otherwise.
- `src/core.ts:5-8`: `isNativePlatformSupported = Platform.OS === 'ios' || 'android' || 'windows'`.
  `enableScreens()` calls `UIManager.getViewManagerConfig('RNSScreen')` and
  only logs an error (`src/core.ts:19`).
- `src/components/Screen.tsx:118`, `ScreenContainer.tsx:15`: native
  components only when `enabled && isNativePlatformSupported`. With
  `--platform a11ytree`, Metro inlines `Platform.OS = 'a11ytree'`, so screens
  render plain `View`s and no `RNS*` component appears in the tree.
- `.web.tsx` variants exist for most components in `src/components/`.

### Files to compile

- `common/cpp/react/renderer/components/rnscreens/*.cpp` (35 files) and
  `utils/` (header only).
- Generated: `rnscreens-android/jni/react/renderer/components/rnscreens/{Props,EventEmitters,ShadowNodes,States,ComponentDescriptors}.cpp`.
- Include paths: `common/cpp`, `rnscreens-android/jni`.
- Do not compile: `cpp/RNScreensTurboModule.cpp`,
  `cpp/RNSScreenRemovalListener.cpp` (only needed for the gesture transition
  TurboModule), `android/`, `ios/`.
- Reference CMake: `android/src/main/jni/CMakeLists.txt` (globs the common
  sources plus the generated sources into `react_codegen_rnscreens`).

### Platform interface to implement

1. Register descriptors in `StubComponentRegistryFactory.h`: the custom ones
   listed above plus `rnscreens_registerComponentDescriptorsFromCodegen(providerRegistry)`
   (or add the codegen aliases one by one).
2. Insert the `"RCTImageLoader"` context key.
3. Optional: shims for the Android-named `interfaceOnly` components
   (`RNSTabsHostAndroid`, `RNSStackHeaderConfigAndroid`,
   `RNSStackHeaderSubviewAndroid`) when the bundle is `--platform android`.
4. Optional: state updates for screen frame and header height.

### Size and risks

- Size: about 60 lines CMake, about 30 lines registration, 1 context key.
  150 to 250 lines C++ for header emulation and Android-name shims. No JS for
  `--platform android`.
- Risks:
  1. The non-Android C++ branch registers iOS names; the Android JS renders
     Android names for tabs and the gamma stack.
  2. Header height and screen offset are wrong until the host emulates the
     state updates.
  3. Hidden or frozen screens (`activityState`, `enableFreeze`) stay in the
     shadow tree, so the a11y tree can include screens that are not visible.

## 2. react-native-gesture-handler 3.2.1

### Package

- `package.json`: `main: lib/module/index.js`, `module: lib/module/index.js`,
  `react-native: src/index.ts`, no `exports`.
- `codegenConfig`: `{ name: "rngesturehandler_codegen", type: "all", jsSrcsDir: "./src/specs", android.javaPackageName: "com.swmansion.gesturehandler" }`.
- File suffixes: `.web.ts` and `.web.tsx` (both), `.android.tsx`,
  `.windows.ts`.
- `react-native.config.js`: Android `componentDescriptors: ['RNGestureHandlerDetectorComponentDescriptor']`.

### Native module (blocks an Android bundle at import)

- `src/specs/NativeRNGestureHandlerModule.ts:40`:
  `TurboModuleRegistry.getEnforcing<Spec>('RNGestureHandlerModule')`.
  `src/RNGestureHandlerModule.ts` re-exports it.
- `src/v3/NativeProxy.ts:11`:
  `const { flushOperations, updateGestureHandlerConfig } = RNGestureHandlerModule;`
  runs at module evaluation.
- Spec methods (`NativeRNGestureHandlerModule.ts:4-38`):
  ```ts
  createGestureHandler(handlerName: string, handlerTag: Double, config: Object): void;
  attachGestureHandler(handlerTag: Double, newView: Double, actionType: Double): void;
  setGestureHandlerConfig(handlerTag: Double, newConfig: Object): void;
  updateGestureHandlerConfig(handlerTag: Double, newConfig: Object): void;
  configureRelations(handlerTag: Double, relations: Object): void;
  dropGestureHandler(handlerTag: Double): void;
  flushOperations(): void;
  installUIRuntimeBindings(): boolean;
  ```
- `src/handlers/gestures/reanimatedWrapper.ts:104,112` `require`s
  `react-native-worklets` and `react-native-reanimated` in `try/catch`; line
  120 calls `installUIRuntimeBindings(Worklets.getUIRuntimeHolder)`, which in
  a microtask calls `NativeProxy.installUIRuntimeBindings()` and warns if it
  returns false (`installUIRuntimeBindings.ts`).
- v2 events on native come through `DeviceEventEmitter`
  (`handlers/gestures/eventReceiver.ts:134-139`); v3 events come as direct
  events on the `RNGestureHandlerDetector` component.

### Native components and C++

- `RNGestureHandlerDetector` (`src/specs/RNGestureHandlerDetectorNativeComponent.ts:79-80`,
  `interfaceOnly`). Custom C++ in
  `shared/shadowNodes/react/renderer/components/rngesturehandler_codegen/`:
  `RNGestureHandlerDetectorShadowNode.{h,cpp}` (unflattens children, tracks
  previous layout metrics), `RNGestureHandlerDetectorState.h` (folly only
  under `ANDROID`), `RNGestureHandlerDetectorComponentDescriptor.h`, and a
  `ComponentDescriptors.h` that replaces the codegen one. That directory must
  come before the codegen output directory on the include path.
- `RNGestureHandlerRootView` (plain codegen), rendered by
  `src/components/GestureHandlerRootView.android.tsx`.
  `GestureHandlerRootView.tsx` (iOS) is a plain `View`.
- `RNGestureHandlerButton` (plain codegen).
- `shared/runtime/RNGHRuntimeDecorator.{h,cpp}`:
  `installRNRuntimeBindings(rnRuntime, moduleId, setGestureState)`,
  `installUIRuntimeBindings(uiRuntime, setGestureState)`,
  `tryFindUIRuntime(rnRuntime)`. Worklets part under `#if RNGH_USE_WORKLETS`.
- No C++ gesture engine: handlers and the orchestrator exist only in
  `apple/` (ObjC) and `android/` (Kotlin).

### Web implementation (`src/web/`, 6469 lines)

Structure:

- `Gestures.ts`: name to handler class map.
- `handlers/`: `GestureHandler.ts` (base), `IGestureHandler.ts`, `Tap`,
  `Pan`, `LongPress`, `Fling`, `Pinch`, `Rotation`, `Hover`, `Manual`,
  `NativeView`.
- `detectors/`: `RotationGestureDetector.ts`, `ScaleGestureDetector.ts`.
- `tools/`: `GestureHandlerOrchestrator.ts`, `InteractionManager.ts`
  (relations), `NodeManager.ts` (tag to handler), `GestureHandlerDelegate.ts`,
  `GestureHandlerWebDelegate.ts`, `EventManager.ts`, `PointerEventManager.ts`,
  `KeyboardEventManager.ts`, `WheelEventManager.ts`, `PointerTracker.ts`,
  `VelocityTracker.ts`, `CircularBuffer.ts`, `LeastSquareSolver.ts`,
  `Vector.ts`, `ButtonEvents.ts`, `GestureLifecycleEvents.ts`.
- `interfaces.ts`, `utils.ts`, `constants.ts`.

Delegate interface (`tools/GestureHandlerDelegate.ts:8-30`):

```ts
export interface GestureHandlerDelegate<TComponent, THandler> {
  view: TComponent | null;
  init(viewRef: number, handler: THandler): void;
  detach(): void;
  updateDOM(): void;
  isPointerInBounds({ x, y }: { x: number; y: number }): boolean;
  measureView(): { pageX: number; pageY: number; width: number; height: number };
  absoluteToLocal(absoluteX: number, absoluteY: number): { x: number; y: number };
  reset(): void;
  onBegin(): void;
  onActivate(): void;
  onEnd(): void;
  onCancel(): void;
  onFail(): void;
  onEnabledChange(): void;
  destroy(): void;
}
```

`GestureHandlerWebDelegate` (`tools/GestureHandlerWebDelegate.ts`) depends on
the DOM:

- `init` (45-80): resolves the view (`findNodeHandle` unless native/virtual
  detector), reads `view.style.userSelect` / `touchAction`, creates
  `PointerEventManager`, `KeyboardEventManager`, `WheelEventManager` and calls
  `handler.attachEventManager(manager)` for each.
- `measureView` / `isPointerInBounds`: `getEffectiveBoundingRect`
  (`getBoundingClientRect`, with `display: contents` handling in `utils.ts:30-85`).
- `absoluteToLocal` (138-180): `getComputedStyle(view).transform`,
  `DOMMatrix`, `DOMPoint`, `offsetWidth` / `offsetHeight`.
- `setViewStyle` (342-359): writes `view.style[...]`.
- Context menu listeners with `addEventListener('contextmenu')`.

`EventManager<T>` (`tools/EventManager.ts`):

- Abstract: `registerListeners()`, `unregisterListeners()`,
  `mapEvent(event: Event, eventType: EventTypes): AdaptedEvent`.
- Protected callbacks set by the handler: `setOnPointerDown`, `setOnPointerAdd`,
  `setOnPointerUp`, `setOnPointerRemove`, `setOnPointerMove`,
  `setOnPointerLeave`, `setOnPointerEnter`, `setOnPointerCancel`,
  `setOnPointerOutOfBounds`, `setOnPointerMoveOver`, `setOnPointerMoveOut`,
  `setOnWheel`.
- `setEnabled(value)`, `resetManager()`, `markAsInBounds` / `markAsOutOfBounds`.

`PointerEventManager` (`tools/PointerEventManager.ts`):

- Listens on the view (192-207): `pointerdown`, `pointerup`, `pointermove`,
  `pointercancel`, `pointerenter`, `pointerleave`, `lostpointercapture`.
- Calls `target.setPointerCapture` / `releasePointerCapture` except for
  `SELECT` / `INPUT` or `role="button"`.
- `mapEvent` (222-239):
  ```ts
  { x: event.clientX, y: event.clientY,
    offsetX: (event.clientX - rect.left) / scaleX,
    offsetY: (event.clientY - rect.top) / scaleY,
    pointerId: event.pointerId, eventType,
    pointerType: PointerTypeMapping.get(event.pointerType) ?? PointerType.OTHER,
    button: event.buttons, time: event.timeStamp,
    stylusData: tryExtractStylusData(event) }
  ```
- `AdaptedEvent` shape: `interfaces.ts:136-148`
  (`x, y, offsetX, offsetY, pointerId, eventType, pointerType, time, button?, stylusData?, wheelDeltaY?`).
  `EventTypes`: `DOWN, ADDITIONAL_POINTER_DOWN, UP, ADDITIONAL_POINTER_UP, MOVE, ENTER, LEAVE, CANCEL`.

Events back to JS: `GestureHandler.sendEvent` (`handlers/GestureHandler.ts:452-510`)
calls functions from `propsRef.current` (`PropsRef`, `interfaces.ts:126-134`):
`onGestureHandlerEvent`, `onGestureHandlerStateChange`,
`onGestureHandlerTouchEvent`, `onGestureHandlerReanimatedEvent`,
`onGestureHandlerReanimatedStateChange`, `onGestureHandlerReanimatedTouchEvent`,
`onGestureHandlerAnimatedEvent`. There is no native emitter and no
`findNodeHandle`-based dispatch on web.

`src/RNGestureHandlerModule.web.ts` exports:

- `createGestureHandler(name, tag, config)`: `new Gestures[name](new GestureHandlerWebDelegate())`,
  `NodeManager.createGestureHandler(tag, handler)`, then `setGestureHandlerConfig`.
- `attachGestureHandler(tag, newView, actionType, propsRef, hostDetector?)`:
  requires `newView instanceof Element || newView instanceof React.Component`
  (line 45), then `handler.init(newView, propsRef, actionType, hostDetector)`.
- `detachGestureHandler`, `setGestureHandlerConfig`, `updateGestureHandlerConfig`,
  `getGestureHandlerNode`, `dropGestureHandler`, `configureRelations`
  (`InteractionManager.instance.configureInteractions`).
- `flushOperations()`: no-op. `installUIRuntimeBindings()`: returns `true`.

View resolution on web:

- `src/findNodeHandle.web.ts`: follows `viewTag`, unwraps
  `display: contents` elements with one child, handles `FlatList` and SVG refs.
- `src/v3/detectors/HostGestureDetector.web.tsx:351-354`: renders
  `<View style={{display: 'contents'}} ref={viewRef}>` and attaches handlers to
  that ref (or to child or virtual-child refs).
- `src/components/GestureHandlerRootView.web.tsx`: plain `View` with
  `GestureHandlerRootViewContext`.

### Using the web files under a custom Metro platform

- 18 `Platform.OS === 'web'` branches outside `src/web/`, for example
  `handlers/gestures/GestureDetector/attachHandlers.ts:84` (the non-web branch
  passes a view tag to the native module), `handlers/createHandler.tsx:283`,
  `handlers/utils.ts:51,68`, `v3/detectors/NativeDetector.tsx:55`,
  `v3/detectors/VirtualDetector/*.tsx`, `components/Pressable/*`,
  `v3/components/StatefulPressable.tsx`. Metro inlines `Platform.OS` from the
  bundle platform, so resolving `.web.*` files is not enough.
- React Native 0.88 elements (`src/private/webapis/dom/nodes/`):
  `getBoundingClientRect`, `setPointerCapture`, `childElementCount` exist on
  `ReadOnlyElement`. There is no `style` property. `addEventListener` is
  removed from `ReactNativeElement` unless feature flag `enableImperativeEvents`
  (native, default false) or `enableImperativeEvents_DEPRECATED` (JS) is on
  (`ReactNativeElement.js:363-378`). `instanceof Element` is false.

### Reanimated integration

- `handlers/gestures/gesture.ts:427-435`: `shouldUseReanimated` is true when
  `runOnJS !== true` and all callbacks are worklets. The action type is then
  `ActionType.REANIMATED_WORKLET` (`attachHandlers.ts:80-82`), and events go to
  Reanimated's `useHandler` / `useEvent` (types in `reanimatedWrapper.ts`).
- On web, `forReanimated` handlers call `onGestureHandlerReanimated*` from JS.
- Without worklets or reanimated, the `require`s fail quietly and callbacks run
  on the JS thread.

### Files to compile (render-only port)

- `shared/shadowNodes/react/renderer/components/rngesturehandler_codegen/RNGestureHandlerDetectorShadowNode.cpp`.
- Generated: `rngh-android/jni/react/renderer/components/rngesturehandler_codegen/{Props,EventEmitters,ShadowNodes,States,ComponentDescriptors}.cpp`.
- Include order: `shared/shadowNodes` before `rngh-android/jni`.
- Optional: `shared/runtime/RNGHRuntimeDecorator.cpp` (needs
  `-DREACT_NATIVE_MINOR_VERSION=88`; for `RNGH_USE_WORKLETS` also the worklets
  include path).

### Platform interface to implement

Option A, render only:

1. Register `RNGestureHandlerDetectorComponentDescriptor` (custom),
   `RNGestureHandlerRootViewComponentDescriptor`,
   `RNGestureHandlerButtonComponentDescriptor` (codegen).
2. A C++ TurboModule `RNGestureHandlerModule` with the 8 methods above as
   no-ops; `installUIRuntimeBindings` returns `true`.

Option B, working gestures in JS:

1. A delegate that implements `GestureHandlerDelegate` over `ReactNativeElement`
   (bounds from `getBoundingClientRect`, no `style` writes, no `DOMMatrix`).
2. An `EventManager` that receives Fantom pointer events (with
   `enableImperativeEvents` on, or through a host-side hook) and produces
   `AdaptedEvent`.
3. A JS implementation of `RNGestureHandlerModule` for the native code paths
   (resolver alias), plus handling of the 18 `Platform.OS === 'web'` branches.

Option C, port the orchestrator and handlers to C++: about 5k to 8k lines. Not
recommended.

### Size and risks

- Size: option A 100 to 150 lines C++ plus CMake. Option B 600 to 1000 lines TS
  plus resolver changes.
- Risks:
  1. `getEnforcing` makes an Android bundle throw at import without the stub.
  2. The web implementation needs a DOM (`style`, `getComputedStyle`,
     `DOMMatrix`, `instanceof Element`) and has `Platform.OS === 'web'` forks.
  3. Unregistered detector or root view components fall back to legacy interop
     with 0-width frames, so children get wrong layout.

## 3. react-native-reanimated 4.7.0 and react-native-worklets 0.13.0

### Packages

- reanimated: `main: lib/module/index`, `react-native: src/index`;
  `codegenConfig: { name: "rnreanimated", type: "all", jsSrcsDir: "./src/specs" }`;
  peer `react-native: 0.86 - 0.88`, `react-native-worklets: 0.13.x`.
- worklets: `main: ./lib/module/index`, `react-native: ./src/index`; peer
  `react-native: 0.86 - 0.88`.
- Neither has an `exports` field.

### C++ layout

- reanimated `Common/cpp/reanimated/` (105 `.cpp`, 25,410 lines with headers):
  `AnimatedSensor`, `CSS`, `Compat`, `Events`, `Fabric`, `LayoutAnimations`,
  `NativeModules`, `PseudoStyles`, `RuntimeDecorators`, `Tools`.
- reanimated `Common/NativeView/react/renderer/components/rnreanimated/`:
  `REASharedTransitionBoundary` shadow node, state, descriptor, and a
  `ComponentDescriptors.h`.
- worklets `Common/cpp/worklets/` (49 `.cpp`, 8,603 lines with headers):
  `AnimationFrameQueue`, `Compat`, `NativeModules`, `Networking`, `Registries`,
  `RunLoop`, `SharedItems`, `Tools`, `WorkletRuntime`.
- Platform code: `apple/` (ObjC++) and `android/src/main/cpp/` (JNI).

### Platform splits in Common code

- Guards found: `ANDROID`, `__APPLE__`, `NDEBUG`, `IS_REANIMATED_EXAMPLE_APP`,
  `REANIMATED_PROFILING`, `WORKLETS_PROFILING`, `REANIMATED_FEATURE_FLAGS`,
  `WORKLETS_FEATURE_FLAGS`, `REANIMATED_VERSION`, `WORKLETS_VERSION`.
  No `RCT_NEW_ARCH_ENABLED`.
- No UIKit and no JNI outside `ANDROID` guards.
- macOS defines `__APPLE__`, so the Apple branches compile:
  - `PlatformDepMethodsHolder.h:32-36`: `SynchronouslyUpdateUIPropsFunction = void(const int, const folly::dynamic &)`;
    `:60-62`: `forceScreenSnapshotFunction` field.
  - `ReanimatedModuleProxy.cpp:1052-1056`: synchronous prop path calls
    `synchronouslyUpdateUIPropsFunction_` (only used when
    `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` is true).
  - `SynchronousPropNames.h:13-17`, `LayoutAnimationsProxy.cpp:77-79,185-191`
    (`forceScreenSnapshot_` for RNSScreen).
  - worklets `RunLoop/AsyncQueueImpl.cpp:13-61`: `objc_autoreleasePoolPush` /
    `Pop` declared `extern "C"` (links from libobjc).
  - worklets `RunLoop/EventLoop.cpp:36-38`: `pthread_setname_np(name)`.
  - worklets `WorkletRuntime/RuntimeBindings.h:11-15,37-54`: `RCTLog` and
    `makeNativeLoggingHook` only when `__OBJC__` or `ANDROID`. A plain C++
    host must supply its own logging hook.

### Worklets platform interface

- `NativeModules/WorkletsModuleProxyInitializer.h`:
  ```cpp
  WorkletsModuleProxyInitializer(
      const std::shared_ptr<JSScheduler> &jsScheduler,
      const std::shared_ptr<UIScheduler> &uiScheduler,
      const std::shared_ptr<RuntimeBindings> &runtimeBindings,
      const std::shared_ptr<RNRuntimeStatus> &rnRuntimeStatus);
  void prepareProxy();              // constructs WorkletsModuleProxy (creates the UI runtime)
  void beginBundleModeAOT();
  void prepareBundleModeAOT(const BundleModeConfigLoader &);
  std::shared_ptr<WorkletsModuleProxy> finalize(
      jsi::Runtime &rnRuntime, bool bundleModeEnabled, const BundleModeConfigLoader &);
  void invalidate();
  ```
  The init sequence is documented in `NativeModules/WorkletsModuleProxy.h`
  (class comment). `finalize` calls `attachToRNRuntime`, which installs
  `global.__workletsModuleProxy`; `WorkletsModuleProxy::start()` initializes
  the UI runtime.
- `WorkletsModuleProxy` constructor (`WorkletsModuleProxy.h:75`):
  `(jsScheduler, uiScheduler, runtimeBindings, rnRuntimeStatus)`.
- `Tools/JSScheduler.h:13`: concrete class,
  `JSScheduler(jsi::Runtime &rnRuntime, const std::shared_ptr<CallInvoker> &jsCallInvoker, std::function<bool()> &&isJavaScriptQueue)`.
- `Tools/UIScheduler.h:11`: abstract.
  ```cpp
  virtual void scheduleOnUI(std::function<void()> job);   // base: push to queue
  virtual void triggerUI();                              // base: drain queue
  bool isOnUIThread() const;                              // cached per thread
  protected: virtual bool queryIsOnUIThread() const = 0;
  ```
  Reference: `apple/worklets/apple/IOSUIScheduler.mm` (run inline if on UI
  thread, else queue and `dispatch_async` to `triggerUI`).
- `WorkletRuntime/RuntimeBindings.h:21-35`:
  ```cpp
  struct RuntimeBindings {
    std::function<void(std::function<void(const double)>)> requestAnimationFrame;
    jsi::HostFunctionType nativeLoggingHook;   // (message, level)
    std::shared_ptr<NetworkingBackend> networkingBackend;
  };
  ```
- `Networking/NetworkingBackend.h:28-45`: pure virtual
  `sendRequest(uint64_t, RequestConfig &&, const std::shared_ptr<NetworkRequestListener> &)`,
  `abortRequest(uint64_t)`; optional `decodeText`.
- `Tools/PlatformLogger.h`: static `log(const char*)`, `log(const std::string&)`,
  `log(double)`, `log(int)`, `log(bool)`, defined per platform
  (`apple/worklets/apple/PlatformLogger.mm`, `android/.../PlatformLogger.cpp`).
- `Tools/RNRuntimeStatus.h`: concrete; call `setDead()` on teardown.
- UI runtime creation: `WorkletRuntime/WorkletRuntime.cpp:58-59`:
  `::hermes::vm::RuntimeConfig::Builder().withMicrotaskQueue(...).build()` then
  `facebook::hermes::makeHermesRuntime(config)`, wrapped in
  `WorkletHermesRuntime` (`jsi::WithRuntimeDecorator<WorkletsReentrancyCheck>`).
  `WorkletRuntime/HermesProfiling.cpp` uses `makeHermesRootAPI` / `IHermes`.
  Needs `hermes/hermes.h` and `hermes-engine::hermesvm` (already in the host
  build).
- Android reference wiring: `android/src/main/cpp/worklets/android/WorkletsModule.cpp`
  (constructs the initializer; `requestAnimationFrame` through JNI;
  `isOnJSQueueThread` through JNI).

### Reanimated platform interface

`Tools/PlatformDepMethodsHolder.h:55-77`, field order for `__APPLE__`:

```cpp
struct PlatformDepMethodsHolder {
  RequestRenderFunction requestRender;                 // void(std::function<void(const double)>)
  ForceScreenSnapshotFunction forceScreenSnapshotFunction;  // void(Tag)            [__APPLE__]
  SynchronouslyUpdateUIPropsFunction synchronouslyUpdateUIPropsFunction; // void(int, const folly::dynamic &)
  GetAnimationTimestampFunction getAnimationTimestamp; // double()
  RegisterSensorFunction registerSensor;               // int(int, int, int, std::function<void(double[], int)>)
  UnregisterSensorFunction unregisterSensor;           // void(int)
  SetGestureStateFunction setGestureStateFunction;     // void(int, int)
  KeyboardEventSubscribeFunction subscribeForKeyboardEvents;   // int(std::function<void(int, int)>, bool, bool)
  KeyboardEventUnsubscribeFunction unsubscribeFromKeyboardEvents; // void(int)
  MaybeFlushUIUpdatesQueueFunction maybeFlushUIUpdatesQueueFunction; // void()
  PlatformAttachPseudoSelectorFunction attachPseudoSelector;   // void(Tag, PseudoSelector, std::function<void(bool)>)
  PlatformDetachPseudoSelectorFunction detachPseudoSelector;   // void(Tag, PseudoSelector)
  std::shared_ptr<css::CSSPlatformTransitionBackend> platformTransitionBackend; // may be null
  std::shared_ptr<css::CSSPlatformAnimationFactory> platformAnimationFactory;   // may be null
};
```

`NativeModules/ReanimatedModuleProxy.h`:

```cpp
ReanimatedModuleProxy(                                   // :65-71
    const std::shared_ptr<worklets::WorkletRuntime> &uiRuntime,
    const std::shared_ptr<worklets::UIScheduler> &uiScheduler,
    jsi::Runtime &rnRuntime,
    const std::shared_ptr<CallInvoker> &jsCallInvoker,
    const PlatformDepMethodsHolder &platformDepMethodsHolder,
    const bool isReducedMotion);
void init(const PlatformDepMethodsHolder &);             // :76, after make_shared
void performOperations();                                // :109, once per frame
void initializeFabric(const std::shared_ptr<UIManager> &uiManager); // :167
```

Install sequence (iOS `apple/reanimated/apple/ReanimatedModule.mm:157-190`,
blocking synchronous `installTurboModule`; Android
`android/src/main/cpp/reanimated/android/NativeProxy.cpp` constructor and
`installJSIBindings`):

1. Get the UI worklet runtime and UI scheduler from the worklets module.
2. `make_shared<ReanimatedModuleProxy>(...)`, then `proxy->init(holder)`.
3. `RNRuntimeDecorator::decorate(rnRuntime, uiRuntime, proxy)` (sets
   `global.__reanimatedModuleProxy`).
4. `proxy->initializeFabric(uiManager)`.
5. `scheduler->addEventListener(EventListener{... proxy->handleRawEvent(rawEvent, nowMs) ...})`
   (`ReanimatedModule.mm:55-73`).
6. Register the per-frame `performOperations` callback
   (`apple/reanimated/apple/native/NativeProxy.mm`, `REANodesManager.mm:82-128`).

`initializeFabric` (`ReanimatedModuleProxy.cpp:1175-1215`) casts
`uiManager->getDelegate()` to `Scheduler*` with `reinterpret_cast` and reads
`"ComponentDescriptorRegistry_DO_NOT_USE_PRETTY_PLEASE"` from the scheduler's
context container. `ReactCommon/react/renderer/scheduler/Scheduler.cpp:145`
inserts that key. It creates `ReanimatedMountHook` and `ReanimatedCommitHook`.

### Commit path and frame loop

- `performOperations()` flushes `UpdatesRegistryManager` and calls
  `commitUpdates` (`ReanimatedModuleProxy.cpp:1072-1105`):
  `shadowTree.commit(cloneShadowTreeWithNewProps(oldRoot, propsMap), {enableStateReconciliation: false, mountSynchronously: true})`,
  with the root marked as `ReanimatedCommitShadowNode`.
- `Fabric/ReanimatedCommitHook`: re-applies animated props on React commits.
  `Fabric/ReanimatedMountHook`: handles removals and calls
  `requestFlushRegistry`.
- `requestFlushRegistry` (`ReanimatedModuleProxy.cpp:1059-1068`) calls
  `requestRender_` unless `USE_ANIMATION_BACKEND` is on.
- iOS: `REANodesManager.mm:100-128` (`CADisplayLink` `onAnimationFrame` runs
  queued `postOnAnimation` blocks, then `performOperations`).
  `native/PlatformDepMethodsHolderImpl.mm:47-60` `requestRender` posts on the
  display link with `targetTimestamp`; `:73-76` `getAnimationTimestamp` is
  `CACurrentMediaTime() * 1000` (with slow-animation scaling).
- Android: `NativeProxy.cpp` `requestRender` calls Java
  `requestRender(AnimationFrameCallback)`; `getAnimationTimestamp` calls Java
  `getAnimationTimestamp()`.
- Host mapping: queue `requestRender` callbacks; on each host frame call them
  with the frame timestamp, then call `performOperations()`. Existing Fantom
  hook points: `TesterAppDelegate::onRender`, `onAnimationRender_`,
  `TesterAnimationChoreographer::runUITick`, `StubClock::now`
  (`third_party/react-native/private/react-native-fantom/tester/src/TesterAppDelegate.cpp:103-131`).
  TurboModules are added in the `TurboModuleProviders` lambda there.

### Static feature flags

- `Tools/FeatureFlags.h`: `StaticFeatureFlags::getFlag(name)` parses
  `REANIMATED_FEATURE_FLAGS` (`"[NAME:true][NAME:false]..."`). Without the
  define every flag is false.
- Defaults (`src/featureFlags/staticFlags.json`): `DISABLE_COMMIT_PAUSING_MECHANISM: false`,
  `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS: false`,
  `EXPERIMENTAL_CSS_ANIMATIONS_FOR_SVG_COMPONENTS: true`,
  `USE_COMMIT_HOOK_ONLY_FOR_REACT_COMMITS: true`,
  `ENABLE_SHARED_ELEMENT_TRANSITIONS: false`, `USE_ANIMATION_BACKEND: false`
  (plus others in the file). The podspec builds the string with
  `ReanimatedUtils.get_static_feature_flags()`.
- With `IOS_SYNCHRONOUSLY_UPDATE_UI_PROPS` false, all updates go through shadow
  tree commits.

### CMake and third-party dependencies

- `react-native-worklets/android/CMakeLists.txt`: globs
  `Common/cpp/worklets/*.cpp` + `android/src/main/cpp/worklets/*.cpp`; defines
  `WORKLETS_VERSION`, `WORKLETS_FEATURE_FLAGS`, `NDEBUG` for non-Debug; links
  `fbjni`, `ReactAndroid`, `hermes-engine::hermesvm`.
- `react-native-reanimated/android/CMakeLists.txt`: globs
  `Common/cpp/reanimated/*.cpp`, `android/src/main/cpp/reanimated/*.cpp`,
  `Common/NativeView/*.cpp`, codegen from `build/generated/source/codegen/jni`;
  links `fbjni`, `ReactAndroid`, `react-native-worklets`.
- fbjni is used only by the Android sources. Common code needs folly, jsi,
  hermes, ReactCommon (renderer, uimanager, scheduler, animationbackend,
  featureflags, callinvoker). All present in the Fantom build.

### JS at import time

- Metro picks `.native.ts` files because the host puts `native` in
  `resolver.platforms`.
- worklets `src/specs/NativeWorkletsModule.ts:12`:
  `TurboModuleRegistry.get<Spec>('WorkletsModule')`, spec
  `installTurboModule(bundleModeEnabled: boolean): boolean`,
  `prepareBundleMode(): boolean`, `toggleSlowAnimationsOnUIRuntime(): boolean`,
  `start(): boolean`.
- worklets `src/WorkletsModule/NativeWorklets.native.ts:428`:
  `export const WorkletsModule = new NativeWorklets();` at import. The
  constructor (`:37-45`) calls `installTurboModule`, installs unpackers, calls
  `start()`, and throws if `globalThis.__workletsModuleProxy` is undefined. In
  `__DEV__` it runs `checkCppVersion()`.
- worklets `src/platformChecker.native.ts:3`: `IS_JEST = false` (hard-coded).
- reanimated `src/specs/NativeReanimatedModule.ts:9`:
  `TurboModuleRegistry.get<Spec>('ReanimatedModule')`, spec
  `installTurboModule(): boolean`.
- reanimated `src/ReanimatedModule/NativeReanimated.ts:58-86`: calls
  `installTurboModule()`, throws if `global.__reanimatedModuleProxy` is
  undefined; in `__DEV__` throws unless `globalThis.RN$Bridgeless`, and runs
  `checkCppVersion()` (so `REANIMATED_VERSION` must be exactly `4.7.0`).
- reanimated `src/ReanimatedModule/reanimatedModuleInstance.native.ts`: uses
  `createJSReanimatedModule()` only when `IS_JEST`
  (`common/constants/platform.ts:16`:
  `typeof globalThis.jest !== 'undefined' || process.env.NODE_ENV === 'test'`).
- `react-native-reanimated/mock.js` requires `src/mock`, which imports
  `./index.js` (the real module). It is not a native-free fallback.

### Babel

- `babel-preset-expo@58.0.6` `build/configs/expo.js:104-118`: if
  `react-native-worklets/plugin` resolves, the preset adds it (unless
  `worklets: false` or `reanimated: false`). If `worklets: false`, it adds
  `react-native-reanimated/plugin` instead.
- `react-native-worklets/plugin/index.js` has no platform-dependent logic
  (only `bundleMode`).
- The host bundles with `expo/metro-config`, so the plugin is added when
  worklets is installed in the project.

### Files to compile

- worklets: `Common/cpp/worklets/**/*.cpp` (49 files). Include `Common/cpp`.
  Defines: `WORKLETS_VERSION=0.13.0`, optionally `WORKLETS_FEATURE_FLAGS`.
- reanimated: `Common/cpp/reanimated/**/*.cpp` (105 files) and
  `Common/NativeView/react/renderer/components/rnreanimated/*.cpp`.
  Include `Common/cpp`, `Common/NativeView`, worklets `Common/cpp`,
  `rnreanimated-android/jni`. Defines: `REANIMATED_VERSION=4.7.0`,
  `REANIMATED_FEATURE_FLAGS="[...]"`.
- Generated: `rnreanimated-android/jni/react/renderer/components/rnreanimated/*.cpp`.
- Link: `hermes-engine::hermesvm` plus the ReactCommon targets already in the
  tester.

### Host code to write

1. `HostUIScheduler : worklets::UIScheduler` (`queryIsOnUIThread`, `scheduleOnUI`
   that runs jobs on the host's chosen UI thread identity).
2. `RuntimeBindings`: `requestAnimationFrame` into the host frame queue, a
   logging hook, a stub `NetworkingBackend`.
3. `worklets::PlatformLogger` definitions.
4. `WorkletsModule` C++ TurboModule: `installTurboModule(bundleModeEnabled)`
   (`initializer->finalize(...)`), `start()`, `prepareBundleMode()` (return
   false), `toggleSlowAnimationsOnUIRuntime()`.
5. `ReanimatedModule` C++ TurboModule: `installTurboModule()` runs the install
   sequence above with the UIManager from `UIManagerBinding::getBinding(runtime)`.
6. `PlatformDepMethodsHolder`: `requestRender` queue, `getAnimationTimestamp`
   from the host clock, no-op sensors, keyboard, pseudo selectors, screen
   snapshot, synchronous props.
7. Frame pump: run `requestRender` callbacks, then `performOperations()`.
8. Scheduler `EventListener` that calls `handleRawEvent`.
9. Register `REASharedTransitionBoundaryComponentDescriptor`.
10. CMake targets for both libraries.

### Size and risks

- Size: 600 to 800 lines C++, about 80 lines CMake. No JS changes.
- Risks:
  1. Threading: the UI runtime, `isOnUIThread` and `invokeSyncOnJS` assume a
     separate UI thread. The Fantom work loop is manual, so the host must pick
     one thread model and pump UI jobs deterministically.
  2. No settled point: animations advance only when the host ticks frames and
     calls `performOperations`, so a snapshot depends on how many frames run.
  3. Build cost and churn: a second Hermes runtime and about 34k lines of C++
     in the tester; strict version checks; dependence on RN release-candidate
     APIs (`ReactNativeFeatureFlags`, `UIManagerAnimationBackend`).

## 4. Summary

| Library | Reusable C++ | Host code | Top risk |
|---|---|---|---|
| react-native-screens | 2.7k lines, compiles here | 250 to 350 lines C++, 1 context key | Android JS names vs non-Android C++ names; no header height |
| react-native-gesture-handler | detector shadow node only | 100 to 150 lines C++ (render only) or 600 to 1000 lines TS (gestures) | `getEnforcing` at import; web code needs a DOM |
| react-native-reanimated + worklets | 34k lines, compiles here | 600 to 800 lines C++ | UI thread model and frame pumping |

Trial artifacts (not in the repo): `/tmp/libs/` (tarballs), `/tmp/cg/`
(schemas, generated codegen, compile flags, `chk.sh`).

## 5. RNGH port map

Goal: keep the NATIVE JS paths of RNGH 3.2.1 (bundle platform `android`) and
replace only the native module with a JS module built on the classes in
`src/web/`. All paths are relative to
`/tmp/libs/react-native-gesture-handler-3.2.1/package/src/` unless stated.

### 5.1 DOM and web globals in the handler core

Direct uses (not through `delegate.*` or an `EventManager`) found by grep for
`document`, `window`, `HTMLElement`, `Element`, `getComputedStyle`, `style`,
`addEventListener`, `PointerEvent`, `requestAnimationFrame`, `performance.now`,
`Date.now`, `setTimeout`, `navigator`, `DOMMatrix`, `instanceof`,
`getAttribute`:

| File | Lines | Use |
|---|---|---|
| `web/handlers/GestureHandler.ts` | 532, 552, 570, 669, 716 | `Date.now()` for `timeStamp` |
| `web/handlers/TapGestureHandler.ts` | 89-90, 96, 108 | `setTimeout` / `clearTimeout` (`maxDurationMs`, `maxDelayMs`) |
| `web/handlers/LongPressGestureHandler.ts` | 56, 157 | `Date.now()` (`duration`) |
| | 83, 169 | `setTimeout` / `clearTimeout` (activation after `minDurationMs`) |
| `web/handlers/PanGestureHandler.ts` | 199, 506 | `setTimeout` / `clearTimeout` (`activateAfterLongPress`) |
| | 337, 339 | `setTimeout` (end of wheel gesture) |
| `web/handlers/FlingGestureHandler.ts` | 56, 102 | `setTimeout` / `clearTimeout` (`maxDurationMs`) |
| `web/handlers/NativeViewGestureHandler.ts` | 70 | `isStylableElement(view)` (`web/utils.ts:22-28`: `canUseDOM()` + `instanceof HTMLElement \|\| SVGElement`) |
| | 79-85 | `view.getAttribute('rngh-role')`, `getAttribute('role')`, `querySelector(':scope > input[role="switch"]')` (inside the `isStylableElement` guard) |
| | 116-124 | `view.style.touchAction` / `WebkitTouchCallout` (guarded) |
| | 149-152, 302-305 | `dispatchGestureLifecycleEvent(view)` → `view?.dispatchEvent(new CustomEvent(...))` (`web/tools/GestureLifecycleEvents.ts:13`) |
| | 155 | `view.hasAttribute('rnghtext')` (NOT guarded) |
| | 322, 385 | `setTimeout` / `clearTimeout` (button long press) |
| | 354-366 | `dispatchButtonEvent(view)` → `view?.dispatchEvent(new CustomEvent(name, {detail}))` (`web/tools/ButtonEvents.ts:19`) |

No direct DOM or web-global use in: `HoverGestureHandler.ts`,
`ManualGestureHandler.ts`, `PinchGestureHandler.ts`, `RotationGestureHandler.ts`,
`IGestureHandler.ts`, `tools/GestureHandlerOrchestrator.ts`,
`tools/InteractionManager.ts` (line 110 is a comment; it compares
`constructor.name`), `tools/NodeManager.ts`, `tools/PointerTracker.ts`,
`tools/VelocityTracker.ts`, `tools/CircularBuffer.ts`,
`tools/LeastSquareSolver.ts`, `tools/Vector.ts`,
`detectors/RotationGestureDetector.ts`, `detectors/ScaleGestureDetector.ts`.

Runtime imports of these files stay inside `src/web/`, `src/State`,
`src/PointerType`, `src/ActionType`, `src/TouchEventType`, `src/Directions`,
`src/utils` (`tagMessage`), `src/handlers/gestureHandlerCommon`,
`src/v3/types`. None import `GestureHandlerWebDelegate` or the event managers.

View access in the core goes through the delegate:

- `GestureHandler.ts`: `delegate.init`, `detach`, `destroy`, `reset`,
  `updateDOM`, `measureView` (4 calls: touch payloads), `onActivate`,
  `onEnd`, `onCancel`, `onFail`, `onEnabledChange`.
- `GestureHandlerOrchestrator.ts:327` compares `handler.delegate.view` by
  identity; `:350-351` calls `delegate.isPointerInBounds(point)`.
- `PinchGestureHandler.ts`, `RotationGestureHandler.ts`:
  `delegate.absoluteToLocal`.
- `NativeViewGestureHandler.ts`: `delegate.view` (8 uses),
  `delegate.isPointerInBounds` (2).

Conclusion:

- Usable as-is in Hermes (`setTimeout`, `clearTimeout`, `Date.now` exist in
  RN): `GestureHandler.ts`, Tap, Pan, LongPress, Fling, Hover, Manual, Pinch,
  Rotation, orchestrator, `InteractionManager`, `NodeManager`,
  `PointerTracker`, `VelocityTracker`, both detectors. Timers must run in the
  Fantom work loop (`FantomTimerRegistry`) for Tap, LongPress, Fling and
  `activateAfterLongPress` to resolve.
- Needs a patch or wrapper: `NativeViewGestureHandler.ts`. With a non-DOM
  view, `isStylableElement` is false (`window` is undefined in Hermes), so
  lines 70-124 are skipped and `role` stays `null`. Line 155
  `view.hasAttribute` throws unless the delegate's `view` has `hasAttribute`
  (RN 0.88 `ReadOnlyElement` has no `hasAttribute`) and, with
  `enableImperativeEvents` off, `dispatchEvent` is `undefined` on
  `ReactNativeElement`, so `view?.dispatchEvent(...)` throws `TypeError`
  (the `?.` guards only `view`). `CustomEvent` is not a Hermes global.
  Options: give the delegate a small view object (not the element) with
  `hasAttribute() → false` and a `dispatchEvent` that forwards button events;
  or patch these call sites.
- `GestureHandlerWebDelegate.ts`, `PointerEventManager.ts`,
  `KeyboardEventManager.ts`, `WheelEventManager.ts`, `findNodeHandle.web.ts`,
  `web/utils.ts` bounding helpers: replace (DOM only; see section 2).

### 5.2 Event payloads: web sender vs native

Web builders (`web/handlers/GestureHandler.ts`):

- v2 (not native/virtual detector), `transformEventData` (517-534), used for
  both state change and update:
  `{ nativeEvent: { numberOfPointers, state, ...transformNativeEvent(), handlerTag, oldState: newState !== oldState ? oldState : undefined, pointerType }, timeStamp: Date.now() }`.
- v3 state change, `transformStateChangeEvent` (536-554):
  `{ nativeEvent: { state, handlerTag, oldState, handlerData: { numberOfPointers, pointerType, ...transformNativeEvent() } }, timeStamp }`.
- v3 update, `transformUpdateEvent` (556-572): same without `oldState`.
- Touch, `transformTouchEvent` (574-676):
  `{ nativeEvent: { handlerTag, state, eventType, changedTouches, allTouches, numberOfTouches, pointerType }, timeStamp }`,
  touch = `{ id, x, y, absoluteX, absoluteY }` with `x/y = absolute - delegate.measureView().pageX/pageY`.
  `numberOfTouches` is decremented on UP. `cancelTouches` (678-737) sends
  `TOUCHES_CANCEL` with all tracked pointers.
- `sendEvent` (452-510): state change goes to `onGestureHandlerStateChange`
  (or `onGestureHandlerReanimatedStateChange` when `forReanimated`); updates
  only while `ACTIVE` go to `onGestureHandlerReanimatedEvent` /
  `onGestureHandlerAnimatedEvent` / `onGestureHandlerEvent`. `forReanimated`
  and `forAnimated` come from config `dispatchesReanimatedEvents` /
  `dispatchesAnimatedEvents` (804-809). Touch events are sent only when
  config `needsPointerData` (820-821, 411-415).

`transformNativeEvent` fields (base 752-761: `x, y, absoluteX, absoluteY`
from `tracker` relative/absolute averages):

| Handler | Web extras | Android `*EventDataBuilder.kt` |
|---|---|---|
| all | `numberOfPointers`, `pointerType` added by the builders above | `GestureHandlerEventDataBuilder.kt:13-14` `numberOfPointers`, `pointerType` |
| Tap | none (base) | `x, y, absoluteX, absoluteY` |
| Pan (`PanGestureHandler.ts:177-189`) | `translationX/Y` (NaN → 0), `velocityX/Y`, `stylusData` | `x, y, absoluteX/Y, translationX/Y, velocityX/Y`, `stylusData` if present |
| LongPress (`:53-58`) | `duration: Date.now() - startTime` | base + `duration` (int) |
| Fling | none (base) | `x, y, absoluteX, absoluteY` |
| Native (`:390-400`) | `pointerInside, x, y, absoluteX, absoluteY` (no base spread) | `pointerInside, x, y, absoluteX, absoluteY` |
| Hover (`:22-27`) | `stylusData` | base + `stylusData` |
| Pinch (`:73-85`) | `focalX, focalY, velocity, scale` (no base x/y) | `scale, focalX, focalY, velocity` |
| Rotation (`:73-82`) | `rotation, anchorX, anchorY, velocity` | `rotation, anchorX, anchorY, velocity` |
| Manual | none (base) | none beyond the common fields |

Units: web velocity is px/s (`VelocityTracker.ts:76-77` multiplies the fit by
1000; `time` is in ms). Android converts px to DIP (`PixelUtil.toDIPFromPixel`),
so values match when `AdaptedEvent` coordinates are in dp.

Native delivery, Android (`android/src/main/java/com/swmansion/gesturehandler/react/events/`):

- v2 `JS_FUNCTION_OLD_API` / `JS_FUNCTION_NEW_API`:
  `deviceEventEmitter.emit("onGestureHandlerEvent" | "onGestureHandlerStateChange", data)`
  (`RNGestureHandlerEventDispatcher.kt:62-73, 119-137, 225-228`). Flat data:
  update = builder fields + `handlerTag`, `state`
  (`RNGestureHandlerEvent.kt:86-90`); state change = builder fields +
  `handlerTag`, `state`, `oldState` (`RNGestureHandlerStateChangeEvent.kt:84-90`).
  Touch events (new API) also go to `"onGestureHandlerEvent"`:
  `handlerTag, state, numberOfTouches, eventType, pointerType, changedTouches, allTouches`
  (`RNGestureHandlerTouchEvent.kt:65-79`; state is reported as BEGAN while
  `isAwaiting && ACTIVE`). Pointer data: `id, x, y, absoluteX, absoluteY`
  (`core/GestureHandler.kt:582-588`).
- v2 `REANIMATED_WORKLET`: `reanimatedProxy.sendEvent(event)`
  (`RNGestureHandlerEventDispatcher.kt:210-213`) with event names
  `onGestureHandlerEvent` / `onGestureHandlerStateChange` on the handler's
  view tag. JS side: `useAnimatedGesture.ts:198-200`
  `Reanimated.useEvent(..., ['onGestureHandlerStateChange', 'onGestureHandlerEvent'])`.
- v3 `NATIVE_DETECTOR` / `VIRTUAL_DETECTOR`: `handler.hostDetectorView?.dispatchEvent(event)`
  (`:79-99, 139-155, 193-203`). Payload wraps builder fields in
  `handlerData`: `{ handlerData, handlerTag, state }` and
  `{ handlerData, handlerTag, state, oldState }`
  (`RNGestureHandlerEvent.kt:92-102`, `RNGestureHandlerStateChangeEvent.kt:92-107`).
- iOS uses the same names: `apple/RNGestureHandlerEvents.mm:207-211, 277`;
  device events through `sendDeviceEventWithName:@"onGestureHandlerStateChange"`
  (`RNGestureHandlerManager.mm:562`).

v2 JS receiver (`handlers/gestures/eventReceiver.ts`): listens on
`DeviceEventEmitter` `'onGestureHandlerEvent'` and
`'onGestureHandlerStateChange'` (`startListening`). Classifies by
`event.oldState != null` (state change) and `event.eventType != null` (touch),
else update. It expects the FLAT payload (not `{nativeEvent}`); old-API
handlers get `{ nativeEvent: event }` through `findOldGestureHandler`.

v3 detector events (codegen spec `specs/RNGestureHandlerDetectorNativeComponent.ts`,
generated `EventEmitters.cpp`): `gestureHandlerEvent` `{handlerTag, state, handlerData}`,
`gestureHandlerStateChange` `{handlerTag, state, oldState, handlerData}`,
`gestureHandlerTouchEvent` `{handlerTag, numberOfTouches, state, eventType, allTouches[], changedTouches[], pointerType}`,
plus `gestureHandlerReanimatedEvent`, `gestureHandlerReanimatedStateChange`,
`gestureHandlerReanimatedTouchEvent`, `gestureHandlerAnimatedEvent`. Button
events (`specs/RNGestureHandlerButtonNativeComponent.ts:24-31`): `buttonPress`,
`buttonPressIn`, `buttonPressOut`, `buttonLongPress`, `buttonHoverIn`,
`buttonHoverOut`, `buttonInteractionFinished`.

Differences in the web sender:

- v2 update payload has an explicit `oldState: undefined` key (harmless:
  receiver checks `!= null`) and adds `pointerType`, which Android also sends.
- The web sender calls JS functions from `propsRef`; the native paths expect
  a `DeviceEventEmitter` emit (v2) or a Fabric event on the detector (v3).
  Our module must translate: for v2 emit `result.nativeEvent` on
  `DeviceEventEmitter`; for v3 dispatch `gestureHandler*` on the detector's
  shadow node. The host NativeFantom already has `enqueueNativeEvent(node, type, payload)`,
  which calls `shadowNode->getEventEmitter()->dispatchEvent(type, payload)`
  (`third_party/react-native/private/react-native-fantom/tester/src/NativeFantom.cpp:431-440`),
  and `enqueueNativeEventByTag(surfaceId, tag, type, payload)` (`:113-140`).
- Touch `id` on web is a remapped id (`tracker.getMappedTouchEventId`);
  Android uses the pointer id.
- Web never reports `state = BEGAN` for `isAwaiting && ACTIVE` in touch
  events (Android does, `RNGestureHandlerTouchEvent.kt:76-78`).
- Web sends no events for handlers with negative tags (not applicable).

### 5.3 `Platform.OS` web branches (native value: `'android'`)

There are 28 `Platform.OS` checks against `'web'` (`===` and `!==`) outside
`src/web/`. With `--platform android` all take the native branch.

| File:line | Native branch | Module needs |
|---|---|---|
| `handlers/gestures/GestureDetector/attachHandlers.ts:84` | `attachGestureHandler(tag, viewTag, actionType)`; `viewTag` is a number from `findNodeHandle` | resolve tag to a view (5.4) |
| `handlers/createHandler.tsx:283` | `registerOldGestureHandler(tag, {onGestureEvent, onGestureStateChange})` then `attachGestureHandler(tag, viewTag, actionType)` | tag to view; emit flat events on `DeviceEventEmitter` |
| `handlers/createHandler.tsx:194` | `unregisterOldGestureHandler(tag)` on unmount | nothing |
| `handlers/createHandler.tsx:398` | dev warning if no root view context | nothing |
| `handlers/utils.ts:51` | `transformIntoHandlerTags`: string ids / refs to numeric tags (> 0) | relations arrive as numbers |
| `handlers/utils.ts:68` | `findNodeHandle` → RN `findNodeHandle(node)` (number) | tag to view |
| `v3/detectors/NativeDetector.tsx:55` | passes only `onGestureHandlerReanimatedEvent` (Reanimated routes by event name) | dispatch `gestureHandlerReanimated*` names when `dispatchesReanimatedEvents` |
| `v3/detectors/VirtualDetector/InterceptingGestureDetector.tsx:63` | virtual children as `{viewTag, handlerTags}` (no `viewRef`) | tag to view for virtual children |
| `v3/detectors/VirtualDetector/InterceptingGestureDetector.tsx:250` | same as NativeDetector:55 | same |
| `v3/detectors/VirtualDetector/VirtualDetector.tsx:48` | `viewTag = findNodeHandle(node)` | tag to view |
| `v3/detectors/VirtualDetector/VirtualDetector.tsx:94` | `viewRef: undefined` | tag to view |
| `v3/detectors/useEnsureGestureHandlerRootView.ts:9` | dev error without root view | wrap apps in `GestureHandlerRootView` |
| `components/GestureButtons.tsx:31` | `shouldActivateOnStart: false` for buttons | handlers see the native config |
| `components/Text.tsx:47` | skips setting the `rnghtext` attribute | NativeView must not call `hasAttribute` on elements (5.1) |
| `components/Pressable/stateDefinitions.ts:145` | Android state machine (`getAndroidStatesConfig`) | expects Android event order |
| `components/Pressable/Pressable.tsx:257` | LongPress `minDuration(INT32_MAX)` | nothing |
| `components/Pressable/Pressable.tsx:280` | LongPress `onFinalize` ignored | nothing |
| `components/Pressable/Pressable.tsx:297` | `Native.onTouchesCancelled` resets the press | touch events needed (`needsPointerData`) |
| `components/Pressable/Pressable.tsx:322` | `Native.onFinalize` drives FINALIZE / CANCEL | Native handler must END / FAIL correctly |
| `components/Pressable/Pressable.tsx:336` | `shouldActivateOnStart(false)` | nothing |
| `components/Pressable/Pressable.tsx:362` | no cursor style | nothing |
| `v3/components/StatefulPressable.tsx:293, 322, 343, 383, 408, 419` | same pattern as `Pressable.tsx` | same |

On Android, `Gesture.Native()` in `Pressable` is attached to the native
`RNGestureHandlerButton` / `View`, and the Android native view manager
decides activation. The web `NativeViewGestureHandler` activates on
`role === Button && shouldActivateOnStart`, Switch or `rnghtext`
(`NativeViewGestureHandler.ts:157-161`); otherwise it activates after
movement or on up. With `role = null` (non-DOM view) the Android state
machine in `stateDefinitions.ts` is the only reference; this needs testing.

### 5.4 View identity and config

v2 (`GestureDetector`): `attachHandlers.ts:80-100` calls
`RNGestureHandlerModule.attachGestureHandler(handlerTag, viewTag, actionType)`
with `viewTag` a number (react tag of the detector child via
`handlers/utils.ts:67-72` → RN `findNodeHandle`). Action types
(`ActionType.ts:1-9`): `NONE 0`, `REANIMATED_WORKLET 1`,
`NATIVE_ANIMATED_EVENT 2`, `JS_FUNCTION_OLD_API 3`, `JS_FUNCTION_NEW_API 4`,
`NATIVE_DETECTOR 5`, `VIRTUAL_DETECTOR 6`. Old API (`createHandler.tsx`)
passes the same number.

v3 (`NativeDetector`): JS never calls `attachGestureHandler`. The detector
renders `RNGestureHandlerDetector` with props `handlerTags`,
`virtualChildren: [{handlerTags, viewTag}]`, `moduleId={globalThis._RNGH_MODULE_ID}`
(`v3/detectors/NativeDetector.tsx:98`). `_RNGH_MODULE_ID` is set by C++
`RNGHRuntimeDecorator::installRNRuntimeBindings` (`shared/runtime/RNGHRuntimeDecorator.cpp:91-93`).
The Android view (`RNGestureHandlerDetectorView.kt:29-157`) observes each tag
in its registry and calls `registry.attachHandlerToView(tag, viewTag, actionType, hostDetector)`;
handlers where `wantsToAttachDirectlyToView()` (NativeView) attach to the single
child view instead. The web equivalent is `HostGestureDetector.web.tsx`
(`attachReadyHandler`, `shouldAttachGestureToChildView()`,
`NativeViewGestureHandler.ts:267-269`), which imports
`RNGestureHandlerModule.web` and `NodeManager` directly.
Consequence: a JS module alone does not see v3 attachments; either alias
`v3/detectors/HostGestureDetector.tsx` to a JS component (for example the
`.web.tsx` logic with element refs), or read the detector props from the host.

Tag to view: RN 0.88 JS has no public tag → element lookup. The JS module
needs one of: alias `handlers/utils.ts` `findNodeHandle` to return the
instance; or a host method that measures by tag (the overlay NativeFantom
already has `*ByTag` methods: `enqueueNativeEventByTag`,
`enqueueScrollEventByTag`, `setTextInputTextByTag`).

Config keys:

- v2 `GestureDetector` sends `filterConfig(handler.config, ALLOWED_PROPS)`
  (`attachHandlers.ts:52, 67`; list in
  `handlers/gestures/GestureDetector/utils.ts:25-35`):
  - common (`handlers/gestureHandlerCommon.ts`): `id`, `enabled`,
    `shouldCancelWhenOutside`, `hitSlop` (normalized by `normalizeHitSlop`),
    `cancelsTouchesInView`, `userSelect`, `activeCursor`, `mouseButton`,
    `enableContextMenu`, `touchAction`, `needsPointerData`, `manualActivation`.
  - Tap: `maxDurationMs`, `maxDelayMs`, `numberOfTaps`, `maxDeltaX`,
    `maxDeltaY`, `maxDist`, `minPointers`.
  - Pan: `activeOffsetY/X`, `failOffsetY/X`, `minDist`, `minVelocity`,
    `minVelocityX/Y`, `minPointers`, `maxPointers`, `avgTouches`,
    `enableTrackpadTwoFingerGesture`, `activateAfterLongPress`, and
    `activeOffsetXStart/End`, `activeOffsetYStart/End`,
    `failOffsetXStart/End`, `failOffsetYStart/End`. The web Pan reads only the
    `*Start/End` forms (`web/handlers/PanGestureHandler.ts:96-132`).
  - LongPress: `minDurationMs`, `maxDist`, `numberOfPointers`.
  - Fling: `numberOfPointers`, `direction`.
  - Native: `shouldActivateOnStart`, `disallowInterruption`.
  - Old API also sends `waitFor` / `simultaneousHandlers` as tags
    (`filterConfig`, `handlers/utils.ts:26-30`).
- v3 `useGesture` (`v3/hooks/useGesture.ts:87-100`):
  `createGestureHandler(type, tag, {})`, then
  `setGestureHandlerConfig(tag, prepareConfigForNativeSide(type, config))`
  (`v3/hooks/utils/configUtils.ts:88-113`: whitelist per handler plus
  `dispatchesReanimatedEvents = shouldUseReanimatedDetector && !runOnJS`).
  `updateGestureHandlerConfig` is used for SharedValue bindings (may run on
  the UI runtime).
- Web base reads (`web/handlers/GestureHandler.ts`): `enabled`, `hitSlop`,
  `shouldCancelWhenOutside`, `manualActivation`, `mouseButton`,
  `needsPointerData`, `dispatchesAnimatedEvents`, `dispatchesReanimatedEvents`,
  `activeCursor`, `enableContextMenu`, `touchAction`, `userSelect`, `testID`.

Relations: `configureRelations(tag, {waitFor: number[], simultaneousHandlers: number[], blocksHandlers: number[]})`
(`v3/types/ConfigTypes.ts:46-50`). v2 builds it with `extractGestureRelations`
(`GestureDetector/utils.ts:67-79`: `requireToFail` → `waitFor`,
`simultaneousWith` → `simultaneousHandlers`, `blocksHandlers`); old API with
`selectProperties(newConfig, ['waitFor', 'simultaneousHandlers', 'blocksHandlers'])`
(`createHandler.tsx:270-278`). Web `InteractionManager.configureInteractions`
(`web/tools/InteractionManager.ts:16-60`) accepts numbers or handler objects.

### 5.5 Pointer input expected by the handlers

`AdaptedEvent` (`web/interfaces.ts:136-148`):
`x, y` (absolute, page coordinates), `offsetX, offsetY` (relative to the
attached view), `pointerId`, `eventType`, `pointerType` (`PointerType`:
`TOUCH 0, STYLUS 1, MOUSE 2, KEY 3, OTHER 4`), `time` (ms; velocity math uses
it), `button?` (bitmask, `MouseButton.LEFT = 1`, `RIGHT = 2`),
`stylusData?`, `wheelDeltaY?`.

The `EventManager` calls (`web/tools/PointerEventManager.ts`):

- `onPointerDown` for the first pointer, `onPointerAdd` for more
  (`eventType = ADDITIONAL_POINTER_DOWN`); only when the point is inside the
  view (lines 31-55).
- On move (86-140): `onPointerMove` if still inside;
  `onPointerEnter` / `onPointerLeave` on crossing the bounds;
  `onPointerOutOfBounds` for moves outside. Moves are ignored when no pointer
  is down (unless hover).
- `onPointerUp` for the last pointer, `onPointerRemove` for others
  (`ADDITIONAL_POINTER_UP`); ignored when `activePointersCounter === 0`.
- `onPointerCancel` on cancel; the manager then resets its counters.

Tap sequence: DOWN (inside) → optional MOVE → UP. `TapGestureHandler.ts`:
`onPointerDown` checks `isButtonInConfig(event.button)` (121-123), adds to
tracker, calls `begin()` on DOWN (`updateState`, state UNDETERMINED) and
`startTap` (starts the `maxDurationMs` timer). MOVE updates `lastX/Y` and fails
past `maxDeltaX/Y` / `maxDist`. UP in BEGAN calls `endTap`, which activates
and ends after `numberOfTaps` taps (otherwise starts the `maxDelayMs` timer).

Pan sequence: DOWN → MOVE... → UP. `PanGestureHandler.ts`: `onPointerDown`
(215-231) checks the button, tracks, `tryBegin`, `checkBegan`. MOVE (306-316)
tracks, updates velocity, and activates when `shouldActivate()` (388+) passes
`minDist` (default `DEFAULT_TOUCH_SLOP = 15`, `web/constants.ts:1`) or the
offset / velocity criteria. UP ends if ACTIVE, else fails. Velocity uses the
last samples within 300 ms (`VelocityTracker.ts:6-9`, 40 ms stop threshold,
minimum 3 samples), so moves need increasing `time` values.

`button`: `isButtonInConfig` (`GestureHandler.ts:938-944`) passes when
`button` is undefined or 0, or LEFT with no `mouseButton` config. It is used by
Tap, Pan, LongPress, Fling (lines 121, 218, 87, 118). The web manager passes
`event.buttons` (1 while the left button is down, 0 on up).

`pointerType`: set on DOWN (`GestureHandler.ts:342`). `TOUCH` makes the
orchestrator cancel mouse and pen gestures (344-346,
`GestureHandlerOrchestrator.ts:373-374`). Use `TOUCH` for tap/pan emulation;
`MOUSE` is the default before any event (line 76).

NativeViewGestureHandler on web: `shouldAttachGestureToChildView() → true`
(267-269); `shouldCancelWhenOutside = true` in `init` (68); `role` from DOM
attributes (79-86); button events and lifecycle events go through
`view.dispatchEvent` (5.1). For our port it needs: a `delegate.view` that
provides `hasAttribute` and `dispatchEvent` (or a patch), a way to deliver
`buttonPress*` events to `RNGestureHandlerButton` (for example
`enqueueNativeEvent(node, 'buttonPress', {pointerInside, x, y, absoluteX, absoluteY, numberOfPointers, pointerType})`,
payload from `getButtonEventData`, 380-400), and a decision for ScrollView
(web `role` detection does not apply; Android wraps ScrollView in a Native
handler that the native view manager drives).
