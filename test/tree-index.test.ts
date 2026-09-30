import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

// @ts-expect-error: plain JS module shared with the bundle
import {findEntry, hitTestEntries, indexTree} from '../runtime/tree-index.js';
import type {ShadowNodeJSON, TreeNode} from '../src/schema.ts';
import {convertShadowTree} from '../src/tree.ts';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const tree = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'shadow-tree.json'), 'utf8'),
) as ShadowNodeJSON;

type Entry = {ref: string; type: string; testID: string | null; box: TreeNode['box']};

function flatten(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(flatten)];
}

test('runtime/tree-index.js refs and boxes match src/tree.ts', () => {
  const entries = indexTree(tree) as Entry[];
  const nodes = flatten(convertShadowTree(tree));
  assert.deepEqual(
    entries.map(e => [e.ref, e.type, e.testID]),
    nodes.map(n => [n.ref, n.type, n.testID]),
  );
  // Keys and selectors (used by action targets) match too.
  assert.deepEqual(
    (entries as Array<Entry & {key: string; sel: string}>).map(e => [e.key, e.sel]),
    nodes.map(n => [n.key, n.sel]),
  );
  assert.equal(findEntry(entries, {key: 'submit/Paragraph:1'}).type, 'Paragraph');
  assert.equal(findEntry(entries, {sel: '#submit'}).testID, 'submit');
  const round = (n: number) => Math.round(n * 1000) / 1000;
  assert.deepEqual(
    entries.map(e => [round(e.box.x), round(e.box.y), round(e.box.width), round(e.box.height)]),
    nodes.map(n => [n.box.x, n.box.y, n.box.width, n.box.height]),
  );
});

test('JS hit test: deepest node, later siblings on top, pointerEvents', () => {
  const entries = indexTree(tree) as Entry[];
  // Center of the submit button's label -> the label Paragraph inside it.
  assert.equal(hitTestEntries(entries, 190, 178).type, 'Paragraph');
  assert.equal(hitTestEntries(entries, 190, 178).ref, findEntry(entries, {testID: 'submit'}).children[0].ref);
  // Button area outside the label -> the button.
  assert.equal(hitTestEntries(entries, 30, 160).testID, 'submit');
  // Empty area -> the container View.
  assert.equal(hitTestEntries(entries, 380, 800).type, 'View');
  // Outside the root.
  assert.equal(hitTestEntries(entries, 500, 10), null);

  const withOverlay: ShadowNodeJSON = structuredClone(tree);
  withOverlay.children![0].children!.push({
    type: 'View',
    frame: {x: 0, y: 0, width: 390, height: 844},
    pointerEvents: 'none',
    children: [],
  });
  assert.equal(hitTestEntries(indexTree(withOverlay), 30, 160).testID, 'submit');
  withOverlay.children![0].children!.at(-1)!.pointerEvents = 'auto';
  assert.equal(hitTestEntries(indexTree(withOverlay), 30, 160).testID, null);
});

test('JS hit test uses scroll offsets', () => {
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
  const entries = indexTree(scrolled) as Entry[];
  assert.equal(hitTestEntries(entries, 195, 250).testID, 'row-12');
  // row-1 is scrolled out of view (y = 160 - 600); the ScrollView box clips it.
  assert.notEqual(hitTestEntries(entries, 195, 60 + 100 + 30)?.testID, 'row-1');
});

test('runtime/tree-index.js visualBox matches src/tree.ts (transforms)', () => {
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
  const entries = indexTree(tree) as Array<Entry & {visualBox: TreeNode['box']}>;
  const nodes = flatten(convertShadowTree(tree));
  const round = (n: number) => Math.round(n * 1000) / 1000;
  assert.deepEqual(
    entries.map(e => [e.visualBox.x, e.visualBox.y, e.visualBox.width, e.visualBox.height].map(round)),
    nodes.map(n => {
      const b = n.visualBox ?? n.box;
      return [b.x, b.y, b.width, b.height];
    }),
  );
  // The JS hit test uses the drawn position: the translated view is hit at x=150.
  assert.equal(hitTestEntries(entries, 150, 120).tag, 2);
  assert.equal(hitTestEntries(entries, 40, 120).tag, 1);
});
