import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {validateRequest} from '../src/session.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.js');

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
    process.execPath,
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
  assert.deepEqual(out[3], {id: 3, ok: false, error: 'boom from JS'});
  assert.equal(out[4].ok, false);
  assert.match(out[4].error, /invalid JSON/);
  assert.deepEqual(out[5], {id: 4, ok: false, error: 'unknown action "swipe" (one of: tap, longPress, type, scroll, pan, pinch, wait, snapshot)'});
  assert.deepEqual(out[6], {id: 5, ok: true});
  // App console output goes to stderr with an [app] prefix.
  assert.match(proc.stderr, /\[app\] request \{"id":1,/);
});

test('session: end of input without quit exits 0', {timeout: 120_000}, () => {
  const proc = runSession([{id: 1, tree: true}]);
  assert.equal(proc.status, 0, proc.stderr);
  const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(out.length, 2);
  assert.match(proc.stderr, /\[app\] request \{"id":null,"quit":true\}/);
});

test('session: requires --platform', {timeout: 120_000}, () => {
  const proc = spawnSync(process.execPath, [CLI, 'session', APP], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...process.env, RN_A11Y_HOST_BIN: FAKE_HOST},
    input: '',
  });
  assert.equal(proc.status, 1);
  assert.match(proc.stderr, /--platform <name> is required/);
});

test('session: per-request timeout kills the host and exits 1', {timeout: 120_000}, () => {
  const started = Date.now();
  const proc = runSession(
    [{id: 1, tree: true}, {id: 2, action: {tap: {testID: 'SLOW'}}}, {id: 3, tree: true}],
    ['--timeout', '1500'],
  );
  assert.equal(proc.status, 1, proc.stderr);
  const out = proc.stdout.trim().split('\n').map(l => JSON.parse(l));
  assert.equal(out.length, 3); // ready, id 1, id 2 (timeout); id 3 is not handled
  assert.deepEqual(out[2], {id: 2, ok: false, error: 'timeout'});
  assert.match(proc.stderr, /request timed out after 1500 ms; host killed/);
  assert.ok(Date.now() - started < 60_000);
});
