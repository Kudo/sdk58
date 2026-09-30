import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {loadProjectConfig, PRESETS, resolveSettings} from '../src/presets.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');

function tmpProject(config?: unknown): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-preset-')));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"p"}');
  fs.copyFileSync(path.join(ROOT, 'examples', 'basic', 'App.tsx'), path.join(dir, 'App.tsx'));
  if (config !== undefined) {
    fs.writeFileSync(path.join(dir, 'a11y-tree.json'), typeof config === 'string' ? config : JSON.stringify(config));
  }
  return dir;
}

test('resolveSettings: flag > config > preset', () => {
  assert.deepEqual(resolveSettings({preset: 'ios-phone'}, null), {preset: 'ios-phone', ...PRESETS['ios-phone'], tapMode: undefined, format: undefined});
  const config = {preset: 'android-phone' as const, width: 400, format: 'text'};
  const r = resolveSettings({height: 700, platform: 'a11ytree'}, config);
  assert.equal(r.preset, 'android-phone');
  assert.equal(r.platform, 'a11ytree'); // flag
  assert.equal(r.width, 400); // config
  assert.equal(r.height, 700); // flag
  assert.equal(r.headerHeight, 56); // preset
  assert.equal(r.format, 'text'); // config
  assert.equal(resolveSettings({preset: 'ios-tablet'}, config).width, 400); // config beats the --preset values
  assert.throws(() => resolveSettings({preset: 'watch'}, null), /unknown preset "watch"/);
});

test('loadProjectConfig validates keys and types', () => {
  assert.equal(loadProjectConfig(tmpProject()), null);
  assert.deepEqual(loadProjectConfig(tmpProject({preset: 'ios-phone', headerHeight: 50})), {preset: 'ios-phone', headerHeight: 50});
  assert.throws(() => loadProjectConfig(tmpProject({colour: 'red'})), /unknown key "colour"/);
  assert.throws(() => loadProjectConfig(tmpProject({width: 'wide'})), /"width" must be a number/);
  assert.throws(() => loadProjectConfig(tmpProject({safeAreaInsets: {top: 1}})), /safeAreaInsets/);
  assert.throws(() => loadProjectConfig(tmpProject('{nope')), /not valid JSON/);
  assert.throws(() => loadProjectConfig(tmpProject({preset: 'watch'})), /unknown preset/);
  assert.throws(() => loadProjectConfig(tmpProject({rules: {names: 'yes'}})), /"rules": "names" must be true, false or an object/);
});

test('CLI: a11y-tree.json supplies the platform and viewport; flags override', {timeout: 180_000}, () => {
  const dir = tmpProject({preset: 'android-tablet', height: 1000});
  const bundleOnly = (extra: string[]) =>
    spawnSync(process.execPath, [CLI, 'render', path.join(dir, 'App.tsx'), '--bundle-only', '--no-cache', ...extra], {
      cwd: ROOT,
      encoding: 'utf8',
    });
  const read = (proc: ReturnType<typeof bundleOnly>) => {
    assert.equal(proc.status, 0, proc.stderr);
    const bundlePath = /Bundle: (.+) \(\d+ bytes/.exec(proc.stderr)![1];
    const code = fs.readFileSync(bundlePath, 'utf8');
    fs.rmSync(path.dirname(bundlePath), {recursive: true, force: true});
    return code;
  };
  const code = read(bundleOnly([]));
  assert.match(code, /viewportWidth = 800/);
  assert.match(code, /viewportHeight = 1000/);
  assert.match(code, /headerHeight": 64/);
  assert.match(code, /"top": 24/);
  const overridden = read(bundleOnly(['--width', '320', '--header-height', '40']));
  assert.match(overridden, /viewportWidth = 320/);
  assert.match(overridden, /headerHeight": 40/);
  fs.rmSync(dir, {recursive: true, force: true});
});
