# E2E coverage

Each e2e test runs the CLI against the real host (`native/dist/<arch>/rn-a11y-host`
or `RN_A11Y_HOST_BIN`) and skips with a reason when there is no host binary.
Native CI sets `RN_A11Y_E2E_STRICT=1`: missing hosts and required capabilities
fail instead of silently reducing coverage. Explicit preset exclusions remain
skips. CLI subprocesses have a separate 120-second backstop.
The suites run once per preset in `RN_A11Y_E2E_PRESETS` (default
`android-phone,ios-phone`; `e2e/helpers.ts`), and every test name starts with
`[<preset>]`. Expectations that legitimately differ between the platforms
use the preset's values (viewport, safe area insets, header height) or name
them in the table. Unit and CLI tests against a fake host are in `test/`
(`bun run test`); the native Fantom itests are in `native/tests/` (see
[`native/README.md`](../native/README.md)).

| Test | Example | `--preset` | Per-preset differences |
| --- | --- | --- | --- |
| `e2e/render.test.ts` | basic | android-phone, ios-phone (+ one android-tablet line) | viewport 412x915 / 393x852; `email` `AndroidTextInput` / `TextInput`, `remember` `AndroidSwitch` / `Switch` (same sizes: 36.333 high, 51x31) |
| `e2e/native-fixtures.test.ts` | temporary Expo/Turbo modules | android-phone, ios-phone | setup edits, strict policy, run/check/session |
| `e2e/storage-fixture.test.ts` | storage-fixture | android-phone, ios-phone | real AsyncStorage JS; explicit in-memory native contract, fresh-process reset |
| `e2e/run.test.ts` | basic | android-phone, ios-phone | none |
| `e2e/check.test.ts` | basic | android-phone, ios-phone | none (same violations) |
| `e2e/schema.test.ts` | every example | android-phone, ios-phone | none |
| `e2e/session.test.ts` | basic | android-phone, ios-phone | ready tree width = preset width |
| `e2e/scrolling.test.ts` | scrolling | android-phone, ios-phone | none |
| `e2e/navigation-stack.test.ts` | navigation-stack | android-phone, ios-phone | header at y 24 / 59, height 56 / 44 |
| `e2e/gestures.test.ts` | gestures | android-phone, ios-phone | root `RNGestureHandlerRootView` / `View` |
| `e2e/reanimated.test.ts` | reanimated | android-phone, ios-phone | none |
| `e2e/expo-ui.test.ts` | expo-ui | android-phone (App.tsx Compose + SwiftUIScreen.tsx), ios-phone (App.tsx SwiftUI) | Compose screen on android, SwiftUI screen on ios |
| `e2e/dimensions.test.ts` | dimensions | android-phone, ios-phone | window/screen = preset viewport, scale 3, fontScale 1 (needs `deviceMetrics`) |
| `e2e/package.test.ts` | basic (scratch project) | android-phone | none |
| `e2e/unicode.test.ts` | unicode | android-phone, ios-phone (+ one android-phone LANG test) | none (the date is in the host's time zone) |

## `e2e/render.test.ts` — `examples/basic/App.tsx`, `render`

- Exit code 0; `viewport` and the root box are the preset's (412x915 android-phone, 393x852 ios-phone).
- `submit` (Pressable) is at x 24, width = viewport width - 48, height 48.
- A Paragraph has the text "Sign in".
- `shadowTree` source only:
  - the container View has children (full hierarchy, no view flattening);
  - `submit` has `role === 'button'` (from the ARIA `role` prop) and a Paragraph child;
  - every Paragraph box is taller than 10 (CoreText measurement);
  - `email` (TextInput, type `AndroidTextInput` / `TextInput`): role `textbox`, height 36.333, `style.placeholder === 'Email'`;
  - `remember` (Switch, type `AndroidSwitch` / `Switch`): role `switch`, name "Remember me", `a11y.state.checked === true`, box 51x31.
- `render --format text --select role=button` prints exactly one line: `submit View #submit role=button "Submit" {24,…,<width - 48>x48}`.
- `render --preset android-tablet` (no `--platform`) gives the same line with width 752 (800 - 2 x 24).

## `e2e/run.test.ts` — `examples/basic/actions.json`, `run`

Actions: type "a@b.c" into `email`, tap `remember`, tap `submit`, snapshot.

- Steps are `type, tap, tap, snapshot`; no step has an error or warnings; every non-snapshot step has a `hit`.
- Snapshot `after-submit` exists.
- `status` shows "Submitted" (Pressable `onPress` fired).
- No JS fallbacks; `email.text === 'a@b.c'` (`setTextInputTextByTag`).
- `echo` shows "a@b.c" (`onChangeText` fired).
- `remember` `a11y.state.checked === false` (the Switch toggled from on).
- `run --diff`: the `type` step adds `echo` and changes `email.text` to "a@b.c"; the Switch tap changes only `remember` (`state: {checked: false}`); the Submit tap adds `status`.

## `e2e/check.test.ts` — `examples/basic/App.tsx`, `check`

- `--rules examples/basic/rules-fail.json`: exit code 2, `ok: false`. The violations are exactly: touchTarget `email` height (36.3), touchTarget `remember` height (31), tokens `submit` backgroundColor (#1e6fff is not a token), contrast `submit/Paragraph:1` (4.4, #ffffff on #1e6fff, `bgFrom: "host"`).
- `email` passes `names` through its placeholder ("Email", `from: "placeholder"`).
- `--rules examples/basic/rules-pass.json`: exit code 0, `ok: true`, no violations.
- `--rules rules-pass.json --script actions.json --format text`: exit code 0; the final tree (with `echo` and `status`) passes.

## `e2e/schema.test.ts` — every example, `render`, `run --diff`, `check`

- For each `examples/*/App.tsx`: `render` output validates against `schema/render-result.json`.
- For each example with `actions.json`: `run --diff` output validates against `schema/run-result.json`.
- `check --rules examples/basic/rules-fail.json` output (exit code 2) validates against `schema/check-result.json`.

## `e2e/expo-ui.test.ts` — `examples/expo-ui/actions.json`, `run`

Actions: tap `go`, tap `remember`, tap `greeting`, snapshot. Capability gating: modifier callbacks need `expoModifierEvents`; boxes need `expoModifierEvents` and the engine of the screen's kind (`expoUI.composeLayout` for `App.tsx`, `expoUI.swiftUILayout` for `SwiftUIScreen.tsx`); the test adds an annotation when it skips them. Skipped without `expoUI`.

- `App.tsx` (universal `@expo/ui`, `--platform android`): Host tree is `ExpoUI.HostView > ExpoUI.ColumnView > [ExpoUI.TextView, ExpoUI.Button > ExpoUI.TextView, ExpoUI.RowView > [ExpoUI.TextView, ExpoUI.SwitchView]]`; Host `layout: emulated`; descendants `emulated` or `placeholder` (both accepted; with `emulatedBy` on the Host it must be `compose`, and with `expoUI.composeLayout` every descendant must be `emulated`).
  - `go`: role `button`, name "Go", `expo.modifiers` `[{$type: testID}]`; `greeting`: role `text`, name/text "Hello", a `clickable` modifier; `remember`: role `switch`.
  - Step events `buttonPressed`, `checkedChange`; `status` = "Pressed", `remember-state` = "Remember: off", `remember` `a11y.state.checked === false`.
  - With `expoModifierEvents`: step 2 event `modifier:clickable`, `taps` = "Taps: 1"; else the step warns that the host has no `dispatchExpoModifierEvent`.
  - With `expoUI.composeLayout`: Host height > 0, `greeting` Text height 16 ± 2 (14sp, M3 default), `go` Button 66x48 ± 1, `remember` Switch 52x48 ± 1 (48 dp touch target).
- `SwiftUIScreen.tsx` (`@expo/ui/swift-ui`, `--platform android`): `ExpoUI.HostView > ExpoUI.VStackView > [ExpoUI.TextView, ExpoUI.Button, ExpoUI.ToggleView]` (layout labels as above, engine `swiftui`); VStack `expo.modifiers` `[{$type: padding, all: 8}]`; `greeting` name "Greeting" (accessibilityLabel modifier), text "Hello"; `go` `frame` modifier; `remember` role `switch`, name "Remember".
  - Step events `buttonPress`, `isOnChange`; `status` = "Pressed", `remember-state` = "Remember: off", `remember` unchecked.
  - With `expoModifierEvents`: `modifier:onTapGesture`, `taps` = "Taps: 1".
  - With `expoUI.swiftUILayout`: Host height > 0, `greeting` Text height 20.333 ± 1 (body).

## `e2e/package.test.ts` — npm packages in a scratch project

Skipped without `npm` or a `native/dist` host.

- `release-host.ts --pack --packages-dir <temp>` stages the scoped runtime packages; `npm pack` of the matching runtime and the CLI (its `prepack` runs `bun run build`).
- The CLI tarball has `dist/rn-a11y-tree.js` and no `src/`, `native/`, `test/`, `e2e/`, `examples/`, `third_party/`.
- `npm install expo@58.0.0 react-native@0.88.0-rc.2 react@19.3.0 <both tarballs>` in a scratch project; `npx rn-a11y-tree render App.tsx --preset android-phone --format text` (examples/basic) prints `RootView RootView {0,0,412x915}` and the `submit` line (364x48).
- `npx rn-a11y-tree session` ready line: `host.source === "package"`, `host.protocolVersion === 1`; binary path points into the matching scoped runtime package and no `rn-a11y-host` npm package is installed.

## `e2e/dimensions.test.ts` — `examples/dimensions/App.tsx`, `render`

Skipped without the `deviceMetrics` capability.

- `useWindowDimensions()` gives `window <width>x<height> scale <scale> fontScale <fontScale>` of the preset (412x915 / 393x852, scale 3, font scale 1).
- `Dimensions.get('screen')` read at import time gives the viewport too (set before the app module loads).
- `PixelRatio.get()` / `getFontScale()` match.
- `--scale 2 --font-scale 1.5` override the preset in all three.

## `e2e/scrolling.test.ts` — `examples/scrolling/actions.json`, `run`

Actions: snapshot `before`, scroll `list` to y=600, snapshot `after`, tap
`row-12`, snapshot `after-tap`, scroll `flat` to y=3000, wait 500, snapshot
`flat-after`.

- No step has an error.
- `offset` shows "offset 600" (`onScroll` fired).
- `list` `style.contentOffset` is `{0,0}` before and `{0,600}` after.
- `row-0` box y moves by −600 (on-screen boxes follow the scroll offset).
- The tap on `row-12` has no warnings and its hit node is inside `row-12`; `selected` shows "row 12".
- `flat-row-50` is absent before and present after the FlatList scroll (windowing works: `onLayout` delivered, `zoomScale: 1`).

## `e2e/session.test.ts` — `examples/basic/App.tsx`, `session`

- First line `{ready: true, tree}`; `status` is absent.
- `{id:1, action:{tap:{testID:"submit"}}}` → `ok: true` with a hit.
- `{id:2, tree:true}` → `status` text "Submitted".
- `{id:3, quit:true}` → `{id:3, ok:true}`; the process exits 0.

## `e2e/navigation-stack.test.ts` — `examples/navigation-stack/actions.json`, `run`

React Navigation native stack on react-native-screens. Actions: snapshot
`home`, tap `go-details`, wait 300, snapshot `details`, tap `go-back`, wait
300, snapshot `back`.

- Skips when `RNSScreen` has no size or the Home header has no `title` (host without screens support).
- No step has an error.
- `details`: `RNSScreenStack` has 2 `RNSScreen` children; the second has the stack's box and contains `details-text` = "Details 42".
- `RNSScreenStack` fills the viewport.
- The second screen's `RNSScreenStackHeaderConfig`: `style.title` and `name` "Details", `role` null, box `{0, insets.top, width, headerHeight}` (android-phone `{0,24,412,56}`, ios-phone `{0,59,393,44}`); `RNSScreenContentWrapper` starts at `insets.top + headerHeight` and ends at the screen bottom; `details-text` is below the header.
- `back`: 1 `RNSScreen`; `go-details` present with a non-empty box.

## `e2e/gestures.test.ts` — `examples/gestures/actions.json`, `run`

react-native-gesture-handler: `Gesture.Race(pan, longPress, tap)` (v2,
`runOnJS(true)`) on `drag`, a `RectButton` (v3 NativeDetector), and worklet
gestures on `drag-ui`. Actions: tap `drag`, pan `drag` by dx 100, long press
`drag`, tap `rect`, pan `drag-ui` by dx 80, wait 100, tap `drag-ui`.

- The root's child is `RNGestureHandlerRootView` (android) or `View` (ios: GestureHandlerRootView is a plain View); skips when it has no size.
- No step has an error; every gesture step reached at least one handler (`gestureHandlers > 0`).
- `tap-out` = "tapped".
- `drag` moved right by exactly the reported `pos-out` translation, and 70 < dx ≤ 100 (RNGH resets the pan start at activation, after the 15 dp slop).
- `long-out` = "long-pressed".
- `rect-out` = "rect-pressed".
- Worklet callbacks (`drag-ui`: `Gesture.Race(Pan, Tap)` without `runOnJS(true)`, Reanimated `useAnimatedStyle`): after a pan of dx 80 and wait 100, the layout `box` is unchanged and `visualBox.x - box.x` is in (50, 80] (64 today: pan slop); after a tap on the moved view, `ui-tap-out` = "ui-tapped" (`runOnJS` from the tap worklet).

## `e2e/reanimated.test.ts` — `examples/reanimated/actions.json`, `run`

Skips with "host lacks reanimated support" if the app fails at import (hosts
without Reanimated).

- No step has an error.
- `box` width 50 at `start`, strictly between 50 and 250 at `mid` (200 ms into a 400 ms `withTiming`; 150 today), 250 at `end` (±0.5).
- `slide`: the layout `box` does not move; `visualBox.x - box.x` ≈ 120 (±1) after `withSpring(120)` and 1000 ms (`style.transform[12]` = 120).
- `fade`: `effectiveOpacity` < 1 at `fade-start` (50 ms into `FadeIn.duration(300)`; mounted opacity ≈ 0.056 today) — checked when `capabilities` has `getA11yTree.mounted`, otherwise logged as an annotation — and 1 at `fade-end`.
- `label` = "from-ui" (`runOnUI` → `runOnJS` roundtrip).

## `e2e/unicode.test.ts` — `examples/unicode/App.tsx`, `render`

Hermes' platform Unicode functions (CoreFoundation on macOS, ICU with the
trimmed data of `scripts/icu-data-filter.json` on Linux; Hermes is built
without Intl, so locale and options arguments are ignored).

- `localeCompare`: `a`/`b` gives -1 and 1; precomposed and decomposed `é` compare equal (0).
- `new Date(0).toLocaleDateString(...)`: English medium date, `Dec 31, 1969` or `Jan 1, 1970` (host time zone).
- `toLocaleTimeString()`: `H:00:00` + U+202F + `AM`/`PM`; `toLocaleString()`: date, then ` at ` (CoreFoundation) or `, ` (ICU), then the time.
- `(1234.5).toLocaleString(...)`: `1234.5` or `1,234.5`.
- `'İ'.toLowerCase()`: U+0069 U+0307; `'ß'.toUpperCase()`: `SS`.
- `normalize`: NFD of `é` has length 2, NFC of `e` + U+0301 length 1, NFKC of `ﬁ` is `fi`.
- A second test (android-phone) renders with `LANG`, `LC_ALL`, `LC_MESSAGES` unset and with `LANG=LC_ALL=de_DE.UTF-8`: the same Paragraph texts.
