import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {CliError, EXIT_CODES, logEntry, stepErrorCode} from '../packages/react-native-a11y-tree/src/errors.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree', 'src', 'cli.ts');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.ts');

function cli(args: string[], env: Record<string, string> = {}) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST, RN_A11Y_HOST_RUNNER: 'bun', ...env},
  });
}

const lastJson = (text: string) => JSON.parse(text.trim().split('\n').pop()!);

describe('errors', () => {
  it('exit code table and error JSON', () => {
    expect(Object.fromEntries(['USAGE', 'CHECK_FAILED', 'BUNDLE_FAILED', 'APP_THREW', 'HOST_MISSING', 'TIMEOUT'].map(c => [c, EXIT_CODES[c as keyof typeof EXIT_CODES]]))).toStrictEqual({USAGE: 1, CHECK_FAILED: 2, BUNDLE_FAILED: 3, APP_THREW: 4, HOST_MISSING: 5, TIMEOUT: 5});
    const e = new CliError('HOST_MISSING', 'no host', {hint: 'build it', details: {}});
    expect(e.toJSON()).toStrictEqual({code: 'HOST_MISSING', message: 'no host', hint: 'build it'});
  });

  it('step error codes and known console noise', () => {
    expect(stepErrorCode('Target not found: {"testID":"x"}')).toBe('TARGET_NOT_FOUND');
    expect(stepErrorCode('Nothing is hittable at (1, 2)')).toBe('TARGET_COVERED');
    expect(stepErrorCode('Exception in HostFunction: enqueueScrollEvent() can only be called on <ScrollView />')).toBe('APP_THREW');
    expect(logEntry('error', "[ReactNative Architecture][JS] 'getViewManagerConfig('RNCMaskedView')' is not available").known).toBe(true);
    expect(logEntry('warn', 'DrawerLayoutAndroid is deprecated and will be removed in a future release.').known).toBe(true);
    expect(logEntry('error', 'Warning: Each child in a list should have a unique "key" prop.').known).toBe(undefined);
  });

  it('CLI: usage errors (exit 1) as JSON on stderr; explicit --format json puts them on stdout', {timeout: 60_000}, () => {
    const unknown = cli(['render', APP, '--platform', 'android', '--bogus']);
    expect(unknown.status).toBe(1);
    expect(lastJson(unknown.stderr).error.code).toBe('USAGE');
    expect(lastJson(unknown.stderr).error.message).toMatch(/unknown option '--bogus'/);

    const missingFile = cli(['render', 'nope/App.tsx', '--platform', 'android', '--bundle-only']);
    expect(missingFile.status).toBe(1);
    expect(lastJson(missingFile.stderr).error.message).toMatch(/File not found/);

    const noPlatform = cli(['render', APP, '--format', 'json']);
    expect(noPlatform.status).toBe(1);
    const {error} = JSON.parse(noPlatform.stdout);
    expect(error.code).toBe('USAGE');
    expect(error.hint).toMatch(/--platform android/);
  });

  it('CLI: a bundle error exits 3 with BUNDLE_FAILED', {timeout: 120_000}, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-broken-'));
    const broken = path.join(dir, 'App.tsx');
    fs.writeFileSync(broken, "import {View} from 'react-native';\nimport Missing from './does-not-exist';\nexport default () => <View><Missing /></View>;\n");
    const proc = cli(['render', broken, '--platform', 'android', '--bundle-only']);
    fs.rmSync(dir, {recursive: true, force: true});
    expect(proc.status, proc.stderr).toBe(3);
    const {error} = lastJson(proc.stderr);
    expect(error.code).toBe('BUNDLE_FAILED');
    expect(error.message).toMatch(/does-not-exist/);
  });

  it('CLI: app console output goes into logs; quiet by default when piped', {timeout: 120_000}, () => {
    const proc = cli(['render', APP, '--platform', 'android'], {FAKE_HOST_MODE: 'shadow-tree'});
    expect(proc.status, proc.stderr).toBe(0);
    const plain = cli(['render', APP, '--platform', 'android']);
    expect(plain.status, plain.stderr).toBe(0);
    const result = JSON.parse(plain.stdout);
    expect(result.logs).toStrictEqual([{level: 'info', message: 'hello from JS'}]);
    expect(plain.stderr).not.toMatch(/\[console/);
  });
});
