import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {RunResult, TreeNode} from '../src/schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'scrolling', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'scrolling', 'actions.json');

const DIST_BIN = path.join(ROOT, 'native', 'dist', process.arch === 'x64' ? 'x86_64' : process.arch, 'rn-a11y-host');
const hostBin = process.env.RN_A11Y_HOST_BIN || (fs.existsSync(DIST_BIN) ? DIST_BIN : undefined);

function find(node: TreeNode, testID: string): TreeNode | undefined {
  if (node.testID === testID) return node;
  for (const child of node.children) {
    const found = find(child, testID);
    if (found) return found;
  }
  return undefined;
}

function refs(node: TreeNode): string[] {
  return [node.ref, ...node.children.flatMap(refs)];
}

test(
  'run examples/scrolling/actions.json',
  {
    skip: hostBin
      ? false
      : `no host binary: run \`yarn build:host\` (creates ${path.relative(ROOT, DIST_BIN)}) or set RN_A11Y_HOST_BIN`,
    timeout: 180_000,
  },
  () => {
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
    const {before, after} = result.snapshots;
    const flatAfter = result.snapshots['flat-after'];

    // onScroll received the offset.
    assert.equal(find(after, 'offset')?.text, 'offset 600');

    // The ScrollView reports its scroll position, and its rows move up by it.
    assert.deepEqual(find(before, 'list')?.style.contentOffset, {x: 0, y: 0});
    assert.deepEqual(find(after, 'list')?.style.contentOffset, {x: 0, y: 600});
    assert.equal(find(after, 'row-0')!.box.y, find(before, 'row-0')!.box.y - 600);

    // The tap at row-12's on-screen center lands inside row-12.
    const tap = result.steps.find(s => s.action === 'tap')!;
    assert.equal(tap.target?.testID, 'row-12');
    assert.equal(tap.warnings, undefined, `tap warnings: ${tap.warnings}`);
    assert.ok(tap.hit?.ref != null && refs(find(after, 'row-12')!).includes(tap.hit.ref),
      `hit ${JSON.stringify(tap.hit)} is not inside row-12`);
    assert.equal(find(result.snapshots['after-tap'], 'selected')?.text, 'row 12');

    // FlatList renders rows beyond the initial window after scrolling.
    assert.equal(find(before, 'flat-row-50'), undefined);
    assert.ok(find(flatAfter, 'flat-row-50'), 'flat-row-50 not rendered after scrolling');
  },
);
