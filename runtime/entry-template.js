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
 *      component into a Fantom root, reads the mounted tree with layout
 *      metrics, and prints `{"type":"rn-a11y-tree-result","rnA11yTree":...}`
 *      as one line on stdout.
 */

import {registerRender} from '__RUNTIME_DIR__/fantom/setup';

registerRender(() => {
  // Environment setup must run before anything else from react-native.
  require('__RUNTIME_DIR__/fantom/setUpDefaultReactNativeEnvironment');

  const React = require('react');
  const Fantom = require('__RUNTIME_DIR__/fantom/index');
  const NativeFantom = require('__RUNTIME_DIR__/fantom/specs/NativeFantom').default;

  const appModule = require('__APP_PATH__');
  const App = appModule.default ?? appModule.App;
  if (typeof App !== 'function' && (typeof App !== 'object' || App == null)) {
    throw new Error(
      'rn-a11y-tree: "__APP_PATH__" must have a default export or an `App` named export that is a React component',
    );
  }

  const viewportWidth = __VIEWPORT_WIDTH__;
  const viewportHeight = __VIEWPORT_HEIGHT__;

  return () => {
    const root = Fantom.createRoot({viewportWidth, viewportHeight});
    Fantom.runTask(() => {
      root.render(React.createElement(App));
    });

    // Raw JSON string from the native RenderOutput (type/props/children, with
    // `layoutMetrics-*` props). Passed through as-is.
    const tree = NativeFantom.getRenderedOutput(root.getRootTag(), {
      includeRoot: true,
      includeLayoutMetrics: true,
    });
    root.destroy();

    return `{"viewport":${JSON.stringify({
      width: viewportWidth,
      height: viewportHeight,
    })},"tree":${tree}}`;
  };
});
