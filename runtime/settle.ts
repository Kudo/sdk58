/**
 * Delivers queued native events (and host-emulated native state updates)
 * and runs the work loop until nothing changes (bounded): the host's shadow
 * tree and mounted revisions stop advancing (else the tree dump stops
 * changing). Fabric emits `onLayout` from a commit hook into the
 * event queue; Fantom only delivers queued events on `flushEventQueue`, so
 * without this `onLayout` never reaches JS (and e.g. FlatList never learns
 * its viewport and content sizes).
 */

import type {RootTag} from 'react-native';

const Fantom = require('./fantom/index') as typeof import('./fantom/index');
import {readA11yTree} from './hostConfig';

const NativeFantom = (require('./fantom/specs/NativeFantom') as typeof import('./fantom/specs/NativeFantom'))
  .default;

const MAX_ROUNDS = 10;

/**
 * Committed and mounted revisions of the surface: both advance on every
 * commit (state updates included), and they are equal when everything
 * committed is mounted. Null when the host lacks them.
 */
function revisions(surfaceId: RootTag): string | null {
  if (
    typeof NativeFantom.getShadowTreeRevision !== 'function' ||
    typeof NativeFantom.getMountedRevision !== 'function'
  ) {
    return null;
  }
  return (
    NativeFantom.getShadowTreeRevision(surfaceId) + ':' + NativeFantom.getMountedRevision(surfaceId)
  );
}

function step(surfaceId: RootTag): void {
  // Host-emulated native state (react-native-screens, safe area); the
  // host also does this after every mount.
  if (typeof NativeFantom.updateNativeStates === 'function') {
    NativeFantom.updateNativeStates(surfaceId);
  }
  Fantom.flushAllNativeEvents();
}

/** Returns the number of rounds. */
export function settle(surfaceId: RootTag): number {
  let previousRevisions = revisions(surfaceId);
  if (previousRevisions != null) {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      step(surfaceId);
      const current = revisions(surfaceId);
      if (current === previousRevisions) return round + 1;
      previousRevisions = current;
    }
    return MAX_ROUNDS;
  }
  // Older hosts: compare tree dumps.
  const canCompare = typeof NativeFantom.getA11yTree === 'function';
  let previous = canCompare ? readA11yTree(surfaceId) : null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    step(surfaceId);
    if (!canCompare) continue;
    const current = readA11yTree(surfaceId);
    if (current === previous) return round + 1;
    previous = current;
  }
  return MAX_ROUNDS;
}
