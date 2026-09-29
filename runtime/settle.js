/**
 * Delivers queued native events (and host-emulated native state updates)
 * and runs the work loop until the tree stops changing (bounded). Fabric emits `onLayout` from a commit hook into the
 * event queue; Fantom only delivers queued events on `flushEventQueue`, so
 * without this `onLayout` never reaches JS (and e.g. FlatList never learns
 * its viewport and content sizes).
 */

const Fantom = require('./fantom/index');
import {readA11yTree} from './hostConfig';

const NativeFantom = require('./fantom/specs/NativeFantom').default;

const MAX_ROUNDS = 10;

export function settle(surfaceId) {
  const canCompare = typeof NativeFantom.getA11yTree === 'function';
  let previous = canCompare ? readA11yTree(surfaceId) : null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // Host-emulated native state (react-native-screens, safe area); the
    // host also does this after every mount.
    if (typeof NativeFantom.updateNativeStates === 'function') {
      NativeFantom.updateNativeStates(surfaceId);
    }
    Fantom.flushAllNativeEvents();
    if (!canCompare) continue;
    const current = readA11yTree(surfaceId);
    if (current === previous) return round + 1;
    previous = current;
  }
  return MAX_ROUNDS;
}
