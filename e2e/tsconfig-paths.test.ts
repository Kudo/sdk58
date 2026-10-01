import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';
import {CLI, ROOT, E2E_PRESETS, hostSkip, hostBin} from './helpers.ts';

for (const preset of E2E_PRESETS) {
  it(`[${preset.name}] resolves Expo aliases, assets and platform variants; inherited edits invalidate the bundle`, {timeout: 180_000}, t => {
    if (hostSkip) t.skip(hostSkip);
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-alias-app-')));
    const write = (file: string, value: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, file)), {recursive: true});
      fs.writeFileSync(path.join(dir, file), value);
    };
    try {
      write('package.json', JSON.stringify({private: true, dependencies: {expo: '58.0.0'}}));
      fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'junction');
      write('tsconfig.json', '{"extends":"./base.json"}');
      const config = (folder: string) => JSON.stringify({extends: 'expo/tsconfig.base', compilerOptions: {paths: {
        '@/*': ['./missing/*', `./${folder}/*`], '@/assets/*': ['./assets/*'],
      }}});
      write('base.json', config('src'));
      write('App.tsx', `import React from 'react'; import {Text, View, Image} from 'react-native';
        import {label} from '@/components/view'; import icon from '@/assets/icon.png';
        export default function App() { return <View><Text>{label}</Text><Image source={icon} accessibilityLabel="aliased asset" style={{width: 12, height: 12}} /></View>; }`);
      write('src/components/view.ts', "export const label = 'wrong generic';");
      write(`src/components/view.${preset.platform}.ts`, `export const label = 'alias ${preset.platform}';`);
      write(`next/components/view.${preset.platform}.ts`, "export const label = 'updated inherited alias';");
      fs.mkdirSync(path.join(dir, 'assets'));
      fs.writeFileSync(path.join(dir, 'assets/icon.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6C3sAAAAASUVORK5CYII=', 'base64'));
      const render = () => {
        const result = spawnSync('node', [CLI, 'render', path.join(dir, 'App.tsx'), '--preset', preset.name, '--format', 'text', '--bytecode', 'off', '-v'], {
          cwd: dir, encoding: 'utf8', env: {...process.env, RN_A11Y_HOST_BIN: hostBin, RN_A11Y_TREE_CACHE_DIR: path.join(dir, '.cache')},
        });
        expect(result.status, result.stderr).toBe(0);
        return result;
      };
      const first = render();
      expect(first.stdout).toContain(`alias ${preset.platform}`);
      expect(first.stdout).toContain('aliased asset');
      expect(render().stderr).toContain('cached, js');
      write('base.json', config('next'));
      const edited = render();
      expect(edited.stdout).toContain('updated inherited alias');
      expect(edited.stderr).toContain('built, js');
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
}
