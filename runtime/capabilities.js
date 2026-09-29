/**
 * What the host supports: the optional NativeFantom methods that exist, plus
 * whatever the host reports through NativeFantom.getCapabilities() (for
 * features without a method of their own, e.g. `getA11yTree.mounted`).
 */

const NativeFantom = require('./fantom/specs/NativeFantom').default;

const OPTIONAL_METHODS = [
  'getA11yTree',
  'hitTest',
  'enqueueNativeEventByTag',
  'enqueueScrollEventByTag',
  'setTextInputTextByTag',
  'updateNativeStates',
  'setScreensHeaderHeight',
  'setSafeAreaInsets',
];

export function getCapabilities() {
  const out = OPTIONAL_METHODS.filter(name => typeof NativeFantom[name] === 'function');
  if (typeof NativeFantom.getCapabilities === 'function') {
    // The host returns a JSON array (string); accept an array too.
    const raw = NativeFantom.getCapabilities();
    const reported = typeof raw === 'string' ? JSON.parse(raw) : raw;
    for (const name of Array.isArray(reported) ? reported : []) {
      if (!out.includes(name)) out.push(name);
    }
  }
  return out;
}
