import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {DEFAULT_HOST_BIN} from '../src/host.ts';
import {hasNpm, npmTool} from '../test/fixtures/npm.ts';

/**
 * The packages as users get them: `npm pack` of react-native-a11y-tree (with
 * the bun build in dist/) and its optional runtime (release-host --pack),
 * installed into a scratch Expo project with npm; `npx rn-a11y-tree render`.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// release-host --pack packs this machine's native/dist host (osx-bin/ on
// macOS, linux64-bin/ on Linux, win64-bin/ on Windows).
const skip = !hasNpm
  ? 'npm is not available'
  : !fs.existsSync(DEFAULT_HOST_BIN)
    ? 'no native/dist host to pack: run `bun run build:host`'
    : false;

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  const options = {cwd, env: {...process.env, ...env}, maxBuffer: 64 * 1024 * 1024};
  const proc =
    cmd === 'npm' || cmd === 'npx' ? npmTool(cmd, args, options) : spawnSync(cmd, args, {...options, encoding: 'utf8'});
  expect(proc.status, `${cmd} ${args.join(' ')}\n${proc.stdout}\n${proc.stderr}`).toBe(0);
  return proc;
}

describe('package', () => {
  it('npm pack CLI and matching runtime, install into a scratch Expo project, npx rn-a11y-tree render', {timeout: 900_000}, t => {
    if (skip) t.skip(skip);
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-pkgtest-')));
    try {
      const packagesDir = path.join(work, 'packages');
      run('bun', [path.join(ROOT, 'scripts', 'release-host.ts'), '--pack', '--packages-dir', packagesDir], ROOT);
      const tarballs = path.join(work, 'tarballs');
      fs.mkdirSync(tarballs);
      const platformName = process.platform === 'darwin' ? 'darwin-universal' : process.platform === 'linux' ? 'linux-x64-gnu' : 'win32-x64-msvc';
      run('npm', ['pack', '--pack-destination', tarballs], path.join(packagesDir, `runtime-${platformName}`));
      // react-native-a11y-tree: dist/ from `bun run build` (prepack), then the files whitelist.
      run('npm', ['pack', '--pack-destination', tarballs], ROOT);
      const files = fs.readdirSync(tarballs).sort();
      expect(files.map(f => f.replace(/-\d+\.\d+\.\d+.*\.tgz$/, ''))).toStrictEqual(['react-native-a11y-tree', `react-native-a11y-tree-runtime-${platformName}`]);
      for (const f of files) t.annotate(`${f}: ${fs.statSync(path.join(tarballs, f)).size} bytes`);

      // A relative path: Git for Windows' tar reads `C:` as a remote host.
      const listing = run('tar', ['-tzf', files[0]], tarballs).stdout;
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
      const env = {RN_A11Y_HOST_BIN: '', RN_A11Y_TREE_CACHE_DIR: '', RN_A11Y_HOST_SKIP_PACKAGE: '', RN_A11Y_HOST_BASE_URL: '', RN_A11Y_HOST_MANIFEST: ''};
      const render = run('npx', ['rn-a11y-tree', 'render', 'App.tsx', '--preset', 'android-phone', '--format', 'text', '-v'], project, env);
      expect(render.stdout).toMatch(/^RootView RootView \{0,0,412x915\}$/m);
      expect(render.stdout).toMatch(/^ {4}submit View #submit role=button "Submit" \{24,[\d.]+,364x48\}$/m);

      // The host came directly from the optional runtime package, with its protocol version.
      const session = npmTool('npx', ['rn-a11y-tree', 'session', 'App.tsx', '--preset', 'android-phone'], {
        cwd: project,
        input: '{"id":1,"quit":true}\n',
        env: {...process.env, ...env},
      });
      const ready = JSON.parse(session.stdout.split('\n')[0]);
      expect(ready.ready).toBe(true);
      expect(ready.host.source).toBe('package');
      expect(ready.host.protocolVersion).toBe(1);
      expect(render.stderr).toContain(`runtime-${platformName}`);
      expect(fs.existsSync(path.join(project, 'node_modules/rn-a11y-host'))).toBe(false);
    } finally {
      fs.rmSync(work, {recursive: true, force: true});
    }
  });
});
