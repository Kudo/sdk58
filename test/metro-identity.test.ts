import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {afterEach, expect, it} from 'vitest';
import {resolve as metroResolve, FailedToResolveNameError, type CustomResolutionContext} from 'metro-resolver';
import {createMetroConfig, RUNTIME_DIR} from '../packages/react-native-a11y-tree/src/bundle.ts';

const require = createRequire(import.meta.url);
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true}); });

function isolatedApp() {
  // Outside the repository: its hoisted React must not be an app dependency.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'metro-identity-')));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"app-without-react","private":true}');
  fs.mkdirSync(path.join(root, 'node_modules'));
  for (const name of ['expo', 'react-native']) {
    fs.symlinkSync(path.dirname(require.resolve(`${name}/package.json`)), path.join(root, 'node_modules', name), process.platform === 'win32' ? 'junction' : 'dir');
  }
  const workDir = path.join(root, '.entry');
  fs.mkdirSync(workDir);
  return {root, workDir};
}

it.each(['react', 'react/jsx-runtime'])('does not substitute the tool copy when the app lacks %s', specifier => {
  const {root, workDir} = isolatedApp();
  expect(() => createRequire(path.join(root, 'package.json')).resolve(specifier)).toThrow();
  const toolCopy = fs.realpathSync(require.resolve(specifier));
  const config = createMetroConfig({projectRoot: root, workDir, platform: 'android'});

  // Use the installed Metro resolver against real files. These callbacks only
  // supply its filesystem interface; resolution/search order is not mocked.
  const context: CustomResolutionContext = {
    allowHaste: false,
    assetExts: new Set(config.resolver.assetExts),
    customResolverOptions: {},
    disableHierarchicalLookup: false,
    dev: false,
    doesFileExist: file => { try { return fs.statSync(file).isFile(); } catch { return false; } },
    fileSystemLookup: file => {
      try {
        const stat = fs.statSync(file);
        return {exists: true, type: stat.isDirectory() ? 'd' : 'f', realPath: fs.realpathSync(file)};
      } catch { return {exists: false}; }
    },
    getPackage: file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } },
    // No browser remapping or package self-reference is needed for this fixture.
    getPackageForModule: () => null,
    extraNodeModules: config.resolver.extraNodeModules,
    mainFields: config.resolver.resolverMainFields,
    originModulePath: path.join(RUNTIME_DIR, 'entry-template.ts'),
    nodeModulesPaths: config.resolver.nodeModulesPaths,
    preferNativePlatform: true,
    redirectModulePath: file => file,
    resolveAsset: () => null,
    resolveHasteModule: () => null,
    resolveHastePackage: () => null,
    resolveRequest: metroResolve,
    sourceExts: config.resolver.sourceExts,
    unstable_conditionNames: config.resolver.unstable_conditionNames,
    unstable_conditionsByPlatform: config.resolver.unstable_conditionsByPlatform,
    unstable_enablePackageExports: config.resolver.unstable_enablePackageExports,
    unstable_incrementalResolution: false,
    unstable_logWarning: () => {},
  };
  const resolveHeadless = config.resolver.resolveRequest!;
  expect(() => resolveHeadless(context, specifier, 'android')).toThrow(FailedToResolveNameError);

  // Counterfactual: restore the pre-fix search paths only at the delegation
  // boundary. No production files are edited. The same actual resolver now
  // silently selects the CLI's React, proving the assertion above catches the
  // missing-app-dependency regression, not an unrelated resolution failure.
  const oldContext: CustomResolutionContext = {
    ...context,
    resolveRequest: (appContext, name, platform) => metroResolve({
      ...appContext,
      nodeModulesPaths: config.resolver.nodeModulesPaths,
      resolveRequest: metroResolve,
    }, name, platform),
  };
  expect(resolveHeadless(oldContext, specifier, 'android')).toEqual({type: 'sourceFile', filePath: toolCopy});
});
