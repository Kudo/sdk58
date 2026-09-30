import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {
  BUNDLE_FILE,
  bundleKey,
  cacheRoot,
  entryDir,
  isEntryValid,
  writeEntry,
} from '../src/bundleCache.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');

function tmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-cache-test-')));
}

test('bundleKey depends on the entry and the build options', () => {
  const base = {entry: 'a', platform: 'android', dev: false, minify: false, projectRoot: '/p'};
  const k = bundleKey(base);
  assert.equal(bundleKey({...base}), k);
  assert.notEqual(bundleKey({...base, entry: 'b'}), k);
  assert.notEqual(bundleKey({...base, platform: 'ios'}), k);
  assert.notEqual(bundleKey({...base, dev: true}), k);
});

test('cacheRoot: env override, project node_modules, else home', () => {
  const project = tmpDir();
  const saved = process.env.RN_A11Y_TREE_CACHE_DIR;
  delete process.env.RN_A11Y_TREE_CACHE_DIR;
  try {
    assert.equal(cacheRoot(project), path.join(os.homedir(), '.cache', 'rn-a11y-tree'));
    fs.mkdirSync(path.join(project, 'node_modules'));
    assert.equal(cacheRoot(project), path.join(project, 'node_modules', '.cache', 'rn-a11y-tree'));
    process.env.RN_A11Y_TREE_CACHE_DIR = '/tmp/x';
    assert.equal(cacheRoot(project), '/tmp/x');
  } finally {
    if (saved == null) delete process.env.RN_A11Y_TREE_CACHE_DIR;
    else process.env.RN_A11Y_TREE_CACHE_DIR = saved;
  }
});

test('a cache entry is invalidated by file edits and by new files in module directories', () => {
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
  assert.equal(dir, entryDir(root, key));
  assert.equal(fs.readFileSync(path.join(dir, BUNDLE_FILE), 'utf8'), '// bundle');
  assert.equal(isEntryValid(dir, key), true);
  assert.equal(isEntryValid(dir, 'other-key'), false);

  // The generated entry (in the excluded work dir) is not tracked.
  fs.writeFileSync(entry, 'changed');
  assert.equal(isEntryValid(dir, key), true);

  // Editing a module file invalidates.
  fs.writeFileSync(b, 'b2');
  assert.equal(isEntryValid(dir, key), false);

  // A new file next to a module (could change resolution) invalidates.
  writeEntry({root, key, bundleFile: bundle, files: [a, b], excludeDir: work});
  assert.equal(isEntryValid(dir, key), true);
  fs.writeFileSync(path.join(src, 'a.android.js'), 'x');
  assert.equal(isEntryValid(dir, key), false);

  // Deleting a module file invalidates.
  writeEntry({root, key, bundleFile: bundle, files: [a, b], excludeDir: work});
  fs.rmSync(b);
  assert.equal(isEntryValid(dir, key), false);
});

test('CLI: the second --bundle-only of an unchanged app is a cache hit', {timeout: 180_000}, () => {
  const cache = tmpDir();
  const run = () =>
    spawnSync(process.execPath, [CLI, 'render', APP, '--platform', 'android', '--bundle-only', '--bytecode', 'off'], {
      cwd: ROOT,
      encoding: 'utf8',
      env: {...process.env, RN_A11Y_TREE_CACHE_DIR: cache},
    });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /Bundle: .* \(\d+ bytes, built, js\)/);
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stderr, /Bundle: .* \(\d+ bytes, cached, js\)/);
  fs.rmSync(cache, {recursive: true, force: true});
});
