/**
 * Session mode (`rn-a11y-tree session`): the host runs in Fantom's
 * `--interactive` mode and evaluates one small snippet per request:
 *
 *   globalThis.__rnA11y.request('<request JSON>')
 *
 * Each call prints exactly one line on stdout through
 * NativeFantom.reportTestSuiteResultsJSON:
 *
 *   {"type":"rn-a11y-tree-response","id":..,"ok":..,...}
 *
 * Requests (already validated by the CLI):
 *   {id, start: true}   render the app; responds with {ready: true, tree}
 *   {id, action: {...}} one action (same objects as `run --script`); {step, tree?}
 *   {id, tree: true}    the current tree
 *   {id, quit: true}    unmount and clean up (the CLI then closes stdin)
 * Trees are raw getA11yTree JSON; the CLI converts them with src/tree.ts.
 */

import {createRunner} from './actions';
import {getCapabilities} from './capabilities';
import {setRootTag} from './gh/hostContext';
import {applyHostConfig} from './hostConfig';
import {settle} from './settle';
import {mark, summarize} from './timings';

const Fantom = require('./fantom/index');
const NativeFantom = require('./fantom/specs/NativeFantom').default;

export const RESPONSE_TYPE = 'rn-a11y-tree-response';

export function installSession({React, App, viewport, tapMode, hostConfig}) {
  let root = null;
  let runner = null;
  let nextIndex = 0;

  function report(response) {
    const fallbacks = runner != null ? runner.getFallbacks() : [];
    NativeFantom.reportTestSuiteResultsJSON(
      JSON.stringify({type: RESPONSE_TYPE, ...response, fallbacks}),
    );
  }

  function requireStarted() {
    if (runner == null) throw new Error('Session is not started');
  }

  function handle(request) {
    const {id} = request;
    if (request.start) {
      if (typeof NativeFantom.getA11yTree !== 'function') {
        throw new Error(
          'the host has no NativeFantom.getA11yTree; rebuild it with `yarn build:host`',
        );
      }
      if (runner != null) throw new Error('Session is already started');
      applyHostConfig(hostConfig ?? {});
      root = Fantom.createRoot({
        viewportWidth: viewport.width,
        viewportHeight: viewport.height,
      });
      setRootTag(root.getRootTag());
      mark('renderStart');
      Fantom.runTask(() => {
        root.render(React.createElement(App));
      });
      mark('rendered');
      settle(root.getRootTag());
      mark('settled');
      runner = createRunner({root, tapMode});
      mark('dumpStart');
      const tree = runner.readTree();
      mark('dumpEnd');
      report({id, ok: true, ready: true, tree, capabilities: getCapabilities(), timings: summarize()});
    } else if (request.action != null) {
      requireStarted();
      const before = request.diff === true ? runner.readTree() : undefined;
      const {step, snapshot} = runner.runStep(request.action, nextIndex++);
      const response = {id, ok: step.error == null, step};
      if (before !== undefined) response.diffTrees = [before, runner.readTree()];
      if (step.error != null) response.error = step.error;
      if (snapshot !== undefined) response.tree = snapshot;
      report(response);
    } else if (request.tree) {
      requireStarted();
      report({id, ok: true, tree: runner.readTree()});
    } else if (request.quit) {
      if (runner != null) {
        runner.dispose();
        root.destroy();
        NativeFantom.flushMessageQueue();
      }
      runner = null;
      root = null;
      report({id, ok: true, quit: true});
    } else {
      throw new Error('Unknown request');
    }
  }

  globalThis.__rnA11y = {
    request(json) {
      let request;
      try {
        request = JSON.parse(json);
        handle(request);
      } catch (error) {
        report({
          id: request?.id ?? null,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}
