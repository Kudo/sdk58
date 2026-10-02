/** Explicit JS fixtures for named Nitro contracts, not a native Nitro runtime. */
export type NitroFactories = Record<string, () => object>;
export type NitroGlobal = {NitroModulesProxy?: unknown};

export function createNitroFixtureBootstrap(factories: NitroFactories, deps: {
  version: string;
  target: NitroGlobal;
  warn: (message: string) => void;
}): {install(): undefined} {
  const registered = new Map(Object.entries(factories));
  const used = new Set<string>();
  const unsupported = (target: string, reason: string): never => {
    const error = new Error(`[NATIVE_API_UNSUPPORTED] ${target}: ${reason}`);
    deps.warn(error.message);
    throw error;
  };
  const supported = Object.freeze(Object.assign(Object.create(null), {
    version: deps.version,
    hasHybridObject(name: string): boolean {
      return registered.has(name);
    },
    getAllHybridObjectNames(): string[] {
      return [...registered.keys()];
    },
    createHybridObject(name: string): object {
      const factory = registered.get(name);
      if (!factory) return unsupported('NitroModules.createHybridObject', `No application fixture registered for ${String(name)}.`);
      if (!used.has(name)) {
        used.add(name);
        deps.warn(`[APPLICATION_FIXTURE] nitro/${name}: using an application-supplied factory; native Nitro behavior is not verified.`);
      }
      // Factory instances and identity belong to the app. Do not decorate them
      // with HybridObject methods, NativeState, or fake lifecycle behavior.
      const instance = factory();
      if (instance === null || typeof instance !== 'object' || Array.isArray(instance)) {
        throw new Error(`Native fixture nitro/${name} factory must return an object.`);
      }
      return instance;
    },
  }));
  const proxy = new Proxy(supported, {
    get(target, property) {
      if (Object.hasOwn(target, property)) return Reflect.get(target, property);
      // Symbol probes used by inspection are not native API operations.
      if (typeof property === 'symbol') return undefined;
      return unsupported(`NitroModules.${property}`, 'This native Nitro API is not simulated by application fixtures.');
    },
  });
  return {
    install() {
      // Satisfies Nitro's real TurboModule install() bootstrap. No dispatcher,
      // NativeState, memory accounting, or cross-runtime boxing is installed.
      if (deps.target.NitroModulesProxy != null && deps.target.NitroModulesProxy !== proxy) {
        throw new Error('Cannot install Nitro fixtures over an existing NitroModulesProxy.');
      }
      deps.target.NitroModulesProxy = proxy;
      return undefined;
    },
  };
}
