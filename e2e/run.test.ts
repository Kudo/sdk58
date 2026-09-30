import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';

import type {RunResult} from '../src/schema.ts';
import {cliJson, E2E_PRESETS, get, hostSkip, inputsSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'basic', 'actions.json');

for (const preset of E2E_PRESETS) {
  test(`[${preset.name}] run examples/basic/actions.json`, {skip: hostSkip, timeout: 180_000}, t => {
    const result = cliJson<RunResult>(['run', APP, '--script', SCRIPT], preset);
    // Typing needs the platform's TextInput shadow node (setTextInputTextByTag).
    const skipInputs = inputsSkip(preset);

    assert.deepEqual(
      result.steps.map(s => s.action),
      ['type', 'tap', 'tap', 'snapshot'],
    );
    for (const step of result.steps) {
      if (skipInputs && step.action === 'type') continue;
      assert.equal(step.error, undefined, `step ${step.index} failed: ${JSON.stringify(step.error)}`);
      assert.equal(step.warnings, undefined, `step ${step.index} warnings: ${step.warnings}`);
      if (step.action !== 'snapshot') {
        assert.ok(step.hit, `step ${step.index} (${step.action}) has no hit`);
      }
    }
    assert.ok(result.snapshots['after-submit'], 'snapshot "after-submit" missing');
    assert.equal(get(result.final, 'status').text, 'Submitted');
    // The Switch starts on (see App.tsx); the tap flips it.
    assert.equal(get(result.final, 'remember').a11y.state?.checked, false);

    if (skipInputs) {
      t.diagnostic(`typing not checked: ${skipInputs}`);
    } else {
      // With setTextInputTextByTag the input's own text is in the tree.
      if (!result.fallbacks.includes('text: not reflected')) {
        assert.equal(get(result.final, 'email').text, 'a@b.c');
      }
      assert.equal(get(result.final, 'echo').text, 'a@b.c'); // onChangeText fired
    }

    // --diff: each step reports what it changed, by stable key.
    const diffed = cliJson<RunResult>(['run', APP, '--script', SCRIPT, '--diff'], preset);
    if (!skipInputs) {
      assert.ok(diffed.steps[0].diff?.added.some(n => n.key === 'echo'), 'type step did not add echo');
      assert.ok(diffed.steps[0].diff?.changed.some(c => c.key === 'email' && c.after.text === 'a@b.c'));
    }
    assert.deepEqual(diffed.steps[1].diff?.changed.map(c => [c.key, c.after.state]), [['remember', {checked: false}]]);
    assert.deepEqual(diffed.steps[2].diff?.added.map(n => n.key), ['status']);
  });
}
