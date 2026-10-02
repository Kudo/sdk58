import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect, it, vi} from 'vitest';
import {bundle} from '../packages/react-native-a11y-tree/src/bundle.ts';
import {BUNDLE_FILE, bytecodePath} from '../packages/react-native-a11y-tree/src/bundleCache.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

it.each(['remove', 'rename'] as const)('keeps the freshly built JS when cache publication cannot %s a locked entry', async operation => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-publication-'));
  const saved = process.env.RN_A11Y_TREE_CACHE_DIR;
  process.env.RN_A11Y_TREE_CACHE_DIR = cache;
  let temporary: string | null = null;
  try {
    const options = {appPath: path.join(ROOT, 'examples/basic/App.tsx'), platform: 'android', viewportWidth: 390, viewportHeight: 844, bytecode: 'off' as const};
    const first = await bundle(options);
    const dir = first.cacheDir!;
    fs.writeFileSync(path.join(dir, BUNDLE_FILE), 'stale cached JS');
    fs.writeFileSync(bytecodePath(dir)!, 'stale cached bytecode');
    const error = Object.assign(new Error('locked cache entry'), {code: 'EPERM'});
    if (operation === 'remove') {
      const original = fs.rmSync.bind(fs);
      vi.spyOn(fs, 'rmSync').mockImplementation((file, args) => {
        if (String(file) === dir) throw error;
        return original(file, args);
      });
    } else {
      const original = fs.renameSync.bind(fs);
      vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
        if (String(to) === dir) throw error;
        return original(from, to);
      });
    }
    const rebuilt = await bundle({...options, bytecode: 'on', resetCache: true});
    temporary = rebuilt.workDir;
    expect(rebuilt).toMatchObject({cache: 'off', cacheDir: null, bytecode: false});
    expect(temporary).not.toBeNull();
    expect(rebuilt.bundlePath).toBe(rebuilt.jsBundlePath);
    expect(fs.readFileSync(rebuilt.bundlePath, 'utf8')).toContain('Submit');
    expect(fs.readFileSync(rebuilt.bundlePath, 'utf8')).not.toBe('stale cached JS');
    expect(fs.readdirSync(path.join(cache, 'bundles')).filter(name => name.startsWith('.tmp-'))).toEqual([]);
  } finally {
    vi.restoreAllMocks();
    if (saved === undefined) delete process.env.RN_A11Y_TREE_CACHE_DIR;
    else process.env.RN_A11Y_TREE_CACHE_DIR = saved;
    if (temporary) fs.rmSync(temporary, {recursive: true, force: true});
    fs.rmSync(cache, {recursive: true, force: true});
  }
});
