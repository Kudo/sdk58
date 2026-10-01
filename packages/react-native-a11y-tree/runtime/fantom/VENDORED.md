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
| `index.ts` | `private/react-native-fantom/src/index.js` |
| `Constants.ts` | `private/react-native-fantom/src/Constants.js` |
| `HighResTimeStampMock.ts` | `private/react-native-fantom/src/HighResTimeStampMock.js` |
| `TimerMock.ts` | `private/react-native-fantom/src/TimerMock.js` |
| `getFantomRenderedOutput.tsx` | `private/react-native-fantom/src/getFantomRenderedOutput.js` |
| `setUpDefaultReactNativeEnvironment.ts` | `private/react-native-fantom/src/setUpDefaultReactNativeEnvironment.js` |
| `setup.ts` | `private/react-native-fantom/runtime/setup.js` (rewritten, see below) |
| `mocks/ReactNativeInternalFeatureFlags.ts` | `private/react-native-fantom/runtime/mocks/ReactNativeInternalFeatureFlags.js` |
| `specs/NativeFantom.ts` | `packages/react-native/src/private/testing/fantom/specs/NativeFantom.js` |

## Changes

The first commit that adds this directory has the unmodified files, so
`git diff` against it shows every change. Summary:

- Converted from Flow to TypeScript (`.js` -> `.ts`, `.tsx` for the file
  with JSX): `@flow` / `@format` pragmas and `$FlowExpectedError` comments
  removed, Flow types written as TypeScript types (`?T` -> `T | null |
  undefined`, `React.Node` -> `React.ReactNode`, `MixedElement` ->
  `ReactElement`, object spread types -> intersections), typed `require`
  casts (`require(...) as typeof import(...)`). The Flow enum
  `NativeEventCategory` is a `const` object (`as const`, erasable syntax)
  plus a type of its values, with the same values. Runtime
  behavior is unchanged. Where TypeScript needs help: an `isArray` guard in
  `getFantomRenderedOutput.tsx` (`Array.isArray` does not narrow a
  `ReadonlyArray` union) and one `@ts-expect-error` on `ReactFabric.render`
  in `index.ts` (react-native's generated type rejects the null callback).
  `tsc -p runtime` type-checks the files.
- Haste / relative imports changed to npm paths:
  - `react-native/src/private/testing/fantom/specs/NativeFantom` ->
    `./specs/NativeFantom` (in `index.ts`, `TimerMock.ts`,
    `HighResTimeStampMock.ts`, `getFantomRenderedOutput.tsx`).
  - In `specs/NativeFantom.ts`: `../../../../../Libraries/TurboModule/*` ->
    `react-native/Libraries/TurboModule/*`.
- `specs/NativeFantom.ts`: added the optional methods of react-native-a11y-tree's
  host (`getA11yTree`, `hitTest`, `enqueueNativeEventByTag`, ...).
- `index.ts`: removed the `Benchmark` import, `unstable_benchmark` export and
  benchmark types. Updated the LogBox error message path.
- `setup.ts`: removed the Jest-like framework (`describe`/`it`/hooks,
  `expect`, `jest.fn` mocks, snapshots, coverage, JS profiler, benchmark
  reporting). Kept the host contract: `global.$$RunTests$$` and reporting one
  JSON line through `NativeFantom.reportTestSuiteResultsJSON`. Added
  `registerRender()` in place of `registerTest()`.
- Not vendored: `Benchmark.js`, `runtime/expect.js`, `runtime/mocks.js`,
  `runtime/snapshotContext.js`, REPL / warm-up entry points,
  `runtime/patchWeakRef.js` (a test-only assertion that throws when a
  `WeakRef` is created or dereferenced outside `Fantom.runTask`; it would
  turn normal app code into errors).
- `mocks/ReactNativeInternalFeatureFlags.ts` is kept for reference but is not
  imported. Fantom maps it to the Haste name `ReactNativeInternalFeatureFlags`
  for Meta's internal renderer build; the OSS renderer in
  `react-native/Libraries/Renderer/implementations` does not require it.
