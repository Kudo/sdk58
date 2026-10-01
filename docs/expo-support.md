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
| `expo-image` | 1 | Unverified: native image-module APIs, loading and decoding need explicit support. |
| `expo-live-photo` | 1 | Unverified: loading and playback are not tested. |
| `expo-maps` | 3 | Unverified: Apple/Google Maps and Street View need module and interaction support. |
| `expo-mesh-gradient` | 1 | Unverified: props/layout have no dedicated test; no pixel rendering. |
| `expo-router` | 8 | Unverified: native link previews, transitions and toolbars. The existing React Navigation stack tests do not cover these. |
| `expo-symbols` | 1 | Unverified: symbol props/layout have no dedicated test; no glyph rendering. |
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

Next coverage work should start with image, symbols and mesh-gradient imports,
props and accessibility; then clipboard/authentication/contact buttons and
Router views. Camera, maps, GL, video and Live Photo need explicit deterministic
native API contracts rather than success-returning placeholder methods.
