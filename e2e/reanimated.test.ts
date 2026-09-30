import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {RunResult, TreeNode} from '../src/schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'reanimated', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'reanimated', 'actions.json');

const DIST_BIN = path.join(ROOT, 'native', 'dist', process.arch === 'x64' ? 'x86_64' : process.arch, 'rn-a11y-host');
const hostBin = process.env.RN_A11Y_HOST_BIN || (fs.existsSync(DIST_BIN) ? DIST_BIN : undefined);

// Signs that the host has no worklets/reanimated native side. Today the app
// fails at import with "Cannot read property 'loadUnpackersWithCode' of
// undefined" in NativeWorklets/installUnpackers (globalThis.__workletsModuleProxy
// is not installed).
const NO_REANIMATED =
  /__workletsModuleProxy|WorkletsModule|ReanimatedModule|NativeWorklets|installUnpackers|loadUnpackersWith|Worklets|Reanimated/;

function find(node: TreeNode, testID: string): TreeNode | undefined {
  if (node.testID === testID) return node;
  for (const child of node.children) {
    const found = find(child, testID);
    if (found) return found;
  }
  return undefined;
}

function get(snapshot: TreeNode, testID: string): TreeNode {
  const node = find(snapshot, testID);
  assert.ok(node, `${testID} not found`);
  return node;
}

test(
  'run examples/reanimated/actions.json',
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
    if (proc.status !== 0) {
      if (NO_REANIMATED.test(proc.stderr)) {
        const first = proc.stderr.split('\n').find(l => l.startsWith('rn-a11y-tree:')) ?? '';
        t.skip(`host lacks reanimated support (${first.replace(/^rn-a11y-tree: /, '')})`);
        return;
      }
      assert.fail(`CLI failed:\n${proc.stderr}`);
    }
    const result = JSON.parse(proc.stdout) as RunResult;
    const stepErrors = result.steps.filter(s => s.error);
    const errorText = (e: unknown) => (typeof e === 'string' ? e : ((e as {message?: string})?.message ?? ''));
    if (stepErrors.some(s => NO_REANIMATED.test(errorText(s.error)))) {
      t.skip(`host lacks reanimated support (${errorText(stepErrors[0].error)})`);
      return;
    }
    assert.deepEqual(stepErrors, []);
    const s = result.snapshots;

    // withTiming(250, {duration: 400}) on width.
    assert.ok(Math.abs(get(s.start, 'box').box.width - 50) <= 0.5);
    const midWidth = get(s.mid, 'box').box.width;
    assert.ok(midWidth > 50 && midWidth < 250, `mid width ${midWidth}`);
    assert.ok(Math.abs(get(s.end, 'box').box.width - 250) <= 0.5);

    // withSpring(120) on translateX. The layout box does not move; the
    // transform shows in visualBox.
    const slid = get(s.slid, 'slide');
    assert.equal(slid.box.x, get(s.end, 'slide').box.x);
    assert.ok(slid.visualBox, 'slide has no visualBox after the spring');
    const dx = slid.visualBox.x - slid.box.x;
    assert.ok(Math.abs(dx - 120) <= 1, `slide moved by ${dx}`);

    // FadeIn.duration(300) entering animation. It only changes the mounted
    // view, so this needs the host's mounted-view overrides in getA11yTree.
    const opacity = (node: TreeNode) => node.effectiveOpacity ?? 1;
    if (result.capabilities.includes('getA11yTree.mounted')) {
      assert.ok(opacity(get(s['fade-start'], 'fade')) < 1, 'fade is fully opaque at fade-start');
    } else {
      t.diagnostic('fade-start opacity not checked: host lacks getA11yTree.mounted');
    }
    assert.equal(opacity(get(s['fade-end'], 'fade')), 1);

    // runOnUI -> runOnJS roundtrip.
    assert.equal(get(s.ui, 'label').text, 'from-ui');
  },
);
