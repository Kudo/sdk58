import {type ChildProcess, spawn, type SpawnOptions} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {PassThrough} from 'node:stream';
import {fileURLToPath} from 'node:url';
import {getHostPath, getHostVersionPath} from './runtimePackage.ts';
import {terminateWindowsTree, type ProcessCleanupResult} from './processCleanup.ts';

import {CliError, type ErrorCode, type LogEntry, logEntry, nativeModuleHint} from './errors.ts';
import {BASE_URL_ENV, downloadHost, hostFileName, readManifest} from './hostDownload.ts';

export {hostFileName};
import type {HostPayload, HostRuntimeInfo} from './schema.ts';

export const HOST_BIN_ENV = 'RN_A11Y_HOST_BIN';
/**
 * A program that runs the host: `$RN_A11Y_HOST_RUNNER <host> <args>` instead
 * of `<host> <args>` (tests: `bun` for the script fake host, which Windows
 * cannot start through its shebang).
 */
export const HOST_RUNNER_ENV = 'RN_A11Y_HOST_RUNNER';

/** Starts the host binary `bin` (through RN_A11Y_HOST_RUNNER when set). */
export function spawnHost(bin: string, args: string[], options: SpawnOptions): ChildProcess {
  const runner = process.env[HOST_RUNNER_ENV];
  return runner ? spawn(runner, [bin, ...args], options) : spawn(bin, args, options);
}

// Must match `RESULT_TYPE` / `ERROR_TYPE` in runtime/fantom/setup.ts.
const RESULT_TYPE = 'rn-a11y-tree-result';
const ERROR_TYPE = 'rn-a11y-tree-error';

export type HostOptions = {
  bundlePath: string;
  /** Surface size is set from JS (`Fantom.createRoot`); these set the host window. */
  windowWidth?: number;
  windowHeight?: number;
  /** JSON object of native feature flags (`--featureFlags`). */
  featureFlags?: Record<string, unknown>;
  /** Forward the host's stderr (glog) and console logs to our stderr. */
  verbose?: boolean;
  /** Filled with performance.now() timestamps (ms): spawn, result line, exit. */
  timing?: HostTiming;
  /** Collects the app's console output. */
  logs?: LogEntry[];
  /** Do not echo app console output to stderr. */
  quiet?: boolean;
  /** Time zone of the host process (`TZ`); default DEFAULT_TZ. */
  tz?: string;
  /** Whole subprocess lifetime, including shutdown after a result. Default 30 seconds. */
  timeoutMs?: number;
  signal?: AbortSignal;
};

/** The host runs in UTC unless `--tz` says otherwise, so date strings do not depend on the machine. */
export const DEFAULT_TZ = 'UTC';

/** Environment of the host process: ours, with `TZ` set. */
export function hostEnv(tz: string | undefined): NodeJS.ProcessEnv {
  return {...process.env, TZ: tz ?? DEFAULT_TZ};
}

export type HostTiming = {spawn?: number; result?: number; exit?: number};

/** Host or app failure; `code` is APP_THREW, HOST_MISSING or HOST_CRASHED. */
export class HostError extends CliError {
  readonly hostDetails?: {stack?: string; stderr?: string; exitCode?: number | null; cancelled?: boolean; cleanupTimedOut?: boolean; outputLimit?: boolean} & ProcessCleanupResult;

  constructor(
    code: ErrorCode,
    message: string,
    hostDetails?: {stack?: string; stderr?: string; exitCode?: number | null; cancelled?: boolean; cleanupTimedOut?: boolean; outputLimit?: boolean} & ProcessCleanupResult,
    hint?: string,
  ) {
    const details: Record<string, unknown> = {};
    if (hostDetails?.stack) details.stack = hostDetails.stack;
    if (hostDetails?.exitCode != null) details.exitCode = hostDetails.exitCode;
    if (hostDetails?.stderr) details.stderrTail = hostDetails.stderr.trimEnd().split('\n').slice(-20).join('\n');
    if (hostDetails?.outputLimit) details.outputLimit = true;
    if (hostDetails?.cancelled) details.cancelled = true;
    if (hostDetails?.cleanupTimedOut) details.cleanupTimedOut = true;
    if (hostDetails?.cleanupIncomplete) {
      details.cleanupIncomplete = true;
      details.cleanupReason = hostDetails.cleanupReason;
      if (hostDetails.cleanupExitCode !== undefined) details.cleanupExitCode = hostDetails.cleanupExitCode;
    }
    super(code, message, {hint, details});
    this.hostDetails = hostDetails;
    this.name = 'HostError';
  }
}

const BUILD_HINT =
  'Reinstall with optional dependencies enabled (`npm install --include=optional`), run `bun run build:host`, set RN_A11Y_HOST_BIN to the path of a host binary, or set RN_A11Y_HOST_BASE_URL to download a prebuilt host.';

/** `native/dist/<arch>/rn-a11y-host` (`.exe` on Windows), produced by `bun run build:host`. */
export const IS_CHECKOUT = fs.existsSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cli.ts'));

export const DEFAULT_HOST_BIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  IS_CHECKOUT ? '../../..' : '..',
  'native',
  'dist',
  os.arch() === 'x64' ? 'x86_64' : os.arch(),
  hostFileName(),
);

/**
 * Host <-> CLI contract version (bundle entry, NativeFantom methods, stdout
 * protocol) that this CLI supports. `host-version.json` records the host's
 * `protocolVersion` (scripts/release-host.ts HOST_PROTOCOL_VERSION).
 */
export const SUPPORTED_PROTOCOL = {min: 1, max: 1};

export type HostSource = 'env' | 'package' | 'download' | 'dist';

export type HostInfo = {
  bin: string;
  source: HostSource;
  /** From host-version.json (package or downloaded manifest). */
  version?: string;
  protocolVersion?: number;
  rnVersion?: string;
  nativeLibs?: Record<string, string | null>;
};

type HostManifestLike = {version?: unknown; protocolVersion?: unknown; reactNative?: unknown; rnVersion?: unknown; nativeLibs?: unknown} | null;

/** Probes used by findHost (replaced in tests). */
export type HostProbes = {
  env: string | undefined;
  baseUrl: string | undefined;
  exists: (file: string) => boolean;
  /** optional runtime package: binary path and host-version.json, or null when not installed / no binary for this platform. */
  packageHost: () => {bin: string; manifest: HostManifestLike} | null;
  download: (baseUrl: string) => Promise<{bin: string; manifest: HostManifestLike}>;
  distBin: string;
  /**
   * A repo checkout (src/cli.ts next to the running code): native/dist, the
   * host just built, ranks above the staged optional runtime package (the
   * git-ignored output of `release-host.ts --pack`).
   */
  checkout: boolean;
  log: (line: string) => void;
};

function info(bin: string, source: HostSource, manifest: HostManifestLike): HostInfo {
  manifest ??= readJson(path.join(path.dirname(bin), 'host-version.json'));
  const result: HostInfo = {bin, source};
  if (typeof manifest?.version === 'string') result.version = manifest.version;
  if (typeof manifest?.protocolVersion === 'number') result.protocolVersion = manifest.protocolVersion;
  const rnVersion = manifest?.reactNative ?? manifest?.rnVersion;
  if (typeof rnVersion === 'string') result.rnVersion = rnVersion;
  if (manifest?.nativeLibs && typeof manifest.nativeLibs === 'object' && !Array.isArray(manifest.nativeLibs)) {
    result.nativeLibs = Object.fromEntries(Object.entries(manifest.nativeLibs).filter((entry): entry is [string, string | null] => typeof entry[1] === 'string' || entry[1] === null));
  }
  return result;
}

/** HOST_INCOMPATIBLE when the host's protocolVersion is outside SUPPORTED_PROTOCOL. */
export function checkProtocol(host: HostInfo): void {
  const v = host.protocolVersion;
  if (v == null) return;
  if (v < SUPPORTED_PROTOCOL.min || v > SUPPORTED_PROTOCOL.max) {
    const range =
      SUPPORTED_PROTOCOL.min === SUPPORTED_PROTOCOL.max
        ? `${SUPPORTED_PROTOCOL.min}`
        : `${SUPPORTED_PROTOCOL.min}-${SUPPORTED_PROTOCOL.max}`;
    throw new CliError(
      'HOST_INCOMPATIBLE',
      `The host (${host.source}${host.version ? ` ${host.version}` : ''}, ${host.bin}) speaks protocol ${v}; this CLI supports ${range}`,
      {
        hint:
          v > SUPPORTED_PROTOCOL.max
            ? 'Update react-native-a11y-tree.'
            : 'Update react-native-a11y-tree (or the downloaded host) to match this CLI.',
        details: {host},
      },
    );
  }
}

/**
 * Host order: RN_A11Y_HOST_BIN, the optional runtime package, the prebuilt host
 * download (with RN_A11Y_HOST_BASE_URL; cached in
 * ~/.cache/rn-a11y-tree/host/<version>/), native/dist, else HOST_MISSING.
 * In a repo checkout: RN_A11Y_HOST_BIN, the download (when
 * RN_A11Y_HOST_BASE_URL is set), native/dist, the staged package.
 */
export async function findHost(probes: HostProbes): Promise<HostInfo> {
  if (probes.env != null && probes.env !== '') {
    if (!probes.exists(probes.env)) {
      throw new HostError('HOST_MISSING', `${HOST_BIN_ENV} points to a missing file: ${probes.env}`, undefined, BUILD_HINT);
    }
    return info(probes.env, 'env', null);
  }
  let downloadError: string | null = null;
  const tryDownload = async (): Promise<HostInfo | null> => {
    if (!probes.baseUrl) return null;
    try {
      const downloaded = await probes.download(probes.baseUrl);
      return info(downloaded.bin, 'download', downloaded.manifest);
    } catch (error) {
      downloadError = (error as Error).message;
      return null;
    }
  };
  const tryDist = (): HostInfo | null => {
    if (!probes.exists(probes.distBin)) return null;
    if (downloadError != null) {
      probes.log(`rn-a11y-tree: warning: prebuilt host download failed (${downloadError}); using ${probes.distBin}`);
    }
    return info(probes.distBin, 'dist', null);
  };
  const tryPackage = (): HostInfo | null => {
    const fromPackage = probes.packageHost();
    return fromPackage != null && probes.exists(fromPackage.bin)
      ? info(fromPackage.bin, 'package', fromPackage.manifest)
      : null;
  };
  // Installed: package, download, native/dist. Checkout: an explicit
  // download, then native/dist (the host just built), then the staged package.
  const found = probes.checkout
    ? ((await tryDownload()) ?? tryDist() ?? tryPackage())
    : (tryPackage() ?? (await tryDownload()) ?? tryDist());
  if (found != null) return found;
  if (downloadError != null) {
    throw new HostError('HOST_MISSING', `Prebuilt host download failed: ${downloadError}`, undefined, BUILD_HINT);
  }
  throw new HostError(
    'HOST_MISSING',
    `No host binary: no optional runtime package binary for ${process.platform}-${process.arch}, and none at ${probes.distBin}`,
    undefined,
    BUILD_HINT,
  );
}

function readJson(file: string): HostManifestLike {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** The optional runtime package's binary for this platform, or null. */
function packageHost(): {bin: string; manifest: HostManifestLike} | null {
  // Tests of the later steps (download, native/dist) in a checkout with a packed package.
  if (process.env.RN_A11Y_HOST_SKIP_PACKAGE === '1') return null;
  try {
    return {bin: getHostPath(), manifest: readJson(getHostVersionPath())};
  } catch {
    // Not installed, or HOST_UNAVAILABLE for this platform.
    return null;
  }
}

export function defaultProbes(log: (line: string) => void, cacheOnly = false): HostProbes {
  return {
    env: process.env[HOST_BIN_ENV],
    baseUrl: process.env[BASE_URL_ENV],
    exists: fs.existsSync,
    packageHost,
    download: async baseUrl => {
      const bin = await downloadHost({baseUrl, log, cacheOnly});
      return {bin, manifest: readManifest()?.manifest ?? null};
    },
    distBin: DEFAULT_HOST_BIN,
    checkout: IS_CHECKOUT,
    log,
  };
}


/** Set by ensureHost(). */
let resolvedHost: HostInfo | null = null;

/** Finds the host (findHost) and checks its protocol. Call before getHostBin() / runHost(). */
export async function ensureHost(options: {quiet?: boolean; verbose?: boolean} = {}): Promise<HostInfo> {
  const log = (line: string) => {
    if (!options.quiet) process.stderr.write(line + '\n');
  };
  const host = await findHost(defaultProbes(log));
  if (options.verbose) {
    const details = [host.version, host.protocolVersion != null ? `protocol ${host.protocolVersion}` : null]
      .filter(Boolean)
      .join(', ');
    process.stderr.write(`rn-a11y-tree: host: ${host.source} ${host.bin}${details ? ` (${details})` : ''}\n`);
  }
  checkProtocol(host);
  resolvedHost = host;
  return host;
}

/**
 * Checks the protocolVersion the running host reports (getHostInfo() or its
 * `protocolVersion:<n>` capability), for every host source. Hosts that
 * report neither are not checked.
 */
export function checkHostInfo(hostInfo: HostRuntimeInfo | null | undefined, options: {verbose?: boolean} = {}): void {
  if (hostInfo == null) return;
  if (options.verbose) process.stderr.write(`rn-a11y-tree: host info: ${JSON.stringify(hostInfo)}\n`);
  const host = resolvedHost ?? {bin: getHostBin(), source: 'env' as HostSource};
  checkProtocol({...host, protocolVersion: hostInfo.protocolVersion});
}

/** The host found by ensureHost(), else RN_A11Y_HOST_BIN or native/dist (synchronous). */
export function getHostBin(): string {
  if (resolvedHost != null) return resolvedHost.bin;
  const fromEnv = process.env[HOST_BIN_ENV];
  if (fromEnv != null && fromEnv !== '') {
    if (!fs.existsSync(fromEnv)) {
      throw new HostError('HOST_MISSING', `${HOST_BIN_ENV} points to a missing file: ${fromEnv}`, undefined, BUILD_HINT);
    }
    return fromEnv;
  }
  const fromPackage = packageHost();
  if (fromPackage != null && fs.existsSync(fromPackage.bin)) return fromPackage.bin;
  if (!fs.existsSync(DEFAULT_HOST_BIN)) {
    throw new HostError('HOST_MISSING', `Host binary not found at ${DEFAULT_HOST_BIN}`, undefined, BUILD_HINT);
  }
  return DEFAULT_HOST_BIN;
}

/** The host found by ensureHost(), if it ran. */
export function currentHost(): HostInfo | null {
  return resolvedHost;
}

/**
 * RN_A11Y_HOST_STDERR_LOG=<file>: append the host's stderr of every run to
 * the file (CI greps it for sanitizer reports of runs that did not fail).
 */
export function appendHostStderr(bin: string, stderr: string): void {
  const file = process.env.RN_A11Y_HOST_STDERR_LOG;
  if (!file) return;
  try {
    fs.appendFileSync(file, `--- ${bin} (pid ${process.pid}) ---\n${stderr}${stderr.endsWith('\n') ? '' : '\n'}`);
  } catch {
    // Diagnostics only.
  }
}

/**
 * Builds the host argv. Flags are gflags defined in Fantom's
 * tester/src/AppSettings.cpp.
 */
export function hostArgs(options: HostOptions): string[] {
  const args = [
    '--bundlePath',
    options.bundlePath,
    '--featureFlags',
    JSON.stringify(options.featureFlags ?? {}),
    '--minLogLevel',
    options.verbose ? 'info' : 'error',
  ];
  if (options.windowWidth != null) {
    args.push('--windowWidth', String(Math.round(options.windowWidth)));
  }
  if (options.windowHeight != null) {
    args.push('--windowHeight', String(Math.round(options.windowHeight)));
  }
  return args;
}

type HostLine =
  | {type: typeof RESULT_TYPE; rnA11yTree: HostPayload}
  | {type: typeof ERROR_TYPE; error: {message: string; stack?: string}}
  | {type: 'console-log'; level: string; message: string}
  | {type?: string; [key: string]: unknown};

/**
 * Runs the host binary on a bundle and returns the payload reported by the
 * JS entry. The host prints newline-delimited JSON on stdout (console logs as
 * `{"type":"console-log",...}` and our result as
 * `{"type":"rn-a11y-tree-result","rnA11yTree":{...}}`); glog goes to stderr.
 */
export async function runHost<T = HostPayload>(options: HostOptions): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) {
    throw new CliError('USAGE', 'Host timeoutMs must be an integer from 1 through 2147483647.');
  }
  if (options.signal?.aborted) {
    throw new HostError('HOST_CRASHED', 'Host execution cancelled', {cancelled: true});
  }
  const bin = getHostBin();
  if (options.timing) options.timing.spawn = performance.now();
  const child = spawnHost(bin, hostArgs(options), {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: hostEnv(options.tz),
    // POSIX uses a process group; Windows uses bounded taskkill tree cleanup.
    // A root that already exited (Windows), or escaped descendants (POSIX),
    // can still retain pipes, so cleanup always has a hard cutoff.
    detached: process.platform !== 'win32',
  });

  // Bound raw bytes before readline can accumulate an unterminated line or
  // console records can grow the retained logs indefinitely. Includes results.
  const outputLimitBytes = 32 * 1024 * 1024;
  let outputBytes = 0;
  let outputLimit = false;
  let stopForOutput = () => {};
  const acceptOutput = (chunk: Buffer): boolean => {
    if (outputLimit) return false;
    outputBytes += chunk.length;
    if (outputBytes <= outputLimitBytes) return true;
    outputLimit = true;
    stopForOutput();
    return false;
  };
  let stderrTail = Buffer.alloc(0);
  let stderrLog: number | undefined;
  const closeStderrLog = () => {
    if (stderrLog === undefined) return;
    try { fs.closeSync(stderrLog); } catch {} // Diagnostic logging is best effort.
    stderrLog = undefined;
  };
  const logFile = process.env.RN_A11Y_HOST_STDERR_LOG;
  if (logFile) {
    try {
      stderrLog = fs.openSync(logFile, 'a');
      fs.writeSync(stderrLog, `--- ${bin} (pid ${process.pid}) ---\n`);
    } catch { closeStderrLog(); }
  }
  const onStderr = (chunk: Buffer) => {
    if (!acceptOutput(chunk)) return;
    // Bound retained diagnostics even if the subprocess floods stderr.
    const tail = chunk.subarray(-65536);
    stderrTail = Buffer.concat([stderrTail.subarray(-Math.max(0, 65536 - tail.length)), tail]).subarray(-65536);
    // Preserve accepted sanitizer output without adding headers between chunks.
    if (stderrLog !== undefined) {
      try { fs.writeSync(stderrLog, chunk); } catch { closeStderrLog(); }
    }
    if (options.verbose) process.stderr.write(chunk);
  };
  child.stderr!.on('data', onStderr);

  let result: T | undefined;
  let jsError: {message: string; stack?: string} | undefined;

  const boundedStdout = new PassThrough();
  const onStdout = (chunk: Buffer) => {
    if (acceptOutput(chunk)) boundedStdout.write(chunk);
  };
  const onStdoutEnd = () => boundedStdout.end();
  const rl = readline.createInterface({input: boundedStdout});
  child.stdout!.on('data', onStdout);
  child.stdout!.once('end', onStdoutEnd);
  rl.on('line', rawLine => {
    const line = rawLine.trim();
    if (!line) return;
    let parsed: HostLine;
    try {
      parsed = JSON.parse(line);
    } catch {
      if (options.verbose) process.stderr.write(`[host] ${line}\n`);
      return;
    }
    if (parsed?.type === RESULT_TYPE && 'rnA11yTree' in parsed) {
      if (options.timing) options.timing.result = performance.now();
      result = parsed.rnA11yTree as T;
    } else if (parsed?.type === ERROR_TYPE && 'error' in parsed) {
      jsError = parsed.error as {message: string; stack?: string};
    } else if (parsed?.type === 'console-log') {
      const {level, message} = parsed as {level: string; message: string};
      const entry = logEntry(level, message);
      options.logs?.push(entry);
      // Fallback warnings always explain reduced fidelity. Otherwise, unless
      // quiet: unknown errors/warnings, or everything with --verbose.
      if (/^\[NATIVE_(?:COMPONENT|MODULE)_FALLBACK\] /.test(message) || options.verbose || (!options.quiet && !entry.known && (level === 'error' || level === 'warn'))) {
        process.stderr.write(`[console.${level}] ${message}\n`);
      }
    } else if (options.verbose) {
      process.stderr.write(`[host] ${line}\n`);
    }
  });

  let stopped: 'timeout' | 'cancelled' | 'error' | 'output-limit' | undefined;
  let spawnError: Error | undefined;
  let cleanupTimedOut = false;
  let windowsCleanup: Promise<ProcessCleanupResult> | undefined;
  let cleanupDetails: ProcessCleanupResult = {};
  const [exitCode, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(resolve => {
    let settled = false;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    let cutoff: ReturnType<typeof setTimeout> | undefined;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== 'win32' && child.pid != null) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // ESRCH means the group has exited. Other kill failures still reach
        // the bounded cutoff rather than leaving this request pending forever.
        try { child.kill(signal); } catch {}
      }
    };
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (escalation !== undefined) clearTimeout(escalation);
      if (cutoff !== undefined) clearTimeout(cutoff);
      options.signal?.removeEventListener('abort', onAbort);
      const failed = stopped !== undefined || code !== 0 || jsError !== undefined || !result;
      if (process.platform !== 'win32') {
        if (failed) kill('SIGKILL'); // Also clean up runner descendants after leader exit.
      } else if (failed && !windowsCleanup) {
        // Closed pipes do not prove descendant cleanup on Windows. A root
        // exiting without a result is still a failure, even with exit code 0.
        windowsCleanup = terminateWindowsTree(child);
      }
      child.removeListener('error', onError);
      child.removeListener('close', finish);
      rl.removeAllListeners('line');
      rl.close();
      boundedStdout.destroy();
      child.stdout!.removeListener('data', onStdout);
      child.stdout!.removeListener('end', onStdoutEnd);
      child.stderr!.removeListener('data', onStderr);
      child.stdout!.destroy();
      child.stderr!.destroy();
      if (stderrLog !== undefined) {
        try { fs.writeSync(stderrLog, '\n'); } catch {}
        closeStderrLog();
      }
      child.unref();
      const complete = () => {
        if (options.timing) options.timing.exit = performance.now();
        resolve([code, signal]);
      };
      if (windowsCleanup) void windowsCleanup.then(details => {cleanupDetails = details; complete();});
      else complete();
    };
    const stop = (reason: typeof stopped) => {
      if (settled || stopped) return;
      stopped = reason;
      if (process.platform === 'win32') windowsCleanup = terminateWindowsTree(child);
      else {
        kill('SIGTERM');
        escalation = setTimeout(() => kill('SIGKILL'), 250);
      }
      cutoff = setTimeout(() => {
        cleanupTimedOut = true;
        finish(child.exitCode, child.signalCode);
      }, 1250);
    };
    stopForOutput = () => stop('output-limit');
    const onAbort = () => stop('cancelled');
    const onError = (error: Error) => {
      spawnError = error;
      stop('error');
    };
    const deadline = setTimeout(() => stop('timeout'), timeoutMs);
    child.on('error', onError);
    child.once('close', finish);
    options.signal?.addEventListener('abort', onAbort, {once: true});
    // Cover cancellation between the pre-spawn check and listener registration.
    if (options.signal?.aborted) onAbort();
  });
  const stderr = stderrTail.toString('utf8');

  if (stopped) {
    throw new HostError(stopped === 'timeout' ? 'TIMEOUT' : 'HOST_CRASHED',
      stopped === 'timeout' ? `Host execution timed out after ${timeoutMs} ms` :
        stopped === 'cancelled' ? 'Host execution cancelled' :
        stopped === 'output-limit' ? `Host exceeded the ${outputLimitBytes}-byte combined stdout/stderr output limit` : `Host failed: ${spawnError?.message}`,
      {...cleanupDetails, stderr, exitCode, cancelled: stopped === 'cancelled', cleanupTimedOut: cleanupTimedOut || cleanupDetails.cleanupTimedOut, outputLimit});
  }
  if (jsError) {
    throw new HostError('APP_THREW', `Render failed in JS: ${jsError.message}`, {
      ...cleanupDetails,
      stack: jsError.stack,
      exitCode,
    }, nativeModuleHint(jsError.message));
  }
  if (exitCode !== 0) {
    throw new HostError(
      'HOST_CRASHED',
      `Host exited with ${signal ? `signal ${signal}` : `code ${exitCode}`}`,
      {...cleanupDetails, stderr, exitCode},
    );
  }
  if (!result) {
    throw new HostError('HOST_CRASHED', 'Host exited without printing a rn-a11y-tree result', {
      ...cleanupDetails,
      stderr,
      exitCode,
    });
  }
  return result;
}
