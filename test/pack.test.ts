import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {elf, machO, pe} from './fixtures/fake-binaries.ts';
import {hasNpm, npmTool} from './fixtures/npm.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Files `npm pack --dry-run` would put into the tarball of `dir` (prepack runs). */
function packFiles(dir: string): Array<{path: string; size: number}> {
  const proc = npmTool('npm', ['pack', '--dry-run', '--json'], {cwd: dir, maxBuffer: 16 * 1024 * 1024});
  expect(proc.status, proc.stderr).toBe(0);
  // prepack output can precede the JSON.
  const json = JSON.parse(proc.stdout.slice(proc.stdout.indexOf('[')));
  return json[0].files;
}

describe('pack', () => {
  it('npm pack of the CLI: exactly the whitelisted 48 files, no release archives', {timeout: 300_000}, t => {
    if (!hasNpm) t.skip('npm is not available');
    // Release archives next to the package must never be packed (v0.1.0 shipped
    // dist/release/*.tar.gz inside the CLI tarball).
    const planted = [
      path.join(ROOT, 'release', 'pack-test-host.tar.gz'),
      path.join(ROOT, 'release', 'pack-test.tgz'),
      path.join(ROOT, 'dist', 'release', 'pack-test-host.tar.gz'),
      path.join(ROOT, 'dist', 'release', 'host-version.json'),
      path.join(ROOT, 'dist', 'pack-test.tgz'),
    ].filter(file => !fs.existsSync(file));
    const createdDirs = [path.join(ROOT, 'release'), path.join(ROOT, 'dist', 'release')].filter(dir => !fs.existsSync(dir));
    try {
      for (const file of planted) {
        fs.mkdirSync(path.dirname(file), {recursive: true});
        fs.writeFileSync(file, 'archive');
      }
      const files = packFiles(ROOT).map(f => f.path).sort();
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
      const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
      expect(manifest.bin).toEqual({'rn-a11y-tree': './dist/rn-a11y-tree.js'});
      const help = spawnSync('node', [path.join(ROOT, 'dist/rn-a11y-tree.js'), '--help'], {encoding: 'utf8'});
      expect(help.status, help.stderr).toBe(0);
      expect(help.stdout).toContain('render');
    } finally {
      for (const file of planted) fs.rmSync(file, {force: true});
      for (const dir of createdDirs) fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  it('npm pack separates the resolver from OS-filtered optional binary packages', {timeout: 120_000}, t => {
    if (!hasNpm) t.skip('npm is not available');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-host-npm-pack-'));
    try {
      const pkg = path.join(dir, 'rn-a11y-host');
      fs.cpSync(path.join(ROOT, 'packages', 'rn-a11y-host'), pkg, {
        recursive: true,
        filter: src => !/[\\/](osx-bin|linux64-bin|win64-bin|host-version\.json|index\.js|index\.d\.ts)$/.test(src),
      });
      const packed = spawnSync('bun', [
        path.join(ROOT, 'scripts', 'release-host.ts'), '--pack', '--package-dir', pkg,
        '--bin', `osx=${machO(path.join(dir, 'osx'), ['arm64', 'x86_64'])}`,
        '--bin', `linux64=${elf(path.join(dir, 'linux'))}`,
        '--bin', `win64=${pe(path.join(dir, 'win.exe'))}`,
      ], {encoding: 'utf8'});
      expect(packed.status, packed.stderr).toBe(0);
      const files = packFiles(pkg);
      expect(files.map(f => f.path).sort()).toStrictEqual([
        'LICENSE',
        'README.md',
        'host-version.json',
        'index.d.ts',
        'index.js',
        'package.json',
      ]);
      const resolver = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
      for (const [name, os, cpu, bin] of [
        ['rn-a11y-host-darwin', 'darwin', ['arm64', 'x64'], 'osx-bin/rn-a11y-host'],
        ['rn-a11y-host-linux-x64', 'linux', ['x64'], 'linux64-bin/rn-a11y-host'],
        ['rn-a11y-host-win32-x64', 'win32', ['x64'], 'win64-bin/rn-a11y-host.exe'],
      ] as const) {
        const platformDir = path.join(dir, name);
        const manifest = JSON.parse(fs.readFileSync(path.join(platformDir, 'package.json'), 'utf8'));
        expect(manifest.os).toEqual([os]);
        expect(manifest.cpu).toEqual(cpu);
        expect(resolver.optionalDependencies[name]).toBe(manifest.version);
        expect(packFiles(platformDir).map(f => f.path).sort()).toEqual([
          'LICENSE', 'README.md', 'host-version.json', bin, 'package.json',
        ].sort());
      }
      // Install actual tarballs with local optional specs: no unpublished registry
      // packages required, and npm must apply OS/CPU filtering itself.
      for (const name of Object.keys(resolver.optionalDependencies)) {
        const platformDir = path.join(dir, name);
        const packedPlatform = npmTool('npm', ['pack', '--json', '--pack-destination', dir], {cwd: platformDir});
        expect(packedPlatform.status, packedPlatform.stderr).toBe(0);
        const result = JSON.parse(packedPlatform.stdout.slice(packedPlatform.stdout.indexOf('[')));
        resolver.optionalDependencies[name] = `file:${path.join(dir, result[0].filename)}`;
      }
      fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify(resolver));
      const packedResolver = npmTool('npm', ['pack', '--json', '--pack-destination', dir], {cwd: pkg});
      expect(packedResolver.status, packedResolver.stderr).toBe(0);
      const resolverTarball = JSON.parse(packedResolver.stdout.slice(packedResolver.stdout.indexOf('[')))[0].filename;
      const app = path.join(dir, 'app');
      fs.mkdirSync(app);
      fs.writeFileSync(path.join(app, 'package.json'), '{"private":true}');
      const install = npmTool('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', path.join(dir, resolverTarball)], {cwd: app});
      expect(install.status, install.stderr).toBe(0);
      const selected = process.platform === 'darwin' ? 'rn-a11y-host-darwin' : `rn-a11y-host-${process.platform}-${process.arch}`;
      for (const name of Object.keys(resolver.optionalDependencies)) {
        expect(fs.existsSync(path.join(app, 'node_modules', name)), name).toBe(name === selected);
      }
      const resolve = () => spawnSync('node', ['--input-type=module', '-e', `
        import {getHostPath, getHostVersionPath} from 'rn-a11y-host';
        import fs from 'node:fs';
        console.log(JSON.stringify({bin: getHostPath(), manifest: JSON.parse(fs.readFileSync(getHostVersionPath()))}));
      `], {cwd: app, encoding: 'utf8'});
      const resolved = resolve();
      expect(resolved.status, resolved.stderr).toBe(0);
      const host = JSON.parse(resolved.stdout);
      expect(host.bin).toContain(selected + path.sep);
      expect(host.manifest.protocolVersion).toBe(1);
      expect(Object.keys(host.manifest.binaries)).toHaveLength(1);
      fs.rmSync(path.join(app, 'node_modules', selected), {recursive: true});
      const missing = resolve();
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain('HOST_UNAVAILABLE');
      expect(missing.stderr).toContain('npm install --include=optional');

    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});
