import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {elf, machO, pe} from './fixtures/fake-binaries.ts';
import {hasNpm, npmTool} from './fixtures/npm.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CLI_ROOT = path.join(ROOT, 'packages/react-native-a11y-tree');

/** Files `npm pack --dry-run` would put into the tarball of `dir` (prepack runs). */
function packFiles(dir: string): Array<{path: string; size: number}> {
  const proc = npmTool('npm', ['pack', '--dry-run', '--json'], {cwd: dir, maxBuffer: 16 * 1024 * 1024});
  expect(proc.status, proc.stderr).toBe(0);
  // prepack output can precede the JSON.
  const json = JSON.parse(proc.stdout.slice(proc.stdout.indexOf('[')));
  return json[0].files;
}

describe('pack', () => {
  it('keeps the workspace root private', () => {
    const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(root.private).toBe(true);
    expect(root.bin).toBeUndefined();
  });
  it('npm pack of the CLI: exactly the whitelisted 48 files, no release archives', {timeout: 300_000}, t => {
    if (!hasNpm) t.skip('npm is not available');
    // Release archives next to the package must never be packed (v0.1.0 shipped
    // dist/release/*.tar.gz inside the CLI tarball).
    const planted = [
      path.join(ROOT, 'release', 'pack-test-host.tar.gz'),
      path.join(ROOT, 'release', 'pack-test.tgz'),
      path.join(ROOT, 'packages/react-native-a11y-tree', 'dist', 'release', 'pack-test-host.tar.gz'),
      path.join(ROOT, 'packages/react-native-a11y-tree', 'dist', 'release', 'host-version.json'),
      path.join(ROOT, 'packages/react-native-a11y-tree', 'dist', 'pack-test.tgz'),
    ].filter(file => !fs.existsSync(file));
    const createdDirs = [path.join(ROOT, 'release'), path.join(ROOT, 'packages/react-native-a11y-tree', 'dist', 'release')].filter(dir => !fs.existsSync(dir));
    try {
      for (const file of planted) {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, 'archive');
      }
      const files = packFiles(CLI_ROOT).map(f => f.path).sort();
      expect(files.filter(f => /\.(tgz|tar\.gz)$/.test(f) || f.includes('release/'))).toStrictEqual([]);
      const top = new Map<string, number>();
      for (const f of files) top.set(f.split('/')[0], (top.get(f.split('/')[0]) ?? 0) + 1);
      expect(Object.fromEntries([...top].sort())).toStrictEqual({
        LICENSE: 1,
        'README.md': 1,
        dist: 1,
        'package.json': 1,
        runtime: 28,
        schema: 10,
        tools: 6,
      });
      expect(files.length).toBe(48);
      expect(files).toContain('dist/rn-a11y-tree.js');
      if (process.platform !== 'win32') expect(fs.statSync(path.join(ROOT, 'packages/react-native-a11y-tree', 'dist/rn-a11y-tree.js')).mode & 0o111).toBeTruthy();
      const manifest = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8'));
      expect(manifest.bin).toEqual({'rn-a11y-tree': './dist/rn-a11y-tree.js'});
      const help = spawnSync('node', [path.join(ROOT, 'packages/react-native-a11y-tree', 'dist/rn-a11y-tree.js'), '--help'], {encoding: 'utf8'});
      expect(help.status, help.stderr).toBe(0);
      expect(help.stdout).toContain('render');
      // The executable must start without any JavaScript packages installed.
      const standalone = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-standalone-'));
      try {
        const entry = path.join(standalone, 'cli.mjs');
        fs.copyFileSync(path.join(ROOT, 'packages/react-native-a11y-tree', 'dist/rn-a11y-tree.js'), entry);
        fs.chmodSync(entry, 0o755);
        const result = process.platform === 'win32'
          ? spawnSync('node', [entry, '--help'], {cwd: standalone, encoding: 'utf8'})
          : spawnSync(entry, ['--help'], {cwd: standalone, encoding: 'utf8'});
        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).toContain('render');
      } finally {
        fs.rmSync(standalone, {recursive: true, force: true});
      }
    } finally {
      for (const file of planted) fs.rmSync(file, {force: true});
      for (const dir of createdDirs) fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  it('CLI directly installs only its matching optional runtime package', {timeout: 120_000}, t => {
    if (!hasNpm) t.skip('npm is not available');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-runtime-pack-'));
    try {
      const packages = path.join(dir, 'packages');
      const packed = spawnSync('bun', [
        path.join(ROOT, 'scripts', 'release-host.ts'), '--pack', '--packages-dir', packages,
        '--bin', `osx=${machO(path.join(dir, 'osx'), ['arm64', 'x86_64'])}`,
        '--bin', `linux64=${elf(path.join(dir, 'linux'))}`,
        '--bin', `win64=${pe(path.join(dir, 'win.exe'))}`,
      ], {encoding: 'utf8'});
      expect(packed.status, packed.stderr).toBe(0);
      const cli = JSON.parse(fs.readFileSync(path.join(CLI_ROOT, 'package.json'), 'utf8'));
      expect(cli.dependencies ?? {}).toEqual({});
      expect(Object.keys(cli.optionalDependencies).sort()).toEqual([
        '@react-native-a11y-tree/runtime-darwin-universal',
        '@react-native-a11y-tree/runtime-linux-x64-gnu',
        '@react-native-a11y-tree/runtime-win32-x64-msvc',
      ]);
      for (const [suffix, os, cpu, bin] of [
        ['darwin-universal', 'darwin', ['arm64', 'x64'], 'osx-bin/rn-a11y-host'],
        ['linux-x64-gnu', 'linux', ['x64'], 'linux64-bin/rn-a11y-host'],
        ['win32-x64-msvc', 'win32', ['x64'], 'win64-bin/rn-a11y-host.exe'],
      ] as const) {
        const platformDir = path.join(packages, `runtime-${suffix}`);
        const manifest = JSON.parse(fs.readFileSync(path.join(platformDir, 'package.json'), 'utf8'));
        expect(manifest.name).toBe(`@react-native-a11y-tree/runtime-${suffix}`);
        expect(manifest.os).toEqual([os]);
        expect(manifest.cpu).toEqual(cpu);
        expect(manifest.libc).toEqual(os === 'linux' ? ['glibc'] : undefined);
        expect(cli.optionalDependencies[manifest.name]).toBe(manifest.version);
        expect(packFiles(platformDir).map(f => f.path).sort()).toEqual([
          'LICENSE', 'README.md', 'host-version.json', bin, 'package.json',
        ].sort());
        const tar = npmTool('npm', ['pack', '--json', '--pack-destination', dir], {cwd: platformDir});
        expect(tar.status, tar.stderr).toBe(0);
        const result = JSON.parse(tar.stdout.slice(tar.stdout.indexOf('[')));
        cli.optionalDependencies[manifest.name] = `file:${path.join(dir, result[0].filename)}`;
      }
      // Stage the CLI's real published files with local optional specs so this
      // test does not require publishing the new packages to the registry.
      const stage = path.join(dir, 'cli');
      for (const file of packFiles(CLI_ROOT)) {
        const target = path.join(stage, file.path);
        fs.mkdirSync(path.dirname(target), {recursive: true});
        fs.copyFileSync(path.join(CLI_ROOT, file.path), target);
      }
      delete cli.scripts;
      delete cli.devDependencies;
      delete cli.workspaces;
      fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(cli));
      const tar = npmTool('npm', ['pack', '--json', '--pack-destination', dir], {cwd: stage});
      expect(tar.status, tar.stderr).toBe(0);
      const filename = JSON.parse(tar.stdout.slice(tar.stdout.indexOf('[')))[0].filename;
      const app = path.join(dir, 'app');
      fs.mkdirSync(app);
      fs.writeFileSync(path.join(app, 'package.json'), '{"private":true}');
      const install = (omit = false) => npmTool('npm', [
        'install', '--legacy-peer-deps', '--ignore-scripts', '--no-audit', '--no-fund',
        ...(omit ? ['--omit=optional'] : []), path.join(dir, filename),
      ], {cwd: app});
      const installed = install();
      expect(installed.status, installed.stderr).toBe(0);
      const suffix = process.platform === 'darwin' ? 'darwin-universal' : process.platform === 'linux' ? 'linux-x64-gnu' : 'win32-x64-msvc';
      const selected = `@react-native-a11y-tree/runtime-${suffix}`;
      for (const name of Object.keys(cli.optionalDependencies)) {
        expect(fs.existsSync(path.join(app, 'node_modules', name)), name).toBe(name === selected);
      }
      expect(fs.existsSync(path.join(app, 'node_modules/rn-a11y-host'))).toBe(false);
      const installedCli = path.join(app, 'node_modules/react-native-a11y-tree');
      expect(fs.readdirSync(path.join(installedCli, 'dist'))).toEqual(['rn-a11y-tree.js']);
      // Bundle the actual host-resolution code next to the installed CLI to
      // inspect its selected path/protocol without executing the fake binary.
      const probe = path.join(installedCli, 'dist/probe.js');
      const build = spawnSync('bun', ['build', path.join(ROOT, 'packages/react-native-a11y-tree', 'src/host.ts'), '--target', 'node', '--format', 'esm', '--outfile', probe], {encoding: 'utf8'});
      expect(build.status, build.stderr).toBe(0);
      const env = {...process.env, RN_A11Y_HOST_BIN: '', RN_A11Y_HOST_BASE_URL: '', RN_A11Y_HOST_SKIP_PACKAGE: ''};
      const resolve = () => spawnSync('node', ['--input-type=module', '-e', `
        import {ensureHost} from ${JSON.stringify(pathToFileURL(probe).href)};
        console.log(JSON.stringify(await ensureHost()));
      `], {cwd: app, encoding: 'utf8', env});
      const resolved = resolve();
      expect(resolved.status, resolved.stderr).toBe(0);
      const host = JSON.parse(resolved.stdout);
      expect(host.bin).toContain(`runtime-${suffix}` + path.sep);
      expect(host.protocolVersion).toBe(1);
      expect(host.source).toBe('package');
      const omitted = install(true);
      expect(omitted.status, omitted.stderr).toBe(0);
      expect(fs.existsSync(path.join(app, 'node_modules', selected))).toBe(false);
      const missing = resolve();
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain('HOST_MISSING');
      expect(missing.stderr).toContain('npm install --include=optional');
      const help = spawnSync('node', [path.join(installedCli, 'dist/rn-a11y-tree.js'), '--help'], {encoding: 'utf8', env});
      expect(help.status, help.stderr).toBe(0);
      const schema = spawnSync('node', [path.join(installedCli, 'dist/rn-a11y-tree.js'), 'schema', 'script'], {encoding: 'utf8', env});
      expect(schema.status, schema.stderr).toBe(0);
      expect(JSON.parse(schema.stdout)).toEqual(JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/react-native-a11y-tree', 'schema/script.json'), 'utf8')));
      const npxHelp = npmTool('npx', ['--no-install', 'react-native-a11y-tree', '--help'], {cwd: app, env});
      expect(npxHelp.status, npxHelp.stderr).toBe(0);
      expect(npxHelp.stdout).toContain('render');
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});
