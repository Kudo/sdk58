import path from 'node:path';
import {describe, expect, it} from 'vitest';

import type {RunResult, TreeNode} from '../src/schema.ts';
import {cli, E2E_PRESETS, get, hostSkip, isIOS, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'gestures', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'gestures', 'actions.json');

// RNGH's default pan activation distance (web/constants.ts DEFAULT_TOUCH_SLOP).
// RNGH resets the start point when the pan activates, so translationX is
// dx minus the distance moved before activation (<= slop + one step).
const TOUCH_SLOP = 15;

describe('gestures', () => {
  it.for(E2E_PRESETS)('[$name] run examples/gestures/actions.json', {timeout: 180_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const proc = cli(['run', APP, '--script', SCRIPT], preset);
    expect(proc.status, `CLI failed:\n${proc.stderr}`).toBe(0);
    const result = JSON.parse(proc.stdout) as RunResult;

    // Without the RNGH component descriptors the root view falls back to an
    // interop view with no size. On iOS GestureHandlerRootView is a plain
    // View (RNGestureHandlerRootView is an Android component).
    const rootType = isIOS(preset) ? 'View' : 'RNGestureHandlerRootView';
    const rootView = result.final.children.find(n => n.type === rootType);
    if (rootView == null) expect.unreachable(`the root has no ${rootType} child`);
    if (rootView.box.width === 0) {
      t.skip('host lacks react-native-gesture-handler support (RNGestureHandlerRootView has no size)');
    }

    for (const step of result.steps) {
      expect(step.error, `step ${step.index} failed: ${step.error}`).toBe(undefined);
    }
    const [tapStep, , panStep, , longStep, , rectStep] = result.steps;
    for (const step of [tapStep, panStep, longStep, rectStep]) {
      expect((step.gestureHandlers ?? 0) > 0, `step ${step.index} reached no gesture handler`).toBeTruthy();
    }
    const s = result.snapshots;

    expect(get(s['after-tap'], 'tap-out').text).toBe('tapped');

    const dx = get(s['after-pan'], 'drag').box.x - get(s['after-tap'], 'drag').box.x;
    expect(get(s['after-pan'], 'pos-out').text).toBe(`pos ${dx}`);
    expect(dx > 100 - 2 * TOUCH_SLOP && dx <= 100, `drag moved by ${dx}`).toBeTruthy();

    expect(get(s['after-long-press'], 'long-out').text).toBe('long-pressed');
    expect(get(s['after-rect'], 'rect-out').text).toBe('rect-pressed');

    // Worklet callbacks (Reanimated): the pan drives a shared value ->
    // useAnimatedStyle translateX; the layout box stays, visualBox moves.
    const uiPanStep = result.steps[8];
    expect((uiPanStep.gestureHandlers ?? 0) > 0, 'ui pan reached no gesture handler').toBeTruthy();
    const dragUi = get(s['after-ui-pan'], 'drag-ui');
    if (dragUi.visualBox == null) expect.unreachable('drag-ui has no visualBox after the pan');
    const uiDx = dragUi.visualBox.x - dragUi.box.x;
    expect(uiDx > 80 - 2 * TOUCH_SLOP && uiDx <= 80, `drag-ui moved by ${uiDx}`).toBeTruthy();
    // runOnJS from the tap worklet.
    expect(get(s['after-ui-tap'], 'ui-tap-out').text).toBe('ui-tapped');
  });
});
