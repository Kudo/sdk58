import type {
  A11yInfo,
  A11yState,
  Box,
  FantomNode,
  HostPayload,
  HostRunPayload,
  RenderResult,
  RunResult,
  ShadowNodeJSON,
  StepNode,
  TreeNode,
} from './schema.ts';

/**
 * Converts the payload printed by the JS entry into the rn-a11y-tree output
 * schema. Two host formats are supported, see `TreeSource`.
 */
export function toRenderResult(payload: HostPayload): RenderResult {
  const nextRef = refCounter();
  if (payload.source === 'shadowTree') {
    return {
      viewport: payload.viewport,
      source: 'shadowTree',
      root: convertShadowNode(payload.tree, ORIGIN, '', nextRef, null),
    };
  }
  return {
    viewport: payload.viewport,
    source: 'mounted',
    root: convertMountedNode(payload.tree, ORIGIN, '', nextRef, null),
  };
}

/** Converts the payload of `run --script`: every snapshot and the final tree. */
export function toRunResult(payload: HostRunPayload): RunResult {
  const snapshots: Record<string, TreeNode> = {};
  for (const [name, tree] of Object.entries(payload.snapshots)) {
    snapshots[name] = convertShadowTree(tree);
  }
  return {
    viewport: payload.viewport,
    source: 'shadowTree',
    steps: payload.steps.map(step => ({
      ...step,
      target: roundStepNode(step.target),
      hit: roundStepNode(step.hit),
    })),
    snapshots,
    final: convertShadowTree(payload.final),
  };
}

function roundStepNode(node: StepNode | null): StepNode | null {
  if (node?.box == null) return node;
  const {x, y, width, height} = node.box;
  return {
    ...node,
    box: {x: round(x), y: round(y), width: round(width), height: round(height)},
  };
}

/** Converts one typed getA11yTree root. Refs start at `n0` for each tree. */
export function convertShadowTree(tree: ShadowNodeJSON): TreeNode {
  return convertShadowNode(tree, ORIGIN, '', refCounter(), null);
}

// ---------------------------------------------------------------------------
// Shared derivation (both sources)
// ---------------------------------------------------------------------------

type Point = {x: number; y: number};
type SiblingIndex = {index: number; count: number} | null;

const ORIGIN: Point = {x: 0, y: 0};

// Default roles for host components that have an implicit role. Keys are
// host component names as reported by either source.
const IMPLICIT_ROLES: Record<string, string> = {
  Paragraph: 'text',
  Text: 'text',
  Image: 'image',
  Switch: 'switch',
  AndroidSwitch: 'switch',
  TextInput: 'textbox',
  AndroidTextInput: 'textbox',
};

// Roles that mean "no role".
const NO_ROLE = new Set(['none', 'presentation']);

function refCounter(): () => string {
  let counter = 0;
  return () => `n${counter++}`;
}

/** Order: `role` prop, then `accessibilityRole`, then the component default. */
export function deriveRole(
  type: string,
  roleProp: string | null | undefined,
  accessibilityRole: string | null | undefined,
): string | null {
  const explicit = nonEmpty(roleProp) ?? nonEmpty(accessibilityRole);
  if (explicit != null) {
    return NO_ROLE.has(explicit) ? null : explicit;
  }
  return IMPLICIT_ROLES[type] ?? null;
}

/**
 * Order: label, then own text, then (for accessible nodes) the text of
 * descendants, the way screen readers announce e.g. a Pressable with a Text
 * child.
 */
export function deriveName(
  label: string | null | undefined,
  text: string | null,
  accessible: boolean | undefined,
  children: TreeNode[],
): string | null {
  const own = nonEmpty(label) ?? nonEmpty(text);
  if (own != null) return own;
  if (accessible) {
    return collectText(children).join(' ').trim() || null;
  }
  return null;
}

function selectors(
  type: string,
  testID: string | null,
  parentSel: string,
  sibling: SiblingIndex,
): {sel: string; pathSel: string} {
  const typeSel =
    sibling && sibling.count > 1 ? `${type}:${sibling.index}` : type;
  const pathSel = parentSel ? `${parentSel}>${typeSel}` : typeSel;
  return {sel: testID ? `#${testID}` : pathSel, pathSel};
}

// Layout is pixel-snapped at the point scale factor (e.g. 1/3 dp), which
// leaves float noise like 63.99999237. Round to 1/1000 dp.
const round = (n: number) => Math.round(n * 1000) / 1000;

function absoluteBox(origin: Point, frame: Box | null, fallback?: Box): Box {
  if (frame) {
    return {
      x: round(origin.x + frame.x),
      y: round(origin.y + frame.y),
      width: round(frame.width),
      height: round(frame.height),
    };
  }
  return fallback ?? {x: origin.x, y: origin.y, width: 0, height: 0};
}

/** Per-type 1-based index among siblings, for selectors. */
function siblingIndexer(types: string[]): (type: string) => SiblingIndex {
  const counts = countBy(types);
  const seen: Record<string, number> = {};
  return type => {
    seen[type] = (seen[type] ?? 0) + 1;
    return {index: seen[type], count: counts[type]};
  };
}

function collectText(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.text) {
      out.push(n.text);
    } else {
      out.push(...collectText(n.children));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// `shadowTree` source: typed JSON from NativeFantom.getA11yTree
// ---------------------------------------------------------------------------

// Mapping tables. Adjust here when the native shape changes.

/** Accessibility keys copied into `a11y.raw`. */
const SHADOW_A11Y_RAW_KEYS = [
  'accessible',
  'accessibilityLabel',
  'accessibilityHint',
  'accessibilityRole',
  'role',
  'accessibilityState',
  'accessibilityValue',
  'accessibilityActions',
  'importantForAccessibility',
  'accessibilityElementsHidden',
  'accessibilityLiveRegion',
  'accessibilityLabelledBy',
  'accessibilityLanguage',
  'accessibilityViewIsModal',
] as const;

/** Visual keys copied into `style` as-is. */
const SHADOW_STYLE_KEYS = [
  'backgroundColor',
  'opacity',
  'borderColors',
  'borderRadii',
  'borderWidths',
  'zIndex',
  'transform',
  'pointerEvents',
  'layoutDirection',
  'nativeID',
  'collapsable',
] as const;

/** Font keys taken from a Paragraph's first fragment into `style`. */
const FRAGMENT_STYLE_KEYS = [
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontFamily',
  'color',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textDecorationLine',
  'textTransform',
] as const;

/** Component-specific keys copied into `style` as-is. */
const SHADOW_COMPONENT_KEYS = [
  'placeholder',
  'defaultValue',
  'editable',
  'secureTextEntry',
  'multiline',
  'sources',
  'value',
  'horizontal',
  'contentOffset',
] as const;

/**
 * Yoga edge/gutter objects (`"padding":{"all":16,"top":4}`) are flattened to
 * React Native style names (`padding: 16, paddingTop: 4`). Keys not listed
 * here are copied as-is.
 */
const YOGA_EDGE_NAMES: Record<string, Record<string, string>> = {
  padding: edgeNames('padding', ''),
  margin: edgeNames('margin', ''),
  border: {
    all: 'borderWidth',
    horizontal: 'borderHorizontalWidth',
    vertical: 'borderVerticalWidth',
    left: 'borderLeftWidth',
    top: 'borderTopWidth',
    right: 'borderRightWidth',
    bottom: 'borderBottomWidth',
    start: 'borderStartWidth',
    end: 'borderEndWidth',
  },
  position: {
    all: 'inset',
    horizontal: 'insetInline',
    vertical: 'insetBlock',
    left: 'left',
    top: 'top',
    right: 'right',
    bottom: 'bottom',
    start: 'start',
    end: 'end',
  },
  gap: {all: 'gap', row: 'rowGap', column: 'columnGap'},
};

function edgeNames(prefix: string, suffix: string): Record<string, string> {
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  const out: Record<string, string> = {all: prefix + suffix};
  for (const edge of ['horizontal', 'vertical', 'left', 'top', 'right', 'bottom', 'start', 'end']) {
    out[edge] = prefix + cap(edge) + suffix;
  }
  return out;
}

export function flattenYogaStyle(
  yogaStyle: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(yogaStyle)) {
    const names = YOGA_EDGE_NAMES[key];
    if (names && value != null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [edge, edgeValue] of Object.entries(value)) {
        out[names[edge] ?? `${key}.${edge}`] = edgeValue;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

/** Nested `<Text>` spans are kept only if they carry one of these. */
const SPAN_A11Y_KEYS = [
  'accessibilityLabel',
  'role',
  'accessibilityRole',
  'accessible',
  'testID',
] as const;

const TEXT_INPUT_TYPES = new Set(['TextInput', 'AndroidTextInput']);
const SWITCH_TYPES = new Set(['Switch', 'AndroidSwitch']);

/**
 * Paragraph children in the ShadowTree are `RawText` and nested `Text` span
 * nodes without layout. `RawText` is dropped (its text is in the Paragraph's
 * `text`); spans are dropped unless they carry accessibility props.
 */
function isKeptChild(child: ShadowNodeJSON): boolean {
  if (child.type === 'RawText') return false;
  if (child.type === 'Text') {
    return SPAN_A11Y_KEYS.some(key => child[key] !== undefined);
  }
  return true;
}

function convertShadowNode(
  node: ShadowNodeJSON,
  origin: Point,
  parentSel: string,
  nextRef: () => string,
  sibling: SiblingIndex,
  parentBox?: Box,
): TreeNode {
  const ref = nextRef();
  // Nodes without a frame (text spans, other virtual nodes) get the parent's box.
  const isVirtual = node.frame == null;
  const box = isVirtual
    ? {...(parentBox ?? {x: origin.x, y: origin.y, width: 0, height: 0})}
    : absoluteBox(origin, node.frame ?? null);
  const testID = nonEmpty(node.testID);
  const {sel, pathSel} = selectors(node.type, testID, parentSel, sibling);

  const childNodes = (node.children ?? []).filter(isKeptChild);
  const indexFor = siblingIndexer(childNodes.map(c => c.type));
  const children = childNodes.map(child =>
    convertShadowNode(
      child,
      // Virtual nodes have no frame, so children stay relative to the
      // nearest ancestor with one.
      isVirtual ? origin : {x: box.x, y: box.y},
      pathSel,
      nextRef,
      indexFor(child.type),
      box,
    ),
  );

  let text: string | null = null;
  if (node.type === 'Paragraph') {
    text =
      node.text ?? (node.fragments ? node.fragments.map(f => f.text).join('') : null);
  } else if (node.type === 'Text' || node.type === 'RawText') {
    text = nonEmpty(node.text) ?? spanText(node);
  } else if (TEXT_INPUT_TYPES.has(node.type)) {
    text = nonEmpty(node.text) ?? nonEmpty(node.defaultValue);
  }

  const a11y = shadowA11yInfo(node);
  const role = deriveRole(node.type, node.role, node.accessibilityRole);
  const name = deriveName(
    a11y.label,
    node.type === 'Paragraph' || node.type === 'Text' ? text : null,
    a11y.accessible,
    children,
  );

  const style: Record<string, unknown> = {};
  for (const key of SHADOW_STYLE_KEYS) {
    if (node[key] !== undefined) style[key] = node[key];
  }
  if (node.yogaStyle) {
    Object.assign(style, flattenYogaStyle(node.yogaStyle));
  }
  const firstFragment = node.fragments?.[0];
  if (firstFragment) {
    for (const key of FRAGMENT_STYLE_KEYS) {
      if (firstFragment[key] !== undefined) style[key] = firstFragment[key];
    }
  }
  if (node.paragraphAttributes) {
    Object.assign(style, node.paragraphAttributes);
  }
  for (const key of SHADOW_COMPONENT_KEYS) {
    if (node[key] !== undefined) style[key] = node[key];
  }

  const result: TreeNode = {
    ref,
    type: node.type,
    sel,
    role,
    name,
    a11y,
    box,
    style,
    text,
    testID,
    children,
  };
  if (isVirtual) {
    result.virtual = true;
  }
  if (node.debugProps) {
    result.debugProps = node.debugProps;
  }
  return result;
}

/** Text of a nested `Text` span: concatenated `RawText` descendants. */
function spanText(node: ShadowNodeJSON): string | null {
  const parts: string[] = [];
  const walk = (n: ShadowNodeJSON) => {
    if (n.type === 'RawText' && n.text) parts.push(n.text);
    for (const c of n.children ?? []) walk(c);
  };
  for (const c of node.children ?? []) walk(c);
  return parts.length > 0 ? parts.join('') : null;
}

function shadowA11yInfo(node: ShadowNodeJSON): A11yInfo {
  const info: A11yInfo = {};
  const raw: Record<string, unknown> = {};
  for (const key of SHADOW_A11Y_RAW_KEYS) {
    if (node[key] !== undefined) raw[key] = node[key];
  }

  if (node.accessible !== undefined) info.accessible = node.accessible;
  const label = nonEmpty(node.accessibilityLabel);
  if (label) info.label = label;
  const hint = nonEmpty(node.accessibilityHint);
  if (hint) info.hint = hint;

  const state = shadowA11yState(node.accessibilityState);
  if (SWITCH_TYPES.has(node.type)) {
    // A Switch's value is its checked state for screen readers, and the host
    // reports `disabled: true` outside accessibilityState.
    const switchState = state ?? {};
    if (switchState.checked === undefined && typeof node.value === 'boolean') {
      switchState.checked = node.value;
    }
    if (switchState.disabled === undefined && node.disabled === true) {
      switchState.disabled = true;
    }
    if (Object.keys(switchState).length > 0) info.state = switchState;
  } else if (state) {
    info.state = state;
  }

  const hidden =
    node.importantForAccessibility === 'no' ||
    node.importantForAccessibility === 'no-hide-descendants' ||
    node.accessibilityElementsHidden === true;
  if (hidden) info.hidden = true;

  if (Object.keys(raw).length > 0) info.raw = raw;
  return info;
}

function shadowA11yState(
  value: ShadowNodeJSON['accessibilityState'],
): A11yState | null {
  if (value == null) return null;
  const state: A11yState = {};
  for (const key of ['disabled', 'selected', 'busy', 'expanded'] as const) {
    if (typeof value[key] === 'boolean') state[key] = value[key];
  }
  const checked = parseChecked(value.checked);
  if (checked !== undefined) state.checked = checked;
  return state;
}

function parseChecked(value: unknown): boolean | 'mixed' | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  switch (value.toLowerCase()) {
    case 'checked':
    case 'true':
      return true;
    case 'unchecked':
    case 'false':
      return false;
    case 'mixed':
      return 'mixed';
    default:
      return undefined; // "None"
  }
}

// ---------------------------------------------------------------------------
// `mounted` source: Fantom RenderOutput JSON (debug-string props)
// ---------------------------------------------------------------------------

// Props that go into `a11y.raw` instead of `style`.
const MOUNTED_A11Y_PROPS = new Set([
  'accessible',
  'accessibilityRole',
  'accessibilityActions',
  'accessibilityState',
  'accessibilityElementsHidden',
  'accessibilityHint',
  'accessibilityLabel',
  'accessibilityLiveRegion',
  'importantForAccessibility',
  'role',
  'aria-label',
  'aria-hidden',
]);

const LAYOUT_PREFIX = 'layoutMetrics-';

function convertMountedNode(
  node: FantomNode,
  origin: Point,
  parentSel: string,
  nextRef: () => string,
  sibling: SiblingIndex,
  inheritedBox?: Box,
): TreeNode {
  const props = node.props ?? {};
  const ref = nextRef();

  // Text fragments inside a Paragraph have no layout metrics of their own.
  const box = absoluteBox(
    origin,
    parseFrame(props[`${LAYOUT_PREFIX}frame`]),
    inheritedBox,
  );
  const testID = nonEmpty(props.testID);
  const {sel, pathSel} = selectors(node.type, testID, parentSel, sibling);

  const children: TreeNode[] = [];
  let text: string | null = null;

  if (typeof node.children === 'string') {
    text = node.children;
  } else if (Array.isArray(node.children)) {
    const objectChildren = node.children.filter(
      (c): c is FantomNode => typeof c === 'object' && c != null,
    );
    const indexFor = siblingIndexer(objectChildren.map(c => c.type));

    const textParts: string[] = [];
    for (const child of node.children) {
      if (typeof child === 'string') {
        textParts.push(child);
        continue;
      }
      if (child == null || typeof child !== 'object') {
        continue;
      }
      if (child.type === 'Text' && typeof child.children === 'string') {
        textParts.push(child.children);
      }
      children.push(
        convertMountedNode(
          child,
          {x: box.x, y: box.y},
          // Selectors of descendants use the path, not the testID shortcut.
          pathSel,
          nextRef,
          indexFor(child.type),
          node.type === 'Paragraph' ? box : undefined,
        ),
      );
    }
    if (node.type === 'Paragraph') {
      text = textParts.join('');
    }
  }

  const a11y = mountedA11yInfo(props);
  const role = deriveRole(node.type, props.role, props.accessibilityRole);
  const name = deriveName(
    a11y.label ?? nonEmpty(props['aria-label']),
    text,
    a11y.accessible,
    children,
  );

  const style: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (
      key.startsWith(LAYOUT_PREFIX) ||
      MOUNTED_A11Y_PROPS.has(key) ||
      key === 'testID'
    ) {
      continue;
    }
    style[key] = value;
  }

  return {
    ref,
    type: node.type,
    sel,
    role,
    name,
    a11y,
    box,
    style,
    text,
    testID,
    children,
  };
}

function mountedA11yInfo(props: Record<string, string>): A11yInfo {
  const info: A11yInfo = {};
  const raw: Record<string, string> = {};
  for (const key of Object.keys(props)) {
    if (MOUNTED_A11Y_PROPS.has(key)) {
      raw[key] = props[key];
    }
  }

  if (props.accessible != null) {
    info.accessible = props.accessible === 'true';
  }
  const label = nonEmpty(props.accessibilityLabel);
  if (label) info.label = label;
  const hint = nonEmpty(props.accessibilityHint);
  if (hint) info.hint = hint;
  const state = parseMountedA11yState(props.accessibilityState);
  if (state) info.state = state;

  const hidden =
    props.importantForAccessibility === 'no' ||
    props.importantForAccessibility === 'no-hide-descendants' ||
    props.accessibilityElementsHidden === 'true' ||
    props['aria-hidden'] === 'true';
  if (hidden) info.hidden = true;

  if (Object.keys(raw).length > 0) info.raw = raw;
  return info;
}

// Format from LayoutMetrics::getDebugProps: "{x:0,y:0,width:390,height:844}"
function parseFrame(value: string | undefined): Box | null {
  if (!value) return null;
  const obj = parseDebugObject(value);
  const x = Number(obj.x);
  const y = Number(obj.y);
  const width = Number(obj.width);
  const height = Number(obj.height);
  if ([x, y, width, height].some(n => Number.isNaN(n))) return null;
  return {x, y, width, height};
}

// Format from toString(AccessibilityState):
// "{disabled:false,selected:false,checked:None,busy:false,expanded:null}"
function parseMountedA11yState(value: string | undefined): A11yState | null {
  if (!value) return null;
  const obj = parseDebugObject(value);
  const state: A11yState = {};
  for (const key of ['disabled', 'selected', 'busy', 'expanded'] as const) {
    if (obj[key] === 'true') state[key] = true;
    else if (obj[key] === 'false') state[key] = false;
  }
  const checked = parseChecked(obj.checked);
  if (checked !== undefined) state.checked = checked;
  return state;
}

function parseDebugObject(value: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = value.trim().replace(/^\{/, '').replace(/\}$/, '');
  for (const part of body.split(',')) {
    const i = part.indexOf(':');
    if (i > 0) {
      out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function nonEmpty(value: string | null | undefined): string | null {
  return value != null && value !== '' ? value : null;
}
