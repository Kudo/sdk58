import path from 'node:path';
import {describe, expect, it} from 'vitest';

import type {CheckResult} from '../src/check.ts';
import {cli, E2E_PRESETS, hostSkip, type Preset, ROOT} from './helpers.ts';

const EXAMPLE = path.join(ROOT, 'examples', 'basic');
const APP = path.join(EXAMPLE, 'App.tsx');

function check(args: string[], preset: Preset) {
  return cli(['check', APP, ...args], preset);
}

describe('check', () => {
  it.for(E2E_PRESETS)('[$name] check examples/basic with rules-fail.json and rules-pass.json', {timeout: 180_000}, (preset, t) => {
    if (hostSkip) t.skip(hostSkip);
    const fail = check(['--rules', path.join(EXAMPLE, 'rules-fail.json')], preset);
    expect(fail.status, fail.stderr).toBe(2);
    const failed = JSON.parse(fail.stdout) as CheckResult;
    expect(failed.ok).toBe(false);
    const violations = failed.violations.map(v => [v.rule, v.key, v.prop]);
    // TextInput 36.3 high, Switch 51x31 on both platforms: below the 48 dp target.
    expect(violations).toStrictEqual([
      ['touchTarget', 'email', 'height'],
      ['touchTarget', 'remember', 'height'],
      ['tokens', 'submit', 'backgroundColor'],
      ['contrast', 'submit/Paragraph:1', 'contrast'],
    ]);
    const contrast = failed.nodes.find(n => n.key === 'submit/Paragraph:1')!.props.contrast;
    expect([contrast.got, contrast.fg, contrast.bg, contrast.bgFrom, contrast.pass]).toStrictEqual([4.4, '#ffffff', '#1e6fff', 'host', false]);
    const email = failed.nodes.find(n => n.key === 'email')!.props;
    expect(email.name).toStrictEqual({rule: 'names', got: 'Email', want: 'non-empty', pass: true, from: 'placeholder'});

    const pass = check(['--rules', path.join(EXAMPLE, 'rules-pass.json')], preset);
    expect(pass.status, pass.stdout + pass.stderr).toBe(0);
    const passed = JSON.parse(pass.stdout) as CheckResult;
    expect(passed.ok).toBe(true);
    expect(passed.violations).toStrictEqual([]);
    expect(passed.summary.checked).toBeGreaterThanOrEqual(6);

    // With a script, the final tree is checked (the Submit tap adds `status`).
    const afterRun = check(
      ['--rules', path.join(EXAMPLE, 'rules-pass.json'), '--script', path.join(EXAMPLE, 'actions.json'), '--format', 'text'],
      preset,
    );
    expect(afterRun.status, afterRun.stdout + afterRun.stderr).toBe(0);
    expect(afterRun.stdout).toMatch(/^ok: 0 violation\(s\), \d+ of \d+ nodes checked$/m);
  });
});
