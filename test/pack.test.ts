import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hasNpm = spawnSync('npm', ['--version'], {stdio: 'ignore'}).status === 0;

/** Files `npm pack --dry-run` would put into the tarball of `dir` (prepack runs). */
function packFiles(dir: string): Array<{path: string; size: number}> {
  const proc = spawnSync('npm', ['pack', '--dry-run', '--json'], {cwd: dir, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024});
  assert.equal(proc.status, 0, proc.stderr);
  // prepack output can precede the JSON.
  const json = JSON.parse(proc.stdout.slice(proc.stdout.indexOf('[')));
  return json[0].files;
}

test('npm pack of the CLI: exactly the whitelisted 48 files, no release archives', {skip: !hasNpm && 'npm is not available', timeout: 300_000}, () => {
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
    assert.deepEqual(files.filter(f => /\.(tgz|tar\.gz)$/.test(f) || f.includes('release/')), []);
    const top = new Map<string, number>();
    for (const f of files) top.set(f.split('/')[0], (top.get(f.split('/')[0]) ?? 0) + 1);
    assert.deepEqual(Object.fromEntries([...top].sort()), {
      LICENSE: 1,
      'README.md': 1,
      dist: 1,
      'package.json': 1,
      runtime: 28,
      schema: 10,
      tools: 6,
    });
    assert.equal(files.length, 48);
    assert.ok(files.includes('dist/rn-a11y-tree.js'));
  } finally {
    for (const file of planted) fs.rmSync(file, {force: true});
    for (const dir of createdDirs) fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('npm pack of rn-a11y-host: 7 files with the host binary', {
  skip: !hasNpm ? 'npm is not available' : !fs.existsSync(path.join(ROOT, 'packages/rn-a11y-host/osx-bin/rn-a11y-host')) && 'osx-bin is not staged (bun scripts/release-host.ts --pack)',
  timeout: 120_000,
}, () => {
  const files = packFiles(path.join(ROOT, 'packages', 'rn-a11y-host'));
  assert.deepEqual(files.map(f => f.path).sort(), [
    'LICENSE',
    'README.md',
    'host-version.json',
    'index.d.ts',
    'index.js',
    'osx-bin/rn-a11y-host',
    'package.json',
  ]);
  const bin = files.find(f => f.path === 'osx-bin/rn-a11y-host')!;
  assert.equal(bin.size, fs.statSync(path.join(ROOT, 'packages/rn-a11y-host/osx-bin/rn-a11y-host')).size);
});
