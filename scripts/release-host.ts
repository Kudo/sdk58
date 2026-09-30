#!/usr/bin/env bun
/**
 * Packages the built host (native/dist/<arch>/rn-a11y-host) for download:
 *
 *   release/rn-a11y-host-<version>-<platform>-<arch>.tar.gz
 *   release/rn-a11y-host-<version>-<platform>-<arch>.tar.gz.sha256
 *   release/host-version.json
 *
 * host-version.json records what the host was built from: the
 * react-native submodule commit, a hash of native/overlay, and the versions
 * of the npm packages whose native code is compiled in. `version` is
 * `<react-native version>-<first 12 hex of the sha256 of those inputs>`.
 * The CLI downloads `<RN_A11Y_HOST_BASE_URL>/<file>` for the version in the
 * host-version.json it is given (see src/hostDownload.ts).
 *
 * Usage: bun scripts/release-host.ts [--out <dir>] [--arch <arch>] [--bin <file>] [--pin]
 *        bun scripts/release-host.ts --pack [--package-dir <dir>] [--bin <file>]
 *   --pack fill packages/rn-a11y-host (osx-bin/rn-a11y-host + host-version.json)
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

function arg<T extends string | null>(name: string, fallback: T): string | T {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

function git(args: string[], cwd = ROOT): string {
  return execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
}

const sha256 = (data: string | Buffer): string => crypto.createHash('sha256').update(data).digest('hex');

/** sha256 over every file in native/overlay (what build-host.sh copies): path and content hash, sorted. */
export function overlayHash(dir = OVERLAY_DIR): {hash: string; files: number; newestMtimeMs: number} {
  const files: string[] = [];
  const walk = (d: string) => {
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

export function nativeLibVersions(): Record<string, string | null> {
  const require = createRequire(path.join(ROOT, 'package.json'));
  const out: Record<string, string | null> = {};
  for (const name of NATIVE_PACKAGES) {
    try {
      out[name] = require(`${name}/package.json`).version;
    } catch {
      out[name] = null;
    }
  }
  return out;
}

/**
 * Version of the CLI <-> host contract (bundle entry, NativeFantom methods,
 * stdout protocol). Bump it with a change the CLI cannot use with older
 * hosts, and update SUPPORTED_PROTOCOL in src/host.ts.
 */
export const HOST_PROTOCOL_VERSION = 1;

/** What the host was built from (the manifest without `assets`). */
function buildInfo(bin: string) {
  const submoduleCommit = git(['rev-parse', 'HEAD'], RN_DIR);
  // The commit recorded in this repo (differs from HEAD when the submodule was moved but not committed).
  const pinned = git(['ls-tree', 'HEAD', 'third_party/react-native']).split(/\s+/)[2] ?? null;
  const rnVersion = JSON.parse(
    fs.readFileSync(path.join(RN_DIR, 'packages', 'react-native', 'package.json'), 'utf8'),
  ).version;
  const overlay = overlayHash();
  const overlayGitStatus = git(['status', '--porcelain', '--', 'native/overlay']);
  const libs = nativeLibVersions();
  if (overlay.newestMtimeMs > fs.statSync(bin).mtimeMs) {
    console.error('release-host: warning: native/overlay has files newer than the host binary; rebuild with `bun run build:host`');
  }
  if (overlayGitStatus !== '') {
    console.error(`release-host: warning: native/overlay has uncommitted changes:\n${overlayGitStatus}`);
  }
  const inputs = {submoduleCommit, overlayHash: overlay.hash, nativeLibs: libs};
  return {
    version: `${rnVersion}-${sha256(JSON.stringify(inputs)).slice(0, 12)}`,
    protocolVersion: HOST_PROTOCOL_VERSION,
    reactNative: rnVersion,
    submoduleCommit,
    ...(pinned != null && pinned !== submoduleCommit ? {submoduleCommitInRepo: pinned} : {}),
    overlayHash: overlay.hash,
    overlayFiles: overlay.files,
    ...(overlayGitStatus !== '' ? {overlayDirty: true} : {}),
    nativeLibs: libs,
    repoCommit: git(['rev-parse', 'HEAD']),
  };
}

/** index.js (bun build) and index.d.ts (tsc) of packages/rn-a11y-host/index.ts, written to `packageDir`. */
function buildPackageEntry(packageDir: string) {
  const entry = path.join(ROOT, 'packages', 'rn-a11y-host', 'index.ts');
  execFileSync('bun', ['build', entry, '--target', 'node', '--format', 'esm', '--outfile', path.join(packageDir, 'index.js')], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(
    process.execPath,
    [tsc, entry, '--declaration', '--emitDeclarationOnly', '--target', 'es2023', '--module', 'nodenext', '--types', 'node', '--skipLibCheck', '--outDir', packageDir],
    {stdio: 'inherit'},
  );
}

/**
 * --pack: fills packages/rn-a11y-host (or --package-dir) in the hermesc
 * layout, and builds its index.js + index.d.ts. macOS: osx-bin/rn-a11y-host, a universal binary (lipo) when both
 * native/dist/arm64 and native/dist/x86_64 exist, else the one that exists.
 */
function pack() {
  if (process.platform !== 'darwin') {
    console.error('release-host: --pack only packs macOS hosts for now');
    process.exit(1);
  }
  const packageDir = path.resolve(arg('--package-dir', path.join(ROOT, 'packages', 'rn-a11y-host')));
  const archs = ['arm64', 'x86_64'].filter(a => fs.existsSync(path.join(ROOT, 'native', 'dist', a, 'rn-a11y-host')));
  const explicit = arg('--bin', null);
  const inputs = explicit != null ? [path.resolve(explicit)] : archs.map(a => path.join(ROOT, 'native', 'dist', a, 'rn-a11y-host'));
  if (inputs.length === 0) {
    console.error('release-host: no native/dist/<arch>/rn-a11y-host; run `bun run build:host` first');
    process.exit(1);
  }
  buildPackageEntry(packageDir);
  const outBin = path.join(packageDir, 'osx-bin', 'rn-a11y-host');
  fs.mkdirSync(path.dirname(outBin), {recursive: true});
  if (inputs.length > 1) {
    execFileSync('lipo', ['-create', '-output', outBin, ...inputs]);
  } else {
    fs.copyFileSync(inputs[0], outBin);
  }
  fs.chmodSync(outBin, 0o755);
  const manifest = {
    ...buildInfo(inputs[0]),
    binaries: {
      'osx-bin/rn-a11y-host': {
        archs: explicit != null ? [os.arch() === 'x64' ? 'x86_64' : os.arch()] : archs,
        sha256: sha256(fs.readFileSync(outBin)),
        size: fs.statSync(outBin).size,
      },
    },
  };
  const text = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(packageDir, 'host-version.json'), text);
  console.log(text.trimEnd());
  console.error(`release-host: packed ${path.relative(ROOT, outBin)} (${manifest.binaries['osx-bin/rn-a11y-host'].size} bytes)`);
}

function main() {
  if (process.argv.includes('--pack')) {
    pack();
    return;
  }
  const arch = arg('--arch', os.arch() === 'x64' ? 'x86_64' : os.arch());
  const platform = process.platform;
  const outDir = path.resolve(arg('--out', path.join(ROOT, 'release')));
  const bin = path.resolve(arg('--bin', path.join(ROOT, 'native', 'dist', arch, 'rn-a11y-host')));
  if (!fs.existsSync(bin)) {
    console.error(`release-host: ${path.relative(ROOT, bin)} not found; run \`bun run build:host\` first`);
    process.exit(1);
  }
  const info = buildInfo(bin);
  const {version} = info;
  const assetKey = `${platform}-${arch}`;
  const file = `rn-a11y-host-${version}-${assetKey}.tar.gz`;

  fs.mkdirSync(outDir, {recursive: true});
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-host-release-'));
  try {
    fs.copyFileSync(bin, path.join(stage, 'rn-a11y-host'));
    fs.chmodSync(path.join(stage, 'rn-a11y-host'), 0o755);
    type Asset = {file: string; sha256: string; size: number};
    const manifest = {...info, assets: {} as Record<string, Asset> /* filled below */};
    fs.writeFileSync(path.join(stage, 'host-version.json'), JSON.stringify({...manifest, assets: undefined}, null, 2) + '\n');
    const tarPath = path.join(outDir, file);
    execFileSync('tar', ['-czf', tarPath, '-C', stage, 'rn-a11y-host', 'host-version.json']);
    const digest = sha256(fs.readFileSync(tarPath));
    fs.writeFileSync(`${tarPath}.sha256`, `${digest}  ${file}\n`);
    // Another arch packaged into the same directory for the same version: keep its asset.
    const previousPath = path.join(outDir, 'host-version.json');
    const previous: {version?: string; assets?: Record<string, Asset>} | null = fs.existsSync(previousPath)
      ? JSON.parse(fs.readFileSync(previousPath, 'utf8'))
      : null;
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
