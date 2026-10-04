import {EventEmitter} from 'node:events';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({spawn: vi.fn(), resolve: vi.fn(), createRequire: vi.fn()}));
vi.mock('node:child_process', () => ({spawn: mocks.spawn}));
vi.mock('node:module', () => ({createRequire: mocks.createRequire}));

import {runTests, testArguments, TEST_HELP} from '../packages/react-native-a11y-tree/src/testingCommand.ts';

const originalExitCode = process.exitCode;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockReturnValue('/runner/package.json');
  mocks.createRequire.mockReturnValue({resolve: mocks.resolve});
  process.exitCode = undefined;
});
afterEach(() => {vi.restoreAllMocks(); process.exitCode = originalExitCode;});

describe('Parsing test arguments', () => {
  it('should forward file filters and runner options in order', () => {
    const args = ['notes.a11y.test.ts', '-t', 'should save', '--reporter=json', '--outputFile=result.json'];
    expect(testArguments(args)).toEqual({forwarded: args, help: false, stderr: true});
  });

  it.each(['--help', '-h'])('should recognize %s after file filters', flag => {
    expect(testArguments(['notes.a11y.test.ts', flag]).help).toBe(true);
  });

  it.each(['-t', '--testNamePattern', '--reporter', '--outputFile', '--outputFile.json', '--pool'])('should preserve wrapper-like values for %s', flag => {
    for (const value of ['--help', '-h', '--no-stderr']) {
      const name = flag === '-t' ? '--testNamePattern' : flag;
      expect(testArguments([flag, value])).toEqual({forwarded: [`${name}=${value}`], help: false, stderr: true});
    }
  });

  it('should preserve literal operands after the delimiter', () => {
    const args = ['--', '--help', '--no-stderr'];
    expect(testArguments(args)).toEqual({forwarded: args, help: false, stderr: true});
  });

  it('should consume stderr suppression without changing runner arguments', () => {
    expect(testArguments(['--no-stderr', '-t', 'should save'])).toEqual({forwarded: ['-t', 'should save'], help: false, stderr: false});
  });

  it('should leave missing option values for the runner to validate', () => {
    expect(testArguments(['-t']).forwarded).toEqual(['-t']);
  });
});

describe('Running flow tests', () => {
  it('should print concise help without resolving or spawning the runner', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    await runTests(['--help']);
    expect(write).toHaveBeenCalledWith(TEST_HELP);
    expect(Buffer.byteLength(TEST_HELP)).toBeLessThanOrEqual(1200);
    expect(TEST_HELP.trimEnd().split('\n').length).toBeLessThanOrEqual(20);
    expect(mocks.createRequire).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it.for([[], ['notes.a11y.test.ts', '-t', 'should save']])('should run once with forwarded filters %j', async args => {
    const child = Object.assign(new EventEmitter(), {kill: vi.fn()});
    mocks.spawn.mockImplementation(() => {queueMicrotask(() => child.emit('close', 0, null)); return child;});
    await runTests(args);
    expect(mocks.spawn).toHaveBeenCalledWith(process.execPath,
      ['/runner/vitest.mjs', 'run', '--config', expect.stringMatching(/testingConfig\.ts$/), '--root', process.cwd(), ...args, '--watch=false'],
      {stdio: ['inherit', 'inherit', 'inherit']});
    expect(process.exitCode).toBe(0);
  });

  it.each([['local', ['--no-stderr'], true], ['global', [], false]] as const)('should suppress child stderr for %s options', async (_scope, args, stderr) => {
    const child = new EventEmitter();
    mocks.spawn.mockImplementation(() => {queueMicrotask(() => child.emit('close', 1, null)); return child;});
    await runTests([...args], stderr);
    expect(mocks.spawn.mock.calls[0][1]).not.toContain('--no-stderr');
    expect(mocks.spawn.mock.calls[0][2].stdio).toEqual(['inherit', 'inherit', 'ignore']);
    expect(process.exitCode).toBe(1);
  });

  it.each([['SIGINT', 130], ['SIGTERM', 1]] as const)('should forward %s and clean up signal handlers', async (signal, status) => {
    const previous = process.listeners(signal);
    const child = Object.assign(new EventEmitter(), {kill: vi.fn()});
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        const handler = process.listeners(signal).find(listener => !previous.includes(listener))!;
        handler(signal);
        child.emit('close', null, signal);
      });
      return child;
    });
    await runTests([]);
    expect(child.kill).toHaveBeenCalledWith(signal);
    expect(process.exitCode).toBe(status);
    expect(process.listeners(signal)).toEqual(previous);
  });

  it('should report a missing runner dependency', async () => {
    mocks.resolve.mockImplementation(() => {throw new Error('missing');});
    await expect(runTests([])).rejects.toThrow('test runner dependency is missing');
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('should clean up handlers when the runner cannot start', async () => {
    const previous = process.listeners('SIGINT');
    const child = new EventEmitter();
    mocks.spawn.mockImplementation(() => {queueMicrotask(() => child.emit('error', new Error('spawn failed'))); return child;});
    await expect(runTests([])).rejects.toThrow('spawn failed');
    expect(process.listeners('SIGINT')).toEqual(previous);
  });
});
