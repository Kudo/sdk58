# Expo native-view support (SDK 58)

The renderer runs real component JavaScript in Metro/Hermes and mounts Fabric
nodes. A registered native view is not proof that its native module, methods,
platform layout or events are implemented. This matrix distinguishes tested
behavior from views discovered in Expo's source.

The [inventory](expo-native-views.json) records **183 distinct native views in
18 packages**, from **192 call sites**, pinned to Expo SDK 58 commit
[`cfbcecdb6835a3241aff68061827a59a41d9080c`](https://github.com/expo/expo/tree/cfbcecdb6835a3241aff68061827a59a41d9080c/packages).
Each entry retains file names, lines, factories and inferred platforms. It covers
`requireNativeView`, `requireNativeViewManager`, `requireNativeComponent` and
`codegenNativeComponent`, including renamed imports, namespace imports, local
view factories and conditional view names. Platform wrappers are deduplicated.
It excludes core infrastructure, generated builds, tests and mocks. It is not an
inventory of pure JavaScript components or non-view native APIs. Platform labels
are inferred from source paths; a conditional call may have a narrower platform.

| Package | Native views | Coverage and limitations |
| --- | ---: | --- |
| `@expo/ui` | 152 | Partial: every inventoried view has a prop/event config. Selected controls have tested accessibility, actions and emulated SwiftUI/Compose layout. See the [per-view layout matrix](expo-ui-status.md); many views still have placeholder layout. |
| `expo-glass-effect` | 2 | Tested approximation: iOS GlassView/GlassContainer props, Yoga frames, accessible children and child presses. Android uses Expo's View fallback. No optical glass, tint blending or merging. |
| `expo-blur` | 2 | Tested approximation: BlurView and BlurTargetView, child layout/accessibility, native prop forwarding. No blur sampling or pixels. |
| `expo-linear-gradient` | 1 | Tested approximation: native props, container frames and children on both presets. No gradient rasterization. |
| `@expo/dom-webview` | 1 | Unverified: browser/DOM lifecycle and content need a separate implementation. |
| `expo-app-intents` | 1 | Unverified: app-entity integration is not tested. |
| `expo-apple-authentication` | 1 | Unverified: native button semantics and authentication are not tested. |
| `expo-camera` | 1 | Unverified: permissions, preview and capture are not simulated. |
| `expo-clipboard` | 1 | Unverified: native paste-button behavior is not tested. |
| `expo-contacts` | 1 | Unverified: native contact-access button and permission flow are not tested. |
| `expo-gl` | 1 | Unverified: no GL context/rendering simulation. |
| `expo-image` | 1 | Tested approximation: image props/source metadata, explicit layout and accessibility. Module adapter allows imports; loading, decoding, caching, hashes, native refs and load events are not simulated. |
| `expo-live-photo` | 1 | Unverified: loading and playback are not tested. |
| `expo-maps` | 3 | Unverified: Apple/Google Maps and Street View need module and interaction support. |
| `expo-mesh-gradient` | 1 | Unverified: props/layout have no dedicated test; no pixel rendering. |
| `expo-router` | 8 | Unverified: native link previews, transitions and toolbars. The existing React Navigation stack tests do not cover these. |
| `expo-symbols` | 1 | Starter-screen coverage: iOS symbol props and frames; Android retains its unloaded-font placeholder. No glyph rendering, animation or custom-font loading. |
| `expo-video` | 4 | Unverified: video surfaces, shared player objects, playback and AirPlay are not simulated. |

Evidence: [`e2e/expo-effects.test.ts`](../e2e/expo-effects.test.ts) exercises real
SDK 58 imports, native props, frames, child accessibility and interaction for
glass/blur/gradient on iOS and Android presets. [`e2e/expo-ui.test.ts`](../e2e/expo-ui.test.ts)
covers the existing UI controls. [`test/expo-inventory.test.ts`](../test/expo-inventory.test.ts)
checks the scanner and keeps all 152 discovered Expo UI names aligned with the
shipped view configs. The inventory itself makes no support claim.

## Glass availability

On the iOS preset, `isLiquidGlassAvailable()` and `isGlassEffectAPIAvailable()`
return `true` so apps render their glass branch against the emulated containers.
This is a deterministic headless capability, not a check of the build machine's
OS or GPU. On Android, Expo's own implementations return `false`. The host
preserves glass-specific props in the tree's `expo` field; visual effects and
native-only glass interaction are not simulated. Normal React Native pressable
children are interactive.

## Refresh the inventory

From this repository, with a separate Expo checkout:

```sh
bun scripts/expo-view-inventory.ts --expo-root /path/to/expo \
  --ref cfbcecdb6835a3241aff68061827a59a41d9080c
# Verify reproducibility against the same commit:
bun scripts/expo-view-inventory.ts --expo-root /path/to/expo \
  --ref cfbcecdb6835a3241aff68061827a59a41d9080c --check
```

The script reads Git objects without changing the Expo checkout. Unknown dynamic
expressions remain in the inventory for manual review instead of being silently
omitted. Update this matrix and add real render/action tests before promoting a
view from unverified to supported or approximate.

Next coverage work should extend image/symbol native APIs and mesh-gradient
props/accessibility; then clipboard/authentication/contact buttons and Router views. Camera, maps, GL, video and Live Photo need explicit deterministic
native API contracts rather than success-returning placeholder methods.


## Native modules (0.1.3)

The [module inventory](expo-native-modules.json) contains **109 entries
from 119 call sites in 74 packages**, pinned to the same SDK 58 commit.
It scans `requireNativeModule` and `requireOptionalNativeModule`, renamed imports,
namespace imports and local factories, including core-internal imports. Required
versus optional status stays attached to each source location. Dynamic names are
retained as unresolved expressions. Platform labels are inferred from file paths.
`members` lists conservative, same-file static accesses on a module binding; it
is **not** the API surface or a complete cross-file usage graph. An empty list
does not mean the module has no APIs. Generated files, tests and mocks are excluded.

```sh
bun scripts/expo-module-inventory.ts --expo-root /path/to/expo \
  --ref cfbcecdb6835a3241aff68061827a59a41d9080c
# Reproduce without modifying the checkout or generated output:
bun scripts/expo-module-inventory.ts --expo-root /path/to/expo \
  --ref cfbcecdb6835a3241aff68061827a59a41d9080c --check
```

A missing native module can fail at import time, before the View fallback runs.
There is no generic module proxy that invents methods or returns success. Known
modules use explicit adapters, installed lazily with one
`[NATIVE_MODULE_FALLBACK]` stderr warning per module, including in quiet/session
mode. Existing modules are retained. Unknown optional modules remain unavailable;
unknown required modules fail with a hint to use an application mock or add an
adapter. Unsupported adapter operations throw/reject `[NATIVE_API_UNSUPPORTED]`.

| Adapter | Headless contract |
| --- | --- |
| `ExpoImage` | Allows importing/rendering Image. View props, source metadata and accessibility survive. Explicit sizes/aspect ratios determine layout. Does not infer remote image dimensions or emit successful load events. Native image construction, loading, prefetching, caching and hash generation fail explicitly. |
| `ExpoDevice` | `isDevice=false`; hardware/OS metadata is unknown (`null`). Native device queries reject. Does not identify the host machine or pretend to be the preset's physical device. |
| `ExpoLinking` | No initial URL (`null`) and no native URL events; clearing the absent initial URL is a no-op. |
| `ExpoFontLoader` | Empty custom-font inventory; native loading/unloading rejects. Libraries may retain their unloaded-font fallback. |
| `ExpoWebBrowser` | Allows import; browser/authentication launch, warmup and dismissal are unsupported. No browser is opened. |

These supplement the existing ExpoUI, glass, asset and constants shims. They do
not make the other inventoried modules supported. Optional modules such as
ExpoSplashScreen and ExpoFontUtils are deliberately left absent.

`e2e/expo-template.test.ts` renders the unchanged SDK 58 Home and Explore screens
from `examples/sdk58-default` on both presets and opens Explore's Images section.
`e2e/expo-modules.test.ts` covers image layout/accessibility/source metadata,
rejected APIs, optional absence, required-module errors and session stderr.
Standalone screens receive safe-area inset/frame contexts based on CLI settings
when `react-native-safe-area-context` is installed. An application's own providers
take precedence. These are screen tests, not full Expo Router navigation tests.
