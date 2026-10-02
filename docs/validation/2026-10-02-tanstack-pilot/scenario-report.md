# Whole-app empty/error/recovery scenarios

**Four strict whole-app sessions passed on Android and iOS presets (42 assertions),
plus two negative strict-policy checks.** These are separate, explicit fault
scenarios. They do not replace or reinterpret the historical happy-path evidence,
including its unresolved intermittent shutdown failure.

## Source and setup boundaries

The real upstream App, QueryClient/provider, NavigationContainer, stack, screens,
query functions and hooks remain unchanged. The temporary app and pinned dependency
lock are the same ones used for reproduction. All upstream files except the already
upgraded manifest were hash-verified after the scenarios, including `movies.json`.
No core files, existing pilot reports, or upstream source files were edited.

The new setup modules import the shared `movies.json` array and mutate it **in
memory**, preserving its module identity. They do not assign ESM exports, replace
API functions, prepopulate Query cache results, or write the JSON file. Each scenario
starts a fresh CLI/host process; mutations do not persist between runs. The existing
fixed-connectivity NetInfo fixture is imported unchanged.

Both setup modules declare their interventions through explicit diagnostics:

- `APPLICATION_FIXTURE` / `pilot/movies-data`: bundled-data perturbation.
- `APPLICATION_FIXTURE` / `pilot/app-state`: JS lifecycle event injection.

Those markers are intentionally emitted by the application-owned setup; they are
not automatic discovery of native support. Two negative checks allowed all normal
pilot targets but omitted these two names. Both exited 6 with `UNSUPPORTED_NATIVE`,
and their rejected-target lists contained exactly these two fixture targets.

## Validated event contract

Before implementation, the installed RN 0.88.0-rc.2 primary sources were read:
`Libraries/AppState/AppState.js` and `Libraries/EventEmitter/NativeEventEmitter.js`.
AppState's `change` subscription listens to `appStateDidChange` and passes
`payload.app_state`; NativeEventEmitter registers through RCTDeviceEventEmitter.
Their exact file hashes are recorded in [scenario-evidence.json](scenario-evidence.json).

The fixtures restore the data, then explicitly emit:

```js
DeviceEventEmitter.emit('appStateDidChange', {app_state: 'background'});
DeviceEventEmitter.emit('appStateDidChange', {app_state: 'active'});
```

A temporary real `AppState.addEventListener('change', ...)` subscription asserts
the delivered sequence is `background,active` and `AppState.currentState` becomes
`active`, then removes itself. The unchanged upstream hook forwards these events
to Query's focusManager. Subsequent upstream query-call logs and rendered results
verify refetch and recovery. This tests the JS event contract, **not native OS
background/foreground delivery**. No AppState methods or provider implementations
were replaced.

## Empty → recovery

[scenario-empty-fixtures.ts](scenario-empty-fixtures.ts) clears the shared array
before App loads. After 2500 ms of host-timer advancement, the real query has
resolved, the list ScrollView exists, and no movie rows appear. Its captured text
is only `Movies`: the upstream app has no dedicated empty-state message.

At fixture time 6000 ms the original array is restored and the explicit lifecycle
transition is emitted. The harness advances another 7000 ms, then asserts Rush
and Prisoners appear and the upstream `fetchMovies` log occurred again. Both
presets passed all nine assertions and exited 0 under strict policy.

## Detail error → in-place recovery

[scenario-error-fixtures.ts](scenario-error-fixtures.ts) initially leaves data
intact. The real list query resolves within its upstream 200–2199 ms delay and
returns fresh title/year objects. At 2600 ms the fixture removes Rush from the
underlying array; the cached list row remains.

The harness reads the list after 2500 ms, advances 200 ms, verifies the removal
log, and taps the actual Rush row by its current tree ref. Navigation renders
partial details using the original route data. The unmodified detail query now
fails with `Movie not found`.

After advancing 12000 ms, the harness asserts the actual ErrorMessage is visible,
that exactly three detail-query calls occurred (initial attempt plus the original
two retries), and that restoration has not happened yet. At fixture time 20000 ms
the original array is restored and the explicit lifecycle transition is emitted.
After another 9000 ms advance, the error disappears and the real detail plot
renders, with another detail-query call recorded. Recovery occurs on the same
detail route; the harness does not replace the screen or re-create App/providers.
Both presets passed all twelve assertions and exited 0 under strict policy.

## Strict allowances and limitations

Every full scenario uses `--fail-on-fallback` and these exact allowances:

| Scope | Targets |
|---|---|
| Both presets | `pilot/movies-data`, `pilot/app-state`, `turbo/RNCNetInfo`, `KeyboardObserver`, `LinkingManager` |
| Android additionally | `StatusBarManager`, `AndroidProgressBar`, `AndroidSwipeRefreshLayout` |
| iOS additionally | `ActivityIndicatorView`, `PullToRefreshView` |

The data functions still use bundled JSON and timers: **no HTTP failure, server
recovery, connectivity transition, or native lifecycle was tested**. Native
indicator drawing, refresh gestures, keyboard/status bar behavior and deep links
remain outside the claim. The known RNCMaskedView/deprecation messages are retained.
The unchanged-source TypeScript mismatch reported by the main pilot is not fixed
or superseded by these runs.

No scenario failure occurred in these four executions. That does not resolve the
historical exit-5 failure or establish general shutdown reliability. No retry
settings, global timers, Math.random, navigation source or core adapters were
changed to make the scenarios pass.

## Reproduction and evidence

After the existing `prepare.mjs` (or using its retained temporary app):

```sh
node docs/validation/2026-10-02-tanstack-pilot/scenario-prepare.mjs
node docs/validation/2026-10-02-tanstack-pilot/scenario-flow.mjs android-phone empty
node docs/validation/2026-10-02-tanstack-pilot/scenario-flow.mjs ios-phone empty
node docs/validation/2026-10-02-tanstack-pilot/scenario-flow.mjs android-phone error
node docs/validation/2026-10-02-tanstack-pilot/scenario-flow.mjs ios-phone error
```

`scenario-prepare.mjs` verifies the recorded upstream, lock and native-fixture
hashes before adding only the two new setup files. It was executed successfully
against the retained fresh app. The four commands were executed successfully;
final harness formatting received syntax validation. Strict mode is mandatory
in this scenario harness. Full argv for the two negative checks is recorded in
the evidence, using the existing rejection verifier.

Each run prints a unique `/tmp/tanstack-scenario-...` artifact prefix. Raw stdout
NDJSON, CLI stderr, native stderr and metadata are kept separately per run, with
paths and SHA-256 hashes in the evidence. Every request/step, final CLI exit and
source stability is asserted. The harness has a 120-second subprocess backstop,
30-second response deadlines, and bounded output capture. Data waits advance
host timers rather than waiting those durations in wall-clock time.

All four sessions reported matching start/end CLI/runtime fingerprints:
`0f3d7b9d6110aea88c2e3f7e584740115975a417d2f1ebd65dbbb110c669c05f`,
with HEAD `3b9ab39cf14b9cf23d0858a24ae35a7c634ae1f9`. Exact per-file hashes and
working-tree status are retained; HEAD alone is not a clean-tree certification.
The same macOS ARM64 native artifact was used for both platform presets; this is
not execution on two mobile operating systems.

The new evidence records four successful sessions, two strict rejections, fixture
and event-contract hashes, exact diagnostics, original query-call logs, source
fingerprints and raw-artifact references. The historical README/evidence files
remain untouched.
