# Historical MMKV patch exercise: 4.3.1 → 4.3.2

This is a controlled dependency/fixture regression experiment using the repository's
existing MMKV example, not independent-app adoption evidence. The experiment
holds Nitro and the installed workspace dependency graph fixed while replacing
only the app's real MMKV package. It does not rebuild or upgrade native MMKV:
the host runs the package's JavaScript against explicit application-owned Nitro
HybridObject factories.

## Why these versions

The primary npm registry had no newer stable patch than the installed MMKV
4.3.2, Nitro 0.37.1, Nitro Image 0.15.2, or Expo Router 58.0.12 when checked on
2026-10-02. AsyncStorage 2.2.0 also had no later 2.2 patch; its latest 3.1.1 is a
major upgrade. Accordingly this exercise uses the adjacent historical MMKV
patches **4.3.1 → 4.3.2**, not a claimed forward upgrade beyond HEAD.

Both [4.3.1](https://registry.npmjs.org/react-native-mmkv/4.3.1) and
[4.3.2](https://registry.npmjs.org/react-native-mmkv/4.3.2) declare the same
React, React Native, and Nitro peer requirements (`*`) and no regular dependencies.
Those declarations select a small experiment; they are not proof of compatibility.
The harness checks each downloaded npm tarball against its registry SHA-512
integrity before extracting it. Evidence records both integrity and SHA-256.

## Reproduction

From a checkout with the recorded dependency tuple installed and a built host:

```sh
node docs/validation/2026-10-02-mmkv-upgrade/harness.mjs
# Optional explicit artifact:
RN_A11Y_HOST_BIN=/absolute/path/to/rn-a11y-host \
  node docs/validation/2026-10-02-mmkv-upgrade/harness.mjs
```

[harness.mjs](harness.mjs) downloads the two exact public npm tarballs, creates
separate temporary apps outside the repository, and removes them in `finally`.
Each app has its own extracted MMKV package; other dependencies are explicit
symlinks to this checkout's installed packages. Node resolution must select the
app-local MMKV manifest, and its version must match the intended arm. This is
filesystem isolation with a shared fixed dependency graph, not a fresh npm
installation or independently solved dependency tree. No install scripts run.

The harness copies `App.tsx`, `fixtures.ts`, `actions.json`, and
`empty-fixtures.ts` from `examples/nitro-fixture` byte-for-byte. It verifies their
SHA-256 hashes and supplies setup explicitly. No fixture behavior is changed.
Each CLI invocation uses `NODE_ENV=production`, the recorded host,
`--project-root <APP> --setup <APP>/fixtures.ts --preset <PRESET> --no-cache
--bytecode off`. Finished bundles and bytecode are not reused; Metro's ordinary
transform cache remains enabled. Exact per-run argv is included in the evidence,
with `<APP>` and `<REPO>` placeholders for temporary/checkout paths.

For each version and each of `android-phone` and `ios-phone`, the harness runs:

1. The existing read/write/remove action script: every step succeeds; storage ID
   is the fixture factory ID; saved/loaded/deleted outputs match; both exact
   factory diagnostics and unsupported boxing are present.
2. A save in one process and a load in a fresh process: the save succeeds and the
   new process reads an empty value.
3. Strict render without allowances: exit 6, `UNSUPPORTED_NATIVE`.
4. Strict render with exact allowances for `nitro/MMKVFactory`,
   `nitro/MMKVPlatformContext`, and even `NitroModules.box`: exit 6; the remaining
   rejected diagnostic is exactly `NATIVE_API_UNSUPPORTED` / `NitroModules.box`.

These are five CLI invocations per version/preset (20 total). A subprocess has a
120-second forced-kill backstop. An assertion failure produces failed evidence
and a nonzero harness exit. Rerunning overwrites `evidence.json`.

## Recorded result and source provenance

All **20 CLI invocations passed their expected assertions** on macOS ARM64:
12 normal invocations exited 0, and eight strict invocations correctly exited 6.
Both MMKV versions passed both presets without changing application fixtures.
The recorded host SHA-256 is
`4059b4db684490664ac26b6932f3fee0a011d824b8e3e19114ae53190171d945`.
The resolved fixed tuple was Expo 58.0.0, React 19.3.0, RN 0.88.0-rc.2,
Nitro 0.37.1, Nitro Image 0.15.2 (declared but not exercised), and worklets 0.13.0.

The recorded rerun verifies identical CLI/runtime source fingerprints at start
and finish, and verifies that the host artifact did not change. `sourceStable`
and `success` are both `true`. The source was a working tree based on `f327661`,
with the recorded session/CLI changes; the full per-file hashes and worktree
status identify that snapshot. It is not a claim that the starting HEAD alone
contains the tested changes. Each HTTP request checks its status and has a
30-second deadline. No source changed during these 20 invocations.

A later session-only cancellation fix moves interruption of a pending response
write before the already-stopped-host guard. This experiment exercises one-shot
`run`/`render`, not sessions, and does not validate that later session change.

## Evidence and limits

[evidence.json](evidence.json) records the actual result, checkout HEAD, host
artifact SHA-256, OS/architecture/Node, resolved app tuple, copied-file hashes,
registry artifacts, per-run exit statuses, diagnostics, assertions and timings.
Start/end source snapshots include their capture times.
The two presets select platform behavior in the same local host binary; they do
not represent two operating-system runners or real mobile devices.

The supported claim is limited to the exercised real MMKV JS wrapper contracts
against unchanged application fixtures for these two exact versions. Strict
policy intentionally cannot pass because Nitro's caught worklet bootstrap call
to `NitroModules.box` remains unsupported. This is evidence that the unsupported
operation remains visible, not that cross-runtime boxing works.

Not verified: native MMKV disk persistence, encryption, quotas, native lifecycle,
Nitro C++/JSI ABI compatibility, cross-runtime behavior, Nitro Image drawing or
refs, arbitrary MMKV operations, or unrelated dependency combinations. This
experiment does not expand `TESTED_DEPENDENCIES` or certify a dependency range.

Recorded setup effort: one standalone harness, two temporary app manifests and
package trees, zero changes to the copied example/setup/actions, zero package
manager installs, and zero source/lockfile changes. The first harness attempt
stopped before invoking the CLI because macOS canonicalized `/var` to
`/private/var`; canonicalizing the temporary root fixed that path assertion.
No manual effort duration was measured. Per-run timing is execution time only.
