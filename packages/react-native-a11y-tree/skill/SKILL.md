---
name: react-native-a11y-tree
description: Verify React Native and Expo behavior, layout, and accessibility with headless Fabric before a simulator pass.
---

# Headless verification

Use `rn-a11y-tree test <file>` for behavior changes; simulators verify visuals/native behavior.

## Commands

| Command | Use when |
| --- | --- |
| `test <file>` | Behavior changes/regressions; default. |
| `render` | One-time copy/accessibility/layout inspection. |
| `run` | One-time interaction probe or existing script; prefer assertions. |
| `check` | Labels/touch-target audit with `--rules default`. |

Tests mount the app; do not chain CLI `render` → `run` → `test`.

## Verification

Package includes runner/config/matchers. Write `a11y/notes.a11y.test.ts`:

```ts
import {test, expect, renderRoute, screen, user} from 'react-native-a11y-tree/test';

test('should submit a note', async () => {
  await renderRoute('/notes', {fixtures: 'expo'});
  await user.type(screen.getByTestId('title-input'), 'Hello');
  await user.press(screen.getByRole('button', {name: 'Save'}));
  expect(await screen.findByText('Hello')).toHaveTextContent('Hello');
});
```

Run `rn-a11y-tree test a11y/notes.a11y.test.ts` once. After repairs, rerun with `-t 'should submit a note'`. Run the full affected file after the last edit; an unchanged green run suffices. Cover all affected files. Check counts: zero matches can exit 0 with all tests skipped.

Skip help/schema discovery and full README reads while writing tests. Use failure context before `screen.debug()`; remove debug calls.

Use `render('src/App.tsx')` for components, `findBy*` for delayed UI. Await `user.press`, `type`, `scroll`, `swipe`, `longPress`, or `back`, then assert state. `type` replaces text. Tests are sequential; renders reset state. Expo fixtures use empty storage/native placeholders. Import hooks from `react-native-a11y-tree/test`.

**Never replace native UI to satisfy the host.** Missing fixtures or `TARGET_ZERO_SIZE` (no layout) require simulator verification.

## Inspection

Use `<file> --preset ios-phone --format text`; routes use `--router --route /path`. Narrow trees with `--select`/`--subtree`/`--depth`. Audit once per affected screen with `check --rules default`; repeat after relevant fixes.

Use unique `testID`s and accessible names. `run --script` failed expectations exit 2; inspect step errors too. Read the README for scripts, fixtures, or network replay as needed. Keep `setup` inside the project and recordings free of sensitive data.

## Simulator

A green file closes asserted host-supported flows until relevant changes. Inspect one launch screenshot; repeat after repairing a launch error. Do not reread unchanged PNGs or replay covered flows. Green tests do not resolve launch failures.

Verify requested visuals/native behavior on the simulator: navigation, keyboard, permissions, WebViews/maps, alerts/haptics, images/fonts, animations, restart persistence. Explicit coverage requirements take precedence.
