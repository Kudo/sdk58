/** App-owned, explicit native contracts. No invented methods for unknown modules. */
import {createNitroFixtureBootstrap, type NitroFactories, type NitroGlobal} from './nitroFixtures.ts';

export type NativeFixtures = {
  expoModules?: Record<string, Record<string, unknown>>;
  turboModules?: Record<string, Record<string, unknown>>;
  nitroModules?: NitroFactories;
};

type Dependencies = {
  expo?: {NativeModule: new () => object; modules: Record<string, object | undefined>};
  registerTurbo: (name: string, factory: () => object) => void;
  warn: (message: string) => void;
  /** Read the app-resolved Nitro package version without importing Nitro itself. */
  nitroVersion?: () => string;
  /** Override the global target for isolated tests. Defaults to globalThis. */
  nitroGlobal?: NitroGlobal;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function installNativeFixtures(value: unknown, deps: Dependencies): void {
  if (!isRecord(value)) throw new Error('The setup file must default-export a native fixture object {expoModules?, turboModules?, nitroModules?}.');
  // Validate the entire file before mutating either registry.
  for (const [kind, modules] of Object.entries(value)) {
    if (kind !== 'expoModules' && kind !== 'turboModules' && kind !== 'nitroModules') throw new Error(`Unknown native fixture field: ${kind}`);
    if (!isRecord(modules)) throw new Error(`Native fixture ${kind} must be an object of named modules.`);
    for (const [name, implementation] of Object.entries(modules)) {
      const valid = kind === 'nitroModules' ? typeof implementation === 'function' : isRecord(implementation);
      if (!/^[A-Za-z0-9_$.-]+$/.test(name) || !valid) {
        throw new Error(`Native fixture ${kind}.${name} must have a valid module name and ${kind === 'nitroModules' ? 'a factory function' : 'a plain object implementation'}.`);
      }
    }
  }
  const fixtures = value as NativeFixtures;
  if (Object.keys(fixtures.expoModules ?? {}).length && !deps.expo) {
    throw new Error('Expo module fixtures require an Expo project with the Expo runtime initialized.');
  }
  let nitroBootstrap: {install(): undefined} | undefined;
  if (Object.hasOwn(fixtures, 'nitroModules')) {
    if (Object.hasOwn(fixtures.turboModules ?? {}, 'NitroModules')) {
      throw new Error('Native fixtures cannot combine nitroModules with turboModules.NitroModules.');
    }
    if (typeof deps.nitroVersion !== 'function') {
      throw new Error('Native Nitro fixtures require the app-resolved react-native-nitro-modules version.');
    }
    const version = deps.nitroVersion();
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version)) {
      throw new Error('Native Nitro fixtures require a valid react-native-nitro-modules version string.');
    }
    const target = deps.nitroGlobal ?? (globalThis as typeof globalThis & NitroGlobal);
    if (target.NitroModulesProxy != null) {
      throw new Error('Native Nitro fixtures must be registered before NitroModulesProxy is installed.');
    }
    nitroBootstrap = createNitroFixtureBootstrap(fixtures.nitroModules!, {version, target, warn: deps.warn});
  }
  for (const [name, implementation] of Object.entries(fixtures.expoModules ?? {})) {
    const expo = deps.expo!;
    let module: object | undefined;
    Object.defineProperty(expo.modules, name, {configurable: true, enumerable: true, get() {
      if (module === undefined) {
        module = Object.assign(new expo.NativeModule(), implementation);
        deps.warn(`[APPLICATION_FIXTURE] expo/${name}: using an application-supplied module; native behavior is not verified.`);
      }
      return module;
    }});
  }
  for (const [name, implementation] of Object.entries(fixtures.turboModules ?? {})) {
    let used = false;
    deps.registerTurbo(name, () => {
      if (!used) {
        used = true;
        deps.warn(`[APPLICATION_FIXTURE] turbo/${name}: using an application-supplied module; native behavior is not verified.`);
      }
      return implementation;
    });
  }
  if (nitroBootstrap) deps.registerTurbo('NitroModules', () => nitroBootstrap!);
}
