# react-native-a11y-tree

Render a React Native component file headlessly and print its accessibility
and layout tree as JSON.

```sh
rn-a11y-tree render App.tsx > tree.json
```

The component is bundled with real Metro (Expo's `@expo/metro-config`) and
runs in a headless React Native Fabric host (React Native's "Fantom" tester:
C++ + Hermes, no simulator). The output is the mounted shadow tree with
absolute layout boxes.

Status: the JS/CLI side works up to producing the bundle. The host binary is
built separately; point `RN_A11Y_HOST_BIN` at it.

## Usage

```sh
yarn install
export RN_A11Y_HOST_BIN=/path/to/fantom_tester
yarn rn-a11y-tree render examples/basic/App.tsx
```

The file must have a default export or an `App` named export that is a React
component. Metro's project root is the directory of the nearest
`package.json` above the file, so the project's own dependencies resolve.
`react` and `react-native` resolve from that project first.

Options for `render <file>`:

| Option | Default | Description |
| --- | --- | --- |
| `--width <dp>` | `390` | Viewport width |
| `--height <dp>` | `844` | Viewport height |
| `--platform <name>` | `a11ytree` | Metro platform (see "Platform" below) |
| `--out <file>` | stdout | Write the JSON to a file |
| `--keep-bundle` | off | Keep the bundle and print its path to stderr |
| `--bundle-only` | off | Build the bundle and stop (no host needed) |
| `--dev` | off | Development bundle (`__DEV__ = true`) |
| `-v, --verbose` | off | Metro progress, host glog and console output on stderr |

Exit code is 1 on failure, with the message on stderr.

## Output schema

TypeScript types: [`src/schema.ts`](src/schema.ts).

```jsonc
{
  "viewport": {"width": 390, "height": 844},
  "root": {
    "ref": "n0",               // pre-order id within this render
    "type": "RootView",        // host component name from the shadow tree
    "sel": "RootView",         // "#testID" or a type path, e.g. "RootView>View>Paragraph:2"
    "role": null,              // accessibilityRole / role, or implicit (Paragraph/Text: "text", Image: "image")
    "name": null,              // accessibilityLabel, else aria-label, else text, else descendant text if accessible
    "a11y": {
      "accessible": true,      // only when reported
      "label": "...",
      "hint": "...",
      "state": {"disabled": false, "selected": false, "checked": true, "busy": false, "expanded": true},
      "hidden": true,          // importantForAccessibility no/no-hide-descendants, accessibilityElementsHidden, aria-hidden
      "raw": {"accessibilityRole": "button"}  // accessibility props as reported (strings)
    },
    "box": {"x": 0, "y": 0, "width": 390, "height": 844},  // absolute, dp
    "style": {"backgroundColor": "rgba(255, 255, 255, 1)"}, // other reported props (strings)
    "text": null,              // text content of Paragraph / Text fragment nodes
    "testID": null,
    "children": []
  }
}
```

Notes:

- The host reports props through React Native's debug-string props
  (`getDebugProps`). Only props that differ from their defaults are present,
  and all values are strings. This needs a host built with
  `RN_DEBUG_STRING_CONVERTIBLE=1`; without it, `props` is empty and there are
  no boxes.
- `<Text>` renders as a `Paragraph` host node. Nested `<Text>` spans appear
  as `Text` child nodes without their own layout; they get the `Paragraph`'s
  box.
- The `role` prop is not in the host's debug props today (only
  `accessibilityRole` is), so `role="..."` without `accessibilityRole` is not
  visible yet.

## Architecture

```
rn-a11y-tree render App.tsx
  │
  ├─ src/bundle.ts   write runtime/entry-template.js (placeholders filled) to a temp dir
  │                  Metro.runBuild with expo/metro-config getDefaultConfig + overrides
  │                  -> single-file bundle (platform "a11ytree", dev=false, minify=false)
  │
  ├─ src/host.ts     spawn $RN_A11Y_HOST_BIN --bundlePath <bundle> --featureFlags {} --minLogLevel error
  │                  read newline-delimited JSON on stdout
  │
  │    host: load bundle -> call global.$$RunTests$$()
  │    JS:   Fantom.createRoot({viewportWidth, viewportHeight})
  │          Fantom.runTask(() => root.render(<App />))
  │          NativeFantom.getRenderedOutput(rootTag, {includeRoot, includeLayoutMetrics})
  │          NativeFantom.reportTestSuiteResultsJSON('{"type":"rn-a11y-tree-result","rnA11yTree":{...}}')
  │
  └─ src/tree.ts     Fantom JSON (type/props/children, layoutMetrics-* props) -> output schema
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
- `resolver.platforms` starts with the platform (`a11ytree`) and `native`.
- `watchFolders` adds the project root, this package, and the temp entry dir
  (Metro does not find files in the project root without it when the project
  is outside this repo).
- `resolver.resolveRequest`:
  - Bare imports from `runtime/` and the generated entry resolve from the
    user's project first, so there is one copy of `react` and `react-native`.
  - Platform fallback: a file is taken for `a11ytree` only if it is a
    `.a11ytree.*` file. Otherwise the request resolves as `android` (Fantom
    also bundles for `android`). This is needed because react-native has
    modules that exist only as `.ios.js` / `.android.js`, and some `.js`
    files re-import themselves by platform (`Libraries/Utilities/Platform.js`
    imports `./Platform`).
- The user's `metro.config.js` is not loaded.

### Platform

Metro inlines `Platform.OS` from the bundle platform, so app code sees
`Platform.OS === 'a11ytree'` and `Platform.select` picks `native` /
`default`. react-native internals resolve to their Android implementations.
Use `--platform android` to make both agree.

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
    We send `{"type":"rn-a11y-tree-result","rnA11yTree":{"viewport":{...},"tree":{...}}}`
    or `{"type":"rn-a11y-tree-error","error":{"message":"...","stack":"..."}}`.
- glog goes to stderr.

## Development

```sh
yarn typecheck        # tsc --noEmit
yarn test             # unit tests + CLI tests against a fake host (test/fixtures/fake-host.js)
yarn test:e2e         # real host; skipped unless RN_A11Y_HOST_BIN is set
yarn rn-a11y-tree render examples/basic/App.tsx --bundle-only
```

Versions: Expo SDK 58 (`expo@58.0.0`), `react-native@0.88.0-rc.2`,
`react@19.3.0`, Metro 0.87.1. Yarn 4 with `nodeLinker: node-modules`.

## Milestones

1. JS/CLI: Metro bundle, vendored Fantom runtime, host protocol, tree
   conversion. (done, except running on the real host)
2. Host binary: build Fantom's tester standalone for macOS/Linux, with
   `RN_DEBUG_STRING_CONVERTIBLE`. Run `yarn test:e2e`.
3. Accessibility fidelity: report `role`, `aria-*`, `accessibilityValue`,
   and per-span text layout from the host; derive names the way iOS/Android
   screen readers do.
4. Packaging: publish with prebuilt host binaries; support Expo modules that
   need native code (stubs).
