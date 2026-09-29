import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

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
};

export class HostError extends Error {
  constructor(
    message: string,
    readonly details?: {stack?: string; stderr?: string; exitCode?: number | null},
  ) {
    super(message);
    this.name = 'HostError';
  }
}

/** `native/dist/<arch>/rn-a11y-host`, produced by `yarn build:host`. */
export const DEFAULT_HOST_BIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'native',
  'dist',
  os.arch() === 'x64' ? 'x86_64' : os.arch(),
  'rn-a11y-host',
);

export function getHostBin(): string {
  const fromEnv = process.env[HOST_BIN_ENV];
  if (fromEnv != null && fromEnv !== '') {
    if (!fs.existsSync(fromEnv)) {
      throw new HostError(`${HOST_BIN_ENV} points to a missing file: ${fromEnv}`);
    }
    return fromEnv;
  }
  if (!fs.existsSync(DEFAULT_HOST_BIN)) {
    throw new HostError(
      `Host binary not found at ${DEFAULT_HOST_BIN}. Run \`yarn build:host\`, or set ${HOST_BIN_ENV} to the path of a host binary.`,
    );
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
export async function runHost(options: HostOptions): Promise<HostPayload> {
  const bin = getHostBin();
  const child = spawn(bin, hostArgs(options), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderrChunks: Buffer[] = [];
  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk);
    if (options.verbose) process.stderr.write(chunk);
  });

  let result: HostPayload | undefined;
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
      result = parsed.rnA11yTree as HostPayload;
    } else if (parsed?.type === ERROR_TYPE && 'error' in parsed) {
      jsError = parsed.error as {message: string; stack?: string};
    } else if (parsed?.type === 'console-log') {
      // console.error/warn from the app are always shown; info only if verbose.
      const {level, message} = parsed as {level: string; message: string};
      if (options.verbose || level === 'error' || level === 'warn') {
        process.stderr.write(`[console.${level}] ${message}\n`);
      }
    } else if (options.verbose) {
      process.stderr.write(`[host] ${line}\n`);
    }
  });

  const [exitCode, signal] = await new Promise<[number | null, NodeJS.Signals | null]>(
    (resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code, sig) => resolve([code, sig]));
    },
  );
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  if (jsError) {
    throw new HostError(`Render failed in JS: ${jsError.message}`, {
      stack: jsError.stack,
      stderr,
      exitCode,
    });
  }
  if (exitCode !== 0) {
    throw new HostError(
      `Host exited with ${signal ? `signal ${signal}` : `code ${exitCode}`}`,
      {stderr, exitCode},
    );
  }
  if (!result) {
    throw new HostError(
      'Host exited without printing a rn-a11y-tree result',
      {stderr, exitCode},
    );
  }
  return result;
}
