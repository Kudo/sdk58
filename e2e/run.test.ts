import path from 'node:path';
import {describe, expect, it} from 'vitest';

import type {RunResult} from '../src/schema.ts';
import {cliJson, E2E_PRESETS, get, hostSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const SCRIPT = path.join(ROOT, 'examples', 'basic', 'actions.json');

describe('run', () => {
  it.for(E2E_PRESETS)('[$name] run examples/basic/actions.json', {timeout: 180_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const result = cliJson<RunResult>(['run', APP, '--script', SCRIPT], preset);

    expect(result.steps.map(s => s.action)).toStrictEqual(['type', 'tap', 'tap', 'snapshot']);
    for (const step of result.steps) {
      expect(step.error, `step ${step.index} failed: ${JSON.stringify(step.error)}`).toBe(undefined);
      expect(step.warnings, `step ${step.index} warnings: ${step.warnings}`).toBe(undefined);
      if (step.action !== 'snapshot') {
        expect(step.hit, `step ${step.index} (${step.action}) has no hit`).toBeTruthy();
      }
    }
    expect(result.snapshots['after-submit'], 'snapshot "after-submit" missing').toBeTruthy();
    expect(get(result.final, 'status').text).toBe('Submitted');
    // The Switch starts on (see App.tsx); the tap flips it.
    expect(get(result.final, 'remember').a11y.state?.checked).toBe(false);

    // setTextInputTextByTag: the input's own text is in the tree.
    expect(result.fallbacks).toStrictEqual([]);
    expect(get(result.final, 'email').text).toBe('a@b.c');
    expect(get(result.final, 'echo').text).toBe('a@b.c'); // onChangeText fired

    // --diff: each step reports what it changed, by stable key.
    const diffed = cliJson<RunResult>(['run', APP, '--script', SCRIPT, '--diff'], preset);
    expect(diffed.steps[0].diff?.added.some(n => n.key === 'echo'), 'type step did not add echo').toBeTruthy();
    expect(diffed.steps[0].diff?.changed.some(c => c.key === 'email' && c.after.text === 'a@b.c')).toBeTruthy();
    expect(diffed.steps[1].diff?.changed.map(c => [c.key, c.after.state])).toStrictEqual([['remember', {checked: false}]]);
    expect(diffed.steps[2].diff?.added.map(n => n.key)).toStrictEqual(['status']);
  });
});
