import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import type {ConfigT, InputConfigT} from 'metro-config';

import {usage} from './errors.ts';
import {
  BUNDLE_FILE,
  BYTECODE_FILE,
  type BytecodeMode,
  bundleKey,
  cacheRoot,
  changedInputs,
  compileBytecode,
  compileBytecodeInBackground,
  entryDir,
  writeEntry,
} from './bundleCache.ts';
import type {CustomResolutionContext, Resolution} from 'metro-resolver';

const require = createRequire(import.meta.url);

/**
 * Loads `id` as the project sees it (its Expo, Metro and metro-config, which
 * must be one copy with the project's `expo/metro-config`), else from this
 * package (a repo checkout, or a project without it).
 */
function projectRequire<T>(projectRoot: string, id: string): T {
  let resolved: string;
  try {
    resolved = createRequire(path.join(projectRoot, 'package.json')).resolve(id);
  } catch {
    resolved = require.resolve(id);
  }
  return require(resolved) as T;
}

/** Root of this package (contains `runtime/`). */
export const PACKAGE_ROOT = fs.realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'),
);
export const RUNTIME_DIR = path.join(PACKAGE_ROOT, 'runtime');

/**
 * Out-of-tree platform mode (e.g. `--platform a11ytree`): a platform that
 * react-native itself does not ship files for. react-native has modules that
 * exist only as `.ios.js`/`.android.js` (and `Libraries/Utilities/Platform.js`
 * re-imports `./Platform`, which would resolve to itself), so any file
 * without an explicit `.<platform>.*` variant resolves as this platform
 * instead. Fantom bundles its tests for `android`.
 */
const FALLBACK_PLATFORM = 'android';

export type TapMode = 'touch' | 'click' | 'both';

export type HostConfig = {
  /** getA11yTree includeMountedProps (default true). */
  mounted?: boolean;
  /**
   * NativeFantom.setDeviceMetrics before the app module loads: Dimensions
   * (window and screen) and PixelRatio. Hosts without it keep their defaults.
   */
  deviceMetrics?: {width: number; height: number; scale: number; fontScale: number};
  headerHeight?: number;
  safeAreaInsets?: {top: number; left: number; right: number; bottom: number};
};

export type BundleOptions = {
  /** Path to the user's component file. */
  appPath: string;
  viewportWidth: number;
  viewportHeight: number;
  /** Ask the host for raw debug props on each node (`getA11yTree` only). */
  includeDebugProps?: boolean;
  /** Actions for `run --script` (already validated), or undefined for `render`. */
  script?: unknown[];
  tapMode?: TapMode;
  /** Build a bundle for `session` (host --interactive mode). */
  session?: boolean;
  /** `run` options embedded in the bundle. */
  runOptions?: {diff?: boolean};
  /** Host settings applied before the first render (runtime/hostConfig.ts). */
  hostConfig?: HostConfig;
  /** Metro platform (required): `android`, `ios`, or an out-of-tree name such as `a11ytree`. */
  platform: string;
  /** Output bundle path. Defaults to a file in a new temp dir. */
  out?: string;
  dev?: boolean;
  minify?: boolean;
  /** Print Metro progress to stderr. */
  verbose?: boolean;
  /** Ignore Metro's transform cache and the bundle cache (cold build). */
  resetCache?: boolean;
  /** Use the bundle cache (default true; always off with `out`). */
  cache?: boolean;
  /** Hermes bytecode: auto (use when cached, compile in the background), on, off. */
  bytecode?: BytecodeMode;
};

export type BundleResult = {
  /** File to pass to the host: bytecode (`.hbc`) or JS. */
  bundlePath: string;
  /** The JS bundle (fallback when the host cannot load the bytecode). */
  jsBundlePath: string;
  /** Temp dir to delete after the run (null when nothing to delete). */
  workDir: string | null;
  /** Cache entry dir (null with --out). */
  cacheDir: string | null;
  projectRoot: string;
  sizeBytes: number;
  cache: 'hit' | 'miss' | 'off';
  bytecode: boolean;
};

/** Directory of the nearest `package.json` above `file`, or the file's dir. */
export function findProjectRoot(file: string): string {
  let dir = path.dirname(path.resolve(file));
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.dirname(path.resolve(file));
    }
    dir = parent;
  }
}

export function renderEntry(options: {
  appPath: string;
  viewportWidth: number;
  viewportHeight: number;
  includeDebugProps?: boolean;
  script?: unknown[];
  tapMode?: TapMode;
  session?: boolean;
  hostConfig?: HostConfig;
  runOptions?: {diff?: boolean};
  /** Path of expo-modules-core's `installExpoGlobalPolyfill` module (see expoPolyfillPath), or null. */
  expoPolyfill?: string | null;
}): string {
  const template = fs.readFileSync(
    path.join(RUNTIME_DIR, 'entry-template.ts'),
    'utf8',
  );
  // JSON.stringify(...).slice(1, -1) escapes the path for use inside the
  // single-quoted string literals of the template.
  const quote = (s: string) =>
    JSON.stringify(s).slice(1, -1).replaceAll("'", "\\'");
  return template
    .replaceAll('__RUNTIME_DIR__', quote(RUNTIME_DIR))
    .replaceAll('__APP_PATH__', quote(path.resolve(options.appPath)))
    .replaceAll('__VIEWPORT_WIDTH__', String(options.viewportWidth))
    .replaceAll('__VIEWPORT_HEIGHT__', String(options.viewportHeight))
    .replaceAll(
      '__INCLUDE_DEBUG_PROPS__',
      String(options.includeDebugProps === true),
    )
    .replaceAll('__SCRIPT__', () => JSON.stringify(options.script ?? null))
    .replaceAll('__TAP_MODE__', () => JSON.stringify(options.tapMode ?? 'touch'))
    .replaceAll('__SESSION__', String(options.session === true))
    .replaceAll('__HOST_CONFIG__', () => JSON.stringify(options.hostConfig ?? {}))
    .replaceAll('__RUN_OPTIONS__', () => JSON.stringify(options.runOptions ?? {}))
    .replaceAll('/* __EXPO_PRELUDE__ */', () =>
      options.expoPolyfill != null
        ? `require('${quote(options.expoPolyfill)}').installExpoGlobalPolyfill();\n  ` +
          `require('${quote(path.join(RUNTIME_DIR, 'expo', 'prelude'))}').installExpoPrelude();`
        : '',
    );
}

const EXPO_PACKAGES = ['expo', 'expo-modules-core', '@expo/ui'];

/**
 * The Expo prelude (runtime/expo/prelude.ts) goes into the bundle when the
 * project uses Expo: its package.json lists `expo`, `expo-modules-core` or
 * `@expo/ui`, and expo-modules-core resolves from the project. (Resolving
 * alone is not enough: in a hoisted monorepo every project resolves it.)
 * Returns the path of expo-modules-core's global polyfill module, or null.
 */
export function expoPolyfillPath(projectRoot: string): string | null {
  let pkg: Record<string, Record<string, string> | undefined>;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  const declared = ['dependencies', 'devDependencies', 'peerDependencies'].some(field =>
    EXPO_PACKAGES.some(name => pkg[field]?.[name] != null),
  );
  if (!declared) return null;
  try {
    const coreDir = path.dirname(
      fs.realpathSync(require.resolve('expo-modules-core/package.json', {paths: [projectRoot]})),
    );
    const polyfill = path.join(coreDir, 'src', 'polyfill', 'dangerous-internal.ts');
    return fs.existsSync(polyfill) ? polyfill : null;
  } catch {
    return null;
  }
}

function isInside(file: string, dir: string): boolean {
  const rel = path.relative(dir, file);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function isBareSpecifier(moduleName: string): boolean {
  return (
    !moduleName.startsWith('.') &&
    !path.isAbsolute(moduleName) &&
    !moduleName.includes(':')
  );
}

/**
 * Files of third-party packages replaced by runtime implementations for the
 * headless host, matched on the resolved path (so any import specifier
 * works). react-native-gesture-handler: its native module and native v3
 * detector (see runtime/gh/).
 */
const RESOLVED_ALIASES: Array<[RegExp, string]> = [
  [
    /[\\/]react-native-gesture-handler[\\/]src[\\/]specs[\\/]NativeRNGestureHandlerModule\.ts$/,
    path.join(RUNTIME_DIR, 'gh', 'NativeRNGestureHandlerModule.ts'),
  ],
  [
    /[\\/]react-native-gesture-handler[\\/]src[\\/]v3[\\/]detectors[\\/]HostGestureDetector\.tsx$/,
    path.join(RUNTIME_DIR, 'gh', 'HostGestureDetector.tsx'),
  ],
];

function applyAliases(resolution: Resolution): Resolution {
  if (resolution.type !== 'sourceFile') return resolution;
  for (const [pattern, replacement] of RESOLVED_ALIASES) {
    if (pattern.test(resolution.filePath)) {
      return {type: 'sourceFile', filePath: replacement};
    }
  }
  return resolution;
}

export function createMetroConfig(options: {
  projectRoot: string;
  workDir: string;
  platform: string;
}): ConfigT {
  const {projectRoot, workDir, platform} = options;
  const {getDefaultConfig} = projectRequire<{getDefaultConfig: (projectRoot: string) => ConfigT}>(
    projectRoot,
    'expo/metro-config',
  );
  const {mergeConfig} = projectRequire<typeof import('metro-config')>(projectRoot, 'metro-config');

  const base = getDefaultConfig(projectRoot);
  const upstreamResolveRequest = base.resolver.resolveRequest;
  // Platforms react-native and Expo know (ios, android, tvos, macos) resolve
  // normally; only an out-of-tree platform gets the android fallback.
  const isOutOfTreePlatform = !base.resolver.platforms.includes(platform);

  const resolveForPlatform = (
    context: CustomResolutionContext,
    moduleName: string,
    requestPlatform: string | null,
  ): Resolution => {
    const resolve = upstreamResolveRequest ?? context.resolveRequest;
    if (requestPlatform !== platform || !isOutOfTreePlatform) {
      return resolve(context, moduleName, requestPlatform);
    }
    try {
      const resolution = resolve(context, moduleName, requestPlatform);
      if (
        resolution.type === 'sourceFile' &&
        resolution.filePath.includes(`.${platform}.`)
      ) {
        return resolution;
      }
    } catch {
      // Fall through to the fallback platform.
    }
    return resolve(context, moduleName, FALLBACK_PLATFORM);
  };

  const projectOrigin = path.join(projectRoot, 'package.json');

  const overrides: InputConfigT = {
    projectRoot,
    // Not the whole PACKAGE_ROOT: it contains third_party/react-native.
    watchFolders: [
      ...new Set(
        [
          ...(base.watchFolders ?? []),
          projectRoot,
          RUNTIME_DIR,
          path.join(PACKAGE_ROOT, 'node_modules'),
          workDir,
        ].filter(dir => fs.existsSync(dir)),
      ),
    ],
    reporter: {update: () => {}},
    resolver: {
      platforms: [...new Set([platform, 'native', ...base.resolver.platforms])],
      unstable_conditionsByPlatform: {
        ...base.resolver.unstable_conditionsByPlatform,
        [platform]: ['react-native'],
      },
      nodeModulesPaths: [
        ...new Set([
          ...base.resolver.nodeModulesPaths,
          path.join(projectRoot, 'node_modules'),
          path.join(PACKAGE_ROOT, 'node_modules'),
        ]),
      ],
      // Disable dependency injection for the renderer (same as Fantom).
      blockList: [
        ...(Array.isArray(base.resolver.blockList)
          ? base.resolver.blockList
          : [base.resolver.blockList]),
        /\/RendererProxy\.fb\.js$/,
      ],
      resolveRequest: (context, moduleName, requestPlatform) => {
        // Bare imports from our runtime or the generated entry (react,
        // react-native, flow-enums-runtime, ...) resolve from the user's
        // project first so there is a single copy of react / react-native.
        const origin = context.originModulePath;
        if (
          isBareSpecifier(moduleName) &&
          (isInside(origin, RUNTIME_DIR) || isInside(origin, workDir))
        ) {
          try {
            return applyAliases(
              resolveForPlatform(
                {...context, originModulePath: projectOrigin},
                moduleName,
                requestPlatform,
              ),
            );
          } catch {
            // Fall back to resolving from this package.
          }
        }
        return applyAliases(resolveForPlatform(context, moduleName, requestPlatform));
      },
    },
    transformer: {
      hermesParser: true,
    },
    serializer: {
      // Do not inject InitializeCore (same as Fantom). The entry calls
      // setUpDefaultReactNativeEnvironment instead.
      getModulesRunBeforeMainModule: () => [],
    },
  };

  return mergeConfig(base, overrides);
}

/** Cached bundles with at most this many changed inputs are rebuilt without Metro worker processes. */
const SMALL_EDIT = 8;

/**
 * Files behind the module paths: real files only (not `__prelude__` or
 * `require-<entry>`), and every scale/platform variant of image assets
 * (as Server.getOrderedDependencyPaths lists them).
 */
async function moduleFiles(
  projectRoot: string,
  modulePaths: Set<string>,
  assetExts: readonly string[],
  platform: string,
): Promise<string[]> {
  const {getAssetFiles} = projectRequire<{
    getAssetFiles: (assetPath: string, platform: string | null) => Promise<string[]>;
  }>(projectRoot, 'metro/private/Assets');
  const assetExtSet = new Set(assetExts);
  const files: string[] = [];
  for (const file of modulePaths) {
    if (!path.isAbsolute(file)) continue;
    if (assetExtSet.has(path.extname(file).slice(1))) {
      files.push(...(await getAssetFiles(file, platform)));
    } else {
      files.push(file);
    }
  }
  return files;
}

export async function bundle(options: BundleOptions): Promise<BundleResult> {
  const {platform} = options;
  if (!fs.existsSync(options.appPath)) {
    throw usage(`File not found: ${path.resolve(options.appPath)}`);
  }
  // Metro's file map uses real paths (e.g. /tmp -> /private/tmp on macOS).
  const appPath = fs.realpathSync(options.appPath);
  const projectRoot = findProjectRoot(appPath);
  const dev = options.dev ?? false;
  const minify = options.minify ?? false;
  const bytecodeMode = options.bytecode ?? 'auto';
  const useCache = options.out == null && options.cache !== false;

  const entry = renderEntry({
    appPath,
    viewportWidth: options.viewportWidth,
    viewportHeight: options.viewportHeight,
    includeDebugProps: options.includeDebugProps,
    script: options.script,
    tapMode: options.tapMode,
    session: options.session,
    hostConfig: options.hostConfig,
    runOptions: options.runOptions,
    expoPolyfill: expoPolyfillPath(projectRoot),
  });
  const root = cacheRoot(projectRoot);
  const key = bundleKey({entry, platform, dev, minify, projectRoot});
  const dir = entryDir(root, key);

  const result = (cache: BundleResult['cache'], jsPath: string, workDir: string | null): BundleResult => {
    let bundlePath = jsPath;
    let bytecode = false;
    if (useCache && bytecodeMode !== 'off') {
      const hbc = path.join(dir, BYTECODE_FILE);
      if (!fs.existsSync(hbc) && bytecodeMode === 'on') compileBytecode(dir);
      if (fs.existsSync(hbc)) {
        bundlePath = hbc;
        bytecode = true;
      } else if (bytecodeMode === 'auto') {
        compileBytecodeInBackground(dir);
      }
    }
    return {
      bundlePath,
      jsBundlePath: jsPath,
      workDir,
      cacheDir: useCache ? dir : null,
      projectRoot,
      sizeBytes: fs.statSync(bundlePath).size,
      cache,
      bytecode,
    };
  };

  const changed = useCache && !options.resetCache ? changedInputs(dir, key, SMALL_EDIT + 1) : null;
  if (changed === 0) {
    return result('hit', path.join(dir, BUNDLE_FILE), null);
  }

  // A fixed work dir keeps Metro's roots, and so its file map cache key,
  // the same across runs. Entries are named by their key; the entry is
  // TypeScript (runtime/entry-template.ts), so it has a `.ts` name.
  const workDir = path.join(root, 'work');
  fs.mkdirSync(workDir, {recursive: true});
  const entryPath = path.join(fs.realpathSync(workDir), `${key}.ts`);
  if (!fs.existsSync(entryPath) || fs.readFileSync(entryPath, 'utf8') !== entry) {
    fs.writeFileSync(entryPath, entry);
  }
  const outDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-')));
  const bundlePath = path.resolve(options.out ?? path.join(outDir, 'index.bundle.js'));

  const config = createMetroConfig({projectRoot, workDir: fs.realpathSync(workDir), platform});
  // Persistent Metro caches (transforms, file map) next to the bundle cache.
  const StoreClass = (config.cacheStores[0] as unknown as {constructor: new (o: {root: string}) => unknown})
    .constructor;
  (config as unknown as {cacheStores: unknown[]}).cacheStores = [
    new StoreClass({root: path.join(root, 'metro')}),
  ];
  // Metro ignores write errors of this cache, so the directory must exist.
  const fileMapDir = path.join(root, 'metro-file-map');
  fs.mkdirSync(fileMapDir, {recursive: true});
  (config as {fileMapCacheDirectory?: string}).fileMapCacheDirectory = fileMapDir;
  if (options.resetCache) {
    // Metro reads resetCache from the config: it clears the cache stores
    // before building.
    (config as {resetCache: boolean}).resetCache = true;
  }
  // A small edit of a cached bundle transforms a few files: do that in this
  // process. Starting and stopping Metro's worker processes costs ~85 ms,
  // more than the transforms.
  if (changed != null && changed <= SMALL_EDIT) {
    (config as {maxWorkers: number}).maxWorkers = 1;
  }
  // The module files of the bundle, for the bundle cache: recorded when the
  // serializer filters the modules of the graph it already built
  // (Server.getOrderedDependencyPaths would build the graph again, ~55 ms).
  const modulePaths = new Set<string>();
  const baseFilter = config.serializer.processModuleFilter as (module: {path: string}) => boolean;
  (config.serializer as {processModuleFilter: unknown}).processModuleFilter = (module: {path: string}) => {
    const keep = baseFilter(module);
    if (keep && useCache) modulePaths.add(module.path);
    return keep;
  };
  const Metro = projectRequire<typeof import('metro')>(projectRoot, 'metro');

  const showProgress = options.verbose === true && process.stderr.isTTY;

  // The user's metro.config.js is intentionally not loaded: it could re-add
  // InitializeCore or change platforms.
  await Metro.runBuild(config, {
    entry: entryPath,
    platform,
    dev,
    minify,
    out: bundlePath,
    sourceMap: false,
    onProgress: showProgress
      ? (done, total) => process.stderr.write(`\rMetro: ${done}/${total} files`)
      : undefined,
    onComplete: showProgress ? () => process.stderr.write('\n') : undefined,
  });

  if (!useCache) {
    return result('off', bundlePath, outDir);
  }
  writeEntry({
    root,
    key,
    bundleFile: bundlePath,
    files: await moduleFiles(projectRoot, modulePaths, config.resolver.assetExts, platform),
    excludeDir: fs.realpathSync(workDir),
  });
  fs.rmSync(outDir, {recursive: true, force: true});
  return result('miss', path.join(dir, BUNDLE_FILE), null);
}
