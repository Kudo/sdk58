/** App-owned, explicit native contracts. No invented methods for unknown modules. */
export type NativeFixtures = {
  expoModules?: Record<string, Record<string, unknown>>;
  turboModules?: Record<string, Record<string, unknown>>;
};

type Dependencies = {
  expo?: {NativeModule: new () => object; modules: Record<string, object | undefined>};
  registerTurbo: (name: string, factory: () => object) => void;
  warn: (message: string) => void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function installNativeFixtures(value: unknown, deps: Dependencies): void {
  if (!isRecord(value)) throw new Error('The setup file must default-export a native fixture object {expoModules?, turboModules?}.');
  // Validate the entire file before mutating either registry.
  for (const [kind, modules] of Object.entries(value)) {
    if (kind !== 'expoModules' && kind !== 'turboModules') throw new Error(`Unknown native fixture field: ${kind}`);
    if (!isRecord(modules)) throw new Error(`Native fixture ${kind} must be an object of named modules.`);
    for (const [name, implementation] of Object.entries(modules)) {
      if (!/^[A-Za-z0-9_$.-]+$/.test(name) || !isRecord(implementation)) {
        throw new Error(`Native fixture ${kind}.${name} must have a valid module name and a plain object implementation.`);
      }
    }
  }
  const fixtures = value as NativeFixtures;
  if (Object.keys(fixtures.expoModules ?? {}).length && !deps.expo) {
    throw new Error('Expo module fixtures require an Expo project with the Expo runtime initialized.');
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
}
