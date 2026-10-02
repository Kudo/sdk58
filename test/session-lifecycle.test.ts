import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {PassThrough, Writable} from 'node:stream';
import {afterAll, afterEach, beforeAll, expect, it, vi} from 'vitest';
import {runSession} from '../packages/react-native-a11y-tree/src/session.ts';

const TEST_OPTIONS = {timeout: 10_000};
let directory: string;
let fixture: string;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'session-lifecycle-'));
  fixture = path.join(directory, 'host.cjs');
  fs.writeFileSync(fixture, String.raw`
    const fs = require('node:fs');
    const mode = process.argv[process.argv.indexOf('--bundlePath') + 1];
    fs.appendFileSync(process.env.TEST_SESSION_PIDS, process.pid + '\n');
    process.on('SIGTERM', () => {
      if (mode === 'forced' || mode.startsWith('cancel-')) return;
      if (mode === 'timeout-stderr') {process.stderr.write('FINAL_SANITIZER_MARKER\n', () => process.exit(0)); return;}
      process.exit(0);
    });
    const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
    let evalId = 0;
    let diagnosticId = 0;
    const complete = () => emit({type: 'repl-eval-complete', id: evalId++});
    const response = request => emit({type: 'rn-a11y-tree-response', id: request.id, ok: true,
      ...(request.start ? {ready: true, hostInfo: {protocolVersion: 1}} : {}),
      ...(request.quit ? {quit: true} : {})});
    async function bytes(stream, size, chunk = 'x'.repeat(65536)) {
      for (let sent = 0; sent < size; sent += Buffer.byteLength(chunk)) {
        if (!stream.write(chunk)) await new Promise(resolve => stream.once('drain', resolve));
      }
    }
    async function flood(kind) {
      if (kind === 'mixed') {
        await bytes(process.stderr, 20 * 1024 * 1024);
        await bytes(process.stdout, 20 * 1024 * 1024);
      } else if (kind === 'console') {
        await bytes(process.stdout, 40 * 1024 * 1024,
          JSON.stringify({type:'console-log',level:'info',message:'x'.repeat(8192)}) + '\n');
      } else if (kind === 'markers') {
        for (let i = 0; i < 40; i++) {
          complete(); // Unsolicited markers must not replenish an idle budget.
          await bytes(process.stderr, 1024 * 1024);
        }
      } else await bytes(kind === 'stderr' ? process.stderr : process.stdout, 40 * 1024 * 1024);
    }
    if (mode === 'startup-stdout') flood('stdout');
    let buffer = Buffer.alloc(0);
    let chain = Promise.resolve();
    async function handle(code) {
      const match = /request\(("(?:[^"\\]|\\.)*")\)/.exec(code);
      const request = JSON.parse(JSON.parse(match[1]));
      if (mode === 'startup-stdout') return;
      if (request.start) {
        if (mode === 'early-and-late-diagnostic' || mode === 'different-late-diagnostic' || mode === 'early-diagnostic-only') emit({type:'console-log',level:'warn',message:'[NATIVE_MODULE_FALLBACK] LateDemo: cleanup fixture'});
        if (mode === 'idle-coalesced') {
          process.stdout.write(JSON.stringify({type:'rn-a11y-tree-response',id:null,ok:true,ready:true,hostInfo:{protocolVersion:1}}) + '\n' +
            JSON.stringify({type:'repl-eval-complete',id:evalId++}) + '\n' +
            JSON.stringify({type:'console-log',level:'info',message:'x'.repeat(1024 * 1024)}) + '\n');
          setImmediate(() => bytes(process.stderr, 32 * 1024 * 1024));
          return;
        }
        response(request); complete();
        if (mode === 'idle-markers') setImmediate(() => flood('markers'));
        if (mode === 'idle-exit') setTimeout(() => process.exit(0), 30);
        return;
      }
      if (!request.quit && mode.startsWith('frame-')) {await flood(mode.slice(6)); return;}
      if (!request.quit && mode === 'response-hang') {response(request); return;}
      if (!request.quit && mode === 'timeout-stderr') return;
      if (!request.quit && mode === 'cancel-active') {fs.writeFileSync(process.env.TEST_SESSION_ACTIVE, 'active'); return;}
      if (!request.quit && mode === 'multi-frame') await bytes(process.stderr, 20 * 1024 * 1024);
      if (!request.quit && mode === 'unique-diagnostics') {
        for (let i = 0; i < 2300; i++) {
          const message = '[NATIVE_MODULE_FALLBACK] Demo' + diagnosticId++ + ': ' + 'x'.repeat(8192);
          if (!emit({type:'console-log',level:'warn',message})) await new Promise(resolve => process.stdout.once('drain', resolve));
        }
      }
      if (!request.quit && mode === 'diagnostics') {
        for (let i = 0; i < 20; i++) emit({type:'console-log',level:'warn',message:'[NATIVE_MODULE_FALLBACK] Demo: fixture only'});
      }
      if (!request.quit && mode === 'stderr-log') {
        process.stderr.write('EARLY_SANITIZER_MARKER\n');
        await bytes(process.stderr, 256 * 1024);
        process.stderr.write('\nTAIL_SENTINEL\n');
      }
      if (!request.quit && mode === 'stderr-crash') {
        await bytes(process.stderr, 256 * 1024);
        process.stderr.write('\nTAIL_SENTINEL\n', () => process.exit(2));
        return;
      }
      if (request.quit && (mode === 'inherited' || mode === 'escaped')) {
        const worker = require('node:child_process').spawn(process.execPath, ['-e',
          "require('node:fs').appendFileSync(process.env.TEST_SESSION_PIDS, process.pid + '\\n'); process.on('SIGTERM',()=>{}); setInterval(()=>{},1000); process.send('ready')"], {stdio:['ignore','inherit','inherit','ipc'], detached:mode === 'escaped'});
        await new Promise(resolve => worker.once('message', resolve));
      }
      if (request.quit && mode === 'final-line') {
        response(request);
        const text = Buffer.from(JSON.stringify({type:'console-log',level:'info',message:'café🧪'}) + '\n');
        const split = text.indexOf(Buffer.from('🧪')) + 1;
        process.stdout.write(text.subarray(0,split));
        await new Promise(resolve => setImmediate(resolve));
        process.stdout.write(text.subarray(split));
        process.stdout.write(JSON.stringify({type:'repl-eval-complete',id:evalId++}), () => process.exit(0));
        return;
      }
      if (!request.quit && mode === 'coalesced') {
        // Give the idle epoch bytes in the same chunk as a valid completion.
        process.stdout.write(JSON.stringify({type:'rn-a11y-tree-response',id:request.id,ok:true}) + '\n' +
          JSON.stringify({type:'repl-eval-complete',id:evalId++}) + '\n' +
          JSON.stringify({type:'console-log',level:'info',message:'after completion café🧪'}) + '\n');
        return;
      }
      response(request); complete();
      if (request.quit && (mode === 'inherited' || mode === 'escaped')) process.exit(0);
    }
    process.stdin.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const newline = buffer.indexOf(10);
        if (newline < 0) return;
        const size = Number(buffer.subarray(0, newline).toString());
        if (buffer.length < newline + 1 + size) return;
        const code = buffer.subarray(newline + 1, newline + 1 + size).toString('utf8');
        buffer = buffer.subarray(newline + 1 + size);
        chain = chain.then(() => handle(code));
      }
    });
    process.stdin.on('end', () => {
      if (mode === 'quit-hang' || mode === 'forced') setInterval(()=>{},1000);
      else chain.then(async () => {
        if (mode === 'delayed-exit') {
          await new Promise(resolve => setTimeout(resolve, 500));
          emit({type:'console-log',level:'info',message:'delayed cleanup completed'});
        }
        if (mode === 'late-diagnostic' || mode === 'early-and-late-diagnostic') emit({type:'console-log',level:'warn',message:'[NATIVE_MODULE_FALLBACK] LateDemo: cleanup fixture'});
        if (mode === 'different-late-diagnostic') emit({type:'console-log',level:'warn',message:'[NATIVE_API_UNSUPPORTED] DifferentLate: cleanup unsupported'});
        if (mode === 'late-log') emit({type:'console-log',level:'info',message:'late cleanup log'});
        process.stdout.write('', () => process.exit(mode === 'quit-exit-seven' ? 7 : 0));
      });
    });
  `);
});
afterEach(() => {vi.unstubAllEnvs(); vi.restoreAllMocks();});
afterAll(() => fs.rmSync(directory, {recursive: true, force: true}));

function hasExited(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      return ['Z', 'X'].includes(stat.slice(stat.lastIndexOf(')') + 2, stat.lastIndexOf(')') + 3));
    }
    return false;
  } catch (error) {
    if (['ESRCH', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')) return true;
    throw error;
  }
}

async function run(mode: string, {keepOpen = false, count = 1, logFile = '', eof = false, strict = false} = {}) {
  const pidFile = path.join(directory, `${mode}-pids`);
  fs.writeFileSync(pidFile, '');
  vi.stubEnv('RN_A11Y_HOST_BIN', fixture);
  vi.stubEnv('RN_A11Y_HOST_RUNNER', process.execPath);
  vi.stubEnv('RN_A11Y_HOST_STDERR_LOG', logFile);
  vi.stubEnv('TEST_SESSION_PIDS', pidFile);
  const input = new PassThrough();
  const lines: any[] = [];
  const logs: string[] = [];
  const pids = () => fs.readFileSync(pidFile, 'utf8').trim().split('\n').filter(Boolean).map(Number);
  let watchdogFired = false;
  const kill = () => {
    for (const pid of pids()) {try {process.kill(pid, 'SIGKILL');} catch {}}
    input.end();
  };
  const watchdog = setTimeout(() => {watchdogFired = true; kill();}, 5000);
  const output = new Writable({write(chunk, _encoding, done) {
    const value = JSON.parse(chunk.toString());
    // Keep assertions small even for a baseline which retains the entire flood.
    lines.push({...value, logs: value.logs?.map((entry: {message: string}) => entry.message.slice(0, 100))});
    if (value.ready && !keepOpen) queueMicrotask(() => {
      for (let id = 1; id <= count; id++) input.write(JSON.stringify({id, tree: true}) + '\n');
      input.end(eof ? '' : JSON.stringify({id: count + 1, quit: true}) + '\n');
    });
    done();
  }});
  try {
    const code = await runSession({bundlePath: mode, windowWidth: 300, windowHeight: 600,
      timeoutMs: 1500, quiet: true, failOnFallback: strict, io: {input, output, log: line => logs.push(line)}});
    const childPids = pids();
    // Observe termination before defensive cleanup, otherwise a leaked worker
    // killed by the harness would incorrectly satisfy the lifecycle assertion.
    const end = Date.now() + 1000;
    while (mode !== 'escaped' && childPids.some(pid => !hasExited(pid)) && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 25));
    const reapedBeforeCleanup = childPids.every(hasExited);
    return {code, lines, logs, watchdogFired, pids: childPids, reapedBeforeCleanup, inputDataListeners: input.listenerCount('data')};
  } finally {
    clearTimeout(watchdog);
    kill();
    input.destroy(); output.destroy();
  }
}

it.each(['startup-stdout', 'frame-stderr', 'frame-console', 'frame-mixed'])('bounds %s output before parsing and preserves a machine-readable failure', TEST_OPTIONS, async mode => {
  const result = await run(mode);
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(5);
  const failure = result.lines.find(line => line.error);
  expect(result.lines.filter(line => line.error)).toHaveLength(1);
  expect(failure.error).toMatchObject({code: 'HOST_CRASHED', details: {outputLimit: true}});
  if (mode === 'startup-stdout') expect(failure.ready).toBe(false);
  else expect(failure.id).toBe(1);
  expect(result.reapedBeforeCleanup).toBe(true);
});

it('ends idle output overflow with client input still open despite unsolicited completion markers', TEST_OPTIONS, async () => {
  const result = await run('idle-markers', {keepOpen: true});
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(5);
  expect(result.lines.at(-1)).toMatchObject({id: null, ok: false, error: {code: 'HOST_CRASHED', details: {outputLimit: true}}});
});

it.each([false, true])('allows legitimate 500ms cleanup within the configured 1500ms shutdown budget, EOF=%s', TEST_OPTIONS, async eof => {
  const result = await run('delayed-exit', {eof});
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(0);
  expect(result.lines.some(line => line.error)).toBe(false);
  expect(result.lines.at(-1)).toMatchObject({id: null, ok: true, logs: ['delayed cleanup completed']});
  expect(result.reapedBeforeCleanup).toBe(true);
});

it.each(['quit-hang', 'forced'])('bounds %s shutdown after a completed quit response', TEST_OPTIONS, async mode => {
  const result = await run(mode);
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(5);
  expect(result.lines.at(-1)).toMatchObject({id: null, ok: false,
    error: {code: 'HOST_CRASHED', message: 'Host did not exit within 1500 ms after session shutdown'}});
  expect(result.reapedBeforeCleanup).toBe(true);
});

it.skipIf(process.platform === 'win32')('reaps a runner group whose worker retains inherited pipes', TEST_OPTIONS, async () => {
  const result = await run('inherited');
  expect(result.watchdogFired).toBe(false);
  expect(result.pids).toHaveLength(2);
  expect(result.reapedBeforeCleanup).toBe(true);
});

it('allows aggregate session output above the limit when each request is below it', TEST_OPTIONS, async () => {
  const result = await run('multi-frame', {count: 3});
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(0);
  expect(result.lines).toHaveLength(5);
});

it('keeps cumulative diagnostics deduplicated while retaining per-request logs', TEST_OPTIONS, async () => {
  const result = await run('diagnostics', {count: 3});
  expect(result.code).toBe(0);
  for (const line of result.lines.slice(1, 4)) {
    expect(line.diagnostics).toHaveLength(1);
    expect(line.logs).toHaveLength(20);
  }
  expect(result.lines.at(-1).diagnostics).toHaveLength(1);
});

it('streams early stderr diagnostics with one header for the entire session', TEST_OPTIONS, async () => {
  const logFile = path.join(directory, 'stderr.log');
  const result = await run('stderr-log', {logFile});
  expect(result.code).toBe(0);
  const log = fs.readFileSync(logFile, 'utf8');
  expect(log).toContain('EARLY_SANITIZER_MARKER');
  expect(log).toContain('TAIL_SENTINEL');
  expect(log.match(/^--- /gm)).toHaveLength(1);
});

it.each([false, true])('preserves diagnostics arriving after quit completes, strict=%s', TEST_OPTIONS, async strict => {
  const result = await run('late-diagnostic', {strict});
  expect(result.code).toBe(strict ? 6 : 0);
  expect(result.lines.at(-1)).toMatchObject({id: null, ok: !strict,
    diagnostics: [expect.objectContaining({target: 'LateDemo'})],
    logs: ['[NATIVE_MODULE_FALLBACK] LateDemo: cleanup fixture']});
  if (strict) expect(result.lines.at(-1).error.code).toBe('UNSUPPORTED_NATIVE');
});

it('preserves ordinary logs arriving after clean quit', TEST_OPTIONS, async () => {
  const result = await run('late-log');
  expect(result.code).toBe(0);
  expect(result.lines.at(-1)).toMatchObject({id: null, ok: true, logs: ['late cleanup log']});
});

it('keeps late rejected evidence explicitly failed when cleanup repeats its diagnostic', TEST_OPTIONS, async () => {
  const result = await run('early-and-late-diagnostic', {strict: true});
  expect(result.code).toBe(6);
  expect(result.lines).toHaveLength(2);
  expect(result.lines[0]).toMatchObject({ready: false, error: {code: 'UNSUPPORTED_NATIVE'}});
  expect(result.lines.at(-1)).toMatchObject({ready: false, error: {code: 'UNSUPPORTED_NATIVE'}});
  expect(result.lines.at(-1).logs).toEqual(['[NATIVE_MODULE_FALLBACK] LateDemo: cleanup fixture']);
});

it('reports a different late unsupported target after an early strict failure without a success-looking record', TEST_OPTIONS, async () => {
  const result = await run('different-late-diagnostic', {strict: true});
  expect(result.code).toBe(6);
  expect(result.lines).toHaveLength(2);
  expect(result.lines.at(-1)).toMatchObject({ready: false, error: {code: 'UNSUPPORTED_NATIVE'}});
  expect(result.lines.at(-1).ok).not.toBe(true);
  expect(result.lines.at(-1).diagnostics).toContainEqual(expect.objectContaining({code: 'NATIVE_API_UNSUPPORTED', target: 'DifferentLate'}));
  expect(result.lines.at(-1).logs).toEqual(['[NATIVE_API_UNSUPPORTED] DifferentLate: cleanup unsupported']);
});

it('omits a duplicate policy follow-up when shutdown produces no new evidence', TEST_OPTIONS, async () => {
  const result = await run('early-diagnostic-only', {strict: true});
  expect(result.code).toBe(6);
  expect(result.lines).toHaveLength(1);
  expect(result.lines[0]).toMatchObject({ready: false, error: {code: 'UNSUPPORTED_NATIVE'}});
});

it('reports a nonzero exit after completed quit as a structured terminal failure', TEST_OPTIONS, async () => {
  const result = await run('quit-exit-seven');
  expect(result.code).toBe(5);
  expect(result.lines.at(-1)).toMatchObject({id: null, ok: false, error: {code: 'HOST_CRASHED'}});
});

it('ends unexpected idle host exit without waiting for client EOF', TEST_OPTIONS, async () => {
  const result = await run('idle-exit', {keepOpen: true});
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(5);
  expect(result.lines.at(-1)).toMatchObject({id: null, error: {code: 'HOST_CRASHED'}});
});

it('bounds EOF shutdown as well as explicit quit', TEST_OPTIONS, async () => {
  const result = await run('quit-hang', {eof: true});
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(5);
  expect(result.lines.at(-1)).toMatchObject({id: null, ok: false,
    error: {code: 'HOST_CRASHED', message: 'Host did not exit within 1500 ms after session shutdown'}});
  expect(result.reapedBeforeCleanup).toBe(true);
});

it('preserves UTF-8 and the final completion without a newline', TEST_OPTIONS, async () => {
  const result = await run('final-line');
  expect(result.code).toBe(0);
  expect(result.lines.at(-1)).toMatchObject({ok: true, logs: ['café🧪']});
});

it('preserves idle console bytes coalesced with frame completion', TEST_OPTIONS, async () => {
  const result = await run('coalesced', {count: 3});
  expect(result.code).toBe(0);
  expect(result.lines.flatMap(line => line.logs ?? [])).toEqual(Array(3).fill('after completion café🧪'));
});

it('counts coalesced startup completion and idle output with client stdin still open', TEST_OPTIONS, async () => {
  const result = await run('idle-coalesced', {keepOpen: true});
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(5);
  expect(result.lines[0].ready).toBe(true);
  expect(result.lines.at(-1)).toMatchObject({id: null, error: {code: 'HOST_CRASHED', details: {outputLimit: true}}});
});

it('does not accept a response without the frame completion before its deadline', TEST_OPTIONS, async () => {
  const result = await run('response-hang');
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(5);
  expect(result.lines.at(-1)).toMatchObject({id: 1, error: {code: 'TIMEOUT'}});
  expect(result.reapedBeforeCleanup).toBe(true);
});

it('bounds retained unique diagnostics across otherwise valid frames', TEST_OPTIONS, async () => {
  const result = await run('unique-diagnostics', {count: 3});
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(5);
  expect(result.lines.at(-1).error).toMatchObject({code: 'HOST_CRASHED', details: {outputLimit: true}});
  expect(result.lines.at(-1).error.message).toContain('retained diagnostic');
});

it('retains only a bounded stderr tail in a crash response', TEST_OPTIONS, async () => {
  const result = await run('stderr-crash');
  expect(result.code).toBe(5);
  const tail = result.lines.at(-1).error.details.stderrTail;
  expect(Buffer.byteLength(tail)).toBeLessThanOrEqual(65536);
  expect(tail).toContain('TAIL_SENTINEL');
});

it.skipIf(process.platform === 'win32')('streams stderr emitted during timeout cleanup while the byte budget permits it', TEST_OPTIONS, async () => {
  const logFile = path.join(directory, 'cleanup-stderr.log');
  const result = await run('timeout-stderr', {logFile});
  expect(result.code).toBe(5);
  expect(fs.readFileSync(logFile, 'utf8')).toContain('FINAL_SANITIZER_MARKER');
});

it.skipIf(process.platform === 'win32')('bounds escaped inherited pipes and reports the cleanup cutoff', TEST_OPTIONS, async () => {
  const result = await run('escaped');
  expect(result.watchdogFired).toBe(false);
  expect(result.code).toBe(5);
  expect(result.lines.at(-1).error).toMatchObject({code: 'HOST_CRASHED', details: {cleanupTimedOut: true}});
});

it('cleans request/shutdown timers and releases client input listeners', TEST_OPTIONS, async () => {
  const signals = {int: process.listenerCount('SIGINT'), term: process.listenerCount('SIGTERM')};
  const timers = vi.spyOn(globalThis, 'setTimeout');
  const cleared = vi.spyOn(globalThis, 'clearTimeout');
  const result = await run('normal');
  expect(result.code).toBe(0);
  expect(result.inputDataListeners).toBe(0);
  expect(process.listenerCount('SIGINT')).toBe(signals.int);
  expect(process.listenerCount('SIGTERM')).toBe(signals.term);
  for (let index = 0; index < timers.mock.calls.length; index++) {
    if ([1500, 250, 1250].includes(Number(timers.mock.calls[index][1]))) {
      expect(cleared).toHaveBeenCalledWith(timers.mock.results[index].value);
    }
  }
});

it.skipIf(process.platform === 'win32').each([
  ['SIGTERM', 'cancel-idle'], ['SIGINT', 'cancel-active'],
] as const)('cancels repeated %s during %s without orphaning the host', TEST_OPTIONS, async (signal, mode) => {
  const driver = path.join(directory, `${mode}.mjs`);
  const moduleURL = pathToFileURL(path.resolve(import.meta.dirname, '../packages/react-native-a11y-tree/src/session.ts')).href;
  fs.writeFileSync(driver, `import {runSession} from ${JSON.stringify(moduleURL)}; process.exitCode = await runSession({bundlePath:${JSON.stringify(mode)},windowWidth:300,windowHeight:600,quiet:true,io:{input:process.stdin,output:process.stdout,log:()=>{}}});`);
  const pidFile = path.join(directory, `${mode}-pids`);
  const active = path.join(directory, `${mode}-active`);
  fs.writeFileSync(pidFile, '');
  const child = spawn(process.execPath, [driver], {env: {...process.env,
    RN_A11Y_HOST_BIN: fixture, RN_A11Y_HOST_RUNNER: process.execPath,
    RN_A11Y_HOST_STDERR_LOG: '', TEST_SESSION_PIDS: pidFile, TEST_SESSION_ACTIVE: active},
    stdio: ['pipe', 'pipe', 'pipe']});
  let stdout = '', stderr = '';
  child.stdout.on('data', data => {stdout += data;});
  child.stderr.on('data', data => {stderr += data;});
  const closed = new Promise<number | null>((resolve, reject) => {child.once('close', resolve); child.once('error', reject);});
  const watchdog = setTimeout(() => child.kill('SIGKILL'), 6000);
  try {
    await vi.waitFor(() => expect(stdout, stderr).toContain('"ready":true'), {timeout: 3000});
    if (mode === 'cancel-active') {
      child.stdin.write('{"id":1,"tree":true}\n');
      await vi.waitFor(() => expect(fs.existsSync(active)).toBe(true), {timeout: 1500});
    }
    child.kill(signal);
    await new Promise(resolve => setTimeout(resolve, 75));
    child.kill(signal);
    expect(await closed, stdout + stderr).toBe(5);
    const responses = stdout.trim().split('\n').map(line => JSON.parse(line));
    expect(responses.at(-1)).toMatchObject({id: mode === 'cancel-active' ? 1 : null, ok: false,
      error: {code: 'HOST_CRASHED', details: {cancelled: true}}});
    const pid = Number(fs.readFileSync(pidFile, 'utf8').trim());
    await vi.waitFor(() => expect(hasExited(pid)).toBe(true), {timeout: 1500});
  } finally {
    clearTimeout(watchdog);
    child.kill('SIGKILL');
    for (const pid of fs.readFileSync(pidFile, 'utf8').trim().split('\n').filter(Boolean).map(Number)) {
      try {process.kill(pid, 'SIGKILL');} catch {}
    }
    child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy();
    await closed;
  }
});
