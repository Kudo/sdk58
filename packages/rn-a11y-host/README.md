# rn-a11y-host

Prebuilt headless React Native host for
[react-native-a11y-tree](https://github.com/Kudo/react-native-a11y-tree).
It is the Fantom tester of React Native (Fabric, Hermes, Yoga, CoreText
text measurement) with the native code of react-native-screens,
react-native-safe-area-context, react-native-gesture-handler,
react-native-reanimated, react-native-worklets, expo-modules-core and
`@expo/ui` (SwiftUI and Compose layout emulation) compiled in. You do not
use it directly: `react-native-a11y-tree` depends on it and runs it.

## Platforms

Version 0.1.0 has a binary for **macOS arm64 only** (`osx-bin/rn-a11y-host`).
The `linux64-bin/` and `win64-bin/` slots of the layout are empty.

## API

```js
import {getHostPath, getHostVersionPath} from 'rn-a11y-host';

getHostPath();        // <package>/osx-bin/rn-a11y-host on macOS
getHostVersionPath(); // <package>/host-version.json
```

`getHostPath(platform?, arch?)` returns the path for `darwin` (any arch:
`osx-bin/rn-a11y-host`), `linux` x64 (`linux64-bin/rn-a11y-host`) and
`win32` x64 (`win64-bin/rn-a11y-host.exe`). The file can be missing (the
Linux and Windows slots in 0.1.0; also Intel Macs, because the 0.1.0 binary
is arm64 only): check it with `fs.existsSync()`. For any other platform it
throws `HostUnavailableError` with `code: 'HOST_UNAVAILABLE'`, `platform`
and `arch`. `react-native-a11y-tree` then looks for other hosts
(`RN_A11Y_HOST_BIN`, a download with `RN_A11Y_HOST_BASE_URL`), else stops
with `HOST_MISSING`.

## host-version.json

What the binary was built from: `version`
(`<react-native version>-<hash of the inputs>`), `protocolVersion`, the
React Native commit, a hash of the repo's `native/overlay`, the versions of
the compiled-in npm packages, and `binaries` (arch, sha256 and size of each
file).

`protocolVersion` is the version of the contract between the CLI and the
host (bundle entry, host methods, stdout protocol). **0.1.0 has protocol 1.**
The host also reports it at run time (`NativeFantom.getHostInfo()`).
`react-native-a11y-tree` 0.1.0 supports protocol 1 and stops with
`HOST_INCOMPATIBLE` for any other version.

## License

MIT
