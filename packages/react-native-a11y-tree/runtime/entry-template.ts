/**
 * Entry point template for rn-a11y-tree bundles.
 *
 * `src/bundle.ts` copies this file into a temp dir and replaces the
 * `__PLACEHOLDER__` tokens (always inside string literals or as bare numbers)
 * before handing it to Metro. Do not import this file directly.
 *
 * Sequence (mirrors a Fantom test):
 *   1. At bundle load: set up the RN environment, load the Fantom runtime and
 *      the user's component module, and register the render function.
 *   2. The host binary calls `global.$$RunTests$$()`, which renders the
 *      component into a Fantom root, reads the tree with layout metrics
 *      (`getA11yTree` if the host has it, else `getRenderedOutput`), and
 *      prints `{"type":"rn-a11y-tree-result","rnA11yTree":...}`
 *      as one line on stdout.
 */

import {registerRender} from '__RUNTIME_DIR__/fantom/setup';
import {count, mark, summarize} from '__RUNTIME_DIR__/timings';
// Types of the modules required below (type-only: erased, loads nothing).
import type * as ActionsModule from '__RUNTIME_DIR__/actions';
import type * as CapabilitiesModule from '__RUNTIME_DIR__/capabilities';
import type * as FantomModule from '__RUNTIME_DIR__/fantom/index';
import type * as NativeFantomModule from '__RUNTIME_DIR__/fantom/specs/NativeFantom';
import type * as HostContextModule from '__RUNTIME_DIR__/gh/hostContext';
import type * as HostConfigModule from '__RUNTIME_DIR__/hostConfig';
import type * as SessionModule from '__RUNTIME_DIR__/session';
import type * as SettleModule from '__RUNTIME_DIR__/settle';
import type * as TurboModuleStubs from '__RUNTIME_DIR__/turboModuleStubs';

registerRender(() => {
  // Before anything loads TurboModuleRegistry (see runtime/turboModuleStubs.ts).
  (require('__RUNTIME_DIR__/turboModuleStubs') as typeof TurboModuleStubs).installTurboModuleStubs();
  // Environment setup must run before anything else from react-native.
  require('__RUNTIME_DIR__/fantom/setUpDefaultReactNativeEnvironment');

  (require('__RUNTIME_DIR__/nativeComponentFallback') as typeof import('__RUNTIME_DIR__/nativeComponentFallback')).installNativeComponentFallback();

  const React = require('react') as typeof import('react');
  const Fantom = require('__RUNTIME_DIR__/fantom/index') as typeof FantomModule;
  const NativeFantom = (require('__RUNTIME_DIR__/fantom/specs/NativeFantom') as typeof NativeFantomModule).default;

  // Expo projects only (src/bundle.ts expoPolyfillPath): the JS
  // `globalThis.expo`, Expo view configs and module stubs, before anything
  // imports expo, expo-modules-core or @expo/ui.
  /* __EXPO_PRELUDE__ */

  // Host settings applied before the first render (runtime/hostConfig.ts).
  const hostConfig = __HOST_CONFIG__;
  // Dimensions/PixelRatio before the app module: apps read them at import.
  (require('__RUNTIME_DIR__/hostConfig') as typeof HostConfigModule).applyDeviceMetrics(hostConfig.deviceMetrics);

  const appModule = require('__APP_PATH__') as {default?: unknown; App?: unknown};
  let App = appModule.default ?? appModule.App;
  if (typeof App !== 'function' && (typeof App !== 'object' || App == null)) {
    throw new Error(
      'rn-a11y-tree: "__APP_PATH__" must have a default export or an `App` named export that is a React component',
    );
  }

  /* __APP_PROVIDERS__ */

  const viewportWidth = __VIEWPORT_WIDTH__;
  const viewportHeight = __VIEWPORT_HEIGHT__;
  const includeDebugProps = __INCLUDE_DEBUG_PROPS__;
  // `run --script`: array of actions (see runtime/actions.ts), else null.
  const script = __SCRIPT__;
  const tapMode = __TAP_MODE__;
  // `run` options, e.g. {diff: true} (send the tree after every step).
  const runOptions = __RUN_OPTIONS__;
  // `session`: install globalThis.__rnA11y for the host's --interactive mode
  // (see runtime/session.ts). The host never calls $$RunTests$$ then.
  const session = __SESSION__;

  mark('setupEnd');

  if (session) {
    (require('__RUNTIME_DIR__/session') as typeof SessionModule).installSession({
      React,
      App: App as React.ComponentType,
      viewport: {width: viewportWidth, height: viewportHeight},
      tapMode,
      hostConfig,
    });
    return () => {
      throw new Error('rn-a11y-tree: session bundles are driven by globalThis.__rnA11y');
    };
  }

  return () => {
    (require('__RUNTIME_DIR__/hostConfig') as typeof HostConfigModule).applyHostConfig(hostConfig);
    mark('renderStart');
    const root = Fantom.createRoot({viewportWidth, viewportHeight});
    (require('__RUNTIME_DIR__/gh/hostContext') as typeof HostContextModule).setRootTag(root.getRootTag());
    Fantom.runTask(() => {
      root.render(React.createElement(App as React.ComponentType));
    });
    mark('rendered');

    const rootTag = root.getRootTag();
    // Deliver onLayout and other queued events until the UI is stable.
    count('settleRounds', (require('__RUNTIME_DIR__/settle') as typeof SettleModule).settle(rootTag));
    mark('settled');
    const viewport = {width: viewportWidth, height: viewportHeight};

    if (script != null) {
      if (typeof NativeFantom.getA11yTree !== 'function') {
        throw new Error(
          'rn-a11y-tree run: the host has no NativeFantom.getA11yTree; rebuild it with `bun run build:host`',
        );
      }
      const {runActions} = require('__RUNTIME_DIR__/actions') as typeof ActionsModule;
      const {steps, snapshots, final, fallbacks, stepTrees} = runActions({
        root,
        script,
        tapMode,
        diff: runOptions.diff === true,
      });
      mark('actionsEnd');
      mark('dumpEnd');
      root.destroy();
      return JSON.stringify({
        viewport,
        source: 'shadowTree',
        steps,
        snapshots,
        final,
        fallbacks,
        stepTrees,
        capabilities: (require('__RUNTIME_DIR__/capabilities') as typeof CapabilitiesModule).getCapabilities(),
        hostInfo: (require('__RUNTIME_DIR__/capabilities') as typeof CapabilitiesModule).getHostInfo(),
        timings: summarize(),
      });
    }

    let source: string;
    let tree: string;
    mark('dumpStart');
    if (typeof NativeFantom.getA11yTree === 'function') {
      // Typed JSON dump of the committed ShadowTree (hierarchy before view
      // flattening, numbers/booleans instead of debug strings).
      source = 'shadowTree';
      tree = (require('__RUNTIME_DIR__/hostConfig') as typeof HostConfigModule).readA11yTree(rootTag, includeDebugProps);
    } else {
      // Fallback for hosts without getA11yTree: the mounted view tree from
      // Fantom's RenderOutput (type/props/children, debug-string props with
      // `layoutMetrics-*` keys).
      source = 'mounted';
      tree = NativeFantom.getRenderedOutput(rootTag, {
        includeRoot: true,
        includeLayoutMetrics: true,
      });
    }
    mark('dumpEnd');
    root.destroy();

    // `tree` is already a JSON string; splice it in as-is.
    const hostInfo = (require('__RUNTIME_DIR__/capabilities') as typeof CapabilitiesModule).getHostInfo();
    return `{"viewport":${JSON.stringify(viewport)},"source":${JSON.stringify(
      source,
    )},"hostInfo":${JSON.stringify(hostInfo)},"timings":${JSON.stringify(summarize())},"tree":${tree}}`;
  };
});
