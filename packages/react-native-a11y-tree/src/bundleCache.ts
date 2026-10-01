/**
 * Caches for the one-shot CLI (no daemon):
 *
 * - Metro's transform cache and file map cache live in a persistent
 *   directory (see `cacheRoot`), not in the OS temp dir.
 * - Finished bundles are cached by a key (generated entry + build options +
 *   tool versions). An entry is valid while every module file of its
 *   dependency graph and every directory holding one keeps its mtime and
 *   size. Directory mtimes change when a file is added or removed, which
 *   catches new files that would change module resolution. A valid entry
 *   skips Metro completely.
 * - Hermes bytecode: compiling the medium example takes about 2 s, so a
 *   cache miss uses the JS bundle and starts `hermesc` in the background;
 *   the next run of the unchanged app uses the bytecode.
 */

import {spawn, spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

/** Bump when the cache layout or the key inputs change. */
const CACHE_VERSION = 1;

export const BUNDLE_FILE = 'index.bundle.js';
export const BYTECODE_FILE = 'index.bundle.hbc';
const MANIFEST_FILE = 'manifest.json';

export type BytecodeMode = 'auto' | 'on' | 'off';

type Stat = [string, number, number]; // path, mtimeMs, size

type Manifest = {
  version: number;
  key: string;
  files: Stat[];
  dirs: Array<[string, number]>;
  createdAt: string;
};

/**
 * `<project>/node_modules/.cache/rn-a11y-tree` when the project has a
 * node_modules directory, else `~/.cache/rn-a11y-tree`. Overridable with
 * RN_A11Y_TREE_CACHE_DIR.
 */
export function cacheRoot(projectRoot: string): string {
  const fromEnv = process.env.RN_A11Y_TREE_CACHE_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  const nodeModules = path.join(projectRoot, 'node_modules');
  if (fs.existsSync(nodeModules)) {
    return path.join(nodeModules, '.cache', 'rn-a11y-tree');
  }
  return path.join(os.homedir(), '.cache', 'rn-a11y-tree');
}

function packageVersion(name: string): string {
  try {
    return (require(`${name}/package.json`) as {version: string}).version;
  } catch {
    return 'none';
  }
}

/** Cache key for a bundle: everything that changes the output besides module files. */
export function bundleKey(parts: {
  entry: string;
  platform: string;
  dev: boolean;
  minify: boolean;
  projectRoot: string;
  resolutionConfig?: string;
}): string {
  const versions = ['metro', 'expo', '@expo/metro-config', 'babel-preset-expo', 'react-native'].map(
    name => `${name}@${packageVersion(name)}`,
  );
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({v: CACHE_VERSION, ...parts, versions}))
    .digest('hex')
    .slice(0, 32);
}

export function entryDir(root: string, key: string): string {
  return path.join(root, 'bundles', key);
}

function statFile(file: string): Stat | null {
  try {
    const s = fs.statSync(file);
    return [file, s.mtimeMs, s.size];
  } catch {
    return null;
  }
}

/**
 * Number of changed inputs (files and directories) of the cached entry,
 * 0 when it is valid, or null when there is no entry for this key. Stops
 * counting at `limit`.
 */
export function changedInputs(dir: string, key: string, limit = Infinity): number | null {
  let manifest: Manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8'));
  } catch {
    return null;
  }
  if (manifest.version !== CACHE_VERSION || manifest.key !== key) return null;
  if (!fs.existsSync(path.join(dir, BUNDLE_FILE))) return null;
  let changed = 0;
  for (const [file, mtimeMs, size] of manifest.files) {
    const s = statFile(file);
    if (s == null || s[1] !== mtimeMs || s[2] !== size) {
      if (++changed >= limit) return changed;
    }
  }
  for (const [dirPath, mtimeMs] of manifest.dirs) {
    const s = statFile(dirPath);
    if (s == null || s[1] !== mtimeMs) {
      if (++changed >= limit) return changed;
    }
  }
  return changed;
}

/** True if the cached entry exists and all its inputs are unchanged. */
export function isEntryValid(dir: string, key: string): boolean {
  return changedInputs(dir, key, 1) === 0;
}

/**
 * Stores a bundle and its dependency files. Files inside `excludeDir` (the
 * temp dir of the generated entry, whose content is in the key) are left
 * out. Written to a temp dir and renamed, so readers never see a partial
 * entry.
 */
export function writeEntry(options: {
  root: string;
  key: string;
  bundleFile: string;
  files: string[];
  excludeDir: string;
}): string {
  const dir = entryDir(options.root, options.key);
  const files = options.files
    .filter(f => path.isAbsolute(f) && !f.startsWith(options.excludeDir + path.sep))
    .map(statFile)
    .filter((s): s is Stat => s != null);
  const dirs = [...new Set(files.map(([f]) => path.dirname(f)))]
    .map(d => statFile(d))
    .filter((s): s is Stat => s != null)
    .map(([d, mtimeMs]) => [d, mtimeMs] as [string, number]);
  const manifest: Manifest = {
    version: CACHE_VERSION,
    key: options.key,
    files,
    dirs,
    createdAt: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(dir), {recursive: true});
  const tmp = fs.mkdtempSync(path.join(path.dirname(dir), `.tmp-${options.key}-`));
  fs.copyFileSync(options.bundleFile, path.join(tmp, BUNDLE_FILE));
  fs.writeFileSync(path.join(tmp, MANIFEST_FILE), JSON.stringify(manifest));
  fs.rmSync(dir, {recursive: true, force: true});
  try {
    fs.renameSync(tmp, dir);
  } catch {
    // Another process wrote the same entry first; keep theirs.
    fs.rmSync(tmp, {recursive: true, force: true});
  }
  return dir;
}

/** The `hermesc` from the `hermes-compiler` package, or null. */
export function hermescPath(): string | null {
  const sub =
    process.platform === 'darwin'
      ? 'osx-bin/hermesc'
      : process.platform === 'linux'
        ? 'linux64-bin/hermesc'
        : process.platform === 'win32'
          ? 'win64-bin/hermesc.exe'
          : null;
  if (sub == null) return null;
  // hermes-compiler is a dependency of react-native: look next to it too
  // (installs where it is not hoisted).
  const lookups: Array<() => string> = [
    () => require.resolve('hermes-compiler/package.json'),
    () =>
      require.resolve('hermes-compiler/package.json', {
        paths: [path.dirname(require.resolve('react-native/package.json'))],
      }),
  ];
  for (const lookup of lookups) {
    try {
      const bin = path.join(path.dirname(lookup()), 'hermesc', sub);
      if (fs.existsSync(bin)) return bin;
    } catch {
      // Not found this way.
    }
  }
  return null;
}

function hermescArgs(js: string, out: string): string[] {
  return ['-emit-binary', '-O', '-w', '-out', out, js];
}

/** Compiles now; returns true on success. */
export function compileBytecode(dir: string): boolean {
  const hermesc = hermescPath();
  if (hermesc == null) return false;
  const js = path.join(dir, BUNDLE_FILE);
  const tmp = path.join(dir, `.${BYTECODE_FILE}.${process.pid}`);
  const result = spawnSync(hermesc, hermescArgs(js, tmp), {stdio: 'ignore'});
  if (result.status !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, {force: true});
    return false;
  }
  fs.renameSync(tmp, path.join(dir, BYTECODE_FILE));
  return true;
}

// Arguments: hermesc, the temporary output, the final output, hermesc's
// arguments (JSON). Runs hermesc, then renames the output. A script for this
// runtime (node or bun), not /bin/sh, so that it also runs on Windows.
const BACKGROUND_COMPILE_SCRIPT = `
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const [hermesc, tmp, out, args] = process.argv.slice(-4);
const result = spawnSync(hermesc, JSON.parse(args), {stdio: 'ignore', windowsHide: true});
if (result.status === 0 && fs.existsSync(tmp)) fs.renameSync(tmp, out);
else fs.rmSync(tmp, {force: true});
`;

/** Starts hermesc detached, so it can finish after the CLI exits. */
export function compileBytecodeInBackground(dir: string): boolean {
  const hermesc = hermescPath();
  if (hermesc == null) return false;
  const js = path.join(dir, BUNDLE_FILE);
  const tmp = path.join(dir, `.${BYTECODE_FILE}.bg`);
  const out = path.join(dir, BYTECODE_FILE);
  const child = spawn(
    process.execPath,
    ['-e', BACKGROUND_COMPILE_SCRIPT, hermesc, tmp, out, JSON.stringify(hermescArgs(js, tmp))],
    {detached: true, stdio: 'ignore', windowsHide: true},
  );
  child.unref();
  return true;
}

/** Drops a bytecode file the host could not load. */
export function discardBytecode(dir: string): void {
  fs.rmSync(path.join(dir, BYTECODE_FILE), {force: true});
}
