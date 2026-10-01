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
    } finally {
      for (const file of planted) fs.rmSync(file, {force: true});
      for (const dir of createdDirs) fs.rmSync(dir, {recursive: true, force: true});
    }
  });

  it('npm pack of rn-a11y-host: 9 files with the osx, linux64 and win64 binaries (fake binaries)', {timeout: 120_000}, t => {
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
        'linux64-bin/rn-a11y-host',
        'osx-bin/rn-a11y-host',
        'package.json',
        'win64-bin/rn-a11y-host.exe',
      ]);
      const binaries = JSON.parse(packed.stdout).binaries as Record<string, {size: number}>;
      expect(Object.fromEntries(files.filter(f => f.path.includes('-bin/')).map(f => [f.path, f.size]))).toStrictEqual(
        Object.fromEntries(Object.entries(binaries).map(([file, info]) => [file, info.size])),
      );
    } finally {
      fs.rmSync(dir, {recursive: true, force: true});
    }
  });
});
