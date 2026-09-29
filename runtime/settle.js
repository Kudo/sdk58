/**
 * Delivers queued native events and runs the work loop until the tree stops
 * changing (bounded). Fabric emits `onLayout` from a commit hook into the
 * event queue; Fantom only delivers queued events on `flushEventQueue`, so
 * without this `onLayout` never reaches JS (and e.g. FlatList never learns
 * its viewport and content sizes).
 */

const Fantom = require('./fantom/index');
const NativeFantom = require('./fantom/specs/NativeFantom').default;

const MAX_ROUNDS = 10;

export function settle(surfaceId) {
  const canCompare = typeof NativeFantom.getA11yTree === 'function';
  let previous = canCompare ? NativeFantom.getA11yTree(surfaceId, false) : null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    Fantom.flushAllNativeEvents();
    if (!canCompare) continue;
    const current = NativeFantom.getA11yTree(surfaceId, false);
    if (current === previous) return round + 1;
    previous = current;
  }
  return MAX_ROUNDS;
}
