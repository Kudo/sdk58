# Changelog

All notable changes to `react-native-a11y-tree` and its native runtime packages. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). The CLI and platform packages
share one version.

## [0.1.1] - Unreleased

### Added

- Scoped optional runtime packages: `@react-native-a11y-tree/runtime-darwin-universal`,
  `@react-native-a11y-tree/runtime-linux-x64-gnu`, and
  `@react-native-a11y-tree/runtime-win32-x64-msvc`, selected by OS/CPU/libc.
  The CLI resolves these direct optional dependencies within its single
  JavaScript bundle, including Commander. There are no required npm JavaScript
  dependencies and only one executable CLI entry. The separate `rn-a11y-host` npm package is no longer
  needed; binary filenames and `RN_A11Y_HOST_*` overrides are preserved.
- Device metrics from presets: `Dimensions` (window and screen) and
  `PixelRatio` follow the viewport, `scale` (phones 3, tablets 2) and
  `fontScale` (1); new `--scale` and `--font-scale` flags and `a11y-tree.json`
  keys. The host sets them with `NativeFantom.setDeviceMetrics` before the app
  module loads (capability `deviceMetrics`).
- Real iOS `TextInput` (CoreText measured) and `Switch` (51x31) under `ios`
  presets, with typing (`setTextInputTextByTag`).
- JS stand-ins for the iOS-only `KeyboardObserver` and `LinkingManager`
  modules: every example renders and runs with `--preset ios-phone`.
- The e2e suites run under both `android-phone` and `ios-phone`
  (`RN_A11Y_E2E_PRESETS`), with per-preset expectations; new
  `examples/dimensions`.
- Universal macOS host: `RN_A11Y_HOST_ARCH=arm64|x86_64|universal` in
  `build-host.sh` (`native/dist/universal/`).
- Windows x64 host: `build-host.sh` in Git Bash writes
  `native/dist/x86_64/rn-a11y-host.exe` (Hermes with MSVC, the tester with
  clang-cl, `/MT`, static ICU, portable text layout); the CLI finds it, finds
  `hermes-compiler`'s `win64-bin/hermesc.exe`, and compiles bytecode in the
  background without `/bin/sh`. `RN_A11Y_HOST_RUNNER` starts the host through
  another program (tests: `bun` for the script fake host). CI:
  `.github/workflows/windows-host.yml`.
- Linux x64 host: built in a `manylinux_2_28` container (runs on glibc 2.28
  and newer: Debian 10+, RHEL 8+, Ubuntu 20.04+), `build-host.sh` Linux branch,
  static libstdc++ and static ICU 74.2 (`scripts/build-icu.sh`) with the data
  trimmed to what Hermes uses (`scripts/icu-data-filter.json`; 31 MB to 2 MB),
  ICU's default locale fixed to `en_US` so `LANG` does not change the output,
  a portable SHA-256 instead of OpenSSL. CI: `.github/workflows/linux-host.yml`
  (also runs the e2e suite with the host inside debian:10 and ubuntu:20.04).
- `release-host.ts --pack` stages the runtime packages on any OS
  (`--packages-dir <dir>`, `--bin <slot>=<file>`, `--artifacts <dir>`).
  Each binary package carries its own `host-version.json`; the release
  workflow packs the CLI and three runtimes, then verifies scratch-project
  installs on Linux, macOS, and Windows.
- `--tz <zone>`: the host runs with `TZ=UTC` unless `--tz` says otherwise, so
  date strings do not depend on the machine (the Windows host reads POSIX
  values like `JST-9` only; an IANA name there gives a warning).
- Script files: `{"$schema": ..., "actions": [...]}` (a bare array still
  works); `run` / `check` / `session --help` list every action;
  `rn-a11y-tree schema [name]` prints or lists the JSON schemas.
- Agents: a target that is not found names the closest `testID` / `key` /
  `sel` ("Did you mean ...") or the testIDs in the tree; `session --format`,
  `--select`, `--depth`, `--subtree`, `--style` set the ready tree and the
  default response trees.
- Portable text layout for hosts without CoreText: `FANTOM_TEXT_LAYOUT=portable`
  (`RN_A11Y_TEXT_LAYOUT=portable` in `build-host.sh`) measures text with
  `stb_truetype` and the embedded Roboto, including the Compose engine's text;
  the default macOS host still uses CoreText. `getHostInfo()` has `textLayout`.

### Changed

- The CLI package: `bin` is `dist/rn-a11y-tree.js` (one ES module built with
  `bun build`); it ships `runtime/*.ts` (Metro compiles them). All sources are
  TypeScript (`erasableSyntaxOnly`); scripts run with Bun; the tests run with
  Vitest (`unit` and `e2e` projects). No `tsx`, no `bin/` wrapper.
- The host no longer links Homebrew OpenSSL: a CommonCrypto shim provides the
  SHA-256 it needs.

### Fixed

- `--font-scale` now scales text (the surface's `fontSizeMultiplier`), as
  the device font size does; before it only changed `PixelRatio` and
  `Dimensions`.
- `Dimensions` / `PixelRatio` reported 1280x720 and scale 0 under every
  preset.
- `check`: the contrast rule skips the iOS `TextInput` like `AndroidTextInput`.

## [0.1.0] - 2026-09-30

First release. macOS arm64 host only.

### Added

- `render`: real Metro bundle and real Fabric (React, ShadowTree, Yoga) in the
  headless Fantom host; accessibility and layout tree as JSON.
- Text measurement with CoreText (`TextLayoutManager`).
- Accessibility tree from the host's typed ShadowTree dump
  (`NativeFantom.getA11yTree`): roles, names, states, boxes, `visualBox`,
  `effectiveOpacity`, `effectiveBackground`, stable `key`s.
- TextInput and Switch (`AndroidTextInput`, `AndroidSwitch` shadow nodes).
- `run`: tap, long press, typing, scroll, pan, pinch, wait and snapshot actions
  with host hit testing and by-tag native events; `--diff`.
- Scrolling and FlatList (ScrollView state, `onLayout` delivery).
- `session`: JSON-line requests to one rendered app.
- react-native-screens, react-native-safe-area-context,
  react-native-gesture-handler and react-native-reanimated/worklets compiled
  into the host.
- `@expo/ui` (Expo module views) with SwiftUI and Compose layout emulation,
  direct events and modifier callbacks.
- `check`: names, touch target, hidden focusable, contrast and design-token
  rules; exit code 2 on violations.
- Output formats (`json`, `compact`, `text`, `ndjson`) and queries (`--select`,
  `--depth`, `--subtree`); presets (`--preset`) and `a11y-tree.json`.
- Bundle cache and Hermes bytecode (about 190 ms for an unchanged app).
- Machine-readable errors and exit codes; `--quiet` with `logs`.
- JSON schemas (`schema/`) and MCP-style tool descriptors (`tools/`).
- Prebuilt host download (`RN_A11Y_HOST_BASE_URL`) and the `rn-a11y-host` npm
  package (`getHostPath()`, hermesc layout).
- Host protocol check: `NativeFantom.getHostInfo()` / `protocolVersion`
  (`HOST_INCOMPATIBLE`); `hostInfo` in the JSON output.
- In a repo checkout, a fresh `native/dist` host outranks the staged
  `rn-a11y-host` package; `-v` prints the chosen host.
- CI `sanitize` job: Release host with AddressSanitizer and
  UndefinedBehaviorSanitizer running the native e2e suites.

### Fixed

- Heap use-after-free in the `@expo/ui` Host frame writing in release builds
  (SIGSEGV on macOS 15).

[0.1.1]: https://github.com/Kudo/react-native-a11y-tree/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Kudo/react-native-a11y-tree/releases/tag/v0.1.0
