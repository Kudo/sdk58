# react-native-a11y-tree

Render a React Native component file headlessly and print its accessibility
and layout tree as JSON.

```sh
rn-a11y-tree render App.tsx --platform android > tree.json
```

The component is bundled with real Metro (Expo's `@expo/metro-config`) and
runs in a headless React Native Fabric host (React Native's "Fantom" tester:
C++ + Hermes, no simulator). The output is the mounted shadow tree with
absolute layout boxes.

Status: works end to end on macOS arm64 with the host built by
`yarn build:host`. Text is measured with CoreText, and the tree comes from the
committed ShadowTree (`source: "shadowTree"`).

## Usage

```sh
git clone --recurse-submodules --shallow-submodules <this repo>
yarn install
yarn build:host        # builds native/dist/<arch>/rn-a11y-host (macOS only for now)
yarn rn-a11y-tree render examples/basic/App.tsx --platform android
```

The CLI uses `native/dist/<arch>/rn-a11y-host`. Set `RN_A11Y_HOST_BIN` to use
another host binary.

The file must have a default export or an `App` named export that is a React
component. Metro's project root is the directory of the nearest
`package.json` above the file, so the project's own dependencies resolve.
`react` and `react-native` resolve from that project first.

Options for `render <file>`:

| Option | Default | Description |
| --- | --- | --- |
| `--width <dp>` | `390` | Viewport width |
| `--height <dp>` | `844` | Viewport height |
| `--platform <name>` | required | Metro platform: `android`, `ios`, `a11ytree`, or any Metro platform name (see "Platform" below) |
| `--out <file>` | stdout | Write the JSON to a file |
| `--keep-bundle` | off | Keep the bundle and print its path to stderr |
| `--bundle-only` | off | Build the bundle and stop (no host needed) |
| `--debug-props` | off | Add raw host debug props to each node (`debugProps`; `shadowTree` source only) |
| `--dev` | off | Development bundle (`__DEV__ = true`) |
| `-v, --verbose` | off | Metro progress, host glog and console output on stderr |

Exit code is 1 on failure, with the message on stderr.

## Output schema

TypeScript types: [`src/schema.ts`](src/schema.ts).

```jsonc
{
  "viewport": {"width": 390, "height": 844},
  "source": "shadowTree",      // or "mounted", see "Tree sources"
  "root": {
    "ref": "n0",               // pre-order id within this render
    "type": "RootView",        // host component name from the shadow tree
    "sel": "RootView",         // "#testID" or a type path, e.g. "RootView>View>Paragraph:2"
    "role": null,              // role, else accessibilityRole, else implicit (Paragraph/Text: "text", Image: "image",
                               // Switch: "switch", TextInput: "textbox"); "none"/"presentation" -> null
    "name": null,              // accessibilityLabel, else own text, else descendant text if accessible
    "a11y": {
      "accessible": true,      // only when reported
      "label": "...",
      "hint": "...",
      "state": {"disabled": false, "selected": false, "checked": true, "busy": false, "expanded": true},
      "hidden": true,          // importantForAccessibility no/no-hide-descendants, accessibilityElementsHidden, aria-hidden
      "raw": {"accessibilityRole": "button"}  // accessibility props as reported (strings)
    },
    "box": {"x": 0, "y": 0, "width": 390, "height": 844},  // absolute, dp
    "style": {"backgroundColor": "rgba(255, 255, 255, 1)"}, // other props: visual, Yoga style, font, component props
    "text": null,              // text content of Paragraph / Text fragment / TextInput nodes
    "testID": null,
    "virtual": true,           // only on nodes without their own frame (box = parent's box)
    "debugProps": {},          // only with --debug-props (shadowTree source)
    "children": []
  }
}
```

### Tree sources

The entry uses `NativeFantom.getA11yTree(surfaceId, includeDebugProps)` when
the host implements it, else `NativeFantom.getRenderedOutput`.

- `shadowTree` (`getA11yTree`, in the host built by `yarn build:host`): the
  committed ShadowTree. The hierarchy is complete (no view flattening),
  values are typed (numbers, booleans), and `role`, `accessibilityValue` and
  text fragments are available. Mapping tables are at the top of the
  `shadowTree` section in `src/tree.ts`. Notes:
  - `box` values are rounded to 1/1000 dp (layout is pixel-snapped, which
    leaves float noise such as `63.99999`).
  - `yogaStyle` edge and gutter objects are flattened to React Native style
    names: `padding: {all: 24, top: 8}` becomes `padding: 24, paddingTop: 8`
    (same for `margin`; `border` -> `borderWidth`, `borderTopWidth`, ...;
    `position` -> `inset`, `insetInline`, `insetBlock`, `left`, `top`, ...;
    `gap` -> `gap`, `rowGap`, `columnGap`). Other Yoga keys keep their Yoga
    names (for example `positionType`).
  - A `Paragraph`'s `RawText` children are dropped (the text is in `text`).
    Nested `<Text>` spans are dropped unless they have `accessibilityLabel`,
    `role`, `accessibilityRole`, `accessible` or `testID`; kept spans have no
    frame of their own, so they get the `Paragraph`'s box and
    `"virtual": true`. Any other node without a frame is handled the same way.
- `mounted` (`getRenderedOutput`, upstream Fantom): the mounted view tree.
  Notes:
  - Props are React Native debug-string props (`getDebugProps`): only
    non-default props, all values are strings. The host must be built with
    `RN_DEBUG_STRING_CONVERTIBLE=1`; without it there are no props and no
    boxes.
  - Fabric view flattening applies, the same as on iOS/Android:
    - A `<View>` with only layout styles is removed from the tree. Use
      `collapsable={false}` to keep it.
    - A `<View>` that draws something (for example `backgroundColor`) but
      does not form a stacking context is kept, but its children are moved
      up to the nearest ancestor that forms a stacking context. They appear
      as siblings that come after the `View`. Their frames are relative to
      their new parent, so `box` is still correct.
  - `<Text>` renders as a `Paragraph` host node. Nested `<Text>` spans
    appear as `Text` child nodes without their own layout; they get the
    `Paragraph`'s box.
  - The `role` prop is not in the debug props (only `accessibilityRole`
    is), so `role="..."` without `accessibilityRole` gives `role: null`.

## Architecture

```
rn-a11y-tree render App.tsx --platform android
  │
  ├─ src/bundle.ts   write runtime/entry-template.js (placeholders filled) to a temp dir
  │                  Metro.runBuild with expo/metro-config getDefaultConfig + overrides
  │                  -> single-file bundle (--platform, dev=false, minify=false)
  │
  ├─ src/host.ts     spawn $RN_A11Y_HOST_BIN --bundlePath <bundle> --featureFlags {} --minLogLevel error
  │                  read newline-delimited JSON on stdout
  │
  │    host: load bundle -> call global.$$RunTests$$()
  │    JS:   Fantom.createRoot({viewportWidth, viewportHeight})
  │          Fantom.runTask(() => root.render(<App />))
  │          NativeFantom.getA11yTree(rootTag, includeDebugProps)   (if the host has it)
  │            else NativeFantom.getRenderedOutput(rootTag, {includeRoot, includeLayoutMetrics})
  │          NativeFantom.reportTestSuiteResultsJSON('{"type":"rn-a11y-tree-result","rnA11yTree":{...}}')
  │
  └─ src/tree.ts     shadowTree or mounted JSON -> output schema
```

`runtime/fantom/` is the Fantom JS runtime vendored from React Native (not on
npm). See [`runtime/fantom/VENDORED.md`](runtime/fantom/VENDORED.md).

### Metro config

Base: `getDefaultConfig(projectRoot)` from `expo/metro-config`. Overrides:

- `serializer.getModulesRunBeforeMainModule: () => []`: no `InitializeCore`.
  The entry calls `setUpDefaultReactNativeEnvironment` (LogBox and dev tools
  off), like Fantom.
- `resolver.blockList` adds `RendererProxy.fb.js`.
- `transformer.hermesParser: true`.
- `resolver.platforms` starts with the `--platform` value and `native`.
- `watchFolders` adds the project root, this package, and the temp entry dir
  (Metro does not find files in the project root without it when the project
  is outside this repo).
- `resolver.resolveRequest`:
  - Bare imports from `runtime/` and the generated entry resolve from the
    user's project first, so there is one copy of `react` and `react-native`.
  - Platform fallback (only for an out-of-tree platform, that is a name
    that is not `ios`, `android`, `tvos` or `macos`, for example `a11ytree`):
    a file is taken for that platform only if it is a `.a11ytree.*` file. Otherwise the request resolves as `android`. This is
    needed because react-native has modules that exist only as `.ios.js` /
    `.android.js`, and some `.js` files re-import themselves by platform
    (`Libraries/Utilities/Platform.js` imports `./Platform`).
- The user's `metro.config.js` is not loaded.

### Platform

`--platform` is required; the CLI does not pick one. Known values:

- `android`: the platform Fantom bundles for. The host implements the
  Android native components (`AndroidTextInput`, `AndroidSwitch`), so this
  is the value to use for TextInput and Switch.
- `ios`: resolves `.ios.*` files. react-native then uses the iOS native
  components (for example `Switch`, `RCTSinglelineTextInputView`), which the
  host does not implement yet.
- `a11ytree`: out-of-tree platform mode. Files named `.a11ytree.*` are used
  when they exist; all other platform files resolve as `android`.

Any other Metro platform name is accepted too. Metro inlines `Platform.OS`
from the bundle platform in all modules, including react-native's own code,
and react-native core components branch on `Platform.OS === 'android'` /
`'ios'`. With an out-of-tree name such as `a11ytree`, neither branch matches:
TextInput renders nothing, and Switch renders the iOS `Switch` component
(0x0 box in this host). Use `android` or `ios` for those components.

### Host stdout protocol

From Fantom's `tester/src` (`main.cpp`, `AppSettings.cpp`,
`TesterAppDelegate.cpp`, `NativeFantom.cpp`):

- Flags (gflags): `--bundlePath`, `--featureFlags <json>`,
  `--minLogLevel info|warning|error|fatal`, `--windowWidth`,
  `--windowHeight`, `--inspectorPort`, `--interactive`.
- The host loads the bundle, then calls `global.$$RunTests$$()` once.
- stdout is newline-delimited JSON:
  - `console.*` from JS: `{"type":"console-log","level":"info|warn|error","message":"..."}`
  - `NativeFantom.reportTestSuiteResultsJSON(s)` prints `s` and a newline.
    We send `{"type":"rn-a11y-tree-result","rnA11yTree":{"viewport":{...},"source":"shadowTree|mounted","tree":{...}}}`
    or `{"type":"rn-a11y-tree-error","error":{"message":"...","stack":"..."}}`.
- glog goes to stderr.

## Building the host

`yarn build:host` runs [`scripts/build-host.sh`](scripts/build-host.sh):

1. Checks `JAVA_HOME` (default `/opt/homebrew/opt/openjdk@17`, JDK 17) and
   `ANDROID_HOME` (default `~/Library/Android/sdk`). Installs
   `cmake;3.30.5` with `sdkmanager` if it is missing. The Android SDK is only
   used for its CMake; nothing is built for Android.
2. Runs `yarn install` (Yarn 1.22.22 through corepack) in
   `third_party/react-native`. A `yarn` shim that runs Yarn 1 is put first on
   `PATH`, because React Native's codegen calls `yarn` and does not work with
   Yarn 4.
3. Copies `native/overlay/` over `third_party/react-native/private/react-native-fantom/`.
   This changes files in the submodule's working tree; do not commit them
   there. Put patches in `native/overlay/` instead.
4. Runs `./gradlew :private:react-native-fantom:buildFantomTester`. Logs:
   `third_party/react-native/private/react-native-fantom/build/reports/`.
   Then always runs `cmake --build .../build/tester --target fantom_tester`,
   because Gradle tracks only CMake files as inputs and can skip the build
   after `.cpp`/`.mm` edits. It warns if the binary is older than a file in
   `native/overlay/`.
5. Copies `fantom_tester` to `native/dist/<arch>/rn-a11y-host`, and the
   `@rpath` dylibs (`libhermesvm.dylib`, `libjsi.dylib`) to
   `native/dist/<arch>/lib/`. Absolute rpaths are replaced with
   `@executable_path/lib` (binary) and `@loader_path` (dylibs), and the files
   are ad-hoc signed again. The folder can be moved.

Known limitation: the binary links Homebrew OpenSSL by absolute path
(`/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib`), so the machine needs
`brew install openssl@3`.

`third_party/react-native` is React Native `0.88-stable` at `6007151`
(a shallow submodule).

## Development

```sh
yarn typecheck        # tsc --noEmit
yarn test             # unit tests + CLI tests against a fake host (test/fixtures/fake-host.js)
yarn test:e2e         # real host; skipped if there is no native/dist binary and no RN_A11Y_HOST_BIN
yarn rn-a11y-tree render examples/basic/App.tsx --platform android --bundle-only
```

Versions: Expo SDK 58 (`expo@58.0.0`), `react-native@0.88.0-rc.2`,
`react@19.3.0`, Metro 0.87.1. Yarn 4 with `nodeLinker: node-modules`.

## Milestones

1. JS/CLI: Metro bundle, vendored Fantom runtime, host protocol, tree
   conversion. (done)
2. Host build from this repo: `yarn build:host`, relocatable
   `native/dist/<arch>/`. (done, macOS arm64)
3. Text measurement with CoreText in the host. (done)
4. Typed ShadowTree dump (`NativeFantom.getA11yTree`): full hierarchy,
   `role`, typed a11y state, text fragments. (done)
5. CI and release: build and publish prebuilt host binaries (macOS
   arm64/x86_64, Linux), remove the Homebrew OpenSSL dependency. (pending)
6. Expo modules and other libraries with native code: stubs or host
   implementations. (pending)
