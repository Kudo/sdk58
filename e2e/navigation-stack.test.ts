import path from 'node:path';
import {describe, expect, it} from 'vitest';

import type {RunResult, TreeNode} from '../packages/react-native-a11y-tree/src/schema.ts';
import {cliJson, E2E_PRESETS, findAll, hostSkip, skipUnsupported, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'navigation-stack', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'navigation-stack', 'actions.json');

const byType = (root: TreeNode, type: string) => findAll(root, n => n.type === type);
const byTestID = (root: TreeNode, testID: string) => findAll(root, n => n.testID === testID)[0];

describe('navigation-stack', () => {
  it.for(E2E_PRESETS)('[$name] run examples/navigation-stack/actions.json', {timeout: 180_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const result = cliJson<RunResult>(['run', APP, '--script', SCRIPT], preset);
    for (const step of result.steps) {
      expect(step.error, `step ${step.index} failed: ${JSON.stringify(step.error)}`).toBe(undefined);
    }
    const {home, details, back} = result.snapshots;

    // Without native screens support the RNS* components come through a
    // fallback descriptor: no header title and no header height.
    const firstScreen = byType(home, 'RNSScreen')[0];
    if (firstScreen == null || firstScreen.box.width === 0) {
      skipUnsupported(t, 'host lacks react-native-screens support (RNSScreen has no size)');
    }
    if (!byType(home, 'RNSScreenStackHeaderConfig').some(h => h.style.title === 'Home')) {
      skipUnsupported(t, 'host lacks react-native-screens support (RNSScreenStackHeaderConfig has no title)');
    }

    // details: two screens in the stack; the top one fills the stack.
    const [stack] = byType(details, 'RNSScreenStack');
    expect(stack, 'RNSScreenStack not found').toBeTruthy();
    expect(stack.box).toStrictEqual({x: 0, y: 0, width: preset.width, height: preset.height});
    const screens = stack.children.filter(c => c.type === 'RNSScreen');
    expect(screens.length).toBe(2);
    expect(screens[1].box).toStrictEqual(stack.box);
    expect(byTestID(screens[1], 'details-text').text).toBe('Details 42');

    // The top screen's native header: title "Details", below the status bar
    // (safe area top) and as high as the platform's bar (Android toolbar 56,
    // iOS navigation bar 44); the screen content starts below it.
    const header = screens[1].children.find(c => c.type === 'RNSScreenStackHeaderConfig');
    if (header == null) expect.unreachable('RNSScreenStackHeaderConfig not found in the second screen');
    expect(header.style.title).toBe('Details');
    expect(header.name).toBe('Details');
    expect(header.role).toBe(null);
    const top = preset.safeAreaInsets.top;
    expect(header.box).toStrictEqual({x: 0, y: top, width: preset.width, height: preset.headerHeight});
    const content = screens[1].children.find(c => c.type === 'RNSScreenContentWrapper');
    if (content == null) expect.unreachable('RNSScreenContentWrapper not found');
    expect(content.box.y).toBe(top + preset.headerHeight);
    // The content area ends at the screen bottom.
    expect(content.box.y + content.box.height).toBe(preset.height);
    expect(byTestID(screens[1], 'details-text').box.y >= top + preset.headerHeight, 'content is not below the header').toBeTruthy();

    // back: one screen again, Home content visible.
    const [backStack] = byType(back, 'RNSScreenStack');
    expect(backStack.children.filter(c => c.type === 'RNSScreen').length).toBe(1);
    const goDetails = byTestID(back, 'go-details');
    expect(goDetails, 'go-details not found after going back').toBeTruthy();
    expect(goDetails.box.width > 0 && goDetails.box.height > 0).toBeTruthy();
  });
});
