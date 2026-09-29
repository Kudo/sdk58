import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {RunResult, TreeNode} from '../src/schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'gestures', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'gestures', 'actions.json');

const DIST_BIN = path.join(ROOT, 'native', 'dist', process.arch === 'x64' ? 'x86_64' : process.arch, 'rn-a11y-host');
const hostBin = process.env.RN_A11Y_HOST_BIN || (fs.existsSync(DIST_BIN) ? DIST_BIN : undefined);

// RNGH's default pan activation distance (web/constants.ts DEFAULT_TOUCH_SLOP).
// RNGH resets the start point when the pan activates, so translationX is
// dx minus the distance moved before activation (<= slop + one step).
const TOUCH_SLOP = 15;

function findAll(node: TreeNode, pred: (n: TreeNode) => boolean): TreeNode[] {
  const out = pred(node) ? [node] : [];
  for (const child of node.children) out.push(...findAll(child, pred));
  return out;
}
const get = (root: TreeNode, testID: string) => {
  const node = findAll(root, n => n.testID === testID)[0];
  assert.ok(node, `${testID} not found`);
  return node;
};

test(
  'run examples/gestures/actions.json',
  {
    skip: hostBin
      ? false
      : `no host binary: run \`yarn build:host\` (creates ${path.relative(ROOT, DIST_BIN)}) or set RN_A11Y_HOST_BIN`,
    timeout: 180_000,
  },
  t => {
    const proc = spawnSync(
      process.execPath,
      [CLI, 'run', APP, '--platform', 'android', '--script', SCRIPT],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {...process.env, RN_A11Y_HOST_BIN: hostBin},
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    assert.equal(proc.status, 0, `CLI failed:\n${proc.stderr}`);
    const result = JSON.parse(proc.stdout) as RunResult;

    // Without the RNGH component descriptors the root view falls back to an
    // interop view with no size.
    const rootView = findAll(result.final, n => n.type === 'RNGestureHandlerRootView')[0];
    if (rootView == null || rootView.box.width === 0) {
      t.skip('host lacks react-native-gesture-handler support (RNGestureHandlerRootView has no size)');
      return;
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
  },
);
