/**
 * Differences between two trees, matched by stable `key`:
 * `{added, removed, changed: [{key, before, after}]}`.
 */

import type {TreeNode} from './schema.ts';

export type NodeSummary = {key: string; type: string; role?: string; name?: string; text?: string};

export type TreeDiff = {
  added: NodeSummary[];
  removed: NodeSummary[];
  changed: Array<{key: string; before: Record<string, unknown>; after: Record<string, unknown>}>;
};

/** Fields compared for `changed`. */
const FIELDS: Array<[string, (n: TreeNode) => unknown]> = [
  ['box', n => n.box],
  ['visualBox', n => n.visualBox],
  ['text', n => n.text],
  ['name', n => n.name],
  ['role', n => n.role],
  ['state', n => n.a11y.state],
  ['hidden', n => n.a11y.hidden],
  ['effectiveOpacity', n => n.effectiveOpacity],
];

function index(root: TreeNode): Map<string, TreeNode> {
  const out = new Map<string, TreeNode>();
  const visit = (n: TreeNode) => {
    out.set(n.key, n);
    for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

function summary(n: TreeNode): NodeSummary {
  const s: NodeSummary = {key: n.key, type: n.type};
  if (n.role) s.role = n.role;
  if (n.name) s.name = n.name;
  if (n.text && n.text !== n.name) s.text = n.text;
  return s;
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function diffTrees(before: TreeNode, after: TreeNode): TreeDiff {
  const a = index(before);
  const b = index(after);
  const diff: TreeDiff = {added: [], removed: [], changed: []};
  for (const [key, node] of b) {
    if (!a.has(key)) diff.added.push(summary(node));
  }
  for (const [key, node] of a) {
    if (!b.has(key)) {
      diff.removed.push(summary(node));
      continue;
    }
    const other = b.get(key)!;
    const was: Record<string, unknown> = {};
    const now: Record<string, unknown> = {};
    for (const [field, get] of FIELDS) {
      const x = get(node);
      const y = get(other);
      if (!same(x, y)) {
        was[field] = x ?? null;
        now[field] = y ?? null;
      }
    }
    if (Object.keys(was).length > 0) diff.changed.push({key, before: was, after: now});
  }
  return diff;
}

export function isEmptyDiff(diff: TreeDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0;
}
