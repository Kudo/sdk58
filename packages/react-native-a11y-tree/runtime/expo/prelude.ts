import {installExpoModuleAdapters} from './moduleAdapters';

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

/** An entry of viewConfigs.json: prop and event (`on...`) names. */
type ViewConfigEntry = {attributes: string[]; events: string[]};

type ViewConfigsFile = {
  views: Record<string, ViewConfigEntry | undefined>;
  union: ViewConfigEntry;
};

type ViewConfig = {
  validAttributes: Record<string, true>;
  directEventTypes: Record<string, {registrationName: string}>;
};

/** The parts of Expo's `globalThis.expo` used here. */
export type ExpoGlobal = {
  getViewConfig?: (moduleName: string, viewName?: string | null) => ViewConfig;
  SharedObject: new () => object;
  NativeModule: new () => object;
  modules: Record<string, object | undefined>;
};

function toViewConfig(entry: ViewConfigEntry): ViewConfig {
  const validAttributes: ViewConfig['validAttributes'] = {};
  for (const name of entry.attributes) validAttributes[name] = true;
  const directEventTypes: ViewConfig['directEventTypes'] = {};
  for (const name of entry.events) {
    directEventTypes['top' + name.slice(2)] = {registrationName: name};
  }
  return {validAttributes, directEventTypes};
}

// Props for decorative Expo views. Their RN/Yoga layout and children are real;
// the host does not draw glass, blur, or gradient pixels.
const effectViews: Record<string, ViewConfigEntry> = {
  ExpoGlassEffect_GlassView: {attributes: ['glassEffectStyle', 'tintColor', 'isInteractive', 'colorScheme'], events: []},
  ExpoGlassEffect_GlassContainer: {attributes: ['spacing'], events: []},
  ExpoBlur_ExpoBlurView: {attributes: ['intensity', 'tint', 'blurReductionFactor', 'blurMethod', 'blurTargetId', 'borderRadii'], events: []},
  ExpoBlur_ExpoBlurTargetView: {attributes: [], events: []},
  ExpoImage: {attributes: ['source', 'placeholder', 'contentFit', 'contentPosition', 'transition', 'tintColor', 'cachePolicy', 'priority', 'recyclingKey', 'allowDownscaling', 'autoplay', 'decodeFormat', 'enforceEarlyResizing', 'useAppleWebpCodec', 'enableLiveTextInteraction'], events: ['onLoadStart', 'onLoad', 'onError', 'onProgress', 'onDisplay']},
  SymbolModule: {attributes: ['name', 'size', 'weight', 'scale', 'type', 'tint', 'colors', 'animated', 'animationSpec'], events: []},
  ExpoLinearGradient: {attributes: ['colors', 'locations', 'startPoint', 'endPoint', 'borderRadii', 'dither'], events: []},
};

export function installExpoPrelude(): void {
  const expo = globalThis.expo;
  if (expo == null) {
    throw new Error('rn-a11y-tree: globalThis.expo is not installed (installExpoGlobalPolyfill)');
  }

  let configs: ViewConfigsFile | null = null;
  const cache = new Map<string, ViewConfig>();
  expo.getViewConfig = (moduleName, viewName) => {
    configs ??= require('./viewConfigs.json') as ViewConfigsFile;
    const name = `${moduleName}${viewName != null ? '_' + viewName : ''}`;
    let config = cache.get(name);
    if (config == null) {
      if (name === 'SymbolModule') console.warn('[NATIVE_COMPONENT_FALLBACK] SymbolModule uses layout and props only; symbol glyphs and animations are not drawn.');
      config = toViewConfig(effectViews[name] ?? configs.views[name] ?? configs.union);
      cache.set(name, config);
    }
    return config;
  };

  installExpoModuleAdapters(expo, message => console.warn(message));

  const {SharedObject, NativeModule} = expo;

  class ObservableState extends SharedObject {
    // No initializer: babel strips it, the constructor sets it.
    value: unknown;
    constructor(value: unknown) {
      super();
      this.value = value;
    }
    getValue() {
      return this.value;
    }
    setValue(value: unknown) {
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
  // On iOS the app can take its glass branch using these emulated views.
  // Android uses expo-glass-effect's own View fallback and false availability.
  expo.modules.ExpoGlassEffect ??= Object.assign(new NativeModule(), {
    ViewPrototypes: {},
    isLiquidGlassAvailable: true,
    isGlassEffectAPIAvailable: true,
  });
  expo.modules.ExpoAsset ??= Object.assign(new NativeModule(), {
    downloadAsync: async (url: string) => url,
  });
  expo.modules.ExponentConstants ??= Object.assign(new NativeModule(), {
    manifest: null,
    appOwnership: null,
    executionEnvironment: 'bare',
    platform: {},
  });
  expo.modules.ExpoConstants ??= expo.modules.ExponentConstants;
}
