import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
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

test('keys: testID, else parent key + type:index; repeated testIDs get :n', () => {
  const tree = convertShadowTree(shadow);
  const all = keys(tree);
  assert.equal(tree.key, 'RootView');
  assert.ok(all.includes('RootView/View:1'));
  assert.ok(all.includes('submit'));
  assert.ok(all.includes('submit/Paragraph:1'));
  assert.ok(all.includes('RootView/View:1/View:2'), all.join('\n'));
  assert.equal(new Set(all).size, all.length);

  const dup = structuredClone(shadow);
  dup.children![0].children!.push({type: 'View', testID: 'submit', frame: {x: 0, y: 0, width: 1, height: 1}, children: []});
  assert.ok(keys(convertShadowTree(dup)).includes('submit:2'));
});

test('keys stay stable when an unkeyed sibling is added before a keyed node', () => {
  const before = convertShadowTree(shadow);
  const changed = structuredClone(shadow);
  changed.children![0].children!.unshift({type: 'Paragraph', text: 'Banner', frame: {x: 0, y: 0, width: 390, height: 20}, children: []});
  const after = convertShadowTree(changed);
  // The testID keys and the paths under them are unchanged; refs shift.
  const find = (t: TreeNode, key: string): TreeNode | undefined =>
    t.key === key ? t : t.children.map(c => find(c, key)).find(Boolean);
  assert.equal(find(before, 'submit/Paragraph:1')!.ref !== find(after, 'submit/Paragraph:1')!.ref, true);

  const diff = diffTrees(before, after);
  // The new Paragraph takes Paragraph:1; the old title becomes Paragraph:2.
  assert.ok(diff.added.some(n => n.key === 'RootView/View:1/Paragraph:2'));
  assert.ok(diff.changed.some(c => c.key === 'RootView/View:1/Paragraph:1'));
  // Unkeyed descendants of shifted nodes move with them (limitation of path keys).
  assert.deepEqual(diff.removed.map(n => n.key), ['RootView/View:1/Paragraph:1/Text:1']);
  // Keyed nodes after the insertion are not reported as added/removed.
  assert.ok(!diff.added.some(n => n.key === 'submit' || n.key === 'remember'));
});

test('diff: added, removed, changed fields', () => {
  const before = convertShadowTree(shadow);
  const next = structuredClone(shadow);
  const container = next.children![0];
  container.children = container.children!.filter(c => c.type !== 'Image');
  const toggle = container.children.find(c => c.type === 'AndroidSwitch')!;
  toggle.value = false;
  container.children.push({type: 'Paragraph', testID: 'status', text: 'Done', frame: {x: 0, y: 800, width: 390, height: 20}, children: []});
  const after = convertShadowTree(next);

  const diff = diffTrees(before, after);
  assert.deepEqual(diff.added.map(n => n.key), ['status']);
  assert.deepEqual(diff.removed.map(n => n.key), ['RootView/View:1/Image:1']);
  const remember = diff.changed.find(c => c.key === 'remember')!;
  assert.deepEqual(remember.before, {state: {checked: true, disabled: true}});
  assert.deepEqual(remember.after, {state: {checked: false, disabled: true}});
  assert.equal(isEmptyDiff(diffTrees(before, before)), true);

  const lines = diffLines(diff);
  assert.ok(lines.includes('  + status Paragraph "Done"'));
  assert.ok(lines.some(l => l.startsWith('  - RootView/View:1/Image:1 Image')));
  assert.ok(lines.includes('  ~ remember state: {"checked":true,"disabled":true} -> {"checked":false,"disabled":true}'));
});
