/**
 * Caches for the one-shot CLI (no daemon):
 *
 * - Metro's transform cache and file map cache live in a persistent
 *   directory (see `cacheRoot`), not in the OS temp dir.
 * - Finished bundles are cached by a key (generated entry + build options +
 *   tool versions). An entry is valid while every module file of its
 *   dependency graph and every directory holding one keeps its mtime and
 *   size. Directory mtimes change when a file is added or removed, which
 *   catches new files that would change module resolution. Context roots
 *   additionally track every discoverable subdirectory, including empty ones.
 *   A valid entry
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
// v4 tracks require.context discovery directories, including empty subtrees.
const CACHE_VERSION = 4;

export const BUNDLE_FILE = 'index.bundle.js';
export const BYTECODE_FILE = 'index.bundle.hbc';
const MANIFEST_FILE = 'manifest.json';

export type BytecodeMode = 'auto' | 'on' | 'off';

type Stat = [string, number, number]; // path, mtimeMs, size

type Manifest = {
  version: number;
  key: string;
  files: Stat[];
  dirs: Array<[string, number | null]>;
  createdAt: string;
  generation: string;
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

/** Inputs outside Metro's module graph that can change transforms or resolution. */
export function buildFingerprint(projectRoot: string): string {
  const hash = crypto.createHash('sha256');
  const projectRequire = createRequire(path.join(projectRoot, 'package.json'));
  for (const name of ['metro', 'expo', '@expo/metro-config', 'babel-preset-expo', 'react-native', 'hermes-compiler']) {
    let file: string | undefined;
    try {file = projectRequire.resolve(`${name}/package.json`);} catch {
      try {file = require.resolve(`${name}/package.json`);} catch { /* unavailable */ }
    }
    hash.update(name);
    if (file) hash.update(file).update(fs.readFileSync(file));
  }
  // Include workspace ancestors: apps often inherit Babel config and lockfiles.
  for (let dir = path.resolve(projectRoot);;) {
    const names = ['package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
      'babel.config.js', 'babel.config.cjs', 'babel.config.mjs', 'babel.config.json',
      '.babelrc', '.babelrc.js', '.babelrc.cjs', '.babelrc.json'];
    const dotenv = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name === '.env' || name.startsWith('.env.')).sort() : [];
    for (const name of [...names, ...dotenv]) {
      const file = path.join(dir, name);
      try {if (fs.statSync(file).isFile()) hash.update(file).update(fs.readFileSync(file));} catch { /* absent */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const env = Object.keys(process.env).filter(name => name === 'NODE_ENV' || name === 'BABEL_ENV' || name.startsWith('EXPO_PUBLIC_')).sort();
  hash.update(JSON.stringify(env.map(name => [name, process.env[name]])));
  return hash.digest('hex');
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
  const buildConfig = buildFingerprint(parts.projectRoot);
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({v: CACHE_VERSION, ...parts, buildConfig}))
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
  if (!manifest || manifest.version !== CACHE_VERSION || manifest.key !== key
    || !Array.isArray(manifest.files) || !Array.isArray(manifest.dirs)
    || manifest.files.some(item => !Array.isArray(item) || item.length !== 3
      || typeof item[0] !== 'string' || !Number.isFinite(item[1]) || !Number.isFinite(item[2]))
    || manifest.dirs.some(item => !Array.isArray(item) || item.length !== 2
      || typeof item[0] !== 'string' || (item[1] !== null && !Number.isFinite(item[1])))) return null;
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
    if ((s?.[1] ?? null) !== mtimeMs) {
      if (++changed >= limit) return changed;
    }
  }
  return changed;
}

/** True if the cached entry exists and all its inputs are unchanged. */
export function isEntryValid(dir: string, key: string): boolean {
  return changedInputs(dir, key, 1) === 0;
}

export type ContextRoot = {root: string; recursive: boolean};

/** Only context roots are walked; ordinary apps do not scan directory trees. */
function contextDirectories(contexts: ContextRoot[]): Set<string> {
  const dirs = new Set<string>();
  const traversed = new Set<string>();
  const visit = (dir: string, recursive: boolean) => {
    dirs.add(dir);
    let real: string;
    try { real = fs.realpathSync(dir); } catch (error) {
      // Empty contexts can refer to a root that does not exist yet.
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return;
      throw error;
    }
    if (!recursive || traversed.has(real)) return;
    traversed.add(real); // Symlink cycles and overlapping contexts terminate.
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const child = path.join(dir, entry.name);
      if (entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(child, {throwIfNoEntry: false})?.isDirectory())) visit(child, true);
    }
  };
  for (const context of contexts) visit(context.root, context.recursive);
  return dirs;
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
  contexts?: ContextRoot[];
}): string {
  const dir = entryDir(options.root, options.key);
  const files = options.files
    .filter(f => path.isAbsolute(f) && !f.startsWith(options.excludeDir + path.sep))
    .map(statFile)
    .filter((s): s is Stat => s != null);
  const directories = contextDirectories(options.contexts ?? []);
  for (const [file] of files) directories.add(path.dirname(file));
  const dirs = [...directories].map(d => [d, statFile(d)?.[1] ?? null] as [string, number | null]);
  const manifest: Manifest = {
    version: CACHE_VERSION,
    key: options.key,
    files,
    dirs,
    createdAt: new Date().toISOString(),
    generation: crypto.randomUUID(),
  };

  fs.mkdirSync(path.dirname(dir), {recursive: true});
  const tmp = fs.mkdtempSync(path.join(path.dirname(dir), `.tmp-${options.key}-`));
  try {
    fs.copyFileSync(options.bundleFile, path.join(tmp, BUNDLE_FILE));
    fs.writeFileSync(path.join(tmp, MANIFEST_FILE), JSON.stringify(manifest));
    // Windows readers or a detached compiler may briefly hold an entry open.
    fs.rmSync(dir, {recursive: true, force: true, maxRetries: 2, retryDelay: 50});
    fs.renameSync(tmp, dir);
  } finally {
    // Preserve the publication error; cleanup failure must not replace it.
    try { fs.rmSync(tmp, {recursive: true, force: true, maxRetries: 2, retryDelay: 50}); } catch {}
  }
  return dir;
}

/** Each rebuild owns a separate output: a late compiler cannot replace newer bytecode. */
export function bytecodePath(dir: string): string | null {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8')) as Manifest;
    if (manifest.version !== CACHE_VERSION || !/^[0-9a-f-]{36}$/.test(manifest.generation)) return null;
    return path.join(dir, `${manifest.generation}.${BYTECODE_FILE}`);
  } catch {return null;}
}

/** A private snapshot keeps a running invocation independent of cache eviction
 * and replacement. Validate the generation and inputs after copying so a
 * publication racing the copy becomes a miss, never a mixed JS/HBC artifact. */
export function snapshotEntry(dir: string, key: string, includeBytecode: boolean): {
  workDir: string; jsBundlePath: string; bundlePath: string;
} | null {
  let workDir: string | undefined;
  try {
    const before = fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8');
    const manifest = JSON.parse(before) as Manifest;
    if (manifest.version !== CACHE_VERSION || manifest.key !== key || !/^[0-9a-f-]{36}$/.test(manifest.generation)) return null;
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-snapshot-'));
    const jsBundlePath = path.join(workDir, BUNDLE_FILE);
    fs.copyFileSync(path.join(dir, BUNDLE_FILE), jsBundlePath);
    let bundlePath = jsBundlePath;
    const hbcName = `${manifest.generation}.${BYTECODE_FILE}`;
    if (includeBytecode && fs.existsSync(path.join(dir, hbcName))) {
      bundlePath = path.join(workDir, hbcName);
      fs.copyFileSync(path.join(dir, hbcName), bundlePath);
    }
    // Identity is checked last: input validation itself reads the manifest.
    // A newer generation must not validate an older generation's copied files.
    if (!isEntryValid(dir, key) || fs.readFileSync(path.join(dir, MANIFEST_FILE), 'utf8') !== before) {
      fs.rmSync(workDir, {recursive: true, force: true});
      return null;
    }
    return {workDir, jsBundlePath, bundlePath};
  } catch {
    if (workDir) {try {fs.rmSync(workDir, {recursive: true, force: true});} catch {}}
    return null;
  }
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
  const out = bytecodePath(dir);
  if (out == null) return false;
  const js = path.join(dir, BUNDLE_FILE);
  const tmp = `${out}.${crypto.randomUUID()}.tmp`;
  const result = spawnSync(hermesc, hermescArgs(js, tmp), {stdio: 'ignore'});
  if (result.status !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, {force: true});
    return false;
  }
  try {
    fs.renameSync(tmp, out);
    return true;
  } catch {
    fs.rmSync(tmp, {force: true});
    return false;
  }
}

// Arguments: hermesc, the temporary output, the final output, hermesc's
// arguments (JSON). Runs hermesc, then renames the output. A script for this
// runtime (node or bun), not /bin/sh, so that it also runs on Windows.
const BACKGROUND_COMPILE_SCRIPT = `
const {spawnSync} = require('node:child_process');
const fs = require('node:fs');
const [hermesc, tmp, out, args] = process.argv.slice(-4);
const result = spawnSync(hermesc, JSON.parse(args), {stdio: 'ignore', windowsHide: true});
try {
  if (result.status === 0 && fs.existsSync(tmp)) fs.renameSync(tmp, out);
} finally {fs.rmSync(tmp, {force: true});}
`;

/** Starts hermesc detached, so it can finish after the CLI exits. */
export function compileBytecodeInBackground(dir: string): boolean {
  const hermesc = hermescPath();
  if (hermesc == null) return false;
  const out = bytecodePath(dir);
  if (out == null) return false;
  const js = path.join(dir, BUNDLE_FILE);
  const tmp = `${out}.${crypto.randomUUID()}.tmp`;
  const child = spawn(
    process.execPath,
    ['-e', BACKGROUND_COMPILE_SCRIPT, hermesc, tmp, out, JSON.stringify(hermescArgs(js, tmp))],
    // The worker outlives its caller; an inherited cwd locks that project on Windows.
    {cwd: os.tmpdir(), detached: true, stdio: 'ignore', windowsHide: true},
  );
  child.unref();
  return true;
}

/** Drops a bytecode file the host could not load. */
export function discardBytecode(dir: string, selectedPath?: string): void {
  // An older invocation must not evict bytecode from a newer publication.
  const name = selectedPath ? path.basename(selectedPath) : null;
  if (name && !/^[0-9a-f-]{36}\.index\.bundle\.hbc$/.test(name)) return;
  const out = name ? path.join(dir, name) : bytecodePath(dir);
  // Eviction is optional: a locked cache file must not prevent the JS retry.
  if (out) {try {fs.rmSync(out, {force: true});} catch {}}
}
