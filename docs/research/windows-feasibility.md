# Windows feasibility of the headless host (rn-a11y-host)

Date: 2026-10-01. Branch: `ci/windows-host`. Workflow:
`.github/workflows/windows-feasibility.yml`.

Follow-up (2026-10-01): the Windows host is built for real by
`scripts/build-host.sh` and `.github/workflows/windows-host.yml` (portable
text, `/MT`, static ICU); see native/README.md, section Windows. This report
describes the spike with the stub text.

## Result

The host builds, links and runs on Windows x64. Round 10 linked
`fantom_tester.exe` with clang-cl and rendered `examples/basic`. Text is not
measured: the upstream `platform/cxx` TextLayoutManager returns the minimum
size (0), so every Paragraph has height 0. The output is the same as the
Linux spike output.

```
RootView RootView {0,0,390x844}
  RootView/View:1 View {0,0,390x844}
    RootView/View:1/Paragraph:1 Paragraph role=header "Sign in" {24,24,342x0}
    RootView/View:1/Image:1 Image role=image "Company logo" {24,40,64x64}
    email AndroidTextInput #email role=textbox {24,120,342x18}
    remember AndroidSwitch #remember role=switch "Remember me" {24,154,51x31} [checked]
    submit View #submit role=button "Submit" {24,201,342x48}
      submit/Paragraph:1 Paragraph role=text "Submit" {195,225,0x0}
```

Command (Git Bash): `RN_A11Y_HOST_BIN="$(cygpath -w D:/t/fantom_tester.exe)"
node src/cli.ts render examples/basic/App.tsx --platform android --format
text --no-quiet`.

Two compilers are necessary. The tester (React Native, folly, the native
libraries, our overlay) compiles with clang-cl. Hermes compiles with MSVC
(`cl.exe`): Hermes' CMake does not support clang-cl (round 3). The objects of
the two compilers link together (same ABI, same MSVC STL, `/MD`).

Round 11 (run 36820159022) with the same host:

- `fantom_tester.exe`: 11,883,008 bytes (Release, no LTO, no debug
  information). Imports (`llvm-readobj --coff-imports`):
  `KERNEL32`, `MSVCP140`, `MSVCP140_2`, `VCRUNTIME140`, `VCRUNTIME140_1`,
  the UCRT `api-ms-win-crt-*` DLLs, `SHLWAPI`, `WINMM`, `WS2_32`, `bcrypt`,
  `icuin`, `icuuc`. Hermes, JSI, folly and glog are static.
- `session` (host `--interactive`, length-prefixed frames on stdin): pass,
  4 s. Tap on `submit`, then `tree` shows `status Paragraph #status
  role=text "Submitted"`, then `quit` gives `{"id":3,"ok":true}`.
- e2e (`bun run test:e2e` with the Windows host): 21 passed, 3 failed,
  1 skipped, 340 s. The 3 failures: `render.test.ts` android-phone and
  ios-phone ("Paragraph "Sign in" has height 0: expected 0 to be greater than
  10", the stub text), and `expo-ui.test.ts` android-phone
  (`host.layout` is undefined, expected `emulated`: the Compose engine is
  off without the embedded fonts). The Linux stub host has the same two
  causes.
- Unit tests (`bun run test`, fake host): 59 passed, 22 failed, 3 skipped.
  The failures are in the tests, not in the host: the fake host
  `test/fixtures/fake-host.ts` is spawned as an executable ("spawn EFTYPE",
  15 tests), `scripts/release-host.ts` exits 1 in `host-download.test.ts`
  (3 tests), and 4 assertions expect POSIX paths or `/` separators (for
  example "expected 'D:\tmp\x' to be '/tmp/x'").

## Method

- No Windows machine. GitHub Actions, hosted runner `windows-2025`: Windows
  Server 2025, 2 cores, 8 GB RAM.
- Toolchain on the image: LLVM 20.1.8 (`C:\Program Files\LLVM`: clang-cl,
  lld-link, llvm-lib), Visual Studio 18 Enterprise with MSVC 14.51.36231
  and Windows SDK 10.0.26100.0 (through `ilammy/msvc-dev-cmd`), CMake 4.4.3,
  Ninja 1.13.2, Git Bash (MSYS 3.6.10), Temurin JDK 17.0.20, Node 24.21.0,
  Bun 1.3.14, Yarn 1.22.22 (`npm install -g`), sccache 0.18.0.
- Android SDK on the image: `C:\Android\android-sdk`, SDK CMake 3.30.5 /
  3.31.5 / 4.1.2, NDK 27.3 / 28.2 / 29.0 (not the pinned 27.1). The NDK
  selection of `build-host.sh` (`ANDROID_NDK` + `ANDROID_NDK_VERSION`) is
  enough for gradle; nothing is compiled for Android.
- The workflow runs on push to `ci/windows-host` (`workflow_dispatch` needs
  the file on the default branch). All steps use `shell: bash` (Git Bash).
  Every step has `continue-on-error`. Logs are uploaded as artifacts.
- Gradle builds only the codegen and the third-party sources. Hermes is
  configured with the arguments of `configureBuildForHermesWithDebugger`
  (`-DHERMES_ENABLE_DEBUGGER=True -DHERMESVM_HEAP_HV_MODE=HEAP_HV_PREFER32
  -DCMAKE_BUILD_TYPE=Release -DJSI_DIR=...`), but with Ninja and an explicit
  compiler. The gradle outputs and the Hermes build are cached
  (`actions/cache`, key: the submodule SHA). The tester objects are cached
  with sccache (GitHub Actions backend).
- The tester is configured like `scripts/build-host.sh`, with
  `-DFANTOM_MACOS_TEXT_LAYOUT=OFF -DFANTOM_STATIC_HOST=ON`, Release,
  `CMAKE_C/CXX_COMPILER=clang-cl`, `CMAKE_LINKER=lld-link`,
  `CMAKE_AR=llvm-lib` (full paths), build directory `D:/t` (short paths).
  No LTO.
- Rounds:

| Round | Run | Change | Outcome |
|---|---|---|---|
| 1 | 36800161336 | first workflow; Windows CMake branches in the overlay (see below) | gradle fails (`buildCodegenCLI`: `command 'null'`); tester configure fails (Git Bash rewrites `/FI...`) |
| 1 | 36800161336, job `upstream-gradle` | unmodified `prepareAllDependencies` | fails: `buildCodegenCLI`, and Hermes configure (CMake escape error) |
| 2 | 36801106183 | `-Preact.internal.windowsBashPath`; `-FI` instead of `/FI` | gradle fails (`buildCodegenCLI`: `tar`, "Member name contains '..'") |
| 3 | 36801944971 | codegen `lib/` built with `node scripts/build.js`, `-x buildCodegenCLI` | gradle passes; Hermes with clang-cl: 169 objects fail |
| 4 | 36803161600 | Hermes with `cl.exe` + Ninja; tester configures without Hermes | Hermes passes; tester: 515 of 697 objects fail |
| 5 | 36808282982 | `/EHsc /GR` kept, glog, folly, warnings | workflow bug: codegen `lib/` not built on a cache hit; configure fails |
| 6 | 36808747549 | codegen `lib/` in its own step | 284 objects fail |
| 7 | 36810933061 | full tool paths, system headers, no `-Werror` through `fast_float` | 2 objects fail |
| 8 | 36814266053 | gflags `GFLAGS_IS_A_DLL=0` public | 1 object fails |
| 9 | 36815480293 | `-Wall` as `/W3` | all objects compile; link: 3 undefined symbols |
| 10 | 36819506161 | `winmm`; folly `pthread_getw32threadid_np` shim | links; smoke render prints the tree |
| 11 | 36820159022 | binary imports, session smoke, unit and e2e tests | session passes; e2e 21 passed, 3 failed (stub text, no Compose engine); unit 22 failed (test fixtures) |

Run 36803110887 (round 4, first commit) was cancelled and replaced by
36803161600.

## Steps, outcome and wall time

| Step | Outcome | Wall time |
|---|---|---|
| (a) `bun install --frozen-lockfile` | pass | 59-93 s |
| (b) submodule `yarn install --frozen-lockfile` | pass | 86-154 s |
| (b2) react-native-codegen `lib/` (`node scripts/build.js`) | pass (round 6 and later) | not measured |
| (c) gradle: `enableHermesBuild`, `hermes-engine:unzipHermes`, `prepareRNCodegen`, `prepareNative3pDependencies` | pass from round 3 | 256-372 s (with the gradle and plugin download) |
| (h) Hermes, clang-cl + Ninja | fail (round 3) | 200 s |
| (h) Hermes, `cl.exe` + Ninja, targets `hermesvm hermesc` | pass (round 4) | 2016 s (33.6 min) |
| (d) `codegen-lib.sh` (react-native-screens) | pass | 2-3 s |
| (e) CMake configure | pass from round 4 | 31-57 s |
| (f) `ninja fantom_tester`, no sccache hits | round 7: 2140 s (695 of 697 objects); round 9: 1001 s (47 hits, 634 misses) | 17-36 min |
| (f) `ninja fantom_tester`, sccache hits | round 10: pass, 147 s (681 hits) | 2.5 min |
| (g) smoke render | pass (round 10) | 10 s |

The 2-core runner is slow: on an M4 Mac, Hermes takes about 2.5 min and the
tester about 2.2 min (`scripts/build-host.sh`).

### Gradle

Upstream gradle on Windows fails in two places (round 1, job
`upstream-gradle`, 6 min 14 s):

1. `:packages:react-native:ReactAndroid:buildCodegenCLI`: "A problem
   occurred starting process 'command 'null''". The task runs
   `scripts/oss/build.sh` with the bash from the gradle property
   `react.internal.windowsBashPath`, which is not set.
   With `-Preact.internal.windowsBashPath=C:\Program Files\Git\bin\bash.exe`
   (round 2), the Windows branch of `build.sh` fails:
   `tar cf - --exclude='*.lock' "$CODEGEN_DIR"` with
   `CODEGEN_DIR=<abs>/scripts/oss/../..` gives "Member name contains '..'"
   and "Exiting with failure status". Workaround: build `lib/` with
   `node scripts/build.js` in `packages/react-native-codegen` (the
   workspace has the dependencies) and run gradle with
   `-x :packages:react-native:ReactAndroid:buildCodegenCLI`.
2. `configureBuildForHermesWithDebugger` (`"NMake Makefiles"`, `cl.exe`):
   "Syntax error in cmake code when parsing string
   `D:\a\...\ReactCommon\jsi/jsi/test/testlib.cpp`: Invalid character escape
   '\a'" (`cmake/modules/Hermes.cmake:148`, from
   `unittests/API/CMakeLists.txt:54`). Gradle passes `-DJSI_DIR` with
   backslashes. Workaround: configure Hermes in the workflow with a path with
   forward slashes (`cygpath -m`).

The other gradle tasks (folly, gflags, nlohmann_json, boost,
double-conversion, fast_float, fmt, glog, codegen) pass on Windows.

### Hermes

clang-cl (round 3, 169 objects fail): Hermes' `cmake/modules/Hermes.cmake`
treats clang-cl as GCC-compatible (`CMAKE_CXX_COMPILER_ID` is `Clang`).
It adds `-Werror=undef` (832 errors: "'__GNUC__' is not defined, evaluates
to 0" in `llvh/Support/Compiler.h` and `MathExtras.h`) and `-fno-exceptions`
/ `-fno-rtti`, which clang-cl ignores ("unknown argument ignored in
clang-cl"). Hermes also removes CMake's `/EHsc`, so exceptions are off and
`jsi.cpp` fails: "cannot use 'throw' with exceptions disabled" (19).

MSVC `cl.exe` with Ninja (round 4): pass, 33.6 min, with
`-DHERMES_MSVC_MP=OFF`. Outputs: `bin/hermesc.exe`, `lib/hermesvm.dll`,
`lib/hermesvm_a.lib`, `lib/Parser/hermesParser.lib`, `lib/AST/hermesAST.lib`,
`lib/Support/hermesSupport.lib`, `lib/Regex/hermesRegex.lib`,
`lib/Platform/Unicode/hermesPlatformUnicode.lib`, `external/dtoa/dtoa.lib`,
`external/llvh/lib/Support/LLVHSupport.lib`,
`external/llvh/lib/Demangle/LLVHDemangle.lib`,
`external/boost/boost_1_86_0/libs/context/boost_context.lib`,
`jsi/jsi.lib`, `lib/hermescompiler.lib`. Hermes uses the ICU of Windows 10
(`USE_WIN10_ICU`: `icuuc.lib`, `icuin.lib` from the SDK); no ICU is
installed or linked statically.

## Compile and link errors (tester), by component

Round 4 is the first round with Hermes and a configured tester: 515 of 697
objects fail. Most of these errors come from one cause in the workflow (see
"Workarounds"), so the table lists each error that a later round fixed.

| Component | Representative error | Cause | Round |
|---|---|---|---|
| all (2284 errors in 515 objects) | "cannot use 'throw' with exceptions disabled" | `-DCMAKE_CXX_FLAGS=...` on the command line replaces CMake's `/DWIN32 /D_WINDOWS /EHsc /GR`, and the option translation dropped `-fexceptions` | 4 |
| ReactCommon jsi | `jsilib-posix.cpp(11): 'sys/mman.h' file not found` | same: no `/D_WINDOWS` (the file has `#ifndef _WINDOWS`) | 4 |
| folly, double-conversion, glog (headers, in every consumer) | "extension used [-Werror,-Wlanguage-extension-token]" (1872) | `-Wpedantic` from the React Native flags warns on `__int64` / `__forceinline` in the MSVC branches | 4, 6 |
| force-include `math.h` | `<built-in>(7,10): non-portable path to file '"Math.h"'`; "#include resolved using non-portable Microsoft search rules as: ...folly/portability/math.h" | case-insensitive file system: `-FImath.h` finds `folly/portability/Math.h` | 4 |
| folly `portability/PThread.cpp` | `boost/winapi/config.hpp(12): 'boost/predef/version_number.h' file not found` | folly's pthread emulation uses `boost::thread` (compiled library); the ReactAndroid boost has no `boost/predef` | 4 |
| glog Windows port | `windows/port.cc(59): redefinition of 'snprintf'` | glog 0.3.5 defines `snprintf` unless `HAVE_SNPRINTF`; the UCRT has it | 4 |
| react-native-worklets | `RunLoop/EventLoop.cpp(123): no member named 'system_clock' in namespace 'std::chrono'` | missing `<chrono>` | 4 |
| double-conversion `utils.h` (in folly consumers) | "unused typedef 'VerifySizesAreEqual' [-Werror,-Wunused-local-typedef]" | MSVC branch of `BitCast`; `-Wall -Werror` reached it through `fast_float`'s interface options | 6 |
| folly | `NetOps.cpp(198): 'inet_addr' is deprecated`; `SysMman.cpp(229)`, `Time.cpp(164)`: unused variable; `ThreadName.cpp(236)`: missing braces | Windows-only code; `-Werror` from `fast_float` | 6 |
| static libraries | `'D:\a\...\llvm-lib' is not recognized as an internal or external command` | `-DCMAKE_AR=llvm-lib`: CMake makes a bare name relative to the source directory | 6 |
| ReactCommon uimanager | `UIManagerBinding.cpp(150): unused typedef 'INVALID_REQUESTED_LOG_SEVERITY'` (`LOG_EVERY_N`) | glog's compile-time assert typedef; the `-Wno-unused-local-typedef` came before `/clang:-Wall` | 7, 8 |
| tester `AppSettings.cpp` | `gflags/gflags.h(226): 'dllimport' attribute only applies to functions, variables, classes...` | `GFLAGS_IS_A_DLL` was private to the gflags target; consumers saw `__declspec(dllimport)` | 7 |
| link: Hermes | `undefined symbol: __declspec(dllimport) timeBeginPeriod` / `timeEndPeriod` (`hermesvm_a.lib(SamplingProfilerSampler.cpp.obj)`) | `winmm.lib` not linked | 9 |
| link: folly | `undefined symbol: folly::portability::pthread::pthread_getw32threadid_np(...)` (`folly_runtime.lib(ThreadName.cpp.obj)`) | `PThread.cpp` not compiled | 9 |

No error came from our overlay sources, react-native-screens,
react-native-safe-area-context, react-native-gesture-handler,
expo-modules-core or ReactCxxPlatform after the flag fixes.
react-native-reanimated and react-native-worklets compiled with the two
Linux patches (below) and the `<cxxabi.h>` shim.

## Workarounds used in CI, and what the real fix is

Changes in our files (`native/overlay/`), guarded by `WIN32` / `MSVC`:

| Change | Kind | Real fix |
|---|---|---|
| `CMakeLists.txt`: Hermes archive names `${CMAKE_STATIC_LIBRARY_PREFIX}<name>${CMAKE_STATIC_LIBRARY_SUFFIX}` (`.lib` on Windows) | legitimate | keep |
| `CMakeLists.txt`: Hermes system libraries `icuuc icuin dbghelp psapi winmm` on Windows (`-framework CoreFoundation` only on Apple, ICU on Linux) | legitimate | keep (the Linux branch is the same as `ci/linux-host`) |
| `CMakeLists.txt`: `-lobjc` as `$<$<PLATFORM_ID:Darwin>:-lobjc>` | legitimate | keep |
| `CMakeLists.txt`: `CMAKE_CXX_STANDARD 20`, `/utf-8` (fmt), `NOMINMAX WIN32_LEAN_AND_MEAN NOGDI _USE_MATH_DEFINES _CRT_SECURE_NO_WARNINGS _CRT_NONSTDC_NO_WARNINGS _WINSOCK_DEPRECATED_NO_WARNINGS GLOG_NO_ABBREVIATED_SEVERITIES GOOGLE_GLOG_DLL_DECL=` | legitimate | keep |
| `CMakeLists.txt`: `fantom_translate_msvc_options()` rewrites the GCC-style options of every target: `-fexceptions` to `/EHsc`, `-frtti` to `/GR`, `-Wall` to `/W3`, `-O<n>` to `/O2`, `-fno-omit-frame-pointer` to `/Oy-`, `-include X` to `/FIX`, `-std=`, `-g`, `-fvisibility=`, `-lpthread` removed, `-Wpedantic` plus `-Wno-language-extension-token`, other `-f` options with `/clang:` | acceptable (one place, no edits in React Native) | upstream: a Windows branch in `ReactCommon/cmake-utils/react-native-flags.cmake` and the third-party CMake files; or use the GNU driver `clang++ --target=x86_64-pc-windows-msvc`, which takes GCC-style options (not tested) |
| `CMakeLists.txt`: glog from `glog-0.3.5/src/windows` (`port.cc`, Windows `config.h` and headers, `HAVE_SNPRINTF`) instead of the ReactAndroid glog target | legitimate | keep, or a newer glog |
| `CMakeLists.txt`: third-party include directories as system include directories (`boost double-conversion fast_float fmt folly_runtime glog`); `-Wno-error` for `double-conversion fmt folly_runtime gflags` | acceptable | keep |
| `CMakeLists.txt`: `-Werror -Wall -Wpedantic` removed from `fast_float`'s interface options | acceptable | upstream: `target_compile_reactnative_options(fast_float INTERFACE)` passes `-Werror` to every consumer |
| `CMakeLists.txt`: `-Wno-unused-local-typedef` for `react_renderer_uimanager` | hack | glog Windows header (`GOOGLE_GLOG_COMPILE_ASSERT` as `static_assert`) |
| `CMakeLists.txt`: SHA-256 with CNG (`src/stubs/crypto/Sha256ShimWin.cpp`, `bcrypt`), no OpenSSL | legitimate | keep |
| `src/stubs/windows/cxxabi.h` (include path of worklets and reanimated): `abi::__cxa_demangle` returns the MSVC name | legitimate (MSVC names are not mangled) | upstream `#if` in worklets/reanimated, or keep |
| `src/stubs/windows/FollyPThread.cpp`: `pthread_getw32threadid_np` | acceptable | keep, or compile folly with a pthreads library |
| `third-party/folly/CMakeLists.txt` (overlay copy): Windows `folly_FLAGS` (no `FOLLY_USE_LIBCPP`, `FOLLY_HAVE_PTHREAD`, `FOLLY_HAVE_CLOCK_GETTIME`, `FOLLY_HAVE_XSI_STRERROR_R`, `FOLLY_HAVE_RECVMMSG`), `folly/portability/*.cpp` without `OpenSSL.cpp`, `PThread.cpp`, plus `net/detail/SocketFileDescriptorMap.cpp`, `ws2_32` | legitimate | keep |
| `third-party/gflags/CMakeLists.txt` (overlay copy): `windows_port.cc`, `OS_WINDOWS`, `HAVE_SHLWAPI_H`, public `GFLAGS_IS_A_DLL=0`, `shlwapi` | legitimate | keep |
| `scripts/codegen-lib.sh`: `cmp`/`cp` when `rsync` is missing (Git for Windows has no rsync) | legitimate | keep |
| `src/TesterAppDelegate.cpp`: `_setmode(_fileno(stdin/stdout), _O_BINARY)` in `runInteractiveLoop` | legitimate (text mode changes CRLF and stops at Ctrl-Z; the frames are counted in bytes) | keep |
| `src/components/FantomExpo.cpp`: `composeEngineType` `[[maybe_unused]]` | legitimate | same change as `ci/linux-host` |

Changes in the workflow only:

| Workaround | Kind | Real fix |
|---|---|---|
| `git config --global core.autocrlf false` before checkout | needed | document it, or `.gitattributes` with `eol=lf` for `*.sh` |
| react-native-codegen `lib/` with `node scripts/build.js`; gradle `-x ...:buildCodegenCLI` | hack | upstream fix of `scripts/oss/build.sh` (Windows `tar` of a path with `..`) |
| `-Preact.internal.windowsBashPath=C:\Program Files\Git\bin\bash.exe` | needed with upstream gradle | a Windows branch in `build-host.sh` |
| Hermes configured in the workflow (Ninja, `cl.exe`, forward slashes) instead of gradle's NMake | acceptable | the same in `build-host.sh`; upstream: gradle passes `JSI_DIR` with backslashes |
| Hermes headers (`API/`, `public/`, without `jsi/`) copied to `prefab-headers` by hand | acceptable | same as `prepareHeadersForPrefabWithDebugger` |
| Force-includes `-FIcstdint -FIcstddef -FIcmath -FIalgorithm -FIiterator -FIstdexcept -FIchrono` in `CMAKE_CXX_FLAGS_INIT` | hack | add the includes in the headers (as for Linux); `ci/linux-host` has `src/platform/compat/StdIncludes.h` |
| `sed` in `node_modules`: reanimated `PlatformDepMethodsHolder.h` `#elif __APPLE__` to `#else`; worklets `AsyncQueueImpl.cpp` `pthread_setname_np(name)` under `#ifdef __APPLE__` | hack | upstream PRs; `ci/linux-host` has patches in `native/overlay/tester/patches/` |
| tester configure continues when a Hermes archive is missing (`sed` on `FATAL_ERROR`) | spike only | remove |
| Git Bash: options with a leading `/` are rewritten as paths (`/FIcstdint` became `C:/Program Files/Git/FIcstdint`) | needed | `-` options, or `MSYS2_ARG_CONV_EXCL` |

## Files that need a Windows implementation or change

New Windows code, only for real text (the stub host does not need it):

- `native/overlay/tester/src/platform/macos/TextLayoutManager.mm`
- `native/overlay/tester/src/platform/macos/EmbeddedFonts.mm`
- `native/overlay/tester/src/components/FantomComposeText.mm`

The portable TextLayoutManager replaces these. On `ci/linux-host` (merge of
`feat/portable-text`), `src/platform/portable/` uses the vendored
stb_truetype and the zlib decoder of stb_image, and its includes are STL
only. That branch also has `src/stubs/crypto/Sha256Portable.cpp`, which can
replace the CNG shim of this branch. Neither was compiled on Windows.

Changes for the build:

- `native/overlay/tester/CMakeLists.txt`, `third-party/folly/CMakeLists.txt`,
  `third-party/gflags/CMakeLists.txt` (done on this branch, see above).
- `scripts/build-host.sh`: it stops on non-Darwin (`uname -s`). A Windows
  branch needs: Git Bash, the MSVC environment (vcvars), the Hermes build
  with `cl.exe` + Ninja and forward slashes, the codegen `lib/` build, the
  NDK selection, `.exe`, and no `otool`, `install_name_tool`, `codesign`,
  `strip -x`, `lipo`, `shasum`. A `.pdb` instead of the `.dSYM`.
- `scripts/release-host.ts` / `.github/workflows/release-host.yml`: a
  `windows-2025` job that writes `win64-bin/rn-a11y-host.exe`
  (`packages/rn-a11y-host/index.ts` has the path already).

Third-party (upstream PRs, or shims in the overlay):

- `react-native-codegen/scripts/oss/build.sh` (Windows `tar` branch).
- `ReactAndroid/hermes-engine/build.gradle.kts` (`JSI_DIR` with
  backslashes).
- Hermes `cmake/modules/Hermes.cmake` (clang-cl as GCC-compatible).
- `ReactCommon/cmake-utils/react-native-flags.cmake` and the third-party
  CMake files (GCC-style options; `fast_float` passes `-Werror` to every
  consumer).
- react-native-worklets: `AsyncQueueImpl.cpp` (`pthread_setname_np`),
  `EventLoop.cpp` (`<chrono>`), `JSISerializer.cpp` and
  `SingleInstanceChecker.h` (`<cxxabi.h>`); reanimated:
  `PlatformDepMethodsHolder.h`, `SingleInstanceChecker.h` (`<cxxabi.h>`).

## CLI on Windows (observed in the source and in CI)

- `src/cli.ts render` and the host spawn work with a Windows path in
  `RN_A11Y_HOST_BIN` (round 10). The host prints `\n`-terminated JSON lines;
  `src/host.ts` trims each line, so a CRLF would also be accepted.
- `src/bundleCache.ts` `hermescPath()` returns null on `win32`
  (`osx-bin/hermesc` and `linux64-bin/hermesc` only), so the bundle is not
  compiled to bytecode on Windows. `hermes-compiler` has
  `win64-bin/hermesc.exe`.
- `compileBytecodeInBackground()` runs `/bin/sh -c ... && mv ...`. It is not
  reached on Windows now (no `hermesc`), but it fails there once `hermesc` is
  found.
- `src/hostDownload.ts` runs `tar -xzf`. Not tested on Windows.

- `session` works (round 11). `src/session.ts` writes the frames to the
  host's stdin; the host reads them in binary mode (`_setmode`, this branch).
- Unit tests that use the fake host fail on Windows: `spawn EFTYPE` (a `.ts`
  file is not an executable on Windows). `scripts/release-host.ts` exits 1
  in `host-download.test.ts` (not analyzed). Four tests compare paths with
  POSIX strings.

## Risks (observed in the source or in CI, not tested further)

- The host compiles the "not `ANDROID` and not `__APPLE__`" branches of
  reanimated, worklets and expo-modules-core, as on Linux (see
  `docs/research/linux-feasibility.md`), plus `_WIN32` branches in folly
  (pthread emulation, sockets, `SetThreadDescription`).
- Two compilers: Hermes with MSVC, the rest with clang-cl. They share the
  MSVC STL and `/MD`. An `/MT` (static CRT) host needs the same flag in both.
- The executable needs the MSVC runtime DLLs (`MSVCP140`, `VCRUNTIME140`,
  `VCRUNTIME140_1`; `/MD`). A machine without the Visual C++ redistributable
  does not have them. The fix is `/MT` for Hermes and the tester, or the DLLs
  next to the executable. Not tested.
- Windows 10 ICU: Hermes uses `icuuc.dll` / `icuin.dll` of Windows 10 1703 or
  later. `Intl` results can differ from the macOS host (CoreFoundation).
- Build time on the 2-core runner: Hermes 34 min, tester 17-36 min without a
  cache. A release job needs the caches or a larger runner.
- Path length: the tester build directory is `D:/t`. Deeper build
  directories were not tested (MAX_PATH 260).
- Unicode paths and spaces in paths were not tested.
- The repository on GitHub is now `Kudo/react-native-a11y-tree` (push of round 10: "This
  repository moved"). Pushes to the old URL fail with the Tuft credentials;
  round 10 and 11 were pushed to `https://github.com/Kudo/react-native-a11y-tree.git`.

## Estimate (judgment)

(a) Windows host with the `platform/cxx` text stub: about 3-5 days.

- All compile and link errors are known and have a fix that works in CI; the
  smoke render passes.
- Work: a Windows branch in `build-host.sh` (vcvars, Hermes with `cl.exe`,
  codegen `lib/`), the release job and `win64-bin/rn-a11y-host.exe`, the
  node_modules patches as overlay patches (shared with Linux), the
  force-includes as a header, the triage of the e2e failures, and the CLI
  items above (`hermesc.exe` path, no `/bin/sh`, the unit-test fixtures), and
  the MSVC runtime (`/MT` or the DLLs).
- Most of the uncertainty is in the e2e triage and in the slow CI rounds
  (a full round without caches is about 1.5 h).

(b) Windows host with the portable text layout: the estimate of (a) plus
about 1-2 days.

- The portable layout on `ci/linux-host` is STL plus vendored stb (see
  above), so it should compile with clang-cl like the other overlay code.
  Not tested.
- Work: compile it on Windows, the `cmake/embed-files.cmake` font embedding
  on Windows, and a check that the text sizes match the Linux host (same
  code and fonts; the floating-point results can differ between compilers).
