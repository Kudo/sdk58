import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {afterEach, describe, expect, it} from 'vitest';
import {applyMetroConfigProjection, applyProjectMetroConfig, loadProjectMetroConfig} from '../packages/react-native-a11y-tree/src/metroConfig.ts';

const require = createRequire(import.meta.url);
const roots: string[] = [];
function project(config: string, dependencies = true) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'a11y-metro-config-')));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({name: 'fixture', private: true}));
  if (dependencies) fs.symlinkSync(path.resolve(import.meta.dirname, '../node_modules'), path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.writeFileSync(path.join(root, 'metro.custom.cjs'), config);
  return root;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, {recursive: true, force: true}); });
const defaults = "const {getDefaultConfig} = require('expo/metro-config'); const config = getDefaultConfig(__dirname);";

describe('opt-in Metro configuration', () => {
  it('loads a real CJS transformer and projects only allowed app configuration', async () => {
    const root = project(`${defaults}
      config.resolver.assetExts = config.resolver.assetExts.filter(ext => ext !== 'svg');
      config.resolver.sourceExts.push('svg');
      config.watchFolders.push(require('node:path').join(__dirname, 'shared'));
      config.resolver.nodeModulesPaths.push(require('node:path').join(__dirname, 'vendor'));
      config.resolver.extraNodeModules = {'shared': require('node:path').join(__dirname, 'shared')};
      config.resolver.resolveRequest = (ctx, name, platform) => name === 'virtual' ? {type: 'sourceFile', filePath: require('node:path').join(__dirname, 'shared/index.js')} : ctx.resolveRequest(ctx, name, platform);
      config.transformer.babelTransformerPath = require.resolve('./svg-transformer.cjs');
      module.exports = config;
    `);
    fs.mkdirSync(path.join(root, 'shared'));
    fs.mkdirSync(path.join(root, 'vendor'));
    fs.writeFileSync(path.join(root, 'svg-transformer.cjs'), `
      const upstream = require('@expo/metro-config/babel-transformer');
      exports.transform = (args) => upstream.transform({...args, src: args.filename.endsWith('.svg') ? 'export default function Logo() { return null; }' : args.src});
    `);
    const projection = await loadProjectMetroConfig(root, 'metro.custom.cjs');
    expect(projection.configPath).toBe(path.join(root, 'metro.custom.cjs'));
    expect(projection.resolver.assetExts).not.toContain('svg');
    expect(projection.resolver.sourceExts).toContain('svg');
    expect(projection.watchFolders).toContain(path.join(root, 'shared'));
    expect(projection.resolver.nodeModulesPaths).toContain(path.join(root, 'vendor'));
    expect(projection.resolver.extraNodeModules).toEqual({shared: path.join(root, 'shared')});
    expect(projection.resolver.resolveRequest!({} as never, 'virtual', 'android')).toEqual({type: 'sourceFile', filePath: path.join(root, 'shared/index.js')});
    const transformer = require(projection.transformer.babelTransformerPath!);
    const transformed = await transformer.transform({filename: path.join(root, 'logo.svg'), src: '<svg />', plugins: [], options: {projectRoot: root, platform: 'android', dev: false, hot: false, inlineRequires: false, enableBabelRCLookup: true}});
    expect(transformed.ast).toBeTruthy();
    expect(JSON.stringify(transformed.ast)).toContain('"name":"Logo"');
    const {getDefaultConfig} = require('expo/metro-config');
    const base = getDefaultConfig(root);
    const serializer = base.serializer;
    const customSerializer = serializer.customSerializer;
    const applied = applyMetroConfigProjection(base, projection);
    expect(applied).toBe(base);
    expect(applied.serializer).toBe(serializer);
    expect(applied.serializer.customSerializer).toBe(customSerializer);
    expect(applied.transformer.babelTransformerPath).toBe(projection.transformer.babelTransformerPath);
    expect(applied.resolver.sourceExts).toContain('svg');
    expect(applied).not.toHaveProperty('configPath');
  });

  it('applies through the parent API without replacing the captured base or mutating it on rejection', async () => {
    const root = project("module.exports = config => {config.resolver.sourceExts.push('custom'); return config;};");
    const base = require('expo/metro-config').getDefaultConfig(root);
    const originalSerializer = base.serializer;
    const originalResolver = base.resolver;
    await expect(applyProjectMetroConfig(base, root, 'metro.custom.cjs')).resolves.toBe(base);
    expect(base.serializer).toBe(originalSerializer);
    expect(base.resolver).toBe(originalResolver);
    expect(base.resolver.sourceExts).toContain('custom');
    const before = [...base.resolver.sourceExts];
    fs.writeFileSync(path.join(root, 'bad.cjs'), "module.exports = config => {config.resolver.sourceExts.push('bad'); config.serializer.getPolyfills = () => ['bad']; return config;};");
    await expect(applyProjectMetroConfig(base, root, 'bad.cjs')).rejects.toMatchObject({code: 'USAGE'});
    expect(base.resolver.sourceExts).toEqual(before);
    expect(base.serializer).toBe(originalSerializer);
  });
  it('preserves dynamic dependency maps rather than dropping their proxy lookups', async () => {
    const root = project("module.exports = {resolver: {extraNodeModules: new Proxy({}, {get: (_, name) => require('node:path').join(__dirname, 'vendor', name)})}};");
    const projection = await loadProjectMetroConfig(root, 'metro.custom.cjs');
    expect(projection.resolver.extraNodeModules['dynamic-package']).toBe(path.join(root, 'vendor/dynamic-package'));
  });
  it.each([
    ["config.resolver.sourceExts = 'js'", 'resolver.sourceExts'],
    ["config.resolver.extraNodeModules = {broken: 42}", 'resolver.extraNodeModules'],
    ["config.resolver.resolveRequest = 'not-a-function'", 'resolver.resolveRequest'],
  ])('validates supported values: %s', async (edit, field) => {
    const root = project(`${defaults} ${edit}; module.exports = config;`);
    await expect(loadProjectMetroConfig(root, 'metro.custom.cjs')).rejects.toMatchObject({code: 'USAGE', message: expect.stringContaining(field)});
  });
  it('accepts independently created Expo default closures', async () => {
    const root = project(`${defaults} module.exports = config;`);
    await expect(loadProjectMetroConfig(root, 'metro.custom.cjs')).resolves.toHaveProperty('resolver');
  });
  it('supports async function exports and detects in-place mutations of their baseline input', async () => {
    const root = project("module.exports = async config => {config.resolver.sourceExts.push('custom'); return config;};");
    expect((await loadProjectMetroConfig(root, 'metro.custom.cjs')).resolver.sourceExts).toContain('custom');
    const bad = project("module.exports = async config => {config.serializer.polyfillModuleNames.push('/untrusted-startup.js'); return config;};");
    await expect(loadProjectMetroConfig(bad, 'metro.custom.cjs')).rejects.toMatchObject({code: 'USAGE', message: expect.stringContaining('serializer.polyfillModuleNames')});
  });
  it('supports promised object exports', async () => {
    const root = project("module.exports = Promise.resolve({resolver: {sourceExts: ['js', 'ts', 'tsx', 'custom']}});");
    expect((await loadProjectMetroConfig(root, 'metro.custom.cjs')).resolver.sourceExts).toContain('custom');
  });
  it.each([
    ["config.transformerPath = __filename", 'transformerPath'],
    ["config.transformer.expo_customTransformerPath = __filename", 'transformer.expo_customTransformerPath'],
    ["config.transformer.hermesParser = !config.transformer.hermesParser", 'transformer.hermesParser'],
    ["config.serializer.customSerializer = () => 'bad bundle'", 'serializer.customSerializer'],
    ["config.serializer.getModulesRunBeforeMainModule = () => ['bad-prelude']", 'serializer.getModulesRunBeforeMainModule'],
    ["config.serializer.getPolyfills = () => ['bad-polyfill']", 'serializer.getPolyfills'],
    ["config.serializer.polyfillModuleNames.push('bad-polyfill')", 'serializer.polyfillModuleNames'],
    ["config.resolver.platforms.push('custom')", 'resolver.platforms'],
  ])('rejects unsupported change %s', async (edit, field) => {
    const root = project(`${defaults} ${edit}; module.exports = config;`);
    await expect(loadProjectMetroConfig(root, 'metro.custom.cjs')).rejects.toMatchObject({code: 'USAGE', message: expect.stringContaining(field), hint: expect.stringMatching(/headless/i)});
  });
  it('requires the explicit file and never falls back to discovery', async () => {
    const root = project("throw new Error('must not discover this');");
    await expect(loadProjectMetroConfig(root, 'missing.cjs')).rejects.toMatchObject({code: 'USAGE', message: expect.stringContaining('missing.cjs')});
    await expect(loadProjectMetroConfig(root, '')).rejects.toMatchObject({code: 'USAGE'});
  });
  it('requires app-resolved Expo and Metro instead of substituting CLI dependencies', async () => {
    const root = project('module.exports = {};', false);
    await expect(loadProjectMetroConfig(root, 'metro.custom.cjs')).rejects.toMatchObject({code: 'USAGE', message: expect.stringMatching(/resolve.*(expo|metro)/i)});
  });
  it('reports config execution failures as actionable usage errors', async () => {
    const root = project("throw new Error('broken app configuration');");
    await expect(loadProjectMetroConfig(root, 'metro.custom.cjs')).rejects.toMatchObject({code: 'USAGE', message: expect.stringContaining('broken app configuration')});
  });
});
