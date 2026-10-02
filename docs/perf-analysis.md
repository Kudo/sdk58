# Runtime performance analysis

## Fresh-process agent loop (2026-10-02)

Measured with `scripts/agent-loop.ts`, the initial CLI hardening changes, and the upstream
`9f0348c` macOS host from CI run 36971306501. Apple M4, Node 26.5.0, macOS arm64;
Android phone preset, default automatic bytecode. Every sample starts a fresh
CLI/host process. Each app starts with a separate empty cache. A disposable
wrapper adds a revision label and the query returns that label; each edit is
verified in the resulting tree. Original app files are unchanged.

| Screen | Cold (one sample) | Unchanged median (range) | Source-edit median (range) |
| --- | --- | --- | --- |
| Medium (navigation/list/form/animation) | 6,821 ms | 772 ms (604–835), n=5 | 1,822 ms (1,393–2,672), n=5 |
| SDK 58 starter Home | 5,491 ms | 461 ms (385–476), n=3 | 1,228 ms (1,165–2,150), n=3 |

Raw samples and phase timings: [medium](perf/agent-loop-medium.json),
[starter](perf/agent-loop-starter.json). These are observations from a shared
machine, not latency guarantees or a before/after optimization comparison.
Background bytecode compilation can contend with later invocations. Edits change
only the wrapper, so this measures a small source edit, not dependency installation
or a large refactor. Output is filtered; the full screen still mounts and is
traversed. No simulator, emulator, Metro server, or daemon is used.

## Router/cache hardening recheck (2026-10-02)

Revision `efb3b23`, the same M4/Node/native-host setup, fresh CLI processes and
separate empty caches. Samples run sequentially, on the same shared machine;
other test work may contend for resources. This is additional coverage, not a
controlled speedup comparison with the earlier samples.

| Screen / preset | Cold (one sample) | Unchanged median (range) | Source-edit median (range) |
| --- | --- | --- | --- |
| Medium / Android phone | 6,414 ms | 571 ms (295–695), n=5 | 1,809 ms (1,520–2,455), n=5 |
| SDK 58 full Router root / iOS phone | 7,736 ms | 644 ms (582–730), n=3 | 2,438 ms (2,105–3,057), n=3 |

Raw samples: [medium](perf/agent-loop-medium-efb3b23.json),
[Router root](perf/agent-loop-router-efb3b23.json). App paths are normalized to
repository-relative paths; timings are unmodified. Each source edit changes the
benchmark wrapper and verifies its revision label in the output. Router root
resolution runs before finished-cache lookup. Native-tab diagnostics still
apply: these timings do not establish native selected-tab visibility or drawing.
No Metro daemon, simulator or emulator is involved.

## Historical measurements (2026-09-29)

The following predates the finished-bundle cache, bytecode support, and revision-
based settling; it should not be used as the current CLI baseline.


Measured on 2026-09-29 with `scripts/perf.ts` on the medium example
(`examples/medium/App.tsx`).

- Machine: Apple M4, 10 cores, 16 GB, macOS 26.5.2, Node v26.5.0.
- Host binaries: single static executables from `bun run build:host`:
  - Release (default): 9,251,344 bytes.
  - Debug (`RN_A11Y_HOST_BUILD_TYPE=Debug`): 73,617,424 bytes.
- App: native stack with 2 screens, safe area, gesture handler root, a
  FlatList of 60 cards (Image, 3 Texts, 2 badges, a Pressable with a11y
  props, a Switch on every 5th card), a form (3 TextInputs, 2 Switches), a
  Reanimated pan box, and a footer with 5 buttons.
  - Tree: **832 nodes** after `render` (834 at the end of `run`, 841 on
    the Settings screen).
  - Output JSON (pretty-printed): **1,598,904 bytes**.
  - Metro bundle: **5,563,801 bytes** (dev=false, not minified).
- The raw results (every iteration) are in `docs/perf/release.json` and
  `docs/perf/debug.json`.

## Methodology

```sh
bun scripts/perf.ts --n 5 --label release --host /path/to/release/rn-a11y-host --out docs/perf/release.json
bun scripts/perf.ts --n 5 --label debug   --host /path/to/debug/rn-a11y-host   --out docs/perf/debug.json
```

- Each scenario runs 5 times after one warm-up render. The tables show the
  median, with the min and max in parentheses.
- Before each iteration the script waits until the CPU is at least 70% idle
  (85% for the second Release run). Other workers built C++ on the same
  machine during the session. A few Release Metro numbers still vary (see
  the min/max values).
- **Wall time and CPU:** the CLI runs under `/usr/bin/time -l`. CPU is
  user + sys of the whole tree: Node, Metro worker threads, and the host,
  which the CLI waits for.
- **Memory:** peak RSS comes from sampling `ps` every 50 ms. "Host" is the
  `rn-a11y-host` process. "Tree" is the sum over the CLI process tree.
- **Phases:** from `--timing`, which prints JSON on stderr. The CLI measures
  with `performance.now()`. The bundle marks points with
  `nativePerformanceNow()`, on the same clock as Metro's
  `__BUNDLE_START_TIME__`.

| Phase | Meaning |
| --- | --- |
| Metro bundle | `src/bundle.ts` `bundle()`: config, file map, graph, transform (cached when warm), serialize, write |
| host startup | host spawn → bundle starts evaluating (Hermes, Fabric, TurboModules, reading the bundle), computed as spawn→result minus the in-bundle total |
| bundle eval | `__BUNDLE_START_TIME__` → end of module setup (all modules of the app evaluated) |
| first render | `Fantom.runTask(root.render(<App/>))` |
| settle | deliver queued events and native state updates until the tree is stable (3 rounds for this app); most of the initial mount work (navigation, FlatList cells, layout) happens here |
| getA11yTree | the native `NativeFantom.getA11yTree` call only |
| JSON convert | `src/tree.ts` conversion + `JSON.stringify` in the CLI |

### Scenarios

| Scenario | Command |
| --- | --- |
| render-cold | `render App.tsx --platform android --timing --reset-cache` (Metro cache cleared) |
| render-warm | `render ... --timing` |
| run-warm | `run ... --script examples/medium/actions.json --timing` (15 steps: type, scroll ×2, tap, pan, navigate to Settings and back, waits, 3 snapshots) |
| session | `session ... --timing`: start + 12 requests (the first 11 actions of `actions.json` and one `tree`) + quit |
| render-no-mounted | `render ... --timing --no-mounted` |
| render-debug-props | `render ... --timing --debug-props` |

## Results: Release host

| metric (median, min–max) | render-cold | render-warm | run-warm | session | render-no-mounted | render-debug-props |
| --- | --- | --- | --- | --- | --- | --- |
| total wall ms | 6006 (5503–6149) | 1855 (1458–2168) | 1817 (1765–2315) | 1754 (1731–1831) | 1297 (1293–1371) | 1306 (1303–1368) |
| CPU ms (user+sys, tree) | 33510 (32760–34100) | 3100 (2760–3160) | 3210 (3140–4080) | 3050 (3040–3180) | 2660 (2640–2770) | 2650 (2630–2790) |
| peak RSS host MB | 173 (172–174) | 172 (165–174) | 184 (182–185) | 184 (183–185) | 173 (173–176) | 173 (173–174) |
| peak RSS tree MB | 1742 (1623–1759) | 724 (660–757) | 753 (734–771) | 742 (734–757) | 727 (698–758) | 732 (725–745) |
| Metro bundle ms | 5401 (4944–5577) | 1366 (1003–1648) | 863 (857–1385) | - | 856 (851–933) | 855 (849–934) |
| host startup ms | 88 (84–90) | 53 (52–80) | 63 (63–64) | 48 (47–88) | 51 (50–79) | 51 (50–51) |
| host spawn→result ms | 446 (433–466) | 369 (366–401) | 795 (790–852) | 349 (343–394) | 346 (343–379) | 354 (349–356) |
| bundle eval ms | 174 (170–189) | 156 (154–157) | 148 (147–161) | 150 (146–154) | 148 (147–151) | 149 (147–150) |
| first render ms | 14.1 (13.8–14.7) | 11.6 (11.4–12.9) | 11.1 (10.8–16.0) | 10.6 (10.6–10.7) | 10.9 (10.7–11.2) | 11.2 (10.8–11.3) |
| settle ms | 158 (152–162) | 138 (137–142) | 128 (126–165) | 127 (126–128) | 126 (125–128) | 128 (127–131) |
| actions ms (15 steps) | - | - | 444 (440–477) | - | - | - |
| getA11yTree ms | 10.0 (9.8–10.3) | 9.0 (8.9–9.1) | - | 10.2 (9.9–10.3) | 8.7 (8.5–8.8) | 13.9 (13.7–14.7) |
| JSON convert ms | 5.4 (5.1–5.7) | 5.0 (4.9–5.4) | 20.1 (18.7–23.1) | - | 4.7 (4.6–5.2) | 5.5 (5.1–6.2) |
| session request ms (client) | - | - | - | 37 (18–52) | - | - |

Session requests, median by kind: `wait` 18 ms, `tree` 34 ms, `type` 38 ms,
`scroll` 46 ms, `tap` 50 ms, `pan` 50 ms, `snapshot` 51 ms. Session start
(spawn → ready): 394 ms.

## Results: Debug host

| metric (median, min–max) | render-cold | render-warm | run-warm | session | render-no-mounted | render-debug-props |
| --- | --- | --- | --- | --- | --- | --- |
| total wall ms | 5286 (5260–5573) | 1774 (1766–1896) | 6050 (6030–6140) | 5121 (5013–5165) | 1765 (1764–1780) | 1819 (1813–1918) |
| CPU ms (user+sys, tree) | 31080 (30930–31360) | 3120 (3110–3240) | 7510 (7430–7900) | 6490 (6390–6510) | 3110 (3100–3190) | 3200 (3160–3290) |
| peak RSS host MB | 193 (192–194) | 193 (192–194) | 203 (202–208) | 203 (203–204) | 192 (192–193) | 194 (194–195) |
| peak RSS tree MB | 1760 (1674–1791) | 773 (763–774) | 779 (767–780) | 766 (743–779) | 770 (767–775) | 765 (748–776) |
| Metro bundle ms | 4225 (4208–4544) | 861 (854–974) | 868 (858–886) | - | 850 (848–883) | 862 (850–957) |
| host startup ms | 138 (131–177) | 111 (108–112) | 124 (122–126) | 103 (103–104) | 111 (109–112) | 109 (109–111) |
| host spawn→result ms | 929 (903–957) | 819 (813–873) | 5079 (5051–5150) | 815 (812–897) | 814 (812–817) | 870 (867–960) |
| bundle eval ms | 180 (175–183) | 155 (152–156) | 154 (153–160) | 155 (153–155) | 154 (152–156) | 155 (153–157) |
| first render ms | 13.3 (12.6–13.7) | 11.6 (11.5–11.7) | 12.0 (11.3–12.4) | 11.3 (11.0–11.5) | 11.5 (11.5–12.0) | 11.7 (11.4–11.8) |
| settle ms | 485 (479–488) | 440 (437–496) | 440 (439–452) | 441 (440–523) | 437 (436–439) | 440 (439–529) |
| actions ms (15 steps) | - | - | 4344 (4323–4398) | - | - | - |
| getA11yTree ms | 107.1 (104.9–107.4) | 100.3 (100.2–100.6) | - | 102.1 (101.6–102.3) | 99.8 (99.7–99.9) | 152.9 (152.6–153.4) |
| JSON convert ms | 5.5 (5.1–5.9) | 5.2 (4.9–5.3) | 22.9 (21.2–23.7) | - | 4.8 (4.6–5.2) | 5.4 (5.2–5.6) |
| session request ms (client) | - | - | - | 310 (110–399) | - | - |

Session requests, median by kind: `tree` 110 ms, `wait` 203 ms, `scroll`
306 ms, `snapshot` 311 ms, `type` 322 ms, `pan` 323 ms, `tap` 328 ms.
Session start: 814 ms.

## Debug vs Release (host phases, medians)

| | Debug | Release | Release speed-up |
| --- | --- | --- | --- |
| host spawn→result (render warm) | 819 ms | 369 ms | 2.2x |
| host startup | 111 ms | 53 ms | 2.1x |
| settle | 440 ms | 138 ms | 3.2x |
| getA11yTree (832 nodes) | 100.3 ms | 9.0 ms | 11x |
| run: 15 actions | 4344 ms | 444 ms | 9.8x |
| session request | 310 ms | 37 ms | 8.4x |
| peak RSS host | 193 MB | 173 MB | −20 MB |
| bundle eval | 155 ms | 156 ms | same (Hermes itself is optimized in both) |

## Findings

1. **Metro dominates `render` and `run` with the Release host.**
   - A warm render is about 1.3 s. Of that, Metro takes about 855 ms (66%) even with a warm transform cache: config, file map crawl of `node_modules`, graph resolution, and serializing a 5.5 MB bundle. The host takes about 350 ms.
   - A cold render takes 5.4 s in Metro, uses 33 s of CPU across the worker threads, and peaks at about 1.7 GB RSS. A warm render peaks at about 730 MB, of which the host is about 173 MB; the rest is Node and Metro.
   - To optimize: cache the finished bundle by a hash of the input files, reuse a running Metro server, or use session mode. A session pays for bundling once, then costs 18–51 ms per request.
2. **Bundle evaluation is the largest host phase: about 150 ms.** Hermes compiles and runs 5.5 MB of JS source; the build type makes no difference, because Hermes is optimized in both. Emitting Hermes bytecode (`hermesc` is already in `node_modules/hermes-compiler`) and minifying would reduce this and the bundle size.
3. **The initial mount happens in `settle` (about 128–140 ms), not in `first render` (11 ms).** React Navigation mounts the screens in effects, and FlatList renders its 60 cells after that. Each settle round also takes a full `getA11yTree` dump (about 9 ms) to detect changes; this app needs 3 rounds. The action runner settles after every step, so a request pays at least 2 dumps. A cheap change check, such as a ShadowTree revision number from the host, would save about 20 ms of each 37 ms session request.
4. **`getA11yTree` costs 9 ms for 832 nodes in Release and 100 ms in Debug.**
   - Mounted values (`--no-mounted` vs default) cost no measurable time: 8.7 vs 9.0 ms.
   - `--debug-props` adds about 5 ms (+55%).
   - Converting in the CLI and pretty-printing 1.6 MB of JSON takes about 5 ms per tree, and 20 ms in `run` with 3 snapshots plus the final tree. The output size could matter more than the time: an option for compact JSON, or for leaving out empty fields, would shrink it.
5. **Use the Release host everywhere.**
   - Debug is 2.2x slower in the host for a `render` and about 10x slower for `run` and session requests, where host C++ dominates (Yoga, Fabric commit, getA11yTree, hit testing, event dispatch).
   - Debug also uses 20 MB more RSS, and its binary is 8x larger (74 MB vs 9 MB).
   - With Release, the host part of a request is small compared with Metro and the Node CLI (about 550 MB RSS for Node and Metro: tree minus host).
