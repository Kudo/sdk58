/**
 * Expo module support in the host (`@expo/ui`, `expo-modules-core`), after
 * native/tests/fantomExpoUIPrelude.js. The entry calls this after Expo's
 * `installExpoGlobalPolyfill()` (the web `globalThis.expo`) and before the
 * app module loads. `src/bundle.ts` adds both only when the project uses
 * Expo (see `expoPrelude()`).
 *
 * - `globalThis.expo.getViewConfig(module, view)`: the view config of
 *   `ViewManagerAdapter_<module>_<view>` from viewConfigs.json (iOS and
 *   Android merged; scripts/gen-expo-view-configs.mjs), else the union of
 *   all @expo/ui prop and event names.
 * - Native module stubs read at import time: ExpoUI, ExpoAsset,
 *   ExponentConstants / ExpoConstants.
 *
 * Not needed here: the Fantom tests' `NativeSourceCode.getConstants`
 * override (`scriptURL: null`). Only development bundles (`__DEV__`) open
 * the dev-server socket from `scriptURL`; `--dev` bundles of Expo apps may
 * need it.
 */

function toViewConfig(entry) {
  const validAttributes = {};
  for (const name of entry.attributes) validAttributes[name] = true;
  const directEventTypes = {};
  for (const name of entry.events) {
    directEventTypes['top' + name.slice(2)] = {registrationName: name};
  }
  return {validAttributes, directEventTypes};
}

export function installExpoPrelude() {
  const expo = globalThis.expo;
  if (expo == null) {
    throw new Error('rn-a11y-tree: globalThis.expo is not installed (installExpoGlobalPolyfill)');
  }

  let configs = null;
  const cache = new Map();
  expo.getViewConfig = (moduleName, viewName) => {
    configs ??= require('./viewConfigs.json');
    const name = `${moduleName}${viewName != null ? '_' + viewName : ''}`;
    let config = cache.get(name);
    if (config == null) {
      config = toViewConfig(configs.views[name] ?? configs.union);
      cache.set(name, config);
    }
    return config;
  };

  const {SharedObject, NativeModule} = expo;

  class ObservableState extends SharedObject {
    constructor(value) {
      super();
      this.value = value;
    }
    getValue() {
      return this.value;
    }
    setValue(value) {
      this.value = value;
    }
    setOnChange() {}
  }

  class WorkletCallback extends SharedObject {}

  expo.modules.ExpoUI ??= Object.assign(new NativeModule(), {
    ObservableState,
    WorkletCallback,
    ViewPrototypes: {},
    completeRefresh: () => {},
    withAnimation: () => {},
    // Android (Compose)
    isDynamicColorAvailable: false,
    getMaterialColors: () => ({}),
    SwitchDefaultIconSize: 16,
    ToggleButtonIconSize: 18,
    ToggleButtonIconSpacing: 8,
  });
  expo.modules.ExpoAsset ??= Object.assign(new NativeModule(), {
    downloadAsync: async url => url,
  });
  expo.modules.ExponentConstants ??= Object.assign(new NativeModule(), {
    manifest: null,
    appOwnership: null,
    executionEnvironment: 'bare',
    platform: {},
  });
  expo.modules.ExpoConstants ??= expo.modules.ExponentConstants;
}
