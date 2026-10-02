import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PassThrough, Readable, Writable} from 'node:stream';
import {afterAll, afterEach, beforeAll, expect, it, vi} from 'vitest';
import {runSession} from '../packages/react-native-a11y-tree/src/session.ts';

let directory: string;
let fixture: string;
beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'session-io-'));
  fixture = path.join(directory, 'host.cjs');
  fs.writeFileSync(fixture, String.raw`
    const fs = require('node:fs');
    fs.writeFileSync(process.env.TEST_IO_PID, String(process.pid));
    let buffer = Buffer.alloc(0), evalId = 0;
    process.stdin.on('end', () => {
      if (process.env.TEST_IO_LATE === '1') process.stdout.write(JSON.stringify({type:'console-log',level:'info',message:'late log'}) + '\n');
    });
    process.stdin.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const newline = buffer.indexOf(10);
        if (newline < 0) return;
        const size = Number(buffer.subarray(0, newline).toString());
        if (buffer.length < newline + 1 + size) return;
        const code = buffer.subarray(newline + 1, newline + 1 + size).toString();
        buffer = buffer.subarray(newline + 1 + size);
        const match = /request\(("(?:[^"\\]|\\.)*")\)/.exec(code);
        const request = JSON.parse(JSON.parse(match[1]));
        fs.appendFileSync(process.env.TEST_IO_REQUESTS, JSON.stringify(request.id) + '\n');
        if (request.quit && process.env.TEST_IO_QUIT_LOG === 'log') process.stdout.write(JSON.stringify({type:'console-log',level:'info',message:'QUIT_CLEANUP_LOG'}) + '\n');
        if ((request.quit && process.env.TEST_IO_QUIT_LOG === 'diagnostic') || (request.start && process.env.TEST_IO_QUIT_LOG === 'previous')) process.stdout.write(JSON.stringify({type:'console-log',level:'warn',message:'[NATIVE_API_UNSUPPORTED] Cleanup: fixture diagnostic'}) + '\n');
        process.stdout.write(JSON.stringify({type:'rn-a11y-tree-response',id:request.id,ok:true,
          ...(request.start ? {ready:true,hostInfo:{protocolVersion:1}} : {})}) + '\n');
        process.stdout.write(JSON.stringify({type:'repl-eval-complete',id:evalId++}) + '\n');
        if (request.start && process.env.TEST_IO_CRASH_READY === '1') setTimeout(() => process.exit(7), 30);
      }
    });
  `);
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => fs.rmSync(directory, {recursive:true, force:true}));
const TEST = {timeout:10_000};
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function run(input: Readable, write?: (record: any, done: (error?: Error | null) => void, output: Writable) => void, late = false, crashReady = false, delayedDestroy = false, quitLog = '', {watchdogMs = 4500} = {}) {
  const pidFile = path.join(directory, 'pid');
  const requestsFile = path.join(directory, 'requests');
  fs.rmSync(pidFile, {force:true});
  fs.writeFileSync(requestsFile, '');
  vi.stubEnv('RN_A11Y_HOST_BIN', fixture);
  vi.stubEnv('RN_A11Y_HOST_RUNNER', process.execPath);
  vi.stubEnv('TEST_IO_PID', pidFile);
  vi.stubEnv('TEST_IO_REQUESTS', requestsFile);
  vi.stubEnv('TEST_IO_LATE', late ? '1' : '0');
  vi.stubEnv('TEST_IO_CRASH_READY', crashReady ? '1' : '0');
  vi.stubEnv('TEST_IO_QUIT_LOG', quitLog);
  const records: any[] = [];
  const logs: string[] = [];
  const output = new Writable({highWaterMark:1,
    ...(delayedDestroy ? {destroy(error: Error | null, done: (error?: Error | null) => void) {setTimeout(() => done(error ?? new Error('async EPIPE')), 50);}} : {}),
    write(chunk, _encoding, done) {
    const record = JSON.parse(chunk.toString());
    records.push(record);
    if (write) write(record, done, output); else done();
  }});
  let watchdog = false;
  const started = performance.now();
  const timer = setTimeout(() => {watchdog = true; input.destroy(); output.destroy();}, watchdogMs);
  try {
    const code = await runSession({bundlePath:'unused', windowWidth:300, windowHeight:600, timeoutMs:1500,
      quiet:true, io:{input, output, log:line => logs.push(line)}});
    const pid = Number(fs.readFileSync(pidFile, 'utf8'));
    let alive = true;
    try {process.kill(pid, 0);} catch {alive = false;}
    return {code, records, logs, watchdog, alive, elapsedMs:performance.now()-started, requests:fs.readFileSync(requestsFile, 'utf8'),
      listeners:{data:input.listenerCount('data'), error:input.listenerCount('error'), outputError:output.listenerCount('error'), drain:output.listenerCount('drain')}};
  } finally {
    clearTimeout(timer);
    if (fs.existsSync(pidFile)) {try {process.kill(Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL');} catch {}}
    input.destroy(); output.destroy();
  }
}

function failureContext(result: Awaited<ReturnType<typeof run>>) {
  return JSON.stringify({code:result.code,watchdog:result.watchdog,elapsedMs:result.elapsedMs,
    requestCount:result.requests.trim().split('\n').filter(Boolean).length,responseCount:result.records.length,
    errors:result.records.filter(record=>record.error),finalRecord:result.records.at(-1),logs:result.logs},null,2);
}

it('rejects an oversized unterminated client line before JSON parsing and reaps the host', TEST, async () => {
  let chunks = 0;
  const input = new Readable({read() {this.push(chunks++ < 33 ? Buffer.alloc(1024 * 1024, 120) : null);}});
  const result = await run(input);
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.code, failureContext(result)).toBe(1);
  expect(result.records.at(-1)).toMatchObject({id:null, ok:false, error:{code:'USAGE', details:{inputLimit:true}}});
  expect(result.alive).toBe(false);
});

it('backpressures pipelined input while a response is stalled, then preserves every request ID', {timeout:30_000}, async () => {
  let produced = 0;
  let producedWhileStalled = 0;
  const input = new Readable({highWaterMark:128, read() {
    if (produced === 2000) {this.push(null); return;}
    this.push(JSON.stringify({id:produced++, tree:true}) + '\n');
  }});
  const result = await run(input, (record, done) => {
    if (record.id === 0) setTimeout(() => {producedWhileStalled = produced; done();}, 100);
    else done();
  }, false, false, false, '', {watchdogMs:20_000}); // 2000 valid frames have no collective 4.5s deadline.
  expect(producedWhileStalled).toBeLessThan(30);
  expect(result.code, failureContext(result)).toBe(0);
  expect(result.records.slice(1).map(r => r.id)).toEqual(Array.from({length:2000}, (_, i) => i));
  expect(result.watchdog, failureContext(result)).toBe(false);
});

it('bounds a stalled ready consumer and cleans up without client EOF', TEST, async () => {
  const result = await run(new PassThrough(), () => {});
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.code, failureContext(result)).toBe(5);
  expect(result.alive).toBe(false);
  expect(result.logs.join('\n')).toMatch(/output.*timed out/i);
  expect(result.listeners).toEqual({data:0,error:0,outputError:0,drain:0});
});

it.each(['error','close'] as const)('cleans up when the output consumer emits %s', TEST, async mode => {
  const result = await run(new PassThrough(), (_record, _done, output) => {
    queueMicrotask(() => output.destroy(mode === 'error' ? new Error('consumer gone') : undefined));
  });
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.code, failureContext(result)).toBe(5);
  expect(result.alive).toBe(false);
});

it('preserves split UTF-8, CRLF, blank lines, malformed records, and final newline-less input', TEST, async () => {
  const bytes = Buffer.from('\n{"id":"café🧪","tree":true}\r\ninvalid\n{"id":"last","tree":true}');
  const input = Readable.from(Array.from(bytes, byte => Buffer.from([byte])));
  const result = await run(input);
  expect(result.code, failureContext(result)).toBe(0);
  expect(result.records.slice(1)).toEqual([
    {id:'café🧪',ok:true}, expect.objectContaining({id:null,ok:false,error:expect.objectContaining({code:'USAGE'})}),
    {id:'last',ok:true},
  ]);
});

it('does not impose a client idle deadline', TEST, async () => {
  const input = new PassThrough();
  const result = await run(input, (record, done) => {
    done();
    if (record.ready) void delay(1700).then(() => input.end('{"id":"after idle","quit":true}\n'));
  });
  expect(result.code, failureContext(result)).toBe(0);
  expect(result.records.at(-1)).toMatchObject({id:'after idle',ok:true});
  expect(result.watchdog, failureContext(result)).toBe(false);
});


it('reports failure when the final late-output write fails after the host has exited', TEST, async () => {
  const result = await run(Readable.from(['{"id":1,"quit":true}\n']), (record, done) => {
    done(record.logs ? new Error('late consumer failure') : undefined);
  }, true);
  expect(result.code, failureContext(result)).toBe(5);
  expect(result.logs.join('\n')).toContain('late consumer failure');
  expect(result.alive).toBe(false);
  expect(result.watchdog, failureContext(result)).toBe(false);
});

it('handles client input errors without leaking listeners or the host', TEST, async () => {
  const input = new PassThrough();
  const result = await run(input, (record, done) => {
    done();
    if (record.ready) queueMicrotask(() => input.destroy(new Error('client disconnected')));
  });
  expect(result.code, failureContext(result)).toBe(5);
  expect(result.records.at(-1)).toMatchObject({id:null,ok:false,error:{code:'HOST_CRASHED',details:{clientInput:true}}});
  expect(result.alive).toBe(false);
  expect(result.listeners).toEqual({data:0,error:0,outputError:0,drain:0});
});

it('accepts an already-ended input as EOF instead of waiting forever', TEST, async () => {
  const input = new PassThrough();
  input.resume();
  await new Promise<void>(resolve => {input.once('end', resolve); input.end();});
  const result = await run(input);
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.code, failureContext(result)).toBe(0);
  expect(result.alive).toBe(false);
});


it.each(['signal','host exit'] as const)('interrupts a blocked response write promptly on %s', TEST, async mode => {
  let blockedAt = 0;
  const before = process.listenerCount('SIGINT');
  const result = await run(new PassThrough(), () => {
    blockedAt = performance.now();
    if (mode === 'signal') queueMicrotask(() => {process.emit('SIGINT'); process.emit('SIGINT');});
  }, false, mode === 'host exit');
  expect(performance.now() - blockedAt).toBeLessThan(1000);
  expect(result.code, failureContext(result)).toBe(5);
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.alive).toBe(false);
  expect(process.listenerCount('SIGINT')).toBe(before);
});

it('handles asynchronous destroy errors after a failed write callback', TEST, async () => {
  const result = await run(Readable.from(['{"id":1,"quit":true}\n']), (record, done) => {
    done(record.logs ? new Error('async callback failure') : undefined);
  }, true, false, true);
  expect(result.code, failureContext(result)).toBe(5);
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.listeners.outputError).toBe(0);
});

it('does not dispatch queued requests while a request response consumer stays blocked', TEST, async () => {
  const input = Readable.from(Array.from({length:100}, (_, id) => JSON.stringify({id,tree:true}) + '\n'));
  const result = await run(input, (record, done) => {if (record.ready) done();});
  expect(result.code, failureContext(result)).toBe(5);
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.requests.trim().split('\n')).toEqual(['null','0']);
  expect(result.alive).toBe(false);
});

it('handles an asynchronous output error after a successful write callback while idle', TEST, async () => {
  const result = await run(new PassThrough(), (_record, done, output) => {
    done();
    setImmediate(() => output.destroy(new Error('later EPIPE')));
  });
  expect(result.code, failureContext(result)).toBe(5);
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.alive).toBe(false);
  expect(result.listeners.outputError).toBe(0);
});

it('rejects a single oversized pipeline chunk explicitly instead of silently losing requests', TEST, async () => {
  const input = Readable.from([Buffer.alloc(33 * 1024 * 1024, '{}\n')]);
  const result = await run(input);
  expect(result.code, failureContext(result)).toBe(1);
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.records.at(-1)).toMatchObject({id:null,ok:false,error:{code:'USAGE',details:{inputLimit:true}}});
  expect(result.requests.trim()).toBe('null');
  expect(result.alive).toBe(false);
});


it.each(['log','diagnostic'] as const)('preserves implicit EOF quit cleanup %s evidence', TEST, async kind => {
  const result = await run(Readable.from([]), undefined, false, false, false, kind);
  expect(result.code, failureContext(result)).toBe(0);
  expect(result.records).toHaveLength(2);
  expect(result.records.at(-1)).toMatchObject({id:null,ok:true,logs:[expect.objectContaining({
    message:kind === 'log' ? 'QUIT_CLEANUP_LOG' : '[NATIVE_API_UNSUPPORTED] Cleanup: fixture diagnostic',
  })]});
  if (kind === 'diagnostic') expect(result.records.at(-1).diagnostics).toContainEqual(expect.objectContaining({target:'Cleanup'}));
});

it.each(['','previous'])('keeps EOF silent without new evidence, prior diagnostics=%s', TEST, async kind => {
  const result = await run(Readable.from([]), undefined, false, false, false, kind);
  expect(result.code, failureContext(result)).toBe(0);
  expect(result.records).toHaveLength(1);
  expect(result.records[0].ready).toBe(true);
});

it.each([
  ['SIGINT', 'late evidence'], ['SIGTERM', 'late evidence'],
  ['SIGINT', 'terminal error'], ['SIGTERM', 'terminal error'],
] as const)('cancels a blocked final %s write after host cleanup: %s', TEST, async (signal, kind) => {
  const before = process.listenerCount(signal);
  let blockedAt = 0;
  const input = kind === 'late evidence' ? Readable.from(['{"id":1,"quit":true}\n']) : new PassThrough();
  const result = await run(input, (record, done) => {
    if (kind === 'late evidence' ? record.logs : record.error) {
      blockedAt = performance.now();
      queueMicrotask(() => {process.emit(signal); process.emit(signal);});
    } else done();
  }, kind === 'late evidence', kind === 'terminal error');
  expect(blockedAt).toBeGreaterThan(0);
  expect(performance.now() - blockedAt).toBeLessThan(1000);
  expect(result.code, failureContext(result)).toBe(5);
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.alive).toBe(false);
  expect(result.logs.join('\n')).not.toMatch(/output timed out/);
  expect(result.listeners).toEqual({data:0,error:0,outputError:0,drain:0});
  expect(process.listenerCount(signal)).toBe(before);
});

it('allows healthy per-write progress across a session lasting more than 4500ms', {timeout:15_000}, async () => {
  const input = Readable.from(Array.from({length:10}, (_, id) => JSON.stringify({id,tree:true}) + '\n'));
  const result = await run(input, (record, done) => {
    if (record.ready) done();
    else setTimeout(done, 500); // Each write is well inside its 1500ms deadline.
  }, false, false, false, '', {watchdogMs:10_000});
  expect(result.watchdog, failureContext(result)).toBe(false);
  expect(result.code, failureContext(result)).toBe(0);
  expect(result.records.slice(1).map(record => record.id)).toEqual(Array.from({length:10}, (_, id) => id));
});
