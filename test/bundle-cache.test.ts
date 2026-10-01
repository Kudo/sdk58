import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {
  BUNDLE_FILE,
  bundleKey,
  cacheRoot,
  entryDir,
  changedInputs,
  isEntryValid,
  writeEntry,
} from '../packages/react-native-a11y-tree/src/bundleCache.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree', 'src', 'cli.ts');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');

function tmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-cache-test-')));
}

describe('bundle-cache', () => {
  it('bundleKey depends on the entry and the build options', () => {
    const base = {entry: 'a', platform: 'android', dev: false, minify: false, projectRoot: '/p'};
    const k = bundleKey(base);
    expect(bundleKey({...base})).toBe(k);
    expect(bundleKey({...base, entry: 'b'})).not.toBe(k);
    expect(bundleKey({...base, platform: 'ios'})).not.toBe(k);
    expect(bundleKey({...base, dev: true})).not.toBe(k);
  });

  it('cacheRoot: env override, project node_modules, else home', () => {
    const project = tmpDir();
    const saved = process.env.RN_A11Y_TREE_CACHE_DIR;
    delete process.env.RN_A11Y_TREE_CACHE_DIR;
    try {
      expect(cacheRoot(project)).toBe(path.join(os.homedir(), '.cache', 'rn-a11y-tree'));
      fs.mkdirSync(path.join(project, 'node_modules'));
      expect(cacheRoot(project)).toBe(path.join(project, 'node_modules', '.cache', 'rn-a11y-tree'));
      process.env.RN_A11Y_TREE_CACHE_DIR = '/tmp/x';
      expect(cacheRoot(project)).toBe(path.resolve('/tmp/x'));
    } finally {
      if (saved == null) delete process.env.RN_A11Y_TREE_CACHE_DIR;
      else process.env.RN_A11Y_TREE_CACHE_DIR = saved;
    }
  });

  it('a cache entry is invalidated by file edits and by new files in module directories', () => {
    const root = tmpDir();
    const src = tmpDir();
    const work = tmpDir();
    const a = path.join(src, 'a.js');
    const b = path.join(src, 'lib', 'b.js');
    fs.mkdirSync(path.dirname(b));
    fs.writeFileSync(a, 'a');
    fs.writeFileSync(b, 'b');
    const bundle = path.join(work, 'out.js');
    fs.writeFileSync(bundle, '// bundle');
    const entry = path.join(work, 'entry.js');
    fs.writeFileSync(entry, 'entry');

    const key = 'k1';
    const dir = writeEntry({root, key, bundleFile: bundle, files: [a, b, entry], excludeDir: work});
    expect(dir).toBe(entryDir(root, key));
    expect(fs.readFileSync(path.join(dir, BUNDLE_FILE), 'utf8')).toBe('// bundle');
    expect(isEntryValid(dir, key)).toBe(true);
    expect(isEntryValid(dir, 'other-key')).toBe(false);

    // The generated entry (in the excluded work dir) is not tracked.
    fs.writeFileSync(entry, 'changed');
    expect(isEntryValid(dir, key)).toBe(true);

    // Editing a module file invalidates.
    fs.writeFileSync(b, 'b2');
    expect(isEntryValid(dir, key)).toBe(false);

    // A new file next to a module (could change resolution) invalidates.
    writeEntry({root, key, bundleFile: bundle, files: [a, b], excludeDir: work});
    expect(isEntryValid(dir, key)).toBe(true);
    fs.writeFileSync(path.join(src, 'a.android.js'), 'x');
    expect(isEntryValid(dir, key)).toBe(false);

    // Deleting a module file invalidates.
    writeEntry({root, key, bundleFile: bundle, files: [a, b], excludeDir: work});
    fs.rmSync(b);
    expect(isEntryValid(dir, key)).toBe(false);

    // changedInputs counts changed files and directories (for the small-edit path).
    fs.writeFileSync(b, 'b');
    writeEntry({root, key, bundleFile: bundle, files: [a, b], excludeDir: work});
    expect(changedInputs(dir, key)).toBe(0);
    expect(changedInputs(dir, 'other-key')).toBe(null);
    expect(changedInputs(path.join(root, 'none'), key)).toBe(null);
    fs.writeFileSync(a, 'a-edited');
    expect(changedInputs(dir, key)).toBe(1);
    fs.writeFileSync(b, 'b-edited');
    fs.writeFileSync(path.join(src, 'lib', 'new.js'), 'n'); // dir mtime of lib/
    expect(changedInputs(dir, key)).toBe(3);
    expect(changedInputs(dir, key, 2)).toBe(2);
  });

  it('CLI: the second --bundle-only of an unchanged app is a cache hit', {timeout: 180_000}, () => {
    const cache = tmpDir();
    const run = () =>
      spawnSync('node', [CLI, 'render', APP, '--platform', 'android', '--bundle-only', '--bytecode', 'off'], {
        cwd: ROOT,
        encoding: 'utf8',
        env: {...process.env, RN_A11Y_TREE_CACHE_DIR: cache},
      });
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stderr).toMatch(/Bundle: .* \(\d+ bytes, built, js\)/);
    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(second.stderr).toMatch(/Bundle: .* \(\d+ bytes, cached, js\)/);
    fs.rmSync(cache, {recursive: true, force: true});
  });
});
