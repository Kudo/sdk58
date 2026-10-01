import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {assetKey, downloadHost, hostFileName, type HostManifest} from '../packages/react-native-a11y-tree/src/hostDownload.ts';
import {DEFAULT_HOST_BIN} from '../packages/react-native-a11y-tree/src/host.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree', 'src', 'cli.ts');
const APP = path.join(ROOT, 'examples', 'basic', 'App.tsx');
const FAKE_HOST = path.join(ROOT, 'test', 'fixtures', 'fake-host.ts');

/**
 * A release made by scripts/release-host.ts from a wrapper around the fake
 * host: a script that imports it, run with RN_A11Y_HOST_RUNNER=bun (also on
 * Windows, which has no shebangs).
 */
function makeRelease() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-host-dl-')));
  const bin = path.join(dir, 'fake-bin');
  fs.writeFileSync(bin, `#!/usr/bin/env bun\nawait import(${JSON.stringify(pathToFileURL(FAKE_HOST).href)});\n`);
  fs.chmodSync(bin, 0o755);
  const out = path.join(dir, 'release');
  const stdout = execFileSync('bun', [path.join(ROOT, 'scripts', 'release-host.ts'), '--bin', bin, '--out', out], {
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

describe('host-download', () => {
  it('release-host.ts writes a tarball, its sha256 and host-version.json', () => {
    const release = makeRelease();
    const {manifest} = release;
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+(-rc\.\d+)?-[0-9a-f]{12}$/);
    expect(String(manifest.submoduleCommit)).toMatch(/^[0-9a-f]{40}$/);
    expect(String(manifest.overlayHash)).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof (manifest.nativeLibs as Record<string, string>)['react-native-screens']).toBe('string');
    const asset = manifest.assets[assetKey()];
    expect(asset.file).toBe(`rn-a11y-host-${manifest.version}-${assetKey()}.tar.gz`);
    const tar = path.join(release.out, asset.file);
    expect(fs.readFileSync(`${tar}.sha256`, 'utf8')).toBe(`${asset.sha256}  ${asset.file}\n`);
    expect(execFileSync('tar', ['-tzf', asset.file], {cwd: release.out, encoding: 'utf8'}).trim().split('\n').sort()).toStrictEqual([
      'host-version.json',
      hostFileName(),
    ].sort());
    expect(JSON.parse(fs.readFileSync(release.manifestFile, 'utf8'))).toStrictEqual(manifest);
    fs.rmSync(release.dir, {recursive: true, force: true});
  });

  it('downloadHost: file:// download, sha256 check, cache reuse, errors', async () => {
    const release = makeRelease();
    const baseUrl = pathToFileURL(release.out).href;
    await withEnv({RN_A11Y_HOST_MANIFEST: release.manifestFile, RN_A11Y_HOST_CACHE_DIR: release.cache}, async () => {
      const logs: string[] = [];
      const bin = await downloadHost({baseUrl, log: l => logs.push(l)});
      expect(bin).toBe(path.join(release.cache, release.manifest.version, hostFileName()));
      if (process.platform !== 'win32') expect(fs.statSync(bin).mode & 0o100).toBeTruthy();
      expect(logs[0]).toMatch(/downloading host .* from file:/);
      expect(fs.readdirSync(release.cache)).toStrictEqual([release.manifest.version]); // no temp dirs left

      // Cached: no download (the archive is gone).
      const asset = release.manifest.assets[assetKey()];
      fs.renameSync(path.join(release.out, asset.file), path.join(release.dir, 'moved.tar.gz'));
      logs.length = 0;
      expect(await downloadHost({baseUrl, log: l => logs.push(l)})).toBe(bin);
      expect(logs).toStrictEqual([]);

      // A wrong checksum in the manifest: the cache does not match and the download is rejected.
      fs.renameSync(path.join(release.dir, 'moved.tar.gz'), path.join(release.out, asset.file));
      const bad = {...release.manifest, assets: {[assetKey()]: {...asset, sha256: '0'.repeat(64)}}};
      const badFile = path.join(release.dir, 'bad.json');
      fs.writeFileSync(badFile, JSON.stringify(bad));
      await withEnv({RN_A11Y_HOST_MANIFEST: badFile}, () =>
        expect(downloadHost({baseUrl})).rejects.toThrow(/sha256 mismatch .* expected 0{64}/),
      );
      const other = {...release.manifest, assets: {'plan9-mips': asset}};
      fs.writeFileSync(badFile, JSON.stringify(other));
      await withEnv({RN_A11Y_HOST_MANIFEST: badFile}, () =>
        expect(downloadHost({baseUrl})).rejects.toThrow(new RegExp(`has no host for ${assetKey()} \\(has: plan9-mips\\)`)),
      );
      await withEnv({RN_A11Y_HOST_MANIFEST: path.join(release.dir, 'missing.json')}, () =>
        expect(downloadHost({baseUrl})).rejects.toThrow(/no host-version\.json/),
      );
      await withEnv({RN_A11Y_HOST_CACHE_DIR: path.join(release.dir, 'cache2')}, () =>
        expect(downloadHost({baseUrl: pathToFileURL(release.dir).href})).rejects.toThrow(/ENOENT/),
      );
    });
    fs.rmSync(release.dir, {recursive: true, force: true});
  });

  it('CLI uses the downloaded host (RN_A11Y_HOST_BASE_URL, fake host)', {timeout: 180_000}, () => {
    const release = makeRelease();
    const env = {
      ...process.env,
      RN_A11Y_HOST_BIN: '',
      RN_A11Y_HOST_RUNNER: 'bun',
      RN_A11Y_HOST_SKIP_PACKAGE: '1',
      RN_A11Y_HOST_BASE_URL: pathToFileURL(release.out).href,
      RN_A11Y_HOST_MANIFEST: release.manifestFile,
      RN_A11Y_HOST_CACHE_DIR: release.cache,
    };
    const proc = spawnSync('node', [CLI, 'render', APP, '--platform', 'android', '--no-quiet'], {
      cwd: ROOT,
      encoding: 'utf8',
      env,
    });
    expect(proc.status, proc.stderr).toBe(0);
    expect(proc.stderr).toMatch(/downloading host/);
    expect(JSON.parse(proc.stdout).source).toBe('mounted'); // the fake host's default payload
    expect(fs.existsSync(path.join(release.cache, release.manifest.version, hostFileName()))).toBeTruthy();

    // A failed download falls back to native/dist (with a warning), else HOST_MISSING.
    const failed = spawnSync('node', [CLI, 'render', APP, '--platform', 'android', '--no-quiet', '--format', 'text'], {
      cwd: ROOT,
      encoding: 'utf8',
      // No runner: the fallback is the real host in native/dist.
      env: {...env, RN_A11Y_HOST_RUNNER: '', RN_A11Y_HOST_BASE_URL: pathToFileURL(path.join(release.dir, 'nonexistent')).href, RN_A11Y_HOST_CACHE_DIR: path.join(release.dir, 'c2')},
    });
    if (fs.existsSync(DEFAULT_HOST_BIN)) {
      expect(failed.status, failed.stderr).toBe(0);
      expect(failed.stderr).toMatch(/warning: prebuilt host download failed \(.*ENOENT.*\); using .*native[\\/]dist/);
    } else {
      expect(failed.status).toBe(5);
      const {error} = JSON.parse(failed.stderr.trim().split('\n').pop()!);
      expect(error.code).toBe('HOST_MISSING');
      expect(error.message).toMatch(/Prebuilt host download failed/);
    }
    fs.rmSync(release.dir, {recursive: true, force: true});
  });
});
