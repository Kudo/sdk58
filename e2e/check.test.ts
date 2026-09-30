import assert from 'node:assert/strict';
import path from 'node:path';
import {test} from 'node:test';

import type {CheckResult} from '../src/check.ts';
import {cli, E2E_PRESETS, hostSkip, type Preset, ROOT} from './helpers.ts';

const EXAMPLE = path.join(ROOT, 'examples', 'basic');
const APP = path.join(EXAMPLE, 'App.tsx');

function check(args: string[], preset: Preset) {
  return cli(['check', APP, ...args], preset);
}

for (const preset of E2E_PRESETS) {
  test(`[${preset.name}] check examples/basic with rules-fail.json and rules-pass.json`, {skip: hostSkip, timeout: 180_000}, () => {
    const fail = check(['--rules', path.join(EXAMPLE, 'rules-fail.json')], preset);
    assert.equal(fail.status, 2, fail.stderr);
    const failed = JSON.parse(fail.stdout) as CheckResult;
    assert.equal(failed.ok, false);
    const violations = failed.violations.map(v => [v.rule, v.key, v.prop]);
    // TextInput 36.3 high, Switch 51x31 on both platforms: below the 48 dp target.
    assert.deepEqual(violations, [
      ['touchTarget', 'email', 'height'],
      ['touchTarget', 'remember', 'height'],
      ['tokens', 'submit', 'backgroundColor'],
      ['contrast', 'submit/Paragraph:1', 'contrast'],
    ]);
    const contrast = failed.nodes.find(n => n.key === 'submit/Paragraph:1')!.props.contrast;
    assert.deepEqual(
      [contrast.got, contrast.fg, contrast.bg, contrast.bgFrom, contrast.pass],
      [4.4, '#ffffff', '#1e6fff', 'host', false],
    );
    const email = failed.nodes.find(n => n.key === 'email')!.props;
    assert.deepEqual(email.name, {rule: 'names', got: 'Email', want: 'non-empty', pass: true, from: 'placeholder'});

    const pass = check(['--rules', path.join(EXAMPLE, 'rules-pass.json')], preset);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    const passed = JSON.parse(pass.stdout) as CheckResult;
    assert.equal(passed.ok, true);
    assert.deepEqual(passed.violations, []);
    assert.ok(passed.summary.checked >= 6);

    // With a script, the final tree is checked (the Submit tap adds `status`).
    const afterRun = check(
      ['--rules', path.join(EXAMPLE, 'rules-pass.json'), '--script', path.join(EXAMPLE, 'actions.json'), '--format', 'text'],
      preset,
    );
    assert.equal(afterRun.status, 0, afterRun.stdout + afterRun.stderr);
    assert.match(afterRun.stdout, /^ok: 0 violation\(s\), \d+ of \d+ nodes checked$/m);
  });
}
