# Native layout reference checks

Checked native sources at `88ddd44083a0bac5b02fbac73bf79d39dcc67d68` on
macOS 26.5.2 / arm64, Xcode 26.6, macOS SDK 26.5. No simulator or emulator ran.
These are desktop reference comparisons, not device accessibility/pixel parity.

| Reference | Result | Limits |
| --- | --- | --- |
| SwiftUI macOS | 42/43 within 0.5 pt; 43/43 within 1 pt | Case 41 symbol/Label height differs, propagating up to 0.92 pt to a sibling frame. Historical iOS results were not rerun. |
| Compose Desktop | 56/56 at densities 1 and 2.75, at both 1 px and 0 px tolerance | Comparator includes a 0.01 px numeric allowance. Densities 2.625/3.5 not checked. Desktop Material/font behavior is not an Android-device guarantee. |

Commands:

```sh
native/tools/swiftui-layout-test/build.sh
bun native/tools/swiftui-layout-test/compare.ts
bun native/tools/swiftui-layout-test/compare.ts --tolerance 1
native/tools/compose-layout-test/build.sh
bun native/tools/compose-layout-test/compare.ts
bun native/tools/compose-layout-test/compare.ts --tolerance 0
```

Captured evidence: [Compose default tolerance](compose-compare-default.txt),
[Compose zero tolerance](compose-compare-zero.txt), [environment](compose-environment.txt),
and [SwiftUI transcript copy](swiftui-transcript-copy.txt).

Compose logs are captured command output. The SwiftUI log is explicitly a copy
of the tool transcript; original redirected raw logs were not retained. The
0.5 pt SwiftUI comparison exits 1, as expected from the recorded mismatch;
other comparison commands exit 0. No tolerances or fixtures were changed.

Compose used installed JDK 17.0.20.1, Gradle 9.4.1, Kotlin 2.3.21, Compose
Multiplatform 1.10.3, Material3 1.10.0-alpha05, Skiko 0.9.37.4 and Roboto 2.138.
Its build used existing offline dependency caches. One experimental serialization
API opt-in compiler warning was observed.

## Packaged host gate

The new ARM64 release verification script was exercised locally against a
runtime npm tarball containing the upstream CI universal host from `9f0348c`.
All 58 strict E2E cases passed, including package installation, shared-project
resolution and the real SVG transformer. This verifies the gate on ARM64;
Intel execution remains a CI responsibility. No native sources changed in this
hardening pass.

Host SHA-256: `4059b4db684490664ac26b6932f3fee0a011d824b8e3e19114ae53190171d945`.
The gate checks both Mach-O slices before running tests. It also prints the
npm tarball hash so a release run can associate results with its own artifact.
