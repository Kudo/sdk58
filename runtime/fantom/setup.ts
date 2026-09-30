/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Adapted for react-native-a11y-tree from
 * private/react-native-fantom/runtime/setup.js. The Jest-like test framework
 * (describe/it/expect/snapshots/coverage) was removed. What is left is the
 * contract with the Fantom tester binary: the host loads the bundle and then
 * calls `global.$$RunTests$$()`, and the JS side reports results as a single
 * JSON line on stdout via `NativeFantom.reportTestSuiteResultsJSON`.
 *
 * @flow strict-local
 * @format
 */

export type FailureDetail = {
  message: string,
  stack?: string,
  cause?: FailureDetail,
};

// `type` values printed on stdout. The CLI looks for these.
export const RESULT_TYPE = 'rn-a11y-tree-result';
export const ERROR_TYPE = 'rn-a11y-tree-error';

let setupError: ?Error;
let renderFn: ?() => string;

function report(json: string): void {
  // Force the import of the native module to be lazy
  const NativeFantom = require('./specs/NativeFantom').default;
  NativeFantom.reportTestSuiteResultsJSON(json);
}

function serializeError(error: unknown): FailureDetail {
  if (!(error instanceof Error)) {
    return {message: `Non-error value thrown: ${String(error)}`};
  }
  const result: FailureDetail = {
    message: error.message,
    stack: error.stack,
  };
  if (error.cause instanceof Error) {
    result.cause = serializeError(error.cause);
  }
  return result;
}

function reportError(error: unknown): void {
  report(JSON.stringify({type: ERROR_TYPE, error: serializeError(error)}));
}

global.$$RunTests$$ = () => {
  if (setupError != null) {
    reportError(setupError);
    return;
  }
  if (renderFn == null) {
    reportError(new Error('No render function was registered'));
    return;
  }
  let payload;
  try {
    payload = renderFn();
  } catch (error) {
    reportError(error);
    return;
  }
  // `payload` is already a JSON string (the rendered tree comes from native
  // as a string), so splice it in instead of parsing and re-serializing it.
  report(`{"type":${JSON.stringify(RESULT_TYPE)},"rnA11yTree":${payload}}`);
};

/**
 * Registers the function that renders the app and returns the JSON payload
 * (as a string) to report. `setUp` runs immediately, at bundle load time, the
 * same way Fantom's `registerTest` evaluates the test module.
 */
export function registerRender(setUp: () => () => string): void {
  try {
    renderFn = setUp();
  } catch (error) {
    setupError = error instanceof Error ? error : new Error(String(error));
    // Session mode never calls $$RunTests$$; the CLI's request snippet
    // rethrows this so the error reaches the user.
    global.__rnA11ySetupError = setupError;
  }
}
