import assert from 'node:assert/strict';
import path from 'node:path';
import {test, type TestContext} from 'vitest';

import type {RunResult, TreeNode} from '../src/schema.ts';
import {cliJson, E2E_PRESETS, findAll, hostSkip, isIOS, type Preset, ROOT} from './helpers.ts';

const EXAMPLE = path.join(ROOT, 'examples', 'expo-ui');
const SCRIPT = path.join(EXAMPLE, 'actions.json');

function run(file: string, preset: Preset): RunResult {
  return cliJson<RunResult>(['run', path.join(EXAMPLE, file), '--script', SCRIPT], preset);
}

const byKey = (tree: TreeNode, key: string) => findAll(tree, n => n.key === key)[0];
const shape = (n: TreeNode): unknown =>
  n.children.length > 0 ? {[n.type]: n.children.map(shape)} : n.type;

/**
 * Capability gating:
 * - `expoUI`: the host renders Expo module views (else the test is skipped);
 * - `expoModifierEvents`: dispatchExpoModifierEvent (modifier callbacks) and
 *   written Host frames (host step 2);
 * - `expoUI.fakeLayout`: frames are the fake layout (rows of 40), not
 *   SwiftUI/Compose layout;
 * - `expoUI.swiftUILayout` / `expoUI.composeLayout`: that engine lays out its
 *   Hosts (the other kind keeps the fake layout until its engine lands).
 * Box assertions need the engine of the screen's kind.
 */
function gates(result: RunResult, t: TestContext, kind: 'swiftUI' | 'compose') {
  const caps = new Set(result.capabilities);
  const modifierEvents = caps.has('expoModifierEvents');
  const engine = kind === 'swiftUI' ? 'expoUI.swiftUILayout' : 'expoUI.composeLayout';
  const realLayout = modifierEvents && caps.has(engine);
  if (!modifierEvents) t.annotate('host without expoModifierEvents (step 1): modifier callbacks and frames not checked');
  else if (!realLayout) t.annotate(`no ${engine}: box assertions skipped`);
  return {modifierEvents, realLayout};
}

/**
 * `layout` labels: the Host is `emulated`. Newer hosts also label the
 * engine-laid-out descendants `emulated` and set `emulatedBy` on the Host;
 * older ones label descendants `placeholder`. Both are accepted.
 */
function checkLayoutLabels(host: TreeNode, engine: 'swiftui' | 'compose', realLayout: boolean) {
  assert.equal(host.layout, 'emulated');
  const descendants = findAll(host, n => n !== host && n.type.startsWith('ExpoUI.'));
  for (const n of descendants) assert.ok(n.layout === 'emulated' || n.layout === 'placeholder', `${n.key}: ${n.layout}`);
  if (host.emulatedBy != null) {
    assert.equal(host.emulatedBy, engine);
    if (realLayout) {
      assert.deepEqual(descendants.filter(n => n.layout !== 'emulated').map(n => n.key), []);
    }
  }
}

/** Universal @expo/ui with Compose views: tree, roles, button, switch, clickable Text. */
function checkCompose(result: RunResult, t: TestContext) {
  const {modifierEvents, realLayout} = gates(result, t, 'compose');
  const host = findAll(result.final, n => n.type === 'ExpoUI.HostView')[0];
  assert.deepEqual(shape(host), {
    'ExpoUI.HostView': [
      {
        'ExpoUI.ColumnView': [
          'ExpoUI.TextView',
          {'ExpoUI.Button': ['ExpoUI.TextView']},
          {'ExpoUI.RowView': ['ExpoUI.TextView', 'ExpoUI.SwitchView']},
        ],
      },
    ],
  });
  checkLayoutLabels(host, 'compose', realLayout);

  const go = byKey(result.final, 'go');
  assert.deepEqual([go.role, go.name], ['button', 'Go']);
  assert.deepEqual(go.expo?.modifiers, [{$type: 'testID', testID: 'go'}]);
  const greeting = byKey(result.final, 'greeting');
  assert.deepEqual([greeting.role, greeting.name, greeting.text], ['text', 'Hello', 'Hello']);
  assert.ok((greeting.expo?.modifiers as Array<{$type: string}>).some(m => m.$type === 'clickable'));
  const remember = byKey(result.final, 'remember');
  assert.equal(remember.role, 'switch');

  // Steps: Compose events chosen from the JS props.
  assert.deepEqual(result.steps[0].events, ['buttonPressed']);
  assert.deepEqual(result.steps[1].events, ['checkedChange']);
  assert.equal(byKey(result.final, 'status').text, 'Pressed');
  assert.equal(byKey(result.final, 'remember-state').text, 'Remember: off');
  assert.deepEqual(remember.a11y.state, {checked: false});
  if (modifierEvents) {
    assert.deepEqual(result.steps[2].events, ['modifier:clickable']);
    assert.equal(byKey(result.final, 'taps').text, 'Taps: 1');
  } else {
    assert.match(String(result.steps[2].warnings), /no dispatchExpoModifierEvent/);
  }
  if (realLayout) {
    // Compose (M3 defaults): a 14sp Text is 16 dp high; Button and Switch
    // get the 48 dp minimum touch target.
    assert.ok(host.box.height > 0);
    assert.ok(Math.abs(greeting.box.height - 16) <= 2, `Text height ${greeting.box.height}`);
    assert.ok(Math.abs(go.box.width - 66) <= 1 && Math.abs(go.box.height - 48) <= 1, `Button ${JSON.stringify(go.box)}`);
    assert.ok(
      Math.abs(remember.box.width - 52) <= 1 && Math.abs(remember.box.height - 48) <= 1,
      `Switch ${JSON.stringify(remember.box)}`,
    );
  }
  assert.ok(result.snapshots.after);
}

/** @expo/ui/swift-ui with SwiftUI views: tree, modifiers, button, toggle, onTapGesture. */
function checkSwiftUI(result: RunResult, t: TestContext) {
  const {modifierEvents, realLayout} = gates(result, t, 'swiftUI');
  const host = findAll(result.final, n => n.type === 'ExpoUI.HostView')[0];
  assert.deepEqual(shape(host), {
    'ExpoUI.HostView': [{'ExpoUI.VStackView': ['ExpoUI.TextView', 'ExpoUI.Button', 'ExpoUI.ToggleView']}],
  });
  checkLayoutLabels(host, 'swiftui', realLayout);
  assert.deepEqual(host.children[0].expo?.modifiers, [{$type: 'padding', all: 8}]);
  const greeting = byKey(result.final, 'greeting');
  assert.deepEqual([greeting.role, greeting.name, greeting.text], ['text', 'Greeting', 'Hello']);
  const go = byKey(result.final, 'go');
  assert.deepEqual([go.role, go.name], ['button', 'Go']);
  assert.deepEqual(go.expo?.modifiers, [{$type: 'frame', height: 44}]);
  const remember = byKey(result.final, 'remember');
  assert.deepEqual([remember.role, remember.name, remember.a11y.state], ['switch', 'Remember', {checked: false}]);

  assert.deepEqual(result.steps[0].events, ['buttonPress']);
  assert.deepEqual(result.steps[1].events, ['isOnChange']);
  assert.equal(byKey(result.final, 'status').text, 'Pressed');
  assert.equal(byKey(result.final, 'remember-state').text, 'Remember: off');
  if (modifierEvents) {
    assert.deepEqual(result.steps[2].events, ['modifier:onTapGesture']);
    assert.equal(byKey(result.final, 'taps').text, 'Taps: 1');
  } else {
    assert.match(String(result.steps[2].warnings), /no dispatchExpoModifierEvent/);
  }
  if (realLayout) {
    // SwiftUI body text: 20.333 dp high.
    assert.ok(host.box.height > 0);
    assert.ok(Math.abs(greeting.box.height - 20.333) <= 1, `Text height ${greeting.box.height}`);
  }
}

// App.tsx picks the screen by platform: universal (Compose views) on
// android, the SwiftUI screen on ios. SwiftUIScreen.tsx renders SwiftUI views
// on any platform (checked once, under android).
for (const preset of E2E_PRESETS) {
  const cases: Array<[string, 'compose' | 'swiftUI']> = isIOS(preset)
    ? [['App.tsx', 'swiftUI']]
    : [
        ['App.tsx', 'compose'],
        ['SwiftUIScreen.tsx', 'swiftUI'],
      ];
  for (const [file, kind] of cases) {
    const title = kind === 'compose' ? 'universal @expo/ui (Compose views)' : '@expo/ui/swift-ui (SwiftUI views)';
    test(`[${preset.name}] expo-ui ${file}: ${title}`, {timeout: 180_000}, t => {
      if (hostSkip) t.skip(hostSkip);
      const result = run(file, preset);
      if (!result.capabilities.includes('expoUI')) {
        t.skip('host has no expoUI capability');
      }
      if (kind === 'compose') checkCompose(result, t);
      else checkSwiftUI(result, t);
    });
  }
}
