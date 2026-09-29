import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {RenderResult} from '../src/schema.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.js');

function run(args: string[], env: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...process.env, ...env},
    maxBuffer: 64 * 1024 * 1024,
  });
}

test('fails with a clear message when the host binary is missing', {timeout: 120_000}, () => {
  const proc = run(['render', APP], {RN_A11Y_HOST_BIN: '/nonexistent/rn-a11y-host'});
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /RN_A11Y_HOST_BIN points to a missing file/);
  assert.equal(proc.stdout, '');
});

test('bundles with Metro and parses host stdout (fake host)', {timeout: 120_000}, () => {
  const proc = run(['render', APP], {RN_A11Y_HOST_BIN: FAKE_HOST});
  assert.equal(proc.status, 0, proc.stderr);
  const result = JSON.parse(proc.stdout) as RenderResult;
  assert.equal(result.root.box.width, 390);
  assert.equal(result.root.type, 'RootView');
  assert.equal(result.source, 'mounted');
});

test('parses a shadowTree payload (fake host)', {timeout: 120_000}, () => {
  const proc = run(['render', APP, '--debug-props'], {
    RN_A11Y_HOST_BIN: FAKE_HOST,
    FAKE_HOST_MODE: 'shadow-tree',
  });
  assert.equal(proc.status, 0, proc.stderr);
  const result = JSON.parse(proc.stdout) as RenderResult;
  assert.equal(result.source, 'shadowTree');
  assert.equal(result.root.children[0].children.length, 5);
});

test('--debug-props is passed to the entry', {timeout: 120_000}, () => {
  for (const [flag, expected] of [[[], 'false'], [['--debug-props'], 'true']] as const) {
    const proc = run(['render', APP, '--bundle-only', ...flag], {});
    assert.equal(proc.status, 0, proc.stderr);
    const bundlePath = /Bundle: (.+) \(\d+ bytes\)/.exec(proc.stderr)![1];
    const code = fs.readFileSync(bundlePath, 'utf8');
    fs.rmSync(path.dirname(bundlePath), {recursive: true, force: true});
    assert.match(code, new RegExp(`includeDebugProps = ${expected}`));
    assert.ok(code.includes('getA11yTree'));
  }
});

test('reports JS errors from the host', {timeout: 120_000}, () => {
  const proc = run(['render', APP], {
    RN_A11Y_HOST_BIN: FAKE_HOST,
    FAKE_HOST_MODE: 'js-error',
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /Render failed in JS: boom/);
});
