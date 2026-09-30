import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {getHostPath, HostUnavailableError, hostRelativePath} from 'rn-a11y-host';

import {CliError, EXIT_CODES} from '../src/errors.ts';
import {checkProtocol, findHost, type HostProbes, SUPPORTED_PROTOCOL} from '../src/host.ts';
import {HOST_PROTOCOL_VERSION} from '../scripts/release-host.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('rn-a11y-host getHostPath: hermesc-style layout per platform', () => {
  assert.equal(hostRelativePath('darwin', 'arm64'), path.join('osx-bin', 'rn-a11y-host'));
  assert.equal(hostRelativePath('darwin', 'x64'), path.join('osx-bin', 'rn-a11y-host'));
  assert.equal(hostRelativePath('linux', 'x64'), path.join('linux64-bin', 'rn-a11y-host'));
  assert.equal(hostRelativePath('win32', 'x64'), path.join('win64-bin', 'rn-a11y-host.exe'));
  assert.equal(getHostPath('linux', 'x64'), path.join(ROOT, 'packages/rn-a11y-host/linux64-bin/rn-a11y-host'));
  for (const [platform, arch] of [['linux', 'arm64'], ['win32', 'arm64'], ['freebsd', 'x64']]) {
    assert.throws(
      () => getHostPath(platform, arch),
      (error: unknown) =>
        error instanceof HostUnavailableError &&
        error.code === 'HOST_UNAVAILABLE' &&
        error.message.includes(`${platform}-${arch}`),
    );
  }
  // Defaults: this process.
  const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
  Object.defineProperty(process, 'platform', {value: 'win32'});
  const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!;
  Object.defineProperty(process, 'arch', {value: 'x64'});
  try {
    assert.equal(hostRelativePath(), path.join('win64-bin', 'rn-a11y-host.exe'));
  } finally {
    Object.defineProperty(process, 'platform', original);
    Object.defineProperty(process, 'arch', originalArch);
  }
});

function probes(overrides: Partial<HostProbes> & {files?: string[]}): HostProbes & {logs: string[]; downloads: number} {
  const files = new Set(overrides.files ?? []);
  const result = {
    env: undefined,
    baseUrl: undefined,
    exists: (f: string) => files.has(f),
    packageHost: () => null,
    download: async () => {
      result.downloads++;
      return {bin: '/cache/v1/rn-a11y-host', manifest: {version: 'v1', protocolVersion: 1}};
    },
    distBin: '/repo/native/dist/arm64/rn-a11y-host',
    logs: [] as string[],
    log: (line: string) => result.logs.push(line),
    downloads: 0,
    ...overrides,
  };
  return result;
}

test('findHost order: RN_A11Y_HOST_BIN, package, download, native/dist, HOST_MISSING', async () => {
  const pkg = () => ({bin: '/pkg/osx-bin/rn-a11y-host', manifest: {version: 'p1', protocolVersion: 1}});
  const all = ['/env/host', '/pkg/osx-bin/rn-a11y-host', '/repo/native/dist/arm64/rn-a11y-host'];

  assert.deepEqual(await findHost(probes({env: '/env/host', packageHost: pkg, baseUrl: 'file:///x', files: all})), {
    bin: '/env/host',
    source: 'env',
  });
  await assert.rejects(findHost(probes({env: '/missing'})), /RN_A11Y_HOST_BIN points to a missing file/);

  const p1 = probes({packageHost: pkg, baseUrl: 'file:///x', files: all});
  assert.deepEqual(await findHost(p1), {bin: '/pkg/osx-bin/rn-a11y-host', source: 'package', version: 'p1', protocolVersion: 1});
  assert.equal(p1.downloads, 0);

  // Package installed but without a binary for this platform: next step.
  const p2 = probes({packageHost: pkg, baseUrl: 'file:///x', files: ['/repo/native/dist/arm64/rn-a11y-host']});
  assert.deepEqual(await findHost(p2), {bin: '/cache/v1/rn-a11y-host', source: 'download', version: 'v1', protocolVersion: 1});

  assert.deepEqual(await findHost(probes({files: all.slice(2)})), {bin: '/repo/native/dist/arm64/rn-a11y-host', source: 'dist'});

  const failing = probes({
    baseUrl: 'file:///x',
    files: all.slice(2),
    download: async () => {
      throw new Error('ENOENT');
    },
  });
  assert.equal((await findHost(failing)).source, 'dist');
  assert.match(failing.logs[0], /download failed \(ENOENT\); using \/repo\/native\/dist/);

  await assert.rejects(
    findHost(probes({baseUrl: 'file:///x', download: async () => { throw new Error('sha256 mismatch'); }})),
    (error: CliError) => error.code === 'HOST_MISSING' && /download failed: sha256 mismatch/.test(error.message),
  );
  await assert.rejects(findHost(probes({})), (error: CliError) => error.code === 'HOST_MISSING' && /No host binary/.test(error.message));
});

test('checkProtocol: HOST_INCOMPATIBLE outside the supported range; release-host writes a supported version', () => {
  assert.ok(HOST_PROTOCOL_VERSION >= SUPPORTED_PROTOCOL.min && HOST_PROTOCOL_VERSION <= SUPPORTED_PROTOCOL.max);
  checkProtocol({bin: '/h', source: 'package', protocolVersion: SUPPORTED_PROTOCOL.max});
  checkProtocol({bin: '/h', source: 'dist'}); // unknown: no check
  for (const [v, hint] of [[SUPPORTED_PROTOCOL.max + 1, /Update react-native-a11y-tree/], [SUPPORTED_PROTOCOL.min - 1, /Update rn-a11y-host/]] as const) {
    assert.throws(
      () => checkProtocol({bin: '/h', source: 'package', version: 'x', protocolVersion: v}),
      (error: CliError) => error.code === 'HOST_INCOMPATIBLE' && hint.test(error.hint ?? '') && new RegExp(`protocol ${v}`).test(error.message),
    );
  }
  assert.equal(EXIT_CODES.HOST_INCOMPATIBLE, 5);
});

test('release-host.mjs --pack fills the package directory (osx-bin + host-version.json)', {skip: process.platform !== 'darwin'}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-host-pack-'));
  const bin = path.join(dir, 'fake-host');
  fs.writeFileSync(bin, '#!/bin/sh\necho host\n');
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts/release-host.mjs'), '--pack', '--bin', bin, '--package-dir', path.join(dir, 'pkg')],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']},
  );
  const manifest = JSON.parse(out);
  assert.equal(manifest.protocolVersion, HOST_PROTOCOL_VERSION);
  assert.match(manifest.version, /-[0-9a-f]{12}$/);
  const packed = path.join(dir, 'pkg', 'osx-bin', 'rn-a11y-host');
  assert.equal(fs.readFileSync(packed, 'utf8'), '#!/bin/sh\necho host\n');
  assert.ok(fs.statSync(packed).mode & 0o100);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'pkg', 'host-version.json'), 'utf8')), manifest);
  assert.equal(manifest.binaries['osx-bin/rn-a11y-host'].size, fs.statSync(packed).size);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('RN_A11Y_HOST_STDERR_LOG collects the host stderr of every run (fake host)', {timeout: 120_000}, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-stderr-'));
  const log = path.join(dir, 'host-stderr.log');
  const proc = spawnSync(
    process.execPath,
    [path.join(ROOT, 'bin/rn-a11y-tree.js'), 'render', path.join(ROOT, 'examples/basic/App.tsx'), '--platform', 'android'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: {...process.env, RN_A11Y_HOST_BIN: path.join(ROOT, 'test/fixtures/fake-host.js'), RN_A11Y_HOST_STDERR_LOG: log},
    },
  );
  assert.equal(proc.status, 0, proc.stderr);
  const text = fs.readFileSync(log, 'utf8');
  assert.match(text, /^--- .*fake-host\.js \(pid \d+\) ---$/m);
  assert.match(text, /fake-host: glog line on stderr/);
  fs.rmSync(dir, {recursive: true, force: true});
});
