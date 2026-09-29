import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import type {FantomNode, ShadowNodeJSON, TreeNode} from '../src/schema.ts';
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

test('converts Fantom render JSON (mounted) to the output schema', () => {
  const {viewport, source, root} = toRenderResult({viewport: {width: 390, height: 844}, tree});
  assert.deepEqual(viewport, {width: 390, height: 844});
  assert.equal(source, 'mounted');
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

const shadowTree = JSON.parse(
  fs.readFileSync(path.join(FIXTURES, 'shadow-tree.json'), 'utf8'),
) as ShadowNodeJSON;

test('converts the typed getA11yTree JSON (shadowTree) to the output schema', () => {
  const {source, root} = toRenderResult({
    viewport: {width: 390, height: 844},
    source: 'shadowTree',
    tree: shadowTree,
  });
  assert.equal(source, 'shadowTree');
  assert.equal(root.ref, 'n0');
  assert.equal(root.type, 'RootView');

  // Hierarchy is intact: the container View has the content as children.
  const container = root.children[0];
  assert.equal(container.type, 'View');
  assert.deepEqual(
    container.children.map(c => c.type),
    ['Paragraph', 'Image', 'View', 'Switch', 'View'],
  );
  assert.deepEqual(container.style, {
    backgroundColor: 'rgba(255, 255, 255, 1)',
    flex: 1,
    padding: 24,
  });
  // Pre-order refs.
  assert.deepEqual(
    [root, container, ...container.children].map(n => n.ref),
    ['n0', 'n1', 'n2', 'n3', 'n4', 'n6', 'n7'],
  );

  const title = container.children[0];
  assert.equal(title.role, 'header');
  assert.equal(title.name, 'Sign in');
  assert.equal(title.text, 'Sign in');
  assert.equal(title.sel, 'RootView>View>Paragraph');
  assert.equal(title.style.fontSize, 28);
  assert.equal(title.style.fontWeight, '700');
  assert.equal(title.style.ellipsizeMode, 'tail');
  assert.equal(title.style.marginBottom, 16);

  const image = container.children[1];
  assert.equal(image.role, 'image');
  assert.equal(image.name, 'Company logo');
  assert.equal(image.sel, 'RootView>View>Image');

  const submit = find(root, n => n.testID === 'submit')!;
  assert.equal(submit.sel, '#submit');
  assert.equal(submit.role, 'button'); // from the `role` prop
  assert.equal(submit.name, 'Submit'); // descendant text (accessible)
  assert.deepEqual(submit.a11y.state, {disabled: false, selected: false, busy: false});
  assert.deepEqual(submit.debugProps, {testID: 'submit', accessible: 'true'});
  assert.deepEqual(submit.box, {x: 24, y: 154, width: 342, height: 48});

  const label = submit.children[0];
  assert.equal(label.type, 'Paragraph');
  assert.deepEqual(label.box, {x: 164, y: 168, width: 62, height: 20});
  assert.equal(label.sel, 'RootView>View>View:1>Paragraph');
  assert.equal(label.debugProps, undefined);

  const toggle = container.children[3];
  assert.equal(toggle.role, 'switch');
  assert.deepEqual(toggle.a11y.state, {checked: true});
  assert.equal(toggle.style.value, true);

  const decoration = container.children[4];
  assert.equal(decoration.role, null); // role="presentation" wins, means no role
  assert.equal(decoration.a11y.hidden, true);
  assert.equal(decoration.sel, 'RootView>View>View:2');
});
