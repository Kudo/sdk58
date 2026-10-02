/**
 * JS stand-ins for React Native core TurboModules that the headless host
 * does not provide and that libraries require at import time with
 * `TurboModuleRegistry.getEnforcing` (which throws when a module is missing).
 * A stub is used only when the host returns no module. Must be installed
 * before `react-native/Libraries/TurboModule/TurboModuleRegistry` is first
 * loaded (it captures `global.__turboModuleProxy` once).
 *
 * - StatusBarManager (Android and iOS spec): required by
 *   Libraries/Components/StatusBar/StatusBar, which DrawerLayoutAndroid
 *   imports; react-native-gesture-handler imports DrawerLayoutAndroid.
 * - iOS-only modules that react-native uses at import time with
 *   `Platform.OS === 'ios'` (bundles for `--platform ios`):
 *   KeyboardObserver (Keyboard: `new NativeEventEmitter(...)` needs it),
 *   LinkingManager (Linking: nullthrows; React Navigation imports Linking).
 */

const eventEmitterMethods = () => ({addListener: () => {}, removeListeners: () => {}});

const STUBS: Record<string, (() => object) | undefined> = {
  StatusBarManager: () => ({
    getConstants: () => ({HEIGHT: 0, DEFAULT_BACKGROUND_COLOR: 0}),
    setColor: () => {},
    setTranslucent: () => {},
    setStyle: () => {},
    setHidden: () => {},
    // iOS spec
    getHeight: (callback: (result: {height: number}) => void) => callback({height: 0}),
    setNetworkActivityIndicatorVisible: () => {},
    ...eventEmitterMethods(),
  }),
  KeyboardObserver: () => eventEmitterMethods(),
  LinkingManager: () => {
    const reported = new Set<string>();
    const unsupported = async (method: string): Promise<never> => {
      const message = `[NATIVE_API_UNSUPPORTED] LinkingManager.${method} is not simulated by react-native-a11y-tree. Provide an explicit application fixture to exercise this native operation.`;
      if (!reported.has(method)) {
        reported.add(method);
        console.warn(message);
      }
      throw new Error(message);
    };
    return {
      getInitialURL: async () => null,
      canOpenURL: async () => unsupported('canOpenURL'),
      openURL: async () => unsupported('openURL'),
      openSettings: async () => unsupported('openSettings'),
      ...eventEmitterMethods(),
    };
  },
};

// The installed proxy closes over this registry, so setup can add fixtures after
// RN captures the proxy but before the app imports its native dependencies.
const fixtures = new Map<string, () => object>();
export function registerTurboModuleFixture(name: string, factory: () => object): void {
  fixtures.set(name, factory);
}

let installed = false;

export function installTurboModuleStubs(): void {
  if (installed) return;
  installed = true;
  const turboGlobal = global as unknown as {__turboModuleProxy?: (name: string) => object | null | undefined};
  const original = turboGlobal.__turboModuleProxy;
  const cache = new Map<string, object>();
  turboGlobal.__turboModuleProxy = (name: string) => {
    const fixture = fixtures.get(name);
    if (fixture) return fixture();
    const module = original != null ? original(name) : null;
    if (module != null) return module;
    const stub = STUBS[name];
    if (stub == null) return null;
    if (!cache.has(name)) {
      cache.set(name, stub());
      console.warn(`[NATIVE_MODULE_FALLBACK] ${name}: core module stub; native effects and events are not simulated.`);
    }
    return cache.get(name);
  };
}
