#!/usr/bin/env node
/**
 * Packages the built host (native/dist/<arch>/rn-a11y-host) for download:
 *
 *   dist/release/rn-a11y-host-<version>-<platform>-<arch>.tar.gz
 *   dist/release/rn-a11y-host-<version>-<platform>-<arch>.tar.gz.sha256
 *   dist/release/host-version.json
 *
 * host-version.json records what the host was built from: the
 * react-native submodule commit, a hash of native/overlay, and the versions
 * of the npm packages whose native code is compiled in. `version` is
 * `<react-native version>-<first 12 hex of the sha256 of those inputs>`.
 * The CLI downloads `<RN_A11Y_HOST_BASE_URL>/<file>` for the version in the
 * host-version.json it is given (see src/hostDownload.ts).
 *
 * Usage: node scripts/release-host.mjs [--out <dir>] [--arch <arch>] [--bin <file>] [--pin]
 *   --bin  package this file instead of native/dist/<arch>/rn-a11y-host (tests)
 *   --pin  also write host-version.json to the repo root (the version the
 *          CLI downloads by default).
 */

import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RN_DIR = path.join(ROOT, 'third_party', 'react-native');
const OVERLAY_DIR = path.join(ROOT, 'native', 'overlay');

/** npm packages compiled into the host (native/overlay/tester/CMakeLists.txt) plus the bytecode compiler. */
export const NATIVE_PACKAGES = [
  'react-native-screens',
  'react-native-safe-area-context',
  'react-native-gesture-handler',
  'react-native-reanimated',
  'react-native-worklets',
  'expo-modules-core',
  '@expo/ui',
  'hermes-compiler',
];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function git(args, cwd = ROOT) {
  return execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
}

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');

/** sha256 over every file in native/overlay (what build-host.sh copies): path and content hash, sorted. */
export function overlayHash(dir = OVERLAY_DIR) {
  const files = [];
  const walk = d => {
    for (const entry of fs.readdirSync(d, {withFileTypes: true})) {
      if (entry.name === '.DS_Store') continue;
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(dir);
  const lines = files
    .map(f => `${path.relative(dir, f).split(path.sep).join('/')}\0${sha256(fs.readFileSync(f))}`)
    .sort();
  return {hash: sha256(lines.join('\n')), files: files.length, newestMtimeMs: Math.max(...files.map(f => fs.statSync(f).mtimeMs))};
}

export function nativeLibVersions() {
  const require = createRequire(path.join(ROOT, 'package.json'));
  const out = {};
  for (const name of NATIVE_PACKAGES) {
    try {
      out[name] = require(`${name}/package.json`).version;
    } catch {
      out[name] = null;
    }
  }
  return out;
}

function main() {
  const arch = arg('--arch', os.arch() === 'x64' ? 'x86_64' : os.arch());
  const platform = process.platform;
  const outDir = path.resolve(arg('--out', path.join(ROOT, 'dist', 'release')));
  const bin = path.resolve(arg('--bin', path.join(ROOT, 'native', 'dist', arch, 'rn-a11y-host')));
  if (!fs.existsSync(bin)) {
    console.error(`release-host: ${path.relative(ROOT, bin)} not found; run \`bun run build:host\` first`);
    process.exit(1);
  }

  const submoduleCommit = git(['rev-parse', 'HEAD'], RN_DIR);
  // The commit recorded in this repo (differs from HEAD when the submodule was moved but not committed).
  const pinned = git(['ls-tree', 'HEAD', 'third_party/react-native']).split(/\s+/)[2] ?? null;
  const rnVersion = JSON.parse(
    fs.readFileSync(path.join(RN_DIR, 'packages', 'react-native', 'package.json'), 'utf8'),
  ).version;
  const overlay = overlayHash();
  const overlayGitStatus = git(['status', '--porcelain', '--', 'native/overlay']);
  const libs = nativeLibVersions();
  const binStat = fs.statSync(bin);
  if (overlay.newestMtimeMs > binStat.mtimeMs) {
    console.error('release-host: warning: native/overlay has files newer than the host binary; rebuild with `bun run build:host`');
  }
  if (overlayGitStatus !== '') {
    console.error(`release-host: warning: native/overlay has uncommitted changes:\n${overlayGitStatus}`);
  }

  const inputs = {submoduleCommit, overlayHash: overlay.hash, nativeLibs: libs};
  const version = `${rnVersion}-${sha256(JSON.stringify(inputs)).slice(0, 12)}`;
  const assetKey = `${platform}-${arch}`;
  const file = `rn-a11y-host-${version}-${assetKey}.tar.gz`;

  fs.mkdirSync(outDir, {recursive: true});
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-host-release-'));
  try {
    fs.copyFileSync(bin, path.join(stage, 'rn-a11y-host'));
    fs.chmodSync(path.join(stage, 'rn-a11y-host'), 0o755);
    const manifest = {
      version,
      reactNative: rnVersion,
      submoduleCommit,
      ...(pinned != null && pinned !== submoduleCommit ? {submoduleCommitInRepo: pinned} : {}),
      overlayHash: overlay.hash,
      overlayFiles: overlay.files,
      ...(overlayGitStatus !== '' ? {overlayDirty: true} : {}),
      nativeLibs: libs,
      repoCommit: git(['rev-parse', 'HEAD']),
      assets: {} /* filled below */,
    };
    fs.writeFileSync(path.join(stage, 'host-version.json'), JSON.stringify({...manifest, assets: undefined}, null, 2) + '\n');
    const tarPath = path.join(outDir, file);
    execFileSync('tar', ['-czf', tarPath, '-C', stage, 'rn-a11y-host', 'host-version.json']);
    const digest = sha256(fs.readFileSync(tarPath));
    fs.writeFileSync(`${tarPath}.sha256`, `${digest}  ${file}\n`);
    // Another arch packaged into the same directory for the same version: keep its asset.
    const previousPath = path.join(outDir, 'host-version.json');
    const previous = fs.existsSync(previousPath) ? JSON.parse(fs.readFileSync(previousPath, 'utf8')) : null;
    manifest.assets = {
      ...(previous?.version === version ? previous.assets : {}),
      [assetKey]: {file, sha256: digest, size: fs.statSync(tarPath).size},
    };
    const manifestText = JSON.stringify(manifest, null, 2) + '\n';
    fs.writeFileSync(path.join(outDir, 'host-version.json'), manifestText);
    if (process.argv.includes('--pin')) fs.writeFileSync(path.join(ROOT, 'host-version.json'), manifestText);
    console.log(manifestText.trimEnd());
    console.error(`release-host: wrote ${path.relative(ROOT, tarPath)} (${manifest.assets[assetKey].size} bytes)`);
  } finally {
    fs.rmSync(stage, {recursive: true, force: true});
  }
}

if (process.argv[1] != null && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
