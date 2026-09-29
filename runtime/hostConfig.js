/**
 * Host settings that must be applied before the first render:
 * - headerHeight: react-native-screens native header height
 *   (NativeFantom.setScreensHeaderHeight; host default 56 = Android toolbar).
 * - safeAreaInsets: react-native-safe-area-context insets
 *   (NativeFantom.setSafeAreaInsets; host default 0).
 * Settings the host does not support are reported with console.warn.
 */

const NativeFantom = require('./fantom/specs/NativeFantom').default;

export function applyHostConfig({headerHeight, safeAreaInsets}) {
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
