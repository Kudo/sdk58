/**
 * Prebuilt host download.
 *
 * With `RN_A11Y_HOST_BASE_URL` set, `ensureHost()` downloads
 * `<base>/<file>` (file from host-version.json for this platform and arch)
 * into `~/.cache/rn-a11y-tree/host/<version>/`, verifies its sha256 and
 * unpacks it. The manifest is `host-version.json` in the package root
 * (written by `scripts/release-host.ts --pin`), or `RN_A11Y_HOST_MANIFEST`.
 * Order: RN_A11Y_HOST_BIN, then the download (or its cached copy), then
 * native/dist, else HOST_MISSING.
 */

import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const BASE_URL_ENV = 'RN_A11Y_HOST_BASE_URL';
export const MANIFEST_ENV = 'RN_A11Y_HOST_MANIFEST';
export const HOST_CACHE_ENV = 'RN_A11Y_HOST_CACHE_DIR';

const PACKAGE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export type HostManifest = {
  version: string;
  assets: Record<string, {file: string; sha256: string; size?: number}>;
  [key: string]: unknown;
};

export function assetKey(): string {
  return `${process.platform}-${os.arch() === 'x64' ? 'x86_64' : os.arch()}`;
}

export function hostCacheRoot(): string {
  const fromEnv = process.env[HOST_CACHE_ENV];
  if (fromEnv) return fromEnv;
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'rn-a11y-tree', 'host');
}

export function readManifest(): {manifest: HostManifest; file: string} | null {
  const file = process.env[MANIFEST_ENV] || path.join(PACKAGE_ROOT, 'host-version.json');
  if (!fs.existsSync(file)) return null;
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8')) as HostManifest;
  if (typeof manifest.version !== 'string' || typeof manifest.assets !== 'object' || manifest.assets == null) {
    throw new Error(`${file}: expected {version, assets}`);
  }
  return {manifest, file};
}

async function fetchTo(url: string, target: string): Promise<void> {
  if (url.startsWith('file:')) {
    fs.copyFileSync(fileURLToPath(url), target);
    return;
  }
  const response = await fetch(url, {redirect: 'follow'});
  if (!response.ok || response.body == null) {
    throw new Error(`GET ${url}: HTTP ${response.status}`);
  }
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()));
}

function sha256File(file: string): string {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Returns the path of the downloaded host binary: from the cache when its
 * sha256 marker matches, else downloads, verifies and unpacks it. Throws
 * with a message on any failure.
 */
export async function downloadHost(options: {baseUrl: string; log?: (line: string) => void}): Promise<string> {
  const found = readManifest();
  if (found == null) {
    throw new Error(`no host-version.json (set ${MANIFEST_ENV}, or run scripts/release-host.ts --pin)`);
  }
  const {manifest, file: manifestFile} = found;
  const asset = manifest.assets[assetKey()];
  if (asset == null) {
    throw new Error(`${manifestFile} has no host for ${assetKey()} (has: ${Object.keys(manifest.assets).join(', ') || 'none'})`);
  }
  const root = hostCacheRoot();
  const dir = path.join(root, manifest.version);
  // scripts/release-host.ts: rn-a11y-host.exe in the Windows archive.
  const hostFile = process.platform === 'win32' ? 'rn-a11y-host.exe' : 'rn-a11y-host';
  const bin = path.join(dir, hostFile);
  const marker = path.join(dir, '.sha256');
  if (fs.existsSync(bin) && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === asset.sha256) {
    return bin;
  }

  const url = `${options.baseUrl.replace(/\/+$/, '')}/${asset.file}`;
  options.log?.(`rn-a11y-tree: downloading host ${manifest.version} from ${url}`);
  fs.mkdirSync(root, {recursive: true});
  const tmp = fs.mkdtempSync(path.join(root, `.download-${manifest.version}-`));
  try {
    const archive = path.join(tmp, asset.file);
    await fetchTo(url, archive);
    const digest = sha256File(archive);
    if (digest !== asset.sha256) {
      throw new Error(`sha256 mismatch for ${url}: got ${digest}, expected ${asset.sha256} (${manifestFile})`);
    }
    const unpacked = path.join(tmp, 'host');
    fs.mkdirSync(unpacked);
    execFileSync('tar', ['-xzf', archive, '-C', unpacked]);
    const unpackedBin = path.join(unpacked, hostFile);
    if (!fs.existsSync(unpackedBin)) throw new Error(`${asset.file} has no ${hostFile}`);
    fs.chmodSync(unpackedBin, 0o755);
    fs.writeFileSync(path.join(unpacked, '.sha256'), asset.sha256 + '\n');
    fs.rmSync(dir, {recursive: true, force: true});
    try {
      fs.renameSync(unpacked, dir);
    } catch (error) {
      // Another process installed it first.
      if (!fs.existsSync(bin)) throw error;
    }
    return bin;
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
}
