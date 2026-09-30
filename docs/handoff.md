# Hand-off (2026-09-30)

This file lets a new session continue the project without the chat history.
Everything here was observed in this repository or on its CI. Dates are absolute.

## What this is

`react-native-a11y-tree` renders a React Native `.tsx` file headlessly and prints
the accessibility/layout tree as JSON or text. It uses the real toolchain:

- Metro via `@expo/metro-config` (Expo SDK 58), bundle platform from `--preset`
  or `--platform`.
- A headless React Native Fabric host: Meta's Fantom tester (React Native
  `0.88-stable`, Hermes) plus our overlay in `native/overlay/`. Layout is real
  Yoga; text is measured with CoreText on macOS.
- Native libraries compiled from `node_modules` into the host:
  react-native-screens 4.28, react-native-safe-area-context 5.9.1,
  react-native-gesture-handler 3.2.1, react-native-reanimated 4.7.0,
  react-native-worklets 0.13.0, expo-modules-core + `@expo/ui` 58.0.9.
- `@expo/ui` layout is emulated by two C++ engines (SwiftUI and Jetpack
  Compose) that were validated against real SwiftUI (macOS harness, iOS
  simulator) and real Compose (Compose Desktop harness). See
  `docs/expo-ui-status.md`.

Read `README.md` first (CLI reference, schema, how it works, build), then
`native/README.md` (host internals, every NativeFantom method, gotchas).

## State on 2026-09-30

- Repository: https://github.com/Kudo/react-native-a11y-tree (private), branch
  `main` at `7934efd`, 127 commits. Local checkout: `~/Developer/react-native-a11y-tree`.
- Released: `v0.1.0` (tag = `e917634`). Assets on the GitHub release:
  `react-native-a11y-tree-0.1.0.tgz` (137 KB), `rn-a11y-host-0.1.0.tgz`
  (4.9 MB, macOS arm64 host), raw host archive + sha256 + `host-version.json`.
  The tarballs were verified in a scratch project and handed to the user for a
  manual `npm publish` (host package first). Both npm names were free on
  2026-09-30. Nothing has been published by the agent.
- Unreleased: `0.1.1` (versions already bumped, `CHANGELOG.md` has the section).
  Contents: device metrics from presets (`--scale`, `--font-scale`; before this
  `Dimensions`/`PixelRatio` were 1280x720 / scale 0), real iOS `TextInput`/`Switch`
  under `ios` presets, iOS-only `KeyboardObserver`/`LinkingManager` JS stand-ins,
  e2e matrix over `android-phone` and `ios-phone`, universal arm64+x86_64 macOS
  host (`RN_A11Y_HOST_ARCH`), OpenSSL-free host (CommonCrypto shim), release
  workflow builds the x86_64 slice and checks it on `macos-15-intel`.
- CI: `.github/workflows/ci.yml` (`test` + Release ASan/UBSan `sanitize` jobs)
  and `release-host.yml` (on `v*` tags). Last green run on `main`: commit
  `60af98a`. Commits after it (`72d5b6c`..`7934efd`) are verified locally
  (`bun run check`: 78 unit, 25 e2e, host rebuilt) but NOT on CI, because GitHub
  Actions is blocked by the account spending limit ("The job was not started
  because recent account payments have failed or your spending limit needs to
  be increased"). The user said the limit resets in October 2026.
- Linux: the host builds and runs on Linux arm64 with workarounds (branch
  `ci/linux-feasibility`, run 36720960506, report in
  `docs/research/linux-feasibility.md` on that branch, worktree
  `~/Developer/rn-a11y-linux-feasibility`). Text is 0-height there (stub text
  layout manager). Windows: not started. macOS x86_64: built by cross-compile,
  never executed locally (no Rosetta on the dev Mac; verified only by the
  `intel-check` CI job once Actions runs).

## First things to do in a new session

1. `cd ~/Developer/react-native-a11y-tree && git status && git log --oneline -3`.
   The submodule `third_party/react-native` always shows as modified (the
   overlay is rsynced into it); ignore that.
2. Check GitHub Actions: `gh run list --repo Kudo/react-native-a11y-tree --limit 3`.
   If runs start (not "job was not started"), re-run CI on `main`
   (`gh workflow run ci.yml --ref main` or push an empty commit), wait for
   green, then tag `v0.1.1`:
   `git tag -a v0.1.1 -m "v0.1.1" && git push origin v0.1.1`.
   The release workflow builds the universal host, runs the Intel check,
   packs both packages, and creates the GitHub release with notes from
   `CHANGELOG.md`. Download the two `.tgz` assets, verify them in a scratch
   project (see "Verify a release" below), and give them to the user.
3. Ask the user which of these is next (they had not answered on 2026-09-30):
   (a) Linux host (stub text first, then HarfBuzz+FreeType text),
   (b) `@expo/agent-cli` integration PR, (c) Windows spike. The agent's
   recommendation was: publish 0.1.1 -> (b) -> (a) -> Windows.

## Commands

```
bun install
bun run build:host            # Release, arm64; ~5 min first time, ~10-60 s incremental
bun run check                 # tsc + schema check + unit tests + e2e (both presets)
bun run test | bun run test:e2e
bun run rn-a11y-tree render examples/basic/App.tsx --preset android-phone --format text
bun run rn-a11y-tree run examples/basic/App.tsx --preset ios-phone --script examples/basic/actions.json --format text
bun run rn-a11y-tree check examples/basic/App.tsx --preset android-phone --rules examples/basic/rules-fail.json --format text
RN_A11Y_HOST_BUILD_TYPE=Debug bun run build:host          # 2-3 s incremental native iteration
RN_A11Y_HOST_SANITIZE=1 RN_A11Y_HOST_BUILD_TYPE=Release bun run build:host   # ASan+UBSan+vptr host
RN_A11Y_HOST_ARCH=universal bun run build:host            # arm64 + x86_64 (x86_64 Hermes ~90 s)
bun scripts/release-host.ts --pack                        # stage packages/rn-a11y-host/osx-bin
bun scripts/perf.ts                                       # perf tables (docs/perf-analysis.md)
```

Toolchain on the dev Mac: Xcode 26.6, JDK 17 at `/opt/homebrew/opt/openjdk@17`
(`build-host.sh` defaults `JAVA_HOME` to it), Android SDK at
`~/Library/Android/sdk` (only its cmake 3.30.5 and an NDK are used by RN's
Gradle; nothing Android is compiled), Homebrew cmake/ninja, Bun 1.3.14,
Node 26. Homebrew OpenSSL is no longer needed.

Fantom integration tests (`native/tests/*-itest.js`) run inside a React Native
checkout with the overlay applied:
`third_party/react-native` on CI, or the dev clone `~/Developer/react-native`
(0.88-stable, commit 6007151, overlay rsynced, Debug tester at
`private/react-native-fantom/build/tester/`). Command: `yarn fantom <Name>`
from the RN checkout root (Yarn 1 via `corepack yarn@1.22.22`). Prerequisites
for the Expo UI test are listed in `native/README.md` ("Expo UI").

## Verify a release

```
mkdir /tmp/pkgtest && cd /tmp/pkgtest && npm init -y
cp ~/Developer/react-native-a11y-tree/examples/basic/App.tsx .
npm install expo@58.0.0 react-native@0.88.0-rc.2 react@19.3.0 <cli.tgz> <host.tgz>
npx rn-a11y-tree render App.tsx --preset android-phone --format text -v
# expect: "host: package ... (protocol 1)" and a line "submit View #submit role=button ..."
```

## Rules learned the hard way

- Never run `bun run build:host` while `git status native/overlay` shows
  uncommitted files from someone else: the script rsyncs the whole overlay into
  the submodule and builds it. Use `RN_A11Y_OVERLAY_DIR` with a `git
  checkout-index` export if you must build from the index.
- Commit by explicit path (`git commit -m ... -- <paths>`). Several agents
  shared one index; a plain `git commit` swept in other people's staged files.
- `ShadowNode::getSealed()` is always `true` in React Native Release builds.
  Do not use it for ownership decisions. The Expo Host frame writer uses
  `LayoutContext::affectedNodes` instead (see `FantomExpo.cpp`, and the
  "use-after-free" entries in `CHANGELOG.md`).
- A Debug sanitizer build did not reproduce that bug; a Release sanitizer build
  did. The `sanitize` CI job therefore builds Release.
- `release-host.ts` writes to `release/` (git-ignored). It used to write into
  `dist/`, which leaked a 4.7 MB archive into the CLI tarball. `test/pack.test.ts`
  guards this.
- CI runners: macOS 15 with Xcode 26.3 (dev Mac has macOS 26 / Xcode 26.6).
  The runner's NDK differs from RN's pin; `build-host.sh` exports
  `ANDROID_NDK`/`ANDROID_NDK_VERSION` to satisfy Gradle without downloading.
- GitHub Actions concurrency cancels the in-progress `main` run on every push;
  batch pushes when a run must finish.
- Rosetta is not installed on the dev Mac (decided not to install it).
- The user's requirements (from the chat): true Metro and true Fabric, no fake
  renderer, no text heuristics; `--platform` must be explicit (presets set
  it); the tool must stay a standalone one-shot CLI (no daemon); Bun as package
  manager; Node runtime for the CLI; RN submodule keeps Yarn 1.

## Where things live

| Area | Path |
|---|---|
| CLI (TypeScript, Node) | `src/` (`cli.ts`, `bundle.ts`, `host.ts`, `tree.ts`, `check.ts`, `session.ts`, `presets.ts`, `schema.ts`) |
| Runtime bundled into the app entry (TypeScript, `tsc -p runtime`) | `runtime/` (`entry-template.ts`, `actions.ts`, `settle.ts`, `fantom/` vendored Fantom runtime, `gh/` gesture-handler JS module, `expo/` Expo prelude, `hostConfig.ts`) |
| Host overlay over Fantom | `native/overlay/tester/` (`CMakeLists.txt`, `src/components/*` custom shadow nodes, `src/render/A11yTree.cpp`, `HitTest.cpp`, `src/reanimated/`, `src/expoui/layout/` SwiftUI engine, `src/expoui/compose/` Compose engine, `src/platform/macos/` CoreText text + fonts, `src/stubs/crypto/`) |
| Fantom itests | `native/tests/` |
| Reference harnesses | `native/tools/swiftui-ref/` (real SwiftUI, macOS + iOS sim), `native/tools/compose-ref/` (Compose Desktop), `native/tools/*-layout-test/` (engine vs reference) |
| Host build script | `scripts/build-host.sh`; release packaging `scripts/release-host.ts` |
| Packages | root = CLI; `packages/rn-a11y-host/` (hermesc-style `osx-bin/`, `linux64-bin/`, `win64-bin/`) |
| Docs | `docs/agent-friendliness.md`, `docs/build-analysis.md`, `docs/perf-analysis.md`, `docs/expo-ui-status.md`, `docs/e2e-coverage.md`, `docs/research/*` |
| Schemas / tool descriptors | `schema/*.json`, `tools/*.json` (regenerate with `bun run schema`) |

## Known gaps (as of 0.1.1)

- Hosts exist for macOS only (arm64 built and tested; x86_64 slice built,
  verified only on CI). Linux: feasibility done, not productized. Windows: none.
- Text metrics are macOS CoreText with SF / embedded Roboto, not iOS/Android
  renderers. `@expo/ui` engines: SwiftUI 42/43 cases within 0.5 pt on macOS,
  41/43 on the iOS simulator; Compose 112/112 exact. Unsupported `@expo/ui`
  views are listed in `docs/expo-ui-status.md`.
- Screens: no native transition animations; tabs use iOS names only.
- Reanimated: no bundle mode, sensors, keyboard; layout animations show through
  `mounted`/`effectiveOpacity`.
- Gesture handler: recognition runs RNGH's own web orchestrator in JS; legacy
  (v2) handlers are attached by the JS module, not native.
- `check` contrast ignores images/gradients behind text.

## Next-step plan (proposed, not started)

1. Publish 0.1.1 (blocked on GitHub Actions billing).
2. `@expo/agent-cli` integration: a new command group in its
   `src/commandRegistry.ts` that spawns `rn-a11y-tree` through its
   `subprocess.ts` (that repo's rule is subprocess-only), using `tools/*.json`
   as the contract and the session protocol for multi-step use.
3. Linux host: make the feasibility workarounds real (overlay shim headers,
   CMake guards, static ICU, Linux branch in `build-host.sh`, CI job), then a
   portable text stack (HarfBuzz + FreeType + ICU line breaking) replacing the
   three CoreText files.
4. Windows spike (ReactCxxPlatform + folly under MSVC).
5. Later: SwiftUI symbol table growth, `lineLimit` edge cases, Reanimated
   sensors/keyboard, `check` rule additions (design tokens per project).
