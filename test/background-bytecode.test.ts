import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {expect, it, vi} from 'vitest';
import {bytecodePath, hermescPath, writeEntry} from '../packages/react-native-a11y-tree/src/bundleCache.ts';

it('should keep background bytecode compilation from locking the calling project', {timeout: 20_000}, async t => {
  if (!hermescPath()) t.skip('Hermes compiler is not available');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-background-bytecode-')));
  const project = path.join(root, 'app');
  fs.mkdirSync(project);
  const source = path.join(project, 'App.js');
  fs.writeFileSync(source, 'export default null');
  const bundle = path.join(root, 'bundle.js');
  fs.writeFileSync(bundle, '// bundle');
  const dir = writeEntry({root: path.join(root, 'cache'), key: 'background', bundleFile: bundle, files: [source], excludeDir: path.join(root, 'work')});
  const started = path.join(root, 'started');
  const release = path.join(root, 'release');
  const preload = path.join(root, 'compiler-preload.cjs');
  // Hold the real detached worker until its calling project has been removed.
  fs.writeFileSync(preload, `
    const fs = require('node:fs');
    require('node:child_process').spawnSync = (command, args) => {
      fs.writeFileSync(${JSON.stringify(started)}, process.cwd());
      const deadline = Date.now() + 15000;
      while (!fs.existsSync(${JSON.stringify(release)}) && Date.now() < deadline) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      }
      if (!fs.existsSync(${JSON.stringify(release)})) return {status: 1};
      fs.writeFileSync(args[args.indexOf('-out') + 1], 'compiled bytecode');
      return {status: 0};
    };
  `);
  const module = pathToFileURL(path.resolve(import.meta.dirname, '../packages/react-native-a11y-tree/src/bundleCache.ts')).href;
  const worker = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import {compileBytecodeInBackground} from ${JSON.stringify(module)};
    if (!compileBytecodeInBackground(${JSON.stringify(dir)})) process.exitCode = 1;
  `], {cwd: project, encoding: 'utf8', timeout: 5000, env: {...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --require ${JSON.stringify(preload)}`}});
  try {
    expect(worker.status, worker.stderr).toBe(0);
    await vi.waitFor(() => expect(fs.existsSync(started)).toBe(true), {timeout: 5000});
    expect(fs.realpathSync(fs.readFileSync(started, 'utf8'))).toBe(fs.realpathSync(os.tmpdir()));
    fs.rmSync(project, {recursive: true});
    expect(fs.existsSync(project)).toBe(false);
  } finally {
    fs.writeFileSync(release, 'finish');
    try {
      await vi.waitFor(() => expect(fs.readFileSync(bytecodePath(dir)!, 'utf8')).toBe('compiled bytecode'), {timeout: 5000});
    } finally {await fs.promises.rm(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});}
  }
});
