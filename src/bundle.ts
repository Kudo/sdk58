import fs from 'node:fs';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import type {ConfigT, InputConfigT} from 'metro-config';
import type {CustomResolutionContext, Resolution} from 'metro-resolver';

const require = createRequire(import.meta.url);

/** Root of this package (contains `runtime/`). */
export const PACKAGE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
export const RUNTIME_DIR = path.join(PACKAGE_ROOT, 'runtime');

export const DEFAULT_PLATFORM = 'a11ytree';

/**
 * Platform used to resolve `.<platform>.js` files that have no `a11ytree`
 * variant. react-native ships some modules only as `.ios.js`/`.android.js`
 * (e.g. `Libraries/Utilities/Platform.js` just re-imports `./Platform`, which
 * would resolve to itself). Fantom bundles its tests for `android`, so we do
 * the same for anything without an explicit `.a11ytree.*` file.
 */
const FALLBACK_PLATFORM = 'android';

export type BundleOptions = {
  /** Path to the user's component file. */
  appPath: string;
  viewportWidth: number;
  viewportHeight: number;
  platform?: string;
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
    .replaceAll('__VIEWPORT_HEIGHT__', String(options.viewportHeight));
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

  const resolveForPlatform = (
    context: CustomResolutionContext,
    moduleName: string,
    requestPlatform: string | null,
  ): Resolution => {
    const resolve = upstreamResolveRequest ?? context.resolveRequest;
    if (requestPlatform !== platform || platform === FALLBACK_PLATFORM) {
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
    watchFolders: [
      ...new Set([...(base.watchFolders ?? []), PACKAGE_ROOT, workDir]),
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
            return resolveForPlatform(
              {...context, originModulePath: projectOrigin},
              moduleName,
              requestPlatform,
            );
          } catch {
            // Fall back to resolving from this package.
          }
        }
        return resolveForPlatform(context, moduleName, requestPlatform);
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
  const platform = options.platform ?? DEFAULT_PLATFORM;
  const appPath = path.resolve(options.appPath);
  if (!fs.existsSync(appPath)) {
    throw new Error(`File not found: ${appPath}`);
  }
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
