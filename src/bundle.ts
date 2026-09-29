import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import type {ConfigT, InputConfigT} from 'metro-config';
import type {CustomResolutionContext, Resolution} from 'metro-resolver';

const require = createRequire(import.meta.url);

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
  /** Host settings applied before the first render (runtime/hostConfig.js). */
  hostConfig?: HostConfig;
  /** Metro platform (required): `android`, `ios`, or an out-of-tree name such as `a11ytree`. */
  platform: string;
  /** Output bundle path. Defaults to a file in a new temp dir. */
  out?: string;
  dev?: boolean;
  minify?: boolean;
  /** Print Metro progress to stderr. */
  verbose?: boolean;
};

export type BundleResult = {
  bundlePath: string;
  /** Temp dir holding the generated entry (and the bundle, if `out` was not set). */
  workDir: string;
  projectRoot: string;
  sizeBytes: number;
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
}): string {
  const template = fs.readFileSync(
    path.join(RUNTIME_DIR, 'entry-template.js'),
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
    .replaceAll('__HOST_CONFIG__', () => JSON.stringify(options.hostConfig ?? {}));
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
    path.join(RUNTIME_DIR, 'gh', 'NativeRNGestureHandlerModule.js'),
  ],
  [
    /[\\/]react-native-gesture-handler[\\/]src[\\/]v3[\\/]detectors[\\/]HostGestureDetector\.tsx$/,
    path.join(RUNTIME_DIR, 'gh', 'HostGestureDetector.js'),
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
  const {getDefaultConfig} = require('expo/metro-config') as {
    getDefaultConfig: (projectRoot: string) => ConfigT;
  };
  const {mergeConfig} = require('metro-config') as typeof import('metro-config');

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

export async function bundle(options: BundleOptions): Promise<BundleResult> {
  const {platform} = options;
  if (!fs.existsSync(options.appPath)) {
    throw new Error(`File not found: ${path.resolve(options.appPath)}`);
  }
  // Metro's file map uses real paths (e.g. /tmp -> /private/tmp on macOS).
  const appPath = fs.realpathSync(options.appPath);
  const projectRoot = findProjectRoot(appPath);

  const workDir = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'rn-a11y-tree-')),
  );
  const entryPath = path.join(workDir, 'index.js');
  fs.writeFileSync(
    entryPath,
    renderEntry({
      appPath,
      viewportWidth: options.viewportWidth,
      viewportHeight: options.viewportHeight,
      includeDebugProps: options.includeDebugProps,
      script: options.script,
      tapMode: options.tapMode,
      session: options.session,
      hostConfig: options.hostConfig,
    }),
  );
  const bundlePath = path.resolve(
    options.out ?? path.join(workDir, 'index.bundle.js'),
  );

  const config = createMetroConfig({projectRoot, workDir, platform});
  const Metro = require('metro') as typeof import('metro');

  const showProgress = options.verbose === true && process.stderr.isTTY;

  // The user's metro.config.js is intentionally not loaded: it could re-add
  // InitializeCore or change platforms.
  await Metro.runBuild(config, {
    entry: entryPath,
    platform,
    dev: options.dev ?? false,
    minify: options.minify ?? false,
    out: bundlePath,
    sourceMap: false,
    onProgress: showProgress
      ? (done, total) => process.stderr.write(`\rMetro: ${done}/${total} files`)
      : undefined,
    onComplete: showProgress ? () => process.stderr.write('\n') : undefined,
  });

  return {
    bundlePath,
    workDir,
    projectRoot,
    sizeBytes: fs.statSync(bundlePath).size,
  };
}
