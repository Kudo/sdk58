import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {loadProjectConfig, PRESETS, resolveSettings} from '../packages/react-native-a11y-tree/src/presets.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree', 'src', 'cli.ts');

function tmpProject(config?: unknown): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-preset-')));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}');
  fs.copyFileSync(path.join(ROOT, 'examples', 'basic', 'App.tsx'), path.join(dir, 'App.tsx'));
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, 'a11y-tree.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return dir;
}

describe('presets', () => {
  it('resolveSettings: flag > config > preset', () => {
    expect(resolveSettings({preset: 'ios-phone'}, null)).toStrictEqual({preset: 'ios-phone', ...PRESETS['ios-phone'], tapMode: undefined, format: undefined});
    const config = {preset: 'android-phone' as const, width: 400, format: 'text'};
    const r = resolveSettings({height: 700, platform: 'a11ytree'}, config);
    expect(r.preset).toBe('android-phone');
    expect(r.platform).toBe('a11ytree'); // flag
    expect(r.width).toBe(400); // config
    expect(r.height).toBe(700); // flag
    expect(r.headerHeight).toBe(56); // preset
    expect(r.format).toBe('text'); // config
    expect(resolveSettings({preset: 'ios-tablet'}, config).width).toBe(400); // config beats the --preset values
    expect(() => resolveSettings({preset: 'watch'}, null)).toThrow(/unknown preset "watch"/);
  });

  it('loadProjectConfig validates keys and types', () => {
    expect(loadProjectConfig(tmpProject())).toBe(null);
    expect(loadProjectConfig(tmpProject({preset: 'ios-phone', headerHeight: 50}))).toStrictEqual({preset: 'ios-phone', headerHeight: 50});
    expect(() => loadProjectConfig(tmpProject({colour: 'red'}))).toThrow(/unknown key "colour"/);
    expect(() => loadProjectConfig(tmpProject({width: 'wide'}))).toThrow(/"width" must be a number/);
    expect(() => loadProjectConfig(tmpProject({scale: 0}))).toThrow(/"scale" must be a number > 0/);
    expect(resolveSettings({preset: 'ios-tablet'}, null).scale).toBe(2);
    expect(resolveSettings({preset: 'android-phone', scale: 2.625}, null).scale).toBe(2.625);
    expect(() => loadProjectConfig(tmpProject({safeAreaInsets: {top: 1}}))).toThrow(/safeAreaInsets/);
    expect(() => loadProjectConfig(tmpProject('{nope'))).toThrow(/not valid JSON/);
    expect(() => loadProjectConfig(tmpProject({preset: 'watch'}))).toThrow(/unknown preset/);
    expect(() => loadProjectConfig(tmpProject({rules: {names: 'yes'}}))).toThrow(/"rules": "names" must be true, false or an object/);
  });

  it('CLI: a11y-tree.json supplies the platform and viewport; flags override', {timeout: 180_000}, () => {
    const dir = tmpProject({preset: 'android-tablet', height: 1000});
    const bundleOnly = (extra: string[]) =>
      spawnSync('node', [CLI, 'render', path.join(dir, 'App.tsx'), '--bundle-only', '--no-cache', ...extra], {
        cwd: ROOT,
        encoding: 'utf8',
      });
    const read = (proc: ReturnType<typeof bundleOnly>) => {
      expect(proc.status, proc.stderr).toBe(0);
      const bundlePath = /Bundle: (.+) \(\d+ bytes/.exec(proc.stderr)![1];
      const code = fs.readFileSync(bundlePath, 'utf8');
      fs.rmSync(path.dirname(bundlePath), {recursive: true, force: true});
      return code;
    };
    const code = read(bundleOnly([]));
    expect(code).toMatch(/viewportWidth = 800/);
    expect(code).toMatch(/viewportHeight = 1000/);
    expect(code).toMatch(/headerHeight": 64/);
    expect(code).toMatch(/"top": 24/);
    // Dimensions/PixelRatio: viewport, the preset's scale (tablet 2), font scale 1.
    expect(code).toMatch(/"deviceMetrics": \{\s*"width": 800,\s*"height": 1000,\s*"scale": 2,\s*"fontScale": 1\s*\}/);
    const overridden = read(bundleOnly(['--width', '320', '--header-height', '40', '--scale', '1.5', '--font-scale', '1.3']));
    expect(overridden).toMatch(/"deviceMetrics": \{\s*"width": 320,\s*"height": 1000,\s*"scale": 1.5,\s*"fontScale": 1.3\s*\}/);
    expect(overridden).toMatch(/viewportWidth = 320/);
    expect(overridden).toMatch(/headerHeight": 40/);
    fs.rmSync(dir, {recursive: true, force: true});
  });
});
