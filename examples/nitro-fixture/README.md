# Explicit Nitro fixtures

Real package JavaScript runs against the application factories in `fixtures.ts`.
These factories provide only the contracts exercised here.

`a11y-tree.json` selects `./fixtures.ts` automatically, including when the
schema sweep renders `App.tsx` without `--setup`. An explicit `--setup` overrides
that config; the missing-bootstrap test uses `empty-fixtures.ts` to provide no
Nitro contract.

| Package | Pinned version |
| --- | --- |
| react-native-nitro-modules | 0.37.1 |
| react-native-mmkv | 4.3.2 |
| react-native-nitro-image | 0.15.2 |
| expo | 58.0.0 |
| react-native | 0.88.0-rc.2 |
| react | 19.3.0 |

The workspace also installs `react-native-worklets` 0.13.0.

Covered by `e2e/nitro-fixture.test.ts` on the Android and iOS phone presets:

- MMKV factory initialization, string write/read/remove, and empty storage in a
  fresh host process. The fixture-specific storage id proves MMKV's built-in
  test mock did not handle the request.
- Nitro Image's public component and `getHostComponent` registration path,
  a 160×96 View fallback, interactive children, and no delivered `hybridRef`.
- `APPLICATION_FIXTURE` and `NATIVE_COMPONENT_FALLBACK` diagnostics, exact
  fixture allowances, unsupported boxing rejection, and useful errors for a
  missing Nitro bootstrap or named object.

Unverified: native MMKV storage, persistence, encryption and concurrency;
image loading, decoding and drawing; generated native props, native methods,
hybrid refs, JSI native state, and cross-runtime boxing. The image path is a
fixture sentinel, not a decoded file. Nitro's real native view contract is
described in the primary [Hybrid Views documentation](https://nitro.margelo.com/docs/concepts/hybrid-views).

Run from the repository root with a built host:

```sh
bun run rn-a11y-tree run examples/nitro-fixture/App.tsx --setup examples/nitro-fixture/fixtures.ts --script examples/nitro-fixture/actions.json --preset android-phone
bun run rn-a11y-tree render examples/nitro-fixture/View.tsx --setup examples/nitro-fixture/fixtures.ts --format json --preset android-phone

# Expected exit 6, even with every fixture and the box target allowed:
bun run rn-a11y-tree render examples/nitro-fixture/App.tsx --setup examples/nitro-fixture/fixtures.ts --format json --preset android-phone --fail-on-fallback --allow-fallback nitro/MMKVFactory --allow-fallback nitro/MMKVPlatformContext --allow-fallback NitroModules.box
bun run rn-a11y-tree render examples/nitro-fixture/View.tsx --setup examples/nitro-fixture/fixtures.ts --format json --preset android-phone --fail-on-fallback --allow-fallback nitro/ImageFactory --allow-fallback nitro/ImageLoaderFactory --allow-fallback nitro/ImageUtils --allow-fallback NitroImageView --allow-fallback NitroModules.box

RN_A11Y_E2E_STRICT=1 bun run test:e2e e2e/nitro-fixture.test.ts
```

Nitro 0.37.1 automatically attempts worklets registration during import. With
worklets installed, it calls `NitroModules.box(NitroModules)` and catches the
fixture's unsupported-operation error. Normal execution continues with
`NATIVE_API_UNSUPPORTED`; strict execution rejects it. Exact allowances can
accept application fixtures and the View fallback, but cannot suppress this
unsupported operation. No strict success or cross-runtime support is claimed.
