/** Substitute only unsupported native views. Application errors still propagate. */
type ViewConfig = Record<string, unknown>;
type FallbackDependencies = {
  hasComponent: (name: string) => boolean;
  viewConfig: () => ViewConfig;
  warn: (message: string) => void;
};

export function wrapNativeViewConfig(name: string, load: () => ViewConfig, deps: FallbackDependencies): () => ViewConfig {
  let warned = false;
  return () => {
    if (deps.hasComponent(name)) return load();
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
