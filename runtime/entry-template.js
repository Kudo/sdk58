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
  const includeDebugProps = __INCLUDE_DEBUG_PROPS__;
  // `run --script`: array of actions (see runtime/actions.js), else null.
  const script = __SCRIPT__;
  const tapMode = __TAP_MODE__;

  return () => {
    const root = Fantom.createRoot({viewportWidth, viewportHeight});
    Fantom.runTask(() => {
      root.render(React.createElement(App));
    });

    const rootTag = root.getRootTag();
    const viewport = {width: viewportWidth, height: viewportHeight};

    if (script != null) {
      if (typeof NativeFantom.getA11yTree !== 'function') {
        throw new Error(
          'rn-a11y-tree run: the host has no NativeFantom.getA11yTree; rebuild it with `yarn build:host`',
        );
      }
      const {runActions} = require('__RUNTIME_DIR__/actions');
      const {steps, snapshots, final} = runActions({root, script, tapMode});
      root.destroy();
      return JSON.stringify({
        viewport,
        source: 'shadowTree',
        steps,
        snapshots,
        final,
      });
    }

    let source;
    let tree;
    if (typeof NativeFantom.getA11yTree === 'function') {
      // Typed JSON dump of the committed ShadowTree (hierarchy before view
      // flattening, numbers/booleans instead of debug strings).
      source = 'shadowTree';
      tree = NativeFantom.getA11yTree(rootTag, includeDebugProps);
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
    root.destroy();

    // `tree` is already a JSON string; splice it in as-is.
    return `{"viewport":${JSON.stringify(viewport)},"source":${JSON.stringify(
      source,
    )},"tree":${tree}}`;
  };
});
