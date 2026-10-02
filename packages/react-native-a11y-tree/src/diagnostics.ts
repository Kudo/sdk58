import {CliError, type LogEntry} from './errors.ts';

/** Observed limitations, not a certificate of native equivalence when empty. */
export type Diagnostic = {
  code: 'BUILD_CONFIGURATION' | 'DEPENDENCY_COMPATIBILITY' | 'APPLICATION_FIXTURE' | 'NATIVE_MODULE_FALLBACK' | 'NATIVE_COMPONENT_FALLBACK' | 'NATIVE_API_UNSUPPORTED' | 'RUNTIME_FALLBACK';
  target: string;
  message: string;
};

export type FidelityOptions = {failOnFallback?: boolean; allowFallback?: string[]};

/** The runtime's warning markers are also preserved in ordinary app logs. */
export function collectDiagnostics(logs: LogEntry[], fallbacks: string[] = []): Diagnostic[] {
  const found = new Map<string, Diagnostic>();
  for (const {message} of logs) {
    const match = /^\[(BUILD_CONFIGURATION|DEPENDENCY_COMPATIBILITY|APPLICATION_FIXTURE|NATIVE_MODULE_FALLBACK|NATIVE_COMPONENT_FALLBACK|NATIVE_API_UNSUPPORTED)\] ([^\s:]+)(?::|\s)/.exec(message);
    if (match) {
      const [, code, target] = match;
      found.set(`${code}:${target}`, {code: code as Diagnostic['code'], target, message});
    }
  }
  for (const target of fallbacks) {
    found.set(`RUNTIME_FALLBACK:${target}`, {code: 'RUNTIME_FALLBACK', target, message: `Host runtime fallback used: ${target}`});
  }
  return [...found.values()];
}

export function fidelityError(diagnostics: Diagnostic[], options: FidelityOptions): CliError | undefined {
  if (!options.failOnFallback) return;
  const allowed = new Set(options.allowFallback ?? []);
  const rejected = diagnostics.filter(d => d.code === 'NATIVE_API_UNSUPPORTED' || !allowed.has(d.target));
  if (rejected.length === 0) return;
  return new CliError('UNSUPPORTED_NATIVE', `Observed ${rejected.length} unapproved native/runtime limitation(s).`, {
    hint: 'Use a supported implementation or an explicit app mock. Allow intentional fallbacks with --allow-fallback <exact-name>; unsupported API calls cannot be allowed.',
    details: {diagnostics: rejected},
  });
}
