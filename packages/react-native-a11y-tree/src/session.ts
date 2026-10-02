/**
 * `rn-a11y-tree session`: drives a host started in Fantom's `--interactive`
 * mode over JSON lines on our stdin/stdout.
 *
 * Host protocol (tester/src/TesterAppDelegate.cpp `runInteractiveLoop`):
 * - The host evaluates the bundle, then reads frames from stdin: a line with
 *   the byte length of the code, then exactly that many bytes of JS.
 * - After each frame it prints `{"type":"repl-eval-complete","id":n}` on
 *   stdout. A thrown JS error prints `{"type":"repl-error","message","stack"}`
 *   before that. Console output is `{"type":"console-log",...}`.
 * - Our snippet calls `globalThis.__rnA11y.request(json)` (runtime/session.ts),
 *   which prints one `{"type":"rn-a11y-tree-response",...}` line.
 * - The host exits (code 0) when stdin is closed.
 */

import {collectDiagnostics, fidelityError, type FidelityOptions, type Diagnostic} from './diagnostics.ts';

import type {ChildProcess} from 'node:child_process';
import readline from 'node:readline';
import fs from 'node:fs';
import {PassThrough} from 'node:stream';

import {terminateWindowsTree, type ProcessCleanupResult} from './processCleanup.ts';
import {checkHostInfo, getHostBin, type HostInfo, hostArgs, hostEnv, spawnHost} from './host.ts';
import type {HostRuntimeInfo, SessionTreeOptions, ShadowNodeJSON, Step} from './schema.ts';
import {validateScript} from './script.ts';
import {diffTrees} from './diff.ts';
import {CliError, type ErrorInfo, type ErrorCode, EXIT_CODES, type LogEntry, logEntry, nativeModuleHint, stepErrorCode} from './errors.ts';
import {type Format, FORMATS, formatRender, parseSelector} from './format.ts';
import type {TreeNode} from './schema.ts';
import {convertShadowTree, convertStep} from './tree.ts';

const RESPONSE_TYPE = 'rn-a11y-tree-response';
export const DEFAULT_TIMEOUT_MS = 30_000;

type HostResponse = {
  id: unknown;
  ok: boolean;
  error?: string;
  hostError?: ErrorInfo;
  ready?: boolean;
  quit?: boolean;
  step?: Step;
  tree?: ShadowNodeJSON;
  fallbacks?: string[];
  capabilities?: string[];
  timings?: Record<string, number | undefined>;
  diffTrees?: ShadowNodeJSON[];
  hostInfo?: HostRuntimeInfo | null;
};

type Frame = {
  evalId: number;
  response: HostResponse | null;
  replError: {message: string; stack?: string} | null;
  resolve: () => void;
};

export type SessionIO = {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  log: (line: string) => void;
};

/** Pull one chunk at a time: no readline queue grows while a request or write
 * is pending. The caller's readable must honor pause/backpressure; its own
 * producer-side buffering remains owned by the caller. */
function clientLines(input: NodeJS.ReadableStream, limit: number, fail: (error: ErrorInfo) => void) {
  let pending: Buffer | undefined;
  let ended = (input as NodeJS.ReadableStream & {readableEnded?: boolean}).readableEnded === true;
  let closed = false;
  let wake: (() => void) | undefined;
  let partial = Buffer.alloc(0);
  let bytes = 0;
  const close = () => {
    closed = true;
    input.removeListener('data', onData);
    input.removeListener('end', onEnd);
    input.removeListener('close', onClose);
    input.removeListener('error', onError);
    // Re-emit pause even if the per-chunk reader already paused it. Node's
    // stdin pause hook stops its underlying pipe read on the next tick.
    input.resume();
    input.pause();
    pending = undefined;
    partial = Buffer.alloc(0);
    wake?.();
  };
  const onError = (error: Error) => {
    fail({code: 'HOST_CRASHED', message: `Session client input failed: ${error.message}`, details: {clientInput: true}});
    close();
  };
  const onData = (data: Buffer | string) => {
    input.pause();
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (pending || chunk.length + bytes > limit) {
      fail({code: 'USAGE', message: `Session client input exceeded the ${limit}-byte buffer limit`, details: {inputLimit: true}});
      close();
      return;
    }
    pending = chunk;
    wake?.();
  };
  const onEnd = () => {ended = true; wake?.();};
  const onClose = () => {if (!ended) onError(new Error('input closed before EOF'));};
  input.pause();
  input.on('data', onData);
  input.on('end', onEnd);
  input.on('error', onError);
  input.on('close', onClose);
  if ((input as NodeJS.ReadableStream & {destroyed?: boolean}).destroyed && !ended) {
    queueMicrotask(() => {if (!closed) onClose();});
  }
  return {
    close,
    async *[Symbol.asyncIterator]() {
      try {
        while (!closed) {
          if (!pending && !ended) {
            await new Promise<void>(resolve => {wake = resolve; input.resume();});
            wake = undefined;
          }
          if (closed) return;
          const chunk = pending;
          pending = undefined;
          if (!chunk) {
            if (bytes) yield partial.subarray(0, bytes).toString('utf8');
            return;
          }
          let offset = 0;
          while (offset < chunk.length && !closed) {
            const newline = chunk.indexOf(10, offset);
            const end = newline < 0 ? chunk.length : newline;
            const part = chunk.subarray(offset, end);
            if (newline >= 0 && bytes === 0) {
              yield part.toString('utf8');
            } else {
              const size = bytes + part.length;
              if (size > partial.length) {
                const grown = Buffer.allocUnsafe(Math.min(limit, Math.max(size, partial.length * 2, 4096)));
                partial.copy(grown, 0, 0, bytes);
                partial = grown;
              }
              part.copy(partial, bytes);
              bytes = size;
              if (newline >= 0) {
                const line = partial.subarray(0, bytes).toString('utf8');
                bytes = 0;
                yield line;
              }
            }
            if (closed) {
              bytes = 0;
              return;
            }
            offset = end + 1;
          }
        }
      } finally {close();}
    },
  };
}

/** Starts the host and serves requests until `quit` or end of input. Returns the exit code. */
export async function runSession(options: FidelityOptions & {
  bundlePath: string;
  windowWidth: number;
  windowHeight: number;
  verbose?: boolean;
  /** Deadline per host frame and client-output write in ms; timeout cleans up
   * the host and exits 5. Waiting for an idle client has no deadline. */
  timeoutMs?: number;
  /** Print startup timings and per-request latency as JSON on stderr. */
  timing?: boolean;
  /** Do not echo app console output as [app] lines (it is in each response's `logs`). */
  quiet?: boolean;
  initialLogs?: LogEntry[];
  /** The host found by ensureHost() (reported in the ready line). */
  host?: HostInfo | null;
  /** Output options for the ready tree, and defaults for `tree` / `snapshot` responses (a request's own fields win). */
  treeDefaults?: SessionTreeOptions;
  /** Time zone of the host (`TZ`); default UTC. */
  tz?: string;
  io: SessionIO;
}): Promise<number> {
  const treeDefaults: Record<string, unknown> = {...options.treeDefaults};
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) {
    throw new CliError('USAGE', 'Session timeoutMs must be an integer from 1 through 2147483647.');
  }
  const LIMIT = 32 * 1024 * 1024;
  const {io} = options;
  let policyFailed = false;
  let diagnosticVersion = 0;
  let reportedDiagnosticVersion = 0;
  let terminalError: ErrorInfo | null = null;
  let terminalReported = false;
  let readySent = false;
  let shutdownRequested = false;
  let exited = false;
  let current: Frame | null = null;
  let nextEvalId = 0;
  let inputLines: ReturnType<typeof clientLines> | undefined;
  let cancelWrite: (() => void) | undefined;
  let windowsCleanup: Promise<ProcessCleanupResult> | undefined;
  let escalation: ReturnType<typeof setTimeout> | undefined;
  let cutoff: ReturnType<typeof setTimeout> | undefined;
  let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveExit!: (code: number) => void;
  const exitPromise = new Promise<number>(resolve => {resolveExit = resolve;});
  const bin = getHostBin();
  const spawnedAt = performance.now();
  const child: ChildProcess = spawnHost(bin, ['--interactive', ...hostArgs({
    bundlePath: options.bundlePath, windowWidth: options.windowWidth,
    windowHeight: options.windowHeight, verbose: options.verbose,
  })], {
    stdio: ['pipe', 'pipe', 'pipe'], env: hostEnv(options.tz),
    // POSIX runners share a process group; Windows uses taskkill before
    // terminating the root. Already-exited roots remain a Windows limitation.
    detached: process.platform !== 'win32',
  });

  let stderrTail = Buffer.alloc(0);
  let stderrLog: number | undefined;
  const closeLog = () => {
    if (stderrLog === undefined) return;
    try {fs.closeSync(stderrLog);} catch {}
    stderrLog = undefined;
  };
  if (process.env.RN_A11Y_HOST_STDERR_LOG) {
    try {
      stderrLog = fs.openSync(process.env.RN_A11Y_HOST_STDERR_LOG, 'a');
      fs.writeSync(stderrLog, `--- ${bin} (pid ${process.pid}) ---\n`);
    } catch {closeLog();}
  }
  const boundedStdout = new PassThrough();
  const hostLines = readline.createInterface({input: boundedStdout});
  const kill = (signal: NodeJS.Signals) => {
    try {
      if (process.platform !== 'win32' && child.pid != null) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {try {child.kill(signal);} catch {}}
  };
  const stop = (error: ErrorInfo) => {
    cancelWrite?.();
    if (terminalError || exited) return;
    terminalError = error;
    inputLines?.close(); // Wake an idle client-input wait without destroying it.
    if (process.platform === 'win32') windowsCleanup = terminateWindowsTree(child);
    else {
      kill('SIGTERM');
      escalation = setTimeout(() => kill('SIGKILL'), 250);
    }
    cutoff = setTimeout(() => {
      error.details = {...error.details, cleanupTimedOut: true};
      finalize(child.exitCode);
    }, 1250);
  };
  let outputLimited = false;
  const failOutput = (message: string) => {
    outputLimited = true;
    stop({code: 'HOST_CRASHED', message, details: {outputLimit: true}});
  };
  const overflow = (reason = 'combined stdout/stderr output') =>
    failOutput(`Host exceeded the ${LIMIT}-byte ${reason} limit`);

  // Per-frame bytes reset only on its expected completion. Idle output carries
  // into the next frame, so unsolicited markers cannot refresh the allowance.
  let outputBytes = 0;
  let lineBytes = 0;
  const accept = (size: number) => {
    if (outputLimited || exited) return false;
    outputBytes += size;
    if (outputBytes <= LIMIT) return true;
    overflow();
    return false;
  };
  let pendingLogs: LogEntry[] = [];
  let pendingLogBytes = 0;
  const diagnosticMap = new Map<string, Diagnostic>();
  let diagnosticBytes = 0;
  const retainDiagnostics = (items: Diagnostic[]) => {
    for (const item of items) {
      const key = `${item.code}:${item.target}`;
      const previous = diagnosticMap.get(key);
      const bytes = diagnosticBytes + Buffer.byteLength(JSON.stringify(item))
        - (previous ? Buffer.byteLength(JSON.stringify(previous)) : 0);
      // Also bound object overhead for many distinct, very short diagnostics.
      if (bytes > LIMIT) {overflow('retained diagnostic'); return;}
      if (!previous && diagnosticMap.size >= 65_536) {
        failOutput('Host exceeded the 65536 retained diagnostic count limit'); return;
      }
      diagnosticMap.set(key, item);
      if (!previous || previous.message !== item.message) diagnosticVersion++;
      diagnosticBytes = bytes;
    }
  };
  const retainLog = (entry: LogEntry) => {
    const bytes = Buffer.byteLength(JSON.stringify(entry));
    if (pendingLogBytes + bytes > LIMIT) {overflow('retained log'); return;}
    pendingLogs.push(entry);
    pendingLogBytes += bytes;
    retainDiagnostics(collectDiagnostics([entry]));
  };
  const takeLogs = () => {
    const logs = pendingLogs;
    pendingLogs = [];
    pendingLogBytes = 0;
    return logs;
  };
  const diagnosticsFor = (response: HostResponse) => {
    retainDiagnostics(collectDiagnostics([], response.fallbacks ?? []));
    return [...diagnosticMap.values()];
  };

  const onStderr = (chunk: Buffer) => {
    if (!accept(chunk.length)) return;
    const tail = chunk.subarray(-65536);
    stderrTail = Buffer.concat([stderrTail.subarray(-Math.max(0, 65536 - tail.length)), tail]).subarray(-65536);
    if (stderrLog !== undefined) {
      try {fs.writeSync(stderrLog, chunk);} catch {closeLog();}
    }
    if (options.verbose) process.stderr.write(chunk);
  };
  const onStdout = (chunk: Buffer) => {
    if (terminalError) {accept(chunk.length); return;}
    // A chunk can straddle a completion and idle output. Feed byte segments so
    // the synchronous line handler changes budgets at the actual boundary.
    for (let offset = 0; offset < chunk.length;) {
      const newline = chunk.indexOf(10, offset);
      const end = newline < 0 ? chunk.length : newline + 1;
      const size = end - offset;
      if (!accept(size)) return;
      lineBytes += size;
      if (lineBytes > LIMIT) {overflow('unterminated stdout line'); return;}
      if (newline >= 0) lineBytes = 0;
      boundedStdout.write(chunk.subarray(offset, end));
      offset = end;
    }
  };
  const onStdoutEnd = () => boundedStdout.end();
  hostLines.on('line', rawLine => {
    if (terminalError) return;
    const line = rawLine.trim();
    if (!line) return;
    let message: {type?: string; [key: string]: unknown} | null;
    try {message = JSON.parse(line);} catch {io.log(`[host] ${line}`); return;}
    switch (message?.type) {
      case RESPONSE_TYPE:
        if (current) current.response = message as unknown as HostResponse;
        break;
      case 'repl-error':
        if (current) current.replError = {message: String(message.message), stack: message.stack as string | undefined};
        break;
      case 'repl-eval-complete': {
        const frame = current;
        if (!frame || message.id !== frame.evalId) break;
        current = null;
        outputBytes = 0;
        frame.resolve();
        break;
      }
      case 'console-log': {
        const entry = logEntry(String(message.level ?? 'info'), String(message.message));
        retainLog(entry);
        if (!options.quiet || /^\[NATIVE_(?:COMPONENT|MODULE)_FALLBACK\] /.test(entry.message)) io.log(`[app] ${entry.message}`);
        break;
      }
      default:
        if (options.verbose) io.log(`[host] ${line}`);
    }
  });

  function finalize(code: number | null) {
    if (exited) return;
    if (!terminalError && (code !== 0 || !shutdownRequested || current)) {
      terminalError = {code: 'HOST_CRASHED', message: code !== 0
        ? `host exited with ${child.signalCode ? `signal ${child.signalCode}` : `code ${code}`}`
        : 'host exited while handling the session', details: {exitCode: code}};
    }
    exited = true;
    if (terminalError) {
      cancelWrite?.();
      if (process.platform !== 'win32') kill('SIGKILL');
      else windowsCleanup ??= terminateWindowsTree(child);
      if (terminalError.code === 'HOST_CRASHED' && stderrTail.length) {
        terminalError.details = {...terminalError.details, stderrTail: stderrTail.toString('utf8')};
      }
    }
    for (const timer of [escalation, cutoff, shutdownTimer, drainTimer]) if (timer !== undefined) clearTimeout(timer);
    inputLines?.close();
    hostLines.removeAllListeners('line');
    hostLines.close();
    boundedStdout.destroy();
    child.stdout!.removeListener('data', onStdout);
    child.stdout!.removeListener('end', onStdoutEnd);
    child.stderr!.removeListener('data', onStderr);
    child.removeListener('close', finalize);
    child.removeListener('exit', onExit);
    child.removeListener('error', onError);
    child.stdin!.removeListener('error', onInputError);
    child.stdout!.destroy(); child.stderr!.destroy(); child.stdin!.destroy();
    if (stderrLog !== undefined) {
      try {fs.writeSync(stderrLog, '\n');} catch {}
      closeLog();
    }
    child.unref();
    const complete = (details: ProcessCleanupResult = {}) => {
      if (terminalError && details.cleanupIncomplete) terminalError.details = {...terminalError.details, ...details};
      current?.resolve();
      current = null;
      resolveExit(code ?? 1);
    };
    if (windowsCleanup) void windowsCleanup.then(complete);
    else complete();
  }
  const onExit = () => {
    // 'exit' reaps the leader, but 'close' can wait forever on inherited pipes.
    drainTimer = setTimeout(() => stop({code: 'HOST_CRASHED', message: 'Host descendants retained session pipes after exit'}), 250);
  };
  const onError = (error: Error) => stop({code: 'HOST_CRASHED', message: `Host failed: ${error.message}`});
  const onInputError = (error: Error) => {if (!exited) onError(error);};
  child.on('close', finalize);
  child.on('exit', onExit);
  child.on('error', onError);
  child.stdin!.on('error', onInputError);
  child.stdout!.on('data', onStdout);
  child.stdout!.once('end', onStdoutEnd);
  child.stderr!.on('data', onStderr);
  for (const entry of options.initialLogs ?? []) retainLog(entry);

  /** Sends one request; fatal failures resolve only after bounded cleanup. */
  function send(request: Record<string, unknown>): Promise<HostResponse> {
    if (terminalError || exited) {
      return exitPromise.then(() => ({id: request.id, ok: false,
        error: terminalError?.message ?? 'host has exited', hostError: terminalError ?? undefined}));
    }
    if (request.quit === true) shutdownRequested = true;
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => stop({code: 'TIMEOUT', message: 'timeout'}), timeoutMs);
      const frame: Frame = {
        evalId: nextEvalId++, response: null, replError: null,
        resolve: () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (terminalError) resolve({id: request.id, ok: false, error: terminalError.message, hostError: terminalError});
          else if (frame.response) resolve(frame.response);
          else if (frame.replError) resolve({id: request.id, ok: false, error: frame.replError.message});
          else resolve({id: request.id, ok: false, error: exited ? 'host exited while handling the request' : 'no response from the runtime'});
        },
      };
      current = frame;
      const arg = JSON.stringify(JSON.stringify(request));
      const code = `globalThis.__rnA11y != null ? globalThis.__rnA11y.request(${arg}) : ` +
        `(() => { throw globalThis.__rnA11ySetupError ?? new Error('rn-a11y-tree session runtime is not installed'); })();\n`;
      const bytes = Buffer.from(code, 'utf8');
      child.stdin!.write(`${bytes.length}\n`);
      child.stdin!.write(bytes);
    });
  }

  let outputFailed = false;
  const outputFailure = (error: ErrorInfo) => {
    if (outputFailed) return;
    outputFailed = true;
    // The final response can fail after the host has already been reaped.
    if (exited) terminalError ??= error;
    else stop(error);
    cancelWrite?.();
    io.log(error.message);
  };
  const outputError = (error: Error) => outputFailure({code: 'HOST_CRASHED',
    message: `Session client output failed: ${error.message}`, details: {clientOutput: true}});
  const outputClose = () => outputError(new Error('output closed'));
  io.output.on('error', outputError);
  io.output.on('close', outputClose);
  io.output.on('finish', outputClose);

  const writeLine = async (value: unknown) => {
    if (outputFailed) return;
    if (!io.output.writable) {outputClose(); return;}
    const version = diagnosticVersion;
    const delivered = await new Promise<boolean>(resolve => {
      let settled = false;
      let callbackDone = false;
      let drained = false;
      let returned = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        io.output.removeListener('drain', onDrain);
        cancelWrite = undefined;
        resolve(ok);
      };
      const complete = () => {if (returned && callbackDone && drained) settle(true);};
      const onDrain = () => {drained = true; complete();};
      const timer = setTimeout(() => outputFailure({code: 'TIMEOUT',
        message: `Session client output timed out after ${timeoutMs} ms`, details: {clientOutput: true}}), timeoutMs);
      cancelWrite = () => {outputFailed = true; settle(false);};
      io.output.on('drain', onDrain);
      try {
        const accepted = io.output.write(JSON.stringify(value) + '\n', error => {
          if (settled) return;
          if (error) {outputError(error); return;}
          callbackDone = true;
          complete();
        });
        drained ||= accepted;
        returned = true;
        complete();
      } catch (error) {outputError(error as Error);}
    });
    if (!delivered) return;
    const record = value as {error?: ErrorInfo; diagnostics?: Diagnostic[]};
    if (terminalError && record.error === terminalError) terminalReported = true;
    if (record.diagnostics) reportedDiagnosticVersion = version;
  };

  const convert = (response: HostResponse, request: Record<string, unknown>) => {
    const diagnostics = diagnosticsFor(response);
    const policyError = fidelityError(diagnostics, options);
    if (policyError) policyFailed = true;
    const out: Record<string, unknown> = {id: response.id, ok: response.ok, ...(diagnostics.length ? {diagnostics} : {})};
    const step = response.step != null ? convertStep(response.step) : null;
    if (response.error != null) {
      out.error =
        step?.error != null && typeof step.error === 'object'
          ? step.error
          : {code: responseErrorCode(response.error), message: response.error};
    }
    if (step != null) out.step = step;
    if (response.tree != null) {
      out.tree = formatSessionTree(convertShadowTree(response.tree), {...treeDefaults, ...pickOutputKeys(request)});
    }
    if (response.diffTrees != null) {
      const [before, after] = response.diffTrees.map(convertShadowTree);
      out.diff = diffTrees(before, after);
    }
    if (response.fallbacks != null && response.fallbacks.length > 0) {
      out.fallbacks = response.fallbacks;
    }
    const logs = takeLogs();
    if (logs.length > 0) out.logs = logs;
    if (policyError && out.ok) {
      out.ok = false;
      out.error = policyError.toJSON();
    }
    if (response.hostError || terminalError) {
      out.ok = false;
      out.error = response.hostError ?? terminalError;
    }
    return out;
  };

  const finish = async (): Promise<number> => {
    shutdownRequested = true;
    if (!exited && !terminalError) {
      child.stdin!.end();
      shutdownTimer ??= setTimeout(() => stop({code: 'HOST_CRASHED', message: 'Host did not exit after session shutdown'}), 250);
    }
    const code = await exitPromise;
    // stdout is drained before exitPromise settles. Cleanup can log after the
    // quit response/completion; apply policy to that evidence before returning.
    const diagnostics = [...diagnosticMap.values()];
    const latePolicyError = fidelityError(diagnostics, options);
    if (latePolicyError) policyFailed = true;
    if (terminalError) {
      if (!terminalReported) {
        const logs = takeLogs();
        await writeLine({...(!readySent ? {ready: false} : {id: null, ok: false}), error: terminalError,
          ...(diagnostics.length ? {diagnostics} : {}), ...(logs.length ? {logs} : {})});
      }
      if (terminalError.code === 'TIMEOUT') io.log(`request timed out after ${timeoutMs} ms; host killed`);
      return EXIT_CODES[terminalError.code];
    }
    if (code !== 0) {
      io.log(`host exited with code ${code}`);
      const stderr = stderrTail.toString('utf8');
      if (stderr && !options.verbose) io.log(stderr.trimEnd());
      return EXIT_CODES.HOST_CRASHED;
    }
    const logs = takeLogs();
    if (logs.length || diagnosticVersion !== reportedDiagnosticVersion) {
      // Only new evidence needs a follow-up, but rejected evidence must stay
      // explicitly failed even when an earlier response reported policy failure.
      if (latePolicyError) {
        await writeLine({...(!readySent ? {ready: false} : {id: null, ok: false}),
          error: latePolicyError.toJSON(), diagnostics, ...(logs.length ? {logs} : {})});
      } else {
        await writeLine({id: null, ok: true, ...(diagnostics.length ? {diagnostics} : {}), ...(logs.length ? {logs} : {})});
      }
    }
    return outputFailed ? EXIT_CODES.HOST_CRASHED : policyFailed ? EXIT_CODES.UNSUPPORTED_NATIVE : 0;
  };

  const cancel = () => stop({code: 'HOST_CRASHED', message: 'Host execution cancelled', details: {cancelled: true}});
  // Keep these installed through cleanup so repeated signals cannot strand
  // the detached host while it is being reaped. This API owns one CLI session.
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    inputLines = clientLines(io.input, LIMIT, error => stop(error));
    // Initial render.
    const start = await send({id: null, start: true});
    if (terminalError) return await finish();
    if (!start.ok) {
      const code = exited ? 'HOST_CRASHED' : 'APP_THREW';
      const logs = takeLogs();
      const hint = nativeModuleHint(start.error ?? '');
      await writeLine({ready: false, error: {code, message: start.error, ...(hint ? {hint} : {})}, ...(logs.length > 0 ? {logs} : {})});
      const shutdownCode = await finish();
      return shutdownCode || EXIT_CODES[code];
    }
    try {
      checkHostInfo(start.hostInfo);
    } catch (error) {
      const cliError = error as CliError;
      await writeLine({ready: false, error: cliError.toJSON()});
      const shutdownCode = await finish();
      return shutdownCode || EXIT_CODES[cliError.code];
    }
    if (options.timing) {
      const toReady = Math.round((performance.now() - spawnedAt) * 1000) / 1000;
      const js = start.timings;
      io.log(
        `rn-a11y-tree timing: ${JSON.stringify({
          hostSpawnToReadyMs: toReady,
          hostStartupMs:
            js?.jsTotalMs != null ? Math.round((toReady - js.jsTotalMs) * 1000) / 1000 : undefined,
          js,
        })}`,
      );
    }
    const diagnostics = diagnosticsFor(start);
    if (terminalError) return await finish();
    const policyError = fidelityError(diagnostics, options);
    if (policyError) {
      policyFailed = true;
      await writeLine({ready: false, error: policyError.toJSON(), diagnostics, logs: takeLogs()});
      return await finish();
    }
    const readyLogs = takeLogs();
    const host = options.host;
    readySent = true;
    await writeLine({
      ready: true,
      ...(diagnostics.length ? {diagnostics} : {}),
      tree: start.tree ? formatSessionTree(convertShadowTree(start.tree), treeDefaults) : null,
      capabilities: start.capabilities ?? [],
      ...(start.hostInfo != null ? {hostInfo: start.hostInfo} : {}),
      ...(host != null
        ? {
            host: {
              source: host.source,
              ...(host.version != null ? {version: host.version} : {}),
              ...(host.protocolVersion != null ? {protocolVersion: host.protocolVersion} : {}),
            },
          }
        : {}),
      ...(readyLogs.length > 0 ? {logs: readyLogs} : {}),
    });

    // Requests, one at a time, in order.
    let quitSent = false;
    const lines = inputLines;
    for await (const rawLine of lines) {
      if (terminalError || exited) break;
      const line = rawLine.trim();
      if (!line) continue;
      let request: Record<string, unknown>;
      try {
        request = JSON.parse(line);
      } catch (error) {
        await writeLine({...convert({id: null, ok: false, error: 'invalid JSON'}, {}), error: {code: 'USAGE', message: `invalid JSON: ${(error as Error).message}`}});
        continue;
      }
      const problem = validateRequest(request);
      if (problem != null) {
        await writeLine({...convert({id: request?.id ?? null, ok: false, error: problem}, {}), error: {code: 'USAGE', message: problem}});
        continue;
      }
      const requestStart = performance.now();
      const response = await send(request);
      const out = convert(response, request);
      if (terminalError) await exitPromise;
      await writeLine(out);
      if (options.timing) {
        io.log(
          `rn-a11y-tree timing: ${JSON.stringify({id: request.id, requestMs: Math.round((performance.now() - requestStart) * 1000) / 1000})}`,
        );
      }
      if (request.quit === true) {
        quitSent = true;
        break;
      }
      if (terminalError || policyFailed || exited) break;
    }
    lines.close();
    if (!exited && !quitSent && !terminalError) {
      // End of input without `quit` behaves like `quit`.
      const response = await send({id: null, quit: true});
      const wasFailed = policyFailed;
      const out = convert(response, {});
      // Normal EOF remains silent, but conversion consumes cleanup logs: send
      // them (and newly retained diagnostics) before finish loses that evidence.
      if ((!wasFailed && policyFailed) || !response.ok || out.logs != null || diagnosticVersion !== reportedDiagnosticVersion) {
        await writeLine(out);
      }
    }
    return await finish();
  } finally {
    if (!exited) {
      stop({code: 'HOST_CRASHED', message: 'Session stopped before host shutdown'});
      await exitPromise;
    }
    inputLines?.close();
    if (outputFailed) {
      const output = io.output as NodeJS.WritableStream & {destroy?: () => void; closed?: boolean};
      if (output.destroy && !output.closed) {
        // A failed write callback can precede its asynchronous error/close.
        // Retain the error handler through destruction, with a bounded wait
        // for custom streams whose _destroy callback never completes.
        await new Promise<void>(resolve => {
          const done = () => {clearTimeout(timer); output.removeListener('close', done); resolve();};
          const timer = setTimeout(done, 250);
          output.once('close', done);
          output.destroy!();
        });
        if (!output.closed) {
          // Do not retain the session in a delayed custom stream callback.
          // This small guard removes itself when that stream finally closes.
          const ignoreError = () => {};
          output.on('error', ignoreError);
          output.once('close', () => output.removeListener('error', ignoreError));
        }
      }
    }
    io.output.removeListener('error', outputError);
    io.output.removeListener('close', outputClose);
    io.output.removeListener('finish', outputClose);
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}

/**
 * Optional output fields on `tree` and `snapshot` requests: `format`
 * (json | compact | text | ndjson), `select` (string or list), `depth`,
 * `subtree`, `style`. Text and ndjson trees are returned as a string.
 */
function formatSessionTree(tree: TreeNode, request: Record<string, unknown>): unknown {
  const format = (request.format as Format | undefined) ?? 'json';
  const select =
    typeof request.select === 'string' ? [request.select] : (request.select as string[] | undefined);
  const options = {
    format,
    select,
    depth: request.depth as number | undefined,
    subtree: request.subtree as string | undefined,
    style: request.style === true,
  };
  if (format === 'json' && select == null && options.depth == null && options.subtree == null) {
    return tree;
  }
  const viewport = {width: 0, height: 0};
  const text = formatRender({viewport, source: 'shadowTree', root: tree}, options);
  if (format === 'text' || format === 'ndjson') return text;
  const parsed = JSON.parse(text) as {root?: unknown; matches?: unknown};
  return parsed.root ?? parsed.matches;
}

const OUTPUT_KEYS = ['format', 'select', 'depth', 'subtree', 'style'];

function pickOutputKeys(request: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(OUTPUT_KEYS.filter(key => key in request).map(key => [key, request[key]]));
}

function responseErrorCode(message: string): ErrorCode {
  if (message === 'timeout') return 'TIMEOUT';
  if (/host (has )?exited/.test(message)) return 'HOST_CRASHED';
  if (/Session is not started|Unknown request/.test(message)) return 'USAGE';
  return stepErrorCode(message);
}

/** Returns an error message, or null if the request is valid. */
export function validateRequest(request: unknown): string | null {
  if (typeof request !== 'object' || request == null || Array.isArray(request)) {
    return 'request must be a JSON object';
  }
  const r = request as Record<string, unknown>;
  if (!('id' in r)) return 'request needs an "id"';
  const kinds = ['action', 'tree', 'quit'].filter(k => k in r);
  if (kinds.length !== 1) {
    return 'request needs exactly one of "action", "tree" or "quit"';
  }
  if ('diff' in r && (kinds[0] !== 'action' || typeof r.diff !== 'boolean')) {
    return '"diff" must be true or false, on action requests';
  }
  if ('format' in r && !FORMATS.includes(r.format as Format)) {
    return `"format" must be one of: ${FORMATS.join(', ')}`;
  }
  for (const key of OUTPUT_KEYS) {
    if (key in r && kinds[0] === 'quit') return `"${key}" is not allowed on quit`;
  }
  if (typeof r.select === 'string' || Array.isArray(r.select)) {
    try {
      for (const sel of typeof r.select === 'string' ? [r.select] : (r.select as string[])) parseSelector(sel);
    } catch (error) {
      return (error as Error).message;
    }
  }
  if (kinds[0] === 'action') {
    try {
      validateScript([r.action]);
    } catch (error) {
      return (error as Error).message.replace(/^step 0: /, '');
    }
  } else if (r[kinds[0]] !== true) {
    return `"${kinds[0]}" must be true`;
  }
  return null;
}
