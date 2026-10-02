import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';

/** Exact installed workspace versions used for testing, not compatibility ranges. */
export const TESTED_DEPENDENCIES = Object.freeze({
  expo: '58.0.0',
  'react-native': '0.88.0-rc.2',
  react: '19.3.0',
  'react-native-screens': '4.28.0',
  'react-native-safe-area-context': '5.9.1',
  'react-native-gesture-handler': '3.2.1',
  'react-native-reanimated': '4.7.0',
  'react-native-worklets': '0.13.0',
  '@expo/ui': '58.0.9',
});

export interface CompatibilityHostMetadata {
  rnVersion?: string;
  /** Package names mapped to compiled versions; null means unavailable. */
  nativeLibs?: Record<string, string | null>;
}
export interface CompatibilityIssue {
  code: 'MISSING_DEPENDENCY' | 'INVALID_PACKAGE_MANIFEST' | 'PACKAGE_RESOLUTION_FAILED' | 'RN_VERSION_MISMATCH' | 'DEPENDENCY_VERSION_MISMATCH' | 'UNTESTED_DEPENDENCY_VERSION';
  severity: 'error' | 'warning';
  package: string;
  expected?: string | null;
  actual?: string | null;
  message: string;
}
export interface CompatibilityReport {
  projectRoot: string;
  /** Installed app versions; missing or unreadable packages are null. */
  packages: Record<string, string | null>;
  issues: CompatibilityIssue[];
  ok: boolean;
  /** Only the tested dependency tuple. Does not establish device parity. */
  tested: boolean;
}

const REQUIRED = new Set(['react', 'react-native', 'expo']);
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/;
function errorCode(error: unknown): string | undefined {
  return (error as {code?: string} | null)?.code;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Resolve from the app only, including normal workspace hoisting. Never retry from the CLI. */
function manifestPath(resolve: ReturnType<typeof createRequire>['resolve'], name: string): string | null {
  try {
    return resolve(`${name}/package.json`);
  } catch (error) {
    if (errorCode(error) !== 'ERR_PACKAGE_PATH_NOT_EXPORTED' && errorCode(error) !== 'MODULE_NOT_FOUND') throw error;
    // Some libraries export their entry but hide package.json. Resolve without
    // executing application code, then walk past nested package scopes.
    try {
      let dir = path.dirname(resolve(name));
      for (;;) {
        const file = path.join(dir, 'package.json');
        if (fs.existsSync(file)) {
          const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (manifest?.name === name) return file;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }
    } catch (entryError) {
      if (errorCode(entryError) !== 'MODULE_NOT_FOUND' && errorCode(entryError) !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') throw entryError;
    }
    // Also handle packages with no default export (or a broken main). The
    // search paths belong to the app's createRequire, never this module.
    for (const base of resolve.paths(name) ?? []) {
      const file = path.join(base, name, 'package.json');
      if (fs.existsSync(file)) return file;
    }
    return null;
  }
}

export function inspectCompatibility(projectRoot: string, host: CompatibilityHostMetadata = {}): CompatibilityReport {
  const root = path.resolve(projectRoot);
  const {resolve} = createRequire(path.join(root, 'package.json'));
  const packages: Record<string, string | null> = {};
  const issues: CompatibilityIssue[] = [];
  for (const [name, baseline] of Object.entries(TESTED_DEPENDENCIES)) {
    packages[name] = null;
    let file: string | null;
    try {
      file = manifestPath(resolve, name);
    } catch (error) {
      issues.push({
        code: error instanceof SyntaxError || errorCode(error) === 'ERR_INVALID_PACKAGE_CONFIG' ? 'INVALID_PACKAGE_MANIFEST' : 'PACKAGE_RESOLUTION_FAILED',
        severity: 'error', package: name,
        message: `Cannot inspect ${name} from ${root}: ${errorMessage(error)}. Repair the package manifest or reinstall the app dependencies.`,
      });
      continue;
    }
    if (!file) {
      if (REQUIRED.has(name)) issues.push({
        code: 'MISSING_DEPENDENCY', severity: 'error', package: name, expected: baseline, actual: null,
        message: `Cannot resolve ${name} from ${root}. Install ${name} in the app and install its dependencies.${name === 'expo' ? ' This tool currently requires Expo Metro.' : ''}`,
      });
      continue;
    }
    let actual: string;
    try {
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof manifest?.version !== 'string' || !VERSION.test(manifest.version)) throw new Error('Expected a valid package version string');
      actual = manifest.version;
      packages[name] = actual;
    } catch (error) {
      issues.push({code: 'INVALID_PACKAGE_MANIFEST', severity: 'error', package: name,
        message: `Cannot read ${name} version from ${file}: ${errorMessage(error)}. Repair the manifest or reinstall ${name}.`});
      continue;
    }
    const expected = name === 'react-native' ? host.rnVersion ?? baseline
      : !REQUIRED.has(name) ? host.nativeLibs?.[name] === undefined ? baseline : host.nativeLibs[name]
      : baseline;
    if (actual !== expected) {
      const appRN = VERSION.exec(actual);
      const hostRN = expected === null ? null : VERSION.exec(expected);
      const differentRNLine = name === 'react-native' && (!hostRN || appRN?.[1] !== hostRN[1] || appRN?.[2] !== hostRN[2]);
      issues.push({
        code: name === 'react-native' ? 'RN_VERSION_MISMATCH' : 'DEPENDENCY_VERSION_MISMATCH',
        severity: differentRNLine ? 'error' : 'warning', package: name, expected, actual,
        message: `${name} ${actual} differs from ${expected === null ? 'the host, which does not include this library' : `the host or tested baseline (${expected})`}. ${differentRNLine ? 'Use a host built for the app’s React Native major/minor version.' : 'Use matching versions or validate this untested combination.'}`,
      });
    } else if (actual !== baseline) {
      issues.push({code: 'UNTESTED_DEPENDENCY_VERSION', severity: 'warning', package: name, expected: baseline, actual,
        message: `${name} ${actual} matches the host but differs from the tested dependency tuple (${baseline}). Validate this combination; matching dependencies do not establish device parity.`});
    }
  }
  return {projectRoot: root, packages, issues, ok: !issues.some(issue => issue.severity === 'error'), tested: issues.length === 0};
}
