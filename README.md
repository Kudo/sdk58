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

macOS arm64 only (the host is built by `yarn build:host`).

| Feature | How it is real | E2E | Known gaps |
| --- | --- | --- | --- |
| Rendering and layout | Real Fabric (React, ShadowTree, Yoga) in the Fantom host | `e2e/render.test.ts` | macOS only; one surface per run |
| Text measurement | CoreText `TextLayoutManager` in the host | `e2e/render.test.ts` (heights > 10) | macOS fonts, not Android/iOS fonts |
| Accessibility tree | Host `NativeFantom.getA11yTree` (typed ShadowTree dump) → `src/tree.ts` | `e2e/render.test.ts` | Role/name derivation is simpler than real screen readers |
| TextInput, Switch | Host `AndroidTextInput` (CoreText measured) and `AndroidSwitch` shadow nodes | `e2e/render.test.ts`, `e2e/run.test.ts` | Android components only (`--platform android`) |
| Tap, long press, typing | Host `hitTest` + by-tag native events, Pressable responder events, `setTextInputTextByTag` | `e2e/run.test.ts` | No multi-touch responder events; `click` does not bubble |
| Scrolling, FlatList | Host scroll events and ScrollView state; `onLayout` delivered by settling the event queue | `e2e/scrolling.test.ts` | One scroll event per `scroll` action (no fling) |
| Session mode | Host `--interactive` mode, one bundle | `e2e/session.test.ts` | No recovery after a host crash |
| react-native-screens | Library C++ compiled into the host; screen state emulated by the host | `e2e/navigation-stack.test.ts` | No transitions; `--platform ios` fails in the navigation example (see Platform) |
| react-native-safe-area-context | Library C++ compiled into the host; insets from `--safe-area-insets` | `e2e/navigation-stack.test.ts` (default insets) | No e2e with non-zero insets yet |
| react-native-gesture-handler | Host descriptors for detector/root/button; JS module on RNGH's web handlers fed by the runner; worklet callbacks through Reanimated | `e2e/gestures.test.ts` | No v3 Reanimated detector events, virtual detectors, or transforms in `absoluteToLocal` |
| react-native-reanimated | Reanimated + worklets C++ in the host; UI frames from `wait` (`produceFramesForDuration` per 16.333 ms); mounted-view values for layout animations | `e2e/reanimated.test.ts` | |
| Expo modules, `@expo/ui` | Not started | none | |

## Quick start

```sh
git clone --recurse-submodules --shallow-submodules <this repo>
yarn install
yarn build:host        # builds native/dist/<arch>/rn-a11y-host
yarn rn-a11y-tree render examples/basic/App.tsx --platform android
yarn check             # tsc --noEmit && yarn test && yarn test:e2e
```

The CLI uses `native/dist/<arch>/rn-a11y-host`. Set `RN_A11Y_HOST_BIN` to use
another host binary.

## CLI reference

The file must have a default export or an `App` named export that is a React
component. Metro's project root is the directory of the nearest
`package.json` above the file, so the project's own dependencies resolve.
`react` and `react-native` resolve from that project first. Exit code is 1 on
failure, with the message on stderr; stdout has only the JSON.

| Command | What it does | Output |
| --- | --- | --- |
| `render <file>` | Render once and print the tree | `{viewport, source, root}` ([schema](#output-schema)) |
| `run <file> --script <json>` | Render, run the actions, print steps and trees | `{viewport, source, steps, snapshots, final, fallbacks, capabilities}` ([Interactions](#interactions)) |
| `session <file>` | Render, then serve JSON-line requests on stdin | one JSON object per line ([Session mode](#session-mode)) |

| Option | Commands | Default | Description |
| --- | --- | --- | --- |
| `--platform <name>` | all | required | Metro platform: `android`, `ios`, `a11ytree`, or any Metro platform name (see [Platform](#platform)) |
| `--width <dp>` | all | `390` | Viewport width |
| `--height <dp>` | all | `844` | Viewport height |
| `--header-height <dp>` | all | 44 for `--platform ios`, else 56 (host) | react-native-screens native header height |
| `--safe-area-insets <t,l,r,b>` | all | `0,0,0,0` | react-native-safe-area-context insets, e.g. `47,0,0,34` |
| `--no-mounted` | all | mounted on | Do not read mounted-view values (`getA11yTree` `includeMountedProps`; used for `visualBox`, `effectiveOpacity`) |
| `--timing` | all | off | Print phase timings as JSON on stderr (see [`docs/perf-analysis.md`](docs/perf-analysis.md)) |
| `--reset-cache` | all | off | Ignore Metro's caches and the bundle cache (cold bundle) |
| `--no-cache` | all | cache on | Do not use the bundle cache (always run Metro) |
| `--bytecode <mode>` | all | `auto` | Hermes bytecode: `auto` (use it when cached; compile in the background after a build), `on` (compile now), `off` |
| `--dev` | all | off | Development bundle (`__DEV__ = true`) |
| `--keep-bundle` | all | off | Keep the bundle and print its path to stderr |
| `-v, --verbose` | all | off | Metro progress, host glog and console output on stderr |
| `--out <file>` | `render`, `run` | stdout | Write the output to a file |
| `--format <f>` | `render`, `run` | `json` | `json`, `compact` (no defaults/empties, no `style`), `text` (one line per node), `ndjson` (one node per line) |
| `--select <sel>` | `render`, `run` | all | Only nodes matching `field=value` or `field~text` (fields: `testID`, `role`, `name`, `type`, `key`, `ref`, `sel`, `text`); repeat to AND. Matches only, unless `--depth` |
| `--depth <n>` | `render`, `run` | all | Levels of children below each output root (0 = node only) |
| `--subtree <sel>` | `render`, `run` | root | Start the output at the first node matching the selector |
| `--style` | `render`, `run` | off | Keep `style` in `compact`/`ndjson` |
| `--bundle-only` | `render`, `run` | off | Build the bundle and stop (no host needed) |
| `--debug-props` | `render` | off | Add raw host debug props to each node (`debugProps`) |
| `--script <json>` | `run` | required | JSON file with an array of actions |
| `--tap-mode <mode>` | `run`, `session` | `touch` | Events for taps: `touch` (responder touches), `click`, or `both` |
| `--timeout <ms>` | `session` | `30000` | Per-request timeout; on timeout the host is killed and the exit code is 1 |

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
| One-line change (Metro with warm caches) | 1453 ms | 1013 ms | 359 ms |
| Bundle cache off (`--no-cache`), warm Metro | 1146 ms | 708 ms | 356 ms |
| Cold (`--reset-cache`) | 5440 ms | 4882 ms | 396 ms |

(Before caching: 1.3 s warm, Metro 0.86 s, bundle eval 150 ms; with bytecode
bundle eval is 13 ms.)

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
    "box": {"x": 0, "y": 0, "width": 390, "height": 844},  // on screen, dp (ShadowTree layout)
    "visualBox": {...},        // only if a transform/mounted frame applies: where it is drawn
    "effectiveOpacity": 0.5,   // only if < 1: own x ancestors' opacity (mounted opacity if reported)
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
yarn rn-a11y-tree run examples/basic/App.tsx --platform android --script examples/basic/actions.json
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

The script is a JSON array. It is validated before bundling; errors name the
step index.

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

- Targets: `testID` or `ref`. A `ref` is resolved against the tree at the
  time of the step (refs can change after the UI changes).
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
  delivered (`flushEventQueue` + work loop) until the tree stops changing.
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

## react-native-gesture-handler

The host has no native gesture handler engine. RNGH 3.2.1's native module
and native v3 detector are replaced in the bundle (`src/bundle.ts`
`RESOLVED_ALIASES`, matched on the resolved file path):

| RNGH file | Replaced by |
| --- | --- |
| `src/specs/NativeRNGestureHandlerModule.ts` | `runtime/gh/NativeRNGestureHandlerModule.js` |
| `src/v3/detectors/HostGestureDetector.tsx` | `runtime/gh/HostGestureDetector.js` |

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
- `HostGestureDetector.js` renders the real `RNGestureHandlerDetector` and
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

`runtime/turboModuleStubs.js` adds JS stand-ins for core TurboModules the
host lacks but libraries require at import time: `StatusBarManager` (RNGH
imports `DrawerLayoutAndroid`, which imports `StatusBar`).

## Session mode

```sh
yarn rn-a11y-tree session examples/basic/App.tsx --platform android [--tap-mode touch|click|both]
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
{"id": 4, "action": {"tap": {"testID": "nope"}}}     {"id": 4, "ok": false, "error": "Target not found: ...", "step": {...}}
{"id": 5, "quit": true}                              {"id": 5, "ok": true}
```

- `action` takes the same objects as `run --script`; `step` has the same
  shape as in `run`, and trees the same schema as `render`. Invalid requests
  get `{"id", "ok": false, "error"}` without reaching the app.
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
`globalThis.__rnA11y.request(json)` (`runtime/session.js`, which uses the
same action runner as `run`). Each request is sent as one line of JS that
calls it; it prints one `{"type":"rn-a11y-tree-response",...}` line through
`NativeFantom.reportTestSuiteResultsJSON`. The host exits when its stdin is
closed.

## How it works

1. **Metro**: `src/bundle.ts` writes an entry (`runtime/entry-template.js`
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

rn-a11y-tree run App.tsx --script actions.json
  same, plus: src/script.ts validates the script; the entry embeds it and
  runtime/actions.js runs it after the render; snapshots and the final tree
  are converted by src/tree.ts
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
  host does not implement yet, and iOS-only core native modules: the
  navigation example fails with `Got unexpected null` in `LinkingImpl`.
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
yarn check            # all of the below: typecheck, unit tests, e2e
yarn typecheck        # tsc --noEmit
yarn test             # unit tests + CLI tests against a fake host (test/fixtures/fake-host.js)
yarn test:e2e         # real host; skipped if there is no native/dist binary and no RN_A11Y_HOST_BIN
yarn rn-a11y-tree render examples/basic/App.tsx --platform android --bundle-only
```

Versions: Expo SDK 58 (`expo@58.0.0`), `react-native@0.88.0-rc.2`,
`react@19.3.0`, Metro 0.87.1. Yarn 4 with `nodeLinker: node-modules`.

## CI

`.github/workflows/ci.yml` runs on `macos-15` (arm64) with Xcode 26.3,
JDK 17 (temurin), Node 24 and Android SDK CMake 3.30.5. `native/dist` is
cached. The key has the Xcode version, the submodule commit, the versions of
the npm libraries compiled into the host (`react-native-screens`,
`react-native-safe-area-context`, `react-native-gesture-handler`,
`react-native-reanimated`, `react-native-worklets`) and the hash of
`native/overlay/**`, `native/scripts/**` and `scripts/build-host.sh`. On a
cache miss it runs `yarn build:host`. Then: `yarn tsc --noEmit`,
`yarn test`, `yarn test:e2e` (every `e2e/*.test.ts`), and every
`native/tests/*-itest.js` Fantom test (copied with its helper files into the
submodule, with the npm libraries installed there too, and run with
`yarn fantom`, with `GITHUB_ACTIONS` unset because Fantom treats it as Meta
CI).

## Milestones

Done: JS/CLI and Metro bundling; host build from this repo
(`yarn build:host`); CoreText text measurement; typed ShadowTree dump;
interactions (`run`, `session`); react-native-screens and
react-native-safe-area-context in the host; react-native-gesture-handler
(JS module on its web handlers + host descriptors); CI workflow (not yet run
on GitHub).

Reanimated/worklets are in the host, including mounted-view values.

Pending: release
(prebuilt host binaries for macOS arm64/x86_64 and Linux, no Homebrew
OpenSSL dependency); Expo modules and `@expo/ui`; a `check` command
(design tokens, contrast).
