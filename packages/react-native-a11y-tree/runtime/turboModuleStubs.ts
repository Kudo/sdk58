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
  LinkingManager: () => ({
    getInitialURL: async () => null,
    canOpenURL: async () => false,
    openURL: async () => {},
    openSettings: async () => {},
    ...eventEmitterMethods(),
  }),
};

let installed = false;

export function installTurboModuleStubs(): void {
  if (installed) return;
  installed = true;
  const original = global.__turboModuleProxy;
  const cache = new Map<string, object>();
  global.__turboModuleProxy = (name: string) => {
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
