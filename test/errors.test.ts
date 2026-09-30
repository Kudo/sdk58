import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {CliError, EXIT_CODES, logEntry, stepErrorCode} from '../src/errors.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.js');

function cli(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST, ...env},
  });
}

const lastJson = (text: string) => JSON.parse(text.trim().split('\n').pop()!);

test('exit code table and error JSON', () => {
  assert.deepEqual(
    Object.fromEntries(['USAGE', 'CHECK_FAILED', 'BUNDLE_FAILED', 'APP_THREW', 'HOST_MISSING', 'TIMEOUT'].map(c => [c, EXIT_CODES[c as keyof typeof EXIT_CODES]])),
    {USAGE: 1, CHECK_FAILED: 2, BUNDLE_FAILED: 3, APP_THREW: 4, HOST_MISSING: 5, TIMEOUT: 5},
  );
  const e = new CliError('HOST_MISSING', 'no host', {hint: 'build it', details: {}});
  assert.deepEqual(e.toJSON(), {code: 'HOST_MISSING', message: 'no host', hint: 'build it'});
});

test('step error codes and known console noise', () => {
  assert.equal(stepErrorCode('Target not found: {"testID":"x"}'), 'TARGET_NOT_FOUND');
  assert.equal(stepErrorCode('Nothing is hittable at (1, 2)'), 'TARGET_COVERED');
  assert.equal(stepErrorCode('Exception in HostFunction: enqueueScrollEvent() can only be called on <ScrollView />'), 'APP_THREW');
  assert.equal(logEntry('error', "[ReactNative Architecture][JS] 'getViewManagerConfig('RNCMaskedView')' is not available").known, true);
  assert.equal(logEntry('warn', 'DrawerLayoutAndroid is deprecated and will be removed in a future release.').known, true);
  assert.equal(logEntry('error', 'Warning: Each child in a list should have a unique "key" prop.').known, undefined);
});

test('CLI: usage errors (exit 1) as JSON on stderr; explicit --format json puts them on stdout', {timeout: 60_000}, () => {
  const unknown = cli(['render', APP, '--platform', 'android', '--bogus']);
  assert.equal(unknown.status, 1);
  assert.equal(lastJson(unknown.stderr).error.code, 'USAGE');
  assert.match(lastJson(unknown.stderr).error.message, /unknown option '--bogus'/);

  const missingFile = cli(['render', 'nope/App.tsx', '--platform', 'android', '--bundle-only']);
  assert.equal(missingFile.status, 1);
  assert.match(lastJson(missingFile.stderr).error.message, /File not found/);

  const noPlatform = cli(['render', APP, '--format', 'json']);
  assert.equal(noPlatform.status, 1);
  const {error} = JSON.parse(noPlatform.stdout);
  assert.equal(error.code, 'USAGE');
  assert.match(error.hint, /--platform android/);
});

test('CLI: a bundle error exits 3 with BUNDLE_FAILED', {timeout: 120_000}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-broken-'));
  const broken = path.join(dir, 'App.tsx');
  fs.writeFileSync(broken, "import {View} from 'react-native';\nimport Missing from './does-not-exist';\nexport default () => <View><Missing /></View>;\n");
  const proc = cli(['render', broken, '--platform', 'android', '--bundle-only']);
  fs.rmSync(dir, {recursive: true, force: true});
  assert.equal(proc.status, 3, proc.stderr);
  const {error} = lastJson(proc.stderr);
  assert.equal(error.code, 'BUNDLE_FAILED');
  assert.match(error.message, /does-not-exist/);
});

test('CLI: app console output goes into logs; quiet by default when piped', {timeout: 120_000}, () => {
  const proc = cli(['render', APP, '--platform', 'android'], {FAKE_HOST_MODE: 'shadow-tree'});
  assert.equal(proc.status, 0, proc.stderr);
  const plain = cli(['render', APP, '--platform', 'android']);
  assert.equal(plain.status, 0, plain.stderr);
  const result = JSON.parse(plain.stdout);
  assert.deepEqual(result.logs, [{level: 'info', message: 'hello from JS'}]);
  assert.doesNotMatch(plain.stderr, /\[console/);
});
