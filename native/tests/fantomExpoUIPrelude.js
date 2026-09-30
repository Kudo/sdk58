/**
 * Prelude for @expo/ui in the Fantom host (import it before anything that
 * imports `expo`, `expo-modules-core` or `@expo/ui`).
 *
 * - Installs the JS `globalThis.expo` (the web polyfill of expo-modules-core).
 * - `expo.getViewConfig(module, view)`: every view gets the union of the
 *   @expo/ui prop names as validAttributes and the union of its event names as
 *   directEventTypes (`onButtonPressed` -> `topButtonPressed`), from
 *   fantomExpoUIViewConfig.json (generated from the Swift/Kotlin sources).
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

// $FlowFixMe[cannot-resolve-module]
const viewConfig = require('./fantomExpoUIViewConfig.json');

const validAttributes: {[string]: boolean} = {};
for (const name of viewConfig.validAttributes) {
  validAttributes[name] = true;
}
const directEventTypes: {[string]: {registrationName: string}} = {};
for (const name of viewConfig.events) {
  directEventTypes['top' + name.slice(2)] = {registrationName: name};
}

// $FlowFixMe[prop-missing]
globalThis.expo.getViewConfig = (_moduleName: string, _viewName?: string) => ({
  validAttributes,
  directEventTypes,
});

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
