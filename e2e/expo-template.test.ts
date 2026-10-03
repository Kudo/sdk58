import path from 'node:path';
import {expect, it} from 'vitest';
import type {RenderResult, RunResult} from '../packages/react-native-a11y-tree/src/schema.ts';
import {cli, E2E_PRESETS, findAll, hostSkip, ROOT} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  for (const screen of ['explore', 'index']) {
    it(`[${preset.name}] unchanged SDK 58 starter ${screen} screen renders`, {timeout: 300_000}, t => {
      if (hostSkip) t.skip(hostSkip);
      const result = cli(['render', path.join(ROOT, `examples/sdk58-default/src/app/${screen}.tsx`)], preset);
      expect(result.status, result.stderr).toBe(0);
      const tree = (JSON.parse(result.stdout) as RenderResult).root;
      expect(findAll(tree, n => !!n.text?.includes(screen === 'explore' ? 'Explore' : 'Welcome to'))).not.toHaveLength(0);
      expect(findAll(tree, n => n.box.width > 0 && n.box.height > 0)).not.toHaveLength(0);
      if (screen === 'explore') {
        const imagesHeading = findAll(tree, n => n.text === 'Images')[0];
        expect(imagesHeading).toBeDefined();
        const opened = cli(['run', path.join(ROOT, 'examples/sdk58-default/src/app/explore.tsx'), '--script', JSON.stringify([{tap: {key: imagesHeading.key}}])], preset);
        expect(opened.status, opened.stderr).toBe(0);
        const final = (JSON.parse(opened.stdout) as RunResult).final;
        expect(findAll(final, n => n.type === 'Expo.ExpoImage' && n.box.width === 100 && n.box.height === 100)).toHaveLength(1);
      }
      expect(result.stderr.match(/\[NATIVE_MODULE_FALLBACK\] ExpoImage\b/g)).toHaveLength(1);
    });
  }
}
