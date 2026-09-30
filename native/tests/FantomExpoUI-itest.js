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

    // Fake layout (until the SwiftUI/Compose engine lands): rows of 390x40.
    const t2 = tree(root);
    const frames = findAll(t2, n => String(n.type).startsWith('ExpoUI.')).map(n => [n.type, n.tag, n.frame]);
    console.log('EXPO_FRAMES ' + JSON.stringify(frames));
    const host2 = findAll(t2, n => n.type === 'ExpoUI.HostView')[0];
    expect(host2.frame.height).toBe(160);
    const button2 = findAll(t2, n => n.type === 'ExpoUI.Button')[0];
    expect(button2.frame.height).toBe(40);
    const buttonBox = (() => {
      let result = null;
      function walk(node: $FlowFixMe, x: number, y: number) {
        const nx = x + (node.frame?.x ?? 0);
        const ny = y + (node.frame?.y ?? 0);
        if (node.tag === button2.tag) {
          result = {x: nx, y: ny, width: node.frame.width, height: node.frame.height};
        }
        for (const child of node.children ?? []) {
          walk(child, nx, ny);
        }
      }
      walk(t2, 0, 0);
      return result;
    })();
    const hit = JSON.parse(
      Native.hitTest(surfaceId, buttonBox.x + buttonBox.width / 2, buttonBox.y + buttonBox.height / 2),
    );
    console.log('EXPO_HIT ' + JSON.stringify({buttonBox, hit}));
    expect(hit.path).toContain(button2.tag);
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
    const {accessibilityLabel, accessibilityHint, padding, onTapGesture} = UI.modifiers;
    const presses: Array<string> = [];
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const surfaceId = root.getRootTag();
    Fantom.runTask(() => {
      root.render(
        <Host style={{flex: 1}}>
          <VStack spacing={8}>
            <Text
              testID="greeting"
              modifiers={[
                accessibilityLabel('Greeting'),
                accessibilityHint('Says hello'),
                padding({all: 4}),
                onTapGesture(() => presses.push('tap')),
              ]}>
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
    // Frames of the fake layout.
    const swiftFrames = findAll(tree(root), n => String(n.type).startsWith('ExpoUI.')).map(n => [n.type, n.frame]);
    console.log('SWIFT_FRAMES ' + JSON.stringify(swiftFrames));
    expect(swiftFrames[0][1]).toEqual({x: 0, y: 0, width: 390, height: 844});
    const text = findAll(t, n => n.type === 'ExpoUI.TextView')[0];
    expect(text.accessibilityLabel).toBe('Greeting');
    expect(text.accessibilityHint).toBe('Says hello');
    Native.dispatchExpoModifierEvent(text.tag, 'onTapGesture', {});
    settle();
    console.log('SWIFT_TAP ' + JSON.stringify({presses}));
    expect(presses).toEqual(['go', 'tap']);
  });

  it('lays out RN content in an RNHostView', () => {
    let UI: $FlowFixMe;
    Fantom.runTask(() => {
      // $FlowFixMe[cannot-resolve-module]
      UI = require('@expo/ui/swift-ui');
    });
    const {Host, VStack, Text, RNHostView} = UI;
    const {View, Pressable} = require('react-native');
    let rnPresses = 0;
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const surfaceId = root.getRootTag();
    Fantom.runTask(() => {
      root.render(
        <Host style={{flex: 1}}>
          <VStack>
            <Text>Above</Text>
            <RNHostView matchContents>
              <Pressable testID="rn-content" style={{width: 100, height: 30}} onPress={() => rnPresses++}>
                <View style={{flex: 1}} />
              </Pressable>
            </RNHostView>
          </VStack>
        </Host>,
      );
    });
    settle();
    const t = tree(root);
    const hostView = findAll(t, n => n.type === 'ExpoUI.RNHostView')[0];
    const content = findAll(t, n => n.testID === 'rn-content')[0];
    console.log('RNHOST ' + JSON.stringify({rnHostView: hostView.frame, content: content.frame, expo: hostView.expo}));
    expect(hostView.frame).toEqual({x: 0, y: 40, width: 100, height: 30});
    expect(content.frame).toEqual({x: 0, y: 0, width: 100, height: 30});
    const hit = JSON.parse(Native.hitTest(surfaceId, 50, 40 + 15));
    console.log('RNHOST_HIT ' + JSON.stringify(hit));
    expect(hit.path).toContain(content.tag);
  });

  it('measures text for the layout engine', () => {
    const results: {[string]: mixed} = {};
    for (const textStyle of ['body', 'title', 'largeTitle', 'headline', 'caption']) {
      results[textStyle] = Native.measureExpoText('Hello', {textStyle});
    }
    results.bodyRounded = Native.measureExpoText('Hello', {textStyle: 'body', design: 'rounded'});
    results.bodyWrapped = Native.measureExpoText(
      'The quick brown fox jumps over the lazy dog',
      {textStyle: 'body', maxWidth: 150},
    );
    results.bodyOneLine = Native.measureExpoText(
      'The quick brown fox jumps over the lazy dog',
      {textStyle: 'body', maxWidth: 150, maxLines: 1},
    );
    console.log('EXPO_TEXT ' + JSON.stringify(results));
    // $FlowFixMe[incompatible-use]
    expect(results.title.height).toBeGreaterThan(results.body.height);
  });
});
