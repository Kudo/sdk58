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

import type * as ReactTypes from 'react';

import {createRunner} from './actions';
import type {A11yNode} from './tree-index';
import type {Action, TapMode} from './actions';
import {getCapabilities, getHostInfo} from './capabilities';
import type {Root} from './fantom/index';
import {setRootTag} from './gh/hostContext';
import {applyHostConfig} from './hostConfig';
import type {HostConfig} from './hostConfig';
import {settle} from './settle';
import {mark, summarize} from './timings';
import {completeNetworkRequest} from './network';

const Fantom = require('./fantom/index') as typeof import('./fantom/index');
const NativeFantom = (require('./fantom/specs/NativeFantom') as typeof import('./fantom/specs/NativeFantom'))
  .default;

export const RESPONSE_TYPE = 'rn-a11y-tree-response';

/** A request from the CLI (SessionRequest in src/schema.ts, plus `start`). */
type SessionRequest = {
  id?: unknown;
  start?: boolean;
  action?: Action | null;
  diff?: boolean;
  strict?: boolean;
  tree?: boolean;
  quit?: boolean;
  back?: boolean;
  networkResponse?: {requestId: number; response: unknown};
};

type Response = {id: unknown; ok: boolean; [key: string]: unknown};

export function installSession({
  React,
  App,
  viewport,
  tapMode,
  hostConfig,
  goBack,
}: {
  React: typeof ReactTypes;
  App: ReactTypes.ComponentType;
  viewport: {width: number; height: number};
  tapMode: TapMode;
  hostConfig: HostConfig | null | undefined;
  goBack?: () => void;
}): void {
  let root: Root | null = null;
  let runner: ReturnType<typeof createRunner> | null = null;
  let nextIndex = 0;

  function report(response: Response): void {
    const fallbacks = runner != null ? runner.getFallbacks() : [];
    NativeFantom.reportTestSuiteResultsJSON(
      JSON.stringify({type: RESPONSE_TYPE, ...response, fallbacks}),
    );
  }

  function requireStarted() {
    if (runner == null) throw new Error('Session is not started');
  }

  function handle(request: SessionRequest): void {
    const {id} = request;
    if (request.start) {
      if (typeof NativeFantom.getA11yTree !== 'function') {
        throw new Error(
          'the host has no NativeFantom.getA11yTree; rebuild it with `bun run build:host`',
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
        root!.render(React.createElement(App));
      });
      mark('rendered');
      settle(root.getRootTag());
      mark('settled');
      runner = createRunner({root, tapMode});
      mark('dumpStart');
      const tree = runner.readTree();
      mark('dumpEnd');
      report({id, ok: true, ready: true, tree, capabilities: getCapabilities(), hostInfo: getHostInfo(), timings: summarize()});
    } else if (request.action != null) {
      requireStarted();
      const before: A11yNode | undefined = request.diff === true ? runner!.readTree() : undefined;
      const {step, snapshot} = runner!.runStep(request.action, nextIndex++, request.strict === true);
      const response: Response = {id, ok: step.error == null, step};
      if (before !== undefined) response.diffTrees = [before, runner!.readTree()];
      if (step.error != null) response.error = step.error;
      if (snapshot !== undefined) response.tree = snapshot;
      report(response);
    } else if (request.networkResponse) {
      Fantom.runTask(() => {
        completeNetworkRequest(request.networkResponse!.requestId, request.networkResponse!.response);
      });
      if (root) settle(root.getRootTag());
      report({id, ok: true});
    } else if (request.back) {
      requireStarted();
      if (!goBack) throw new Error('back requires renderRoute() or session --router');
      Fantom.runTask(goBack);
      settle(root!.getRootTag());
      report({id, ok: true, tree: runner!.readTree()});
    } else if (request.tree) {
      requireStarted();
      settle(root!.getRootTag());
      report({id, ok: true, tree: runner!.readTree()});
    } else if (request.quit) {
      if (runner != null) {
        runner.dispose();
        root!.destroy();
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
    request(json: string) {
      let request: SessionRequest | undefined;
      try {
        request = JSON.parse(json) as SessionRequest;
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
