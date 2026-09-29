import type {
  A11yInfo,
  A11yState,
  Box,
  FantomNode,
  HostPayload,
  RenderResult,
  TreeNode,
} from './schema.ts';

// Props that go into `a11y.raw` instead of `style`.
const A11Y_PROPS = new Set([
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

// Default roles for host components that have an implicit role.
const IMPLICIT_ROLES: Record<string, string> = {
  Paragraph: 'text',
  Text: 'text',
  Image: 'image',
};

/**
 * Converts the payload printed by the JS entry (Fantom render JSON) into the
 * rn-a11y-tree output schema.
 */
export function toRenderResult(payload: HostPayload): RenderResult {
  let counter = 0;
  const nextRef = () => `n${counter++}`;
  const root = convertNode(payload.tree, {x: 0, y: 0}, '', nextRef, null);
  return {viewport: payload.viewport, root};
}

function convertNode(
  node: FantomNode,
  origin: {x: number; y: number},
  parentSel: string,
  nextRef: () => string,
  siblingIndex: {index: number; count: number} | null,
  inheritedBox?: Box,
): TreeNode {
  const props = node.props ?? {};
  const ref = nextRef();

  const frame = parseFrame(props[`${LAYOUT_PREFIX}frame`]);
  // Text fragments inside a Paragraph have no layout metrics of their own.
  const box: Box = frame
    ? {
        x: origin.x + frame.x,
        y: origin.y + frame.y,
        width: frame.width,
        height: frame.height,
      }
    : (inheritedBox ?? {x: origin.x, y: origin.y, width: 0, height: 0});

  const testID = nonEmpty(props.testID);
  const typeSel =
    siblingIndex && siblingIndex.count > 1
      ? `${node.type}:${siblingIndex.index}`
      : node.type;
  const pathSel = parentSel ? `${parentSel}>${typeSel}` : typeSel;
  const sel = testID ? `#${testID}` : pathSel;

  const children: TreeNode[] = [];
  let text: string | null = null;

  if (typeof node.children === 'string') {
    text = node.children;
  } else if (Array.isArray(node.children)) {
    const objectChildren = node.children.filter(
      (c): c is FantomNode => typeof c === 'object' && c != null,
    );
    const typeCounts = countBy(objectChildren.map(c => c.type));
    const typeSeen: Record<string, number> = {};

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
      typeSeen[child.type] = (typeSeen[child.type] ?? 0) + 1;
      children.push(
        convertNode(
          child,
          {x: box.x, y: box.y},
          // Selectors of descendants use the path, not the testID shortcut.
          pathSel,
          nextRef,
          {index: typeSeen[child.type], count: typeCounts[child.type]},
          node.type === 'Paragraph' ? box : undefined,
        ),
      );
    }
    if (node.type === 'Paragraph') {
      text = textParts.join('');
    }
  }

  const a11y = toA11yInfo(props);
  const explicitRole = nonEmpty(props.accessibilityRole) ?? nonEmpty(props.role);
  const role =
    explicitRole && explicitRole !== 'none'
      ? explicitRole
      : explicitRole === 'none'
        ? null
        : (IMPLICIT_ROLES[node.type] ?? null);

  let name =
    a11y.label ?? nonEmpty(props['aria-label']) ?? (text ? text : null);
  if (name == null && a11y.accessible) {
    // Accessible containers (e.g. a Pressable with a Text child) are announced
    // with the text of their descendants.
    const descendantText = collectText(children).join(' ').trim();
    name = descendantText || null;
  }

  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(props)) {
    if (key.startsWith(LAYOUT_PREFIX) || A11Y_PROPS.has(key) || key === 'testID') {
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

function toA11yInfo(props: Record<string, string>): A11yInfo {
  const info: A11yInfo = {};
  const raw: Record<string, string> = {};
  for (const key of Object.keys(props)) {
    if (A11Y_PROPS.has(key)) {
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
  const state = parseAccessibilityState(props.accessibilityState);
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
function parseAccessibilityState(value: string | undefined): A11yState | null {
  if (!value) return null;
  const obj = parseDebugObject(value);
  const state: A11yState = {};
  const bool = (v: string | undefined) =>
    v === 'true' ? true : v === 'false' ? false : undefined;
  const disabled = bool(obj.disabled);
  if (disabled !== undefined) state.disabled = disabled;
  const selected = bool(obj.selected);
  if (selected !== undefined) state.selected = selected;
  const busy = bool(obj.busy);
  if (busy !== undefined) state.busy = busy;
  const expanded = bool(obj.expanded);
  if (expanded !== undefined) state.expanded = expanded;
  if (obj.checked === 'Checked') state.checked = true;
  else if (obj.checked === 'Unchecked') state.checked = false;
  else if (obj.checked === 'Mixed') state.checked = 'mixed';
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

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function nonEmpty(value: string | undefined): string | null {
  return value != null && value !== '' ? value : null;
}
