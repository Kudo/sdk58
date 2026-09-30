import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {CheckResult} from '../src/check.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const EXAMPLE = path.join(ROOT, 'examples', 'basic');
const APP = path.join(EXAMPLE, 'App.tsx');

const DIST_BIN = path.join(ROOT, 'native', 'dist', process.arch === 'x64' ? 'x86_64' : process.arch, 'rn-a11y-host');
const hostBin = process.env.RN_A11Y_HOST_BIN || (fs.existsSync(DIST_BIN) ? DIST_BIN : undefined);

function check(args: string[]) {
  return spawnSync(process.execPath, [CLI, 'check', APP, '--platform', 'android', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...process.env, RN_A11Y_HOST_BIN: hostBin},
    maxBuffer: 64 * 1024 * 1024,
  });
}

test(
  'check examples/basic with rules-fail.json and rules-pass.json',
  {
    skip: hostBin
      ? false
      : `no host binary: run \`bun run build:host\` (creates ${path.relative(ROOT, DIST_BIN)}) or set RN_A11Y_HOST_BIN`,
    timeout: 180_000,
  },
  () => {
    const fail = check(['--rules', path.join(EXAMPLE, 'rules-fail.json')]);
    assert.equal(fail.status, 2, fail.stderr);
    const failed = JSON.parse(fail.stdout) as CheckResult;
    assert.equal(failed.ok, false);
    assert.deepEqual(
      failed.violations.map(v => [v.rule, v.key, v.prop]),
      [
        ['touchTarget', 'email', 'height'],
        ['touchTarget', 'remember', 'height'],
        ['tokens', 'submit', 'backgroundColor'],
        ['contrast', 'submit/Paragraph:1', 'contrast'],
      ],
    );
    const contrast = failed.nodes.find(n => n.key === 'submit/Paragraph:1')!.props.contrast;
    assert.deepEqual(
      [contrast.got, contrast.fg, contrast.bg, contrast.bgFrom, contrast.pass],
      [4.4, '#ffffff', '#1e6fff', 'host', false],
    );
    const email = failed.nodes.find(n => n.key === 'email')!.props;
    assert.deepEqual(email.name, {rule: 'names', got: 'Email', want: 'non-empty', pass: true, from: 'placeholder'});

    const pass = check(['--rules', path.join(EXAMPLE, 'rules-pass.json')]);
    assert.equal(pass.status, 0, pass.stdout + pass.stderr);
    const passed = JSON.parse(pass.stdout) as CheckResult;
    assert.equal(passed.ok, true);
    assert.deepEqual(passed.violations, []);
    assert.ok(passed.summary.checked >= 6);

    // With a script, the final tree is checked (the Submit tap adds `status`).
    const afterRun = check([
      '--rules',
      path.join(EXAMPLE, 'rules-pass.json'),
      '--script',
      path.join(EXAMPLE, 'actions.json'),
      '--format',
      'text',
    ]);
    assert.equal(afterRun.status, 0, afterRun.stdout + afterRun.stderr);
    assert.match(afterRun.stdout, /^ok: 0 violation\(s\), \d+ of \d+ nodes checked$/m);
  },
);
