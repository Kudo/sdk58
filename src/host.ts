import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

import {CliError, type ErrorCode, type LogEntry, logEntry} from './errors.ts';
import {BASE_URL_ENV, downloadHost} from './hostDownload.ts';
import type {HostPayload} from './schema.ts';

export const HOST_BIN_ENV = 'RN_A11Y_HOST_BIN';

// Must match `RESULT_TYPE` / `ERROR_TYPE` in runtime/fantom/setup.js.
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
};

export type HostTiming = {spawn?: number; result?: number; exit?: number};

/** Host or app failure; `code` is APP_THREW, HOST_MISSING or HOST_CRASHED. */
export class HostError extends CliError {
  constructor(
    code: ErrorCode,
    message: string,
    readonly hostDetails?: {stack?: string; stderr?: string; exitCode?: number | null},
    hint?: string,
  ) {
    const details: Record<string, unknown> = {};
    if (hostDetails?.stack) details.stack = hostDetails.stack;
    if (hostDetails?.exitCode != null) details.exitCode = hostDetails.exitCode;
    if (hostDetails?.stderr) details.stderrTail = hostDetails.stderr.trimEnd().split('\n').slice(-20).join('\n');
    super(code, message, {hint, details});
    this.name = 'HostError';
  }
}

const BUILD_HINT =
  'Run `yarn build:host`, set RN_A11Y_HOST_BIN to the path of a host binary, or set RN_A11Y_HOST_BASE_URL to download a prebuilt host.';

/** `native/dist/<arch>/rn-a11y-host`, produced by `yarn build:host`. */
export const DEFAULT_HOST_BIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'native',
  'dist',
  os.arch() === 'x64' ? 'x86_64' : os.arch(),
  'rn-a11y-host',
);

/** Set by ensureHost(). */
let resolvedHostBin: string | null = null;

/**
 * Finds the host binary: RN_A11Y_HOST_BIN, then (with RN_A11Y_HOST_BASE_URL)
 * the prebuilt host for host-version.json, downloaded once into
 * ~/.cache/rn-a11y-tree/host/<version>/, then native/dist. Call before
 * getHostBin() / runHost().
 */
export async function ensureHost(options: {quiet?: boolean} = {}): Promise<string> {
  const log = (line: string) => {
    if (!options.quiet) process.stderr.write(line + '\n');
  };
  const fromEnv = process.env[HOST_BIN_ENV];
  const baseUrl = process.env[BASE_URL_ENV];
  if ((fromEnv == null || fromEnv === '') && baseUrl) {
    try {
      resolvedHostBin = await downloadHost({baseUrl, log});
      return resolvedHostBin;
    } catch (error) {
      const reason = (error as Error).message;
      if (!fs.existsSync(DEFAULT_HOST_BIN)) {
        throw new HostError('HOST_MISSING', `Prebuilt host download failed: ${reason}`, undefined, BUILD_HINT);
      }
      log(`rn-a11y-tree: warning: prebuilt host download failed (${reason}); using ${DEFAULT_HOST_BIN}`);
    }
  }
  resolvedHostBin = getHostBin();
  return resolvedHostBin;
}

export function getHostBin(): string {
  if (resolvedHostBin != null) return resolvedHostBin;
  const fromEnv = process.env[HOST_BIN_ENV];
  if (fromEnv != null && fromEnv !== '') {
    if (!fs.existsSync(fromEnv)) {
      throw new HostError('HOST_MISSING', `${HOST_BIN_ENV} points to a missing file: ${fromEnv}`, undefined, BUILD_HINT);
    }
    return fromEnv;
  }
  if (!fs.existsSync(DEFAULT_HOST_BIN)) {
    throw new HostError('HOST_MISSING', `Host binary not found at ${DEFAULT_HOST_BIN}`, undefined, BUILD_HINT);
  }
  return DEFAULT_HOST_BIN;
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
  const bin = getHostBin();
  if (options.timing) options.timing.spawn = performance.now();
  const child = spawn(bin, hostArgs(options), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrChunks: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    if (options.verbose) process.stderr.write(chunk);
  });

  let result: T | undefined;
  let jsError: {message: string; stack?: string} | undefined;

  const rl = readline.createInterface({input: child.stdout});
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
      // Unless quiet: errors and warnings that are not known noise, or
      // everything with --verbose.
      if (options.verbose || (!options.quiet && !entry.known && (level === 'error' || level === 'warn'))) {
        process.stderr.write(`[console.${level}] ${message}\n`);
      }
    } else if (options.verbose) {
      process.stderr.write(`[host] ${line}\n`);
    }
  });

  const [exitCode, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(
    (resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, sig) => {
        if (options.timing) options.timing.exit = performance.now();
        resolve([code, sig]);
      });
    },
  );
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  if (jsError) {
    throw new HostError('APP_THREW', `Render failed in JS: ${jsError.message}`, {
      stack: jsError.stack,
      exitCode,
    });
  }
  if (exitCode !== 0) {
    throw new HostError(
      'HOST_CRASHED',
      `Host exited with ${signal ? `signal ${signal}` : `code ${exitCode}`}`,
      {stderr, exitCode},
    );
  }
  if (!result) {
    throw new HostError('HOST_CRASHED', 'Host exited without printing a rn-a11y-tree result', {
      stderr,
      exitCode,
    });
  }
  return result;
}
