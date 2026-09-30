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
      assert.equal(step.warnings, undefined, `step ${step.index} warnings: ${step.warnings}`);
      if (step.action !== 'snapshot') {
        assert.ok(step.hit, `step ${step.index} (${step.action}) has no hit`);
      }
    }
    assert.ok(result.snapshots['after-submit'], 'snapshot "after-submit" missing');

    const final = result.final;
    const [status] = findAll(final, n => n.testID === 'status');
    assert.ok(status, 'status node not found: Submit onPress did not fire');
    assert.equal(status.text, 'Submitted');

    // With setTextInputTextByTag the input's own text is in the tree.
    if (!result.fallbacks.includes('text: not reflected')) {
      const [email] = findAll(final, n => n.testID === 'email');
      assert.equal(email.text, 'a@b.c');
    }

    const [echo] = findAll(final, n => n.testID === 'echo');
    assert.ok(echo, 'echo node not found: onChangeText did not fire');
    assert.equal(echo.text, 'a@b.c');

    // --diff: each step reports what it changed, by stable key.
    const withDiff = spawnSync(
      process.execPath,
      [CLI, 'run', APP, '--platform', 'android', '--script', SCRIPT, '--diff'],
      {cwd: ROOT, encoding: 'utf8', env: {...process.env, RN_A11Y_HOST_BIN: hostBin}, maxBuffer: 64 * 1024 * 1024},
    );
    assert.equal(withDiff.status, 0, withDiff.stderr);
    const diffed = JSON.parse(withDiff.stdout) as RunResult;
    assert.ok(diffed.steps[0].diff?.added.some(n => n.key === 'echo'), 'type step did not add echo');
    assert.ok(diffed.steps[0].diff?.changed.some(c => c.key === 'email' && c.after.text === 'a@b.c'));
    assert.deepEqual(diffed.steps[1].diff?.changed.map(c => [c.key, c.after.state]), [['remember', {checked: false}]]);
    assert.deepEqual(diffed.steps[2].diff?.added.map(n => n.key), ['status']);

    // The Switch starts on (see App.tsx); the tap flips it.
    const [remember] = findAll(final, n => n.testID === 'remember');
    assert.equal(remember.a11y.state?.checked, false);
  },
);
