import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {RunResult, TreeNode} from '../src/schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'navigation-stack', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'navigation-stack', 'actions.json');

const DIST_BIN = path.join(ROOT, 'native', 'dist', process.arch === 'x64' ? 'x86_64' : process.arch, 'rn-a11y-host');
const hostBin = process.env.RN_A11Y_HOST_BIN || (fs.existsSync(DIST_BIN) ? DIST_BIN : undefined);

function findAll(node: TreeNode, pred: (n: TreeNode) => boolean): TreeNode[] {
  const out = pred(node) ? [node] : [];
  for (const child of node.children) out.push(...findAll(child, pred));
  return out;
}

const byType = (root: TreeNode, type: string) => findAll(root, n => n.type === type);
const byTestID = (root: TreeNode, testID: string) => findAll(root, n => n.testID === testID)[0];

test(
  'run examples/navigation-stack/actions.json',
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
    for (const step of result.steps) {
      assert.equal(step.error, undefined, `step ${step.index} failed: ${step.error}`);
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
    const screens = stack.children.filter(c => c.type === 'RNSScreen');
    assert.equal(screens.length, 2);
    assert.deepEqual(screens[1].box, stack.box);
    assert.ok(byTestID(screens[1], 'details-text'), 'details-text is not in the second screen');
    assert.equal(byTestID(screens[1], 'details-text').text, 'Details 42');

    // The top screen's native header: title "Details", 56 dp (Android
    // toolbar) at the top; the screen content starts below it.
    const header = screens[1].children.find(c => c.type === 'RNSScreenStackHeaderConfig');
    assert.ok(header, 'RNSScreenStackHeaderConfig not found in the second screen');
    assert.equal(header.style.title, 'Details');
    assert.equal(header.name, 'Details');
    assert.equal(header.role, null);
    assert.deepEqual(header.box, {x: 0, y: 0, width: 390, height: 56});
    assert.ok(byTestID(screens[1], 'details-text').box.y >= 56, 'content is not below the header');

    // back: one screen again, Home content visible.
    const [backStack] = byType(back, 'RNSScreenStack');
    assert.equal(backStack.children.filter(c => c.type === 'RNSScreen').length, 1);
    const goDetails = byTestID(back, 'go-details');
    assert.ok(goDetails, 'go-details not found after going back');
    assert.ok(goDetails.box.width > 0 && goDetails.box.height > 0);
  },
);
