# rn-a11y-host

Prebuilt headless React Native host for
[react-native-a11y-tree](https://github.com/Kudo/react-native-a11y-tree):
the Fantom tester (Fabric, Hermes, Yoga) with the libraries it compiles in
(react-native-screens, safe-area-context, gesture-handler, reanimated,
worklets, expo-modules-core, @expo/ui). `host-version.json` records the
React Native commit, the overlay hash, the native library versions and the
`protocolVersion` of the CLI <-> host contract.

```js
import {getHostPath} from 'rn-a11y-host';
getHostPath(); // .../osx-bin/rn-a11y-host on macOS
```

Only macOS binaries are built for now.
