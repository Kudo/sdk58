# Vendored Fantom JS runtime

Source: https://github.com/facebook/react-native, branch `0.88-stable`,
commit `6007151` (package version `0.88.0-rc.3`). License: MIT, see
`LICENSE` in this directory. The Meta copyright headers are kept in every file.

These files are not published to npm: `private/react-native-fantom` is a
private package, and `react-native/src/private/testing` is excluded from the
`react-native` npm package (`"!src/private/testing"`).

## Files

| File here | Source |
| --- | --- |
| `index.js` | `private/react-native-fantom/src/index.js` |
| `Constants.js` | `private/react-native-fantom/src/Constants.js` |
| `HighResTimeStampMock.js` | `private/react-native-fantom/src/HighResTimeStampMock.js` |
| `TimerMock.js` | `private/react-native-fantom/src/TimerMock.js` |
| `getFantomRenderedOutput.js` | `private/react-native-fantom/src/getFantomRenderedOutput.js` |
| `setUpDefaultReactNativeEnvironment.js` | `private/react-native-fantom/src/setUpDefaultReactNativeEnvironment.js` |
| `setup.js` | `private/react-native-fantom/runtime/setup.js` (rewritten, see below) |
| `mocks/ReactNativeInternalFeatureFlags.js` | `private/react-native-fantom/runtime/mocks/ReactNativeInternalFeatureFlags.js` |
| `specs/NativeFantom.js` | `packages/react-native/src/private/testing/fantom/specs/NativeFantom.js` |

## Changes

The first commit that adds this directory has the unmodified files, so
`git diff` against it shows every change. Summary:

- Haste / relative imports changed to npm paths:
  - `react-native/src/private/testing/fantom/specs/NativeFantom` ->
    `./specs/NativeFantom` (in `index.js`, `TimerMock.js`,
    `HighResTimeStampMock.js`, `getFantomRenderedOutput.js`).
  - In `specs/NativeFantom.js`: `../../../../../Libraries/TurboModule/*` ->
    `react-native/Libraries/TurboModule/*`.
- `index.js`: removed the `Benchmark` import, `unstable_benchmark` export and
  benchmark types. Updated the LogBox error message path.
- `setup.js`: removed the Jest-like framework (`describe`/`it`/hooks,
  `expect`, `jest.fn` mocks, snapshots, coverage, JS profiler, benchmark
  reporting). Kept the host contract: `global.$$RunTests$$` and reporting one
  JSON line through `NativeFantom.reportTestSuiteResultsJSON`. Added
  `registerRender()` in place of `registerTest()`.
- Not vendored: `Benchmark.js`, `runtime/expect.js`, `runtime/mocks.js`,
  `runtime/snapshotContext.js`, REPL / warm-up entry points,
  `runtime/patchWeakRef.js` (a test-only assertion that throws when a
  `WeakRef` is created or dereferenced outside `Fantom.runTask`; it would
  turn normal app code into errors).
- `mocks/ReactNativeInternalFeatureFlags.js` is kept for reference but is not
  imported. Fantom maps it to the Haste name `ReactNativeInternalFeatureFlags`
  for Meta's internal renderer build; the OSS renderer in
  `react-native/Libraries/Renderer/implementations` does not require it.
