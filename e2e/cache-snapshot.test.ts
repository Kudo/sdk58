import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect, it, vi} from 'vitest';
import {bundle} from '../packages/react-native-a11y-tree/src/bundle.ts';
import {runHost} from '../packages/react-native-a11y-tree/src/host.ts';
import {convertShadowTree} from '../packages/react-native-a11y-tree/src/tree.ts';
import {E2E_PRESETS, get, hostBin, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] in-flight invocation snapshots render after the shared cache is removed`, {timeout: 180_000}, async t => {
    if (hostSkip) t.skip(hostSkip);
    const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-e2e-'));
    const artifacts: string[] = [];
    vi.stubEnv('RN_A11Y_TREE_CACHE_DIR', cache);
    vi.stubEnv('RN_A11Y_HOST_BIN', hostBin!);
    try {
      const options = {appPath: path.join(ROOT, 'examples/basic/App.tsx'), platform: preset.platform,
        viewportWidth: preset.width, viewportHeight: preset.height, bytecode: 'off' as const};
      const built = await bundle(options);
      if (built.workDir) artifacts.push(built.workDir);
      const cached = await bundle(options);
      if (cached.workDir) artifacts.push(cached.workDir);
      expect(built.cache).toBe('miss');
      expect(cached.cache).toBe('hit');
      fs.rmSync(cache, {recursive: true, force: true});
      // Both readers already selected their artifact, but neither host opened
      // it yet. Cache eviction must not affect execution or the rendered tree.
      for (const result of [built, cached]) {
        const payload = await runHost({bundlePath: result.bundlePath,
          windowWidth: preset.width, windowHeight: preset.height, quiet: true});
        expect(payload.source).toBe('shadowTree');
        if (payload.source !== 'shadowTree') throw new Error('Expected typed shadow tree');
        const root = convertShadowTree(payload.tree);
        expect(get(root, 'submit').name).toBe('Submit');
        expect(get(root, 'email').role).toBe('textbox');
      }
    } finally {
      vi.unstubAllEnvs();
      for (const dir of artifacts) fs.rmSync(dir, {recursive: true, force: true});
      fs.rmSync(cache, {recursive: true, force: true});
    }
  });
}
