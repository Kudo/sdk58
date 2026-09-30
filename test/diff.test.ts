import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {diffTrees, isEmptyDiff} from '../src/diff.ts';
import {diffLines} from '../src/format.ts';
import type {ShadowNodeJSON, TreeNode} from '../src/schema.ts';
import {convertShadowTree} from '../src/tree.ts';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const shadow = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'shadow-tree.json'), 'utf8')) as ShadowNodeJSON;

function keys(root: TreeNode): string[] {
  return [root.key, ...root.children.flatMap(keys)];
}

describe('diff', () => {
  it('keys: testID, else parent key + type:index; repeated testIDs get :n', () => {
    const tree = convertShadowTree(shadow);
    const all = keys(tree);
    expect(tree.key).toBe('RootView');
    expect(all).toContain('RootView/View:1');
    expect(all).toContain('submit');
    expect(all).toContain('submit/Paragraph:1');
    expect(all, all.join('\n')).toContain('RootView/View:1/View:2');
    expect(new Set(all).size).toBe(all.length);

    const dup = structuredClone(shadow);
    dup.children![0].children!.push({type: 'View', testID: 'submit', frame: {x: 0, y: 0, width: 1, height: 1}, children: []});
    expect(keys(convertShadowTree(dup)).includes('submit:2')).toBeTruthy();
  });

  it('keys stay stable when an unkeyed sibling is added before a keyed node', () => {
    const before = convertShadowTree(shadow);
    const changed = structuredClone(shadow);
    changed.children![0].children!.unshift({type: 'Paragraph', text: 'Banner', frame: {x: 0, y: 0, width: 390, height: 20}, children: []});
    const after = convertShadowTree(changed);
    // The testID keys and the paths under them are unchanged; refs shift.
    const find = (t: TreeNode, key: string): TreeNode | undefined =>
      t.key === key ? t : t.children.map(c => find(c, key)).find(Boolean);
    expect(find(before, 'submit/Paragraph:1')!.ref !== find(after, 'submit/Paragraph:1')!.ref).toBe(true);

    const diff = diffTrees(before, after);
    // The new Paragraph takes Paragraph:1; the old title becomes Paragraph:2.
    expect(diff.added.some(n => n.key === 'RootView/View:1/Paragraph:2')).toBeTruthy();
    expect(diff.changed.some(c => c.key === 'RootView/View:1/Paragraph:1')).toBeTruthy();
    // Unkeyed descendants of shifted nodes move with them (limitation of path keys).
    expect(diff.removed.map(n => n.key)).toStrictEqual(['RootView/View:1/Paragraph:1/Text:1']);
    // Keyed nodes after the insertion are not reported as added/removed.
    expect(!diff.added.some(n => n.key === 'submit' || n.key === 'remember')).toBeTruthy();
  });

  it('diff: added, removed, changed fields', () => {
    const before = convertShadowTree(shadow);
    const next = structuredClone(shadow);
    const container = next.children![0];
    container.children = container.children!.filter(c => c.type !== 'Image');
    const toggle = container.children.find(c => c.type === 'AndroidSwitch')!;
    toggle.value = false;
    container.children.push({type: 'Paragraph', testID: 'status', text: 'Done', frame: {x: 0, y: 800, width: 390, height: 20}, children: []});
    const after = convertShadowTree(next);

    const diff = diffTrees(before, after);
    expect(diff.added.map(n => n.key)).toStrictEqual(['status']);
    expect(diff.removed.map(n => n.key)).toStrictEqual(['RootView/View:1/Image:1']);
    const remember = diff.changed.find(c => c.key === 'remember')!;
    expect(remember.before).toStrictEqual({state: {checked: true, disabled: true}});
    expect(remember.after).toStrictEqual({state: {checked: false, disabled: true}});
    expect(isEmptyDiff(diffTrees(before, before))).toBe(true);

    const lines = diffLines(diff);
    expect(lines).toContain('  + status Paragraph "Done"');
    expect(lines.some(l => l.startsWith('  - RootView/View:1/Image:1 Image'))).toBeTruthy();
    expect(lines).toContain('  ~ remember state: {"checked":true,"disabled":true} -> {"checked":false,"disabled":true}');
  });
});
