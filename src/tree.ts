import type {
  A11yInfo,
  A11yState,
  Box,
  FantomNode,
  HostPayload,
  RenderResult,
  ShadowNodeJSON,
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

function absoluteBox(origin: Point, frame: Box | null, fallback?: Box): Box {
  if (frame) {
    return {
      x: origin.x + frame.x,
      y: origin.y + frame.y,
      width: frame.width,
      height: frame.height,
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
  'nativeId',
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
] as const;

/** Component-specific keys copied into `style` as-is. */
const SHADOW_COMPONENT_KEYS = [
  'placeholder',
  'defaultValue',
  'editable',
  'secureTextEntry',
  'sources',
  'value',
  'horizontal',
  'contentOffset',
] as const;

const TEXT_INPUT_TYPES = new Set(['TextInput', 'AndroidTextInput']);
const SWITCH_TYPES = new Set(['Switch', 'AndroidSwitch']);

function convertShadowNode(
  node: ShadowNodeJSON,
  origin: Point,
  parentSel: string,
  nextRef: () => string,
  sibling: SiblingIndex,
): TreeNode {
  const ref = nextRef();
  const box = absoluteBox(origin, node.frame ?? null);
  const testID = nonEmpty(node.testID);
  const {sel, pathSel} = selectors(node.type, testID, parentSel, sibling);

  const childNodes = node.children ?? [];
  const indexFor = siblingIndexer(childNodes.map(c => c.type));
  const children = childNodes.map(child =>
    convertShadowNode(
      child,
      {x: box.x, y: box.y},
      pathSel,
      nextRef,
      indexFor(child.type),
    ),
  );

  let text: string | null = null;
  if (node.type === 'Paragraph') {
    text =
      node.text ?? (node.fragments ? node.fragments.map(f => f.text).join('') : null);
  } else if (TEXT_INPUT_TYPES.has(node.type)) {
    text = nonEmpty(node.text) ?? nonEmpty(node.defaultValue);
  }

  const a11y = shadowA11yInfo(node);
  const role = deriveRole(node.type, node.role, node.accessibilityRole);
  const name = deriveName(
    a11y.label,
    node.type === 'Paragraph' ? text : null,
    a11y.accessible,
    children,
  );

  const style: Record<string, unknown> = {};
  for (const key of SHADOW_STYLE_KEYS) {
    if (node[key] !== undefined) style[key] = node[key];
  }
  if (node.yogaStyle) {
    Object.assign(style, node.yogaStyle);
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
  if (node.debugProps) {
    result.debugProps = node.debugProps;
  }
  return result;
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
  // A Switch's value is its checked state for screen readers.
  if (SWITCH_TYPES.has(node.type) && typeof node.value === 'boolean') {
    const withValue = state ?? {};
    if (withValue.checked === undefined) withValue.checked = node.value;
    info.state = withValue;
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
