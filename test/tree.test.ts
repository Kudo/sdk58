import fs from 'node:fs';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import type {FantomNode, ShadowNodeJSON, TreeNode} from '../packages/react-native-a11y-tree/src/schema.ts';
import {toRenderResult} from '../packages/react-native-a11y-tree/src/tree.ts';

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

describe('tree', () => {
  it('converts Fantom render JSON (mounted) to the output schema', () => {
    const {viewport, source, root} = toRenderResult({viewport: {width: 390, height: 844}, tree});
    expect(viewport).toStrictEqual({width: 390, height: 844});
    expect(source).toBe('mounted');
    expect(root.ref).toBe('n0');
    expect(root.box).toStrictEqual({x: 0, y: 0, width: 390, height: 844});

    const title = find(root, n => n.text === 'Sign in')!;
    expect(title.role).toBe('header');
    expect(title.name).toBe('Sign in');
    expect(title.sel).toBe('RootView>View>Paragraph');

    const image = find(root, n => n.type === 'Image')!;
    expect(image.role).toBe('image');
    expect(image.name).toBe('Company logo');
    expect(image.style['source-1x-uri']).toBe('https://example.com/logo.png');

    const submit = find(root, n => n.testID === 'submit')!;
    expect(submit.sel).toBe('#submit');
    expect(submit.role).toBe('button');
    expect(submit.name).toBe('Submit');
    expect(submit.a11y.state).toStrictEqual({disabled: false, selected: false, busy: false});
    expect(submit.box).toStrictEqual({x: 24, y: 154, width: 342, height: 48});

    // Absolute box = sum of parent frames.
    const label = submit.children[0];
    expect(label.box).toStrictEqual({x: 164, y: 168, width: 62, height: 20});
    expect(label.text).toBe('Submit');
    expect(label.sel).toBe('RootView>View>View>Paragraph');
    // Text fragments get the Paragraph's box.
    expect(label.children[0].type).toBe('Text');
    expect(label.children[0].text).toBe('mit');
    expect(label.children[0].box).toStrictEqual(label.box);

    expect(!('layoutMetrics-frame' in root.style)).toBeTruthy();
  });

  const shadowTree = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, 'shadow-tree.json'), 'utf8'),
  ) as ShadowNodeJSON;

  it('converts the typed getA11yTree JSON (shadowTree) to the output schema', () => {
    const {source, root} = toRenderResult({
      viewport: {width: 390, height: 844},
      source: 'shadowTree',
      tree: shadowTree,
    });
    expect(source).toBe('shadowTree');
    expect(root.ref).toBe('n0');
    expect(root.type).toBe('RootView');

    // Hierarchy is intact: the container View has the content as children.
    const container = root.children[0];
    expect(container.type).toBe('View');
    expect(container.children.map(c => c.type)).toStrictEqual(['Paragraph', 'Image', 'AndroidTextInput', 'View', 'AndroidSwitch', 'View']);
    // Yoga edge/gutter objects are flattened to React Native style names.
    expect(container.style).toStrictEqual({
      backgroundColor: 'rgba(255, 255, 255, 1)',
      flex: 1,
      padding: 24,
      paddingTop: 8,
      rowGap: 4,
    });
    // Pre-order refs (n3 is the kept link span inside the title).
    expect([root, container, ...container.children].map(n => n.ref)).toStrictEqual(['n0', 'n1', 'n2', 'n4', 'n5', 'n6', 'n8', 'n9']);

    const title = container.children[0];
    expect(title.role).toBe('header');
    expect(title.name).toBe('Sign in now');
    expect(title.text).toBe('Sign in now');
    expect(title.sel).toBe('RootView>View>Paragraph');
    expect(title.style.fontSize).toBe(28);
    expect(title.style.fontWeight).toBe(700);
    expect(title.style.ellipsizeMode).toBe('tail');
    expect(title.style.marginBottom).toBe(16);
    expect(title.virtual).toBe(undefined);
    // RawText and the span without a11y props are dropped; the link span is
    // kept with the Paragraph's box.
    expect(title.children.length).toBe(1);
    const link = title.children[0];
    expect(link.type).toBe('Text');
    expect(link.role).toBe('link');
    expect(link.text).toBe('now');
    expect(link.name).toBe('now');
    expect(link.virtual).toBe(true);
    expect(link.box).toStrictEqual(title.box);

    const image = container.children[1];
    expect(image.role).toBe('image');
    expect(image.name).toBe('Company logo');
    expect(image.sel).toBe('RootView>View>Image');

    const submit = find(root, n => n.testID === 'submit')!;
    expect(submit.sel).toBe('#submit');
    expect(submit.role).toBe('button'); // from the `role` prop
    expect(submit.name).toBe('Submit'); // descendant text (accessible)
    expect(submit.a11y.state).toStrictEqual({disabled: false, selected: false, busy: false});
    expect(submit.debugProps).toStrictEqual({testID: 'submit', accessible: 'true'});
    expect(submit.box).toStrictEqual({x: 24, y: 154, width: 342, height: 48});

    const label = submit.children[0];
    expect(label.type).toBe('Paragraph');
    expect(label.box).toStrictEqual({x: 164, y: 168, width: 62, height: 20});
    expect(label.sel).toBe('RootView>View>View:1>Paragraph');
    expect(label.debugProps).toBe(undefined);

    const email = container.children[2];
    expect(email.role).toBe('textbox');
    expect(email.sel).toBe('#email');
    expect(email.text).toBe(null); // "" from the host
    expect(email.name).toBe(null);
    expect(email.style.placeholder).toBe('Email');
    expect(email.style.editable).toBe(true);
    expect(email.style.padding).toBe(8);
    expect(email.style.borderWidth).toBe(1);

    const toggle = container.children[4];
    expect(toggle.role).toBe('switch');
    expect(toggle.name).toBe('Remember me');
    expect(toggle.a11y.state).toStrictEqual({checked: true, disabled: true});
    expect(toggle.style.value).toBe(true);

    const decoration = container.children[5];
    expect(decoration.role).toBe(null); // role="presentation" wins, means no role
    expect(decoration.a11y.hidden).toBe(true);
    expect(decoration.sel).toBe('RootView>View>View:2');
  });

  it('children of a scrolled ScrollView are shifted by its contentOffset', () => {
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
    expect(list.box).toStrictEqual({x: 0, y: 100, width: 390, height: 400});
    expect(list.style.contentOffset).toStrictEqual({x: 0, y: 600});
    const content = list.children[0];
    expect(content.box.y).toBe(-500);
    expect(find(root, n => n.testID === 'row-12')!.box.y).toBe(220);
  });

  it('contentOriginOffset places children (RNSScreen header, ScrollView)', () => {
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
    expect(screen.style.activityState).toBe(2);
    expect(screen.style.contentOriginOffset).toStrictEqual({x: 0, y: 91});
    expect(find(root, n => n.testID === 'content')!.box.y).toBe(91);
    const header = find(root, n => n.type === 'RNSScreenStackHeaderConfig')!;
    expect(header.box).toStrictEqual({x: 0, y: 47, width: 390, height: 44});
    expect(header.name).toBe('Home');
    expect(header.role).toBe(null);
    // contentOriginOffset wins over contentOffset (no double counting).
    expect(find(root, n => n.testID === 'row')!.box.y).toBe(91 + 100 - 600 + 720);
  });

  it('visualBox applies transforms (about the center, composed with ancestors) and mounted overrides', () => {
    const T = (x: number, y: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, 0, 1];
    const S = (k: number) => [k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const tree: ShadowNodeJSON = {
      type: 'RootView',
      frame: {x: 0, y: 0, width: 390, height: 844},
      children: [
        {type: 'View', testID: 'plain', frame: {x: 10, y: 10, width: 50, height: 40}, children: []},
        {type: 'View', testID: 'slide', frame: {x: 24, y: 100, width: 50, height: 40}, transform: T(120, 0), children: []},
        {
          type: 'View',
          testID: 'scaled',
          frame: {x: 100, y: 200, width: 100, height: 100},
          transform: S(2),
          opacity: 0.5,
          children: [
            {
              type: 'View',
              testID: 'child',
              frame: {x: 0, y: 0, width: 10, height: 10},
              mounted: {opacity: 0.4, transform: T(5, 0)},
              children: [],
            },
          ],
        },
      ],
    };
    const {root} = toRenderResult({viewport: {width: 390, height: 844}, source: 'shadowTree', tree});
    const byID = (id: string) => find(root, n => n.testID === id)!;

    expect(byID('plain').visualBox).toBe(undefined);
    expect(byID('plain').effectiveOpacity).toBe(undefined);

    // Translate: layout box unchanged, visual box moved by 120.
    expect(byID('slide').box).toStrictEqual({x: 24, y: 100, width: 50, height: 40});
    expect(byID('slide').visualBox).toStrictEqual({x: 144, y: 100, width: 50, height: 40});

    // Scale 2 about the center (150, 250): 100x100 -> 200x200 at (50, 150).
    expect(byID('scaled').visualBox).toStrictEqual({x: 50, y: 150, width: 200, height: 200});
    expect(byID('scaled').effectiveOpacity).toBe(0.5);

    // Child at (100,200,10,10), mounted translate 5 about its own center, then
    // the parent's scale 2 about (150,250): x 105 -> 60, y 200 -> 150, size 20.
    expect(byID('child').visualBox).toStrictEqual({x: 60, y: 150, width: 20, height: 20});
    // Mounted opacity 0.4 times the parent's 0.5.
    expect(byID('child').effectiveOpacity).toBe(0.2);
    expect(byID('child').style.mounted).toStrictEqual({opacity: 0.4, transform: T(5, 0)});
  });
});
