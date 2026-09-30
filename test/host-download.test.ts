import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {assetKey, downloadHost, type HostManifest} from '../src/hostDownload.ts';
import {DEFAULT_HOST_BIN} from '../src/host.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'bin', 'rn-a11y-tree.js');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.js');

/** A release made by scripts/release-host.mjs from a wrapper around the fake host. */
function makeRelease() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-host-dl-')));
  const bin = path.join(dir, 'fake-bin');
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${FAKE_HOST}" "$@"\n`);
  fs.chmodSync(bin, 0o755);
  const out = path.join(dir, 'release');
  const stdout = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'release-host.mjs'), '--bin', bin, '--out', out], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const manifest = JSON.parse(stdout) as HostManifest;
  return {dir, out, manifest, manifestFile: path.join(out, 'host-version.json'), cache: path.join(dir, 'cache')};
}

function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  return fn().finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

test('release-host.mjs writes a tarball, its sha256 and host-version.json', () => {
  const release = makeRelease();
  const {manifest} = release;
  assert.match(manifest.version, /^\d+\.\d+\.\d+(-rc\.\d+)?-[0-9a-f]{12}$/);
  assert.match(String(manifest.submoduleCommit), /^[0-9a-f]{40}$/);
  assert.match(String(manifest.overlayHash), /^[0-9a-f]{64}$/);
  assert.equal(typeof (manifest.nativeLibs as Record<string, string>)['react-native-screens'], 'string');
  const asset = manifest.assets[assetKey()];
  assert.equal(asset.file, `rn-a11y-host-${manifest.version}-${assetKey()}.tar.gz`);
  const tar = path.join(release.out, asset.file);
  assert.equal(fs.readFileSync(`${tar}.sha256`, 'utf8'), `${asset.sha256}  ${asset.file}\n`);
  assert.deepEqual(execFileSync('tar', ['-tzf', tar], {encoding: 'utf8'}).trim().split('\n').sort(), [
    'host-version.json',
    'rn-a11y-host',
  ]);
  assert.deepEqual(JSON.parse(fs.readFileSync(release.manifestFile, 'utf8')), manifest);
  fs.rmSync(release.dir, {recursive: true, force: true});
});

test('downloadHost: file:// download, sha256 check, cache reuse, errors', async () => {
  const release = makeRelease();
  const baseUrl = pathToFileURL(release.out).href;
  await withEnv({RN_A11Y_HOST_MANIFEST: release.manifestFile, RN_A11Y_HOST_CACHE_DIR: release.cache}, async () => {
    const logs: string[] = [];
    const bin = await downloadHost({baseUrl, log: l => logs.push(l)});
    assert.equal(bin, path.join(release.cache, release.manifest.version, 'rn-a11y-host'));
    assert.ok(fs.statSync(bin).mode & 0o100);
    assert.match(logs[0], /downloading host .* from file:/);
    assert.deepEqual(fs.readdirSync(release.cache), [release.manifest.version]); // no temp dirs left

    // Cached: no download (the archive is gone).
    const asset = release.manifest.assets[assetKey()];
    fs.renameSync(path.join(release.out, asset.file), path.join(release.dir, 'moved.tar.gz'));
    logs.length = 0;
    assert.equal(await downloadHost({baseUrl, log: l => logs.push(l)}), bin);
    assert.deepEqual(logs, []);

    // A wrong checksum in the manifest: the cache does not match and the download is rejected.
    fs.renameSync(path.join(release.dir, 'moved.tar.gz'), path.join(release.out, asset.file));
    const bad = {...release.manifest, assets: {[assetKey()]: {...asset, sha256: '0'.repeat(64)}}};
    const badFile = path.join(release.dir, 'bad.json');
    fs.writeFileSync(badFile, JSON.stringify(bad));
    await withEnv({RN_A11Y_HOST_MANIFEST: badFile}, () =>
      assert.rejects(downloadHost({baseUrl}), /sha256 mismatch .* expected 0{64}/),
    );
    const other = {...release.manifest, assets: {'plan9-mips': asset}};
    fs.writeFileSync(badFile, JSON.stringify(other));
    await withEnv({RN_A11Y_HOST_MANIFEST: badFile}, () =>
      assert.rejects(downloadHost({baseUrl}), new RegExp(`has no host for ${assetKey()} \\(has: plan9-mips\\)`)),
    );
    await withEnv({RN_A11Y_HOST_MANIFEST: path.join(release.dir, 'missing.json')}, () =>
      assert.rejects(downloadHost({baseUrl}), /no host-version\.json/),
    );
    await withEnv({RN_A11Y_HOST_CACHE_DIR: path.join(release.dir, 'cache2')}, () =>
      assert.rejects(downloadHost({baseUrl: pathToFileURL(release.dir).href}), /ENOENT/),
    );
  });
  fs.rmSync(release.dir, {recursive: true, force: true});
});

test('CLI uses the downloaded host (RN_A11Y_HOST_BASE_URL, fake host)', {timeout: 180_000}, () => {
  const release = makeRelease();
  const env = {
    ...process.env,
    RN_A11Y_HOST_BIN: '',
    RN_A11Y_HOST_BASE_URL: pathToFileURL(release.out).href,
    RN_A11Y_HOST_MANIFEST: release.manifestFile,
    RN_A11Y_HOST_CACHE_DIR: release.cache,
  };
  const proc = spawnSync(process.execPath, [CLI, 'render', APP, '--platform', 'android', '--no-quiet'], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stderr, /downloading host/);
  assert.equal(JSON.parse(proc.stdout).source, 'mounted'); // the fake host's default payload
  assert.ok(fs.existsSync(path.join(release.cache, release.manifest.version, 'rn-a11y-host')));

  // A failed download falls back to native/dist (with a warning), else HOST_MISSING.
  const failed = spawnSync(process.execPath, [CLI, 'render', APP, '--platform', 'android', '--no-quiet', '--format', 'text'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: {...env, RN_A11Y_HOST_BASE_URL: 'file:///nonexistent', RN_A11Y_HOST_CACHE_DIR: path.join(release.dir, 'c2')},
  });
  if (fs.existsSync(DEFAULT_HOST_BIN)) {
    assert.equal(failed.status, 0, failed.stderr);
    assert.match(failed.stderr, /warning: prebuilt host download failed \(.*ENOENT.*\); using .*native\/dist/);
  } else {
    assert.equal(failed.status, 5);
    const {error} = JSON.parse(failed.stderr.trim().split('\n').pop()!);
    assert.equal(error.code, 'HOST_MISSING');
    assert.match(error.message, /Prebuilt host download failed/);
  }
  fs.rmSync(release.dir, {recursive: true, force: true});
});
