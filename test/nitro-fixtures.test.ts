import {expect, it, vi} from 'vitest';
import {installNativeFixtures} from '../packages/react-native-a11y-tree/runtime/nativeFixtures.ts';
import {collectDiagnostics, fidelityError} from '../packages/react-native-a11y-tree/src/diagnostics.ts';

function harness() {
  const target: {NitroModulesProxy?: any} = {};
  const turbo = new Map<string, () => object>();
  const warn = vi.fn();
  const nitroVersion = vi.fn(() => '0.37.1');
  const deps = {nitroGlobal: target, nitroVersion, warn,
    registerTurbo: (name: string, factory: () => object) => turbo.set(name, factory)};
  const boot = () => {
    const native = turbo.get('NitroModules')!() as {install(): undefined};
    expect(native.install()).toBeUndefined();
    return target.NitroModulesProxy;
  };
  return {target, turbo, warn, nitroVersion, deps, boot};
}

it('does not resolve Nitro or mutate its global without explicit opt-in', () => {
  const h = harness();
  installNativeFixtures({turboModules: {Other: {}}}, h.deps);
  expect(h.nitroVersion).not.toHaveBeenCalled();
  expect(h.turbo.has('NitroModules')).toBe(false);
  expect(h.target).toEqual({});
});

it('bootstraps through the real TurboModule contract, lazily invokes factories and reports once', () => {
  const h = harness();
  const factory = vi.fn(() => ({read: () => 'value'}));
  installNativeFixtures({nitroModules: {Storage: factory, Unused: () => ({})}}, h.deps);
  expect(h.nitroVersion).toHaveBeenCalledTimes(1);
  expect(h.target).toEqual({});
  expect(factory).not.toHaveBeenCalled();
  expect(h.warn).not.toHaveBeenCalled();
  const proxy = h.boot();
  expect(h.boot()).toBe(proxy);
  expect(proxy.version).toBe('0.37.1');
  expect(proxy.hasHybridObject('Storage')).toBe(true);
  expect(proxy.hasHybridObject('Missing')).toBe(false);
  expect(proxy.getAllHybridObjectNames()).toEqual(['Storage', 'Unused']);
  expect(h.warn).not.toHaveBeenCalled();
  const first = proxy.createHybridObject('Storage');
  expect(first.read()).toBe('value');
  expect(proxy.createHybridObject('Storage')).not.toBe(first);
  expect(factory).toHaveBeenCalledTimes(2);
  expect(h.warn).toHaveBeenCalledTimes(1);
  expect(h.warn.mock.calls[0][0]).toContain('[APPLICATION_FIXTURE] nitro/Storage:');
});

it('rejects unknown objects and unsupported native/runtime operations with diagnostics', () => {
  const h = harness();
  installNativeFixtures({nitroModules: {}}, h.deps);
  const proxy = h.boot();
  expect(() => proxy.createHybridObject('Missing')).toThrow('NATIVE_API_UNSUPPORTED');
  expect(() => proxy.createHybridObject('toString')).toThrow('NATIVE_API_UNSUPPORTED');
  for (const method of ['box', 'hasNativeState', 'isHybridObject', 'createNativeArrayBuffer', 'madeUpMethod']) {
    expect(() => proxy[method]({})).toThrow('NATIVE_API_UNSUPPORTED');
    expect(h.warn.mock.lastCall?.[0]).toContain(`NitroModules.${method}`);
  }
  expect(h.target).not.toHaveProperty('__nitroDispatcher');
  expect(h.target).not.toHaveProperty('__nitroJsiCache');
});

it('does not add native methods/state or swallow application factory errors', () => {
  const h = harness();
  const failure = new Error('fixture failure');
  const instance = {value: 42};
  installNativeFixtures({nitroModules: {Plain: () => instance, Broken: () => {throw failure;}}}, h.deps);
  const proxy = h.boot();
  expect(proxy.createHybridObject('Plain')).toBe(instance);
  expect(Object.keys(instance)).toEqual(['value']);
  expect(() => proxy.createHybridObject('Broken')).toThrow(failure);
});

it('rejects strict policy for boxing even when optional Nitro worklets setup catches the exception', () => {
  const h = harness();
  installNativeFixtures({nitroModules: {Storage: () => ({})}}, h.deps);
  const proxy = h.boot();
  proxy.createHybridObject('Storage');
  // Nitro's index.ts calls installWorkletsSupport(), which catches box errors.
  try { proxy.box(proxy); } catch {}
  const diagnostics = collectDiagnostics(h.warn.mock.calls.map(([message]) => ({level: 'warn', message})));
  expect(diagnostics).toContainEqual(expect.objectContaining({code: 'NATIVE_API_UNSUPPORTED', target: 'NitroModules.box'}));
  expect(fidelityError(diagnostics, {failOnFallback: true, allowFallback: ['nitro/Storage', 'NitroModules.box']}))
    .toMatchObject({code: 'UNSUPPORTED_NATIVE'});
});

it('does not replace an existing global proxy during fixture registration', () => {
  const h = harness();
  const existing = {version: '0.37.1'};
  h.target.NitroModulesProxy = existing;
  expect(() => installNativeFixtures({nitroModules: {}}, h.deps)).toThrow(/before NitroModulesProxy/);
  expect(h.turbo.size).toBe(0);
  expect(h.target.NitroModulesProxy).toBe(existing);
});

it('rejects a proxy installed between registration and bootstrap without replacing it or invoking factories', () => {
  const h = harness();
  const factory = vi.fn(() => ({}));
  installNativeFixtures({nitroModules: {Storage: factory}}, h.deps);
  const existing = {version: '0.37.1'};
  h.target.NitroModulesProxy = existing;
  expect(() => h.boot()).toThrow(/existing NitroModulesProxy/);
  expect(h.target.NitroModulesProxy).toBe(existing);
  expect(factory).not.toHaveBeenCalled();
  expect(h.warn).not.toHaveBeenCalled();
});

it.each([null, undefined, 7, 'bad', [], () => {}])('rejects an invalid factory result (%s) instead of passing it off as an object', result => {
  const h = harness();
  installNativeFixtures({nitroModules: {Bad: () => result}}, h.deps);
  expect(() => h.boot().createHybridObject('Bad')).toThrow(/factory.*object/i);
});

it('snapshots registrations before app code can change the setup object', () => {
  const h = harness();
  const modules = {Storage: () => ({value: 'original'})};
  installNativeFixtures({nitroModules: modules}, h.deps);
  modules.Storage = () => ({value: 'changed'});
  expect(h.boot().createHybridObject('Storage').value).toBe('original');
});
