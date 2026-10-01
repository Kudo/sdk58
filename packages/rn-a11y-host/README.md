# rn-a11y-host

Prebuilt headless React Native host for
[react-native-a11y-tree](https://github.com/Kudo/react-native-a11y-tree).
It is the Fantom tester of React Native (Fabric, Hermes, Yoga; text
measurement with CoreText on macOS and a portable stb_truetype layout with
embedded fonts on Linux) with the native code of react-native-screens,
react-native-safe-area-context, react-native-gesture-handler,
react-native-reanimated, react-native-worklets, expo-modules-core and
`@expo/ui` (SwiftUI and Compose layout emulation) compiled in. You do not
use it directly: `react-native-a11y-tree` depends on it and runs it.

## Platforms

- **Next release (unreleased):** `osx-bin/rn-a11y-host` (universal macOS,
  as in 0.1.1) and `linux64-bin/rn-a11y-host`: Linux x86_64, one
  executable built on glibc 2.28 (manylinux_2_28) that links only glibc
  (`libc`, `libm`, `libdl`, `libpthread`; needs GLIBC_2.27 at most) and
  runs on glibc 2.28+ distributions (checked on Debian 10, Ubuntu 20.04 and
  24.04). ICU is linked in with its data trimmed to root and English. The
  release workflow builds every platform, packs them into one package and
  installs it in a scratch project on Linux and macOS before releasing.
- **0.1.1:** a **universal macOS binary** (arm64 + x86_64, joined with
  `lipo`) in `osx-bin/rn-a11y-host`. The release workflow cross-builds the
  x86_64 slice on its arm64 runner and renders an example with it on an
  Intel runner before packing.
- **0.1.0:** a binary for **macOS arm64 only** (`osx-bin/rn-a11y-host`).

The `win64-bin/` slot (`rn-a11y-host.exe`) is empty for now; before the
next release `linux64-bin/` is empty too.

## API

```js
import {getHostPath, getHostVersionPath} from 'rn-a11y-host';

getHostPath();        // <package>/osx-bin/rn-a11y-host on macOS, linux64-bin/rn-a11y-host on Linux x64
getHostVersionPath(); // <package>/host-version.json
```

`getHostPath(platform?, arch?)` returns the path for `darwin` (any arch:
`osx-bin/rn-a11y-host`), `linux` x64 (`linux64-bin/rn-a11y-host`) and
`win32` x64 (`win64-bin/rn-a11y-host.exe`). The file can be missing (the
Linux and Windows slots; in 0.1.0 also on Intel Macs, because that binary is
arm64 only): check it with `fs.existsSync()`. For any other platform it
throws `HostUnavailableError` with `code: 'HOST_UNAVAILABLE'`, `platform`
and `arch`. `react-native-a11y-tree` then looks for other hosts
(`RN_A11Y_HOST_BIN`, a download with `RN_A11Y_HOST_BASE_URL`), else stops
with `HOST_MISSING`.

## host-version.json

What the binary was built from: `version`
(`<react-native version>-<hash of the inputs>`), `protocolVersion`, the
React Native commit, a hash of the repo's `native/overlay`, the versions of
the compiled-in npm packages, and `binaries`: one entry per file
(`osx-bin/rn-a11y-host`, `linux64-bin/rn-a11y-host`,
`win64-bin/rn-a11y-host.exe`) with its archs (read from the executable
header), sha256 and size.

`protocolVersion` is the version of the contract between the CLI and the
host (bundle entry, host methods, stdout protocol). **0.1.0 has protocol 1.**
The host also reports it at run time (`NativeFantom.getHostInfo()`).
`react-native-a11y-tree` 0.1.0 supports protocol 1 and stops with
`HOST_INCOMPATIBLE` for any other version.

## License

MIT
