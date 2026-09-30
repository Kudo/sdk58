import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {validateRequest} from '../src/session.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli.ts');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.ts');

test('validateRequest', () => {
  assert.equal(validateRequest({id: 1, action: {tap: {testID: 'submit'}}}), null);
  assert.equal(validateRequest({id: 'a', tree: true}), null);
  assert.equal(validateRequest({id: 2, quit: true}), null);
  assert.match(validateRequest([]) ?? '', /must be a JSON object/);
  assert.match(validateRequest({tree: true}) ?? '', /needs an "id"/);
  assert.match(validateRequest({id: 1}) ?? '', /exactly one of/);
  assert.match(validateRequest({id: 1, tree: true, quit: true}) ?? '', /exactly one of/);
  assert.match(validateRequest({id: 1, tree: 1}) ?? '', /"tree" must be true/);
  assert.equal(
    validateRequest({id: 1, action: {wait: -5}}),
    'wait: must be a number of milliseconds >= 0',
  );
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

test('session: JSON lines over the interactive host protocol (fake host)', {timeout: 120_000}, () => {
  const proc = runSession([
    {id: 1, action: {tap: {testID: 'submit'}}},
    {id: 2, tree: true},
    {id: 3, action: {tap: {testID: 'boom'}}},
    'not json',
    {id: 4, action: {swipe: {}}},
    {id: 5, quit: true},
    {id: 6, tree: true}, // after quit: ignored
  ]);
  assert.equal(proc.status, 0, proc.stderr);
  const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(out.length, 7);
  assert.equal(out[0].ready, true);
  assert.equal(out[0].tree.ref, 'n0');
  assert.equal(out[0].tree.children[0].children[0].name, 'Sign in now'); // converted by tree.ts
  assert.deepEqual(
    {id: out[1].id, ok: out[1].ok, box: out[1].step.hit.box},
    {id: 1, ok: true, box: {x: 24, y: 154, width: 342, height: 48}},
  );
  assert.equal(out[2].id, 2);
  assert.equal(out[2].tree.type, 'RootView');
  assert.deepEqual(out[3], {id: 3, ok: false, error: {code: 'APP_THREW', message: 'boom from JS'}, logs: [{level: 'info', message: 'request {"id":3,"action":{"tap":{"testID":"boom"}}}'}]});
  assert.equal(out[4].ok, false);
  assert.equal(out[4].error.code, 'USAGE');
  assert.match(out[4].error.message, /invalid JSON/);
  assert.deepEqual(out[5], {id: 4, ok: false, error: {code: 'USAGE', message: 'unknown action "swipe" (one of: tap, longPress, type, scroll, pan, pinch, wait, snapshot)'}});
  assert.deepEqual({id: out[6].id, ok: out[6].ok}, {id: 5, ok: true});
  // App console output is in each response's `logs`; not on stderr (quiet
  // is the default when stdout is not a terminal).
  assert.deepEqual(out[1].logs, [{level: 'info', message: 'request {"id":1,"action":{"tap":{"testID":"submit"}}}'}]);
  assert.doesNotMatch(proc.stderr, /\[app\]/);
});

test('session: end of input without quit exits 0', {timeout: 120_000}, () => {
  const proc = runSession([{id: 1, tree: true}]);
  assert.equal(proc.status, 0, proc.stderr);
  const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(out.length, 2);
  assert.doesNotMatch(proc.stderr, /\[app\]/);
});

test('session: requires --platform', {timeout: 120_000}, () => {
  const proc = spawnSync('node', [CLI, 'session', APP], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST},
    input: '',
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /--platform <name> is required/);
});

test('session: per-request timeout kills the host and exits 5', {timeout: 120_000}, () => {
  const started = Date.now();
  const proc = runSession(
    [{id: 1, tree: true}, {id: 2, action: {tap: {testID: 'SLOW'}}}, {id: 3, tree: true}],
    ['--timeout', '1500'],
  );
  assert.equal(proc.status, 5, proc.stderr);
  const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(out.length, 3); // ready, id 1, id 2 (timeout); id 3 is not handled
  assert.deepEqual(out[2].error, {code: 'TIMEOUT', message: 'timeout'});
  assert.equal(out[2].ok, false);
  assert.match(proc.stderr, /request timed out after 1500 ms; host killed/);
  assert.ok(Date.now() - started < 60_000);
});

test('session: tree requests accept format/select/depth (fake host)', {timeout: 120_000}, () => {
  const proc = runSession([
    {id: 1, tree: true, format: 'text', select: 'role=button'},
    {id: 2, tree: true, format: 'compact', select: ['testID=submit'], depth: 1},
    {id: 3, tree: true, format: 'xml'},
    {id: 4, tree: true, select: 'color=red'},
    {id: 5, quit: true},
  ]);
  assert.equal(proc.status, 0, proc.stderr);
  const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.match(out[1].tree, /^submit View #submit role=button "Submit"/);
  assert.equal(out[2].tree.length, 1);
  assert.equal(out[2].tree[0].children.length, 1);
  assert.match(out[3].error.message, /"format" must be one of/);
  assert.match(out[4].error.message, /invalid selector/);
});

test('session: diff on action requests (fake host)', {timeout: 120_000}, () => {
  const proc = runSession([
    {id: 1, action: {tap: {testID: 'submit'}}, diff: true},
    {id: 2, tree: true, diff: true},
    {id: 3, quit: true},
  ]);
  assert.equal(proc.status, 0, proc.stderr);
  const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.deepEqual(out[1].diff.added.map((n: {key: string}) => n.key), ['status']);
  assert.equal(out[1].diffTrees, undefined);
  assert.match(out[2].error.message, /"diff" must be true or false, on action requests/);
});

test('session --format/--select: the ready tree and default tree output; a request overrides (fake host)', {timeout: 120_000}, () => {
  const proc = runSession(
    [
      {id: 1, tree: true},
      {id: 2, tree: true, format: 'json'},
      {id: 3, quit: true},
    ],
    ['--format', 'text', '--select', 'role=button'],
  );
  assert.equal(proc.status, 0, proc.stderr);
  const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(typeof out[0].tree, 'string');
  assert.match(out[0].tree, /^submit View #submit role=button "Submit"/);
  assert.equal(out[1].tree, out[0].tree);
  // The request's format wins; --select still applies.
  assert.ok(Array.isArray(out[2].tree));
  assert.deepEqual(out[2].tree.map((n: {testID: string}) => n.testID), ['submit']);

  const bad = runSession([], ['--format', 'xml']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--format must be one of: json, compact, text, ndjson/);
});
