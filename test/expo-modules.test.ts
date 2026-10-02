import {expect, it} from 'vitest';
import {scanNativeModules, mergeNativeModules} from '../scripts/expo-module-inventory.ts';

it('records required/optional modules, aliases, namespaces and direct API usage', () => {
  const calls = scanNativeModules('packages/demo/src/Module.ios.ts', `
    import {requireNativeModule as native, requireOptionalNativeModule} from 'expo';
    import * as Core from 'expo-modules-core';
    import codegen from 'react-native/Libraries/Utilities/codegenNativeComponent';
    codegen('NotAModule');
    const NAME = 'Demo';
    const api = native(NAME);
    api.loadAsync('x'); api.Image; api['prefetch']();
    export default requireOptionalNativeModule('Optional');
    Core.requireNativeModule('Other');
    // requireNativeModule('Ignore')
  `);
  expect(calls.map(c => [c.module, c.optional])).toEqual([['Demo', false], ['Optional', true], ['Other', false]]);
  expect(calls[0].members).toEqual(['Image', 'loadAsync', 'prefetch']);
  expect(calls[0].platforms).toEqual(['ios']);
});

it('retains dynamic expressions, expands factories, and ignores unrelated imports', () => {
  const calls = scanNativeModules('packages/demo/src/Module.ts', `
    import {requireNativeModule} from 'expo-modules-core';
    import {requireNativeModule as other} from './other';
    function create(name) { return requireNativeModule(name); }
    create('One'); create('Two');
    const unresolved = () => requireNativeModule(dynamicName);
    other('Ignored');
  `);
  expect(calls.map(c => c.module)).toEqual(['One', 'Two', null]);
  expect(calls[2].expression).toContain('dynamicName');
});

it('merges platforms without losing required versus optional call sites', () => {
  const calls = [
    ...scanNativeModules('packages/demo/src/Module.ios.ts', `import {requireNativeModule} from 'expo'; export default requireNativeModule('Demo');`),
    ...scanNativeModules('packages/demo/src/Module.android.ts', `import {requireOptionalNativeModule} from 'expo'; export default requireOptionalNativeModule('Demo');`),
  ].map(c => ({...c, package: 'demo'}));
  const entries = mergeNativeModules(calls);
  expect(entries).toHaveLength(1);
  expect(entries[0].platforms).toEqual(['android', 'ios']);
  expect(entries[0].callSites.map(c => c.optional)).toEqual([false, true]);
});

it('includes core-internal module imports without treating arbitrary relative imports as Expo', () => {
  const calls = scanNativeModules('packages/expo-modules-core/src/sweet/NativeJSLogger.ts', `
    import {requireOptionalNativeModule} from '../requireNativeModule';
    export default requireOptionalNativeModule('ExpoModulesCoreJSLogger');
  `);
  expect(calls[0]).toMatchObject({module: 'ExpoModulesCoreJSLogger', optional: true});
});

it('does not confuse separate module bindings on the same line', () => {
  const calls = scanNativeModules('packages/demo/src/Module.ts', `
    import {requireNativeModule} from 'expo';
    const a = requireNativeModule('A'); const b = requireNativeModule('B'); a.first(); b.second();
  `);
  expect(calls.map(c => c.members)).toEqual([['first'], ['second']]);
});
