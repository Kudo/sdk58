import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {afterEach, describe, expect, it} from 'vitest';
import {TEST_HELP} from '../packages/react-native-a11y-tree/src/testingCommand.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const CLI = path.join(ROOT, 'packages/react-native-a11y-tree/src/cli.ts');
function run(args: string[], cwd = ROOT) {
  return spawnSync(process.execPath, [CLI, ...args], {cwd, encoding: 'utf8', timeout: 30_000});
}

const dirs: string[] = [];
afterEach(() => {for (const dir of dirs.splice(0)) fs.rmSync(dir, {recursive: true, force: true});});
function fixture() {
  const dir = fs.mkdtempSync(path.join(ROOT, 'examples/.test-runner-'));
  dirs.push(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'test-runner-fixture', private: true, type: 'module'}));
  fs.writeFileSync(path.join(dir, 'notes.a11y.test.ts'), `
    import {test, expect} from 'react-native-a11y-tree/test';
    test('should pass', () => expect(1).toBe(1));
    test('should fail', () => expect(1).toBe(2));
  `);
  return dir;
}

describe('Discovering flow test commands', () => {
  it.for([
    ['test', '--help'], ['test', '-h'], ['test', 'notes.a11y.test.ts', '--help'],
    ['help', 'test'], ['--no-stderr', 'test', '--help'], ['test', '--no-stderr', '--help'],
  ])('should print concise help for %j', args => {
    const result = run(args);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(TEST_HELP);
    expect(result.stderr).toBe('');
  });

  it('should preserve literal file operands after the delimiter', () => {
    const result = run(['test', '--', '--help'], fixture());
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).not.toBe(TEST_HELP);
    expect(result.stdout).not.toContain('Usage:');
  });

  it('should reject unknown runner options even with a leading global option', () => {
    const result = run(['--no-stderr', 'test', '--unknown-runner-option']);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toBe(TEST_HELP);
  });
});

describe('Running selected flow files', () => {
  it('should run all discovered tests once and preserve assertion failures', () => {
    const result = run(['test'], fixture());
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain('1 failed');
    expect(result.stdout).toContain('1 passed');
  });

  it.for([
    ['test', 'notes.a11y.test.ts', '-t', '^should pass$'],
    ['--no-stderr', 'test', '-t', '^should pass$', 'notes.a11y.test.ts'],
  ])('should select a passing test with file and name filters %j', args => {
    const result = run(args, fixture());
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('1 passed');
    expect(result.stdout).toContain('1 skipped');
  });

  it('should preserve JSON reporter and output-file options', () => {
    const cwd = fixture();
    const result = run(['test', 'notes.a11y.test.ts', '-t', '^should pass$', '--reporter=json', '--outputFile=results.json'], cwd);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const report = JSON.parse(fs.readFileSync(path.join(cwd, 'results.json'), 'utf8'));
    expect(report.numPassedTests).toBe(1);
    expect(report.numPendingTests).toBe(1);
  });

  it('should fail for missing file filters unless the runner override is explicit', () => {
    const cwd = fixture();
    expect(run(['test', 'absent.a11y.test.ts'], cwd).status).toBe(1);
    expect(run(['test', 'absent.a11y.test.ts', '--passWithNoTests'], cwd).status).toBe(0);
  });

  it('should preserve runner status and expose skipped counts for zero matched names', () => {
    const result = run(['test', 'notes.a11y.test.ts', '-t', '^absent$'], fixture());
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('2 skipped');
    expect(result.stdout).not.toContain('2 passed');
  });

  it('should treat a help-like name pattern as a value instead of runner help', () => {
    const cwd = fixture();
    const file = path.join(cwd, 'notes.a11y.test.ts');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('should pass', 'should pass --help'));
    const result = run(['test', 'notes.a11y.test.ts', '-t', '--help'], cwd);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('1 passed');
    expect(result.stdout).not.toContain('Usage:');
  });
});
