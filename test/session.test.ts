import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {validateRequest} from '../src/session.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.ts');

describe('session', () => {
  it('validateRequest', () => {
    expect(validateRequest({id: 1, action: {tap: {testID: 'submit'}}})).toBe(null);
    expect(validateRequest({id: 'a', tree: true})).toBe(null);
    expect(validateRequest({id: 2, quit: true})).toBe(null);
    expect(validateRequest([]) ?? '').toMatch(/must be a JSON object/);
    expect(validateRequest({tree: true}) ?? '').toMatch(/needs an "id"/);
    expect(validateRequest({id: 1}) ?? '').toMatch(/exactly one of/);
    expect(validateRequest({id: 1, tree: true, quit: true}) ?? '').toMatch(/exactly one of/);
    expect(validateRequest({id: 1, tree: 1}) ?? '').toMatch(/"tree" must be true/);
    expect(validateRequest({id: 1, action: {wait: -5}})).toBe('wait: must be a number of milliseconds >= 0');
  });

  function runSession(lines: unknown[], extraArgs: string[] = []) {
    return spawnSync(
      'node',
      [CLI, 'session', APP, '--platform', 'android', ...extraArgs],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST},
        input: lines.map(l => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n',
        maxBuffer: 64 * 1024 * 1024,
      },
    );
  }

  it('session: JSON lines over the interactive host protocol (fake host)', {timeout: 120_000}, () => {
    const proc = runSession([
      {id: 1, action: {tap: {testID: 'submit'}}},
      {id: 2, tree: true},
      {id: 3, action: {tap: {testID: 'boom'}}},
      'not json',
      {id: 4, action: {swipe: {}}},
      {id: 5, quit: true},
      {id: 6, tree: true}, // after quit: ignored
    ]);
    expect(proc.status, proc.stderr).toBe(0);
    const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(out.length).toBe(7);
    expect(out[0].ready).toBe(true);
    expect(out[0].tree.ref).toBe('n0');
    expect(out[0].tree.children[0].children[0].name).toBe('Sign in now'); // converted by tree.ts
    expect({id: out[1].id, ok: out[1].ok, box: out[1].step.hit.box}).toStrictEqual({id: 1, ok: true, box: {x: 24, y: 154, width: 342, height: 48}});
    expect(out[2].id).toBe(2);
    expect(out[2].tree.type).toBe('RootView');
    expect(out[3]).toStrictEqual({id: 3, ok: false, error: {code: 'APP_THREW', message: 'boom from JS'}, logs: [{level: 'info', message: 'request {"id":3,"action":{"tap":{"testID":"boom"}}}'}]});
    expect(out[4].ok).toBe(false);
    expect(out[4].error.code).toBe('USAGE');
    expect(out[4].error.message).toMatch(/invalid JSON/);
    expect(out[5]).toStrictEqual({id: 4, ok: false, error: {code: 'USAGE', message: 'unknown action "swipe" (one of: tap, longPress, type, scroll, pan, pinch, wait, snapshot)'}});
    expect({id: out[6].id, ok: out[6].ok}).toStrictEqual({id: 5, ok: true});
    // App console output is in each response's `logs`; not on stderr (quiet
    // is the default when stdout is not a terminal).
    expect(out[1].logs).toStrictEqual([{level: 'info', message: 'request {"id":1,"action":{"tap":{"testID":"submit"}}}'}]);
    expect(proc.stderr).not.toMatch(/\[app\]/);
  });

  it('session: end of input without quit exits 0', {timeout: 120_000}, () => {
    const proc = runSession([{id: 1, tree: true}]);
    expect(proc.status, proc.stderr).toBe(0);
    const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(out.length).toBe(2);
    expect(proc.stderr).not.toMatch(/\[app\]/);
  });

  it('session: requires --platform', {timeout: 120_000}, () => {
    const proc = spawnSync('node', [CLI, 'session', APP], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST},
      input: '',
    });
    expect(proc.status).toBe(1);
    expect(proc.stderr).toMatch(/--platform <name> is required/);
  });

  it('session: per-request timeout kills the host and exits 5', {timeout: 120_000}, () => {
    const started = Date.now();
    const proc = runSession(
      [{id: 1, tree: true}, {id: 2, action: {tap: {testID: 'SLOW'}}}, {id: 3, tree: true}],
      ['--timeout', '1500'],
    );
    expect(proc.status, proc.stderr).toBe(5);
    const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(out.length).toBe(3); // ready, id 1, id 2 (timeout); id 3 is not handled
    expect(out[2].error).toStrictEqual({code: 'TIMEOUT', message: 'timeout'});
    expect(out[2].ok).toBe(false);
    expect(proc.stderr).toMatch(/request timed out after 1500 ms; host killed/);
    expect(Date.now() - started < 60_000).toBeTruthy();
  });

  it('session: tree requests accept format/select/depth (fake host)', {timeout: 120_000}, () => {
    const proc = runSession([
      {id: 1, tree: true, format: 'text', select: 'role=button'},
      {id: 2, tree: true, format: 'compact', select: ['testID=submit'], depth: 1},
      {id: 3, tree: true, format: 'xml'},
      {id: 4, tree: true, select: 'color=red'},
      {id: 5, quit: true},
    ]);
    expect(proc.status, proc.stderr).toBe(0);
    const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(out[1].tree).toMatch(/^submit View #submit role=button "Submit"/);
    expect(out[2].tree.length).toBe(1);
    expect(out[2].tree[0].children.length).toBe(1);
    expect(out[3].error.message).toMatch(/"format" must be one of/);
    expect(out[4].error.message).toMatch(/invalid selector/);
  });

  it('session: diff on action requests (fake host)', {timeout: 120_000}, () => {
    const proc = runSession([
      {id: 1, action: {tap: {testID: 'submit'}}, diff: true},
      {id: 2, tree: true, diff: true},
      {id: 3, quit: true},
    ]);
    expect(proc.status, proc.stderr).toBe(0);
    const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(out[1].diff.added.map((n: {key: string}) => n.key)).toStrictEqual(['status']);
    expect(out[1].diffTrees).toBe(undefined);
    expect(out[2].error.message).toMatch(/"diff" must be true or false, on action requests/);
  });

  it('session --format/--select: the ready tree and default tree output; a request overrides (fake host)', {timeout: 120_000}, () => {
    const proc = runSession(
      [
        {id: 1, tree: true},
        {id: 2, tree: true, format: 'json'},
        {id: 3, quit: true},
      ],
      ['--format', 'text', '--select', 'role=button'],
    );
    expect(proc.status, proc.stderr).toBe(0);
    const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
    expect(typeof out[0].tree).toBe('string');
    expect(out[0].tree).toMatch(/^submit View #submit role=button "Submit"/);
    expect(out[1].tree).toBe(out[0].tree);
    // The request's format wins; --select still applies.
    expect(Array.isArray(out[2].tree)).toBeTruthy();
    expect(out[2].tree.map((n: {testID: string}) => n.testID)).toStrictEqual(['submit']);

    const bad = runSession([], ['--format', 'xml']);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/--format must be one of: json, compact, text, ndjson/);
  });
});
