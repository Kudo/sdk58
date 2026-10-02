# react-native-a11y-tree

Render a React Native component file headlessly and print its accessibility
and layout tree as JSON; drive it with taps, typing, scrolling and gestures.

```sh
rn-a11y-tree render App.tsx --platform android > tree.json
```

The component is bundled with real Metro (Expo's `@expo/metro-config`) and
runs in a headless React Native Fabric host (React Native's "Fantom" tester:
C++ + Hermes, no simulator). The output is the committed ShadowTree with
on-screen layout boxes. The native side is documented in
[`native/README.md`](native/README.md); the e2e coverage in
[`docs/e2e-coverage.md`](docs/e2e-coverage.md).

## Status

macOS arm64 only (the host is built by `bun run build:host`).

| Feature | How it is real | E2E | Known gaps |
| --- | --- | --- | --- |
| Rendering and layout | Real Fabric (React, ShadowTree, Yoga) in the Fantom host | `e2e/render.test.ts` | macOS only; one surface per run |
| Text measurement | CoreText `TextLayoutManager` in the host; or the portable layout (stb_truetype, embedded Roboto; `RN_A11Y_TEXT_LAYOUT=portable`, see `native/README.md`) | `e2e/render.test.ts` (heights > 10) | macOS fonts, not Android/iOS fonts; portable: Roboto stands in for SF |
| Accessibility tree | Host `NativeFantom.getA11yTree` (typed ShadowTree dump) → `src/tree.ts` | `e2e/render.test.ts` | Role/name derivation is simpler than real screen readers |
| TextInput, Switch | Host `AndroidTextInput` / iOS `TextInput` (CoreText measured) and `AndroidSwitch` / `Switch` shadow nodes | `e2e/render.test.ts`, `e2e/run.test.ts` (both presets) | |
| Tap, long press, typing | Host `hitTest` + by-tag native events, Pressable responder events, `setTextInputTextByTag` | `e2e/run.test.ts` | No multi-touch responder events; `click` does not bubble |
| Scrolling, FlatList | Host scroll events and ScrollView state; `onLayout` delivered by settling the event queue | `e2e/scrolling.test.ts` | One scroll event per `scroll` action (no fling) |
| Session mode | Host `--interactive` mode, one bundle | `e2e/session.test.ts` | No recovery after a host crash |
| react-native-screens | Library C++ compiled into the host; screen state emulated by the host | `e2e/navigation-stack.test.ts` | No transitions |
| react-native-safe-area-context | Library C++ compiled into the host; insets from `--safe-area-insets` | `e2e/navigation-stack.test.ts` (default insets) | No e2e with non-zero insets yet |
| react-native-gesture-handler | Host descriptors for detector/root/button; JS module on RNGH's web handlers fed by the runner; worklet callbacks through Reanimated | `e2e/gestures.test.ts` | No v3 Reanimated detector events, virtual detectors, or transforms in `absoluteToLocal` |
| react-native-reanimated | Reanimated + worklets C++ in the host; UI frames from `wait` (`produceFramesForDuration` per 16.333 ms); mounted-view values for layout animations | `e2e/reanimated.test.ts` | |
| `@expo/ui` (Expo module views) | expo-modules-core Fabric descriptors in the host; Expo's JS `globalThis.expo` polyfill + view configs + module stubs (`runtime/expo/`); direct events and modifier callbacks | `e2e/expo-ui.test.ts` | Frames come from the host's SwiftUI and Compose layout engines (emulations of the frameworks, checked against reference harnesses in `native/tools/`); see [Expo support](docs/expo-support.md) for other packages |

## Install

Changes per version: [CHANGELOG.md](CHANGELOG.md).

From version 0.1.0 (macOS arm64 only), in an Expo SDK 58 project:

```sh
npx react-native-a11y-tree render App.tsx --preset android-phone --format text
# or: npm install -D react-native-a11y-tree && npx rn-a11y-tree render ...
```

The CLI and its optional native runtimes:

- `react-native-a11y-tree`: the CLI. Its `bin` is `dist/rn-a11y-tree.js`,
  one ES module that `bun build` makes from `packages/react-native-a11y-tree/src/cli.ts` for Node
  (`bun run build`, run by `prepack` together with `bun run schema
  --check`); in a repo checkout, `bun run rn-a11y-tree` runs `node
  packages/react-native-a11y-tree/src/cli.ts` (Node strips the types). Files: `dist/`,
  `runtime/`, `schema/`, `tools/`, `README.md`, `LICENSE`. Commander and
  runtime selection are bundled into the CLI, so it has no required npm
  JavaScript dependencies. Peer dependencies: `expo` (>= 58),
  `react-native`, `react`. Metro, `metro-config`, `expo/metro-config` and
  `hermes-compiler` are loaded from the project (the copies that Expo and
  React Native install), so the bundle uses the project's Metro.
- The CLI directly depends on these exact-version optional runtime packages:
  `@react-native-a11y-tree/runtime-darwin-universal` (macOS arm64/x64),
  `@react-native-a11y-tree/runtime-linux-x64-gnu` (glibc 2.28+), and
  `@react-native-a11y-tree/runtime-win32-x64-msvc`.
  Their `os`/`cpu` fields (and Linux `libc`) let the package manager install
  only the matching binary. Resolution lives inside the CLI's single JS
  bundle; there is no separate resolver package, postinstall download, or
  extra CLI command. Keep optional dependencies enabled; for an installation
  made with `--omit=optional`, reinstall with `npm install --include=optional`.
  The existing `RN_A11Y_HOST_*` overrides and binary filenames still work.

Local check of this flow: `e2e/package.test.ts` packs the CLI and current platform package
(`npm pack`), installs them with `expo@58.0.0 react-native@0.88.0-rc.2
react@19.3.0` into a scratch project and runs `npx rn-a11y-tree render
App.tsx --preset android-phone --format text` (skipped without `npm` or a
`native/dist` host). The release workflow does the same
with the packages it builds (`scripts/verify-packages.sh`), on Linux, macOS, and Windows.

## Quick start

```sh
git clone --recurse-submodules --shallow-submodules <this repo>
bun install
bun run build:host        # builds native/dist/<arch>/rn-a11y-host
bun run rn-a11y-tree render examples/basic/App.tsx --platform android
bun run check             # bun run typecheck, bun run schema --check, bun run test, bun run test:e2e
```

The CLI uses `native/dist/<arch>/rn-a11y-host` (`rn-a11y-host.exe` on
Windows). Set `RN_A11Y_HOST_BIN` to use another host binary, or
`RN_A11Y_HOST_BASE_URL` to download a prebuilt host (see
[Prebuilt host](#prebuilt-host)). `RN_A11Y_HOST_RUNNER=<program>` starts the
host as `<program> <host> <args>` (the unit tests run the script fake host
with `bun`, also on Windows).

## CLI reference

The file must have a default export or an `App` named export that is a React
component. Metro's project root is the directory of the nearest
`package.json` above the file, so the project's own dependencies resolve.
`react` and `react-native` resolve from that project first. stdout has only
the result; see [Errors and exit codes](#errors-and-exit-codes) for failures.

| Command | What it does | Output |
| --- | --- | --- |
| `render <file>` | Render once and print the tree | `{viewport, source, root}` ([schema](#output-schema)) |
| `run <file> --script <json>` | Render, run the actions, print steps and trees | `{viewport, source, steps, snapshots, final, fallbacks, capabilities}` ([Interactions](#interactions)) |
| `session <file>` | Render, then serve JSON-line requests on stdin | one JSON object per line ([Session mode](#session-mode)) |
| `check <file> --rules <json>` | Render (or run `--script`), then evaluate accessibility and design-token rules; exit 2 on violations | `{ok, summary, nodes, violations}` ([Check](#check)) |
| `schema [name]` | Print `schema/<name>.json` (e.g. `script`, `rules-file`, `session-request`); no name: list the schemas | JSON Schema, or `name<TAB>description` lines ([Schemas](#schemas-and-tool-descriptors)) |

| Option | Commands | Default | Description |
| --- | --- | --- | --- |
| `--preset <name>` | all | none | Device preset: `android-phone`, `ios-phone`, `android-tablet`, `ios-tablet` (see [Presets](#presets-and-a11y-treejson)) |
| `--platform <name>` | all | required unless a preset or `a11y-tree.json` sets it | Metro platform: `android`, `ios`, `a11ytree`, or any Metro platform name (see [Platform](#platform)) |
| `--width <dp>` | all | preset, else `390` | Viewport width |
| `--height <dp>` | all | preset, else `844` | Viewport height |
| `--header-height <dp>` | all | preset, else 44 for `--platform ios`, else 56 (host) | react-native-screens native header height |
| `--safe-area-insets <t,l,r,b>` | all | preset, else `0,0,0,0` | react-native-safe-area-context insets, e.g. `47,0,0,34` |
| `--scale <n>` | all | preset, else 3 | Device pixel ratio: `PixelRatio.get()` and the `scale` of `Dimensions` / `useWindowDimensions()` |
| `--font-scale <n>` | all | preset (1), else 1 | `PixelRatio.getFontScale()`, `fontScale` of `Dimensions`, and the text size multiplier (`<Text>` without `allowFontScaling={false}`) |
| `--tz <zone>` | all | `UTC` | Time zone of the app: the host runs with `TZ=<zone>` (IANA name like `America/Los_Angeles`, or POSIX like `JST-9`), so date strings do not depend on the machine's time zone. On Windows only POSIX values work (`UTC`, `JST-9`, `PST8PDT`; the MSVC runtime does not read IANA names): a name with `/` prints a warning (unless `--quiet`) |
| `--no-mounted` | all | mounted on | Do not read mounted-view values (`getA11yTree` `includeMountedProps`; used for `visualBox`, `effectiveOpacity`) |
| `--timing` | all | off | Print phase timings as JSON on stderr (see [`docs/perf-analysis.md`](docs/perf-analysis.md)) |
| `--reset-cache` | all | off | Ignore Metro's caches and the bundle cache (cold bundle) |
| `--no-cache` | all | cache on | Do not use the bundle cache (always run Metro) |
| `--bytecode <mode>` | all | `auto` | Hermes bytecode: `auto` (use it when cached; compile in the background after a build), `on` (compile now), `off` |
| `--dev` | all | off | Development bundle (`__DEV__ = true`) |
| `--keep-bundle` | all | off | Keep the bundle and print its path to stderr |
| `-v, --verbose` | all | off | Metro progress, host glog and console output on stderr |
| `-q, --quiet` / `--no-quiet` | all | quiet when stdout is not a terminal | No app console output or CLI warnings on stderr (they are in `logs` / `fallbacks`) |
| `--out <file>` | `render`, `run` | stdout | Write the output to a file |
| `--format <f>` | `render`, `run` | `json` | `json`, `compact` (no defaults/empties, no `style`), `text` (one line per node), `ndjson` (one node per line) |
| `--select <sel>` | `render`, `run` | all | Only nodes matching `field=value` or `field~text` (fields: `testID`, `role`, `name`, `type`, `key`, `ref`, `sel`, `text`); repeat to AND. Matches only, unless `--depth` |
| `--depth <n>` | `render`, `run` | all | Levels of children below each output root (0 = node only) |
| `--subtree <sel>` | `render`, `run` | root | Start the output at the first node matching the selector |
| `--style` | `render`, `run` | off | Keep `style` in `compact`/`ndjson` |
| `--bundle-only` | `render`, `run` | off | Build the bundle and stop (no host needed) |
| `--debug-props` | `render` | off | Add raw host debug props to each node (`debugProps`) |
| `--script <json>` | `run`, `check` | required for `run` | Script file `{"$schema": ..., "actions": [...]}` or `[...]`, or that JSON itself (a value that starts with `[` or `{`). `check`: run them, then check the final tree |
| `--tap-mode <mode>` | `run`, `session`, `check` | `touch` | Events for taps: `touch` (responder touches), `click`, or `both` |
| `--rules <json>` | `check` | `rules` in `a11y-tree.json` | Rules file `{"rules": {...}}`, or that JSON itself (a value that starts with `{`) (see [Check](#check)) |
| `--diff` | `run` | off | Add `diff: {added, removed, changed}` (by `key`) to each step |
| `--timeout <ms>` | `session` | `30000` | Per-request timeout; on timeout the host is killed and the exit code is 1 |

## Presets and a11y-tree.json

A preset sets the platform, viewport, safe area insets, header height and
device scale:

| Preset | Platform | Viewport | Insets (t,l,r,b) | Header | Scale |
| --- | --- | --- | --- | --- | --- |
| `android-phone` | `android` | 412x915 (Pixel 8) | 24,0,0,0 | 56 | 3 |
| `ios-phone` | `ios` | 393x852 (iPhone 15/16) | 59,0,0,34 | 44 | 3 |
| `android-tablet` | `android` | 800x1280 (Pixel Tablet, portrait) | 24,0,0,0 | 64 | 2 |
| `ios-tablet` | `ios` | 834x1194 (iPad 11", portrait) | 24,0,0,20 | 50 | 2 |

```sh
rn-a11y-tree render App.tsx --preset android-phone
rn-a11y-tree render App.tsx --preset ios-phone --platform android   # iPhone size, Android components
```

`Dimensions` (window and screen) and `PixelRatio` follow the viewport,
`scale` and `fontScale`: the bundle calls `NativeFantom.setDeviceMetrics`
before the app module loads (apps often read `Dimensions` at import time).
Hosts without it (no `deviceMetrics` capability) report 1280x720, scale 0.

An optional `a11y-tree.json` in the project root (the directory of the app
file's nearest `package.json`) holds defaults for the project. Allowed keys:
`preset`, `platform`, `width`, `height`, `safeAreaInsets`
(`{top, left, right, bottom}`), `headerHeight`, `scale`, `fontScale`,
`tapMode`, `format`, `rules`. Unknown
keys and wrong types are usage errors (exit 1).

```json
{"$schema": "./node_modules/react-native-a11y-tree/schema/a11y-tree-config.json", "preset": "android-phone", "format": "text"}
```

For each setting the first value found wins: command-line flag,
`a11y-tree.json`, preset (from `--preset`, else the config's `preset`),
built-in default. `--platform` therefore overrides the preset's platform.
Note that the config's own values also override a `--preset` given on the
command line.

## Check

`check` renders the component (or runs `--script` and uses the final tree),
evaluates rules on the tree and prints the result. The exit code is 0 when
all checks pass and 2 when there are violations. `--format text` prints one
line per violation; `--subtree <sel>` checks only one part of the screen.

```sh
rn-a11y-tree check examples/basic/App.tsx --platform android --rules examples/basic/rules-fail.json --format text
# FAIL touchTarget email height: touch target height 36.333 < 48
# FAIL touchTarget remember height: touch target height 31 < 48
# FAIL tokens submit backgroundColor: backgroundColor #1e6fff is not a token color
# FAIL contrast submit/Paragraph:1 contrast: contrast 4.4:1 < 4.5:1 (#ffffff on #1e6fff)
# failed: 4 violation(s), 7 of 8 nodes checked
```

Rules file (the `rules` object can also be in `a11y-tree.json`, which
`check` uses when there is no `--rules`):

```json
{
  "$schema": "./node_modules/react-native-a11y-tree/schema/rules-file.json",
  "rules": {
    "names": true,
    "touchTarget": {"min": 48, "ignore": ["testID=remember"]},
    "hiddenFocusable": true,
    "contrast": {"min": 4.5, "minLarge": 3},
    "tokens": {
      "colors": {"background": "#ffffff", "text": "#000000", "primary": "#1e6fff"},
      "spacing": 8,
      "fonts": ["System"],
      "fontSizes": [14, 16, 28]
    }
  }
}
```

| Rule | Nodes | Passes when |
| --- | --- | --- |
| `names` | Focusable nodes (interactive `role`, or `accessible: true`) and images, not inside an `accessible` ancestor, not hidden | `name` is not empty. For `textbox`, the placeholder counts (`from: "placeholder"`) |
| `touchTarget` (`min`, default 48) | Nodes with an interactive role, not grouped, not hidden | `box.width >= min` and `box.height >= min` |
| `hiddenFocusable` | Focusable nodes | Not hidden from screen readers. Hidden = own `a11y.hidden`, or an ancestor with `importantForAccessibility: "no-hide-descendants"` / `accessibilityElementsHidden` (`"no"` hides only the node itself) |
| `contrast` (`min`, default 4.5; `minLarge`) | Nodes with `text` and a `color` (not TextInput), not hidden | WCAG 2.x ratio of `color` (composited over the background) to the background `>= min`. Large text (>= 24 dp, or >= 18.66 dp bold) uses `minLarge` when set |
| `tokens.colors` (array, or name -> color) | `color`, `backgroundColor`, `borderColors` (not transparent) | The color is in the list (alpha to 0.01) |
| `tokens.spacing` (grid step, or array) | Numeric non-zero `margin*`, `padding*`, `gap`, `rowGap`, `columnGap` | Multiple of the step, or in the array |
| `tokens.fonts` | Paragraphs with text | `fontFamily` is in the list (`"System"` = no `fontFamily`) |
| `tokens.fontSizes` | Paragraphs with text and a `fontSize` | `fontSize` is in the list |

Every rule object accepts `ignore: [selector, ...]` (the `--select` syntax).
The contrast background is `style.effectiveBackground` from the host (the
ancestors' backgrounds composited over the white window) when present, else
the CLI composites the ancestors' `backgroundColor` values over white
(`bgFrom: "host"` or `"ancestors"`). Opacity (`effectiveOpacity`), images
and gradients behind text are not taken into account.

Output:

```jsonc
{
  "ok": false,
  "viewport": {"width": 390, "height": 844},
  "source": "shadowTree",
  "summary": {"nodes": 8, "checked": 7, "violations": 4, "byRule": {"touchTarget": 2, "tokens": 1, "contrast": 1}},
  // Every node with at least one evaluated property (some props left out here).
  "nodes": [
    {"ref": "n6", "key": "submit", "sel": "#submit", "props": {
      "width": {"rule": "touchTarget", "got": 342, "want": 48, "op": ">=", "pass": true},
      "backgroundColor": {"rule": "tokens", "got": "#1e6fff", "pass": false,
        "wantToken": ["background", "text", "primary"], "wantResolved": ["#ffffff", "#000000", "#0055d4"]}
    }},
    {"ref": "n7", "key": "submit/Paragraph:1", "sel": "RootView>View>View>Paragraph", "props": {
      "contrast": {"rule": "contrast", "got": 4.4, "want": 4.5, "op": ">=", "pass": false,
        "fg": "#ffffff", "bg": "#1e6fff", "bgFrom": "host"}
    }}
  ],
  "violations": [
    {"rule": "contrast", "key": "submit/Paragraph:1", "sel": "RootView>View>View>Paragraph", "prop": "contrast",
     "expected": ">= 4.5", "actual": 4.4, "message": "contrast 4.4:1 < 4.5:1 (#ffffff on #1e6fff)"}
  ]
}
```

A passing token color has `token: <name>`. With `--script`, each failed step
adds a violation with `rule: "step"` and `key: "step:<index>"`.

## Schemas and tool descriptors

- `schema/*.json`: JSON Schema (draft-07) for the outputs and input files.
  They are generated from the types in `src/schema.ts` with
  `ts-json-schema-generator` (`bun run schema`; `bun run check` fails when they
  are out of date). Objects do not allow unknown keys. `rn-a11y-tree schema
  <name>` prints one (the installed copy); input files point to theirs with
  `$schema`, e.g. `"$schema":
  "./node_modules/react-native-a11y-tree/schema/script.json"` (the examples
  use `../../packages/react-native-a11y-tree/schema/*.json`).

  | File | Type |
  | --- | --- |
  | `render-result.json` | `render` (`--format json`) |
  | `query-result.json` | `render --select` (`--format json`) |
  | `run-result.json` | `run` (`--format json`, no `--select`/`--subtree`/`--depth`) |
  | `check-result.json` | `check` (`--format json`) |
  | `error-output.json` | `{"error": {code, message, hint?, details?}}` |
  | `session-request.json` / `session-output-line.json` | `session` stdin / stdout lines |
  | `script.json` | `--script` files (`{$schema?, actions}` or an array) |
  | `rules-file.json` | `--rules` files |
  | `a11y-tree-config.json` | `a11y-tree.json` |

- `tools/*.json`: MCP-style tool descriptors `{name, description,
  inputSchema, outputSchema, examples: [{input, argv}], x-cli}` for
  `render`, `query`, `act` (`run`), `diff` (`run --diff`), `check` and
  `session` (with `x-protocol` for the stdin/stdout lines). Input types are
  in `src/tools.ts`; `toolArgv(name, input)` maps an input to CLI arguments
  (`actions` and `rules` are passed inline as JSON). Example:

  ```sh
  rn-a11y-tree run examples/basic/App.tsx --platform android \
    --script '[{"type":{"testID":"email","text":"a@b.c"}},{"tap":{"testID":"submit"}}]' --format compact
  ```

`test/schema.test.ts` validates CLI output (fake host), the example
scripts and rules files, and each tool example (input, argv, and the output
of the argv) against these files. `e2e/schema.test.ts` validates the real
host output of every example.

## Caching

The CLI is one-shot (no daemon). To make repeated runs fast:

- **Bundle cache.** A finished bundle is stored under a key made of the
  generated entry (app path, options, script) and the tool versions. It is
  valid while every module file in Metro's dependency graph, and every
  directory that holds one, keeps its mtime and size (a new file in a module
  directory could change resolution). A valid entry skips Metro completely.
- **Hermes bytecode.** After a build, `hermesc` from `hermes-compiler`
  compiles the bundle in the background (about 2 s for the medium example);
  the next run of the unchanged app loads the bytecode. If the host cannot
  load it, the CLI deletes it and uses the JS bundle.
- **Metro caches.** Transforms and the file map are kept in the same cache
  directory, with a fixed entry directory so the file map cache key stays
  the same.
- **Location:** `<project>/node_modules/.cache/rn-a11y-tree` when the
  project has `node_modules`, else `~/.cache/rn-a11y-tree`
  (`RN_A11Y_TREE_CACHE_DIR` overrides).

Medium example, Release host, median of 5 (`render --timing`):

| Case | Wall | Metro | Host |
| --- | --- | --- | --- |
| Unchanged app, cache hit, bytecode | 191 ms | 5 ms | 119 ms |
| Unchanged app, cache hit, JS (`--bytecode off`) | 437 ms | 5 ms | 358 ms |
| One-line change (Metro with warm caches, `--bytecode off`) | 1404 ms | 932 ms | 358 ms |
| Bundle cache off (`--no-cache`), warm Metro, `--bytecode off` | 1269 ms | 833 ms | 344 ms |
| Cold (`--reset-cache`) | 5440 ms | 4882 ms | 396 ms |

(Before caching: 1.3 s warm, Metro 0.86 s, bundle eval 150 ms; with bytecode
bundle eval is 13 ms.) The two `--bytecode off` rows are medians of two
alternating series of 5 on a shared machine (±80 ms between series).

A one-line change costs about 100 ms more than a warm `--no-cache` build:
the changed file is transformed, and the first Babel transform in a new
process loads `babel-preset-expo` (about 150 ms; the next transform takes
20 ms). With at most 8 changed inputs, Metro transforms in the CLI process
instead of starting worker processes (saves about 85 ms of worker start and
stop), and the bundle cache takes its file list from the serializer instead
of `getOrderedDependencyPaths` (which builds the graph a second time,
about 55 ms). Measure with `--bytecode off`: in `auto` mode the background
`hermesc` after a build competes with the next run for CPU.

## Errors and exit codes

Errors are `{"error": {code, message, hint?, details?}}`: on stdout with an
explicit `--format json`, else on stderr (one JSON line when stderr is not a
terminal or with `--quiet`, a readable message otherwise).

| Exit | Codes | Meaning |
| --- | --- | --- |
| 0 | | ok (step errors inside a `run` are reported in the steps) |
| 1 | `USAGE` | bad arguments, script, selector, unknown option |
| 2 | `CHECK_FAILED` | `check` found violations |
| 3 | `BUNDLE_FAILED` | Metro failed (syntax error, missing import) |
| 4 | `APP_THREW` | the app threw while loading or rendering (`details.stack`) |
| 5 | `HOST_MISSING`, `HOST_UNAVAILABLE`, `HOST_INCOMPATIBLE`, `HOST_CRASHED`, `TIMEOUT` | host problems (`details.stderrTail`) |

- Step errors are `{code, message}` with `TARGET_NOT_FOUND`,
  `TARGET_COVERED`, `TIMEOUT` or `APP_THREW`; session error responses use the
  same object (`USAGE` for invalid requests).
- App console output is returned in `logs: [{level, message, known?}]`
  (render/run output, and each session response). `known: true` marks
  common noise (`getViewManagerConfig('RNCMaskedView')`, deprecation
  warnings). With `--no-quiet`, errors and warnings that are not known noise
  are also printed on stderr.

## Formats and queries

For agents, `--format` and the query options make the output small:

```sh
rn-a11y-tree render App.tsx --platform android --format text
# n0 RootView {0,0,390x844}
#   n1 View {0,0,390x844}
#     n2 Paragraph role=header "Sign in" {24,24,342x33.3}
#     n5 AndroidSwitch #remember role=switch "Remember me" {24,205.7,51x31} [checked]
#     n6 View #submit role=button "Submit" {24,252.7,342x48}
rn-a11y-tree render App.tsx --platform android --format text --select role=button
rn-a11y-tree render App.tsx --platform android --format compact --subtree testID=card-3 --depth 1
```

- `text`: `<key> <type> [#testID] [role=…] ["name"] {x,y,wxh} [visual={…}]
  [flags]`; flags: `hidden`, `disabled`, `checked`, `mixed`, `selected`,
  `virtual`, `opacity=…`.
- `compact`: one-line JSON without null/false/empty fields, `a11y.raw` and
  `style` (`--style` keeps `style`, minus `layoutDirection: "ltr"`).
- `ndjson`: one compact node per line with `depth` and `parent`; for `run`,
  one line per step first, then nodes tagged with `tree` (snapshot name or
  `final`).
- `run --format text`: one line per step, then each snapshot and the final
  tree.
- Session `tree` and `snapshot` requests take the same `format`, `select`
  (string or list), `depth`, `subtree`, `style` fields; `text`/`ndjson` trees
  are returned as a string.

Output size for the medium example (832 nodes): `json` 1,598,904 bytes,
`ndjson` 246,853, `compact` 230,446, `text` 60,844.

## Output schema

TypeScript types: [`src/schema.ts`](packages/react-native-a11y-tree/src/schema.ts).

```jsonc
{
  "viewport": {"width": 390, "height": 844},
  "source": "shadowTree",      // or "mounted", see "Tree sources"
  "root": {
    "ref": "n0",               // pre-order id within this tree (changes when the tree changes)
    "key": "RootView",         // stable: testID, else <parent key>/<type>:<n>; root = its type
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
    "box": {"x": 0, "y": 0, "width": 390, "height": 844},  // on screen, dp (ShadowTree layout)
    "visualBox": {...},        // only if a transform/mounted frame applies: where it is drawn
    "effectiveOpacity": 0.5,   // only if < 1: own x ancestors' opacity (mounted opacity if reported)
    "style": {"backgroundColor": "rgba(255, 255, 255, 1)"}, // other props: visual (incl. effectiveBackground), Yoga style, font, component props
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

- `shadowTree` (`getA11yTree`, in the host built by `bun run build:host`): the
  committed ShadowTree. The hierarchy is complete (no view flattening),
  values are typed (numbers, booleans), and `role`, `accessibilityValue` and
  text fragments are available. Mapping tables are at the top of the
  `shadowTree` section in `src/tree.ts`. Notes:
  - Children are placed at parent position + parent `contentOriginOffset`
    + child frame. The host emits `contentOriginOffset` where it is non-zero:
    ScrollView `-contentOffset`, `RNSScreen` `(0, topInset + headerHeight)`.
    So `box` is the position on screen (e.g. an `RNSScreenStackHeaderConfig`
    frame of `{0,-56,390,56}` inside a screen with offset 56 is at y = 0).
  - `RNSScreenStackHeaderConfig` gets its `title` as `name` (role stays
    `null`). Screen and header props (`activityState`, `stackPresentation`,
    `title`, `hidden`, ...) and safe-area `insets` are in `style`.
  - `visualBox`: `box` is the layout. When the node or an ancestor has a
    non-identity `transform` (4x4 matrix in `style.transform`), or the host
    reports a different mounted frame, `visualBox` is the axis-aligned
    bounding box of the drawn frame after the transforms. Like React Native,
    a transform applies about the view's center; ancestors' transforms
    compose. `style.mounted` has the mounted-view values that differ from
    the ShadowNode (e.g. during a Reanimated `entering` animation); they are
    used for `visualBox` and `effectiveOpacity`.
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

## Interactions

```sh
bun run rn-a11y-tree run examples/basic/App.tsx --platform android --script examples/basic/actions.json
```

`run <file> --platform <p> --script <json> [--tap-mode touch|click|both]`
renders the component, runs the actions in order, and prints:

```jsonc
{
  "viewport": {"width": 390, "height": 844},
  "source": "shadowTree",
  "steps": [
    {
      "index": 2, "action": "tap",
      "target": {"tag": 16, "ref": "n7", "testID": "submit", "type": "View", "box": {...}},
      "hit": {"tag": 14, "ref": "n8", "testID": null, "type": "Paragraph", "box": {...}, "viaHitSlop": false},
      "events": ["touchStart", "touchEnd"],
      "via": {"hitTest": "js", "events": "js"},   // host methods ("native") or the JS fallback
      "warnings": ["..."],                        // optional, e.g. the target is covered
      "error": "..."                              // optional; later steps still run
    }
  ],
  "snapshots": {"after-submit": { /* tree, same schema as render's root */ }},
  "final": { /* tree after the last step */ }
}
```

The script is a JSON object with `$schema` (so editors and agents find the
schema) and `actions`, or a bare array of actions:

```json
{
  "$schema": "./node_modules/react-native-a11y-tree/schema/script.json",
  "actions": [
    {"type": {"testID": "email", "text": "a@b.c"}},
    {"tap": {"testID": "submit"}},
    {"snapshot": "after-submit"}
  ]
}
```

`$schema` is a path relative to the file (the examples use
`../../packages/react-native-a11y-tree/schema/script.json`) or a URL; the CLI ignores its value. The script
is validated before bundling; errors name the step index. `run --help`,
`check --help` and `session --help` list every action;
`rn-a11y-tree schema script` prints the full schema.

| Action | Form | Events |
| --- | --- | --- |
| `tap` | `{"x":..,"y":..}`, `{"testID":".."}` or `{"ref":"n5"}` | `touchStart`, `touchEnd` to the hit node (`--tap-mode touch`, default); `click` (`click`); both (`both`). On a Switch: `change {value: !value}` instead. |
| `longPress` | same as `tap` | `touchStart`, `wait 600`, `touchEnd` |
| `type` | `{"testID":"..","text":"..","submit":false}` | `focus`; per character `keyPress {key}` and `change {text, eventCount}`; `submitEditing` if `submit`; `endEditing`, `blur` |
| `scroll` | `{"testID":"..","x":0,"y":300}` | one scroll event on a `ScrollView` (`zoomScale: 1`), which also updates the ScrollView's state |
| `pan` | `{"testID":"..","dx":100,"dy":0,"steps":10,"durationMs":200}` (or `x`,`y` instead of a target) | `touchStart`, `steps` x (`wait durationMs/steps`, `touchMove`), `touchEnd`; the same pointer samples go to react-native-gesture-handler |
| `pinch` | `{"testID":"..","scale":2,"steps":10,"durationMs":300}` | two pointers around the target's center, moved apart/together; react-native-gesture-handler only (no multi-touch responder events yet) |
| `wait` | milliseconds | in 16.333 ms slices (the host's frame length): `produceFramesForDuration` (stub clock + one UI tick, which drives C++ animation backends), mocked JS timers, work loop, queued native events |
| `snapshot` | name | stores the tree at this point |

Rules:

- Targets: `testID`, `key`, `sel` or `ref`. `key` is stable (the
  `testID`, else `<parent key>/<type>:<n>`, `n` = index among siblings of
  the same type); `ref` is resolved against the tree at the time of the step
  and changes when the UI changes.
- Diffs: `run --diff`, or `"diff": true` on a session action request, adds
  `diff: {added, removed, changed: [{key, before, after}]}` to the step:
  nodes matched by `key`; compared fields `box`, `visualBox`, `text`,
  `name`, `role`, `state`, `hidden`, `effectiveOpacity`. `--format text`
  prints them under the step as `+ key …`, `- key …`, `~ key field: a -> b`.
  Unkeyed nodes after an inserted sibling of the same type get new keys, so
  give important nodes a `testID`.
- Target taps hit-test at the center of the target's box. If the hit node is
  not the target or inside it, the step gets a "Target is covered" warning.
  Touch events go to the hit node (the responder system bubbles them).
  `click` goes to the target, because it does not bubble from a child to a
  Pressable in this host.
- The host `hitTest` honors pointerEvents, transforms, overflow clipping,
  ScrollView offsets, zIndex, `display: none` and hitSlop; `viaHitSlop` is
  `true` when the point was only inside the hitSlop area.
- Touch payloads: `touchStart {touches, changedTouches, targetTouches}` and
  `touchEnd {touches: [], changedTouches, targetTouches: []}`, each touch
  `{pageX, pageY, locationX, locationY, screenX, screenY, identifier: 0,
  target, timestamp, force: 1}`.
- `type`: for each character, `keyPress`, then `setTextInputTextByTag` (the
  input's ShadowTree state, so `text` in the tree changes), then `change`.
- Timers are mocked during the script (`Fantom.installTimerMock`), so
  `wait` and `longPress` are deterministic.
- Host methods: `hitTest`, `enqueueNativeEventByTag`,
  `enqueueScrollEventByTag` and `setTextInputTextByTag` are used when the
  host has them. Without them, the runner hit-tests in JS over the
  `getA11yTree` boxes (deepest node, later siblings on top, `pointerEvents`
  honored; zIndex, transforms and clipping ignored) and sends events with
  Fantom's `enqueueNativeEvent` / `enqueueScrollEvent` to the element found by
  tag in `root.document`. Without `setTextInputTextByTag`, the input's own
  `text` in the tree does not change (the app's state does); the step gets a
  warning.
- When any JS fallback is used, the CLI prints one warning line on stderr,
  for example `warning: JS fallbacks used because the host lacks native
  methods: events: js, hitTest: js, scrollOffset: dom`. The payload also
  lists them in `fallbacks`. Host methods are always used when present.
- After the initial render and after every step, queued native events are
  delivered (`flushEventQueue` + work loop) until the host's shadow tree and
  mounted revisions (`getShadowTreeRevision` / `getMountedRevision`) stop
  changing (at most 10 rounds; hosts without them: until the tree dump stops
  changing).
  Fabric emits `onLayout` into the event queue from a commit hook; without
  this, `onLayout` never reaches JS and FlatList cannot compute its window.
  This also applies to `render`.
- Scrolling: ShadowTree frames do not move when a ScrollView scrolls (the
  offset is in the ScrollView's state). `box` values are on-screen positions
  (see `contentOriginOffset`), and the JS hit test uses the same positions.
  For hosts that report `contentOffset` from props only, the runner reads the
  state offset through the DOM API (`element.scrollTop` / `scrollLeft`)
  (fallback `scrollOffset: dom`).
- `run` needs a host with `getA11yTree`. The output's `capabilities` lists
  the optional host methods found plus `NativeFantom.getCapabilities()`
  (e.g. `getA11yTree.mounted`); session mode reports it in the `ready` line.

Examples: `examples/basic/actions.json` (typing, Switch, Pressable) and
`examples/scrolling/actions.json` (ScrollView offset, tap after scroll,
FlatList windowing).

## Expo UI

`@expo/ui` views render as Fabric views named `ViewManagerAdapter_ExpoUI_<View>`
(see `native/README.md` "Expo UI"). The tree type is `ExpoUI.<View>`:
Compose names with the universal `@expo/ui` entry and `--platform android`
(`HostView`, `ColumnView`, `TextView`, `Button`, `SwitchView`, ...), SwiftUI
names with `@expo/ui/swift-ui` on any platform (`VStackView`, `ToggleView`,
...).

```sh
rn-a11y-tree run examples/expo-ui/App.tsx --platform android --script examples/expo-ui/actions.json --format text
```

**JS load path.** When the project's `package.json` lists `expo`,
`expo-modules-core` or `@expo/ui` and `expo-modules-core` resolves from the
project, the entry runs, before the app module:

1. `installExpoGlobalPolyfill()` from `expo-modules-core/src/polyfill/dangerous-internal`
   (the project's copy): `globalThis.expo` with `EventEmitter`,
   `NativeModule`, `SharedObject`, `modules`.
2. `runtime/expo/prelude.ts`: `globalThis.expo.getViewConfig(module, view)`
   from `runtime/expo/viewConfigs.json` (152 views, iOS and Android
   attributes and events merged; views not in the table get the union of all
   `@expo/ui` prop and event names; `children`, `key`, `ref`, `style` are
   left out), and module stubs `ExpoUI`, `ExpoAsset`, `ExponentConstants` /
   `ExpoConstants`.

Other projects get none of this (the basic example bundle has no Expo code).
Listing the package is required because in a hoisted monorepo every project
resolves `expo-modules-core`. `bun scripts/gen-expo-view-configs.ts`
regenerates `viewConfigs.json` from `native/tools/expo-view-configs/out/viewConfigs.json`
and `native/tests/fantomExpoUIViewConfig.json`. The Fantom tests' dev-bundle
workaround (`NativeSourceCode` `scriptURL: null`) is not included: only
`__DEV__` bundles open the dev-server socket, so `--dev` bundles of Expo apps
may need it.

**Tree.** ExpoUI nodes have:

- `expo`: the props the native view received (`modifiers` verbatim;
  modifier callbacks are `"eventListener": null`);
- `layout`: `emulated` when a SwiftUI/Compose layout engine laid out the
  node (the Host and its descendants), `placeholder` when no engine handled
  the subtree (the frame is not the drawn one). Hosts built before this
  label change mark only the Host `emulated` and its descendants
  `placeholder`, even when an engine laid them out;
- `emulatedBy` (on the Host): `swiftui` or `compose`, the engine that laid
  out the subtree;
- `role` from the view name: `Button`/`*Button` → `button` (`ToggleButton`
  → `togglebutton`, `RadioButton` → `radio`), `SwitchView`/`ToggleView` →
  `switch`, `CheckboxView` → `checkbox`, `SliderView` → `adjustable`,
  `TextField*`/`SecureField*` → `textbox`, `TextView` → `text`,
  `Image*`/`Icon*` → `image`, `PickerView` → `radiogroup` (pickerStyle
  `segmented`, `inline`, `palette`) else `combobox`, `ProgressView` →
  `progressbar`. An explicit `role`/`accessibilityRole` wins;
- `text` = `expo.text` (TextView, text fields); `name` = accessibility
  label (the host maps the `accessibilityLabel` modifier), else the
  `label`/`title` prop, else the text; buttons take their descendants' text;
- `a11y.state.checked` from `value`/`isOn`/`checked`, `disabled` from
  `enabled: false`/`disabled`.

**Actions** (`runtime/expo/actions.ts`). The event is chosen from the `on…`
callbacks that the JS component passed to the native view (its React props),
else from the view name:

| Action | Callback prop | Event sent |
| --- | --- | --- |
| `tap` | `onButtonPress` (SwiftUI Button) | `buttonPress {}` |
| `tap` | `onButtonPressed` (Compose buttons) | `buttonPressed {}` |
| `tap` | `onCheckedChange` (Compose Switch, Checkbox) | `checkedChange {value: !value}` |
| `tap` | `onIsOnChange` (SwiftUI Toggle) | `isOnChange {isOn: !isOn}` |
| `type` | `onTextChange` (SwiftUI TextField) | `textChange {value}` per character |
| `type` | `onValueChange` (Compose TextField) | `valueChange {text, selection}` per character |

- The actionable view is the target (or hit) node or its nearest ancestor
  inside the Host (under the fake layout, a tap hits the Button's Text child).
- If that node or an ancestor inside the Host has a tap modifier
  (`onTapGesture`, `clickable`, `combinedClickable`; long press:
  `onLongPressGesture`), the runner also calls
  `NativeFantom.dispatchExpoModifierEvent(tag, type, {})` (step event
  `modifier:<type>`). Hosts without it add a warning.
- A target given by testID/key gets the events even when its box center
  does not hit it (placeholder frames); the step has a warning then.

**Host capabilities.** `expoUI`: Expo module views render.
`expoModifierEvents`: `dispatchExpoModifierEvent` and Host frames written by
the layout emulation. `expoUI.fakeLayout`: the frames are the fake layout
(each child a full-width row, 40 high), not SwiftUI/Compose layout.
`expoUI.swiftUILayout` / `expoUI.composeLayout`: that engine lays out the
Hosts of its kind (`@expo/ui/swift-ui` views: SwiftUI; Compose views:
Compose). `e2e/expo-ui.test.ts` checks modifier callbacks only with
`expoModifierEvents`, and boxes only with the engine of the screen's kind
(Compose: 14sp Text 16 dp high, Button 66x48, Switch 52x48; SwiftUI: body
Text 20.333 dp high).

## react-native-gesture-handler

The host has no native gesture handler engine. RNGH 3.2.1's native module
and native v3 detector are replaced in the bundle (`src/bundle.ts`
`RESOLVED_ALIASES`, matched on the resolved file path):

| RNGH file | Replaced by |
| --- | --- |
| `src/specs/NativeRNGestureHandlerModule.ts` | `runtime/gh/NativeRNGestureHandlerModule.ts` |
| `src/v3/detectors/HostGestureDetector.tsx` | `runtime/gh/HostGestureDetector.tsx` |

- The module implements the 8 spec methods with RNGH's own web classes
  (`src/web/`: handlers, `GestureHandlerOrchestrator`, `InteractionManager`,
  `NodeManager`). Views are `HostView` objects over the element found by tag
  (`hasAttribute` → false, `dispatchEvent` no-op, bounds from
  `getBoundingClientRect`; a `display: contents` detector uses the union of
  its children). Input comes from the action runner through a
  `HostEventManager` (an RNGH `EventManager` without DOM listeners).
- Pointer routing: on DOWN, the handlers attached to the hit view and its
  ancestors get the pointer (deepest first) if it is inside their view; MOVE
  and UP go to the same handlers. `time` comes from the mocked clock, so
  Tap/LongPress timers, pan slop (15 dp) and velocity behave.
- Events go back the way the native platforms send them: v2
  (`GestureDetector` with `Gesture.*`, old handler components) as flat
  payloads on `DeviceEventEmitter` `onGestureHandlerEvent` /
  `onGestureHandlerStateChange` (Android); v3 (`NativeDetector`, e.g.
  `RectButton`) as Fabric events `gestureHandlerEvent` /
  `gestureHandlerStateChange` / `gestureHandlerTouchEvent` on the
  `RNGestureHandlerDetector` element.
- `HostGestureDetector.tsx` renders the real `RNGestureHandlerDetector` and
  attaches each handler to the detector, or, for Native gestures, to its only
  child (like the Android detector view). A Native handler attached to an
  `RNGestureHandlerButton` gets the button role, so it activates on release
  like on Android.
- `tap`, `longPress`, `pan` and `pinch` feed RNGH as well as the responder
  system; `step.gestureHandlers` counts the handlers that got the pointer.
- v2 gestures with worklet callbacks (no `.runOnJS(true)`; action type
  `REANIMATED_WORKLET`) and `NATIVE_ANIMATED_EVENT`: Fabric events
  `gestureHandlerEvent` / `gestureHandlerStateChange` on the attached view
  (enqueued by tag), with the flat payload, like Android's Reanimated path.
  Fabric names them `topGestureHandler*`; Reanimated maps `top*` to `on*` and
  runs the `useEvent(..., ['onGestureHandlerStateChange',
  'onGestureHandlerEvent'])` worklet on the UI runtime. The runner then runs
  one UI tick (`produceFramesForDuration(0.001)`) so the animated style is
  applied.
- Taps aim at the center of the target's drawn position (`visualBox`), so a
  view moved by a transform is hit where it is drawn.
- Not supported yet: v3 `dispatchesReanimatedEvents` (Reanimated detector),
  virtual detectors, transforms in `absoluteToLocal`.
- RNGH resets the pan start point on activation, so `translationX` after a
  `pan` of `dx: 100` is `100` minus the distance moved before activation.

`runtime/turboModuleStubs.ts` adds JS stand-ins for core TurboModules the
host lacks but libraries require at import time: `StatusBarManager` (RNGH
imports `DrawerLayoutAndroid`, which imports `StatusBar`), and for
`--platform ios` `KeyboardObserver` (`Keyboard` creates a
`NativeEventEmitter` with it) and `LinkingManager` (`Linking`; React
Navigation imports it).

## Session mode

```sh
bun run rn-a11y-tree session examples/basic/App.tsx --platform android [--tap-mode touch|click|both] [--format text] [--select role=button]
```

Bundles once, renders the app, and then serves requests: one JSON object per
line on stdin, one JSON response per line on stdout. Requests are handled in
order, one at a time.

```jsonc
// out, after the initial render:
{"ready": true, "tree": {...}}
// in                                           // out
{"id": 1, "action": {"tap": {"testID": "submit"}}}   {"id": 1, "ok": true, "step": {...}}
{"id": 2, "action": {"snapshot": "x"}}               {"id": 2, "ok": true, "step": {...}, "tree": {...}}
{"id": 3, "tree": true}                              {"id": 3, "ok": true, "tree": {...}}
{"id": 4, "action": {"tap": {"testID": "sumbit"}}}   {"id": 4, "ok": false, "error": {"code": "TARGET_NOT_FOUND", "message": "Target not found: {\"testID\":\"sumbit\"}. Did you mean testID \"submit\" (ref n6, View)?"}, "step": {...}}
{"id": 5, "quit": true}                              {"id": 5, "ok": true}
```

- `action` takes the same objects as `run --script`; `step` has the same
  shape as in `run`, and trees the same schema as `render`. Invalid requests
  get `{"id", "ok": false, "error"}` without reaching the app.
- `--format`, `--select`, `--depth`, `--subtree` and `--style` (same values
  as `render`) set the `ready` tree and the default output of `tree` and
  `snapshot` responses; a request's own `format`, `select`, ... win. Without
  them the trees are full JSON. `format` in `a11y-tree.json` does not apply to
  sessions.
- A target that is not found (`run` steps too) names the closest `testID` /
  `key` / `sel` values with their `ref` ("Did you mean ..."), or, for a
  `testID` without a close match, the testIDs in the tree.
- `fallbacks` is added to a response when JS fallbacks were used.
- If the app fails to load, the first line is `{"ready": false, "error"}`
  and the exit code is 1.
- `quit`, or the end of stdin, unmounts the app and stops the host; the exit
  code is the host's (0).
- App console output goes to stderr as `[app] ...` lines.
- `--timeout <ms>` (default 30000) limits each request. On timeout the
  response is `{"id", "ok": false, "error": "timeout"}`, the host is killed,
  and the exit code is 1.

How it works: the host runs in Fantom's `--interactive` mode. It evaluates the
bundle, then reads frames from stdin (a line with the byte length, then that
many bytes of JS), evaluates each one, and prints
`{"type":"repl-eval-complete","id":n}` (and `{"type":"repl-error",...}` for a
thrown error) on stdout. The session bundle installs
`globalThis.__rnA11y.request(json)` (`runtime/session.ts`, which uses the
same action runner as `run`). Each request is sent as one line of JS that
calls it; it prints one `{"type":"rn-a11y-tree-response",...}` line through
`NativeFantom.reportTestSuiteResultsJSON`. The host exits when its stdin is
closed.

## How it works

1. **Metro**: `src/bundle.ts` writes an entry (`runtime/entry-template.ts`
   with the app path, viewport, script and host settings filled in) and
   bundles it with Metro and Expo's config into one file for the chosen
   platform. Some native-only library files are replaced by runtime files
   (react-native-gesture-handler, see above).
2. **Bundle**: sets up the React Native environment (no `InitializeCore`),
   loads the vendored Fantom runtime and the app.
3. **Host**: `src/host.ts` (or `src/session.ts`) starts the host binary with
   the bundle. The host is React Native's C++ Fabric runtime with Hermes,
   Yoga, CoreText text layout and the native libraries compiled in; it calls
   the bundle, which renders the app into a Fantom root and settles events.
4. **ShadowTree**: the bundle reads the committed ShadowTree with
   `NativeFantom.getA11yTree` (typed JSON: frames, a11y props, text, style)
   and prints it on stdout.
5. **JSON**: `src/tree.ts` converts it to the output schema (on-screen boxes,
   roles, names, selectors).

```
rn-a11y-tree render App.tsx --platform android
  │
  ├─ src/bundle.ts   write runtime/entry-template.ts (placeholders filled) to a temp dir
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

rn-a11y-tree run App.tsx --script actions.json
  same, plus: src/script.ts validates the script; the entry embeds it and
  runtime/actions.ts runs it after the render; snapshots and the final tree
  are converted by src/tree.ts
```

`runtime/fantom/` is the Fantom JS runtime vendored from React Native (not on
npm), converted from Flow to TypeScript. See
[`runtime/fantom/VENDORED.md`](packages/react-native-a11y-tree/runtime/fantom/VENDORED.md).

`runtime/` is TypeScript. Metro compiles it with Babel like the app's own
files (the published package ships the `.ts` files). `tsc -p runtime` type-checks
it for Hermes (no DOM or Node types): `runtime/globals.d.ts` declares the
globals it uses, `runtime/modules.d.ts` the react-native modules without
declarations, and `runtime/tsconfig.json` maps react-native deep imports to
react-native's generated declarations (`types_generated/`).

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

`--platform` (or a preset or `a11y-tree.json` that sets it) is required; the CLI does not pick one. Known values:

- `android`: the platform Fantom bundles for. The host implements the
  Android native components (`AndroidTextInput`, `AndroidSwitch`), so this
  is the value to use for TextInput and Switch.
- `ios`: resolves `.ios.*` files. react-native then uses the iOS native
  components (`Switch`, `TextInput`) and iOS-only core native modules
  (`KeyboardObserver`, `LinkingManager`; JS stand-ins in
  `runtime/turboModuleStubs.ts`). Every example renders and runs with
  `--preset ios-phone` (the e2e suites run under it). The host registers
  ReactCommon's iOS `TextInput` (CoreText measured) and a 51x31 `Switch`.
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

`bun run build:host` runs [`scripts/build-host.sh`](scripts/build-host.sh):

1. Checks `JAVA_HOME` (default `/opt/homebrew/opt/openjdk@17`, JDK 17) and
   `ANDROID_HOME` (default `~/Library/Android/sdk`). Installs
   `cmake;3.30.5` with `sdkmanager` if it is missing. The Android SDK is only
   used for its CMake; nothing is built for Android.
2. Runs `yarn install` (Yarn 1.22.22 through corepack) in
   `third_party/react-native`. A `yarn` shim that runs Yarn 1 is put first on
   `PATH`, because React Native's codegen calls `yarn` and needs Yarn 1 (this
   repo itself uses Bun).
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

With the default static host (Hermes and JSI linked in), the
binary links only system libraries (`otool -L`: libobjc, CoreFoundation,
AppKit, CoreText, Foundation, libc++, libSystem).

On Linux the script builds `native/dist/x86_64/rn-a11y-host` (or
`native/dist/arm64/` on arm64): one executable that links only glibc
dynamically. Text uses the portable layout (stb_truetype and the embedded
fonts; `RN_A11Y_TEXT_LAYOUT=portable` is the default there). Requirements and details: [native/README.md](native/README.md#linux).

On Windows (x64, in Git Bash with the MSVC developer environment and LLVM)
the script builds `native/dist/x86_64/rn-a11y-host.exe`: one executable with
the static MSVC runtime and static ICU that imports only Windows system DLLs;
Hermes is built with MSVC, the tester with clang-cl, text uses the portable
layout. Requirements and details: [native/README.md](native/README.md#windows).

`RN_A11Y_HOST_ARCH=arm64|x86_64|universal` (default: the build machine's
architecture) selects the host architecture. A foreign architecture (x86_64
on an arm64 Mac) is cross-built with its own Hermes build into
`native/dist/x86_64/`; `universal` builds both slices and joins them with
`lipo` into `native/dist/universal/`. `release-host.ts --pack` makes a
universal `osx-bin/rn-a11y-host` when both `native/dist/arm64` and
`native/dist/x86_64` exist. An x86_64 slice cannot run on an arm64 Mac
without Rosetta; the release workflow checks it on a `macos-15-intel`
runner.

### Prebuilt host

`bun scripts/release-host.ts [--out release] [--platform darwin|linux|win32]
[--arch arm64|x86_64] [--bin <file>] [--pin]` packages one binary (default
`native/dist/<arch>/rn-a11y-host` of this machine):

- `rn-a11y-host-<version>-<platform>-<arch>.tar.gz` (the binary and
  `host-version.json`), and its `.sha256`;
- `host-version.json`: `version`, `reactNative`, `submoduleCommit`,
  `overlayHash` (sha256 over every file in `native/overlay`, which is what
  `build-host.sh` copies), `overlayDirty` (uncommitted overlay changes),
  `nativeLibs` (versions of the npm packages compiled in, plus
  `hermes-compiler`), `repoCommit`, and `assets: {"<platform>-<arch>":
  {file, sha256, size}}` (`darwin-arm64`, `darwin-x86_64`, `linux-x86_64`,
  `win32-x86_64`: `process.platform` and the arch, as in
  `src/hostDownload.ts`). `version` is `<react-native
  version>-<12 hex of sha256(submodule commit, overlay hash, native libs)>`,
  the same for every platform. A second run for another platform or arch
  into the same directory adds its asset. `--platform` (default: this
  machine) lets one machine package the binaries of all platforms; the
  Windows archive holds `rn-a11y-host.exe`.
- `--pin` also writes `host-version.json` to the repo root. That is the
  host the CLI downloads.

The script warns when `native/overlay` has uncommitted changes or files
newer than the binary.

`bun scripts/release-host.ts --pack [--packages-dir <dir>] [--bin
<slot>=<file>]... [--artifacts <dir>]` fills the `packages/runtime-*` directories
(or `runtime-*` under `--packages-dir`) on any OS:

- slots `osx` (`osx-bin/rn-a11y-host`), `linux64`
  (`linux64-bin/rn-a11y-host`), `win64` (`win64-bin/rn-a11y-host.exe`);
- inputs: `--bin <slot>=<file>` (repeatable; several `osx` files are joined
  with `lipo`, on macOS only; `--bin <file>` is this machine's slot),
  `--artifacts <dir>` (CI artifacts: `<dir>/rn-a11y-host-<slot>/<file>`,
  the `osx` one universal), else this machine's `native/dist` (macOS:
  `arm64` and `x86_64` joined into a universal binary);
- binary artifacts for slots without an input are removed; each binary's format and CPU must match its
  slot (Mach-O, ELF, PE, read from the file header, which also gives its
  archs);
- `host-version.json`: the fields above plus `protocolVersion` and
  `binaries: {"<dir>/<file>": {archs, sha256, size}}` for the binary in each
  runtime package. The aggregate manifest is printed to stdout. Local
  macOS packs with one slice advertise only that CPU.

Pack each populated platform directory and the CLI with `npm pack`.
Publish runtime packages before the CLI, keeping their npm versions and
the CLI's exact optional dependency versions in sync. Publishing scoped
packages requires ownership of the `@react-native-a11y-tree` npm scope.
An unpopulated platform package fails `prepack` instead of shipping empty.

`.github/workflows/release-host.yml` (tags `v*`; also on push to
`ci/release-all`, without the GitHub release): `host-macos` (universal host,
tests), `host-linux` (calls `linux-host.yml`: the manylinux_2_28 build and its
tests), `host-windows` (calls `windows-host.yml`: the windows-2025 build and
its tests), then `package` (ubuntu): the tarballs of every platform and arch, `--pack
--artifacts`, `npm pack` of all packages, `scripts/verify-packages.sh` (a
scratch project installs the CLI and matching runtime tarballs and renders `examples/basic` with the
Linux host from the package) and the `file://` download; `verify-macos` (the
same install on macOS), `verify-windows` (the same install on windows-2025),
`intel-check` (the x86_64 slice on an Intel runner), and `publish` (the
GitHub release, tags only).

The CLI looks for the host in this order:

1. `RN_A11Y_HOST_BIN`.
2. The matching `@react-native-a11y-tree/runtime-*` package (`osx-bin/rn-a11y-host` on
   macOS, `linux64-bin/rn-a11y-host` on Linux x64,
   `win64-bin/rn-a11y-host.exe` on Windows x64), when that file exists.
   `RN_A11Y_HOST_SKIP_PACKAGE=1` skips this step (tests).
3. With `RN_A11Y_HOST_BASE_URL` set: `~/.cache/rn-a11y-tree/host/<version>/rn-a11y-host` (`.exe` on Windows)
   (`RN_A11Y_HOST_CACHE_DIR`, else `$XDG_CACHE_HOME/rn-a11y-tree/host`)
   when its `.sha256` marker matches the manifest. Else it downloads
   `<base>/<file>` (`https://` or `file://`), checks the sha256 against the
   manifest, unpacks it and writes the marker. The manifest is
   `host-version.json` in the package root, or `RN_A11Y_HOST_MANIFEST`.
4. `native/dist/<arch>/rn-a11y-host`. If the download failed, the CLI
   prints a warning (unless `--quiet`) and uses this file.
5. Else `HOST_MISSING` (exit 5), with the download error when there was one.

In a repo checkout (`src/cli.ts` next to the running code) the order is
`RN_A11Y_HOST_BIN`, the download (only with `RN_A11Y_HOST_BASE_URL`),
`native/dist`, then the staged package: a fresh `bun run build:host` is
used even when `packages/runtime-darwin-universal/osx-bin` holds an older `--pack`
output. `-v` prints the chosen host (`rn-a11y-tree: host: <source> <path>
(<version>, protocol <n>)`) and the running host's info.

**Protocol check.** `host-version.json` of the package or of the download
has `protocolVersion`, the version of the CLI <-> host contract
(`HOST_PROTOCOL_VERSION` in `scripts/release-host.ts`). The CLI supports
`SUPPORTED_PROTOCOL` (`src/host.ts`, now 1..1) and stops with
`HOST_INCOMPATIBLE` (exit 5) for other versions. Hosts without a manifest
(`RN_A11Y_HOST_BIN`, `native/dist`) are checked when the host runs: the
bundle reads `NativeFantom.getHostInfo()` (`{protocolVersion, rnVersion,
buildType, sanitize, engines: {swiftui, compose}, fonts: {roboto}, textLayout}`, else a
`protocolVersion:<n>` capability), and the CLI stops with
`HOST_INCOMPATIBLE` for an unsupported version, for every host source.
Hosts that report neither are not checked. The `--format json` output of
`render`/`run` has `hostInfo`; the session `ready` line has
`hostInfo` and `host: {source, version?, protocolVersion?}`.

The download adds about 200 ms to the first run (3.7 MB tarball from
`file://`, Release host); later runs use the cache.

`.github/workflows/release-host.yml` runs on tags `v*`. It builds the host,
runs the tests, packages the host, makes the npm tarballs (`--pack`,
`bun run build`, `npm pack` of all packages; not published: a commented
`publish` job needs the `NPM_TOKEN` secret), renders `examples/basic` with the
packaged host downloaded from `file://`, and uploads the files to the
GitHub release of the tag. Use them with
`RN_A11Y_HOST_BASE_URL=https://github.com/<owner>/<repo>/releases/download/<tag>`
and that release's `host-version.json` (commit it to the repo root, or set
`RN_A11Y_HOST_MANIFEST`).

`third_party/react-native` is React Native `0.88-stable` at `6007151`
(a shallow submodule).

## Development

```sh
bun run check            # all of the below: typecheck, unit tests, e2e
bun run typecheck        # tsc --noEmit && tsc -p runtime --noEmit (the bundle runtime)
bun run test             # unit tests + CLI tests against a fake host (test/fixtures/fake-host.ts)
bun run test:e2e         # real host; skipped if there is no native/dist binary and no RN_A11Y_HOST_BIN
RN_A11Y_E2E_PRESETS=android-phone bun run test:e2e   # presets to run the e2e suites under (default android-phone,ios-phone)
bun run rn-a11y-tree render examples/basic/App.tsx --platform android --bundle-only
```

Versions: Expo SDK 58 (`expo@58.0.0`), `react-native@0.88.0-rc.2`,
`react@19.3.0`, Metro 0.87.1. Package manager and script runner: Bun
1.3.14 (`bun.lock`; `bunfig.toml`: `linker = "hoisted"` for a flat
`node_modules`, `peer = false` so peer dependencies that nothing depends on
are not installed). All sources are TypeScript (erasable syntax only,
`erasableSyntaxOnly`). The CLI runs on Node (`node src/cli.ts` in a checkout,
`dist/rn-a11y-tree.js` when installed); scripts run with `bun`. Tests use
Vitest 5 (`describe` / `it` / `expect`; `vitest.config.ts` has two
projects: `unit` = `test/*.test.ts` with the fake host, `e2e` =
`e2e/*.test.ts` with the real host). They spawn the CLI with `node` and
scripts with `bun`.
The React Native submodule keeps its own Yarn 1 (`build-host.sh`,
`yarn fantom`).

## CI

`.github/workflows/ci.yml` runs on `macos-15` (arm64) with Xcode 26.3,
JDK 17 (temurin), Node 24 and Android SDK CMake 3.30.5. `native/dist` is
cached. The key has the Xcode version, the submodule commit, the versions of
the npm libraries compiled into the host (`react-native-screens`,
`react-native-safe-area-context`, `react-native-gesture-handler`,
`react-native-reanimated`, `react-native-worklets`, `expo-modules-core`,
`@expo/ui`) and the hash of
`native/overlay/**`, `native/scripts/**` and `scripts/build-host.sh`. On a
cache miss it runs `bun run build:host`. Then: `bun run typecheck`,
`bun run test`, `bun run test:e2e` (every `e2e/*.test.ts`), and every
`native/tests/*-itest.js` Fantom test (copied with its helper files into the
submodule, with the npm libraries installed there too, and run with
`yarn fantom`, with `GITHUB_ACTIONS` unset because Fantom treats it as Meta
CI). The installed libraries include `expo`, `expo-modules-core` and
`@expo/ui` (for `FantomExpoUI-itest.js`), and
`native/tools/expo-view-configs/out/viewConfigs.json` is copied next to the
tests as `fantomExpoUIViewConfigs.json` (read by `fantomExpoUIPrelude.js`).

The `sanitize` job builds the host with `RN_A11Y_HOST_SANITIZE=1
RN_A11Y_HOST_BUILD_TYPE=Release` (AddressSanitizer + UndefinedBehaviorSanitizer,
cached under its own key) and runs `e2e/expo-ui`, `navigation-stack`,
`gestures`, `reanimated` and `scrolling` against it with
`ASAN_OPTIONS=detect_container_overflow=0:detect_stack_use_after_return=1:abort_on_error=1`
and `UBSAN_OPTIONS=halt_on_error=1`. The CLI passes its environment to the
host, and `RN_A11Y_HOST_STDERR_LOG=<file>` makes it append the host stderr
of every run to the file; the job fails on a test failure or on
`ERROR: AddressSanitizer` / `runtime error:` in that file (uploaded as an
artifact on failure). No Fantom itests there.

`.github/workflows/release-host.yml` packages and publishes the host on
tags (see [Prebuilt host](#prebuilt-host)).

## Milestones

Done: JS/CLI and Metro bundling; host build from this repo
(`bun run build:host`); CoreText text measurement; typed ShadowTree dump;
interactions (`run`, `session`); react-native-screens and
react-native-safe-area-context in the host; react-native-gesture-handler
(JS module on its web handlers + host descriptors); CI workflow (not yet run
on GitHub).

Reanimated/worklets are in the host, including mounted-view values.

Pending: release
(prebuilt host binaries for macOS arm64/x86_64 and Linux, no Homebrew
OpenSSL dependency); Expo modules and `@expo/ui`; a `check` command
(design tokens, contrast).

## Workspace layout

The repository root is private. `packages/react-native-a11y-tree/` contains the
published CLI, its `src/`, Hermes `runtime/`, schemas and tool descriptors.
Source paths in this document are relative to that package unless otherwise
noted. `packages/runtime-*` contain the platform-specific optional binaries.
Native builds, scripts, examples and tests stay at the repository root.

Run `bun install`, `bun run build`, `bun run check`, and `bun run rn-a11y-tree`
from the root. To pack the CLI, run `npm pack` inside
`packages/react-native-a11y-tree`; its prepack builds the single executable.
Stage the optional binaries first with `bun scripts/release-host.ts --pack`
and publish their tarballs before the CLI tarball, using the same version.

### Project import aliases

The renderer reads your project's `tsconfig.json` (or `jsconfig.json`) and
resolves `compilerOptions.paths` and `baseUrl`, including JSON comments and
`extends`. For example, `@/*: ["./src/*"]` and
`@/assets/*: ["./assets/*"]` resolve Expo component and asset imports. The
longest matching alias wins; Metro still selects `.ios`/`.android` variants
and image scale variants. Aliases apply to app imports, not dependency internals.
Changes to inherited configuration invalidate the finished bundle cache.

### Expo native views

`expo-glass-effect`, `expo-blur`, and `expo-linear-gradient` preserve their
container layout, children and accessibility on iOS and Android presets.
Glass availability APIs select the emulated glass branch on iOS and Expo's
fallback on Android. Visual effects are not rendered. See the
[SDK 58 support matrix](docs/expo-support.md) for tested behavior and the
remaining native-module gaps across Expo's packages.

### Unsupported native components

With the 0.1.2 runtime, unsupported native components render as a plain React
Native View. Standard View props (including style, testID and accessibility),
children and child interactions are preserved. A `[NATIVE_COMPONENT_FALLBACK]`
warning names each substituted component once when it is first rendered. Warnings
go to stderr even with piped JSON or `--quiet`, and are retained in output logs.

This allows screens using libraries such as `react-native-svg` to be inspected
without their native renderer. SVG paths, fills, native geometry, custom events
and native methods are not simulated. Missing TurboModules and application errors
still surface normally. Supported native components keep their real descriptors.
Older custom binaries without the registry probe retain their previous behavior;
use the matching optional runtime package for fallback support.


### Expo native modules

Starting with 0.1.3, explicit adapters allow SDK 58 starter Home/Explore screens
and `expo-image` imports to render headlessly. Images retain layout, source props
and accessibility; image loading/decoding/caching and native events are not
simulated. Unsupported operations reject with `[NATIVE_API_UNSUPPORTED]`.
Adapters warn once on stderr with `[NATIVE_MODULE_FALLBACK]`, even under `--quiet`.

Unknown optional modules remain unavailable so the library can use its own
fallback. Unknown required modules still fail, with an adapter/mock hint. Native
module APIs cannot be replaced by the generic View fallback. See the
[Expo support matrix](docs/expo-support.md#native-modules-013) and
[native-module inventory](docs/expo-native-modules.json) for coverage and limits.

Standalone screens get preset-backed safe-area inset/frame contexts when
`react-native-safe-area-context` is installed; your own providers override them.
The SDK 58 starter screens are tested directly without loading the Router layout:

```sh
bunx react-native-a11y-tree@0.1.3 render src/app/explore.tsx --preset ios-phone --format text
```
