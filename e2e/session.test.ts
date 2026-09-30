import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import {test} from 'node:test';

import {CLI, E2E_PRESETS, find, hostBin, hostSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');

for (const preset of E2E_PRESETS) {
  test(`[${preset.name}] session: start, tap submit, tree shows Submitted, quit`, {skip: hostSkip, timeout: 180_000}, async () => {
    const child = spawn(process.execPath, [CLI, 'session', APP, '--preset', preset.name], {
      cwd: ROOT,
      env: {...process.env, RN_A11Y_HOST_BIN: hostBin},
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => (stderr += chunk));
    const exit = new Promise<number | null>(resolve => child.on('close', resolve));

    // Request/response in lockstep: send the next request after each line.
    const lines = readline.createInterface({input: child.stdout})[Symbol.asyncIterator]();
    const next = async () => {
      const {value, done} = await lines.next();
      assert.ok(!done, `session ended early:\n${stderr}`);
      return JSON.parse(value);
    };
    const request = async (req: unknown) => {
      child.stdin.write(JSON.stringify(req) + '\n');
      return next();
    };

    const ready = await next();
    assert.equal(ready.ready, true, JSON.stringify(ready));
    assert.equal(ready.tree.box.width, preset.width);
    assert.equal(find(ready.tree, 'status'), undefined);

    const tap = await request({id: 1, action: {tap: {testID: 'submit'}}});
    assert.equal(tap.id, 1);
    assert.equal(tap.ok, true, JSON.stringify(tap));
    assert.ok(tap.step.hit, 'tap has no hit');

    const tree = await request({id: 2, tree: true});
    assert.equal(tree.ok, true);
    assert.equal(find(tree.tree, 'status')?.text, 'Submitted');

    const quit = await request({id: 3, quit: true});
    assert.deepEqual(quit, {id: 3, ok: true});
    child.stdin.end();
    assert.equal(await exit, 0, stderr);
  });
}
