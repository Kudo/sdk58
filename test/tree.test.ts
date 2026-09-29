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
    ['Paragraph', 'Image', 'AndroidTextInput', 'View', 'AndroidSwitch', 'View'],
  );
  // Yoga edge/gutter objects are flattened to React Native style names.
  assert.deepEqual(container.style, {
    backgroundColor: 'rgba(255, 255, 255, 1)',
    flex: 1,
    padding: 24,
    paddingTop: 8,
    rowGap: 4,
  });
  // Pre-order refs (n3 is the kept link span inside the title).
  assert.deepEqual(
    [root, container, ...container.children].map(n => n.ref),
    ['n0', 'n1', 'n2', 'n4', 'n5', 'n6', 'n8', 'n9'],
  );

  const title = container.children[0];
  assert.equal(title.role, 'header');
  assert.equal(title.name, 'Sign in now');
  assert.equal(title.text, 'Sign in now');
  assert.equal(title.sel, 'RootView>View>Paragraph');
  assert.equal(title.style.fontSize, 28);
  assert.equal(title.style.fontWeight, 700);
  assert.equal(title.style.ellipsizeMode, 'tail');
  assert.equal(title.style.marginBottom, 16);
  assert.equal(title.virtual, undefined);
  // RawText and the span without a11y props are dropped; the link span is
  // kept with the Paragraph's box.
  assert.equal(title.children.length, 1);
  const link = title.children[0];
  assert.equal(link.type, 'Text');
  assert.equal(link.role, 'link');
  assert.equal(link.text, 'now');
  assert.equal(link.name, 'now');
  assert.equal(link.virtual, true);
  assert.deepEqual(link.box, title.box);

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

  const email = container.children[2];
  assert.equal(email.role, 'textbox');
  assert.equal(email.sel, '#email');
  assert.equal(email.text, null); // "" from the host
  assert.equal(email.name, null);
  assert.equal(email.style.placeholder, 'Email');
  assert.equal(email.style.editable, true);
  assert.equal(email.style.padding, 8);
  assert.equal(email.style.borderWidth, 1);

  const toggle = container.children[4];
  assert.equal(toggle.role, 'switch');
  assert.equal(toggle.name, 'Remember me');
  assert.deepEqual(toggle.a11y.state, {checked: true, disabled: true});
  assert.equal(toggle.style.value, true);

  const decoration = container.children[5];
  assert.equal(decoration.role, null); // role="presentation" wins, means no role
  assert.equal(decoration.a11y.hidden, true);
  assert.equal(decoration.sel, 'RootView>View>View:2');
});

test('children of a scrolled ScrollView are shifted by its contentOffset', () => {
  const scrolled: ShadowNodeJSON = {
    type: 'RootView',
    frame: {x: 0, y: 0, width: 390, height: 844},
    children: [
      {
        type: 'ScrollView',
        frame: {x: 0, y: 100, width: 390, height: 400},
        contentOffset: {x: 0, y: 600},
        children: [
          {
            type: 'View',
            frame: {x: 0, y: 0, width: 390, height: 1800},
            children: [
              {type: 'View', testID: 'row-12', frame: {x: 0, y: 720, width: 390, height: 60}, children: []},
            ],
          },
        ],
      },
    ],
  };
  const {root} = toRenderResult({viewport: {width: 390, height: 844}, source: 'shadowTree', tree: scrolled});
  const list = root.children[0];
  assert.deepEqual(list.box, {x: 0, y: 100, width: 390, height: 400});
  assert.deepEqual(list.style.contentOffset, {x: 0, y: 600});
  const content = list.children[0];
  assert.equal(content.box.y, -500);
  assert.equal(find(root, n => n.testID === 'row-12')!.box.y, 220);
});

test('contentOriginOffset places children (RNSScreen header, ScrollView)', () => {
  const tree: ShadowNodeJSON = {
    type: 'RootView',
    frame: {x: 0, y: 0, width: 390, height: 844},
    children: [
      {
        type: 'RNSScreen',
        frame: {x: 0, y: 0, width: 390, height: 844},
        contentOriginOffset: {x: 0, y: 91},
        activityState: 2,
        children: [
          {type: 'View', testID: 'content', frame: {x: 0, y: 0, width: 390, height: 753}, children: []},
          {type: 'RNSScreenStackHeaderConfig', title: 'Home', frame: {x: 0, y: -44, width: 390, height: 44}, children: []},
          {
            type: 'ScrollView',
            frame: {x: 0, y: 100, width: 390, height: 400},
            contentOffset: {x: 0, y: 600},
            contentOriginOffset: {x: 0, y: -600},
            children: [{type: 'View', testID: 'row', frame: {x: 0, y: 720, width: 390, height: 60}, children: []}],
          },
        ],
      },
    ],
  };
  const {root} = toRenderResult({viewport: {width: 390, height: 844}, source: 'shadowTree', tree});
  const screen = root.children[0];
  assert.equal(screen.style.activityState, 2);
  assert.deepEqual(screen.style.contentOriginOffset, {x: 0, y: 91});
  assert.equal(find(root, n => n.testID === 'content')!.box.y, 91);
  const header = find(root, n => n.type === 'RNSScreenStackHeaderConfig')!;
  assert.deepEqual(header.box, {x: 0, y: 47, width: 390, height: 44});
  assert.equal(header.name, 'Home');
  assert.equal(header.role, null);
  // contentOriginOffset wins over contentOffset (no double counting).
  assert.equal(find(root, n => n.testID === 'row')!.box.y, 91 + 100 - 600 + 720);
});
