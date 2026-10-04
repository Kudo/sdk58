import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(output, '../../..');
const cli = path.join(root, 'packages/react-native-a11y-tree/src/cli.ts');
const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs');
const config = path.join(root, 'packages/react-native-a11y-tree/src/testingConfig.ts');
const cwd = fs.mkdtempSync(path.join(root, 'examples/.agent-token-probe-'));
const records = [];

function capture(name, executable, args, env = {}) {
  const result = spawnSync(executable, args, {cwd, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    env: {...process.env, NO_COLOR: '1', ...env}});
  if (result.error) throw result.error;
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  fs.writeFileSync(path.join(output, `${name}.stdout.txt`), stdout);
  fs.writeFileSync(path.join(output, `${name}.stderr.txt`), stderr);
  const record = {name, exit_code: result.status, signal: result.signal, stdout_bytes: Buffer.byteLength(stdout), stderr_bytes: Buffer.byteLength(stderr),
    stdout_lines: stdout.trimEnd().split('\n').length};
  records.push(record);
  return record;
}

try {
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({name: 'agent-token-probe', private: true, type: 'module'}));
  capture('help-before', process.execPath, [vitest, 'run', '--config', config, '--root', cwd, '--help', '--watch=false']);
  capture('help-after', process.execPath, [cli, 'test', '--help']);
  const brokenApp = path.join(cwd, 'BrokenApp.tsx');
  fs.writeFileSync(brokenApp, "import 'absent-agent-token-dependency'; export default function App(){return null;}\n");
  const cases = {
    passing: `test('should pass', () => expect(1).toBe(1));`,
    'assertion-failure': `test('should expose a fault', () => expect(1).toBe(2));`,
    'missing-query': `test('should locate a missing target', async () => {await render(${JSON.stringify(path.join(root, 'examples/basic/App.tsx'))}, {projectRoot: ${JSON.stringify(root)}, preset:'android-phone'}); screen.getByTestId('absent-target');});`,
    'bundle-failure': `test('should expose a bundle fault', async () => {await render(${JSON.stringify(brokenApp)}, {projectRoot: ${JSON.stringify(root)}});});`,
    'unavailable-host': `test('should expose a missing host', async () => {await render(${JSON.stringify(path.join(root, 'examples/basic/App.tsx'))}, {projectRoot: ${JSON.stringify(root)}});});`,
  };
  for (const [name, body] of Object.entries(cases)) {
    fs.writeFileSync(path.join(cwd, `${name}.a11y.test.ts`), `import {test, expect, render, screen} from 'react-native-a11y-tree/test';\n${body}\n`);
    for (const reporter of ['default', 'dot']) {
      capture(`${name}-${reporter}`, process.execPath, [cli, 'test', `${name}.a11y.test.ts`, `--reporter=${reporter}`],
        name === 'unavailable-host' ? {RN_A11Y_HOST_BIN: path.join(cwd, 'absent-host')} : {});
    }
  }
  capture('no-file-match', process.execPath, [cli, 'test', 'absent-test.a11y.test.ts']);
  capture('no-name-match', process.execPath, [cli, 'test', 'passing.a11y.test.ts', '-t', '^absent$']);
  capture('passing-leading-global', process.execPath, [cli, '--no-stderr', 'test', 'passing.a11y.test.ts']);
  capture('literal-help-name', process.execPath, [cli, 'test', 'passing.a11y.test.ts', '-t', '--help']);
  fs.writeFileSync(path.join(output, 'cli-measurements.json'), JSON.stringify({node: process.version, vitest: require('vitest/package.json').version,
    method: 'Local command output bytes, not model tokens. Before-help executes the exact forwarded Vitest command used by the old wrapper. Runner cases use the revised CLI; filenames, durations, and stack line numbers can change between runs.', records}, null, 2) + '\n');
  for (const record of records) process.stdout.write(`${record.name}: exit ${record.exit_code}; ${record.stdout_bytes + record.stderr_bytes} bytes\n`);
} finally {
  fs.rmSync(cwd, {recursive: true, force: true});
}
