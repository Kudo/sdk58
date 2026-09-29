import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {RunResult, TreeNode} from '../src/schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'basic', 'actions.json');

const DIST_BIN = path.join(ROOT, 'native', 'dist', process.arch === 'x64' ? 'x86_64' : process.arch, 'rn-a11y-host');
const hostBin = process.env.RN_A11Y_HOST_BIN || (fs.existsSync(DIST_BIN) ? DIST_BIN : undefined);

function findAll(node: TreeNode, pred: (n: TreeNode) => boolean): TreeNode[] {
  const out = pred(node) ? [node] : [];
  for (const child of node.children) out.push(...findAll(child, pred));
  return out;
}

test(
  'run examples/basic/actions.json',
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
    if (proc.status !== 0 && /no NativeFantom\.getA11yTree/.test(proc.stderr)) {
      t.skip('host has no getA11yTree; rebuild it with `yarn build:host`');
      return;
    }
    assert.equal(proc.status, 0, `CLI failed:\n${proc.stderr}`);
    const result = JSON.parse(proc.stdout) as RunResult;

    const hitErrors = result.steps.filter(s => s.error && /hitTest|hittable/.test(s.error));
    if (hitErrors.length > 0) {
      t.skip(`host cannot hit test: ${hitErrors[0].error}`);
      return;
    }

    assert.deepEqual(
      result.steps.map(s => s.action),
      ['type', 'tap', 'tap', 'snapshot'],
    );
    for (const step of result.steps) {
      assert.equal(step.error, undefined, `step ${step.index} failed: ${step.error}`);
      if (step.action !== 'snapshot') {
        assert.ok(step.hit, `step ${step.index} (${step.action}) has no hit`);
      }
    }
    assert.ok(result.snapshots['after-submit'], 'snapshot "after-submit" missing');

    const final = result.final;
    const [status] = findAll(final, n => n.testID === 'status');
    assert.ok(status, 'status node not found: Submit onPress did not fire');
    assert.equal(status.text, 'Submitted');

    const [echo] = findAll(final, n => n.testID === 'echo');
    assert.ok(echo, 'echo node not found: onChangeText did not fire');
    assert.equal(echo.text, 'a@b.c');

    // The Switch starts on (see App.tsx); the tap flips it.
    const [remember] = findAll(final, n => n.testID === 'remember');
    assert.equal(remember.a11y.state?.checked, false);
  },
);
