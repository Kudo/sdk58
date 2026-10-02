# Production use and remaining validation

The intended use is a fast, repeatable development/CI check of React Native
JavaScript behavior and Fabric layout. Every CLI invocation can start fresh and
reuse disk caches; a Metro daemon is not required. See
[performance measurements](perf-analysis.md) for the measured workloads and limitations.

## Adoption contract

1. Pin the CLI, runtime package and app dependency versions. Run `doctor --strict`
   from the app before adding a CI gate. Its tested flag describes dependency
   versions only; it does not certify native behavior.
2. Start with one representative screen and explicit startup state. Exercise a
   successful interaction, an error state, and a loading/empty state. Assert
   outputs rather than only accepting a zero exit code.
3. Enable `--fail-on-fallback`. Review each exact allowance. Keep application
   fixtures in source control and test the native API contract they implement.
4. Keep device checks for native APIs, screen-reader behavior, text/font parity,
   platform transitions, gestures, and anything the headless adapters emulate.
   A passing headless check alone is insufficient for these claims.

## Third-party integration and maintenance

Pure JavaScript libraries can run through their real imports. Native service
libraries can use explicit Expo/TurboModule or Nitro HybridObject fixtures; the AsyncStorage example
exercises its real JavaScript wrapper with an in-memory callback contract. Native
UI libraries may additionally need Fabric descriptors, layout, event handling,
and host integration. A generic fixture object cannot supply those behaviors.

The [Nitro example](../examples/nitro-fixture/README.md) pins Nitro 0.37.1,
MMKV 4.3.2, and Nitro Image 0.15.2. It tests the real JS bootstrap, storage
interactions with app-owned factories, and a Nitro Image View fallback. Native
storage, image decoding/drawing, hybrid refs, and cross-runtime boxing remain
unsupported. Nitro's caught boxing error still fails strict policy. These tests
do not mean that the native Nitro runtime is compiled into the host.

The unchanged SDK 58 starter layout now has full-root E2E coverage through
Expo Router. Tests verify `src/app` precedence, `app` fallback, plugin-defined
roots, config-helper cache invalidation, and Router pathname transitions.
The [starter fixture](../examples/sdk58-default/README.md) documents the
explicit Android palette and linking contracts and remaining native limits.

Native-tab descriptors likewise do not implement the platform tab controller.
The runner reports this limitation even for registered iOS/Android tab hosts:
native tab buttons, selected-page visibility and tab lifecycle events are not
simulated. Router state can change while both pages remain in the tree; do not
interpret those overlapping pages as the visible selected screen.

For each maintained adapter, record the tested package version, supported methods,
unsupported operations, observable diagnostics, and regression examples. Test
caught unsupported errors as well as successful actions: a caught exception must
not turn an unsupported native operation into a clean validation result.

When updating React Native or compiled libraries, rebuild the host and run both
preset suites and platform CI. Update `TESTED_DEPENDENCIES` deliberately; a test
checks it against installed workspace versions. Review changed native contracts
before expanding version claims. Application-specific fixtures stay app-owned,
which avoids maintaining an open-ended library of invented native behavior here.

## Recorded dependency exercise

The [MMKV patch exercise](validation/2026-10-02-mmkv-upgrade/README.md) compares
4.3.1 and 4.3.2 with Nitro 0.37.1 and unchanged application fixtures. It checks
storage operations, fresh-process state and strict rejection of unsupported
boxing on both presets. This is a historical patch comparison of JavaScript
contracts, not native ABI validation or an independently maintained app pilot.
No supported version range is inferred from those two package versions.

## External whole-app exercise

The [TanStack Query pilot](validation/2026-10-02-tanstack-pilot/README.md) runs the
complete upstream React Native example with explicit dependency upgrades and one
NetInfo fixture. Both presets exercise loading, list/detail navigation and focus
refetch, including strict policy with exact allowances. App source files remain
unchanged except its manifest. The app typecheck fails with a documented data-type
mismatch; this is not a clean production build or evidence of production adoption.
One shutdown exit-5 failure remains unexplained; bounded comparisons passed on
both baseline and changed CLI code, which does not establish its cause. Error,
empty-state and recovery scenarios remain separate validation work.

## Current reference evidence

[Desktop native layout comparisons](validation/2026-10-02-native-reference/README.md)
record the current Compose results and the known SwiftUI symbol mismatch. They
cover the reference harness cases, not every native view or real device.

Release verification now extracts the universal macOS host from the npm runtime
tarball and runs strict E2E on ARM64 and Intel before publication, alongside the
packaged CLI install smoke test. The gate is `scripts/verify-native-release.sh`;
its workflow must pass on the actual release candidate before shipping. Local
ARM64 execution does not replace the Intel runner result.

## Evidence still needed for broader production claims

- Representative independent applications, with documented fixture/setup effort
  and results across navigation, data loading, failure handling and app state.
- Device/reference comparisons for any claimed platform behavior; measured
  mismatches and explicit exclusions.
- Successful strict capability gates on every supported platform for the exact
  release candidate, including the actual packaged binary/architecture slices.
- Windows now requests bounded `taskkill` tree cleanup before killing a live
  runner, preserving failure details when cleanup is incomplete. The new real
  descendant-death tests must pass on Windows CI before this candidate is
  considered verified there. A runner that exits before cleanup remains a
  limitation; this is not Job Object ownership. Session
  client input now uses backpressure with a 32 MiB buffer ceiling, and response
  writes have a deadline. Tests exercise pipelining, oversized lines, stalled
  or closed consumers, cancellation and listener cleanup. Host stdout/stderr is bounded to
  32 MiB per one-shot run or session frame, including unterminated lines and
  console floods. Session tests cover idle floods, retained diagnostics,
  cancellation, hung shutdown and escaped inherited pipes. These host limits
  are separate from the client-input and response-write limits. Embedders must
  still bound their own producer-side buffers and honor stream backpressure.
  A descendant that deliberately escapes the POSIX process group may outlive
  the host; the pipe cutoff bounds the CLI wait, not that escaped process.
  One-shot host deadlines cover native execution after bundling; they do not bound
  Metro startup or compilation.
- Further dependency-upgrade exercises across React Native, Expo and compiled
  libraries, including unsupported combinations. The recorded MMKV patch
  exercise alone does not establish those combinations.

The repository examples and unit tests establish useful regression coverage.
They do not by themselves demonstrate arbitrary-library compatibility or
production adoption across independent apps.
