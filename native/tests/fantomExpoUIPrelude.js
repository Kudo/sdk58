/**
 * Prelude for @expo/ui in the Fantom host (import it before anything that
 * imports `expo`, `expo-modules-core` or `@expo/ui`).
 *
 * - Installs the JS `globalThis.expo` (the web polyfill of expo-modules-core).
 * - `expo.getViewConfig(module, view)`: the per-view config (iOS + Android
 *   merged) from fantomExpoUIViewConfigs.json, else the union of all @expo/ui
 *   prop and event names from fantomExpoUIViewConfig.json.
 * - Native module stubs used at import: ExpoUI, ExpoAsset, ExpoConstants.
 *
 * @format
 */

// $FlowFixMe[cannot-resolve-module]
import {installExpoGlobalPolyfill} from 'expo-modules-core/src/polyfill/dangerous-internal';

installExpoGlobalPolyfill();

// Development bundles only: `expo` (Expo.fx, `__DEV__ && globalThis.expo`)
// opens a dev-server message socket from the SourceCode scriptURL, which is ''
// in the host (`new URL('')` throws). A null scriptURL means "embedded".
// $FlowFixMe[cannot-resolve-module]
const NativeSourceCode = require('react-native/Libraries/NativeModules/specs/NativeSourceCode').default;
NativeSourceCode.getConstants = () => ({scriptURL: null});

// Per-view configs (native/tools/expo-view-configs/out/viewConfigs.json,
// copied as fantomExpoUIViewConfigs.json): the iOS and Android attributes and
// events of a view name are merged, because the platform of the JS component
// (swift-ui or jetpack-compose) is not the bundle platform. Views not in the
// table get the union of all prop and event names
// (fantomExpoUIViewConfig.json, native/scripts/gen-expo-ui-view-config.py).
// $FlowFixMe[cannot-resolve-module]
const perViewConfigs = require('./fantomExpoUIViewConfigs.json').views;
// $FlowFixMe[cannot-resolve-module]
const unionConfig = require('./fantomExpoUIViewConfig.json');

const unionValidAttributes: {[string]: boolean} = {};
for (const name of unionConfig.validAttributes) {
  unionValidAttributes[name] = true;
}
const unionDirectEventTypes: {[string]: {registrationName: string}} = {};
for (const name of unionConfig.events) {
  unionDirectEventTypes['top' + name.slice(2)] = {registrationName: name};
}

// $FlowFixMe[prop-missing]
globalThis.expo.getViewConfig = (moduleName: string, viewName?: string) => {
  const entry =
    perViewConfigs[`ViewManagerAdapter_${moduleName}${viewName != null ? '_' + viewName : ''}`];
  if (entry == null) {
    return {validAttributes: unionValidAttributes, directEventTypes: unionDirectEventTypes};
  }
  return {
    validAttributes: {
      ...entry.ios?.validAttributes,
      ...entry.android?.validAttributes,
    },
    directEventTypes: {
      ...entry.ios?.directEventTypes,
      ...entry.android?.directEventTypes,
    },
  };
};

// $FlowFixMe[prop-missing]
const {SharedObject, NativeModule} = globalThis.expo;

class ObservableState extends SharedObject {
  value: mixed;
  constructor(value: mixed) {
    super();
    this.value = value;
  }
  getValue(): mixed {
    return this.value;
  }
  setValue(value: mixed) {
    this.value = value;
  }
  setOnChange() {}
}

class WorkletCallback extends SharedObject {}

// $FlowFixMe[prop-missing]
globalThis.expo.modules.ExpoUI = Object.assign(new NativeModule(), {
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
// $FlowFixMe[prop-missing]
globalThis.expo.modules.ExpoAsset = Object.assign(new NativeModule(), {
  downloadAsync: async (url: string) => url,
});
// $FlowFixMe[prop-missing]
globalThis.expo.modules.ExponentConstants = Object.assign(new NativeModule(), {
  manifest: null,
  appOwnership: null,
  executionEnvironment: 'bare',
  platform: {},
});
// $FlowFixMe[prop-missing]
globalThis.expo.modules.ExpoConstants = globalThis.expo.modules.ExponentConstants;
