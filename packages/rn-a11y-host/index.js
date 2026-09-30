/**
 * Path of the prebuilt host binary for this platform, in the layout of
 * hermes-compiler's `hermesc/` directory:
 *
 *   osx-bin/rn-a11y-host        macOS (universal or arm64)
 *   linux64-bin/rn-a11y-host    Linux x64
 *   win64-bin/rn-a11y-host.exe  Windows x64
 *
 * `scripts/release-host.mjs --pack` fills these directories. The binaries of
 * a platform may be missing (not built yet): check `fs.existsSync()`.
 */

import path from 'node:path';
import {fileURLToPath} from 'node:url';

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));

/** Thrown for platforms without a host build (`code` = `HOST_UNAVAILABLE`). */
export class HostUnavailableError extends Error {
  constructor(platform, arch) {
    super(`rn-a11y-host has no host binary for ${platform}-${arch} (available: darwin, linux-x64, win32-x64)`);
    this.name = 'HostUnavailableError';
    this.code = 'HOST_UNAVAILABLE';
    this.platform = platform;
    this.arch = arch;
  }
}

/** Relative path of the host binary for `platform`/`arch` (default: this process). */
export function hostRelativePath(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return path.join('osx-bin', 'rn-a11y-host');
  if (platform === 'linux' && arch === 'x64') return path.join('linux64-bin', 'rn-a11y-host');
  if (platform === 'win32' && arch === 'x64') return path.join('win64-bin', 'rn-a11y-host.exe');
  throw new HostUnavailableError(platform, arch);
}

/** Absolute path of the host binary for `platform`/`arch` (default: this process). */
export function getHostPath(platform = process.platform, arch = process.arch) {
  return path.join(PACKAGE_DIR, hostRelativePath(platform, arch));
}

/** Path of host-version.json (what the binaries were built from, protocolVersion). */
export function getHostVersionPath() {
  return path.join(PACKAGE_DIR, 'host-version.json');
}
