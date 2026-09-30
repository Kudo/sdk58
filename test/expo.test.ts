import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {expoPolyfillPath, renderEntry} from '../src/bundle.ts';
import {expoLabel, expoRole, expoState, expoText} from '../src/expo.ts';
import type {ShadowNodeJSON, TreeNode} from '../src/schema.ts';
import {toRenderResult} from '../src/tree.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('expoRole / expoText / expoLabel / expoState', () => {
  const roles: Array<[string, Record<string, unknown>, string | null]> = [
    ['Button', {}, 'button'],
    ['OutlinedButton', {}, 'button'],
    ['IconButton', {}, 'button'],
    ['ToggleButton', {}, 'togglebutton'],
    ['RadioButton', {}, 'radio'],
    ['SwitchView', {}, 'switch'],
    ['ToggleView', {}, 'switch'],
    ['CheckboxView', {}, 'checkbox'],
    ['SliderView', {}, 'adjustable'],
    ['TextFieldView', {}, 'textbox'],
    ['SecureFieldView', {}, 'textbox'],
    ['TextView', {}, 'text'],
    ['ImageView', {}, 'image'],
    ['IconView', {}, 'image'],
    ['PickerView', {}, 'combobox'],
    ['PickerView', {modifiers: [{$type: 'pickerStyle', style: 'segmented'}]}, 'radiogroup'],
    ['ColumnView', {}, null],
    ['HostView', {}, null],
  ];
  for (const [view, props, role] of roles) assert.equal(expoRole(view, props), role, view);
  assert.equal(expoText('TextView', {text: 'Hello'}), 'Hello');
  assert.equal(expoText('Button', {text: 'x'}), null);
  assert.equal(expoLabel('ToggleView', {label: 'Remember'}), 'Remember');
  assert.equal(expoLabel('Button', {title: 'Go'}), 'Go');
  assert.deepEqual(expoState('SwitchView', {value: true, enabled: false}), {checked: true, disabled: true});
  assert.deepEqual(expoState('ToggleView', {isOn: false}), {checked: false});
  assert.deepEqual(expoState('RadioButton', {selected: true}), {selected: true});
  assert.equal(expoState('ColumnView', {}), undefined);
});

test('tree: ExpoUI nodes get role, name, text, state, expo and layout', () => {
  const frame = {x: 0, y: 0, width: 100, height: 40};
  const tree: ShadowNodeJSON = {
    type: 'RootView',
    tag: 1,
    frame: {x: 0, y: 0, width: 390, height: 844},
    children: [
      {
        type: 'ExpoUI.HostView',
        tag: 2,
        frame,
        layout: 'emulated',
        expo: {matchContentsVertical: true},
        children: [
          {
            type: 'ExpoUI.ColumnView',
            tag: 3,
            frame,
            layout: 'placeholder',
            expo: {modifiers: []},
            children: [
              {type: 'ExpoUI.TextView', tag: 4, frame, layout: 'placeholder', expo: {text: 'Hello'}},
              {
                type: 'ExpoUI.Button',
                tag: 5,
                frame,
                testID: 'go',
                layout: 'placeholder',
                expo: {modifiers: [{$type: 'testID', testID: 'go'}]},
                children: [{type: 'ExpoUI.TextView', tag: 6, frame, expo: {text: 'Go'}}],
              },
              {type: 'ExpoUI.SwitchView', tag: 7, frame, testID: 'remember', expo: {value: true}},
              {
                type: 'ExpoUI.TextView',
                tag: 8,
                frame,
                accessibilityLabel: 'Greeting',
                expo: {text: 'Hello', modifiers: [{$type: 'onTapGesture', eventListener: null}]},
              },
              {type: 'ExpoUI.Button', tag: 9, frame, role: 'link', expo: {label: 'More'}},
            ],
          },
        ],
      },
    ],
  };
  const result = toRenderResult({viewport: {width: 390, height: 844}, source: 'shadowTree', tree} as never);
  const all: TreeNode[] = [];
  const walk = (n: TreeNode) => {
    all.push(n);
    n.children.forEach(walk);
  };
  walk(result.root);
  const byTag = (type: string, i = 0) => all.filter(n => n.type === type)[i];
  const host = byTag('ExpoUI.HostView');
  assert.equal(host.layout, 'emulated');
  assert.deepEqual(host.expo, {matchContentsVertical: true});
  assert.equal(host.role, null);
  const hello = byTag('ExpoUI.TextView');
  assert.deepEqual([hello.role, hello.name, hello.text, hello.layout], ['text', 'Hello', 'Hello', 'placeholder']);
  const go = byTag('ExpoUI.Button');
  assert.deepEqual([go.key, go.role, go.name], ['go', 'button', 'Go']); // name from the child Text
  assert.deepEqual(go.expo?.modifiers, [{$type: 'testID', testID: 'go'}]);
  const remember = byTag('ExpoUI.SwitchView');
  assert.deepEqual([remember.role, remember.a11y.state], ['switch', {checked: true}]);
  const greeting = byTag('ExpoUI.TextView', 2);
  assert.deepEqual([greeting.name, greeting.text], ['Greeting', 'Hello']);
  const link = byTag('ExpoUI.Button', 1);
  assert.deepEqual([link.role, link.name], ['link', 'More']); // explicit role wins
});

function project(pkg: Record<string, unknown>): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(ROOT, 'examples', '.tmp-expo-')));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
  return dir;
}

test('expoPolyfillPath: only for projects that list expo, expo-modules-core or @expo/ui', () => {
  const withExpo = project({dependencies: {expo: '58.0.0'}});
  const withUI = project({devDependencies: {'@expo/ui': '~58.0.9'}});
  const plain = project({dependencies: {react: '19.3.0'}});
  try {
    assert.match(expoPolyfillPath(withExpo) ?? '', /expo-modules-core\/src\/polyfill\/dangerous-internal\.ts$/);
    assert.ok(expoPolyfillPath(withUI));
    assert.equal(expoPolyfillPath(plain), null); // expo-modules-core resolves (hoisted), but the project does not use it
    assert.equal(expoPolyfillPath(path.join(os.tmpdir(), 'no-such-project')), null);
  } finally {
    for (const d of [withExpo, withUI, plain]) fs.rmSync(d, {recursive: true, force: true});
  }
  const options = {appPath: path.join(ROOT, 'examples/basic/App.tsx'), viewportWidth: 390, viewportHeight: 844};
  const without = renderEntry(options);
  assert.ok(!without.includes('installExpo'));
  assert.ok(!without.includes('__EXPO_PRELUDE__'));
  const withPrelude = renderEntry({...options, expoPolyfill: '/x/dangerous-internal.ts'});
  assert.match(withPrelude, /require\('\/x\/dangerous-internal\.ts'\)\.installExpoGlobalPolyfill\(\);/);
  assert.match(withPrelude, /runtime\/expo\/prelude'\)\.installExpoPrelude\(\);/);
});

test('runtime/expo/viewConfigs.json is generated from the native tables', {skip: !fs.existsSync(path.join(ROOT, 'native/tools/expo-view-configs/out/viewConfigs.json'))}, () => {
  const proc = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gen-expo-view-configs.mjs'), '--check'], {encoding: 'utf8'});
  assert.equal(proc.status, 0, proc.stderr);
  const configs = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime/expo/viewConfigs.json'), 'utf8'));
  assert.equal(Object.keys(configs.views).length, 152);
  assert.deepEqual(configs.views.ExpoUI_Button.events, ['onButtonPress', 'onButtonPressed', 'onGlobalEvent']);
  for (const entry of [...Object.values(configs.views), configs.union] as Array<{attributes: string[]}>) {
    for (const excluded of ['children', 'key', 'ref', 'style']) assert.ok(!entry.attributes.includes(excluded));
  }
});
