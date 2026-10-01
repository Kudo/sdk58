import {execFileSync, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

/**
 * The packages as users get them: `npm pack` of react-native-a11y-tree (with
 * the bun build in dist/) and rn-a11y-host (filled by release-host --pack),
 * installed into a scratch Expo project with npm; `npx rn-a11y-tree render`.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_BIN = path.join(ROOT, 'native', 'dist', process.arch === 'x64' ? 'x86_64' : process.arch, 'rn-a11y-host');

function has(cmd: string): boolean {
  return spawnSync(cmd, ['--version'], {stdio: 'ignore'}).status === 0;
}

// release-host --pack packs this machine's native/dist host (osx-bin/ on
// macOS, linux64-bin/ on Linux).
const skip = !has('npm')
  ? 'npm is not available'
  : !fs.existsSync(DIST_BIN)
    ? 'no native/dist host to pack: run `bun run build:host`'
    : false;

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  const proc = spawnSync(cmd, args, {cwd, encoding: 'utf8', env: {...process.env, ...env}, maxBuffer: 64 * 1024 * 1024});
  expect(proc.status, `${cmd} ${args.join(' ')}\n${proc.stdout}\n${proc.stderr}`).toBe(0);
  return proc;
}

describe('package', () => {
  it('npm pack both packages, install into a scratch Expo project, npx rn-a11y-tree render', {timeout: 900_000}, t => {
    if (skip) t.skip(skip);
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-pkgtest-')));
    try {
      // rn-a11y-host: a copy of the package directory, packed with the built host.
      const hostDir = path.join(work, 'rn-a11y-host');
      fs.cpSync(path.join(ROOT, 'packages', 'rn-a11y-host'), hostDir, {
        recursive: true,
        filter: src => !/[\\/](osx-bin|linux64-bin|win64-bin|host-version\.json)$/.test(src),
      });
      run('bun', [path.join(ROOT, 'scripts', 'release-host.ts'), '--pack', '--package-dir', hostDir], ROOT);
      const tarballs = path.join(work, 'tarballs');
      fs.mkdirSync(tarballs);
      run('npm', ['pack', '--pack-destination', tarballs], hostDir);
      // react-native-a11y-tree: dist/ from `bun run build` (prepack), then the files whitelist.
      run('npm', ['pack', '--pack-destination', tarballs], ROOT);
      const files = fs.readdirSync(tarballs).sort();
      expect(files.map(f => f.replace(/-\d+\.\d+\.\d+.*\.tgz$/, ''))).toStrictEqual(['react-native-a11y-tree', 'rn-a11y-host']);
      for (const f of files) t.annotate(`${f}: ${fs.statSync(path.join(tarballs, f)).size} bytes`);

      const listing = run('tar', ['-tzf', path.join(tarballs, files[0])], work).stdout;
      expect(listing).toMatch(/package\/dist\/rn-a11y-tree\.js/);
      expect(listing).not.toMatch(/package\/(src|native|test|e2e|examples|third_party)\//);

      const project = path.join(work, 'app');
      fs.mkdirSync(project);
      run('npm', ['init', '-y'], project);
      run(
        'npm',
        ['install', '--no-audit', '--no-fund', 'expo@58.0.0', 'react-native@0.88.0-rc.2', 'react@19.3.0', ...files.map(f => path.join(tarballs, f))],
        project,
      );
      fs.copyFileSync(path.join(ROOT, 'examples', 'basic', 'App.tsx'), path.join(project, 'App.tsx'));
      const env = {RN_A11Y_HOST_BIN: '', RN_A11Y_TREE_CACHE_DIR: ''};
      const render = run('npx', ['rn-a11y-tree', 'render', 'App.tsx', '--preset', 'android-phone', '--format', 'text'], project, env);
      expect(render.stdout).toMatch(/^RootView RootView \{0,0,412x915\}$/m);
      expect(render.stdout).toMatch(/^ {4}submit View #submit role=button "Submit" \{24,[\d.]+,364x48\}$/m);

      // The host came from the rn-a11y-host package, with its protocol version.
      const session = spawnSync('npx', ['rn-a11y-tree', 'session', 'App.tsx', '--preset', 'android-phone'], {
        cwd: project,
        encoding: 'utf8',
        input: '{"id":1,"quit":true}\n',
        env: {...process.env, ...env},
      });
      const ready = JSON.parse(session.stdout.split('\n')[0]);
      expect(ready.ready).toBe(true);
      expect(ready.host.source).toBe('package');
      expect(ready.host.protocolVersion).toBe(1);
    } finally {
      fs.rmSync(work, {recursive: true, force: true});
    }
  });
});
