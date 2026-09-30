import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

import {CliError, type ErrorCode, type LogEntry, logEntry} from './errors.ts';
import {BASE_URL_ENV, downloadHost, readManifest} from './hostDownload.ts';
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
  'Run `bun run build:host`, set RN_A11Y_HOST_BIN to the path of a host binary, or set RN_A11Y_HOST_BASE_URL to download a prebuilt host.';

/** `native/dist/<arch>/rn-a11y-host`, produced by `bun run build:host`. */
export const DEFAULT_HOST_BIN = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'native',
  'dist',
  os.arch() === 'x64' ? 'x86_64' : os.arch(),
  'rn-a11y-host',
);

/**
 * Host <-> CLI contract version (bundle entry, NativeFantom methods, stdout
 * protocol) that this CLI supports. `host-version.json` records the host's
 * `protocolVersion` (scripts/release-host.mjs HOST_PROTOCOL_VERSION).
 */
export const SUPPORTED_PROTOCOL = {min: 1, max: 1};

export type HostSource = 'env' | 'package' | 'download' | 'dist';

export type HostInfo = {
  bin: string;
  source: HostSource;
  /** From host-version.json (package or downloaded manifest). */
  version?: string;
  protocolVersion?: number;
};

type HostManifestLike = {version?: unknown; protocolVersion?: unknown} | null;

/** Probes used by findHost (replaced in tests). */
export type HostProbes = {
  env: string | undefined;
  baseUrl: string | undefined;
  exists: (file: string) => boolean;
  /** rn-a11y-host package: binary path and host-version.json, or null when not installed / no binary for this platform. */
  packageHost: () => {bin: string; manifest: HostManifestLike} | null;
  download: (baseUrl: string) => Promise<{bin: string; manifest: HostManifestLike}>;
  distBin: string;
  log: (line: string) => void;
};

function info(bin: string, source: HostSource, manifest: HostManifestLike): HostInfo {
  const result: HostInfo = {bin, source};
  if (typeof manifest?.version === 'string') result.version = manifest.version;
  if (typeof manifest?.protocolVersion === 'number') result.protocolVersion = manifest.protocolVersion;
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
            : 'Update rn-a11y-host (or the downloaded host) to match this CLI.',
        details: {host},
      },
    );
  }
}

/**
 * Host order: RN_A11Y_HOST_BIN, the rn-a11y-host package, the prebuilt host
 * download (with RN_A11Y_HOST_BASE_URL; cached in
 * ~/.cache/rn-a11y-tree/host/<version>/), native/dist, else HOST_MISSING.
 */
export async function findHost(probes: HostProbes): Promise<HostInfo> {
  if (probes.env != null && probes.env !== '') {
    if (!probes.exists(probes.env)) {
      throw new HostError('HOST_MISSING', `${HOST_BIN_ENV} points to a missing file: ${probes.env}`, undefined, BUILD_HINT);
    }
    return info(probes.env, 'env', null);
  }
  const fromPackage = probes.packageHost();
  if (fromPackage != null && probes.exists(fromPackage.bin)) {
    return info(fromPackage.bin, 'package', fromPackage.manifest);
  }
  let downloadError: string | null = null;
  if (probes.baseUrl) {
    try {
      const downloaded = await probes.download(probes.baseUrl);
      return info(downloaded.bin, 'download', downloaded.manifest);
    } catch (error) {
      downloadError = (error as Error).message;
    }
  }
  if (probes.exists(probes.distBin)) {
    if (downloadError != null) {
      probes.log(`rn-a11y-tree: warning: prebuilt host download failed (${downloadError}); using ${probes.distBin}`);
    }
    return info(probes.distBin, 'dist', null);
  }
  if (downloadError != null) {
    throw new HostError('HOST_MISSING', `Prebuilt host download failed: ${downloadError}`, undefined, BUILD_HINT);
  }
  throw new HostError(
    'HOST_MISSING',
    `No host binary: no rn-a11y-host package binary for ${process.platform}-${process.arch}, and none at ${probes.distBin}`,
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

/** The rn-a11y-host package's binary for this platform, or null. */
function packageHost(): {bin: string; manifest: HostManifestLike} | null {
  // Tests of the later steps (download, native/dist) in a checkout with a packed package.
  if (process.env.RN_A11Y_HOST_SKIP_PACKAGE === '1') return null;
  try {
    const hostPackage = require('rn-a11y-host') as {getHostPath: () => string; getHostVersionPath: () => string};
    return {bin: hostPackage.getHostPath(), manifest: readJson(hostPackage.getHostVersionPath())};
  } catch {
    // Not installed, or HOST_UNAVAILABLE for this platform.
    return null;
  }
}

export function defaultProbes(log: (line: string) => void): HostProbes {
  return {
    env: process.env[HOST_BIN_ENV],
    baseUrl: process.env[BASE_URL_ENV],
    exists: fs.existsSync,
    packageHost,
    download: async baseUrl => {
      const bin = await downloadHost({baseUrl, log});
      return {bin, manifest: readManifest()?.manifest ?? null};
    },
    distBin: DEFAULT_HOST_BIN,
    log,
  };
}

/** Set by ensureHost(). */
let resolvedHost: HostInfo | null = null;

/** Finds the host (findHost) and checks its protocol. Call before getHostBin() / runHost(). */
export async function ensureHost(options: {quiet?: boolean} = {}): Promise<HostInfo> {
  const log = (line: string) => {
    if (!options.quiet) process.stderr.write(line + '\n');
  };
  const host = await findHost(defaultProbes(log));
  checkProtocol(host);
  resolvedHost = host;
  return host;
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
  appendHostStderr(bin, stderr);

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
