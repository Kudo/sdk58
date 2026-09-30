# expo-view-configs

Generates `out/viewConfigs.json`: the props and events of every `@expo/ui`
native view, read from the Swift and Kotlin sources. A host without the Expo
native runtime can use it to answer `globalThis.expo.getViewConfig(moduleName,
viewName)` (see [`docs/research/expo-ui.md`](../../../docs/research/expo-ui.md)
sections 4 and 5).

```sh
node native/tools/expo-view-configs/generate.js                 # /tmp/expo-sdk58 if present
node native/tools/expo-view-configs/generate.js --src <expo checkout>
node native/tools/expo-view-configs/generate.js --expo-repo ~/Developer/expo --ref origin/sdk-58
node native/tools/expo-view-configs/generate.js --out <file>
```

No dependencies (Node >= 18). Sources: `--src <dir>` (a checkout), else
`/tmp/expo-sdk58` if it exists, else `git show <ref>:<path>` in
`--expo-repo` (default `~/Developer/expo`, `origin/sdk-58`).

## Output

```jsonc
{
  "source": "/tmp/expo-sdk58",
  "stats": {"ios": {"views": 69, "props": 290, "events": 103, ...}, "android": {...}, "keys": 152},
  "warnings": [],
  "views": {
    "ViewManagerAdapter_ExpoUI_Button": {
      "moduleName": "ExpoUI", "viewName": "Button",
      "ios": {
        "typeName": "ExpoUI.Button", "dsl": "ExpoUIView", "commonModifiers": true,
        "file": "packages/expo-ui/ios/Button/Button.swift:...", "registeredAt": "...ExpoUIModule.swift:146",
        "propsClass": "ButtonProps",
        "props": [{"name": "label", "type": "String?", "source": "..."}, ...],
        "events": [{"name": "onGlobalEvent", ...}, {"name": "onButtonPress", ...}],
        "validAttributes": {"testID": true, "modifiers": true, "label": true, ...},
        "directEventTypes": {"topGlobalEvent": {"registrationName": "onGlobalEvent"}, "topButtonPress": {...}}
      },
      "android": { /* same shape; propsClass is the Kotlin data class */ }
    }
  }
}
```

`validAttributes` / `directEventTypes` have the shape `getViewConfig` returns.

## Rules (from sdk-58 native code)

- iOS (`expo-modules-core/ios/Core/Modules/CoreModule.swift` `getViewConfig`,
  `SwiftUIViewDefinition.getSupportedPropNames/EventNames`): views are the
  `View(X.self)` / `ExpoUIView(X.self)` calls in `ios/ExpoUIModule.swift`; the
  name is the type name. Props are the `@Field` properties of the view's
  `props` class and its superclasses (`UIBaseViewProps` adds `testID`,
  `modifiers`), using the `@Field("key")` key if given. Events are the
  `EventDispatcher` properties, plus `onGlobalEvent` from
  `ExpoSwiftUI.ViewProps`. Keys: `RCTNormalizeInputEventName` (`onX` ->
  `topX`, else `top` + capitalized).
- Android (`defaultmodules/CoreModule.kt`): `ExpoUIView<Props>("Name") { val x
  by Event<T>() }` views: props are the constructor parameters of the props
  data class; events are the `by Event` properties plus `onGlobalEvent`.
  `View(X::class) { Events(...); Prop("...") }` views: props of the
  `ExpoComposeView<Props>` data class plus `Prop(...)`; events are only those
  in `Events(...)` (no `onGlobalEvent`). These also get React Native's CSS
  border props (`UseCSSProps`), marked `cssProps: true` and not listed. Keys:
  `normalizeEventName` (`onX` -> `topX`, else unchanged).
- Types are the source text (`String?`, `MutableState<Boolean>`); `unknown`
  where the source has no type (a `Prop("...")` in the module DSL).

Check: every view name that `src/swift-ui/**` and `src/jetpack-compose/**`
pass to `requireNativeView` has an entry for its platform.
