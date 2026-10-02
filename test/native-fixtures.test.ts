import {expect, it} from 'vitest';
import {installNativeFixtures} from '../packages/react-native-a11y-tree/runtime/nativeFixtures.ts';

it('installs explicit fixtures lazily and reports only accessed modules', () => {
  const warnings: string[] = [];
  class NativeModule {addListener() {return {remove() {}};}}
  const expo = {NativeModule, modules: {Existing: {real: true}} as Record<string, any>};
  const turbo = new Map<string, () => object>();
  const instance = {read: () => 'fixture'};
  installNativeFixtures({expoModules: {Existing: instance, Unused: {}}, turboModules: {Storage: instance}}, {
    expo, registerTurbo: (name, factory) => turbo.set(name, factory), warn: message => warnings.push(message),
  });
  expect(warnings).toEqual([]);
  expect(expo.modules.Existing.read()).toBe('fixture');
  expect(expo.modules.Existing).toBeInstanceOf(NativeModule);
  expect(expo.modules.Existing).toBe(expo.modules.Existing);
  expect(turbo.get('Storage')!()).toBe(instance);
  turbo.get('Storage')!();
  expect(warnings).toEqual([
    expect.stringContaining('[APPLICATION_FIXTURE] expo/Existing:'),
    expect.stringContaining('[APPLICATION_FIXTURE] turbo/Storage:'),
  ]);
});

it('rejects invalid fixture definitions before installing anything', () => {
  const expo = {NativeModule: class {}, modules: {}};
  const options = {expo, registerTurbo: () => {throw new Error('should not install');}, warn: () => {}};
  for (const fixture of [undefined, [], {unknown: {}}, {expoModules: {Bad: null}}, {turboModules: {Bad: []}}, {expoModules: {Bad: new Map()}}, {expoModules: {'invalid name': {}}}]) {
    expect(() => installNativeFixtures(fixture, options)).toThrow(/fixture/i);
    expect(Object.keys(expo.modules)).toEqual([]);
  }
  expect(() => installNativeFixtures({expoModules: {A: {}}}, {...options, expo: undefined})).toThrow(/Expo/);
});
