import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {describe, expect, it} from 'vitest';
import {fileURLToPath} from 'node:url';

import {expoPolyfillPath, renderEntry} from '../src/bundle.ts';
import {expoLabel, expoRole, expoState, expoText} from '../src/expo.ts';
import type {ShadowNodeJSON, TreeNode} from '../src/schema.ts';
import {toRenderResult} from '../src/tree.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('expo', () => {
  it('expoRole / expoText / expoLabel / expoState', () => {
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
    for (const [view, props, role] of roles) expect(expoRole(view, props), view).toBe(role);
    expect(expoText('TextView', {text: 'Hello'})).toBe('Hello');
    expect(expoText('Button', {text: 'x'})).toBe(null);
    expect(expoLabel('ToggleView', {label: 'Remember'})).toBe('Remember');
    expect(expoLabel('Button', {title: 'Go'})).toBe('Go');
    expect(expoState('SwitchView', {value: true, enabled: false})).toStrictEqual({checked: true, disabled: true});
    expect(expoState('ToggleView', {isOn: false})).toStrictEqual({checked: false});
    expect(expoState('RadioButton', {selected: true})).toStrictEqual({selected: true});
    expect(expoState('ColumnView', {})).toBe(undefined);
  });

  it('tree: ExpoUI nodes get role, name, text, state, expo and layout', () => {
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
          emulatedBy: 'compose',
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
    expect(host.layout).toBe('emulated');
    expect(host.emulatedBy).toBe('compose');
    expect(byTag('ExpoUI.ColumnView').emulatedBy).toBe(undefined);
    expect(host.expo).toStrictEqual({matchContentsVertical: true});
    expect(host.role).toBe(null);
    const hello = byTag('ExpoUI.TextView');
    expect([hello.role, hello.name, hello.text, hello.layout]).toStrictEqual(['text', 'Hello', 'Hello', 'placeholder']);
    const go = byTag('ExpoUI.Button');
    expect([go.key, go.role, go.name]).toStrictEqual(['go', 'button', 'Go']); // name from the child Text
    expect(go.expo?.modifiers).toStrictEqual([{$type: 'testID', testID: 'go'}]);
    const remember = byTag('ExpoUI.SwitchView');
    expect([remember.role, remember.a11y.state]).toStrictEqual(['switch', {checked: true}]);
    const greeting = byTag('ExpoUI.TextView', 2);
    expect([greeting.name, greeting.text]).toStrictEqual(['Greeting', 'Hello']);
    const link = byTag('ExpoUI.Button', 1);
    expect([link.role, link.name]).toStrictEqual(['link', 'More']); // explicit role wins
  });

  function project(pkg: Record<string, unknown>): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(ROOT, 'examples', '.tmp-expo-')));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg));
    return dir;
  }

  it('expoPolyfillPath: only for projects that list expo, expo-modules-core or @expo/ui', () => {
    const withExpo = project({dependencies: {expo: '58.0.0'}});
    const withUI = project({devDependencies: {'@expo/ui': '~58.0.9'}});
    const plain = project({dependencies: {react: '19.3.0'}});
    try {
      expect(expoPolyfillPath(withExpo) ?? '').toMatch(/expo-modules-core[\\/]src[\\/]polyfill[\\/]dangerous-internal\.ts$/);
      expect(expoPolyfillPath(withUI)).toBeTruthy();
      expect(expoPolyfillPath(plain)).toBe(null); // expo-modules-core resolves (hoisted), but the project does not use it
      expect(expoPolyfillPath(path.join(os.tmpdir(), 'no-such-project'))).toBe(null);
    } finally {
      for (const d of [withExpo, withUI, plain]) fs.rmSync(d, {recursive: true, force: true});
    }
    const options = {appPath: path.join(ROOT, 'examples/basic/App.tsx'), viewportWidth: 390, viewportHeight: 844};
    const without = renderEntry(options);
    expect(without).not.toContain('installExpo');
    expect(without).not.toContain('__EXPO_PRELUDE__');
    const withPrelude = renderEntry({...options, expoPolyfill: '/x/dangerous-internal.ts'});
    expect(withPrelude).toMatch(/require\('\/x\/dangerous-internal\.ts'\)\.installExpoGlobalPolyfill\(\);/);
    expect(withPrelude).toMatch(/runtime[\\/]+expo[\\/]+prelude'\)\.installExpoPrelude\(\);/); // \\ (escaped) on Windows
  });

  it('runtime/expo/viewConfigs.json is generated from the native tables', {skip: !fs.existsSync(path.join(ROOT, 'native/tools/expo-view-configs/out/viewConfigs.json'))}, () => {
    const proc = spawnSync('bun', [path.join(ROOT, 'scripts/gen-expo-view-configs.ts'), '--check'], {encoding: 'utf8'});
    expect(proc.status, proc.stderr).toBe(0);
    const configs = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime/expo/viewConfigs.json'), 'utf8'));
    expect(Object.keys(configs.views).length).toBe(152);
    expect(configs.views.ExpoUI_Button.events).toStrictEqual(['onButtonPress', 'onButtonPressed', 'onGlobalEvent']);
    for (const entry of [...Object.values(configs.views), configs.union] as Array<{attributes: string[]}>) {
      for (const excluded of ['children', 'key', 'ref', 'style']) expect(entry.attributes).not.toContain(excluded);
    }
  });
});
