/** Resolves the optional native package selected by the package manager. */

import path from 'node:path';
import {createRequire} from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);

/** Thrown for platforms without a host build (`code` = `HOST_UNAVAILABLE`). */
export class HostUnavailableError extends Error {
  readonly code = 'HOST_UNAVAILABLE';
  readonly platform: string;
  readonly arch: string;

  constructor(platform: string, arch: string) {
    super(`react-native-a11y-tree has no runtime binary for ${platform}-${arch} (available: darwin, linux-x64, win32-x64)`);
    this.name = 'HostUnavailableError';
    this.platform = platform;
    this.arch = arch;
  }
}

/** Relative path of the host binary for `platform`/`arch` (default: this process). */
export function hostRelativePath(platform: string = process.platform, arch: string = process.arch): string {
  if (platform === 'darwin' && (arch === 'arm64' || arch === 'x64')) return path.join('osx-bin', 'rn-a11y-host');
  if (platform === 'linux' && arch === 'x64') return path.join('linux64-bin', 'rn-a11y-host');
  if (platform === 'win32' && arch === 'x64') return path.join('win64-bin', 'rn-a11y-host.exe');
  throw new HostUnavailableError(platform, arch);
}

/** Absolute path of the host binary for `platform`/`arch` (default: this process). */
export function getHostPath(platform: string = process.platform, arch: string = process.arch): string {
  const relative = hostRelativePath(platform, arch);
  const name = hostPackageName(platform, arch);
  try {
    const bin = path.join(path.dirname(require.resolve(`${name}/package.json`)), relative);
    if (fs.existsSync(bin)) return bin;
  } catch {
    // Optional dependencies may have been omitted at install time.
  }
  const error = new HostUnavailableError(platform, arch);
  error.message = `Missing optional host package ${name}. Reinstall with optional dependencies enabled (npm install --include=optional), or set RN_A11Y_HOST_BIN.`;
  throw error;
}

/** Path of host-version.json (what the binaries were built from, protocolVersion). */
export function getHostVersionPath(platform: string = process.platform, arch: string = process.arch): string {
  return path.join(path.dirname(path.dirname(getHostPath(platform, arch))), 'host-version.json');
}

/** npm package for a supported OS/CPU pair. */
export function hostPackageName(platform: string = process.platform, arch: string = process.arch): string {
  hostRelativePath(platform, arch); // Validate before resolving any package.
  const suffix = platform === 'darwin' ? 'darwin-universal' : platform === 'linux' ? 'linux-x64-gnu' : 'win32-x64-msvc';
  return `@react-native-a11y-tree/runtime-${suffix}`;
}
