/**
 * JS stand-ins for React Native core TurboModules that the headless host
 * does not provide and that libraries require at import time with
 * `TurboModuleRegistry.getEnforcing` (which throws when a module is missing).
 * A stub is used only when the host returns no module. Must be installed
 * before `react-native/Libraries/TurboModule/TurboModuleRegistry` is first
 * loaded (it captures `global.__turboModuleProxy` once).
 *
 * - StatusBarManager (Android spec): required by
 *   Libraries/Components/StatusBar/StatusBar, which DrawerLayoutAndroid
 *   imports; react-native-gesture-handler imports DrawerLayoutAndroid.
 */

const STUBS = {
  StatusBarManager: () => ({
    getConstants: () => ({HEIGHT: 0}),
    setColor: () => {},
    setTranslucent: () => {},
    setStyle: () => {},
    setHidden: () => {},
  }),
};

let installed = false;

export function installTurboModuleStubs() {
  if (installed) return;
  installed = true;
  const original = global.__turboModuleProxy;
  const cache = new Map();
  global.__turboModuleProxy = name => {
    const module = original != null ? original(name) : null;
    if (module != null) return module;
    const stub = STUBS[name];
    if (stub == null) return null;
    if (!cache.has(name)) cache.set(name, stub());
    return cache.get(name);
  };
}
