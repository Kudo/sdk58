import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'vitest';

import type {RunResult, TreeNode} from '../src/schema.ts';
import {cli, E2E_PRESETS, get, hostSkip, isIOS, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'gestures', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'gestures', 'actions.json');

// RNGH's default pan activation distance (web/constants.ts DEFAULT_TOUCH_SLOP).
// RNGH resets the start point when the pan activates, so translationX is
// dx minus the distance moved before activation (<= slop + one step).
const TOUCH_SLOP = 15;

for (const preset of E2E_PRESETS) {
  test(`[${preset.name}] run examples/gestures/actions.json`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const proc = cli(['run', APP, '--script', SCRIPT], preset);
    assert.equal(proc.status, 0, `CLI failed:\n${proc.stderr}`);
    const result = JSON.parse(proc.stdout) as RunResult;

    // Without the RNGH component descriptors the root view falls back to an
    // interop view with no size. On iOS GestureHandlerRootView is a plain
    // View (RNGestureHandlerRootView is an Android component).
    const rootType = isIOS(preset) ? 'View' : 'RNGestureHandlerRootView';
    const rootView = result.final.children.find(n => n.type === rootType);
    assert.ok(rootView, `the root has no ${rootType} child`);
    if (rootView.box.width === 0) {
      t.skip('host lacks react-native-gesture-handler support (RNGestureHandlerRootView has no size)');
    }

    for (const step of result.steps) {
      assert.equal(step.error, undefined, `step ${step.index} failed: ${step.error}`);
    }
    const [tapStep, , panStep, , longStep, , rectStep] = result.steps;
    for (const step of [tapStep, panStep, longStep, rectStep]) {
      assert.ok((step.gestureHandlers ?? 0) > 0, `step ${step.index} reached no gesture handler`);
    }
    const s = result.snapshots;

    assert.equal(get(s['after-tap'], 'tap-out').text, 'tapped');

    const dx = get(s['after-pan'], 'drag').box.x - get(s['after-tap'], 'drag').box.x;
    assert.equal(get(s['after-pan'], 'pos-out').text, `pos ${dx}`);
    assert.ok(dx > 100 - 2 * TOUCH_SLOP && dx <= 100, `drag moved by ${dx}`);

    assert.equal(get(s['after-long-press'], 'long-out').text, 'long-pressed');
    assert.equal(get(s['after-rect'], 'rect-out').text, 'rect-pressed');

    // Worklet callbacks (Reanimated): the pan drives a shared value ->
    // useAnimatedStyle translateX; the layout box stays, visualBox moves.
    const uiPanStep = result.steps[8];
    assert.ok((uiPanStep.gestureHandlers ?? 0) > 0, 'ui pan reached no gesture handler');
    const dragUi = get(s['after-ui-pan'], 'drag-ui');
    assert.ok(dragUi.visualBox, 'drag-ui has no visualBox after the pan');
    const uiDx = dragUi.visualBox.x - dragUi.box.x;
    assert.ok(uiDx > 80 - 2 * TOUCH_SLOP && uiDx <= 80, `drag-ui moved by ${uiDx}`);
    // runOnJS from the tap worklet.
    assert.equal(get(s['after-ui-tap'], 'ui-tap-out').text, 'ui-tapped');
  });
}
