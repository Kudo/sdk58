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

/** All strings a header node exposes: its props (style), a11y, text, and descendant text. */
function headerStrings(header: TreeNode): string[] {
  const out: string[] = [];
  for (const n of findAll(header, () => true)) {
    for (const value of [n.text, n.name, ...Object.values(n.style), ...Object.values(n.a11y.raw ?? {})]) {
      if (typeof value === 'string') out.push(value);
    }
  }
  return out;
}

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

    // Without native screens support the RNS* components come through the
    // legacy interop layer: screens have no size and headers expose no title.
    const firstScreen = byType(home, 'RNSScreen')[0];
    const detailsHeaders = byType(details, 'RNSScreenStackHeaderConfig');
    if (firstScreen == null || firstScreen.box.width === 0) {
      t.skip('host lacks react-native-screens support (RNSScreen has no size)');
      return;
    }
    if (!detailsHeaders.some(h => headerStrings(h).includes('Details'))) {
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

    // back: one screen again, Home content visible.
    const [backStack] = byType(back, 'RNSScreenStack');
    assert.equal(backStack.children.filter(c => c.type === 'RNSScreen').length, 1);
    const goDetails = byTestID(back, 'go-details');
    assert.ok(goDetails, 'go-details not found after going back');
    assert.ok(goDetails.box.width > 0 && goDetails.box.height > 0);
  },
);
