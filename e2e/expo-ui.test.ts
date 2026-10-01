import path from 'node:path';
import {describe, expect, it} from 'vitest';

import type {RunResult, TreeNode} from '../src/schema.ts';
import {cliJson, e2ePreset, findAll, hostSkip, type Preset, ROOT} from './helpers.ts';

const EXAMPLE = path.join(ROOT, 'examples', 'expo-ui');
const SCRIPT = path.join(EXAMPLE, 'actions.json');

function run(file: string, preset: Preset): RunResult {
  return cliJson<RunResult>(['run', path.join(EXAMPLE, file), '--script', SCRIPT], preset);
}

const byKey = (tree: TreeNode, key: string) => findAll(tree, n => n.key === key)[0];
const shape = (n: TreeNode): unknown =>
  n.children.length > 0 ? {[n.type]: n.children.map(shape)} : n.type;

/*
 * App.tsx picks the screen by platform: universal @expo/ui (Compose views) on
 * android, the SwiftUI screen on ios. SwiftUIScreen.tsx renders SwiftUI views
 * on any platform (checked under android).
 *
 * Capability gating:
 * - `expoUI`: the host renders Expo module views (else the test is skipped);
 * - `expoModifierEvents`: dispatchExpoModifierEvent (modifier callbacks) and
 *   written Host frames (host step 2);
 * - `expoUI.swiftUILayout` / `expoUI.composeLayout`: that engine lays out its
 *   Hosts. Box assertions need the engine of the screen's kind.
 *
 * `layout` labels: the Host is `emulated`. Newer hosts also label the
 * engine-laid-out descendants `emulated` and set `emulatedBy` on the Host;
 * older ones label descendants `placeholder`. Both are accepted.
 */
describe('expo-ui', () => {
  it('[android-phone] App.tsx: universal @expo/ui (Compose views)', {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const result = run('App.tsx', e2ePreset(t, 'android-phone'));
    const caps = new Set(result.capabilities);
    if (!caps.has('expoUI')) t.skip('host has no expoUI capability');
    const modifierEvents = caps.has('expoModifierEvents');
    const realLayout = modifierEvents && caps.has('expoUI.composeLayout');
    if (!modifierEvents) t.annotate('host without expoModifierEvents (step 1): modifier callbacks and frames not checked');
    else if (!realLayout) t.annotate('no expoUI.composeLayout: box assertions skipped');

    // Tree and layout labels.
    const host = findAll(result.final, n => n.type === 'ExpoUI.HostView')[0];
    expect(shape(host)).toStrictEqual({
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
    // Without the Compose engine (no expoUI.composeLayout, e.g. the Linux host:
    // its text adapter needs CoreText) the Host has no layout label.
    expect(host.layout).toBe(caps.has('expoUI.composeLayout') ? 'emulated' : undefined);
    const descendants = findAll(host, n => n !== host && n.type.startsWith('ExpoUI.'));
    expect(descendants.filter(n => n.layout !== 'emulated' && n.layout !== 'placeholder').map(n => n.key)).toStrictEqual([]);
    if (host.emulatedBy != null) expect(host.emulatedBy).toBe('compose');
    if (host.emulatedBy != null && realLayout) {
      expect(descendants.filter(n => n.layout !== 'emulated').map(n => n.key)).toStrictEqual([]);
    }

    // Roles: button, clickable Text, switch.
    const go = byKey(result.final, 'go');
    expect([go.role, go.name]).toStrictEqual(['button', 'Go']);
    expect(go.expo?.modifiers).toStrictEqual([{$type: 'testID', testID: 'go'}]);
    const greeting = byKey(result.final, 'greeting');
    expect([greeting.role, greeting.name, greeting.text]).toStrictEqual(['text', 'Hello', 'Hello']);
    expect((greeting.expo?.modifiers as Array<{$type: string}>).map(m => m.$type)).toContain('clickable');
    const remember = byKey(result.final, 'remember');
    expect(remember.role).toBe('switch');

    // Steps: Compose events chosen from the JS props.
    expect(result.steps[0].events).toStrictEqual(['buttonPressed']);
    expect(result.steps[1].events).toStrictEqual(['checkedChange']);
    expect(byKey(result.final, 'status').text).toBe('Pressed');
    expect(byKey(result.final, 'remember-state').text).toBe('Remember: off');
    expect(remember.a11y.state).toStrictEqual({checked: false});
    if (modifierEvents) {
      expect(result.steps[2].events).toStrictEqual(['modifier:clickable']);
      expect(byKey(result.final, 'taps').text).toBe('Taps: 1');
    } else {
      expect(String(result.steps[2].warnings)).toMatch(/no dispatchExpoModifierEvent/);
    }

    // Boxes (Compose M3 defaults): a 14sp Text is 16 dp high; Button and
    // Switch get the 48 dp minimum touch target.
    if (realLayout) {
      expect(host.box.height).toBeGreaterThan(0);
      expect(Math.abs(greeting.box.height - 16), `Text ${JSON.stringify(greeting.box)}`).toBeLessThanOrEqual(2);
      expect(Math.abs(go.box.width - 66), `Button ${JSON.stringify(go.box)}`).toBeLessThanOrEqual(1);
      expect(Math.abs(go.box.height - 48), `Button ${JSON.stringify(go.box)}`).toBeLessThanOrEqual(1);
      expect(Math.abs(remember.box.width - 52), `Switch ${JSON.stringify(remember.box)}`).toBeLessThanOrEqual(1);
      expect(Math.abs(remember.box.height - 48), `Switch ${JSON.stringify(remember.box)}`).toBeLessThanOrEqual(1);
    }
    expect(result.snapshots.after).toBeTruthy();
  });

  it.for([
    {preset: 'android-phone', file: 'SwiftUIScreen.tsx'},
    {preset: 'ios-phone', file: 'App.tsx'},
  ] as const)('[$preset] $file: @expo/ui/swift-ui (SwiftUI views)', {timeout: 180_000}, ({preset, file}, t) => {
    if (hostSkip) t.skip(hostSkip);
    const result = run(file, e2ePreset(t, preset));
    const caps = new Set(result.capabilities);
    if (!caps.has('expoUI')) t.skip('host has no expoUI capability');
    const modifierEvents = caps.has('expoModifierEvents');
    const realLayout = modifierEvents && caps.has('expoUI.swiftUILayout');
    if (!modifierEvents) t.annotate('host without expoModifierEvents (step 1): modifier callbacks and frames not checked');
    else if (!realLayout) t.annotate('no expoUI.swiftUILayout: box assertions skipped');

    // Tree, layout labels and modifiers.
    const host = findAll(result.final, n => n.type === 'ExpoUI.HostView')[0];
    expect(shape(host)).toStrictEqual({
      'ExpoUI.HostView': [{'ExpoUI.VStackView': ['ExpoUI.TextView', 'ExpoUI.Button', 'ExpoUI.ToggleView']}],
    });
    expect(host.layout).toBe('emulated');
    const descendants = findAll(host, n => n !== host && n.type.startsWith('ExpoUI.'));
    expect(descendants.filter(n => n.layout !== 'emulated' && n.layout !== 'placeholder').map(n => n.key)).toStrictEqual([]);
    if (host.emulatedBy != null) expect(host.emulatedBy).toBe('swiftui');
    if (host.emulatedBy != null && realLayout) {
      expect(descendants.filter(n => n.layout !== 'emulated').map(n => n.key)).toStrictEqual([]);
    }
    expect(host.children[0].expo?.modifiers).toStrictEqual([{$type: 'padding', all: 8}]);

    // Roles: text, button, toggle.
    const greeting = byKey(result.final, 'greeting');
    expect([greeting.role, greeting.name, greeting.text]).toStrictEqual(['text', 'Greeting', 'Hello']);
    const go = byKey(result.final, 'go');
    expect([go.role, go.name]).toStrictEqual(['button', 'Go']);
    expect(go.expo?.modifiers).toStrictEqual([{$type: 'frame', height: 44}]);
    const remember = byKey(result.final, 'remember');
    expect([remember.role, remember.name, remember.a11y.state]).toStrictEqual(['switch', 'Remember', {checked: false}]);

    // Steps: SwiftUI events; onTapGesture needs modifier events.
    expect(result.steps[0].events).toStrictEqual(['buttonPress']);
    expect(result.steps[1].events).toStrictEqual(['isOnChange']);
    expect(byKey(result.final, 'status').text).toBe('Pressed');
    expect(byKey(result.final, 'remember-state').text).toBe('Remember: off');
    if (modifierEvents) {
      expect(result.steps[2].events).toStrictEqual(['modifier:onTapGesture']);
      expect(byKey(result.final, 'taps').text).toBe('Taps: 1');
    } else {
      expect(String(result.steps[2].warnings)).toMatch(/no dispatchExpoModifierEvent/);
    }

    // Boxes: SwiftUI body text is 20.333 dp high.
    if (realLayout) {
      expect(host.box.height).toBeGreaterThan(0);
      expect(Math.abs(greeting.box.height - 20.333), `Text ${JSON.stringify(greeting.box)}`).toBeLessThanOrEqual(1);
    }
  });
});
