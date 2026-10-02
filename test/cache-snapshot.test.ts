import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterEach, expect, it, vi} from 'vitest';
import {BUNDLE_FILE, bytecodePath, changedInputs, discardBytecode, snapshotEntry, writeEntry} from '../packages/react-native-a11y-tree/src/bundleCache.ts';

const cleanup: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of cleanup.splice(0)) fs.rmSync(dir, {recursive: true, force: true});
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-snapshot-test-'));
  cleanup.push(root);
  const app = path.join(root, 'app');
  fs.mkdirSync(app);
  const source = path.join(app, 'source.js');
  const output = path.join(root, 'output.js');
  const save = (revision: string) => {
    fs.writeFileSync(source, revision);
    fs.writeFileSync(output, revision);
    return writeEntry({root: path.join(root, 'cache'), key: 'example', bundleFile: output, files: [source], excludeDir: path.join(root, 'work')});
  };
  return {save, source, dir: save('old source')};
}
function snapshot(dir: string) {
  const result = snapshotEntry(dir, 'example', true);
  expect(result).not.toBeNull();
  cleanup.push(result!.workDir);
  return result!;
}

it('keeps matching JS and bytecode after another generation replaces the cache', () => {
  const {dir, save} = fixture();
  fs.writeFileSync(bytecodePath(dir)!, 'old bytecode');
  const first = snapshot(dir);
  save('new source');
  fs.writeFileSync(bytecodePath(dir)!, 'new bytecode');
  const next = snapshot(dir);
  fs.rmSync(dir, {recursive: true, force: true});
  expect(fs.readFileSync(first.jsBundlePath, 'utf8')).toBe('old source');
  expect(fs.readFileSync(first.bundlePath, 'utf8')).toBe('old bytecode');
  expect(fs.readFileSync(next.jsBundlePath, 'utf8')).toBe('new source');
  expect(fs.readFileSync(next.bundlePath, 'utf8')).toBe('new bytecode');
});

it.each(['replacement', 'removal', 'source edit'] as const)('rejects a %s racing the artifact copy and removes the incomplete snapshot', mode => {
  const {dir, save, source} = fixture();
  const original = fs.copyFileSync.bind(fs);
  let destination: string | undefined;
  vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to, flags) => {
    original(from, to, flags);
    if (!destination && String(from) === path.join(dir, BUNDLE_FILE)) {
      destination = String(to);
      if (mode === 'replacement') save('new source');
      else if (mode === 'removal') fs.rmSync(dir, {recursive: true, force: true});
      else fs.writeFileSync(source, 'edited source with a different size');
    }
  });
  expect(snapshotEntry(dir, 'example', true)).toBeNull();
  expect(destination).toBeTruthy();
  expect(fs.existsSync(path.dirname(destination!))).toBe(false);
});

it('evicts only the bytecode generation selected by the failing invocation', () => {
  const {dir, save} = fixture();
  fs.writeFileSync(bytecodePath(dir)!, 'old bytecode');
  const first = snapshot(dir);
  save('new source');
  const current = bytecodePath(dir)!;
  fs.writeFileSync(current, 'new bytecode');
  discardBytecode(dir, first.bundlePath);
  expect(fs.readFileSync(current, 'utf8')).toBe('new bytecode');
  discardBytecode(dir, path.join(dir, BUNDLE_FILE));
  expect(fs.readFileSync(path.join(dir, BUNDLE_FILE), 'utf8')).toBe('new source');
  discardBytecode(dir, current);
  expect(fs.existsSync(current)).toBe(false);
});

it.each([null, {files: {}}, {dirs: {}}, {files: [null]}, {dirs: [null]}])('treats malformed cache metadata as a miss: %j', invalid => {
  const {dir} = fixture();
  const file = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify(invalid === null ? null : {...manifest, ...invalid}));
  expect(changedInputs(dir, 'example')).toBeNull();
  expect(snapshotEntry(dir, 'example', false)).toBeNull();
});

it('does not prevent JS fallback when the failed bytecode file is locked', () => {
  const {dir} = fixture();
  const hbc = bytecodePath(dir)!;
  fs.writeFileSync(hbc, 'invalid bytecode');
  const original = fs.rmSync.bind(fs);
  vi.spyOn(fs, 'rmSync').mockImplementation((file, options) => {
    if (String(file) === hbc) throw Object.assign(new Error('locked'), {code: 'EPERM'});
    return original(file, options);
  });
  expect(() => discardBytecode(dir, hbc)).not.toThrow();
  expect(fs.readFileSync(path.join(dir, BUNDLE_FILE), 'utf8')).toBe('old source');
});

it('does not validate copied generation A against newly published generation B inputs', () => {
  const {dir, save} = fixture();
  const manifest = path.join(dir, 'manifest.json');
  const original = fs.readFileSync.bind(fs);
  let reads = 0;
  vi.spyOn(fs, 'readFileSync').mockImplementation((file, options) => {
    if (String(file) === manifest && ++reads === 3) save('newer source revision');
    return original(file, options);
  });
  const result = snapshotEntry(dir, 'example', false);
  if (result) cleanup.push(result.workDir);
  expect(reads).toBe(3);
  expect(result).toBeNull();
});
