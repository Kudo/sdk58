---
name: react-native-a11y-tree
description: Verify React Native and Expo screen behavior, copy, layout, and accessibility with headless Fabric before a simulator pass.
---

# React Native accessibility tree

Use `rn-a11y-tree` to inspect a screen and run scripted interactions in the headless host. Use the simulator for visual appearance and native behavior the host does not simulate.

## Safe verification loop

After finishing a screen, run one script for each important flow, snapshot the states you need to inspect, and run `check` for labels and touch targets. Give interactive or checked elements unique `testID`s and accessible names. Then check visuals and native behavior on a simulator.

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

Network calls through `fetch`, `expo/fetch`, or `XMLHttpRequest` use the CLI host bridge. Use `--network record --network-file a11y-tree.network.json` to capture responses for a screen, then `--network replay` to repeat it without contacting the server. `--network off` makes accidental requests fail clearly. When the recording file exists, replay is the default; otherwise live requests are used. Keep recordings with the project only if they contain no sensitive data.

## Simulator coverage

Verify native tabs and headers, keyboard avoidance, permission dialogs, WebView content, maps, alerts, haptics, images, fonts, animations, transitions, and persistence across app restarts on a simulator. The headless host does not prove those behaviors.
