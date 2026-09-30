import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import os from 'node:os';

import type {RenderResult, RunResult} from '../src/schema.ts';

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

test('requires --platform and lists the known values', {timeout: 120_000}, () => {
  for (const extra of [[], ['--bundle-only']]) {
    const proc = spawnSync(process.execPath, [CLI, 'render', APP, ...extra], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST},
    });
    assert.equal(proc.status, 1);
    assert.equal(proc.stdout, '');
    assert.match(proc.stderr, /--platform <name> is required/);
    assert.match(proc.stderr, /android, ios, a11ytree/);
    assert.match(proc.stderr, /Any Metro platform name is accepted/);
    assert.match(proc.stderr, /Platform\.OS/);
  }
});

test('fails with a clear message when the host binary is missing', {timeout: 120_000}, () => {
  const proc = run(['render', APP, '--platform', 'android'], {RN_A11Y_HOST_BIN: '/nonexistent/rn-a11y-host'});
  assert.equal(proc.status, 5);
  const {error} = JSON.parse(proc.stderr.trim().split('\n').pop()!);
  assert.equal(error.code, 'HOST_MISSING');
  assert.match(error.message, /RN_A11Y_HOST_BIN points to a missing file/);
  assert.match(error.hint, /bun run build:host/);
  assert.equal(proc.stdout, '');
});

test('bundles with Metro and parses host stdout (fake host)', {timeout: 120_000}, () => {
  const proc = run(['render', APP, '--platform', 'android'], {RN_A11Y_HOST_BIN: FAKE_HOST});
  assert.equal(proc.status, 0, proc.stderr);
  const result = JSON.parse(proc.stdout) as RenderResult;
  assert.equal(result.root.box.width, 390);
  assert.equal(result.root.type, 'RootView');
  assert.equal(result.source, 'mounted');
});

test('parses a shadowTree payload (fake host)', {timeout: 120_000}, () => {
  const proc = run(['render', APP, '--platform', 'android', '--debug-props'], {
    RN_A11Y_HOST_BIN: FAKE_HOST,
    FAKE_HOST_MODE: 'shadow-tree',
  });
  assert.equal(proc.status, 0, proc.stderr);
  const result = JSON.parse(proc.stdout) as RenderResult;
  assert.equal(result.source, 'shadowTree');
  assert.equal(result.root.children[0].children.length, 6);
});

test('--debug-props is passed to the entry', {timeout: 120_000}, () => {
  for (const [flag, expected] of [[[], 'false'], [['--debug-props'], 'true']] as const) {
    const proc = run(['render', APP, '--platform', 'android', '--bundle-only', '--no-cache', ...flag], {});
    assert.equal(proc.status, 0, proc.stderr);
    const bundlePath = /Bundle: (.+) \(\d+ bytes/.exec(proc.stderr)![1];
    const code = fs.readFileSync(bundlePath, 'utf8');
    fs.rmSync(path.dirname(bundlePath), {recursive: true, force: true});
    assert.match(code, new RegExp(`includeDebugProps = ${expected}`));
    assert.ok(code.includes('getA11yTree'));
  }
});

test('reports JS errors from the host', {timeout: 120_000}, () => {
  const proc = run(['render', APP, '--platform', 'android'], {
    RN_A11Y_HOST_BIN: FAKE_HOST,
    FAKE_HOST_MODE: 'js-error',
  });
  assert.equal(proc.status, 4);
  const {error} = JSON.parse(proc.stderr.trim().split('\n').pop()!);
  assert.equal(error.code, 'APP_THREW');
  assert.match(error.message, /Render failed in JS: boom/);
  assert.match(error.details.stack, /at App/);
});

function writeScript(script: unknown): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-test-'));
  const file = path.join(dir, 'actions.json');
  fs.writeFileSync(file, typeof script === 'string' ? script : JSON.stringify(script));
  return file;
}

test('run: validates the script before bundling', {timeout: 120_000}, () => {
  const cases: Array<[unknown, RegExp]> = [
    [[{tap: {testID: 'submit'}}, {wait: 'soon'}], /step 1: wait: must be a number/],
    ['[not json', /is not valid JSON/],
  ];
  for (const [script, pattern] of cases) {
    const file = writeScript(script);
    const proc = run(['run', APP, '--platform', 'android', '--script', file], {
      RN_A11Y_HOST_BIN: FAKE_HOST,
    });
    fs.rmSync(path.dirname(file), {recursive: true, force: true});
    assert.equal(proc.status, 1);
    assert.match(proc.stderr, pattern);
    assert.doesNotMatch(proc.stderr, /Bundle:/);
    assert.equal(proc.stdout, '');
  }
  const missing = run(['run', APP, '--platform', 'android'], {RN_A11Y_HOST_BIN: FAKE_HOST});
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /--script <json> is required/);
  const badMode = run(
    ['run', APP, '--platform', 'android', '--script', 'x.json', '--tap-mode', 'swipe'],
    {RN_A11Y_HOST_BIN: FAKE_HOST},
  );
  assert.equal(badMode.status, 1);
  assert.match(badMode.stderr, /--tap-mode must be one of: touch, click, both/);
});

test('run: reports steps, snapshots and the final tree (fake host)', {timeout: 120_000}, () => {
  const file = writeScript([{tap: {testID: 'submit'}}, {tap: {testID: 'missing'}}, {snapshot: 'after'}]);
  const proc = run(['run', APP, '--platform', 'android', '--script', file, '--no-quiet'], {
    RN_A11Y_HOST_BIN: FAKE_HOST,
    FAKE_HOST_MODE: 'run',
  });
  fs.rmSync(path.dirname(file), {recursive: true, force: true});
  assert.equal(proc.status, 0, proc.stderr);
  const result = JSON.parse(proc.stdout) as RunResult;
  assert.equal(result.source, 'shadowTree');
  assert.equal(result.steps.length, 3);
  assert.equal(result.steps[0].target?.box?.y, 154); // rounded
  assert.equal(result.steps[0].hit?.type, 'Paragraph');
  assert.deepEqual(result.steps[1].error, {code: 'TARGET_NOT_FOUND', message: 'Target not found: {"testID":"missing"}'});
  assert.match(
    proc.stderr,
    /warning: JS fallbacks used because the host lacks native methods: events: js, hitTest: js/,
  );
  assert.equal(proc.stderr.match(/warning: JS fallbacks/g)?.length, 1);
  // Snapshots and final are converted with the same converter as `render`.
  assert.equal(result.snapshots.after.ref, 'n0');
  assert.equal(result.final.children[0].children[0].name, 'Sign in now');
});

test('run: the script and tap mode are embedded in the bundle', {timeout: 120_000}, () => {
  const file = writeScript([{wait: 5}]);
  const proc = run(
    ['run', APP, '--platform', 'android', '--script', file, '--tap-mode', 'both', '--bundle-only', '--no-cache'],
    {},
  );
  fs.rmSync(path.dirname(file), {recursive: true, force: true});
  assert.equal(proc.status, 0, proc.stderr);
  const bundlePath = /Bundle: (.+) \(\d+ bytes/.exec(proc.stderr)![1];
  const code = fs.readFileSync(bundlePath, 'utf8');
  fs.rmSync(path.dirname(bundlePath), {recursive: true, force: true});
  assert.match(code, /script = \[\{\s*"wait": 5\s*\}\]/);
  assert.match(code, /tapMode = "both"/);
});
