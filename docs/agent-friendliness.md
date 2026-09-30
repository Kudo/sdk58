# Agent-friendliness assessment

Goal: use rn-a11y-tree from `@expo/agent-cli` so an AI agent can check
component behaviour with a fast feedback loop (like `cargo check`), without a
screenshot loop. This is an assessment of the CLI as of 2026-09-29 (no code
changes). Numbers come from [`perf-analysis.md`](perf-analysis.md) unless
marked "estimate".

Summary: a fast agent loop needs three things we do not have by default yet:
a warm engine behind every command, compact outputs that can be queried, and
machine-readable results.

## 1. Friction an agent hits today

- **F1 First run is expensive.** `yarn build:host` needs Java 17, the
  Android SDK's CMake, Xcode and about 5 minutes for the first build
  (Hermes from source). The host is macOS arm64 only. A cold Metro build
  takes about 5.4 s, 33 s of CPU and 1.7 GB of RAM.
- **F2 Every one-shot command pays for Metro.** A warm `render` of the
  medium app is about 1.3 s: Metro about 0.86 s, host about 0.35 s.
- **F3 Output is too big.** 832 nodes give 1.6 MB of pretty-printed JSON.
  Most of it is noise: `layoutDirection: "ltr"` on every node, empty
  `a11y: {}`, `style` pass-through, and repeated `sel` paths. It is too
  much to put in a model's context.
- **F4 No compact or text format and no summary.** The agent must parse
  the whole tree to answer "is the button there, labelled, 48 dp?".
- **F5 No query.** The agent cannot ask for one testID or role, or limit
  the depth or subtree.
- **F6 `ref` values are not stable.** They number nodes in pre-order, so
  they change when the UI changes, and a step's `target.ref` does not match
  the `final` tree. `sel` is stable only for nodes with a `testID`.
- **F7 No diffs.** Snapshots are full trees; the agent compares them
  itself.
- **F8 No check mode.** There are no pass/fail rules for labels, touch
  targets, contrast or design tokens, so the exit code is always 0 when
  rendering works.
- **F9 Errors are not machine-readable.**
  - CLI errors are a prose line on stderr, plus a full JS stack (for
    example "Render failed in JS: …" with a Hermes stack).
  - A step error is only a string in `steps[i].error`.
  - The exit codes are only 0 or 1.
- **F10 stderr noise.** `[console.error] getViewManagerConfig('RNCMaskedView')…`
  (from `@react-navigation/elements`), `[console.warn] DrawerLayoutAndroid
  is deprecated` (from react-native-gesture-handler), and glog lines with
  `-v`. Real app errors are hard to tell apart from this noise.
- **F11 Required and confusing flags.** `--platform` is required, and only
  `android` renders TextInput and Switch (the host implements the Android
  components). `--platform ios` fails for React Navigation (`LinkingImpl`).
- **F12 Latency per step.** A session request is 18–51 ms, but each step
  settles with 2 or more full tree dumps (about 9 ms each for 832 nodes).
  `run` restarts everything on each call.
- **F13 Host gaps an agent could trip on.**
  - `RNSScreenContentWrapper` extends 56 dp below the screen (header height
    not subtracted), so the end of a list can be unreachable.
  - Mounted and layout values differ during animations (the `box` vs
    `visualBox` split).
  - Text is measured with macOS fonts, not Android or iOS fonts.
  - Legacy RNGH attach is a no-op in the host's C++ stub (our JS module
    replaces it through a Metro alias).
- **F14 No published schema or tool descriptions.** The types live only in
  `src/schema.ts`.

## 2. Proposed fixes

Effort: S (hours), M (days), L (weeks). "CLI" means no host change is
needed.

| # | Fix | Effort | Where |
| --- | --- | --- | --- |
| F2, F12 | Warm daemon (below) | M | CLI |
| F12 | ShadowTree revision counter for `settle` | S | host |
| F1 | Prebuilt host download | M | CI + CLI (Linux build: L, host) |
| F1 | Hermes bytecode for the bundle, plus minify | S–M | CLI |
| F3, F4 | `--format json\|compact\|text\|ndjson` | S | CLI |
| F5 | `--select`, `--depth`, `--subtree` | S | CLI |
| F6 | Stable node keys | S | CLI |
| F7 | Diffs between steps | S | CLI |
| F8 | `check` command with rules | M | CLI (contrast: S host) |
| F9 | JSON errors and an exit code table | S | CLI |
| F10 | `--quiet` and a `logs` array | S | CLI |
| F11 | Config file / presets | S | CLI |
| F13 | Content wrapper height; iOS modules | S–M | host |
| F14 | JSON Schema and MCP-style tool descriptors | S | CLI |

Details:

- **F2 + F12 Warm daemon (M, CLI).** `rn-a11y-tree daemon` keeps Metro (as
  a server with a file watcher) and one host per app alive. It rebundles
  only the changed modules (estimate: about 100 ms instead of 860).
  `render`, `run` and `check` connect to it through a unix socket, starting
  it on first use, with `--no-daemon` to opt out. The session protocol is
  the transport; it needs one new request, `reload` (new bundle,
  re-render). Host startup is about 50 ms, so `reload` can simply restart
  the host process.
- **F12 Cheaper settle (S, host).** The host exposes a ShadowTree revision
  counter; `settle` compares that instead of full `getA11yTree` dumps.
  Estimate: saves about 20 ms of each 37 ms session request.
- **F1 Prebuilt host (M, CI + CLI).** CI publishes a signed
  `rn-a11y-host` per architecture (it is now one static 9 MB file), and the
  CLI downloads it on first use. The version key is the same as the CI
  cache key: submodule commit, native library versions, overlay hash. A
  Linux build is L (host work: text layout, platform code).
- **F1 Hermes bytecode (S–M, CLI).** Compile the bundle with the `hermesc`
  from `hermes-compiler` (already in `node_modules`) and minify. Bundle
  evaluation is about 150 ms today (the largest host phase); bytecode should
  cut most of it (not measured). It also makes the output of Metro smaller
  (5.5 MB today).
- **F3 + F4 Output formats (S, CLI).** `--format json|compact|text|ndjson`.
  - `compact`: leaves out defaults and empty fields (`layoutDirection`,
    empty `a11y`, `virtual: false`, ...), 1-line JSON, and no `style`
    unless `--style` is given.
  - `text`: one indented line per node, for example
    `n12 Pressable #submit role=button "Submit" {24,252,342x48}`.
  - `ndjson`: one node per line, for streaming and `grep`.
  - Estimate: 20–50x smaller than today's JSON.
- **F5 Query (S, CLI).** `--select 'testID=submit'`, `--select
  'role=button'`, `--select 'name~Sign'`, `--depth N`, `--subtree <sel>`.
  The runtime already has the target lookup logic (`runtime/tree-index.js`).
- **F6 Stable refs (S, CLI).** A node's key is its `testID` when set, else
  a key made from the path of types below the nearest keyed ancestor
  (`#list>View:3>Paragraph`). Keep `ref` for one tree, add `ref@step` where
  needed, and accept `sel` as a target in actions.
- **F7 Diffs (S, CLI).** `run --diff` and the session request
  `{"diff": true}` return added, removed and changed nodes (props, box,
  text, state) between steps, keyed by the stable key.
- **F8 `check` command (M, CLI; contrast needs S host work).** Rules in a
  small JSON DSL:
  - accessible elements have a `name`;
  - touch targets are at least 48x48 dp (44 on iOS), measured on
    `visualBox`;
  - no hidden focusable elements;
  - text contrast against the effective background (the host would add a
    computed background color per node);
  - design tokens from a JSON file (spacing grid, allowed colors and fonts).

  Output: a list of violations `{rule, sel, expected, actual}`; exit code 2
  when any fail.
- **F9 Errors and exit codes (S, CLI).**
  - A JSON error object `{code, message, hint, details}` on stderr, or in
    stdout with `--format json`.
  - Codes: `HOST_MISSING`, `HOST_UNAVAILABLE`, `BUNDLE_FAILED`,
    `APP_THREW`, `TARGET_NOT_FOUND`, `TARGET_COVERED`, `TIMEOUT`,
    `HOST_CRASHED`.
  - Exit codes: 0 ok, 1 usage, 2 check failed, 3 bundle, 4 app error,
    5 host.
  - A step error becomes `{code, message}` instead of a string.
- **F10 Noise (S, CLI).** `--quiet` (the default for agents). App console
  output goes into a `logs` array in the result; the known React Native
  deprecation and MaskedView messages are tagged `known: true`.
- **F11 Platform presets (S, CLI).** Keep `--platform` required for
  humans, but let a config file (`a11y-tree.json`) or
  `--preset android-phone` set platform, viewport, safe area insets and
  header height in one place.
- **F13 Host gaps (S–M, host).** Subtract the header from the screen
  content height; add stubs for the iOS core modules that React Navigation
  needs (for example `LinkingManager`) if iOS matters.
- **F14 Schema and tool descriptions (S, CLI).** Generate a JSON Schema
  from `src/schema.ts`. Ship MCP-style tool descriptors for `render`,
  `act`, `query`, `diff` and `check`, each with an input schema and an
  example.

## 3. What `@expo/agent-cli` would need from us

- **Transport: a subprocess with a JSON-lines protocol.** Use the existing
  session protocol, extended with `reload`, `query`, `diff`, `check` and
  `format`. I recommend this over a library API: the host is a native
  binary, Metro is heavy, and the process boundary keeps the agent CLI's own
  process light and crash-safe.
- **A small TS client** published with the package:
  `createSession({file, preset}) → {act, query, diff, check, reload, close}`.
  It spawns or attaches to the daemon and returns typed results based on
  the JSON Schema.
- **Stability promises:**
  - a versioned protocol, with `protocolVersion` and `capabilities` in the
    `ready` line (`capabilities` exists already);
  - stable node keys;
  - the error code and exit code tables;
  - a guarantee that stdout carries only protocol lines (true today for
    `session`).
- **Distribution.** A prebuilt host keyed by version and installed
  automatically, so that `npx` works on macOS with no toolchain. On
  unsupported machines, fail with a clear `HOST_UNAVAILABLE` code.
- **Performance targets** (estimates): with a warm daemon and bytecode,
  edit → result below 300 ms; per-step latency below 30 ms once the settle
  revision check exists.

## Suggested order

1. `--format compact|text`, `--select`/`--depth`, JSON errors and exit
   codes, stable keys (all S, CLI only).
2. The daemon with `reload`, as the engine behind the one-shot commands.
3. The `check` command, then the prebuilt host download.
