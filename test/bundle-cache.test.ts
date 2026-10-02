import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {
  BUNDLE_FILE,
  bytecodePath,
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
    const snapshots: string[] = [];
    try {
      const first = run();
      const firstPath = /Bundle: (.+) \(\d+ bytes/.exec(first.stderr)?.[1];
      if (firstPath) snapshots.push(path.dirname(firstPath));
      expect(first.status, first.stderr).toBe(0);
      expect(first.stderr).toMatch(/Bundle: .* \(\d+ bytes, built, js\)/);
      const second = run();
      const secondPath = /Bundle: (.+) \(\d+ bytes/.exec(second.stderr)?.[1];
      if (secondPath) snapshots.push(path.dirname(secondPath));
      expect(second.status, second.stderr).toBe(0);
      expect(second.stderr).toMatch(/Bundle: .* \(\d+ bytes, cached, js\)/);
    } finally {
      for (const dir of snapshots) fs.rmSync(dir, {recursive: true, force: true});
      fs.rmSync(cache, {recursive: true, force: true});
    }
  });

  it.each([true, false])('tracks empty context directories according to recursive=%s', recursive => {
    const temp = tmpDir();
    try {
      const routes = path.join(temp, 'routes');
      const empty = path.join(routes, 'empty/deep');
      fs.mkdirSync(empty, {recursive: true});
      const work = path.join(temp, 'work');
      fs.mkdirSync(work);
      const bundleFile = path.join(work, 'bundle.js');
      fs.writeFileSync(bundleFile, '// bundle');
      const save = () => writeEntry({root: path.join(temp, 'cache'), key: 'context', bundleFile, files: [], excludeDir: work, contexts: [{root: routes, recursive}]});
      const dir = save();
      expect(isEntryValid(dir, 'context')).toBe(true);
      fs.writeFileSync(path.join(empty, 'route.js'), 'route');
      expect(isEntryValid(dir, 'context')).toBe(!recursive);
      save();
      fs.renameSync(path.join(empty, 'route.js'), path.join(empty, 'renamed.js'));
      expect(isEntryValid(dir, 'context')).toBe(!recursive);
      save();
      fs.rmSync(path.join(empty, 'renamed.js'));
      expect(isEntryValid(dir, 'context')).toBe(!recursive);
      save();
      fs.mkdirSync(path.join(routes, 'new-directory'));
      expect(isEntryValid(dir, 'context')).toBe(false);
    } finally {fs.rmSync(temp, {recursive: true, force: true});}
  });

  it('tracks absent context roots without crawling unrelated directories for normal apps', () => {
    const temp = tmpDir();
    try {
      const source = path.join(temp, 'App.js');
      fs.writeFileSync(source, 'app');
      const unrelated = path.join(temp, 'unrelated');
      fs.mkdirSync(unrelated);
      const work = path.join(temp, 'work');
      fs.mkdirSync(work);
      const bundleFile = path.join(work, 'bundle.js');
      fs.writeFileSync(bundleFile, '// bundle');
      // Pre-create cache directories so writing the entry does not change the
      // source parent directory being measured by this test.
      const root = path.join(work, 'cache');
      const missing = path.join(unrelated, 'missing');
      const dir = writeEntry({root, key: 'context', bundleFile, files: [source], excludeDir: work, contexts: [{root: missing, recursive: true}]});
      expect(isEntryValid(dir, 'context')).toBe(true);
      fs.mkdirSync(missing);
      expect(isEntryValid(dir, 'context')).toBe(false);
      const normal = writeEntry({root, key: 'normal', bundleFile, files: [source], excludeDir: work});
      fs.writeFileSync(path.join(missing, 'unimported.js'), 'unused');
      expect(isEntryValid(normal, 'normal')).toBe(true);
    } finally {fs.rmSync(temp, {recursive: true, force: true});}
  });
});

it('invalidates bundle keys when project tooling, Babel config, or build environment changes', () => {
  const project = tmpDir();
  const saved = process.env.EXPO_PUBLIC_A11Y_CACHE_TEST;
  try {
    const options = {entry: 'entry', platform: 'android', dev: false, minify: false, projectRoot: project};
    const versionFile = path.join(project, 'node_modules', 'metro', 'package.json');
    fs.mkdirSync(path.dirname(versionFile), {recursive: true});
    fs.writeFileSync(versionFile, JSON.stringify({name: 'metro', version: '1.0.0'}));
    const first = bundleKey(options);
    fs.writeFileSync(versionFile, JSON.stringify({name: 'metro', version: '2.0.0'}));
    expect(bundleKey(options)).not.toBe(first);
    const second = bundleKey(options);
    const babel = path.join(project, 'babel.config.js');
    fs.writeFileSync(babel, 'module.exports = {plugins: []};');
    expect(bundleKey(options)).not.toBe(second);
    const third = bundleKey(options);
    process.env.EXPO_PUBLIC_A11Y_CACHE_TEST = 'changed';
    expect(bundleKey(options)).not.toBe(third);
    const fourth = bundleKey(options);
    fs.writeFileSync(babel, 'module.exports = {};');
    expect(bundleKey(options)).not.toBe(fourth);
  } finally {
    if (saved === undefined) delete process.env.EXPO_PUBLIC_A11Y_CACHE_TEST;
    else process.env.EXPO_PUBLIC_A11Y_CACHE_TEST = saved;
    fs.rmSync(project, {recursive: true, force: true});
  }
});


it('never selects bytecode published late by a compiler for a replaced bundle', () => {
  const root = tmpDir();
  try {
    const js = path.join(root, 'input.js');
    fs.writeFileSync(js, 'old source');
    const options = {root, key: 'same-entry', bundleFile: js, files: [js], excludeDir: path.join(root, 'work')};
    const dir = writeEntry(options);
    const oldOutput = bytecodePath(dir)!;
    fs.writeFileSync(js, 'new source');
    writeEntry(options);
    const currentOutput = bytecodePath(dir)!;
    expect(currentOutput).not.toBe(oldOutput);
    // Reproduce the old detached compiler finishing after the new entry exists.
    fs.writeFileSync(oldOutput, 'stale bytecode');
    expect(fs.existsSync(bytecodePath(dir)!)).toBe(false);
    fs.writeFileSync(currentOutput, 'current bytecode');
    expect(fs.readFileSync(bytecodePath(dir)!, 'utf8')).toBe('current bytecode');
  } finally {fs.rmSync(root, {recursive: true, force: true});}
});
