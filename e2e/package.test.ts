import {execFile, execFileSync, spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {hostBin, skipUnsupported} from './helpers.ts';
import {hasNpm, npmTool} from '../test/fixtures/npm.ts';

/**
 * The packages as users get them: `npm pack` of react-native-a11y-tree (with
 * the bun build in dist/) and its optional runtime (release-host --pack),
 * installed into a scratch Expo project with npm; `npx rn-a11y-tree render`.
 */

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Package the selected host, including a release tarball's extracted binary.
const skip = !hasNpm
  ? 'npm is not available'
  : !(hostBin && fs.existsSync(hostBin))
    ? 'no selected host to pack: build it or set RN_A11Y_HOST_BIN'
    : false;

const INSTALL_TIMEOUT_MS = 480_000;
// Reserve a minute of the 900s test budget for assertions and cleanup. Vitest
// cannot interrupt spawnSync, so each child must also respect this deadline.
function createRunner(budgetMs = 840_000) {
  const deadline = performance.now() + budgetMs;
  return function run(cmd: string, args: string[], cwd: string, options: {
    env?: Record<string, string>; input?: string; timeoutMs?: number;
  } = {}) {
    const timeout = Math.min(options.timeoutMs ?? 120_000, Math.floor(deadline - performance.now()));
    if (timeout <= 0) throw new Error(`Package test subprocess budget exhausted before ${cmd}`);
    const started = performance.now();
    const spawnOptions = {cwd, env: {...process.env, ...options.env}, input: options.input,
      maxBuffer: 64 * 1024 * 1024, timeout, killSignal: 'SIGKILL' as const};
    const proc = cmd === 'npm' || cmd === 'npx'
      ? npmTool(cmd, args, spawnOptions)
      : spawnSync(cmd, args, {...spawnOptions, encoding: 'utf8'});
    if (proc.error || proc.status !== 0) {
      const error = proc.error as NodeJS.ErrnoException | undefined;
      throw new Error(`${cmd} ${args.join(' ')}\nstatus=${proc.status} signal=${proc.signal} error=${error?.code ?? 'none'} ${error?.message ?? ''}\nelapsedMs=${Math.round(performance.now() - started)} timeoutMs=${timeout}\n${proc.stdout}\n${proc.stderr}`);
    }
    return proc;
  };
}

describe('package', () => {
  it('should run the packed test command and API without a project Vitest installation', {timeout: 180_000}, async t => {
    if (!(hostBin && fs.existsSync(hostBin))) skipUnsupported(t, 'no selected host for the test API');
    if (!hasNpm) t.skip('npm is not available');
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-vitest-')));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'vitest-package', private: true}));
    try {
      const packed = npmTool('npm', ['pack', '--json', '--pack-destination', root], {cwd: path.join(ROOT, 'packages/react-native-a11y-tree'), maxBuffer: 4 * 1024 * 1024});
      expect(packed.status, packed.stderr).toBe(0);
      const filename = JSON.parse(packed.stdout.slice(packed.stdout.indexOf('[')))[0].filename;
      const installed = path.join(root, 'node_modules/react-native-a11y-tree');
      fs.mkdirSync(installed, {recursive: true});
      execFileSync('tar', ['-xzf', filename, '--strip-components=1', '-C', 'node_modules/react-native-a11y-tree'], {cwd: root});
      // Link individual runner packages to avoid overlapping Metro crawl roots
      // for a node_modules directory and a symlink to that entire directory.
      const dependencies = path.join(installed, 'node_modules');
      fs.mkdirSync(dependencies);
      for (const name of ['vite', 'vitest']) {
        fs.symlinkSync(path.join(ROOT, 'node_modules', name), path.join(dependencies, name), process.platform === 'win32' ? 'junction' : 'dir');
      }
      expect(fs.existsSync(path.join(root, 'node_modules/vitest'))).toBe(false);
      expect(JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8')).dependencies.vitest).toBe('5.0.3');
      fs.writeFileSync(path.join(root, 'public.a11y.test.ts'), `
        import {test,expect,render,screen,user} from 'react-native-a11y-tree/test';
        const options={projectRoot:${JSON.stringify(ROOT)}};const app=${JSON.stringify(path.join(ROOT,'examples/basic/App.tsx'))};
        test('should submit through the packaged API',async()=>{
          await render(app,options);await user.type(screen.getByTestId('email'),'first worker');
          await user.press(screen.getByRole('button',{name:'Submit'}));
          expect(await screen.findByText('Submitted')).toHaveTextContent('Submitted');
          expect(screen.getByTestId('email')).toHaveTextContent('first worker');
        });
        test('should clean up the previous test and reset state',async()=>{
          expect(()=>screen.queryByText('Submitted')).toThrow(/Render an app/);
          await render(app,options);expect(screen.queryByText('Submitted')).toBeNull();
          expect(screen.getByTestId('email')).toHaveTextContent('');
        });`);
      fs.writeFileSync(path.join(root, 'isolated.a11y.test.ts'), `
        import {test,expect,render,screen,user} from 'react-native-a11y-tree/test';
        test('should keep screen and app state isolated in another worker',async()=>{
          await render(${JSON.stringify(path.join(ROOT,'examples/basic/App.tsx'))},{projectRoot:${JSON.stringify(ROOT)}});
          await user.type(screen.getByTestId('email'),'second worker');
          expect(await screen.findByTestId('email')).toHaveTextContent('second worker');
          expect(screen.queryByText('Submitted')).toBeNull();
        });`);
      fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({compilerOptions: {target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext', noEmit: true, strict: true, skipLibCheck: true}, include: ['public.a11y.test.ts']}));
      const checked = await exec(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', path.join(root,'tsconfig.json')], {cwd: root});
      expect(checked.stdout).toBe('');
      const result = await exec(process.execPath, [path.join(installed, 'dist/rn-a11y-tree.js'), 'test'], {cwd: root, env: {...process.env, RN_A11Y_HOST_BIN: hostBin}, timeout: 120_000});
      expect(result.stdout).toContain('3 passed');
      const otherRunner = path.join(root, 'node_modules/vitest');
      fs.mkdirSync(otherRunner);
      fs.writeFileSync(path.join(otherRunner, 'package.json'), JSON.stringify({name: 'vitest', version: '0.0.0'}));
      fs.writeFileSync(path.join(otherRunner, 'vitest.mjs'), `throw new Error('project runner unexpectedly selected')`);
      fs.writeFileSync(path.join(root, 'failed.a11y.test.ts'), `
        import {test,expect,render,screen} from 'react-native-a11y-tree/test';
        test('should report a failed expectation',async()=>{
          await render(${JSON.stringify(path.join(ROOT,'examples/basic/App.tsx'))},{projectRoot:${JSON.stringify(ROOT)}});
          expect(screen.getByRole('button',{name:'Submit'})).toHaveTextContent('Wrong');
        });
        test.concurrent('should reject concurrent screen access',()=>{throw new Error('concurrent body unexpectedly executed')});`);
      const reportFile = path.join(root, 'failures.json');
      let exitCode: unknown;
      try {
        await exec(process.execPath, [path.join(installed, 'dist/rn-a11y-tree.js'), 'test', 'failed', '--reporter=json', `--outputFile=${reportFile}`], {cwd: root, env: {...process.env, RN_A11Y_HOST_BIN: hostBin}, timeout: 120_000});
      } catch (error) {exitCode = (error as {code: unknown}).code;}
      expect(exitCode).toBe(1);
      const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      expect(report.numFailedTests).toBe(2);
      const assertions = report.testResults[0].assertionResults;
      const failure = assertions.find((result: {fullName: string}) => result.fullName === 'should report a failed expectation');
      expect(failure.failureMessages.join('\n')).toContain('Received: "Submit"');
      expect(failure.failureMessages.join('\n')).toContain('Wrong');
      const concurrent = assertions.find((result: {fullName: string}) => result.fullName === 'should reject concurrent screen access');
      expect(concurrent.failureMessages.join('\n')).toContain('use sequential tests');
      expect(concurrent.failureMessages.join('\n')).not.toContain('concurrent body unexpectedly executed');
    } finally {fs.rmSync(root, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});}
  });

  it('reports timed-out children and clips an install-sized budget to the remaining overall deadline', () => {
    const run = createRunner(150);
    const started = performance.now();
    expect(() => run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], ROOT, {timeoutMs: INSTALL_TIMEOUT_MS}))
      .toThrow(/status=null signal=.*error=ETIMEDOUT[\s\S]*elapsedMs=\d+ timeoutMs=\d+/);
    expect(performance.now() - started).toBeLessThan(5_000);
    expect(() => createRunner(0)(process.execPath, ['-e', ''], ROOT)).toThrow(/budget exhausted/);
  });

  it('reports a nonzero child exit with its captured stderr', () => {
    expect(() => createRunner()(process.execPath, ['-e', 'console.error("package harness sentinel"); process.exit(7)'], ROOT))
      .toThrow(/status=7 signal=null error=none[\s\S]*package harness sentinel/);
  });

  it('npm pack CLI and matching runtime, install into a scratch Expo project, npx rn-a11y-tree render', {timeout: 900_000}, t => {
    if (skip) skipUnsupported(t, skip);
    const run = createRunner();
    const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-pkgtest-')));
    try {
      const packagesDir = path.join(work, 'packages');
      run('bun', [path.join(ROOT, 'scripts', 'release-host.ts'), '--pack', '--bin', hostBin!, '--packages-dir', packagesDir], ROOT);
      const tarballs = path.join(work, 'tarballs');
      fs.mkdirSync(tarballs);
      const platformName = process.platform === 'darwin' ? 'darwin-universal' : process.platform === 'linux' ? 'linux-x64-gnu' : 'win32-x64-msvc';
      run('npm', ['pack', '--pack-destination', tarballs], path.join(packagesDir, `runtime-${platformName}`));
      // react-native-a11y-tree: dist/ from `bun run build` (prepack), then the files whitelist.
      run('npm', ['pack', '--pack-destination', tarballs], path.join(ROOT, 'packages/react-native-a11y-tree'));
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
        {timeoutMs: INSTALL_TIMEOUT_MS},
      );
      fs.copyFileSync(path.join(ROOT, 'examples', 'basic', 'App.tsx'), path.join(project, 'App.tsx'));
      const env = {RN_A11Y_HOST_BIN: '', RN_A11Y_TREE_CACHE_DIR: '', RN_A11Y_HOST_SKIP_PACKAGE: '', RN_A11Y_HOST_BASE_URL: '', RN_A11Y_HOST_MANIFEST: ''};
      const render = run('npx', ['rn-a11y-tree', 'render', 'App.tsx', '--preset', 'android-phone', '--format', 'text', '-v'], project, {env});
      expect(render.stdout).toMatch(/^n\d+ View \{0,0,412x915\}$/m);
      expect(render.stdout).toMatch(/^ #submit button "Submit" \{24,253,364x48\}$/m);

      // The host came directly from the optional runtime package, with its protocol version.
      const session = run('npx', ['rn-a11y-tree', 'session', 'App.tsx', '--preset', 'android-phone'], project, {
        input: '{"id":1,"quit":true}\n',
        env,
      });
      const ready = JSON.parse(session.stdout.split('\n')[0]);
      expect(ready.ready).toBe(true);
      expect(ready.host.source).toBe('package');
      expect(ready.host.protocolVersion).toBe(2);
      expect(render.stderr).toContain(`runtime-${platformName}`);
      expect(fs.existsSync(path.join(project, 'node_modules/rn-a11y-host'))).toBe(false);
    } finally {
      fs.rmSync(work, {recursive: true, force: true});
    }
  });
});
