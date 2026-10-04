/**
 * Output formats and queries for agents: `--format json|compact|text|ndjson`,
 * `--select`, `--depth`, `--subtree`, `--style`.
 */

import type {Box, RenderResult, RunResult, TreeNode} from './schema.ts';

export type Format = 'json' | 'compact' | 'text' | 'ndjson';
export const FORMATS: Format[] = ['json', 'compact', 'text', 'ndjson'];

export type QueryOptions = {
  /** Selectors, all must match: `testID=x`, `role=button`, `name~Sign`, `type=View`, `key=…`, `ref=n5`. */
  select?: string[];
  /** Root of the output: first node matching this selector (same syntax). */
  subtree?: string;
  /** Levels of children to keep below each output root (0 = the node only; default 0 with `select`, else all). */
  depth?: number;
};

export type FormatOptions = QueryOptions & {
  format: Format;
  /** Keep `style` in compact/ndjson output. */
  style?: boolean;
  /** Print every host node in text output, including layout wrappers. */
  raw?: boolean;
  /** Print the final tree in run text output after named snapshots. */
  final?: boolean;
  diagnostics?: boolean;
  allScreens?: boolean;
  stepDiff?: boolean;
};

// --- selectors -------------------------------------------------------------------

type Predicate = (node: TreeNode) => boolean;

const SELECTOR = /^(testID|role|name|type|key|ref|sel|text)(=|~)(.*)$/;

export function parseSelector(expr: string): Predicate {
  const m = SELECTOR.exec(expr.trim());
  if (m == null) {
    throw new Error(
      `invalid selector "${expr}": expected <field>=<value> or <field>~<text>, field one of testID, role, name, type, key, ref, sel, text`,
    );
  }
  const [, field, op, value] = m;
  const get = (n: TreeNode): string | null => {
    const v = (n as unknown as Record<string, unknown>)[field];
    return v == null ? null : String(v);
  };
  if (op === '=') {
    return n => get(n) === value;
  }
  const needle = value.toLowerCase();
  return n => (get(n) ?? '').toLowerCase().includes(needle);
}

function walk(node: TreeNode, visit: (n: TreeNode, depth: number) => void, depth = 0) {
  visit(node, depth);
  for (const child of node.children) walk(child, visit, depth + 1);
}

function truncate(node: TreeNode, depth: number): TreeNode {
  if (depth <= 0) return {...node, children: []};
  return {...node, children: node.children.map(c => truncate(c, depth - 1))};
}

/**
 * Applies --subtree, --select and --depth. Returns the output roots: one
 * root for a plain tree or --subtree, or every match of --select (in tree
 * order).
 */
export function queryTree(root: TreeNode, options: QueryOptions): TreeNode[] {
  let base = root;
  if (options.subtree != null) {
    const match = parseSelector(options.subtree);
    let found: TreeNode | null = null;
    walk(root, n => {
      if (found == null && match(n)) found = n;
    });
    if (found == null) throw new Error(`--subtree: no node matches "${options.subtree}"`);
    base = found;
  }
  let roots = [base];
  if (options.select != null && options.select.length > 0) {
    const predicates = options.select.map(parseSelector);
    roots = [];
    walk(base, n => {
      if (predicates.every(p => p(n))) roots.push(n);
    });
  }
  // --select returns the matching nodes only, unless --depth asks for more.
  const depth = options.depth ?? (options.select != null && options.select.length > 0 ? 0 : undefined);
  return depth != null && Number.isFinite(depth) ? roots.map(r => truncate(r, depth)) : roots;
}

// --- compact ------------------------------------------------------------------------

function isEmptyObject(v: unknown): boolean {
  return v != null && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0;
}

/** Drops null/false/empty fields and `style` (unless kept); keeps `children` only when non-empty. */
export function compactNode(node: TreeNode, keepStyle = false): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === 'children') continue;
    if (k === 'style' && !keepStyle) continue;
    if (v == null || v === false || isEmptyObject(v)) continue;
    if (k === 'style' && keepStyle) {
      // layoutDirection "ltr" is on every node.
      const {layoutDirection, ...rest} = v as Record<string, unknown>;
      if (layoutDirection !== undefined && layoutDirection !== 'ltr') rest.layoutDirection = layoutDirection;
      if (Object.keys(rest).length > 0) out.style = rest;
      continue;
    }
    if (k === 'a11y') {
      const {raw, ...rest} = v as Record<string, unknown>;
      if (!isEmptyObject(rest)) out.a11y = rest;
      continue;
    }
    out[k] = v;
  }
  if (node.children.length > 0) {
    out.children = node.children.map(c => compactNode(c, keepStyle));
  }
  return out;
}

// --- text ------------------------------------------------------------------------------

function fmtNum(n: number): string {
  return String(Math.round(n));
}

function fmtBox(b: Box): string {
  return `{${fmtNum(b.x)},${fmtNum(b.y)},${fmtNum(b.width)}x${fmtNum(b.height)}}`;
}

function nodeKey(node: TreeNode): string {
  return (node as TreeNode & {key?: string}).key ?? node.ref;
}

/** `#testID|ref [role|type] ["name"] {x,y,wxh} [flags]` */
export function textLine(node: TreeNode): string {
  const parts = [node.testID ? `#${node.testID}` : node.ref];
  if (node.role && node.role !== 'text') parts.push(node.role);
  else if (!node.role) parts.push(node.type);
  if (node.name != null) parts.push(JSON.stringify(node.name));
  else if (node.text) parts.push(JSON.stringify(node.text));
  parts.push(fmtBox(node.box));
  if (node.visualBox) parts.push(`visual=${fmtBox(node.visualBox)}`);
  const flags: string[] = [];
  if (node.a11y.hidden) flags.push('hidden');
  if (node.a11y.state?.disabled) flags.push('disabled');
  if (node.a11y.state?.checked === true) flags.push('checked');
  if (node.a11y.state?.checked === 'mixed') flags.push('mixed');
  if (node.a11y.state?.selected) flags.push('selected');
  if (node.virtual) flags.push('virtual');
  if (node.effectiveOpacity != null) flags.push(`opacity=${node.effectiveOpacity}`);
  if (flags.length > 0) parts.push(`[${flags.join(', ')}]`);
  return parts.join(' ');
}

function isWrapper(node: TreeNode): boolean {
  return node.children.length === 1 && !node.testID && !node.role && !node.name && !node.text &&
    !node.a11y.hidden && !node.a11y.state?.disabled && !node.a11y.state?.checked && !node.a11y.state?.selected &&
    !node.virtual && node.effectiveOpacity == null && node.visualBox == null &&
    ['RootView', 'View', 'RNCSafeAreaProvider', 'RNSScreenContentWrapper'].includes(node.type);
}

export function textTree(roots: TreeNode[], options: Pick<FormatOptions, 'raw'> = {}): string {
  const lines: string[] = [];
  const visit = (node: TreeNode, depth: number, parent?: TreeNode) => {
    if (!options.raw && isWrapper(node)) {
      visit(node.children[0], depth, parent);
      return;
    }
    if (!options.raw && node.role === 'text' && !node.testID && parent?.name != null && node.name === parent.name) return;
    lines.push(' '.repeat(depth) + textLine(node));
    for (const child of node.children) visit(child, depth + 1, node);
  };
  for (const root of roots) visit(root, 0);
  return lines.join('\n') + '\n';
}

/** Only affects presentation. Keep the original tree for JSON and selectors/actions. */
function topStackScreens(node: TreeNode): TreeNode {
  const children = node.type === 'RNSScreenStack'
    ? node.children.filter(child => child.type !== 'RNSScreen' || child === node.children.filter(c => c.type === 'RNSScreen').at(-1))
    : node.children;
  return {...node, children: children.map(topStackScreens)};
}

// --- ndjson --------------------------------------------------------------------------

function ndjsonNodes(roots: TreeNode[], keepStyle: boolean, extra: Record<string, unknown> = {}): string[] {
  const lines: string[] = [];
  const visit = (n: TreeNode, depth: number, parent: string | null) => {
    const {children: _children, ...node} = compactNode({...n, children: []}, keepStyle);
    lines.push(JSON.stringify({...extra, ...node, depth, parent}));
    for (const c of n.children) visit(c, depth + 1, nodeKey(n));
  };
  for (const r of roots) visit(r, 0, null);
  return lines;
}

// --- render / run output --------------------------------------------------------------

function hasQuery(options: QueryOptions): boolean {
  return (options.select?.length ?? 0) > 0 || options.subtree != null || options.depth != null;
}

export function formatRender(result: RenderResult, options: FormatOptions): string {
  const roots = queryTree(result.root, options);
  const metadata = result.diagnostics?.length ? {diagnostics: result.diagnostics} : {};
  const keepStyle = options.style === true;
  const single = options.select == null || options.select.length === 0;
  switch (options.format) {
    case 'json': {
      const body = single ? {...result, root: roots[0]} : {viewport: result.viewport, source: result.source, matches: roots, ...metadata};
      return JSON.stringify(body, null, 2) + '\n';
    }
    case 'compact': {
      const nodes = roots.map(r => compactNode(r, keepStyle));
      const body = single
        ? {viewport: result.viewport, root: nodes[0], ...metadata}
        : {viewport: result.viewport, matches: nodes, ...metadata};
      return JSON.stringify(body) + '\n';
    }
    case 'text':
      return diagnosticText(result, options) + textTree(queryTree(options.allScreens ? result.root : topStackScreens(result.root), options), options);
    case 'ndjson':
      return [...diagnosticLines(result), ...ndjsonNodes(roots, keepStyle)].join('\n') + '\n';
  }
}

function stepLine(step: RunResult['steps'][number]): string {
  if (step.assertion) {
    const {target, field, expected, actual} = step.assertion;
    return `${step.error ? '✗' : '✓'} ${target} ${field} ${JSON.stringify(actual)}${step.error ? ` expected ${JSON.stringify(expected)}` : ''}`;
  }
  const target = step.target?.testID ? `#${step.target.testID}` : (step.target?.ref ?? '');
  const hit = step.hit ? ` hit=${step.hit.type}${step.hit.testID ? '#' + step.hit.testID : ''}` : '';
  const status = step.error ? ` ERROR ${typeof step.error === 'string' ? step.error : JSON.stringify(step.error)}` : '';
  const warn = step.warnings?.length ? ` WARN ${step.warnings.join('; ')}` : '';
  return `step ${step.index} ${step.action} ${target}${hit} [${step.events.join(', ')}]${warn}${status}`.replace(/ +/g, ' ');
}

export function formatRun(result: RunResult, options: FormatOptions): string {
  const keepStyle = options.style === true;
  const q = (tree: TreeNode) => queryTree(tree, options);
  switch (options.format) {
    case 'json': {
      if (!hasQuery(options)) return JSON.stringify(result, null, 2) + '\n';
      const snapshots = Object.fromEntries(
        Object.entries(result.snapshots).map(([k, t]) => [k, q(t)]),
      );
      return JSON.stringify({...result, snapshots, final: q(result.final)}, null, 2) + '\n';
    }
    case 'compact': {
      const tree = (t: TreeNode) => q(t).map(r => compactNode(r, keepStyle));
      return (
        JSON.stringify({
          ...(result.diagnostics?.length ? {diagnostics: result.diagnostics} : {}),
          steps: result.steps.map(s => compactStep(s)),
          snapshots: Object.fromEntries(Object.entries(result.snapshots).map(([k, t]) => [k, tree(t)])),
          final: tree(result.final),
          ...(result.fallbacks.length > 0 ? {fallbacks: result.fallbacks} : {}),
        }) + '\n'
      );
    }
    case 'text': {
      const textQuery = (tree: TreeNode) => q(options.allScreens ? tree : topStackScreens(tree));
      if (result.steps.some(step => step.action === 'expect') && result.steps.every(step => step.error == null)
        && Object.keys(result.snapshots).length === 0 && !options.final && !options.stepDiff) {
        return diagnosticText(result, options) + `✓ ${result.steps.length} steps passed\n`;
      }
      const out = result.steps.flatMap(step => [stepLine(step), ...(options.stepDiff ? diffLines(step.diff) : [])]);
      for (const [name, tree] of Object.entries(result.snapshots)) {
        out.push(`snapshot ${name}:`, textTree(textQuery(tree), options).trimEnd());
      }
      if (Object.keys(result.snapshots).length === 0 && result.finalDiff && !options.final) {
        out.push('final changes:', ...diffLines(result.finalDiff));
      } else if (options.final || Object.keys(result.snapshots).length === 0) {
        out.push('final:', textTree(textQuery(result.final), options).trimEnd());
      }
      return diagnosticText(result, options) + out.join('\n') + '\n';
    }
    case 'ndjson': {
      const lines = [...diagnosticLines(result), ...result.steps.map(s => JSON.stringify({step: compactStep(s)}))];
      for (const [name, tree] of Object.entries(result.snapshots)) {
        lines.push(...ndjsonNodes(q(tree), keepStyle, {tree: name}));
      }
      lines.push(...ndjsonNodes(q(result.final), keepStyle, {tree: 'final'}));
      return lines.join('\n') + '\n';
    }
  }
}

/** `+ key type "name"`, `- key type`, `~ key field: before -> after` */
export function diffLines(diff: RunResult['steps'][number]['diff']): string[] {
  if (diff == null) return [];
  const label = (n: {key: string; type: string; name?: string}) =>
    `${n.key} ${n.type}${n.name ? ' ' + JSON.stringify(n.name) : ''}`;
  const value = (v: unknown) => {
    if (v != null && typeof v === 'object' && 'width' in (v as object)) return fmtBox(v as Box);
    return JSON.stringify(v);
  };
  return [
    ...diff.added.map(n => `  + ${label(n)}`),
    ...diff.removed.map(n => `  - ${label(n)}`),
    ...diff.changed.map(
      c => `  ~ ${c.key} ${Object.keys(c.after).map(k => `${k}: ${value(c.before[k])} -> ${value(c.after[k])}`).join(', ')}`,
    ),
  ];
}

function compactStep(step: RunResult['steps'][number]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(step)) {
    if (v == null || isEmptyObject(v) || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out;
}

function diagnosticLines(result: Pick<RenderResult, 'diagnostics'>): string[] {
  return result.diagnostics?.length ? [JSON.stringify({diagnostics: result.diagnostics})] : [];
}

function diagnosticText(result: Pick<RenderResult, 'diagnostics'>, options: Pick<FormatOptions, 'diagnostics'>): string {
  const count = result.diagnostics?.length ?? 0;
  if (!count) return '';
  if (options.diagnostics) return result.diagnostics!.map(d => `warning ${d.code} ${d.target}: ${d.message}\n`).join('');
  return `diagnostics: ${count} (run with --diagnostics to show)\n`;
}
