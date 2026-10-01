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
 * Usage: bun scripts/release-host.ts [--out <dir>] [--platform <p>] [--arch <arch>] [--bin <file>] [--pin]
 *        bun scripts/release-host.ts --pack [--package-dir <dir>] [--bin [<slot>=]<file>]... [--artifacts <dir>]
 *   --pack      fill packages/rn-a11y-host: osx-bin/, linux64-bin/, win64-bin/
 *               (<slot> = osx | linux64 | win64) and one host-version.json
 *               listing every binary (see pack())
 *   --artifacts with --pack: <dir>/rn-a11y-host-<slot>/ from CI artifacts
 *   --bin       package this file instead of native/dist/<arch>/rn-a11y-host
 *   --platform  darwin | linux | win32 (default: this machine): the asset key
 *               <platform>-<arch> and the file name (.exe on win32)
 *   --pin       also write host-version.json to the repo root (the version
 *               the CLI downloads by default).
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

/** The package slots (hermesc layout): directory, file name, executable format and arch of each. */
export const SLOTS = {
  osx: {dir: 'osx-bin', file: 'rn-a11y-host', format: 'mach-o', platform: 'darwin'},
  linux64: {dir: 'linux64-bin', file: 'rn-a11y-host', format: 'elf', platform: 'linux'},
  win64: {dir: 'win64-bin', file: 'rn-a11y-host.exe', format: 'pe', platform: 'win32'},
} as const;
export type Slot = keyof typeof SLOTS;

const MACHO_CPU: Record<number, string> = {0x01000007: 'x86_64', 0x0100000c: 'arm64'};
const ELF_MACHINE: Record<number, string> = {62: 'x86_64', 183: 'arm64'};
const PE_MACHINE: Record<number, string> = {0x8664: 'x86_64', 0xaa64: 'arm64'};

/** Executable format and architectures from the file header (Mach-O, fat Mach-O, ELF, PE), or null. */
export function binaryArchs(file: string): {format: 'mach-o' | 'elf' | 'pe'; archs: string[]} | null {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(4096);
  const n = fs.readSync(fd, head, 0, head.length, 0);
  fs.closeSync(fd);
  const b = head.subarray(0, n);
  const arch = (table: Record<number, string>, value: number) => table[value] ?? `unknown(0x${value.toString(16)})`;
  if (b.length >= 8 && (b.readUInt32BE(0) === 0xcafebabe || b.readUInt32BE(0) === 0xcafebabf)) {
    // fat_arch: 20 bytes; fat_arch_64 (0xcafebabf): 32 bytes. cputype first.
    const entry = b.readUInt32BE(0) === 0xcafebabe ? 20 : 32;
    const count = b.readUInt32BE(4);
    const archs: string[] = [];
    for (let i = 0; i < count && 8 + entry * i + 4 <= b.length; i++) archs.push(arch(MACHO_CPU, b.readUInt32BE(8 + entry * i)));
    return {format: 'mach-o', archs};
  }
  if (b.length >= 8 && b.readUInt32LE(0) === 0xfeedfacf) return {format: 'mach-o', archs: [arch(MACHO_CPU, b.readUInt32LE(4))]};
  if (b.length >= 20 && b.readUInt32BE(0) === 0x7f454c46) return {format: 'elf', archs: [arch(ELF_MACHINE, b.readUInt16LE(18))]};
  if (b.length >= 0x40 && b.toString('latin1', 0, 2) === 'MZ') {
    const pe = b.readUInt32LE(0x3c);
    if (pe + 6 <= b.length && b.toString('latin1', pe, pe + 4) === 'PE\0\0') return {format: 'pe', archs: [arch(PE_MACHINE, b.readUInt16LE(pe + 4))]};
  }
  return null;
}

/** The slot of this machine's platform (the default for an input without `<slot>=`). */
function currentSlot(): Slot {
  if (process.platform === 'darwin') return 'osx';
  if (process.platform === 'win32') return 'win64';
  return 'linux64';
}

/**
 * The --pack inputs, per slot:
 *  - `--bin <slot>=<file>` (repeatable; several osx files are joined with lipo,
 *    macOS only), `--bin <file>` for this machine's slot;
 *  - `--artifacts <dir>`: downloaded CI artifacts, <dir>/rn-a11y-host-<slot>/
 *    <file of the slot> (osx: the universal binary);
 *  - else native/dist/<arch>/ of this machine (macOS: arm64 and x86_64, joined).
 */
function packInputs(): Map<Slot, string[]> {
  const inputs = new Map<Slot, string[]>();
  const add = (slot: Slot, file: string) => inputs.set(slot, [...(inputs.get(slot) ?? []), path.resolve(file)]);
  process.argv.forEach((value, i) => {
    if (value !== '--bin') return;
    const spec = process.argv[i + 1] ?? '';
    const match = /^(osx|linux64|win64)=(.+)$/.exec(spec);
    if (match) add(match[1] as Slot, match[2]);
    else add(currentSlot(), spec);
  });
  const artifacts = arg('--artifacts', null);
  if (artifacts != null) {
    for (const slot of Object.keys(SLOTS) as Slot[]) {
      const file = path.join(artifacts, `rn-a11y-host-${slot}`, SLOTS[slot].file);
      if (fs.existsSync(file)) add(slot, file);
    }
  }
  if (inputs.size === 0) {
    const slot = currentSlot();
    for (const a of ['arm64', 'x86_64']) {
      const file = path.join(ROOT, 'native', 'dist', a, SLOTS[slot].file);
      if (fs.existsSync(file) && (slot === 'osx' || a === (os.arch() === 'x64' ? 'x86_64' : os.arch()))) add(slot, file);
    }
  }
  return inputs;
}

/**
 * --pack: fills packages/rn-a11y-host (or --package-dir) in the hermesc
 * layout (osx-bin/, linux64-bin/, win64-bin/; the slots without an input are
 * removed), writes host-version.json (build info + `binaries`: archs, sha256
 * and size of every binary) and builds index.js + index.d.ts. Runs on any
 * OS; lipo only joins several osx inputs.
 */
function pack() {
  const packageDir = path.resolve(arg('--package-dir', path.join(ROOT, 'packages', 'rn-a11y-host')));
  const inputs = packInputs();
  if (inputs.size === 0) {
    console.error('release-host: nothing to pack: no --bin/--artifacts and no native/dist/<arch>/rn-a11y-host (run `bun run build:host`)');
    process.exit(1);
  }
  for (const [slot, files] of inputs) {
    for (const file of files) {
      if (!fs.existsSync(file)) {
        console.error(`release-host: ${slot}: ${file} not found`);
        process.exit(1);
      }
    }
    if (files.length > 1 && (slot !== 'osx' || process.platform !== 'darwin')) {
      console.error(`release-host: ${slot}: ${files.length} inputs; only osx inputs can be joined (lipo, on macOS)`);
      process.exit(1);
    }
  }
  buildPackageEntry(packageDir);
  type Binary = {archs: string[]; sha256: string; size: number};
  const binaries: Record<string, Binary> = {};
  for (const slot of Object.keys(SLOTS) as Slot[]) {
    const {dir, file, format} = SLOTS[slot];
    fs.rmSync(path.join(packageDir, dir), {recursive: true, force: true});
    const files = inputs.get(slot);
    if (files == null) continue;
    const outBin = path.join(packageDir, dir, file);
    fs.mkdirSync(path.dirname(outBin), {recursive: true});
    if (files.length > 1) execFileSync('lipo', ['-create', '-output', outBin, ...files]);
    else fs.copyFileSync(files[0], outBin);
    fs.chmodSync(outBin, 0o755);
    const detected = binaryArchs(outBin);
    if (detected?.format !== format) {
      console.error(`release-host: ${slot}: ${files.join(', ')}: expected executable format ${format}, got ${detected?.format ?? 'unknown'}`);
      process.exit(1);
    }
    binaries[`${dir}/${file}`] = {archs: detected.archs, sha256: sha256(fs.readFileSync(outBin)), size: fs.statSync(outBin).size};
  }
  const manifest = {...buildInfo([...inputs.values()][0][0]), binaries};
  const text = JSON.stringify(manifest, null, 2) + '\n';
  fs.writeFileSync(path.join(packageDir, 'host-version.json'), text);
  console.log(text.trimEnd());
  for (const [file, info] of Object.entries(binaries)) {
    console.error(`release-host: packed ${file} (${info.archs.join('+')}, ${info.size} bytes)`);
  }
}

function main() {
  if (process.argv.includes('--pack')) {
    pack();
    return;
  }
  const arch = arg('--arch', os.arch() === 'x64' ? 'x86_64' : os.arch());
  const platform = arg('--platform', process.platform);
  // The archive holds rn-a11y-host.exe on Windows, rn-a11y-host elsewhere (src/hostDownload.ts).
  const hostFile = platform === 'win32' ? 'rn-a11y-host.exe' : 'rn-a11y-host';
  const outDir = path.resolve(arg('--out', path.join(ROOT, 'release')));
  const bin = path.resolve(arg('--bin', path.join(ROOT, 'native', 'dist', arch, hostFile)));
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
    fs.copyFileSync(bin, path.join(stage, hostFile));
    fs.chmodSync(path.join(stage, hostFile), 0o755);
    type Asset = {file: string; sha256: string; size: number};
    const manifest = {...info, assets: {} as Record<string, Asset> /* filled below */};
    fs.writeFileSync(path.join(stage, 'host-version.json'), JSON.stringify({...manifest, assets: undefined}, null, 2) + '\n');
    const tarPath = path.join(outDir, file);
    execFileSync('tar', ['-czf', tarPath, '-C', stage, hostFile, 'host-version.json']);
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
