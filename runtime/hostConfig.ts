/**
 * Host settings that must be applied before the first render:
 * - headerHeight: react-native-screens native header height
 *   (NativeFantom.setScreensHeaderHeight; host default 56 = Android toolbar).
 * - safeAreaInsets: react-native-safe-area-context insets
 *   (NativeFantom.setSafeAreaInsets; host default 0).
 * - includeMountedProps: ask getA11yTree for mounted-view values (default
 *   true; `--no-mounted` turns it off). Read with `readA11yTree`.
 * - deviceMetrics (applyDeviceMetrics, before the app module loads, since
 *   apps read Dimensions at import time): NativeFantom.setDeviceMetrics
 *   ({width, height, scale, fontScale}) sets Dimensions (window and screen)
 *   and PixelRatio. Hosts without it (no `deviceMetrics` capability) keep
 *   their defaults, silently.
 * Settings the host does not support are reported with console.warn.
 */

const NativeFantom = require('./fantom/specs/NativeFantom').default;

let includeMountedProps = true;

/** NativeFantom.getA11yTree with the configured includeMountedProps. */
export function readA11yTree(surfaceId, includeDebugProps = false) {
  return NativeFantom.getA11yTree(surfaceId, includeDebugProps, includeMountedProps);
}

export function applyHostConfig({headerHeight, safeAreaInsets, mounted}) {
  includeMountedProps = mounted !== false;
  if (headerHeight != null) {
    if (typeof NativeFantom.setScreensHeaderHeight === 'function') {
      NativeFantom.setScreensHeaderHeight(headerHeight);
    } else {
      console.warn('rn-a11y-tree: the host has no setScreensHeaderHeight; header height not applied');
    }
  }
  if (safeAreaInsets != null) {
    if (typeof NativeFantom.setSafeAreaInsets === 'function') {
      NativeFantom.setSafeAreaInsets(safeAreaInsets);
    } else {
      console.warn('rn-a11y-tree: the host has no setSafeAreaInsets; safe area insets not applied');
    }
  }
}

export function applyDeviceMetrics(deviceMetrics) {
  if (deviceMetrics == null || typeof NativeFantom.setDeviceMetrics !== 'function') return;
  NativeFantom.setDeviceMetrics(deviceMetrics);
}
