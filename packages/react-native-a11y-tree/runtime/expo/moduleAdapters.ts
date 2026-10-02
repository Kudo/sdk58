/** Explicit headless contracts. Never invent an API for an unknown module. */
type ModuleHost = {NativeModule: new () => object; modules: Record<string, object | undefined>};

export function installExpoModuleAdapters(expo: ModuleHost, warn: (message: string) => void): void {
  const unsupported = (name: string): never => {
    throw new Error(`[NATIVE_API_UNSUPPORTED] ${name} is not simulated by react-native-a11y-tree. Render layout/accessibility without calling this API, or provide an application-level mock.`);
  };
  const asyncMethods = (module: string, names: string[]) => Object.fromEntries(
    names.map(name => [name, async () => unsupported(`${module}.${name}`)]),
  );
  const adapters: Record<string, {description: string; create: () => object}> = {
    ExpoImage: {
      description: 'Image layout, props and accessibility only; loading, decoding, caching and image events are not simulated.',
      create: () => ({
        ViewPrototypes: {},
        Image: class {constructor() {unsupported('ExpoImage.Image');}},
        ...asyncMethods('ExpoImage', ['loadAsync', 'prefetch', 'clearMemoryCache', 'clearDiskCache', 'getCachePathAsync', 'writeToCacheAsync', 'readFromCacheAsync', 'generateBlurhashAsync', 'generateThumbhashAsync']),
        configureCache: () => unsupported('ExpoImage.configureCache'),
      }),
    },
    ExpoDevice: {
      description: 'Headless device: isDevice=false; hardware metadata is unknown. Hardware queries are not simulated.',
      create: () => ({
        isDevice: false, brand: null, manufacturer: null, modelId: null, modelName: null,
        designName: null, productName: null, deviceType: null, deviceYearClass: null, totalMemory: null,
        supportedCpuArchitectures: null, osName: null, osVersion: null, osBuildId: null,
        osInternalBuildId: null, osBuildFingerprint: null, platformApiLevel: null, deviceName: null,
        ...asyncMethods('ExpoDevice', ['getDeviceTypeAsync', 'getUptimeAsync', 'getMaxMemoryAsync', 'isRootedExperimentalAsync', 'isSideLoadingEnabledAsync', 'getPlatformFeaturesAsync', 'hasPlatformFeatureAsync']),
      }),
    },
    ExpoLinking: {
      description: 'No initial URL or native URL events in the headless host.',
      create: () => ({getLinkingURL: () => null, clearInitialURL: () => {}}),
    },
    ExpoFontLoader: {
      description: 'No custom fonts loaded; native font loading is not simulated.',
      create: () => ({getLoadedFonts: () => [], isLoaded: () => false,
        ...asyncMethods('ExpoFontLoader', ['loadAsync', 'loadFontFamilyAsync', 'unloadAsync', 'unloadAllAsync'])}),
    },
    ExpoWebBrowser: {
      description: 'Import support only; opening browsers and authentication sessions are not simulated.',
      create: () => ({
        ...asyncMethods('ExpoWebBrowser', ['openBrowserAsync', 'openAuthSessionAsync', 'warmUpAsync', 'coolDownAsync', 'mayInitWithUrlAsync', 'getCustomTabsSupportingBrowsersAsync']),
        dismissBrowser: () => unsupported('ExpoWebBrowser.dismissBrowser'),
        dismissAuthSession: () => unsupported('ExpoWebBrowser.dismissAuthSession'),
      }),
    },
  };
  for (const [name, adapter] of Object.entries(adapters)) {
    if (Object.hasOwn(expo.modules, name)) continue;
    let value: object | undefined;
    Object.defineProperty(expo.modules, name, {configurable: true, enumerable: true, get() {
      if (!value) {
        value = Object.assign(new expo.NativeModule(), adapter.create());
        warn(`[NATIVE_MODULE_FALLBACK] ${name}: ${adapter.description}`);
      }
      return value;
    }});
  }
}
