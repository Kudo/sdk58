import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {expect, it} from 'vitest';
import {assetKey, hostFileName} from '../packages/react-native-a11y-tree/src/hostDownload.ts';
import {TESTED_DEPENDENCIES} from '../packages/react-native-a11y-tree/src/compatibility.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree/src/cli.ts');
const fake = path.join(ROOT, 'test/fixtures/fake-host.ts');
const run = (args: string[]) => spawnSync('node', [CLI, ...args], {encoding: 'utf8', cwd: ROOT, env: {...process.env, RN_A11Y_HOST_BIN: fake}});

it('doctor returns dependency and host reports without executing the host or bundling an app', () => {
  // The fake host would fail without a bundle if doctor tried to execute it.
  const proc = run(['doctor', 'examples/basic/App.tsx']);
  expect(proc.status, proc.stderr).toBe(0);
  expect(JSON.parse(proc.stdout)).toMatchObject({ok: true, tested: true, strict: false, host: {found: true, info: {bin: fake}}});
  expect(proc.stderr).not.toContain('Bundle');
});

it('doctor --strict rejects untested installed dependencies and reports missing ones', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-doctor-'));
  try {
    fs.writeFileSync(path.join(project, 'package.json'), '{"name":"app"}');
    for (const name of ['expo', 'react', 'react-native'] as const) {
      const dir = path.join(project, 'node_modules', name);
      fs.mkdirSync(dir, {recursive: true});
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name, version: name === 'expo' ? '58.0.1' : TESTED_DEPENDENCIES[name]}));
    }
    const normal = run(['doctor', project]);
    expect(normal.status, normal.stderr).toBe(0);
    expect(JSON.parse(normal.stdout)).toMatchObject({ok: true, tested: false});
    const strict = run(['doctor', project, '--strict']);
    expect(strict.status, strict.stderr).toBe(1);
    expect(JSON.parse(strict.stdout)).toMatchObject({ok: false, tested: false, strict: true});
    fs.rmSync(path.join(project, 'node_modules'), {recursive: true});
    const missing = run(['doctor', project]);
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).issues).toHaveLength(3);
  } finally {fs.rmSync(project, {recursive: true, force: true});}
});

it('renders refuse a host manifest with an incompatible RN line before Metro runs', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-host-manifest-'));
  try {
    const bin = path.join(temp, 'host');
    fs.writeFileSync(bin, 'not an executable');
    fs.writeFileSync(path.join(temp, 'host-version.json'), '{"reactNative":"0.87.0","protocolVersion":1}');
    for (const command of ['render', 'session']) {
      const proc = spawnSync('node', [CLI, command, 'examples/basic/App.tsx', '--preset', 'android-phone', '--format', 'json'], {
        cwd: ROOT, encoding: 'utf8', input: '', env: {...process.env, RN_A11Y_HOST_BIN: bin},
      });
      expect(proc.status, proc.stderr).toBe(5);
      expect(JSON.parse(proc.stdout).error).toMatchObject({code: 'HOST_INCOMPATIBLE'});
      expect(proc.stderr).not.toContain('Bundle');
    }
  } finally {fs.rmSync(temp, {recursive: true, force: true});}
});


it('doctor selects the cached download ahead of checkout dist without executing or fetching it', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-doctor-cache-'));
  try {
    const manifest = path.join(temp, 'manifest.json');
    const dir = path.join(temp, 'cache', 'test-version');
    fs.mkdirSync(dir, {recursive: true});
    const bin = path.join(dir, hostFileName());
    fs.writeFileSync(bin, 'not executable');
    fs.writeFileSync(path.join(dir, '.sha256'), 'test-digest');
    fs.writeFileSync(manifest, JSON.stringify({version: 'test-version', reactNative: '0.87.0', protocolVersion: 1, assets: {[assetKey()]: {file: 'missing.tar.gz', sha256: 'test-digest'}}}));
    const proc = spawnSync('node', [CLI, 'doctor', 'examples/basic/App.tsx'], {cwd: ROOT, encoding: 'utf8', env: {...process.env,
      RN_A11Y_HOST_BIN: '', RN_A11Y_HOST_SKIP_PACKAGE: '1', RN_A11Y_HOST_BASE_URL: 'http://127.0.0.1:1',
      RN_A11Y_HOST_CACHE_DIR: path.join(temp, 'cache'), RN_A11Y_HOST_MANIFEST: manifest,
    }});
    expect(proc.status, proc.stderr).toBe(1);
    expect(JSON.parse(proc.stdout)).toMatchObject({ok: false, host: {found: true, info: {source: 'download', bin, rnVersion: '0.87.0'}}});
  } finally {fs.rmSync(temp, {recursive: true, force: true});}
});
