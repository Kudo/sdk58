import {spawn} from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import {describe, expect, it} from 'vitest';

import {CLI, E2E_PRESETS, find, hostBin, hostSkip, ROOT} from './helpers.ts';

const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');

describe('session', () => {
  for (const preset of E2E_PRESETS) {
    it(`[${preset.name}] session: start, tap submit, tree shows Submitted, quit`, {timeout: 180_000}, async t => {
      if (hostSkip) t.skip(hostSkip);
      const child = spawn('node', [CLI, 'session', APP, '--preset', preset.name], {
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
        if (done) expect.unreachable(`session ended early:\n${stderr}`);
        return JSON.parse(value);
      };
      const request = async (req: unknown) => {
        child.stdin.write(JSON.stringify(req) + '\n');
        return next();
      };

      const ready = await next();
      expect(ready.ready, JSON.stringify(ready)).toBe(true);
      expect(ready.tree.box.width).toBe(preset.width);
      expect(find(ready.tree, 'status')).toBe(undefined);

      const tap = await request({id: 1, action: {tap: {testID: 'submit'}}});
      expect(tap.id).toBe(1);
      expect(tap.ok, JSON.stringify(tap)).toBe(true);
      expect(tap.step.hit, 'tap has no hit').toBeTruthy();

      const tree = await request({id: 2, tree: true});
      expect(tree.ok).toBe(true);
      expect(find(tree.tree, 'status')?.text).toBe('Submitted');

      const quit = await request({id: 3, quit: true});
      expect(quit).toStrictEqual({id: 3, ok: true});
      child.stdin.end();
      expect(await exit, stderr).toBe(0);
    });
  }
});
