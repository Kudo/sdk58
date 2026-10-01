# Changelog

All notable changes to `react-native-a11y-tree` and `rn-a11y-host`. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Both packages
share one version.

## [0.1.1] - Unreleased

### Added

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
- Portable text layout for hosts without CoreText: `FANTOM_TEXT_LAYOUT=portable`
  (`RN_A11Y_TEXT_LAYOUT=portable` in `build-host.sh`) measures text with
  `stb_truetype` and the embedded Roboto, including the Compose engine's text;
  the default macOS host still uses CoreText. `getHostInfo()` has `textLayout`.

### Changed

- The host no longer links Homebrew OpenSSL: a CommonCrypto shim provides the
  SHA-256 it needs.

### Fixed

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
