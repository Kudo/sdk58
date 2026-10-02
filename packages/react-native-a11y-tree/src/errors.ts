/**
 * Machine-readable errors: `{code, message, hint?, details?}`, with one exit
 * code per class of failure.
 *
 * | exit | meaning |
 * | --- | --- |
 * | 0 | ok |
 * | 1 | usage (bad arguments, script, selector) |
 * | 2 | check failed (`check` command) |
 * | 3 | bundle failed (Metro) |
 * | 4 | app error (the app threw while loading or rendering) |
 * | 5 | host (missing, unavailable, incompatible, crashed, timeout) |
 * | 6 | unapproved observed native/runtime limitation |
 */

export type ErrorCode =
  | 'UNSUPPORTED_NATIVE'
  | 'USAGE'
  | 'CHECK_FAILED'
  | 'BUNDLE_FAILED'
  | 'APP_THREW'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_COVERED'
  | 'TIMEOUT'
  | 'HOST_MISSING'
  | 'HOST_UNAVAILABLE'
  | 'HOST_INCOMPATIBLE'
  | 'HOST_CRASHED';

export const EXIT_CODES: Record<ErrorCode, number> = {
  UNSUPPORTED_NATIVE: 6,
  USAGE: 1,
  CHECK_FAILED: 2,
  BUNDLE_FAILED: 3,
  APP_THREW: 4,
  TARGET_NOT_FOUND: 4,
  TARGET_COVERED: 4,
  TIMEOUT: 5,
  HOST_MISSING: 5,
  HOST_UNAVAILABLE: 5,
  HOST_INCOMPATIBLE: 5,
  HOST_CRASHED: 5,
};

export type ErrorInfo = {
  code: ErrorCode;
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
};

export class CliError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, options: {hint?: string; details?: Record<string, unknown>} = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.hint = options.hint;
    this.details = options.details;
  }

  toJSON(): ErrorInfo {
    const out: ErrorInfo = {code: this.code, message: this.message};
    if (this.hint) out.hint = this.hint;
    if (this.details && Object.keys(this.details).length > 0) out.details = this.details;
    return out;
  }
}

export function usage(message: string, hint?: string): CliError {
  return new CliError('USAGE', message, {hint});
}

/** Classifies a step error string from the runtime. */
export function stepErrorCode(message: string): ErrorCode {
  if (/Target not found|No element with tag|no view with tag/i.test(message)) return 'TARGET_NOT_FOUND';
  if (/Nothing is hittable|covered/i.test(message)) return 'TARGET_COVERED';
  if (/timeout/i.test(message)) return 'TIMEOUT';
  if (/host exited/i.test(message)) return 'HOST_CRASHED';
  return 'APP_THREW';
}

// --- app console output ---------------------------------------------------------

export type LogEntry = {level: string; message: string; known?: true};

/** Console output that React Native or common libraries print on every run. */
const KNOWN_NOISE = [
  /getViewManagerConfig\('RNCMaskedView'\)/,
  /is deprecated and will be removed/,
  /^\[ReactNative Architecture\]/,
];

export function logEntry(level: string, message: string): LogEntry {
  const entry: LogEntry = {level, message};
  if (KNOWN_NOISE.some(re => re.test(message))) entry.known = true;
  return entry;
}

/** Missing Expo modules fail before the native-view fallback can run. */
export function nativeModuleHint(message: string): string | undefined {
  const name = /Cannot find native module ['"]([^'"]+)['"]/.exec(message)?.[1];
  return name ? `The headless runtime has no adapter for ${name}. Native-view fallback cannot replace module APIs. Use an application-level mock or add an explicit runtime adapter; see docs/expo-support.md.` : undefined;
}
