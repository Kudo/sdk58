/**
 * Pure helpers over the typed `NativeFantom.getA11yTree` JSON, used by the
 * action runner inside the bundle. No react-native imports, so Node unit
 * tests can import this file too.
 *
 * The ref numbering and the kept-child rule MUST match `src/tree.ts`
 * (`convertShadowNode` / `isKeptChild`); `test/tree-index.test.ts` checks it.
 */

export type Point = {x: number; y: number};
export type Box = {x: number; y: number; width: number; height: number};
/** 4x4, column-major (the host's `transform` format). */
type Matrix = number[];

/**
 * A node of the `NativeFantom.getA11yTree` JSON: the fields the runtime
 * reads (the full shape is `ShadowNodeJSON` in src/schema.ts).
 */
export type A11yNode = {
  type: string;
  tag?: number;
  frame?: Box;
  contentOriginOffset?: Point;
  contentOffset?: {x?: number; y?: number};
  contentSize?: {width: number; height: number};
  transform?: unknown;
  mounted?: {frame?: Box; transform?: unknown};
  pointerEvents?: string;
  testID?: string;
  accessibilityLabel?: string;
  role?: string;
  accessibilityRole?: string;
  accessible?: boolean;
  text?: unknown;
  value?: unknown;
  expo?: Record<string, unknown>;
  layout?: string;
  children?: A11yNode[];
};

export type IndexEntry = {
  node: A11yNode;
  ref: string;
  visualBox: Box;
  tag: number | null;
  type: string;
  testID: string | null;
  box: Box;
  virtual: boolean;
  parent: IndexEntry | null;
  children: IndexEntry[];
  /** Set by assignKeysAndSelectors. */
  key?: string;
  sel?: string;
};

/** An entry, or anything with a tag and a parent chain (hit test results). */
export type Linked = {tag: number | null; parent: Linked | null};

/** How an action names its target (the first key that is set wins). */
export type TargetSpec = {
  key?: string | null;
  sel?: string | null;
  ref?: string | null;
  testID?: string | null;
  tag?: number | null;
};

// Nested `<Text>` spans are kept only if they carry one of these.
const SPAN_A11Y_KEYS = [
  'accessibilityLabel',
  'role',
  'accessibilityRole',
  'accessible',
  'testID',
] as const;

export function isKeptChild(child: A11yNode): boolean {
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
// --- transforms (same rules as src/tree.ts visualFor) -----------------------

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Matrix, b: Matrix): Matrix {
  const out: Matrix = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];
}

function isIdentity(m: Matrix): boolean {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) < 1e-9);
}

function applyMatrix(m: Matrix, x: number, y: number): Point {
  const w = m[3] * x + m[7] * y + m[15] || 1;
  return {x: (m[0] * x + m[4] * y + m[12]) / w, y: (m[1] * x + m[5] * y + m[13]) / w};
}

function boundsAfter(m: Matrix, rect: Box): Box {
  const corners = [
    applyMatrix(m, rect.x, rect.y),
    applyMatrix(m, rect.x + rect.width, rect.y),
    applyMatrix(m, rect.x, rect.y + rect.height),
    applyMatrix(m, rect.x + rect.width, rect.y + rect.height),
  ];
  const xs = corners.map(c => c.x);
  const ys = corners.map(c => c.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y};
}

function asMatrix(value: unknown): Matrix | null {
  return Array.isArray(value) && value.length === 16 ? (value as Matrix) : null;
}

/** Returns {visualBox, childMatrix} for a node with layout box `box`. */
function visualOf(
  node: A11yNode,
  origin: Point,
  box: Box,
  virtual: boolean,
  parentMatrix: Matrix | null,
): {visualBox: Box; childMatrix: Matrix | null} {
  if (virtual) {
    return {
      visualBox: parentMatrix != null ? boundsAfter(parentMatrix, box) : box,
      childMatrix: parentMatrix,
    };
  }
  const mounted = node.mounted;
  const drawn =
    mounted?.frame != null
      ? {
          x: origin.x + mounted.frame.x,
          y: origin.y + mounted.frame.y,
          width: mounted.frame.width,
          height: mounted.frame.height,
        }
      : box;
  const transform = asMatrix(mounted?.transform) ?? asMatrix(node.transform);
  let about: Matrix | null = null;
  if (transform != null && !isIdentity(transform)) {
    const cx = drawn.x + drawn.width / 2;
    const cy = drawn.y + drawn.height / 2;
    about = multiply(translation(cx, cy), multiply(transform, translation(-cx, -cy)));
  }
  let local: Matrix | null = null;
  if (drawn.x !== box.x || drawn.y !== box.y) local = translation(drawn.x - box.x, drawn.y - box.y);
  if (about != null) local = local != null ? multiply(about, local) : about;
  const childMatrix =
    parentMatrix != null && local != null ? multiply(parentMatrix, local) : (local ?? parentMatrix);
  const own = about != null ? (parentMatrix != null ? multiply(parentMatrix, about) : about) : parentMatrix;
  return {visualBox: own != null ? boundsAfter(own, drawn) : drawn, childMatrix};
}

export function indexTree(root: A11yNode): IndexEntry[] {
  const entries: IndexEntry[] = [];
  let counter = 0;

  function visit(
    node: A11yNode,
    origin: Point,
    parentBox: Box | null,
    parent: IndexEntry | null,
    parentMatrix: Matrix | null,
  ): IndexEntry {
    const virtual = node.frame == null;
    const box: Box = virtual
      ? {...(parentBox ?? {x: origin.x, y: origin.y, width: 0, height: 0})}
      : {
          x: origin.x + node.frame!.x,
          y: origin.y + node.frame!.y,
          width: node.frame!.width,
          height: node.frame!.height,
        };
    const {visualBox, childMatrix} = visualOf(node, origin, box, virtual, parentMatrix);
    const entry: IndexEntry = {
      node,
      ref: `n${counter++}`,
      // Where the node is drawn (transforms, mounted frame); equals `box`
      // when nothing applies. Taps aim at its center; the JS hit test uses it.
      visualBox,
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
    const offset: Point =
      node.contentOriginOffset ??
      (node.contentOffset != null
        ? {x: -(node.contentOffset.x ?? 0), y: -(node.contentOffset.y ?? 0)}
        : {x: 0, y: 0});
    const childOrigin = virtual
      ? origin
      : {x: box.x + offset.x, y: box.y + offset.y};
    for (const child of node.children ?? []) {
      if (isKeptChild(child)) {
        entry.children.push(visit(child, childOrigin, box, entry, childMatrix));
      }
    }
    return entry;
  }

  visit(root, {x: 0, y: 0}, null, null, null);
  assignKeysAndSelectors(entries[0]);
  return entries;
}

/**
 * Adds `key` and `sel` to every entry, with the same rules as src/tree.ts
 * (`withKeys`, `selectors`).
 */
function assignKeysAndSelectors(root: IndexEntry | undefined): void {
  const seen = new Map<string, number>();
  const visit = (
    entry: IndexEntry,
    parentKey: string | null,
    parentPath: string,
    index: number,
    siblingCount: number,
  ): void => {
    if (entry.testID) {
      const count = (seen.get(entry.testID) ?? 0) + 1;
      seen.set(entry.testID, count);
      entry.key = count === 1 ? entry.testID : `${entry.testID}:${count}`;
    } else {
      entry.key = parentKey == null ? entry.type : `${parentKey}/${entry.type}:${index}`;
    }
    const typeSel = siblingCount > 1 ? `${entry.type}:${index}` : entry.type;
    const pathSel = parentPath ? `${parentPath}>${typeSel}` : typeSel;
    entry.sel = entry.testID ? `#${entry.testID}` : pathSel;
    const counts = new Map<string, number>();
    for (const c of entry.children) counts.set(c.type, (counts.get(c.type) ?? 0) + 1);
    const seenType = new Map<string, number>();
    for (const c of entry.children) {
      const n = (seenType.get(c.type) ?? 0) + 1;
      seenType.set(c.type, n);
      visit(c, entry.key, pathSel, n, counts.get(c.type)!);
    }
  };
  if (root != null) visit(root, null, '', 1, 1);
}

export function findEntry(entries: IndexEntry[], target: TargetSpec): IndexEntry | null {
  if (target.key != null) {
    return entries.find(e => e.key === target.key) ?? null;
  }
  if (target.sel != null) {
    return entries.find(e => e.sel === target.sel) ?? null;
  }
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

export function center(box: Box): Point {
  return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

function contains(box: Box, x: number, y: number): boolean {
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
export function hitTestEntries(entries: IndexEntry[], x: number, y: number): IndexEntry | null {
  function hit(entry: IndexEntry): IndexEntry | null {
    if (entry.virtual) return null;
    const pointerEvents = entry.node.pointerEvents ?? 'auto';
    if (pointerEvents === 'none') return null;
    if (!contains(entry.visualBox ?? entry.box, x, y)) return null;
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
export function isWithin(entry: Linked | null, ancestor: Linked | null): boolean {
  if (ancestor == null) return false;
  for (let e = entry; e != null; e = e.parent) {
    // Compare by tag too: the host hit test returns a copy of the entry.
    if (e === ancestor || (e.tag != null && e.tag === ancestor.tag)) return true;
  }
  return false;
}
