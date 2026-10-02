/** Substitute missing native views and report incomplete descriptor semantics. */
type ViewConfig = Record<string, unknown>;
type FallbackDependencies = {
  hasComponent: (name: string) => boolean;
  viewConfig: () => ViewConfig;
  warn: (message: string) => void;
};

export function wrapNativeViewConfig(name: string, load: () => ViewConfig, deps: FallbackDependencies): () => ViewConfig {
  let warned = false;
  return () => {
    if (deps.hasComponent(name)) {
      // Screens registers native tab descriptors, but this runner does not
      // emulate the platform tab controller that selects/hides its pages.
      // A descriptor probe alone must not imply usable native navigation.
      if (!warned && (name === 'RNSTabsHostIOS' || name === 'RNSTabsHostAndroid')) {
        warned = true;
        deps.warn(`[NATIVE_COMPONENT_FALLBACK] ${name}: descriptor layout only; native tab controls, selected-page visibility and tab lifecycle events are not simulated. Check Router state separately; overlapping pages do not identify the selected screen.`);
      }
      return load();
    }
    if (!warned) {
      warned = true;
      deps.warn(`[NATIVE_COMPONENT_FALLBACK] ${name} is unsupported; using View for layout and children. Native drawing, custom props and methods are not simulated.`);
    }
    return {...deps.viewConfig()};
  };
}

export function installNativeComponentFallback(): void {
  const NativeFantom = (require('./fantom/specs/NativeFantom') as {default: {hasNativeComponent?: (name: string) => boolean}}).default;
  const hasComponent = NativeFantom.hasNativeComponent;
  // Older host overrides retain their existing behavior. Bundled 0.1.2 runtimes
  // expose this probe, so we need no hard-coded list of supported components.
  if (!hasComponent) return;
  const registry = require('react-native/Libraries/Renderer/shims/ReactNativeViewConfigRegistry') as {
    register: (name: string, load: () => ViewConfig) => string;
    get: (name: string) => ViewConfig;
  };
  const register = registry.register;
  registry.register = (name, load) => register(name, wrapNativeViewConfig(name, load, {
    hasComponent,
    viewConfig: () => {
      // Register the real View lazily; never evaluate an unsupported native config.
      require('react-native/Libraries/Components/View/ViewNativeComponent');
      return registry.get('RCTView');
    },
    warn: message => console.warn(message),
  }));
}
