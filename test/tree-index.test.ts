import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {findEntry, hitTestEntries, indexTree, targetNotFoundMessage} from '../packages/react-native-a11y-tree/runtime/tree-index.ts';
import type {ShadowNodeJSON, TreeNode} from '../packages/react-native-a11y-tree/src/schema.ts';
import {convertShadowTree} from '../packages/react-native-a11y-tree/src/tree.ts';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const tree = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'shadow-tree.json'), 'utf8'),
) as ShadowNodeJSON;

function flatten(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

describe('tree-index', () => {
  it('runtime/tree-index.ts refs and boxes match src/tree.ts', () => {
    const entries = indexTree(tree);
    const nodes = flatten(convertShadowTree(tree));
    expect(entries.map(e => [e.ref, e.type, e.testID])).toStrictEqual(nodes.map(n => [n.ref, n.type, n.testID]));
    // Keys and selectors (used by action targets) match too.
    expect(entries.map(e => [e.key, e.sel])).toStrictEqual(nodes.map(n => [n.key, n.sel]));
    expect(findEntry(entries, {key: 'submit/Paragraph:1'})!.type).toBe('Paragraph');
    expect(findEntry(entries, {sel: '#submit'})!.testID).toBe('submit');
    const round = (n: number) => Math.round(n * 1000) / 1000;
    expect(entries.map(e => [round(e.box.x), round(e.box.y), round(e.box.width), round(e.box.height)])).toStrictEqual(nodes.map(n => [n.box.x, n.box.y, n.box.width, n.box.height]));
  });

  it('JS hit test: deepest node, later siblings on top, pointerEvents', () => {
    const entries = indexTree(tree);
    // Center of the submit button's label -> the label Paragraph inside it.
    expect(hitTestEntries(entries, 190, 178)!.type).toBe('Paragraph');
    expect(hitTestEntries(entries, 190, 178)!.ref).toBe(findEntry(entries, {testID: 'submit'})!.children[0].ref);
    // Button area outside the label -> the button.
    expect(hitTestEntries(entries, 30, 160)!.testID).toBe('submit');
    // Empty area -> the container View.
    expect(hitTestEntries(entries, 380, 800)!.type).toBe('View');
    // Outside the root.
    expect(hitTestEntries(entries, 500, 10)).toBe(null);

    const withOverlay: ShadowNodeJSON = structuredClone(tree);
    withOverlay.children![0].children!.push({
      type: 'View',
      frame: {x: 0, y: 0, width: 390, height: 844},
      pointerEvents: 'none',
      children: [],
    });
    expect(hitTestEntries(indexTree(withOverlay), 30, 160)!.testID).toBe('submit');
    withOverlay.children![0].children!.at(-1)!.pointerEvents = 'auto';
    expect(hitTestEntries(indexTree(withOverlay), 30, 160)!.testID).toBe(null);
  });

  it('JS hit test uses scroll offsets', () => {
    const scrolled: ShadowNodeJSON = {
      type: 'RootView',
      tag: 1,
      frame: {x: 0, y: 0, width: 390, height: 844},
      children: [
        {
          type: 'ScrollView',
          tag: 2,
          frame: {x: 0, y: 100, width: 390, height: 400},
          contentOffset: {x: 0, y: 600},
          children: [
            {
              type: 'View',
              tag: 3,
              frame: {x: 0, y: 0, width: 390, height: 1800},
              children: [
                {type: 'View', tag: 4, testID: 'row-1', frame: {x: 0, y: 60, width: 390, height: 60}, children: []},
                {type: 'View', tag: 5, testID: 'row-12', frame: {x: 0, y: 720, width: 390, height: 60}, children: []},
              ],
            },
          ],
        },
      ],
    };
    const entries = indexTree(scrolled);
    expect(hitTestEntries(entries, 195, 250)!.testID).toBe('row-12');
    // row-1 is scrolled out of view (y = 160 - 600); the ScrollView box clips it.
    expect(hitTestEntries(entries, 195, 60 + 100 + 30)?.testID).not.toBe('row-1');
  });

  it('runtime/tree-index.ts visualBox matches src/tree.ts (transforms)', () => {
    const T = (x: number, y: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];
    const S = (k: number) => [k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const tree: ShadowNodeJSON = {
      type: 'RootView',
      tag: 1,
      frame: {x: 0, y: 0, width: 390, height: 844},
      children: [
        {type: 'View', tag: 2, frame: {x: 24, y: 100, width: 50, height: 40}, transform: T(120, 0), children: []},
        {
          type: 'View',
          tag: 3,
          frame: {x: 100, y: 200, width: 100, height: 100},
          transform: S(2),
          children: [
            {type: 'View', tag: 4, frame: {x: 0, y: 0, width: 10, height: 10}, mounted: {transform: T(5, 0)}, children: []},
          ],
        },
      ],
    };
    const entries = indexTree(tree);
    const nodes = flatten(convertShadowTree(tree));
    const round = (n: number) => Math.round(n * 1000) / 1000;
    expect(entries.map(e => [e.visualBox.x, e.visualBox.y, e.visualBox.width, e.visualBox.height].map(round))).toStrictEqual(nodes.map(n => {
        const b = n.visualBox ?? n.box;
        return [b.x, b.y, b.width, b.height];
      }));
    // The JS hit test uses the drawn position: the translated view is hit at x=150.
    expect(hitTestEntries(entries, 150, 120)!.tag).toBe(2);
    expect(hitTestEntries(entries, 40, 120)!.tag).toBe(1);
  });

  it('targetNotFoundMessage: close testIDs/keys, else the testIDs in the tree; refs', () => {
    const entries = indexTree(tree);
    const submit = findEntry(entries, {testID: 'submit'})!;
    expect(targetNotFoundMessage(entries, {testID: 'sumbit'})).toBe(`Target not found: {"testID":"sumbit"}. Did you mean testID "submit" (ref ${submit.ref}, ${submit.type})?`);
    expect(targetNotFoundMessage(entries, {testID: 'Submit-button'})).toMatch(/Did you mean testID "submit"/);
    expect(targetNotFoundMessage(entries, {testID: 'zzz'})).toBe('Target not found: {"testID":"zzz"}. testIDs in the tree: email, remember, submit');
    expect(targetNotFoundMessage(entries, {key: 'sumbit'})).toMatch(/Did you mean key "submit"/);
    expect(targetNotFoundMessage(entries, {ref: 'n999'})).toMatch(/^Target not found: \{"ref":"n999"\}\. Refs change when the tree changes/);
  });
});
