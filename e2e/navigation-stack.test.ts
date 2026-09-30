import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';

import type {RunResult, TreeNode} from '../src/schema.ts';
import {cliJson, E2E_PRESETS, findAll, hostSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'navigation-stack', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'navigation-stack', 'actions.json');

const byType = (root: TreeNode, type: string) => findAll(root, n => n.type === type);
const byTestID = (root: TreeNode, testID: string) => findAll(root, n => n.testID === testID)[0];

for (const preset of E2E_PRESETS) {
  test(`[${preset.name}] run examples/navigation-stack/actions.json`, {skip: hostSkip, timeout: 180_000}, t => {
    const result = cliJson<RunResult>(['run', APP, '--script', SCRIPT], preset);
    for (const step of result.steps) {
      assert.equal(step.error, undefined, `step ${step.index} failed: ${JSON.stringify(step.error)}`);
    }
    const {home, details, back} = result.snapshots;

    // Without native screens support the RNS* components come through a
    // fallback descriptor: no header title and no header height.
    const firstScreen = byType(home, 'RNSScreen')[0];
    if (firstScreen == null || firstScreen.box.width === 0) {
      t.skip('host lacks react-native-screens support (RNSScreen has no size)');
      return;
    }
    if (!byType(home, 'RNSScreenStackHeaderConfig').some(h => h.style.title === 'Home')) {
      t.skip('host lacks react-native-screens support (RNSScreenStackHeaderConfig has no title)');
      return;
    }

    // details: two screens in the stack; the top one fills the stack.
    const [stack] = byType(details, 'RNSScreenStack');
    assert.ok(stack, 'RNSScreenStack not found');
    assert.deepEqual(stack.box, {x: 0, y: 0, width: preset.width, height: preset.height});
    const screens = stack.children.filter(c => c.type === 'RNSScreen');
    assert.equal(screens.length, 2);
    assert.deepEqual(screens[1].box, stack.box);
    assert.equal(byTestID(screens[1], 'details-text').text, 'Details 42');

    // The top screen's native header: title "Details", below the status bar
    // (safe area top) and as high as the platform's bar (Android toolbar 56,
    // iOS navigation bar 44); the screen content starts below it.
    const header = screens[1].children.find(c => c.type === 'RNSScreenStackHeaderConfig');
    assert.ok(header, 'RNSScreenStackHeaderConfig not found in the second screen');
    assert.equal(header.style.title, 'Details');
    assert.equal(header.name, 'Details');
    assert.equal(header.role, null);
    const top = preset.safeAreaInsets.top;
    assert.deepEqual(header.box, {x: 0, y: top, width: preset.width, height: preset.headerHeight});
    const content = screens[1].children.find(c => c.type === 'RNSScreenContentWrapper');
    assert.ok(content, 'RNSScreenContentWrapper not found');
    assert.equal(content.box.y, top + preset.headerHeight);
    // The content area ends at the screen bottom.
    assert.equal(content.box.y + content.box.height, preset.height);
    assert.ok(byTestID(screens[1], 'details-text').box.y >= top + preset.headerHeight, 'content is not below the header');

    // back: one screen again, Home content visible.
    const [backStack] = byType(back, 'RNSScreenStack');
    assert.equal(backStack.children.filter(c => c.type === 'RNSScreen').length, 1);
    const goDetails = byTestID(back, 'go-details');
    assert.ok(goDetails, 'go-details not found after going back');
    assert.ok(goDetails.box.width > 0 && goDetails.box.height > 0);
  });
}
