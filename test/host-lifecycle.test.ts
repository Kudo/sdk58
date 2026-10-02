import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {afterAll, afterEach, beforeAll, expect, it, vi} from 'vitest';
import {runHost} from '../packages/react-native-a11y-tree/src/host.ts';

const DEADLINE_MS = 1500;
const RETURN_BOUND_MS = DEADLINE_MS + 1250 + 2000;
const TEST_OPTIONS = {timeout: 10000};
type Logs = {level: string; message: string}[];

function workerPid(logs: Logs): number | undefined {
  const match = logs.map(entry => /^worker:(\d+)$/.exec(entry.message)).find(Boolean);
  return match ? Number(match[1]) : undefined;
}

function hasExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      // An orphan may remain a zombie until CI's PID 1 reaps it. It has
      // already exited and cannot retain pipes or execute further work.
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      return ['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3));
    }
    return false;
  } catch (error) {
    if (['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) return true;
    throw error;
  }
}

async function cleanUpWorker(logs: Logs): Promise<void> {
  const pid = workerPid(logs);
  if (pid === undefined || hasExited(pid)) return;
  try { process.kill(pid, 'SIGKILL'); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
  await vi.waitFor(() => expect(hasExited(pid)).toBe(true), {timeout: 1500, interval: 25});
}

let directory: string;
let fixture: string;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'host-lifecycle-'));
  fixture = path.join(directory, 'host.cjs');
  fs.writeFileSync(fixture, `
    const mode = process.argv[process.argv.indexOf('--bundlePath') + 1];
    if (mode === 'forced') process.on('SIGTERM', () => {});
    else process.on('SIGTERM', () => { process.stderr.write('graceful shutdown\\n'); process.exit(0); });
    console.log(JSON.stringify({type: 'console-log', level: 'info', message: String(process.pid)}));
    if (mode === 'stderr') process.stderr.write('EARLY_SANITIZER_MARKER\\n' + 'x'.repeat(200000) + '\\nTAIL\\n');
    if (mode === 'result' || mode === 'success') console.log(JSON.stringify({type: 'rn-a11y-tree-result', rnA11yTree: {done: true}}));
    if (mode === 'success') process.exit(0);
    if (mode === 'runner' || mode === 'escaped') {
      const {spawn} = require('node:child_process');
      const worker = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], {stdio: 'inherit', detached: mode === 'escaped'});
      console.log(JSON.stringify({type: 'console-log', level: 'info', message: 'worker:' + worker.pid}));
    }
    setInterval(() => {}, 1000);
  `);
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => fs.rmSync(directory, {recursive: true, force: true}));

function options(mode: string, extra = {}) {
  vi.stubEnv('RN_A11Y_HOST_BIN', fixture);
  vi.stubEnv('RN_A11Y_HOST_RUNNER', process.execPath);
  vi.stubEnv('RN_A11Y_HOST_STDERR_LOG', '');
  return {bundlePath: mode, timeoutMs: DEADLINE_MS, quiet: true, ...extra};
}

it.each(['never', 'result', 'forced', 'stderr'])('bounds %s hosts and waits for the child to exit', TEST_OPTIONS, async mode => {
  const logs: {level: string; message: string}[] = [];
  const started = performance.now();
  const error = await runHost(options(mode, {logs})).catch(error => error);
  expect(error.code).toBe('TIMEOUT');
  expect(performance.now() - started).toBeLessThan(RETURN_BOUND_MS);
  expect(logs.length).toBeGreaterThan(0);
  expect(() => process.kill(Number(logs[0].message), 0)).toThrow();
  if (mode === 'never' && process.platform !== 'win32') expect(error.details.stderrTail).toContain('graceful shutdown');
  if (mode === 'stderr') {
    expect(error.details.stderrTail).toContain('TAIL');
    expect(error.details.stderrTail.length).toBeLessThanOrEqual(65536);
  }
});

it('cancels an active host and removes its abort listener', TEST_OPTIONS, async () => {
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const timer = setTimeout(() => controller.abort(), 150);
  try {
    const error = await runHost(options('never', {timeoutMs: 10000, signal: controller.signal})).catch(error => error);
    expect(error).toMatchObject({code: 'HOST_CRASHED', details: {cancelled: true}});
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  } finally { clearTimeout(timer); }
});

it('streams the complete stderr log with one header while retaining only a bounded tail', TEST_OPTIONS, async () => {
  const opts = options('stderr');
  const logFile = path.join(directory, 'stderr.log');
  vi.stubEnv('RN_A11Y_HOST_STDERR_LOG', logFile);
  const error = await runHost(opts).catch(error => error);
  expect(error.code).toBe('TIMEOUT');
  const log = fs.readFileSync(logFile, 'utf8');
  expect(log).toContain('EARLY_SANITIZER_MARKER\n' + 'x'.repeat(200000) + '\nTAIL\n');
  expect(log.match(/^--- /gm)).toHaveLength(1);
  expect(error.details.stderrTail).not.toContain('EARLY_SANITIZER_MARKER');
  expect(error.details.stderrTail).toContain('TAIL');
});

it('does not spawn for an already aborted signal', TEST_OPTIONS, async () => {
  const logs: {level: string; message: string}[] = [];
  await expect(runHost(options('never', {logs, signal: AbortSignal.abort(new Error('cancelled'))}))).rejects.toMatchObject({code: 'HOST_CRASHED', details: {cancelled: true}});
  expect(logs).toEqual([]);
});

it.each([0, -1, 1.5, NaN, Infinity, 2147483648])('rejects invalid deadline %s before spawning', TEST_OPTIONS, async timeoutMs => {
  await expect(runHost(options('never', {timeoutMs}))).rejects.toMatchObject({code: 'USAGE'});
});

it.each(['success', 'forced'])('clears all lifecycle timers on %s', TEST_OPTIONS, async mode => {
  const set = vi.spyOn(globalThis, 'setTimeout');
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  const result = await runHost(options(mode)).catch(error => error);
  if (mode === 'success') expect(result).toEqual({done: true});
  else expect(result.code).toBe('TIMEOUT');
  for (const call of set.mock.results) expect(clear).toHaveBeenCalledWith(call.value);
});

it('uses a 30 second default and clears it after success', TEST_OPTIONS, async () => {
  const set = vi.spyOn(globalThis, 'setTimeout');
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  await expect(runHost(options('success', {timeoutMs: undefined}))).resolves.toEqual({done: true});
  expect(set).toHaveBeenCalledWith(expect.any(Function), 30000);
  for (const call of set.mock.results) expect(clear).toHaveBeenCalledWith(call.value);
});

it('cleans up timers and the abort listener when the runner cannot spawn', TEST_OPTIONS, async () => {
  const opts = options('never');
  vi.stubEnv('RN_A11Y_HOST_RUNNER', path.join(directory, 'missing-runner'));
  const controller = new AbortController();
  const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const set = vi.spyOn(globalThis, 'setTimeout');
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  await expect(runHost({...opts, signal: controller.signal})).rejects.toMatchObject({code: 'HOST_CRASHED'});
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  for (const call of set.mock.results) expect(clear).toHaveBeenCalledWith(call.value);
});

it.skipIf(process.platform === 'win32')('escalates against the runner process group after its leader exits', TEST_OPTIONS, async () => {
  const logs: {level: string; message: string}[] = [];
  try {
    const started = performance.now();
    const error = await runHost(options('runner', {logs})).catch(error => error);
    expect(error.code).toBe('TIMEOUT');
    expect(performance.now() - started).toBeLessThan(RETURN_BOUND_MS);
    const pid = workerPid(logs);
    expect(pid).toBeDefined();
    // Assert before defensive cleanup: bounded return alone could hide a leak.
    await vi.waitFor(() => expect(hasExited(pid!)).toBe(true), {timeout: 1500, interval: 25});
  } finally {
    await cleanUpWorker(logs);
  }
});

it.skipIf(process.platform === 'win32')('bounds inherited pipes held by a descendant outside the process group', TEST_OPTIONS, async () => {
  const logs: {level: string; message: string}[] = [];
  const set = vi.spyOn(globalThis, 'setTimeout');
  const clear = vi.spyOn(globalThis, 'clearTimeout');
  try {
    const started = performance.now();
    const error = await runHost(options('escaped', {logs})).catch(error => error);
    expect(error).toMatchObject({code: 'TIMEOUT', details: {cleanupTimedOut: true}});
    expect(performance.now() - started).toBeLessThan(RETURN_BOUND_MS);
    for (const call of set.mock.results) expect(clear).toHaveBeenCalledWith(call.value);
  } finally {
    await cleanUpWorker(logs);
  }
});
