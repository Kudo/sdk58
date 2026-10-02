import fs from 'node:fs';
import {createRequire} from 'node:module';
import path from 'node:path';
import type {ConfigT} from 'metro-config';
import {usage} from './errors.ts';

const RESOLVER_FIELDS = ['assetExts', 'sourceExts', 'nodeModulesPaths', 'extraNodeModules', 'resolveRequest'] as const;
const TRANSFORMER_FIELDS = ['babelTransformerPath'] as const;

export type MetroConfigProjection = {
  configPath: string;
  watchFolders: ConfigT['watchFolders'];
  resolver: Pick<ConfigT['resolver'], typeof RESOLVER_FIELDS[number]>;
  transformer: Pick<ConfigT['transformer'], typeof TRANSFORMER_FIELDS[number]>;
};

/**
 * Configuration is trusted executable project code, not a sandbox. Metro and
 * Expo recreate default functions on every load, so identity cannot distinguish
 * a user override from a fresh default closure. Compare exact function source
 * as a fallback, without invoking startup/serializer callbacks. This cannot
 * distinguish identical function bodies with different captured values (or
 * bound/native functions with the same source). It is a compatibility check,
 * not proof of semantic equivalence or a security boundary.
 */
function equivalent(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a === 'function' && typeof b === 'function') {
    return Function.prototype.toString.call(a) === Function.prototype.toString.call(b);
  }
  if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => equivalent(value, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = a as Record<string, unknown>;
    const right = b as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].every(key => equivalent(left[key], right[key]));
  }
  return false;
}

function unsupportedFields(base: object, loaded: object, allowed: readonly string[], prefix: string): string[] {
  const a = base as Record<string, unknown>;
  const b = loaded as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(key => !allowed.includes(key) && !equivalent(a[key], b[key]))
    .map(key => `${prefix}.${key}`);
}

function strings(value: unknown, field: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw usage(`Custom Metro config ${field} must be an array of strings.`);
  }
}

/**
 * Load only the explicitly requested file, through the app's Metro loader.
 * Relative config paths are relative to projectRoot; paths inside the config
 * should follow Metro conventions (use __dirname / require.resolve).
 *
 * Only the projected fields are supported. Other resolver/transformer changes,
 * all serializer changes (including both polyfill hooks), a custom worker, and
 * a changed projectRoot are rejected. Server, reporter, cache and watcher
 * settings are intentionally not imported: the headless caller owns them.
 * The caller must disable persistent bundle/transform/file-map caching because
 * arbitrary config modules and their dependencies are not fingerprinted here.
 */
export async function loadProjectMetroConfig(projectRoot: string, configFile: string): Promise<MetroConfigProjection> {
  const root = path.resolve(projectRoot);
  if (!configFile.trim()) throw usage('An explicit Metro config file is required.');
  const configPath = path.resolve(root, configFile);
  try {
    if (!fs.statSync(configPath).isFile()) throw new Error('not a file');
  } catch {
    throw usage(`Metro config file does not exist or is not a file: ${configPath}`, 'Pass an explicit existing config file relative to the app project root.');
  }

  const appRequire = createRequire(path.join(root, 'package.json'));
  let metro: typeof import('metro-config');
  let expo: {getDefaultConfig: (root: string) => ConfigT};
  try {
    metro = appRequire('metro-config');
    expo = appRequire('expo/metro-config');
  } catch (error) {
    throw usage(`Cannot resolve the app's Metro/Expo configuration dependencies from ${root}: ${error instanceof Error ? error.message : String(error)}`,
      'Install expo and metro-config in the app workspace; CLI dependencies are not substituted.');
  }

  let baseline: ConfigT;
  let loaded: ConfigT;
  try {
    // Metro adds its own defaults before applying the supplied Expo defaults.
    // Normalize the baseline the same way (notably resolver.schemeResolvers).
    baseline = await metro.mergeConfig(await metro.getDefaultConfig(root), expo.getDefaultConfig(root));
    // A second defaults object is essential: function exports may mutate the
    // input config in place, including nested arrays, before returning it.
    const input = expo.getDefaultConfig(root);
    loaded = await metro.loadConfig({cwd: root, config: configPath}, input);
  } catch (error) {
    throw usage(`Cannot load Metro config ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
      'Fix the app Metro configuration; use absolute paths or require.resolve for custom transformers.');
  }

  const unsupported = [
    ...unsupportedFields(baseline.resolver, loaded.resolver, RESOLVER_FIELDS, 'resolver'),
    ...unsupportedFields(baseline.transformer, loaded.transformer, TRANSFORMER_FIELDS, 'transformer'),
    ...unsupportedFields(baseline.serializer, loaded.serializer, [], 'serializer'),
    ...(!equivalent(baseline.transformerPath, loaded.transformerPath) ? ['transformerPath'] : []),
    ...(loaded.projectRoot !== root ? ['projectRoot'] : []),
  ];
  if (unsupported.length) {
    throw usage(`Metro config ${configPath} changes unsupported fields: ${unsupported.join(', ')}.`,
      'Use a dedicated headless config limited to watchFolders, resolver assetExts/sourceExts/nodeModulesPaths/extraNodeModules/resolveRequest, and transformer.babelTransformerPath. Custom workers (including native CSS wrappers), serializer and polyfill hooks need a headless adapter; they cannot be silently omitted. Select the app root with --project-root instead.');
  }

  strings(loaded.watchFolders, 'watchFolders');
  for (const field of ['assetExts', 'sourceExts', 'nodeModulesPaths'] as const) strings(loaded.resolver[field], `resolver.${field}`);
  const extra = loaded.resolver.extraNodeModules;
  if (extra == null || typeof extra !== 'object' || Array.isArray(extra) || Object.values(extra).some(value => typeof value !== 'string')) {
    throw usage('Custom Metro config resolver.extraNodeModules must map package names to paths.');
  }
  if (loaded.resolver.resolveRequest != null && typeof loaded.resolver.resolveRequest !== 'function') {
    throw usage('Custom Metro config resolver.resolveRequest must be a function.');
  }
  if (typeof loaded.transformer.babelTransformerPath !== 'string') {
    throw usage('Custom Metro config transformer.babelTransformerPath must be a module path.');
  }
  return {
    configPath,
    watchFolders: [...loaded.watchFolders],
    resolver: {
      assetExts: [...loaded.resolver.assetExts],
      sourceExts: [...loaded.resolver.sourceExts],
      nodeModulesPaths: [...loaded.resolver.nodeModulesPaths],
      // Metro supports dynamic maps (e.g. Proxy fallback lookups). Spreading
      // them would silently drop non-enumerable/dynamic package mappings.
      extraNodeModules: extra,
      resolveRequest: loaded.resolver.resolveRequest,
    },
    transformer: {babelTransformerPath: loaded.transformer.babelTransformerPath},
  };
}

/**
 * Preserve the clean Expo config object captured by its serializer closure.
 * Apply this BEFORE the caller's mandatory headless resolver/serializer
 * overrides. Do not copy the loaded app serializer onto this trusted base.
 */
export function applyMetroConfigProjection(base: ConfigT, projection: MetroConfigProjection): ConfigT {
  Object.assign(base, {watchFolders: [...projection.watchFolders]});
  Object.assign(base.resolver, projection.resolver);
  Object.assign(base.transformer, projection.transformer);
  return base;
}

/** Parent-facing convenience API: validate fully before mutating the base. */
export async function applyProjectMetroConfig(base: ConfigT, projectRoot: string, configFile: string): Promise<ConfigT> {
  const projection = await loadProjectMetroConfig(projectRoot, configFile);
  return applyMetroConfigProjection(base, projection);
}
