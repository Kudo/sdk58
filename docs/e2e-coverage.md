# E2E coverage

Each e2e test runs the CLI against the real host (`native/dist/<arch>/rn-a11y-host`
or `RN_A11Y_HOST_BIN`) with `--platform android`, and skips with a reason when
there is no host binary. Unit and CLI tests against a fake host are in
`test/` (`yarn test`); the native Fantom itests are in `native/tests/` (see
[`native/README.md`](../native/README.md)).

## `e2e/render.test.ts` — `examples/basic/App.tsx`, `render`

- Exit code 0; `viewport` is 390x844; the root box width is 390.
- `submit` (Pressable) exists and has a non-empty box.
- A Paragraph has the text "Sign in".
- `shadowTree` source only:
  - the container View has children (full hierarchy, no view flattening);
  - `submit` has `role === 'button'` (from the ARIA `role` prop) and a Paragraph child;
  - every Paragraph box is taller than 10 (CoreText measurement);
  - `email` (TextInput): role `textbox`, height > 18, `style.placeholder === 'Email'`;
  - `remember` (Switch): role `switch`, name "Remember me", `a11y.state.checked === true`, box 51x31.
- `render --format text --select role=button` prints exactly one line: `submit View #submit role=button "Submit" {24,…,342x48}`.
- `render --preset android-tablet` (no `--platform`) gives the same line with width 752 (800 - 2 x 24).

## `e2e/run.test.ts` — `examples/basic/actions.json`, `run`

Actions: type "a@b.c" into `email`, tap `remember`, tap `submit`, snapshot.

- Steps are `type, tap, tap, snapshot`; no step has an error or warnings; every non-snapshot step has a `hit`.
- Snapshot `after-submit` exists.
- `status` shows "Submitted" (Pressable `onPress` fired).
- `email.text === 'a@b.c'` when the host reflects typed text (`setTextInputTextByTag`).
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

Actions: tap `go`, tap `remember`, tap `greeting`, snapshot. Capability gating: modifier callbacks need `expoModifierEvents`; boxes need `expoModifierEvents` and the engine of the screen's kind (`expoUI.composeLayout` for `App.tsx`, `expoUI.swiftUILayout` for `SwiftUIScreen.tsx`); the test prints a diagnostic when it skips them. Skipped without `expoUI`.

- `App.tsx` (universal `@expo/ui`, `--platform android`): Host tree is `ExpoUI.HostView > ExpoUI.ColumnView > [ExpoUI.TextView, ExpoUI.Button > ExpoUI.TextView, ExpoUI.RowView > [ExpoUI.TextView, ExpoUI.SwitchView]]`; Host `layout: emulated`, Column `placeholder`.
  - `go`: role `button`, name "Go", `expo.modifiers` `[{$type: testID}]`; `greeting`: role `text`, name/text "Hello", a `clickable` modifier; `remember`: role `switch`.
  - Step events `buttonPressed`, `checkedChange`; `status` = "Pressed", `remember-state` = "Remember: off", `remember` `a11y.state.checked === false`.
  - With `expoModifierEvents`: step 2 event `modifier:clickable`, `taps` = "Taps: 1"; else the step warns that the host has no `dispatchExpoModifierEvent`.
  - With `expoUI.composeLayout`: Host height > 0, `greeting` Text height 16 ± 2 (14sp, M3 default), `go` Button 66x48 ± 1, `remember` Switch 52x48 ± 1 (48 dp touch target).
- `SwiftUIScreen.tsx` (`@expo/ui/swift-ui`, `--platform android`): `ExpoUI.HostView > ExpoUI.VStackView > [ExpoUI.TextView, ExpoUI.Button, ExpoUI.ToggleView]`; VStack `expo.modifiers` `[{$type: padding, all: 8}]`; `greeting` name "Greeting" (accessibilityLabel modifier), text "Hello"; `go` `frame` modifier; `remember` role `switch`, name "Remember".
  - Step events `buttonPress`, `isOnChange`; `status` = "Pressed", `remember-state` = "Remember: off", `remember` unchecked.
  - With `expoModifierEvents`: `modifier:onTapGesture`, `taps` = "Taps: 1".
  - With `expoUI.swiftUILayout`: Host height > 0, `greeting` Text height 20.333 ± 1 (body).

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
- The second screen's `RNSScreenStackHeaderConfig`: `style.title` and `name` "Details", `role` null, box `{0,0,390,56}`; `details-text` is at y ≥ 56 (below the header).
- `back`: 1 `RNSScreen`; `go-details` present with a non-empty box.

## `e2e/gestures.test.ts` — `examples/gestures/actions.json`, `run`

react-native-gesture-handler: `Gesture.Race(pan, longPress, tap)` (v2,
`runOnJS(true)`) on `drag`, a `RectButton` (v3 NativeDetector), and worklet
gestures on `drag-ui`. Actions: tap `drag`, pan `drag` by dx 100, long press
`drag`, tap `rect`, pan `drag-ui` by dx 80, wait 100, tap `drag-ui`.

- Skips when `RNGestureHandlerRootView` has no size.
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
- `fade`: `effectiveOpacity` < 1 at `fade-start` (50 ms into `FadeIn.duration(300)`; mounted opacity ≈ 0.056 today) — checked when `capabilities` has `getA11yTree.mounted`, otherwise logged as a diagnostic — and 1 at `fade-end`.
- `label` = "from-ui" (`runOnUI` → `runOnJS` roundtrip).
