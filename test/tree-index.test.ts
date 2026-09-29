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
