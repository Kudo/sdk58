import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import os from 'node:os';

import type {RenderResult, RunResult} from '../packages/react-native-a11y-tree/src/schema.ts';
import {ACTION_NAMES} from '../packages/react-native-a11y-tree/src/script.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree', 'src', 'cli.ts');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.ts');

function run(args: string[], env: Record<string, string | undefined>) {
  return spawnSync('node', [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...process.env, ...env},
    maxBuffer: 64 * 1024 * 1024,
  });
}

describe('cli', () => {
  it('requires --platform and lists the known values', {timeout: 120_000}, () => {
    for (const extra of [[], ['--bundle-only']]) {
      const proc = spawnSync('node', [CLI, 'render', APP, ...extra], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST, RN_A11Y_HOST_RUNNER: 'bun'},
      });
      expect(proc.status).toBe(1);
      expect(proc.stdout).toBe('');
      expect(proc.stderr).toMatch(/--platform <name> is required/);
      expect(proc.stderr).toMatch(/android, ios, a11ytree/);
      expect(proc.stderr).toMatch(/Any Metro platform name is accepted/);
      expect(proc.stderr).toMatch(/Platform\.OS/);
    }
  });

  it('fails with a clear message when the host binary is missing', {timeout: 120_000}, () => {
    const proc = run(['render', APP, '--platform', 'android'], {RN_A11Y_HOST_BIN: '/nonexistent/rn-a11y-host'});
    expect(proc.status).toBe(5);
    const {error} = JSON.parse(proc.stderr.trim().split('\n').pop()!);
    expect(error.code).toBe('HOST_MISSING');
    expect(error.message).toMatch(/RN_A11Y_HOST_BIN points to a missing file/);
    expect(error.hint).toMatch(/bun run build:host/);
    expect(proc.stdout).toBe('');
  });

  it('bundles with Metro and parses host stdout (fake host)', {timeout: 120_000}, () => {
    const proc = run(['render', APP, '--platform', 'android', '--format', 'json'], {RN_A11Y_HOST_BIN: FAKE_HOST, RN_A11Y_HOST_RUNNER: 'bun'});
    expect(proc.status, proc.stderr).toBe(0);
    const result = JSON.parse(proc.stdout) as RenderResult;
    expect(result.root.box.width).toBe(390);
    expect(result.root.type).toBe('RootView');
    expect(result.source).toBe('mounted');
  });

  it('parses a shadowTree payload (fake host)', {timeout: 120_000}, () => {
    const proc = run(['render', APP, '--platform', 'android', '--debug-props', '--format', 'json'], {
      RN_A11Y_HOST_BIN: FAKE_HOST, RN_A11Y_HOST_RUNNER: 'bun',
      FAKE_HOST_MODE: 'shadow-tree',
    });
    expect(proc.status, proc.stderr).toBe(0);
    const result = JSON.parse(proc.stdout) as RenderResult;
    expect(result.source).toBe('shadowTree');
    expect(result.root.children[0].children.length).toBe(6);
  });

  it('--debug-props is passed to the entry', {timeout: 120_000}, () => {
    for (const [flag, expected] of [[[], 'false'], [['--debug-props'], 'true']] as const) {
      const proc = run(['render', APP, '--platform', 'android', '--bundle-only', '--no-cache', ...flag], {});
      expect(proc.status, proc.stderr).toBe(0);
      const bundlePath = /Bundle: (.+) \(\d+ bytes/.exec(proc.stderr)![1];
      const code = fs.readFileSync(bundlePath, 'utf8');
      fs.rmSync(path.dirname(bundlePath), {recursive: true, force: true});
      expect(code).toMatch(new RegExp(`includeDebugProps = ${expected}`));
      expect(code).toContain('getA11yTree');
    }
  });

  it('reports JS errors from the host', {timeout: 120_000}, () => {
    const proc = run(['render', APP, '--platform', 'android'], {
      RN_A11Y_HOST_BIN: FAKE_HOST, RN_A11Y_HOST_RUNNER: 'bun',
      FAKE_HOST_MODE: 'js-error',
    });
    expect(proc.status).toBe(4);
    const {error} = JSON.parse(proc.stderr.trim().split('\n').pop()!);
    expect(error.code).toBe('APP_THREW');
    expect(error.message).toMatch(/Render failed in JS: boom/);
    expect(error.details.stack).toMatch(/at App/);
  });

  function writeScript(script: unknown): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-test-'));
    const file = path.join(dir, 'actions.json');
    fs.writeFileSync(file, typeof script === 'string' ? script : JSON.stringify(script));
    return file;
  }

  it('run: validates the script before bundling', {timeout: 120_000}, () => {
    const cases: Array<[unknown, RegExp]> = [
      [[{tap: {testID: 'submit'}}, {wait: 'soon'}], /step 1: wait: must be a number/],
      [{$schema: 'x', actions: [{wait: 'soon'}]}, /step 0: wait: must be a number/],
      ['[not json', /is not valid JSON/],
    ];
    for (const [script, pattern] of cases) {
      const file = writeScript(script);
      const proc = run(['run', APP, '--platform', 'android', '--script', file], {
        RN_A11Y_HOST_BIN: FAKE_HOST, RN_A11Y_HOST_RUNNER: 'bun',
      });
      fs.rmSync(path.dirname(file), {recursive: true, force: true});
      expect(proc.status).toBe(1);
      expect(proc.stderr).toMatch(pattern);
      expect(proc.stderr).not.toMatch(/Bundle:/);
      expect(proc.stdout).toBe('');
    }
    const missing = run(['run', APP, '--platform', 'android'], {RN_A11Y_HOST_BIN: FAKE_HOST, RN_A11Y_HOST_RUNNER: 'bun'});
    expect(missing.status).toBe(1);
    expect(missing.stderr).toMatch(/--script <json> is required/);
    const badMode = run(
      ['run', APP, '--platform', 'android', '--script', 'x.json', '--tap-mode', 'swipe'],
      {RN_A11Y_HOST_BIN: FAKE_HOST, RN_A11Y_HOST_RUNNER: 'bun'},
    );
    expect(badMode.status).toBe(1);
    expect(badMode.stderr).toMatch(/--tap-mode must be one of: touch, click, both/);
  });

  it('run: reports steps, snapshots and the final tree (fake host)', {timeout: 120_000}, () => {
    const file = writeScript([{tap: {testID: 'submit'}}, {tap: {testID: 'missing'}}, {snapshot: 'after'}]);
    const proc = run(['run', APP, '--platform', 'android', '--script', file, '--no-quiet', '--format', 'json'], {
      RN_A11Y_HOST_BIN: FAKE_HOST, RN_A11Y_HOST_RUNNER: 'bun',
      FAKE_HOST_MODE: 'run',
    });
    fs.rmSync(path.dirname(file), {recursive: true, force: true});
    expect(proc.status, proc.stderr).toBe(0);
    const result = JSON.parse(proc.stdout) as RunResult;
    expect(result.source).toBe('shadowTree');
    expect(result.steps.length).toBe(3);
    expect(result.steps[0].target?.box?.y).toBe(154); // rounded
    expect(result.steps[0].hit?.type).toBe('Paragraph');
    expect(result.steps[1].error).toStrictEqual({code: 'TARGET_NOT_FOUND', message: 'Target not found: {"testID":"missing"}'});
    expect(proc.stderr).toMatch(/warning: JS fallbacks used because the host lacks native methods: events: js, hitTest: js/);
    expect(proc.stderr.match(/warning: JS fallbacks/g)?.length).toBe(1);
    // Snapshots and final are converted with the same converter as `render`.
    expect(result.snapshots.after.ref).toBe('n0');
    expect(result.final.children[0].children[0].name).toBe('Sign in now');
  });

  it('run: the script and tap mode are embedded in the bundle', {timeout: 120_000}, () => {
    const file = writeScript([{wait: 5}]);
    const proc = run(
      ['run', APP, '--platform', 'android', '--script', file, '--tap-mode', 'both', '--bundle-only', '--no-cache'],
      {},
    );
    fs.rmSync(path.dirname(file), {recursive: true, force: true});
    expect(proc.status, proc.stderr).toBe(0);
    const bundlePath = /Bundle: (.+) \(\d+ bytes/.exec(proc.stderr)![1];
    const code = fs.readFileSync(bundlePath, 'utf8');
    fs.rmSync(path.dirname(bundlePath), {recursive: true, force: true});
    expect(code).toMatch(/script = \[\{\s*"wait": 5\s*\}\]/);
    expect(code).toMatch(/tapMode = "both"/);
  });

  it('run: inline object-form script with $schema', {timeout: 120_000}, () => {
    const script = JSON.stringify({$schema: 'schema/script.json', actions: [{wait: 5}]});
    const proc = run(['run', APP, '--platform', 'android', '--script', script, '--bundle-only', '--no-cache'], {});
    expect(proc.status, proc.stderr).toBe(0);
    const bundlePath = /Bundle: (.+) \(\d+ bytes/.exec(proc.stderr)![1];
    const code = fs.readFileSync(bundlePath, 'utf8');
    fs.rmSync(path.dirname(bundlePath), {recursive: true, force: true});
    expect(code).toMatch(/script = \[\{\s*"wait": 5\s*\}\]/);
  });

  it('--help lists the actions; schema prints and lists the schemas', () => {
    for (const command of ['run', 'check', 'session']) {
      const help = run([command, '--help'], {});
      expect(help.status, help.stderr).toBe(0);
      for (const name of ACTION_NAMES) expect(help.stdout, `${command} --help: ${name}`).toMatch(new RegExp(`^  ${name} +\\{"${name}"`, 'm'));
    }
    expect(run(['run', '--help'], {}).stdout).toMatch(/rn-a11y-tree schema script/);
    const list = run(['schema'], {});
    expect(list.status, list.stderr).toBe(0);
    expect(list.stdout).toMatch(/^script\t/m);
    expect(list.stdout).toMatch(/^session-request\t/m);
    const schema = run(['schema', 'script'], {});
    expect(schema.status, schema.stderr).toBe(0);
    expect(schema.stdout).toBe(fs.readFileSync(path.join(ROOT, 'packages/react-native-a11y-tree', 'schema', 'script.json'), 'utf8'));
    const unknown = run(['schema', 'nope'], {});
    expect(unknown.status).toBe(1);
    expect(JSON.parse(unknown.stderr).error.message).toMatch(/unknown schema "nope" \(one of: .*script/);
  });
});
