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
libraries can use explicit Expo/TurboModule fixtures; the AsyncStorage example
exercises its real JavaScript wrapper with an in-memory callback contract. Native
UI libraries may additionally need Fabric descriptors, layout, event handling,
and host integration. A generic fixture object cannot supply those behaviors.

For each maintained adapter, record the tested package version, supported methods,
unsupported operations, observable diagnostics, and regression examples. Test
caught unsupported errors as well as successful actions: a caught exception must
not turn an unsupported native operation into a clean validation result.

When updating React Native or compiled libraries, rebuild the host and run both
preset suites and platform CI. Update `TESTED_DEPENDENCIES` deliberately; a test
checks it against installed workspace versions. Review changed native contracts
before expanding version claims. Application-specific fixtures stay app-owned,
which avoids maintaining an open-ended library of invented native behavior here.

## Evidence still needed for broader production claims

- Representative independent applications, with documented fixture/setup effort
  and results across navigation, data loading, failure handling and app state.
- Device/reference comparisons for any claimed platform behavior; measured
  mismatches and explicit exclusions.
- Successful strict capability gates on every supported platform for the exact
  release candidate, including the actual packaged binary/architecture slices.
- Further stress coverage for excessive app output and Windows runner descendants.
  One-shot host deadlines cover native execution after bundling; they do not bound
  Metro startup or compilation.
- Dependency-upgrade exercises and a published support matrix based on those
  runs, including unsupported combinations.

The repository examples and unit tests establish useful regression coverage.
They do not by themselves demonstrate arbitrary-library compatibility or
production adoption across independent apps.
