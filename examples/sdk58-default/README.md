# SDK 58 default template regression fixture

Source: `expo/expo/templates/expo-template-default` at
`cfbcecdb6835a3241aff68061827a59a41d9080c` (0BSD).
The `src/` and `assets/` files are copied unchanged. The package is private,
uses the workspace Expo SDK version, and omits development scripts/dependencies.
The individual-screen tests render Home and Explore without a Router layout.
`RouterApp.tsx` additionally mounts the unchanged root layout through the real
`ExpoRoot` and upstream `expo-router/_ctx`. It adds labeled harness controls
outside the routes to call `router.navigate()` and observe `usePathname()`.

## Router discovery

The bundler uses the selected project's Expo config and Expo CLI route-root
helper. It honors the Router config plugin's `root` option (or
`extra.router.root`), then conventionally prefers `src/app` over `app`.
The resolved root is supplied to Metro's transform request and included in the
finished-bundle cache key. Config is evaluated before cache lookup, so a changed
config helper that selects another root invalidates the bundle.

Config evaluation is gated to projects declaring `expo-router` in their package
dependencies, using an `expo-router/...` package entry, or containing `src/app`
or `app`. A hoisted Router alone does not opt an unrelated component project in.
Declare Router in the app package when using a custom entry and custom route
directory. Dynamic app config and config plugins execute as trusted project code.

## Coverage and limitations

The focused E2E verifies boot and `/ → /explore → /` pathname changes on Android
and iOS. Separate temporary Slot routes verify actual Link navigation, removal
of inactive route content, conventional discovery, plugin custom roots, and
cache invalidation after a config helper changes. They also exercise upstream
`qualified-entry` outside the project with `--project-root`.
That entry reads the native initial URL; its Android test explicitly fixtures
`IntentAndroid.getInitialURL` to return `/` and asserts the fixture diagnostic.
The starter harness instead supplies `ExpoRoot location="/"` directly.

This is not native-tab parity. Both starter tab screens can remain mounted and
overlap in the headless tree; native tab controls, selection events, visibility,
insets and drawing are not verified. Tests require the platform tab-host
`NATIVE_COMPONENT_FALLBACK` diagnostic instead of treating registration as full
support. Splash completion, image decoding, native fonts and deep-link delivery
are also unverified.

Android's `router-fixtures.ts` supplies only a fixed Material palette for
`ExpoRouter`; it does not reproduce device theme resolution. Its use emits
`APPLICATION_FIXTURE expo/ExpoRouter`. Android also currently reports unsupported
font loading. Strict success is not claimed. The app declares Router `~58.0.9`;
the installed version exercised here is `58.0.12`.

Run from the repository root with a built host:

```sh
bun run rn-a11y-tree run examples/sdk58-default/RouterApp.tsx --preset android-phone --setup examples/sdk58-default/router-fixtures.ts --script '[{"tap":{"testID":"router-explore"}},{"snapshot":"explore"},{"tap":{"testID":"router-home"}}]'
bun run rn-a11y-tree render examples/sdk58-default/RouterApp.tsx --preset ios-phone --format json
RN_A11Y_E2E_STRICT=1 bun run test:e2e e2e/expo-router.test.ts
```

The E2E subprocesses use `NODE_ENV=production`: Expo deliberately skips `_ctx`
root transformation in `NODE_ENV=test` for its own test-library integration.
No root `App.tsx` is added, so the generic example schema sweep does not
implicitly opt into these native limitations.
