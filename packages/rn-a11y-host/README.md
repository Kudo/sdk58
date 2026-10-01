# rn-a11y-host

Small resolver for the prebuilt headless React Native host used by
[`react-native-a11y-tree`](https://github.com/Kudo/react-native-a11y-tree).

## Installation

The next release moves binaries out of this package into exact-version
`optionalDependencies` with npm `os` and `cpu` filters:

| Package | OS | CPU |
| --- | --- | --- |
| `rn-a11y-host-darwin` | macOS | arm64, x64 (universal) |
| `rn-a11y-host-linux-x64` | Linux, glibc 2.28+ | x64 |
| `rn-a11y-host-win32-x64` | Windows | x64 |

Your package manager installs the matching binary; no postinstall download
is needed. Keep optional dependencies enabled (`npm install --include=optional`).
Unsupported platforms can use `RN_A11Y_HOST_BIN` with a host built from source.
Previous releases bundled binaries directly in this package.

## API

```js
import {getHostPath, getHostVersionPath} from 'rn-a11y-host';

getHostPath();        // absolute path to this platform's installed binary
getHostVersionPath(); // absolute path to its host-version.json
```

Both accept optional `platform` and `arch` arguments (Node names, e.g.
`linux`, `x64`). Missing optional packages and unsupported platforms throw
`HostUnavailableError` with `code: 'HOST_UNAVAILABLE'`, `platform`, and `arch`.
The CLI can then try its configured download or local native build.

`hostRelativePath()` retains the binary's path within a platform package:
`osx-bin/rn-a11y-host`, `linux64-bin/rn-a11y-host`, or
`win64-bin/rn-a11y-host.exe`. `hostPackageName()` returns its npm package name.

## Packaging

Run `bun scripts/release-host.ts --pack` from the repository root. It builds
this resolver (`index.js`, `index.d.ts`) and stages each supplied binary in a
sibling platform package. `--package-dir` relocates the resolver and its siblings.
Each platform package contains its own `host-version.json` with provenance,
protocol version, architectures, checksum, and size. This resolver also retains
an aggregate manifest for tooling that reads `rn-a11y-host/host-version.json`.

Pack and publish populated platform packages first, then the resolver and CLI.
Keep all package versions and exact optional dependency versions synchronized.
No new command is installed by any host package; the CLI remains `rn-a11y-tree`.
