import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {FantomNode, TreeNode} from '../src/schema.ts';
import {toRenderResult} from '../src/tree.ts';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const tree = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'fantom-output.json'), 'utf8'),
) as FantomNode;

function find(node: TreeNode, pred: (n: TreeNode) => boolean): TreeNode | undefined {
  if (pred(node)) return node;
  for (const c of node.children) {
    const r = find(c, pred);
    if (r) return r;
  }
  return undefined;
}

test('converts Fantom render JSON to the output schema', () => {
  const {viewport, root} = toRenderResult({viewport: {width: 390, height: 844}, tree});
  assert.deepEqual(viewport, {width: 390, height: 844});
  assert.equal(root.ref, 'n0');
  assert.deepEqual(root.box, {x: 0, y: 0, width: 390, height: 844});

  const title = find(root, n => n.text === 'Sign in')!;
  assert.equal(title.role, 'header');
  assert.equal(title.name, 'Sign in');
  assert.equal(title.sel, 'RootView>View>Paragraph');

  const image = find(root, n => n.type === 'Image')!;
  assert.equal(image.role, 'image');
  assert.equal(image.name, 'Company logo');
  assert.equal(image.style['source-1x-uri'], 'https://example.com/logo.png');

  const submit = find(root, n => n.testID === 'submit')!;
  assert.equal(submit.sel, '#submit');
  assert.equal(submit.role, 'button');
  assert.equal(submit.name, 'Submit');
  assert.deepEqual(submit.a11y.state, {disabled: false, selected: false, busy: false});
  assert.deepEqual(submit.box, {x: 24, y: 154, width: 342, height: 48});

  // Absolute box = sum of parent frames.
  const label = submit.children[0];
  assert.deepEqual(label.box, {x: 164, y: 168, width: 62, height: 20});
  assert.equal(label.text, 'Submit');
  assert.equal(label.sel, 'RootView>View>View>Paragraph');
  // Text fragments get the Paragraph's box.
  assert.equal(label.children[0].type, 'Text');
  assert.equal(label.children[0].text, 'mit');
  assert.deepEqual(label.children[0].box, label.box);

  assert.ok(!('layoutMetrics-frame' in root.style));
});
