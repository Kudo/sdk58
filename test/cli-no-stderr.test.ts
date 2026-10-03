import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {expect, it} from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree/src/cli.ts');
const APP = path.join(ROOT, 'examples/basic/App.tsx');
function cli(args: string[], input = '', env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [CLI, ...args], {cwd: ROOT, encoding: 'utf8', input, timeout: 90_000,
    env: {...process.env, RN_A11Y_HOST_BIN: path.join(ROOT, 'test/fixtures/fake-host.ts'), RN_A11Y_HOST_RUNNER: 'bun', ...env}});
}

it('suppresses usage failures before argument validation, preserving JSON and one-line NDJSON errors', () => {
  for (const format of ['json', 'ndjson']) {
    for (const prefix of [[], ['--no-stderr']]) {
      const result = cli([...prefix, 'render', APP, '--timeout', 'invalid', '--format', format, '--no-stderr']);
      expect(result.status).toBe(1);
      expect(result.stderr).toBe('');
      expect(JSON.parse(result.stdout).error.code).toBe('USAGE');
      if (format === 'ndjson') expect(result.stdout.trim().split('\n')).toHaveLength(1);
    }
  }
  const defaultOutput = cli(['render', APP, '--timeout', 'invalid']);
  expect(defaultOutput.status).toBe(1);
  expect(defaultOutput.stderr).toContain('USAGE');
  const ndjson = cli(['render', APP, '--timeout', 'invalid', '--format', 'ndjson']);
  expect(ndjson.status).toBe(1);
  expect(JSON.parse(ndjson.stdout).error.code).toBe('USAGE');
  const global = cli(['--no-stderr', 'render', APP, '--format=json']);
  expect(global.status).toBe(1);
  expect(global.stderr).toBe('');
  expect(JSON.parse(global.stdout).error.code).toBe('USAGE');
  const unknown = cli(['unknown-command', '--no-stderr', '--format=ndjson']);
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toBe('');
  expect(JSON.parse(unknown.stdout).error.code).toBe('USAGE');
});

it('does not interpret required option values or operands after -- as flags', () => {
  for (const args of [
    ['--subtree', '--no-stderr'], ['--subtree=--no-stderr'],
    ['--', '--no-stderr'], ['--subtree', '--format=json'],
  ]) {
    const result = cli(['render', APP, ...args]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('USAGE');
    expect(result.stdout).toBe('');
  }
});

it('advertises suppression in root and subcommand help', () => {
  for (const command of ['', 'render', 'run', 'check', 'session', 'doctor', 'schema']) {
    const result = cli([...(command ? [command] : []), '--help']);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('--no-stderr');
  }
});

it('preserves APP_THREW and suppresses verbose/timing output', () => {
  for (const format of ['json', 'ndjson']) {
    const result = cli(['render', APP, '--platform', 'android', '--format', format, '--verbose', '--timing', '--no-stderr'], '', {FAKE_HOST_MODE: 'js-error'});
    expect(result.status, result.stdout + result.stderr).toBe(4);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout).error).toMatchObject({code: 'APP_THREW', message: expect.stringContaining('boom')});
  }
});

it('prints text-mode failures on stdout when stderr is suppressed', () => {
  const result = cli(['render', APP, '--platform', 'android', '--format', 'text', '--no-stderr'], '', {FAKE_HOST_MODE: 'js-error'});
  expect(result.status).toBe(4);
  expect(result.stderr).toBe('');
  expect(result.stdout).toMatch(/^error APP_THREW: .*boom.* \(exit 4\)\n$/);
});

it('preserves session fallback diagnostics and error responses with no stderr', () => {
  const input = [{id: 1, action: {tap: {testID: 'FALLBACK'}}}, {id: 2, action: {tap: {testID: 'boom'}}}, {id: 3, quit: true}].map(x => JSON.stringify(x)).join('\n') + '\n';
  const args = ['session', APP, '--platform', 'android', '--no-quiet', '--verbose', '--timing'];
  const baseline = cli(args, input);
  expect(baseline.status, baseline.stdout + baseline.stderr).toBe(0);
  expect(baseline.stderr).toContain('NATIVE_MODULE_FALLBACK');
  const silent = cli([...args, '--no-stderr'], input);
  expect(silent.status, silent.stdout + silent.stderr).toBe(0);
  expect(silent.stderr).toBe('');
  const lines = silent.stdout.trim().split('\n').map(line => JSON.parse(line));
  expect(lines[0].ready).toBe(true);
  expect(lines[1].diagnostics).toContainEqual(expect.objectContaining({target: 'Demo'}));
  expect(lines[2].error.code).toBe('APP_THREW');
});
