---
name: react-native-a11y-tree
description: Verify React Native and Expo screen behavior, copy, layout, and accessibility with headless Fabric before a simulator pass.
---

# React Native accessibility tree

Use `rn-a11y-tree` to inspect a screen and run scripted interactions in the headless host. Use the simulator for visual appearance and native behavior the host does not simulate.

## Safe verification loop

For each important flow, write a Vitest test in `a11y/*.a11y.test.ts` and run `rn-a11y-tree test` after changes until it passes. Run `check --rules default` once per screen for labels and touch targets. Give interactive or checked elements unique `testID`s and accessible names. Use the simulator for launch, visuals, and native-only behavior; a passing headless test covers the simulated flow.

```ts
import {test, expect, renderRoute, screen, user} from 'react-native-a11y-tree/test';

test('should submit a note', async () => {
  await renderRoute('/notes', {fixtures: 'expo'});
  await user.type(screen.getByTestId('title-input'), 'Hello');
  await user.press(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByText('Hello')).toHaveTextContent('Hello');
});
```

Install `react-native-a11y-tree` and run flows with `rn-a11y-tree test`. The package includes its tested Vitest runner and config. Import `test`, `expect`, and setup/teardown hooks from `react-native-a11y-tree/test` alongside the host helpers. Familiar flags such as `-t 'should submit a note'` and `--reporter=json --outputFile=results.json` pass through. Matchers register automatically. Use `render('src/App.tsx')` for a component file, `screen.debug()` to inspect the compact tree, and `findBy*` for delayed or network-backed UI. `user.type` replaces text; `user.clear` empties it. Each render starts with fresh app and fixture state. Tests within a file are sequential.

**Never change production UI to make the headless tool work.** In particular, do not replace a Modal, WebView, map, native tab bar, or other native UI to satisfy this tool. A `TARGET_ZERO_SIZE` step means the target has no host layout; check that interaction on a simulator.

## Commands

```sh
rn-a11y-tree render --router --route /notes --platform ios --format text --select role=button
rn-a11y-tree run --router --route /notes --platform ios --format text --select testID~note- --script '[{"type":{"testID":"title-input","text":"Hello"}},{"tap":{"testID":"save"}},{"snapshot":"after-save"}]'
rn-a11y-tree check --router --route /notes --platform ios --format text --rules default
```

Use `--preset ios-phone` or `--preset android-phone` for realistic viewport and insets. `--select` filters output; `--subtree` and `--depth` narrow it. Text is compact and prints named snapshots; add `--final` when a final tree is needed, `--raw` for host wrappers, or `--diagnostics` for detailed warnings. `--format json` retains full keys and fields for scripts and CI. Check the exit code; text errors print `error CODE: message` on stdout even with `--no-stderr`.

Actions take a `testID`, `ref`, `key`, or `sel` target. Prefer `testID`; refs change when the tree changes. `type` replaces the field by default; set `append: true` to add text. Use `expect` for values or absence so you need fewer snapshots. A failed expectation exits 2; other failed steps appear in the output and later steps still run.

```json
[{"type":{"testID":"email","text":"a@b.c"}},{"expect":{"testID":"email","text":"a@b.c"}},{"tap":{"testID":"submit"}},{"snapshot":"submitted"}]
```

## Router and fixtures

For Expo Router, use `--router --route /path`; the CLI discovers `app` or `src/app` and loads the route without an app wrapper. For a standalone component, give its file path instead. Keep fixture files inside the project and pass `--setup`; files outside the project cannot be bundled. If a required native module has no fixture, verify that screen on a simulator instead of modifying the shipped UI.

`--fixtures expo` opts into in-memory AsyncStorage and visible WebView/map placeholders. These emit fallback diagnostics. The storage fixture starts empty on each CLI invocation; check native content and gestures on a simulator.

Network calls through `fetch`, `expo/fetch`, or `XMLHttpRequest` use the CLI host bridge. Use `--network record --network-file a11y-tree.network.json` to capture responses for a screen, then `--network replay` to repeat it without contacting the server. `--network off` makes accidental requests fail clearly. When the recording file exists, replay is the default; otherwise live requests are used. Keep recordings with the project only if they contain no sensitive data.

## Simulator coverage

Verify native tabs and headers, keyboard avoidance, permission dialogs, WebView content, maps, alerts, haptics, images, fonts, animations, transitions, and persistence across app restarts on a simulator. The headless host does not prove those behaviors.
