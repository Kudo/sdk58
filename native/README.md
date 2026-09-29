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
| `tester/CMakeLists.txt` | Adds `react/renderer/components/textinput` (only its cross-platform sources: all `platform/android/.../androidtextinput/*.cpp` files are removed from `rrc_textinput`), `src/components/*.cpp`, and links `rrc_textinput`. On macOS (option `FANTOM_MACOS_TEXT_LAYOUT`, default `ON`): enables `OBJCXX`, removes the stub `platform/cxx/.../TextLayoutManager.cpp` from `react_renderer_textlayoutmanager`, adds `src/platform/macos/TextLayoutManager.mm`, and links AppKit, CoreText and Foundation. |
| `tester/src/platform/macos/TextLayoutManager.mm` (new) | Text measurement with AppKit/TextKit 1 (`NSLayoutManager`). Port of the iOS `RCTTextLayoutManager.mm`, `RCTAttributedTextUtils.mm` and `RCTFontUtils.mm`. The upstream stub returns the minimum size (height 0) for all text. |
| `tester/src/render/A11yTree.h`, `A11yTree.cpp` (new) | Serializes the shadow tree (not the mounted tree, so views are not flattened) to typed JSON. |
| `tester/src/components/FantomTextInput.h`, `FantomSwitch.h`, `FantomComponents.cpp` (new) | Shadow nodes for `AndroidTextInput` and `AndroidSwitch` (see below). |
| `tester/src/stubs/StubComponentRegistryFactory.h` | Registers the two component descriptors above. |
| `tester/src/NativeFantom.h`, `NativeFantom.cpp` | Adds `getA11yTree`. It is registered in `methodMap_` in the constructor, not in the codegen spec, so the overlay does not need a change to `packages/react-native`. |

`NativeFantom.getA11yTree` signature (Flow):

```js
getA11yTree: (surfaceId: RootTag, includeDebugProps?: ?boolean) => string;
```

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
inputs are the CMake files). For incremental builds, run CMake directly:

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
FANTOM_PRINT_OUTPUT=1 yarn fantom FantomA11yTree   # also print the raw binary stdout
```

Note: a full `yarn fantom` run rewrites 12 LogBox `.snap` files (it adds
`maxFontSizeMultiplier` props). Revert them with `git checkout` after the run.
