import {expect, it, vi} from 'vitest';
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

it('validates all Nitro definitions and version before mutating either registry', () => {
  const invalid = [
    {nitroModules: []}, {nitroModules: {Storage: {}}},
    {nitroModules: {'bad name': () => ({})}}, {nitroModules: undefined},
  ];
  for (const nitro of invalid) {
    const expo = {NativeModule: class {}, modules: {}};
    const registerTurbo = vi.fn();
    expect(() => installNativeFixtures({expoModules: {Good: {}}, turboModules: {Good: {}}, ...nitro},
      {expo, registerTurbo, warn: () => {}, nitroVersion: () => '0.37.1'})).toThrow(/fixture/i);
    expect(expo.modules).toEqual({});
    expect(registerTurbo).not.toHaveBeenCalled();
  }
  for (const nitroVersion of [undefined, () => '', () => 'unknown', () => {throw new Error('package missing');}]) {
    const expo = {NativeModule: class {}, modules: {}};
    const registerTurbo = vi.fn();
    expect(() => installNativeFixtures({expoModules: {Good: {}}, nitroModules: {}},
      {expo, registerTurbo, warn: () => {}, nitroVersion})).toThrow();
    expect(expo.modules).toEqual({});
    expect(registerTurbo).not.toHaveBeenCalled();
  }
});

it('rejects conflicting Nitro bootstrap registrations before any registry mutation', () => {
  const registerTurbo = vi.fn();
  expect(() => installNativeFixtures({turboModules: {NitroModules: {}}, nitroModules: {}},
    {registerTurbo, warn: () => {}, nitroVersion: () => '0.37.1'})).toThrow(/NitroModules/);
  expect(registerTurbo).not.toHaveBeenCalled();
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
