import {spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {getHostPath, HostUnavailableError, hostRelativePath} from '../packages/rn-a11y-host/index.ts';

import {CliError, EXIT_CODES} from '../src/errors.ts';
import {checkProtocol, DEFAULT_TZ, findHost, hostEnv, type HostProbes, SUPPORTED_PROTOCOL} from '../src/host.ts';
import {HOST_PROTOCOL_VERSION} from '../scripts/release-host.ts';
import {elf, machO, pe} from './fixtures/fake-binaries.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('host-resolve', () => {
  it('rn-a11y-host getHostPath: hermesc-style layout per platform', () => {
    expect(hostRelativePath('darwin', 'arm64')).toBe(path.join('osx-bin', 'rn-a11y-host'));
    expect(hostRelativePath('darwin', 'x64')).toBe(path.join('osx-bin', 'rn-a11y-host'));
    expect(hostRelativePath('linux', 'x64')).toBe(path.join('linux64-bin', 'rn-a11y-host'));
    expect(hostRelativePath('win32', 'x64')).toBe(path.join('win64-bin', 'rn-a11y-host.exe'));
    for (const [platform, arch] of [['linux', 'arm64'], ['win32', 'arm64'], ['freebsd', 'x64'], ['darwin', 'ppc']]) {
      expect(() => getHostPath(platform, arch)).toThrow(expect.toSatisfy((error: unknown) =>
          error instanceof HostUnavailableError &&
          error.code === 'HOST_UNAVAILABLE' &&
          error.message.includes(`${platform}-${arch}`)));
    }
    // Defaults: this process.
    const original = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', {value: 'win32'});
    const originalArch = Object.getOwnPropertyDescriptor(process, 'arch')!;
    Object.defineProperty(process, 'arch', {value: 'x64'});
    try {
      expect(hostRelativePath()).toBe(path.join('win64-bin', 'rn-a11y-host.exe'));
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
      checkout: false,
      logs: [] as string[],
      log: (line: string) => result.logs.push(line),
      downloads: 0,
      ...overrides,
    };
    return result;
  }

  it('findHost order: RN_A11Y_HOST_BIN, package, download, native/dist, HOST_MISSING', async () => {
    const pkg = () => ({bin: '/pkg/osx-bin/rn-a11y-host', manifest: {version: 'p1', protocolVersion: 1}});
    const all = ['/env/host', '/pkg/osx-bin/rn-a11y-host', '/repo/native/dist/arm64/rn-a11y-host'];

    expect(await findHost(probes({env: '/env/host', packageHost: pkg, baseUrl: 'file:///x', files: all}))).toStrictEqual({
      bin: '/env/host',
      source: 'env',
    });
    await expect(findHost(probes({env: '/missing'}))).rejects.toThrow(/RN_A11Y_HOST_BIN points to a missing file/);

    const p1 = probes({packageHost: pkg, baseUrl: 'file:///x', files: all});
    expect(await findHost(p1)).toStrictEqual({bin: '/pkg/osx-bin/rn-a11y-host', source: 'package', version: 'p1', protocolVersion: 1});
    expect(p1.downloads).toBe(0);

    // Package installed but without a binary for this platform: next step.
    const p2 = probes({packageHost: pkg, baseUrl: 'file:///x', files: ['/repo/native/dist/arm64/rn-a11y-host']});
    expect(await findHost(p2)).toStrictEqual({bin: '/cache/v1/rn-a11y-host', source: 'download', version: 'v1', protocolVersion: 1});

    expect(await findHost(probes({files: all.slice(2)}))).toStrictEqual({bin: '/repo/native/dist/arm64/rn-a11y-host', source: 'dist'});

    // Repo checkout: a fresh native/dist build outranks the staged package
    // (not RN_A11Y_HOST_BIN); without native/dist the package is used.
    expect((await findHost(probes({checkout: true, packageHost: pkg, files: all}))).source).toBe('dist');
    expect((await findHost(probes({checkout: true, env: '/env/host', packageHost: pkg, files: all}))).source).toBe('env');
    expect((await findHost(probes({checkout: true, packageHost: pkg, files: all.slice(0, 2)}))).source).toBe('package');
    expect((await findHost(probes({checkout: true, packageHost: pkg, baseUrl: 'file:///x', files: all}))).source).toBe('download');
    // Installed package: the package first.
    expect((await findHost(probes({checkout: false, packageHost: pkg, files: all}))).source).toBe('package');

    const failing = probes({
      baseUrl: 'file:///x',
      files: all.slice(2),
      download: async () => {
        throw new Error('ENOENT');
      },
    });
    expect((await findHost(failing)).source).toBe('dist');
    expect(failing.logs[0]).toMatch(/download failed \(ENOENT\); using \/repo\/native\/dist/);

    await expect(findHost(probes({baseUrl: 'file:///x', download: async () => { throw new Error('sha256 mismatch'); }}))).rejects.toSatisfy((error: CliError) => error.code === 'HOST_MISSING' && /download failed: sha256 mismatch/.test(error.message));
    await expect(findHost(probes({}))).rejects.toSatisfy((error: CliError) => error.code === 'HOST_MISSING' && /No host binary/.test(error.message));
  });

  it('checkProtocol: HOST_INCOMPATIBLE outside the supported range; release-host writes a supported version', () => {
    expect(HOST_PROTOCOL_VERSION >= SUPPORTED_PROTOCOL.min && HOST_PROTOCOL_VERSION <= SUPPORTED_PROTOCOL.max).toBeTruthy();
    checkProtocol({bin: '/h', source: 'package', protocolVersion: SUPPORTED_PROTOCOL.max});
    checkProtocol({bin: '/h', source: 'dist'}); // unknown: no check
    for (const [v, hint] of [[SUPPORTED_PROTOCOL.max + 1, /Update react-native-a11y-tree/], [SUPPORTED_PROTOCOL.min - 1, /Update rn-a11y-host/]] as const) {
      expect(() => checkProtocol({bin: '/h', source: 'package', version: 'x', protocolVersion: v})).toThrow(expect.toSatisfy((error: CliError) => error.code === 'HOST_INCOMPATIBLE' && hint.test(error.hint ?? '') && new RegExp(`protocol ${v}`).test(error.message)));
    }
    expect(EXIT_CODES.HOST_INCOMPATIBLE).toBe(5);
  });

  it('release-host.ts --pack: one binary per slot (osx, linux64, win64) and one host-version.json (fake binaries)', {timeout: 120_000}, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-host-pack-'));
    const pkg = path.join(dir, 'pkg');
    const pack = (...args: string[]) =>
      spawnSync('bun', [path.join(ROOT, 'scripts/release-host.ts'), '--pack', '--package-dir', pkg, ...args], {encoding: 'utf8'});
    const osx = machO(path.join(dir, 'osx'), ['arm64', 'x86_64']);
    const linux = elf(path.join(dir, 'linux'));
    const win = pe(path.join(dir, 'win.exe'));
    const all = pack('--bin', `osx=${osx}`, '--bin', `linux64=${linux}`, '--bin', `win64=${win}`);
    expect(all.status, all.stderr).toBe(0);
    const manifest = JSON.parse(all.stdout);
    expect(manifest.protocolVersion).toBe(HOST_PROTOCOL_VERSION);
    expect(manifest.version).toMatch(/-[0-9a-f]{12}$/);
    expect(JSON.parse(fs.readFileSync(path.join(pkg, 'host-version.json'), 'utf8'))).toStrictEqual(manifest);
    const sha = (f: string) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    expect(manifest.binaries).toStrictEqual({
      'osx-bin/rn-a11y-host': {archs: ['arm64', 'x86_64'], sha256: sha(osx), size: fs.statSync(osx).size},
      'linux64-bin/rn-a11y-host': {archs: ['x86_64'], sha256: sha(linux), size: fs.statSync(linux).size},
      'win64-bin/rn-a11y-host.exe': {archs: ['x86_64'], sha256: sha(win), size: fs.statSync(win).size},
    });
    // Windows has no executable bit.
    for (const file of process.platform === 'win32' ? [] : Object.keys(manifest.binaries)) {
      expect(fs.statSync(path.join(dir, file.startsWith('osx') ? 'rn-a11y-host-darwin' : file.startsWith('linux') ? 'rn-a11y-host-linux-x64' : 'rn-a11y-host-win32-x64', file)).mode & 0o100, file).toBeTruthy();
    }
    expect(fs.existsSync(path.join(pkg, 'index.js')) && fs.existsSync(path.join(pkg, 'index.d.ts'))).toBeTruthy();

    // --artifacts (CI download layout) for linux64 only: the other slots are removed.
    const artifacts = path.join(dir, 'artifacts');
    fs.mkdirSync(path.join(artifacts, 'rn-a11y-host-linux64'), {recursive: true});
    fs.copyFileSync(linux, path.join(artifacts, 'rn-a11y-host-linux64', 'rn-a11y-host'));
    const linuxOnly = pack('--artifacts', artifacts);
    expect(linuxOnly.status, linuxOnly.stderr).toBe(0);
    expect(Object.keys(JSON.parse(linuxOnly.stdout).binaries)).toStrictEqual(['linux64-bin/rn-a11y-host']);
    expect(fs.existsSync(path.join(dir, 'rn-a11y-host-darwin/osx-bin'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'rn-a11y-host-linux-x64/linux64-bin'))).toBe(true);

    // A local one-slice macOS pack must not advertise support for both CPUs.
    const armOnly = pack('--bin', `osx=${machO(path.join(dir, 'arm'), ['arm64'])}`);
    expect(armOnly.status, armOnly.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'rn-a11y-host-darwin/package.json'), 'utf8')).cpu).toEqual(['arm64']);

    // An ELF for an unsupported CPU cannot masquerade as the x64 package.
    const armElf = fs.readFileSync(linux);
    armElf.writeUInt16LE(183, 18);
    fs.writeFileSync(path.join(dir, 'arm-elf'), armElf);
    const wrongCpu = pack('--bin', `linux64=${path.join(dir, 'arm-elf')}`);
    expect(wrongCpu.status).toBe(1);
    expect(wrongCpu.stderr).toContain('expected architectures x86_64, got arm64');

    // A binary of the wrong format for its slot is rejected.
    const wrong = pack('--bin', `linux64=${win}`);
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toMatch(/linux64: .*: expected executable format elf, got pe/);
    fs.rmSync(dir, {recursive: true, force: true});
  });

  it('RN_A11Y_HOST_STDERR_LOG collects the host stderr of every run (fake host)', {timeout: 120_000}, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-stderr-'));
    const log = path.join(dir, 'host-stderr.log');
    const proc = spawnSync(
      'node',
      [path.join(ROOT, 'src/cli.ts'), 'render', path.join(ROOT, 'examples/basic/App.tsx'), '--platform', 'android'],
      {
        cwd: ROOT,
        encoding: 'utf8',
        env: {...process.env, RN_A11Y_HOST_BIN: path.join(ROOT, 'test/fixtures/fake-host.ts'), RN_A11Y_HOST_RUNNER: 'bun', RN_A11Y_HOST_STDERR_LOG: log},
      },
    );
    expect(proc.status, proc.stderr).toBe(0);
    const text = fs.readFileSync(log, 'utf8');
    expect(text).toMatch(/^--- .*fake-host\.ts \(pid \d+\) ---$/m);
    expect(text).toMatch(/fake-host: glog line on stderr/);
    fs.rmSync(dir, {recursive: true, force: true});
  });

  function cliRun(args: string[], env: Record<string, string>, input?: string) {
    return spawnSync('node', [path.join(ROOT, 'src/cli.ts'), ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      input,
      env: {...process.env, RN_A11Y_HOST_BIN: path.join(ROOT, 'test/fixtures/fake-host.ts'), RN_A11Y_HOST_RUNNER: 'bun', ...env},
    });
  }

  it('--tz with an IANA name warns on Windows only (fake host)', {timeout: 120_000}, () => {
    const app = path.join(ROOT, 'examples/basic/App.tsx');
    const iana = cliRun(['render', app, '--platform', 'android', '--tz', 'America/Los_Angeles', '--no-quiet'], {FAKE_HOST_MODE: 'shadow-tree'});
    expect(iana.status, iana.stderr).toBe(0);
    expect(/warning: on Windows --tz needs a POSIX TZ such as JST-9 or PST8PDT/.test(iana.stderr)).toBe(process.platform === 'win32');
    const posix = cliRun(['render', app, '--platform', 'android', '--tz', 'JST-9', '--no-quiet'], {FAKE_HOST_MODE: 'shadow-tree'});
    expect(posix.status, posix.stderr).toBe(0);
    expect(posix.stderr).not.toMatch(/--tz needs a POSIX TZ/);
  });

  it('runtime protocol check (getHostInfo) and hostInfo in the output (fake host)', {timeout: 180_000}, () => {
    const app = path.join(ROOT, 'examples/basic/App.tsx');
    const ok = cliRun(['render', app, '--platform', 'android', '-v'], {FAKE_HOST_MODE: 'shadow-tree'});
    expect(ok.status, ok.stderr).toBe(0);
    const result = JSON.parse(ok.stdout);
    expect(result.hostInfo).toStrictEqual({
      protocolVersion: 1,
      rnVersion: '0.88.0-fake',
      buildType: 'Release',
      sanitize: false,
      engines: {swiftui: true, compose: true},
      fonts: {roboto: true},
    });
    expect(ok.stderr).toMatch(/rn-a11y-tree: host: env .*fake-host\.ts/);
    expect(ok.stderr).toMatch(/rn-a11y-tree: host info: \{"protocolVersion":1/);

    const run = cliRun(['run', app, '--platform', 'android', '--script', 'examples/basic/actions.json'], {FAKE_HOST_MODE: 'run'});
    expect(JSON.parse(run.stdout).hostInfo.protocolVersion).toBe(1);

    // RN_A11Y_HOST_BIN is checked too (no manifest): the running host decides.
    const tooNew = cliRun(['render', app, '--platform', 'android'], {FAKE_HOST_MODE: 'shadow-tree', FAKE_HOST_PROTOCOL: '99'});
    expect(tooNew.status).toBe(5);
    const {error} = JSON.parse(tooNew.stderr.trim().split('\n').pop()!);
    expect(error.code).toBe('HOST_INCOMPATIBLE');
    expect(error.message).toMatch(/speaks protocol 99; this CLI supports 1/);

    // Hosts without getHostInfo: no check, no hostInfo.
    const old = cliRun(['render', app, '--platform', 'android'], {FAKE_HOST_MODE: 'shadow-tree', FAKE_HOST_PROTOCOL: 'none'});
    expect(old.status, old.stderr).toBe(0);
    expect(JSON.parse(old.stdout).hostInfo).toBe(undefined);

    // Session: hostInfo in the ready line; an incompatible host ends the session with exit 5.
    const session = cliRun(['session', app, '--platform', 'android'], {}, '{"id":1,"quit":true}\n');
    expect(session.status, session.stderr).toBe(0);
    expect(JSON.parse(session.stdout.split('\n')[0]).hostInfo.protocolVersion).toBe(1);
    const badSession = cliRun(['session', app, '--platform', 'android'], {FAKE_HOST_PROTOCOL: '0'}, '{"id":1,"quit":true}\n');
    expect(badSession.status).toBe(5);
    const ready = JSON.parse(badSession.stdout.split('\n')[0]);
    expect([ready.ready, ready.error.code]).toStrictEqual([false, 'HOST_INCOMPATIBLE']);
  });

  it('hostEnv: TZ=UTC unless --tz; the rest of the environment is kept', () => {
    expect(DEFAULT_TZ).toBe('UTC');
    expect(hostEnv(undefined).TZ).toBe('UTC');
    expect(hostEnv('Asia/Tokyo').TZ).toBe('Asia/Tokyo');
    expect(hostEnv(undefined).PATH).toBe(process.env.PATH);
  });
});
