import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, it} from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

it('invalidates finished bundles when recursive context routes are added, renamed, or removed', {timeout: 180_000}, () => {
  const project = fs.mkdtempSync(path.join(ROOT, 'examples/.require-context-'));
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'require-context-cache-'));
  try {
    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"context-cache-app","private":true}');
    fs.mkdirSync(path.join(project, 'routes/empty/deep'), {recursive: true});
    fs.mkdirSync(path.join(project, 'vacant'));
    fs.writeFileSync(path.join(project, 'App.tsx'), `import React from 'react'; import {Text} from 'react-native'; const routes = require.context('./routes', true, /\\.js$/); const vacant = require.context('./vacant', true, /\\.js$/); export default () => <Text>{routes.keys().concat(vacant.keys()).join(',')}</Text>;`);
    fs.writeFileSync(path.join(project, 'routes/index.js'), 'export default "CONTEXT_INITIAL_ROUTE";');
    const build = (state: 'built' | 'cached') => {
      const proc = spawnSync(process.execPath, [path.join(ROOT, 'packages/react-native-a11y-tree/src/cli.ts'), 'render', path.join(project, 'App.tsx'), '--platform', 'android', '--bundle-only', '--bytecode', 'off'], {
        cwd: ROOT, encoding: 'utf8', timeout: 90_000,
        env: {...process.env, RN_A11Y_TREE_CACHE_DIR: cache},
      });
      expect(proc.status, proc.stdout + proc.stderr).toBe(0);
      expect(proc.stderr).toContain(`bytes, ${state}, js)`);
      const bundle = /Bundle: (.+) \(\d+ bytes,/.exec(proc.stderr)![1];
      try {return fs.readFileSync(bundle, 'utf8');}
      finally {fs.rmSync(path.dirname(bundle), {recursive: true, force: true});}
    };
    expect(build('built')).toContain('CONTEXT_INITIAL_ROUTE');
    build('cached');
    const added = path.join(project, 'routes/empty/deep/added.js');
    fs.writeFileSync(added, 'export default "CONTEXT_ADDED_ROUTE";');
    expect(build('built')).toContain('CONTEXT_ADDED_ROUTE');
    build('cached');
    const renamed = path.join(project, 'routes/empty/deep/renamed.js');
    fs.renameSync(added, renamed);
    const renamedBundle = build('built');
    expect(renamedBundle).toContain('./empty/deep/renamed.js');
    expect(renamedBundle).not.toContain('./empty/deep/added.js');
    fs.rmSync(renamed);
    expect(build('built')).not.toContain('CONTEXT_ADDED_ROUTE');
    // A directory with no current modules must stay tracked after deletion.
    fs.writeFileSync(added, 'export default "CONTEXT_RESTORED_ROUTE";');
    expect(build('built')).toContain('CONTEXT_RESTORED_ROUTE');
    fs.mkdirSync(path.join(project, 'vacant/new/deep'), {recursive: true});
    fs.writeFileSync(path.join(project, 'vacant/new/deep/route.js'), 'export default "CONTEXT_FORMERLY_EMPTY";');
    expect(build('built')).toContain('CONTEXT_FORMERLY_EMPTY');
    build('cached');
  } finally {
    fs.rmSync(project, {recursive: true, force: true});
    fs.rmSync(cache, {recursive: true, force: true});
  }
});
