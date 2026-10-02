# TanStack Query full React Native example pilot

**Result: the complete upstream application passed the integrated flow on both
presets**, normally and with explicit strict-policy allowances. The source was
not reduced to an isolated screen. This is an externally maintained example-app
pilot with a deliberate dependency upgrade, not evidence of production adoption
or native/device parity. The unchanged application's TypeScript check fails;
this is not a claim of a clean production build.

## Upstream and changes

Source: [TanStack/query, revision 29859ae60c8dca0a5cdbf8abccc775b655cf43e2](https://github.com/TanStack/query/tree/29859ae60c8dca0a5cdbf8abccc775b655cf43e2/examples/react/react-native).
All 26 files in that directory (254,520 bytes, including assets) and the root MIT
license were fetched into a new temporary app outside this repository. No clone,
credentials, backend, workspace dependency links, or root package/lockfile edits
were needed. The [license](UPSTREAM-LICENSE) is retained here.

Every upstream file except `package.json` remained byte-for-byte unchanged;
[evidence.json](evidence.json) records and verifies their SHA-256 hashes. This
includes the complete `App.tsx`, QueryClient/provider, NavigationContainer,
MoviesStack, both screens, hooks, Babel/app config and bundled movie data.
`pilot-fixtures.ts` is a separate app-owned addition.

The original manifest targets Expo ^57.0.24 / RN ^0.86.3. The isolated manifest
was explicitly upgraded to the host's dependency tuple:

| Dependency | Installed pilot version |
|---|---|
| Expo / React / React Native | 58.0.0 / 19.3.0 / 0.88.0-rc.2 |
| TanStack Query / devtools | 5.104.1 / 5.104.1 |
| React Navigation native / JS stack | 7.5.0 / 7.12.0 |
| NetInfo / React Native Paper | 12.0.1 / 5.15.0 |
| Gesture Handler / Reanimated / Worklets | 3.2.1 / 4.7.0 / 0.13.0 |
| Screens / Safe Area | 4.28.0 / 5.9.1 |
| Expo Constants / Status Bar | 58.0.9 / 58.0.1 |

Full original/final manifests and resolved direct dependencies are in the evidence.
[app-package.json](app-package.json) and [app-package-lock.json](app-package-lock.json)
are copies from the isolated app, not changes to this repository's dependency graph.
Installation used `npm install --ignore-scripts --no-audit --no-fund --legacy-peer-deps`.
Peer enforcement and lifecycle scripts were deliberately disabled; success does not
certify all peer requirements or a native build. `npm ls --depth=0 --json` exited 0.

## Exercised integrated flow

Four complete sessions passed: normal Android and iOS presets, then both with
strict policy and exact allowances. Each session starts the real `App.tsx`:

1. Initial loading tree has no resolved movie row.
2. Advance host timers 2500 ms; the real list contains Rush and Prisoners.
3. Find the actual “Rush 2013” button in the returned tree and tap its current ref.
4. Observe “Rush (2013)” in partial details, without the plot yet.
5. Advance 2500 ms; assert the upstream plot and actor text arrive.
6. Find and tap the actual back button; assert the detail title disappears and
   the list returns.
7. Assert upstream console logs include a detail query and a second `fetchMovies`
   call, proving focus-triggered refetch execution.

The upstream API reads **bundled JSON after a randomized 200–2199 ms timer**.
There is no HTTP request in this flow. The waits exceed that upstream bound;
neither timers nor `Math.random` were replaced. The loading indicator's native
appearance is not verified. Inactive stack screens can remain in the tree during
navigation; assertions use detail content and its removal after back, not blanket
claims about native selected-screen visibility.

Two additional strict renders without allowances correctly exited 6 with
`UNSUPPORTED_NATIVE`. A zero exit alone was never the success criterion: every
session request, step, state transition and query-log assertion was checked.

## Native fixture and exact allowances

[pilot-fixtures.ts](pilot-fixtures.ts) provides only `turbo/RNCNetInfo`:
`getCurrentState()` resolves fixed Wi-Fi, connected/reachable, non-expensive
connectivity. `configure`, `addListener` and `removeListeners` provide the minimal
static subscription contract; listener names/count arguments are checked. No
connectivity transitions, network probes or real reachability are simulated.
The real NetInfo JS wrapper and upstream `useOnlineManager` remain in use.

Strict runs explicitly allow:

| Preset | Exact diagnostic targets |
|---|---|
| Both | `KeyboardObserver`, `LinkingManager`, `turbo/RNCNetInfo` |
| Android additionally | `StatusBarManager`, `AndroidProgressBar`, `AndroidSwipeRefreshLayout` |
| iOS additionally | `ActivityIndicatorView`, `PullToRefreshView` |

These are intentional limitations, not native implementations. Diagnostics remain
in the evidence. No wildcard or dynamically expanded allowance is used by the
published harness. Pull-to-refresh gestures, indicator drawing, keyboard/status
bar effects, deep linking and OS connectivity changes are not verified. No
unsupported API diagnostic was suppressed. A known upstream RNCMaskedView
view-manager warning also remains in captured logs.

## Failed attempts and remaining gaps

- Initial render without setup exited 4 on missing `RNCNetInfo`.
- Adding the connectivity fixture exposed a real migration blocker: Navigation
  Stack 6.4.1 calls `InteractionManager.createInteractionHandle`, removed in RN
  0.88. Upgrading the isolated Navigation packages to 7.5.0/7.12.0 resolved it
  without application-source edits. No compatibility shim was added to the CLI.
- An exploratory action used `sel` as a query expression and produced
  `TARGET_NOT_FOUND` despite process exit 0. The final harness instead discovers
  nodes from each current tree and uses their refs; all step errors are rejected.
- `npm run type:check` exits 2: `MoviesListScreen.tsx:53` passes `Movie[]` to a
  renderer typed `MovieDetails`, whose required `info` field is absent. The source
  itself shows this mismatch. No original-dependency typecheck was run, so this
  report does not attribute the diagnostic to the upgrade.
- Error/failure recovery was **not exercised**. The upstream data module throws
  for an unknown movie, but normal list navigation supplies valid titles. No
  fault-injection replacement was introduced. Empty data, reconnect, background
  lifecycle, gestures, native transitions and device rendering remain unverified.

Recorded setup effort: one temporary app, two bounded npm installs (initial tuple
then Navigation correction), one small native fixture, and a session harness.
The first install took 8647 ms; manual engineering time was not measured. A
harness syntax error was corrected before its first session execution. No core
runner or upstream application-source changes were needed.

## Artifact and source provenance

All four final sessions used the same macOS ARM64 host artifact:
`4059b4db684490664ac26b6932f3fee0a011d824b8e3e19114ae53190171d945` (SHA-256).
Both presets ran on that single host, not separate mobile devices or OS runners.

Start/end fingerprints cover every file under CLI `src/` and `runtime/`, with
HEAD and dirty status recorded per run. All four runs report `sourceStable: true`
and share source fingerprint
`4db7d69396dcb8be59f46f7f7132e0de89a32e3dae071a48cf4959459f9f53d8`.
Per-file hashes are included. This identifies the observed working-tree sources;
HEAD is not a claim of a clean committed checkout. Endpoint fingerprints cannot
exclude a change-and-revert between snapshots. Installed dependency lock and
upstream-file hashes are separate from that CLI/runtime fingerprint.

## Fresh-app reproduction verification

The published `prepare.mjs` completed end-to-end: all 26 upstream files plus MIT
license passed Git blob verification, and `npm ci` installed 571 packages from the
recorded lock in a **new** app (`tanstack-pilot-16KS2n`). The four published flow
commands and both strict rejection commands were then exercised against that app.

All four flows have passing outcomes and all ten assertions; both rejection
helpers exited 0 only after verifying the underlying CLI exited 6 with
`UNSUPPORTED_NATIVE` and nonempty diagnostics. A deliberate negative check allowed
all startup limitations so the CLI exited 0; the helper correctly failed with
exit 1 (`Strict rejection must exit 6`). Source instability also fails the helpers.

**There was one intermittent failure:** the first fresh iOS strict run completed
all ten flow assertions and acknowledged quit, then the CLI exited 5. Its trailing
structured error was not retained by the earlier harness, so the cause is unknown.
The harness now captures trailing protocol errors; one targeted retry passed with
none. This is not six clean first-pass executions, and shutdown reliability is not
certified by this rerun. The failed attempt remains in
[reproduction-evidence.json](reproduction-evidence.json).

Every recorded reproduction run had matching start/end source hashes:
`86a54e07eb1d312c1cadb0a255a597905a97c5df3267f2c7d8d5917c4df5ac2a`.
Each recorded CLI/runtime file was also compared with committed
`d5b3d9867b4c7c2b7d31f6ba49e6888d42c0b9ca` and matched. The Android normal run
straddled that commit's creation with unchanged file contents; its start/end HEAD
values are preserved rather than relabeled. Original pilot evidence remains
separate. Unchanged upstream-file and app-lock hashes were reverified in the fresh
app. No source or runtime files were edited by this reproduction work.

The [fault-scenario proposal](fault-scenarios.md) describes a possible separately
labeled data perturbation experiment. It has not been executed and does not expand
the verified happy-path claims.

## Reproduction

From this CLI repository root, with its local ARM64 host already built:

```sh
node docs/validation/2026-10-02-tanstack-pilot/prepare.mjs
node docs/validation/2026-10-02-tanstack-pilot/flow.mjs android-phone
node docs/validation/2026-10-02-tanstack-pilot/flow.mjs ios-phone
node docs/validation/2026-10-02-tanstack-pilot/flow.mjs android-phone --strict
node docs/validation/2026-10-02-tanstack-pilot/flow.mjs ios-phone --strict
node docs/validation/2026-10-02-tanstack-pilot/run-cli.mjs strict-reject-android \
  render '<APP>/App.tsx' --preset android-phone --format json \
  --setup '<APP>/pilot-fixtures.ts' --fail-on-fallback
```

Repeat the final command with `ios-phone` and a distinct label for iOS rejection.
`prepare.mjs` fetches the exact tree/license, verifies Git blob hashes, copies the
recorded manifest/lock/setup, and runs bounded `npm ci` only in the temp app.
The consolidated preparer and all six commands have now been run against the
fresh app, as recorded above. The original exploratory pilot used the two installs
described earlier.

These scripts target the recorded macOS environment: `/tmp/tanstack-pilot-path`
identifies the app, and the host path is `native/dist/arm64/rn-a11y-host`.
Outputs go to `/tmp/tanstack-*`, leaving committed evidence untouched. Full-flow
scripts check outcomes themselves; `run-cli.mjs` is a strict-rejection verifier
that fails unless status is 6 and the error is `UNSUPPORTED_NATIVE`. Registry/source fetches have 30-second deadlines,
installation 240 seconds, each session 120 seconds and each response 30 seconds.
CLI subprocesses have a 120-second forced-kill backstop. Temporary apps are retained
for inspection and can be removed afterward using the recorded path.

## Bounded shutdown comparison (no reproduced failure)

[shutdown-comparison.json](shutdown-comparison.json) records two bounded batches,
four iOS strict whole-app flows each, at most two concurrent and no artificial
CPU load:

- Current working-tree graceful-shutdown change: **4/4 exit 0**, no terminal
  protocol errors; source fingerprint `57339d4a…`. This batch already included
  the configured `timeoutMs` grace, so it was not testing the old 250 ms implementation.
- Archived baseline `d5b3d98`: **4/4 exit 0**, no terminal protocol errors;
  fingerprint `86a54e07…`, matching the original failed run's source. This used
  `git archive` of the full commit into `/tmp/tanstack-baseline-MP0r4A`, with only
  `node_modules` and `native/dist` symlinked from the shared checkout. The archived
  source still has the original 250 ms shutdown deadline. It has no `.git`, so
  metadata labels its baseline commit explicitly rather than querying git there.

Both batches used the same fresh pilot app/dependency lock and native artifact.
Upstream file and dependency-lock hashes were rechecked after comparison. Each
attempt captured all 11 stdout protocol records, ending with successful quit
`id:10`, plus separate CLI stderr, native stderr, elapsed time, CLI PID/status and
start/end source fingerprints. Unique artifact paths, byte counts and SHA-256
hashes are in the comparison JSON. Raw artifacts remain under:

- `/tmp/tanstack-shutdown-diagnostic-wxk5Nx/attempt-{1,2,3,4}/`
- `/tmp/tanstack-baseline-diagnostic-LKHiFl/attempt-{1,2,3,4}/`

The requested attempt bounds were exhausted and testing stopped. **The original
exit-5 cause remains unknown.** Neither this baseline comparison nor passing
changed-source runs proves that the graceful-shutdown change fixes that original
failure. The original failed attempt and its capture limitations remain recorded.

## Follow-up fault validation

The separate [scenario report](scenario-report.md) records executed empty-list and
detail-query error/recovery flows on both presets, with explicit data and JS
lifecycle fixtures. It extends coverage beyond the historical happy-path runs;
it does not resolve their intermittent shutdown failure.
