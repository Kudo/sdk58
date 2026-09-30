/**
 * @flow
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import './fantomExpoUIPrelude';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import NativeFantom from 'react-native/src/private/testing/fantom/specs/NativeFantom';

// $FlowFixMe[unclear-type] registered natively, not in the codegen spec.
const Native: any = NativeFantom;

function tree(root: Fantom.Root): $FlowFixMe {
  return JSON.parse(Native.getA11yTree(root.getRootTag(), false));
}

function findAll(node: $FlowFixMe, predicate: $FlowFixMe => boolean, out: Array<$FlowFixMe> = []): Array<$FlowFixMe> {
  if (predicate(node)) {
    out.push(node);
  }
  for (const child of node.children ?? []) {
    findAll(child, predicate, out);
  }
  return out;
}

function summarize(node: $FlowFixMe): $FlowFixMe {
  const {children, yogaStyle, layoutDirection, effectiveBackground, ...rest} = node;
  return {...rest, children: (children ?? []).map(summarize)};
}

function settle() {
  for (let i = 0; i < 3; i++) {
    NativeFantom.flushEventQueue();
    Fantom.runWorkLoop();
  }
}

describe('@expo/ui', () => {
  it('renders the universal (Compose on android) components', () => {
    let UI: $FlowFixMe;
    Fantom.runTask(() => {
      // $FlowFixMe[cannot-resolve-module]
      UI = require('@expo/ui');
    });
    const {Host, Column, Text, Button, Switch} = UI;
    const presses: Array<string> = [];
    const switches: Array<mixed> = [];
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const surfaceId = root.getRootTag();
    Fantom.runTask(() => {
      root.render(
        <Host matchContents>
          <Column spacing={8}>
            <Text>Hello</Text>
            <Button testID="go" onPress={() => presses.push('go')} label="Go" />
            <Switch value={true} onValueChange={(v: mixed) => switches.push(v)} label="Remember" />
          </Column>
        </Host>,
      );
    });
    settle();
    const t = tree(root);
    const host = findAll(t, n => n.type === 'ExpoUI.HostView')[0];
    console.log('EXPO_TREE ' + JSON.stringify(summarize(host)));
    expect(host).toBeTruthy();

    const button = findAll(t, n => n.type === 'ExpoUI.Button')[0];
    Native.enqueueNativeEventByTag(surfaceId, button.tag, 'buttonPressed', {});
    settle();
    const switchNode = findAll(t, n => n.type === 'ExpoUI.SwitchView')[0];
    Native.enqueueNativeEventByTag(surfaceId, switchNode.tag, 'checkedChange', {value: false});
    settle();
    console.log('EXPO_EVENTS ' + JSON.stringify({presses, switches}));
    expect(presses).toEqual(['go']);
  });

  it('renders the swift-ui components', () => {
    let UI: $FlowFixMe;
    Fantom.runTask(() => {
      // $FlowFixMe[cannot-resolve-module]
      UI = require('@expo/ui/swift-ui');
      // $FlowFixMe[cannot-resolve-module]
      UI.modifiers = require('@expo/ui/swift-ui/modifiers');
    });
    const {Host, VStack, Text, Button, Toggle} = UI;
    const {accessibilityLabel, accessibilityHint, padding} = UI.modifiers;
    const presses: Array<string> = [];
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const surfaceId = root.getRootTag();
    Fantom.runTask(() => {
      root.render(
        <Host style={{flex: 1}}>
          <VStack spacing={8}>
            <Text modifiers={[accessibilityLabel('Greeting'), accessibilityHint('Says hello'), padding({all: 4})]}>
              Hello
            </Text>
            <Button label="Go" onPress={() => presses.push('go')} />
            <Toggle isOn={true} label="Remember" />
          </VStack>
        </Host>,
      );
    });
    settle();
    const t = tree(root);
    const host = findAll(t, n => n.type === 'ExpoUI.HostView')[0];
    console.log('SWIFT_TREE ' + JSON.stringify(summarize(host)));
    const button = findAll(t, n => n.type === 'ExpoUI.Button')[0];
    Native.enqueueNativeEventByTag(surfaceId, button.tag, 'buttonPress', {});
    settle();
    console.log('SWIFT_EVENTS ' + JSON.stringify({presses}));
    const text = findAll(t, n => n.type === 'ExpoUI.TextView')[0];
    expect(text.accessibilityLabel).toBe('Greeting');
    expect(text.accessibilityHint).toBe('Says hello');
    expect(presses).toEqual(['go']);
  });
});
