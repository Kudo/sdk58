/**
 * Pure helpers over the typed `NativeFantom.getA11yTree` JSON, used by the
 * action runner inside the bundle. No react-native imports, so Node unit
 * tests can import this file too.
 *
 * The ref numbering and the kept-child rule MUST match `src/tree.ts`
 * (`convertShadowNode` / `isKeptChild`); `test/tree-index.test.ts` checks it.
 */

// Nested `<Text>` spans are kept only if they carry one of these.
const SPAN_A11Y_KEYS = [
  'accessibilityLabel',
  'role',
  'accessibilityRole',
  'accessible',
  'testID',
];

export function isKeptChild(child) {
  if (child.type === 'RawText') return false;
  if (child.type === 'Text') {
    return SPAN_A11Y_KEYS.some(key => child[key] !== undefined);
  }
  return true;
}

/**
 * Flattens the tree in pre-order. Each entry:
 * `{node, ref, tag, type, testID, box, virtual, parent, children}` where
 * `box` is the on-screen position (sum of parent frames minus ancestor
 * scroll offsets), `parent` is the parent entry
 * (or null) and `children` are child entries.
 */
export function indexTree(root) {
  const entries = [];
  let counter = 0;

  function visit(node, origin, parentBox, parent) {
    const virtual = node.frame == null;
    const box = virtual
      ? {...(parentBox ?? {x: origin.x, y: origin.y, width: 0, height: 0})}
      : {
          x: origin.x + node.frame.x,
          y: origin.y + node.frame.y,
          width: node.frame.width,
          height: node.frame.height,
        };
    const entry = {
      node,
      ref: `n${counter++}`,
      tag: node.tag ?? null,
      type: node.type,
      testID: node.testID ?? null,
      box,
      virtual,
      parent,
      children: [],
    };
    entries.push(entry);
    // Children are at parent position + contentOriginOffset + child frame
    // (ScrollView: -contentOffset, RNSScreen: header height). Must match
    // src/tree.ts contentOrigin().
    const offset =
      node.contentOriginOffset ??
      (node.contentOffset != null
        ? {x: -(node.contentOffset.x ?? 0), y: -(node.contentOffset.y ?? 0)}
        : {x: 0, y: 0});
    const childOrigin = virtual
      ? origin
      : {x: box.x + offset.x, y: box.y + offset.y};
    for (const child of node.children ?? []) {
      if (isKeptChild(child)) {
        entry.children.push(visit(child, childOrigin, box, entry));
      }
    }
    return entry;
  }

  visit(root, {x: 0, y: 0}, null, null);
  return entries;
}

export function findEntry(entries, target) {
  if (target.ref != null) {
    return entries.find(e => e.ref === target.ref) ?? null;
  }
  if (target.testID != null) {
    return entries.find(e => e.testID === target.testID) ?? null;
  }
  if (target.tag != null) {
    return entries.find(e => e.tag === target.tag) ?? null;
  }
  return null;
}

export function center(box) {
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

function contains(box, x, y) {
  return (
    x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height
  );
}

/**
 * JS hit test used when the host has no `NativeFantom.hitTest`. Returns the
 * deepest entry containing the point. Later siblings are on top. Honors
 * `pointerEvents` (`none`, `box-none`, `box-only`). Ignores zIndex,
 * transforms and overflow clipping.
 */
export function hitTestEntries(entries, x, y) {
  function hit(entry) {
    if (entry.virtual) return null;
    const pointerEvents = entry.node.pointerEvents ?? 'auto';
    if (pointerEvents === 'none') return null;
    if (!contains(entry.box, x, y)) return null;
    if (pointerEvents !== 'box-only') {
      for (let i = entry.children.length - 1; i >= 0; i--) {
        const found = hit(entry.children[i]);
        if (found) return found;
      }
    }
    return pointerEvents === 'box-none' ? null : entry;
  }
  return entries.length > 0 ? hit(entries[0]) : null;
}

/** True if `entry` is `ancestor` or one of its descendants. */
export function isWithin(entry, ancestor) {
  if (ancestor == null) return false;
  for (let e = entry; e != null; e = e.parent) {
    // Compare by tag too: the host hit test returns a copy of the entry.
    if (e === ancestor || (e.tag != null && e.tag === ancestor.tag)) return true;
  }
  return false;
}
