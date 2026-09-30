# Host build: time and size

Measured on 2026-09-29 on an Apple M4 (10 cores), macOS 26.5 SDK, Apple clang
from Xcode 26.6, Android SDK CMake 3.30.5 with its Ninja. React Native
0.88-stable (`third_party/react-native`, 6007151) with `native/overlay/` at
`012c17c` (react-native-screens, safe-area-context, gesture-handler,
worklets, reanimated all built in).

## Build types

`scripts/build-host.sh` (`bun run build:host`) takes `RN_A11Y_HOST_BUILD_TYPE`:

| Type | Tester flags | `native/dist` |
|---|---|---|
| `Release` (default) | `-O3`, ThinLTO (`CMAKE_INTERPROCEDURAL_OPTIMIZATION=ON` gives `-flto=thin`), `-Wl,-dead_strip` | `strip -x` on the host and the dylibs |
| `MinSizeRel` | `-Os`, ThinLTO, `-Wl,-dead_strip` | `strip -x` |
| `Debug` | `-g`, no optimization (the upstream gradle build) | not stripped |

Gradle's `configureFantomTester` hardcodes `-DCMAKE_BUILD_TYPE=Debug` and has
no property or environment variable for it. So the script runs gradle only for
the prerequisites (`:private:react-native-fantom:prepareAllDependencies`:
Hermes, the third-party sources, codegen) and configures the tester itself,
with the same arguments as `configureFantomTester` plus the build type, into
`private/react-native-fantom/build/tester-<type>`, with the Ninja generator.
Ninja works with the gradle prerequisites (they are plain directories).

`libhermesvm.dylib` is always the gradle build: `CMAKE_BUILD_TYPE=Release`,
`HERMES_ENABLE_DEBUGGER=True`. `libjsi.dylib` is built with the tester's type.

`bun run check` (typecheck, 25 unit/CLI tests, 7 e2e tests against
`native/dist`) passes with all three types (0 failures, 0 skipped). Because
Release passes, it is now the default.

Not used:

- `-fvisibility=hidden` (`CMAKE_CXX_VISIBILITY_PRESET=hidden` for the whole
  tree): the link fails. `libjsi.dylib` is built in the same tree and
  functions without an export attribute become hidden
  (`Undefined symbols: facebook::jsi::dynamicFromValue(...)`,
  `facebook::jsi::valueFromDynamic(...)`). For the executable alone it has no
  effect on size (an executable exports nothing that matters).
- `strip -S` (debug symbols only): no gain on Release/MinSizeRel (no `-g`);
  `strip -x` (all local symbols) is what reduces the size.

## Clean build time

Tester only (Hermes, third-party sources and codegen already built),
`cmake --build <dir> --target fantom_tester` with Ninja (10 parallel jobs):

| Type | Configure | Build (wall) | Sum of step times | Final link |
|---|---|---|---|---|
| Debug | 5 s | 107 s | 1275 s | 0.3 s |
| Release (ThinLTO) | 3 s | 134 s | 1502 s | 8.0 s |
| Release, no LTO | 2 s | 128 s | - | - |
| MinSizeRel (ThinLTO) | 3 s | 110 s | 1238 s | 6.4 s |

Split by component (sum of Ninja step durations from `.ninja_log`; with 10
parallel jobs the wall time is about 1/10 to 1/12 of the sum):

| Component | Steps | Debug | Release | Share |
|---|---|---|---|---|
| ReactCommon (renderer, runtime, jsi, inspector, ...) | 329 | 634 s | 753 s | 50% |
| react-native-reanimated (`Common/cpp` + host glue) | 118 | 297 s | 342 s | 23% |
| react-native-screens | 30 | 73 s | 86 s | 6% |
| tester sources (`tester/src`) | 23 | 67 s | 76 s | 5% |
| react-native-worklets | 54 | 61 s | 70 s | 5% |
| ReactCxxPlatform | 33 | 58 s | 68 s | 5% |
| third-party (folly, glog, fmt, gflags, double-conversion, boost) | 57 | 40 s | 47 s | 3% |
| react-native-safe-area-context | 7 | 17 s | 19 s | 1% |
| react-native-gesture-handler | 6 | 16 s | 18 s | 1% |
| codegen (FBReactNativeSpec rncore) | 5 | 12 s | 14 s | 1% |

Prerequisites (gradle, from the first build of this project on the same
machine, 2026-09-29): Hermes source download + configure + `hermesc` +
`hermesvm` about 2.5 min (download 13:00:19, `hermesc` 13:01:57,
`libhermesvm.dylib` 13:02:54; Makefiles, `-j 10`). The React Native codegen
CLI, codegen and third-party preparation take well under a minute. A second
`hermesvm`-only build with Ninja (for the variant below) took 97 s.

Full clean build from a fresh checkout: about 5 min (2.5 min Hermes + under
1 min gradle prerequisites + 2.2 min tester + dist).

## Incremental build time

After `touch` of one tester source file, `cmake --build` only:

| Type | `render/A11yTree.cpp` | `components/FantomSafeArea.cpp` |
|---|---|---|
| Debug | 2.3 s | 2.8 s |
| Release | 10.7 s | 10.8 s |
| MinSizeRel | 10.5 s | - |

Release/MinSizeRel pay the ThinLTO link (6 to 8 s) on every change.
`bun run build:host` with nothing to rebuild takes about 10 s (the gradle
up-to-date check, the Ninja no-op, the dist copy, `install_name_tool`,
`strip`, `codesign`).

## Sizes

Bytes. "dist" is the file in `native/dist/arm64/` (after `install_name_tool`,
and `strip -x` for Release/MinSizeRel).

| File | Debug | Release unstripped | Release `strip -x` (dist) | MinSizeRel unstripped | MinSizeRel `strip -x` (dist) |
|---|---|---|---|---|---|
| `fantom_tester` / `rn-a11y-host` | 67,643,856 (dist 67,268,720) | 10,038,016 | 6,071,536 (6,054,384) | 9,392,160 | 5,009,808 (4,998,832) |
| `libjsi.dylib` | 1,522,384 (dist 1,531,680) | 470,448 | 417,120 (432,816) | 445,712 | 385,032 (400,912) |
| `libhermesvm.dylib` (gradle Release + debugger) | 5,032,352 (dist 5,021,216) | 5,032,352 | 3,761,824 (3,758,080) | 5,032,352 | 3,761,824 (3,758,080) |
| `native/dist/arm64` total (`du -sh`) | 70 MB | - | 9.8 MB | - | 8.7 MB |

Other data points: Debug `strip -x` 26,822,152; Release without LTO
11,192,384 unstripped, 6,755,712 `strip -x` (ThinLTO saves 0.7 MB stripped).

## What is in the Release binary

Link map (`-Wl,-map`) of a Release build without LTO (with ThinLTO the map
only shows the LTO objects), symbol bytes aggregated by CMake target. Total
5,434 KiB of symbols (the rest of the 6.8 MB stripped file is symbol/string
tables, unwind info and headers).

By component:

| Component | KiB | Share |
|---|---|---|
| ReactCommon | 2256 | 41.5% |
| react-native-reanimated | 1115 | 20.5% |
| react-native-worklets | 469 | 8.6% |
| tester sources | 441 | 8.1% |
| ReactCxxPlatform | 324 | 6.0% |
| react-native-screens | 296 | 5.4% |
| folly + glog + fmt + gflags + double-conversion | 352 | 6.5% |
| linker synthesized (stubs, GOT) | 104 | 1.9% |
| react-native-gesture-handler | 31 | 0.6% |
| react-native-safe-area-context | 24 | 0.4% |
| codegen rncore | 17 | 0.3% |

Top 15 targets:

| Target | KiB | Share |
|---|---|---|
| `reanimated` | 1115 | 20.5% |
| `worklets` | 469 | 8.6% |
| `fantom_tester` (tester sources) | 441 | 8.1% |
| `rrc_view` (View props, conversions) | 374 | 6.9% |
| `rnscreens` | 296 | 5.4% |
| `jsinspector` (CDP inspector) | 194 | 3.6% |
| `react_renderer_uimanager` | 168 | 3.1% |
| `react_renderer_animated` | 167 | 3.1% |
| `react_cxx_platform_react_devsupport` (packager connection, dev menu) | 121 | 2.2% |
| `react_renderer_mounting` | 104 | 1.9% |
| linker synthesized | 104 | 1.9% |
| `folly_runtime` | 102 | 1.9% |
| `react_cxx_platform_react_io` | 97 | 1.8% |
| `bridgeless` | 94 | 1.7% |
| `react_cxx_platform_react_runtime` | 89 | 1.6% |

## Hermes

`libhermesvm.dylib` as built by gradle: Release, `HERMES_ENABLE_DEBUGGER=True`,
`HERMES_MEMORY_INSTRUMENTATION=True`, `HERMES_ENABLE_INTL=OFF` (already off
on this host), `HERMESVM_HEAP_HV_MODE=HEAP_HV_PREFER32`.

| Variant | Size | `strip -x` | Build |
|---|---|---|---|
| gradle (debugger on) | 5,032,352 | 3,761,824 | part of the 2.5 min Hermes step |
| debugger off (same flags otherwise) | 4,266,320 | 3,248,128 | 97 s (`hermesvm` target, Ninja) |

Turning the debugger off saves 0.5 MB stripped (-14%). It also removes the
Chrome DevTools debugging of the host (`--inspectorPort`) and must be checked
against the tester's `hermes_inspector_modern` link (not tried).
`HERMES_BUILD_LEAN_LIBHERMES=ON` would remove the JS compiler from the VM, but
the host evaluates JS source bundles, so it would need bundles precompiled
with `hermesc` (not supported by the host today).

## Single executable

With `FANTOM_STATIC_HOST` (default), `native/dist/<arch>/` contains only `rn-a11y-host`
(no `lib/` directory). `otool -L` (Release, MinSizeRel and Debug):

```
/usr/lib/libobjc.A.dylib
/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation
/System/Library/Frameworks/AppKit.framework/Versions/C/AppKit
/System/Library/Frameworks/CoreText.framework/Versions/A/CoreText
/System/Library/Frameworks/Foundation.framework/Versions/A/Foundation
/usr/lib/libc++.1.dylib
/usr/lib/libSystem.B.dylib
```

No `LC_RPATH`. `build-host.sh` warns if the host links anything outside
`/usr/lib` and `/System/Library`. The CMake option is `FANTOM_STATIC_HOST`
(tester `CMakeLists.txt`, default `ON`; `OFF` gives the previous layout with
`lib/libhermesvm.dylib` and `lib/libjsi.dylib`).

How:

- Hermes: no separate Hermes build. The gradle Hermes build already produces
  the static archives that `libhermesvm.dylib` is linked from
  (`hermes/lib/libhermesvm_a.a` and `libhermesParser.a`, `libhermesAST.a`,
  `libhermesSupport.a`, `libhermesRegex.a`, `libhermesPlatformUnicode.a`,
  `libdtoa.a`, `libLLVHSupport.a`, `libLLVHDemangle.a`,
  `libboost_context.a`, `-framework CoreFoundation`: the link line of
  `hermes/lib/CMakeFiles/hermesvm.dir/link.txt`). The tester links these
  instead of the dylib. Same Hermes configuration as before (Release,
  debugger on). Hermes' own `jsi/libjsi.a` (on that link line too) is not
  linked.
- JSI: `ReactCommon/jsi/CMakeLists.txt` hardcodes `add_library(jsi SHARED ...)`
  and honors no option. Without patching React Native, the tester
  `CMakeLists.txt` defines the same `jsi` target (same sources, include
  directory, links and flags) as `STATIC` instead of adding that directory.
  It is the only JSI in the executable: Hermes is compiled against the same
  JSI headers (`-DJSI_DIR=ReactCommon/jsi`) and its JSI references resolve to
  this library. (With the dylibs, there were two copies: one inside
  `libhermesvm.dylib`, from Hermes' static `libjsi.a`, and `libjsi.dylib`.)
- OpenSSL: only `ReactCxxPlatform/react/devsupport/DevServerHelper.cpp` uses
  it (`SHA256` of the device name for the packager connection). The Apple
  static host links a CommonCrypto shim instead (`src/stubs/crypto`: a minimal
  `openssl/sha.h` and `SHA256_Init/Update/Final` on `CC_SHA256_*`, exposed as
  `OpenSSL::Crypto`; option `FANTOM_OPENSSL_SHIM`, default ON). Homebrew's
  `libcrypto.a` was arm64-only on an arm64 Mac, which blocked the x86_64 slice,
  and the build no longer needs Homebrew OpenSSL. `libssl` is not used.

Architectures (`RN_A11Y_HOST_ARCH`): on an M4, the x86_64 slice (cross-built
with `CMAKE_OSX_ARCHITECTURES=x86_64`: Hermes for x86_64 with the arm64
hermesc imported through `IMPORT_HOST_COMPILERS`, then the tester) took 291 s
from scratch (Hermes 90 s), after the arm64 gradle prerequisites. Sizes:
arm64 10,524,560 bytes, x86_64 11,487,232, universal (`lipo -create`)
22,042,512.

Sizes (bytes, `strip -x`, single file vs. the previous total of the host and
its two dylibs):

| Type | Single `rn-a11y-host` | Before (host + libhermesvm + libjsi) |
|---|---|---|
| Release | 9,251,344 (unstripped 14,244,528) | 10,245,280 |
| MinSizeRel | 8,162,848 (unstripped 13,563,248) | 9,157,824 |
| Debug (not stripped) | 73,617,424 | 73,821,616 |

The single file is about 1 MB smaller: `-dead_strip` now also removes the
unused parts of Hermes (the dylib exported everything), and there is one JSI.

Build time: the compile work is the same (Hermes is not rebuilt; `jsi` is the
same sources as a static library). Back-to-back clean Release tester builds
(during other load on the machine, load average about 13):
`FANTOM_STATIC_HOST=ON` 151 s (final link 10.0 s), `OFF` 142 s (final link
8.3 s). The difference is the final link (+1.7 s, the Hermes objects go
through the linker) plus noise.

`bun run check` passes with the single Release executable (25 unit/CLI tests,
7 e2e tests, 0 failures), and a copy of `rn-a11y-host` in `/tmp` runs a
render (`RN_A11Y_HOST_BIN=/tmp/rn-a11y-host-copy`).

## Commands

```sh
# Build types (default Release)
bun run build:host
RN_A11Y_HOST_BUILD_TYPE=MinSizeRel bun run build:host
RN_A11Y_HOST_BUILD_TYPE=Debug bun run build:host

# Configure used by the script (Release shown), from
# third_party/react-native/private/react-native-fantom/tester
$ANDROID_HOME/cmake/3.30.5/bin/cmake --log-level=ERROR -G Ninja \
  -DCMAKE_MAKE_PROGRAM=$ANDROID_HOME/cmake/3.30.5/bin/ninja \
  -S . -B ../build/tester-release \
  -DCMAKE_BUILD_TYPE=Release \
  -DFANTOM_CODEGEN_DIR=../build/codegen -DFANTOM_THIRD_PARTY_DIR=../build/third-party \
  -DREACT_ANDROID_DIR=<rn>/packages/react-native/ReactAndroid \
  -DREACT_COMMON_DIR=<rn>/packages/react-native/ReactCommon \
  -DREACT_CXX_PLATFORM_DIR=<rn>/packages/react-native/ReactCxxPlatform \
  -DREACT_THIRD_PARTY_NDK_DIR=<rn>/packages/react-native/ReactAndroid/build/third-party-ndk \
  -DRN_ENABLE_DEBUG_STRING_CONVERTIBLE=ON -DHERMES_V1_ENABLED=1 \
  -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON \
  -DCMAKE_EXE_LINKER_FLAGS=-Wl,-dead_strip -DCMAKE_SHARED_LINKER_FLAGS=-Wl,-dead_strip

# Timing
rm -rf ../build/tester-release   # clean
time $ANDROID_HOME/cmake/3.30.5/bin/cmake --build ../build/tester-release --target fantom_tester
# Per-component time: sum (end - start) of ../build/tester-release/.ninja_log
# lines, grouped by output path (ReactCommon/, ReactCxxPlatform/,
# CMakeFiles/<target>.dir/, ...)

# Incremental
touch src/render/A11yTree.cpp
time $ANDROID_HOME/cmake/3.30.5/bin/cmake --build ../build/tester-release --target fantom_tester

# Sizes
stat -f%z ../build/tester-release/fantom_tester
cp ../build/tester-release/fantom_tester /tmp/ft && strip -x /tmp/ft && stat -f%z /tmp/ft

# Size breakdown: Release without LTO, with a link map
cmake ... -DCMAKE_BUILD_TYPE=Release \
  "-DCMAKE_EXE_LINKER_FLAGS=-Wl,-dead_strip -Wl,-map,<dir>/fantom_tester.map"
# then sum the "# Symbols:" sizes per object file and group by
# CMakeFiles/<target>.dir/ or lib<target>.a(...)

# Hermes without the debugger
cd third_party/react-native/packages/react-native/sdks/hermes
cmake --log-level=ERROR -Wno-dev -G Ninja -S . -B /tmp/hermes-nodebug \
  -DJSI_DIR=<rn>/packages/react-native/ReactCommon/jsi \
  -DCMAKE_BUILD_TYPE=Release -DHERMESVM_HEAP_HV_MODE=HEAP_HV_PREFER32
cmake --build /tmp/hermes-nodebug --target hermesvm
```

## Recommendations

1. Ship `Release` (now the default of `bun run build:host`): a single 9.3 MB
   executable (see Single executable; 9.8 MB with the dylibs) instead of
   70 MB, same behavior (`bun run check` passes), a CLI render of
   `examples/basic` is about 0.85 s warm instead of 0.95 s (mostly Node and
   Metro). `MinSizeRel` saves another 1.1 MB (8.2 MB single file) with the same test
   results; use it if the package size matters more than CPU speed in long
   animation runs.
2. Use `RN_A11Y_HOST_BUILD_TYPE=Debug` for native development: 2 to 3 s per
   change instead of about 11 s (ThinLTO link), and full debug info.
3. CI (macOS): a clean build is about 5 min on an M4 with 10 cores; on a
   3-core GitHub macOS arm64 runner expect roughly 3 times that (about 15
   min, estimate). Cache the Hermes build directory
   (`packages/react-native/ReactAndroid/hermes-engine/build/hermes` and
   `sdks/hermes`, key: `.hermesv1version` + the Hermes CMake flags) to save
   2.5 min (about 7 min on CI), and use ccache for the tester (the upstream
   Fantom CI does) to bring a mostly cached build to 1 to 2 min.
4. To cut size further, in order of effect:
   - Hermes debugger off: -0.5 MB stripped; costs the DevTools debugging of
     the host; the tester's inspector link must be checked first.
   - Reanimated + worklets are 29% of the host's code (1.6 MB of 5.4 MB
     symbols) and 28% of its compile time; build them only when needed (the
     CMake already skips them when the packages are missing).
   - `jsinspector` + `react_cxx_platform_react_devsupport` (5.8%) are not
     needed by the CLI, but removing them needs changes in ReactCxxPlatform
     or the Fantom tester (both are linked into the tester today).
   - Keep `RN_ENABLE_DEBUG_STRING_CONVERTIBLE=ON`: `getRenderedOutput` and
     `getA11yTree`'s `debugProps` need it.
