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

    // Compose engine (tester/src/expoui/compose, density = pointScaleFactor 3,
    // checked against real Compose Desktop by native/tools/compose-layout-test):
    // Host matchContents on both axes; Column spacedBy(8) of Text "Hello"
    // (14 sp Roboto: 16.333 high), Button (58x40 minimum, 24/8 padding, 48 dp
    // touch target) and the universal Switch's Row (fillMaxWidth,
    // width(IntrinsicSize.Max), spacedBy(8)) of Text "Remember" (weight 1) and
    // Switch (52x32 in a 48 dp touch target). Frames relative to the parent.
    expect(JSON.parse(Native.getCapabilities())).toContain('expoUI.composeLayout');
    const t2 = tree(root);
    const frames = findAll(t2, n => String(n.type).startsWith('ExpoUI.')).map(n => [n.type, n.frame]);
    console.log('EXPO_FRAMES ' + JSON.stringify(frames));
    const expected = [
      ['ExpoUI.HostView', [0, 0, 128.333, 128.333]],
      ['ExpoUI.ColumnView', [0, 0, 128.333, 128.333]],
      ['ExpoUI.TextView', [0, 0, 32.333, 16.333]],
      ['ExpoUI.Button', [0, 24.333, 65.667, 48]],
      ['ExpoUI.TextView', [24, 16, 17.667, 16.333]],
      ['ExpoUI.RowView', [0, 80.333, 128.333, 48]],
      ['ExpoUI.TextView', [0, 16, 68.333, 16.333]],
      ['ExpoUI.SwitchView', [76.333, 0, 52, 48]],
    ];
    expect(frames.map(([type]) => type)).toEqual(expected.map(([type]) => type));
    frames.forEach(([, frame], i) => {
      const [x, y, width, height] = expected[i][1];
      expect(frame.x).toBeCloseTo(x, 2);
      expect(frame.y).toBeCloseTo(y, 2);
      expect(frame.width).toBeCloseTo(width, 2);
      expect(frame.height).toBeCloseTo(height, 2);
    });
    // Every node the engine laid out is "emulated"; the Host names the engine.
    const host3 = findAll(t2, n => n.type === 'ExpoUI.HostView')[0];
    expect(host3.layout).toBe('emulated');
    expect(host3.emulatedBy).toBe('compose');
    expect(findAll(host3, n => String(n.type).startsWith('ExpoUI.')).map(n => n.layout)).toEqual(
      expected.map(() => 'emulated'),
    );
    const button2 = findAll(t2, n => n.type === 'ExpoUI.Button')[0];
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
    // Frames of the SwiftUI engine; the Host (flex: 1) fills the root.
    const swiftFrames = findAll(tree(root), n => String(n.type).startsWith('ExpoUI.')).map(n => [n.type, n.frame]);
    console.log('SWIFT_FRAMES ' + JSON.stringify(swiftFrames));
    expect(swiftFrames[0][1]).toEqual({x: 0, y: 0, width: 390, height: 844});
    const swiftHost = findAll(tree(root), n => n.type === 'ExpoUI.HostView')[0];
    expect([swiftHost.layout, swiftHost.emulatedBy]).toEqual(['emulated', 'swiftui']);
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
    // SwiftUI engine (iOS metrics): below the Text (body, 20.333 high) by the
    // default text-to-control spacing (10.643). The VStack hugs its widest
    // child (the 100-point RNHostView), so x is 0.
    expect(hostView.frame.x).toBe(0);
    expect(hostView.frame.y).toBeCloseTo(20.333 + 10.643, 2);
    expect(hostView.frame.width).toBe(100);
    expect(hostView.frame.height).toBe(30);
    expect(content.frame).toEqual({x: 0, y: 0, width: 100, height: 30});
    const hit = JSON.parse(Native.hitTest(surfaceId, 50, hostView.frame.y + 15));
    console.log('RNHOST_HIT ' + JSON.stringify(hit));
    expect(hit.path).toContain(content.tag);
  });

  it('lays out swift-ui Hosts with the SwiftUI engine', () => {
    let UI: $FlowFixMe;
    Fantom.runTask(() => {
      // $FlowFixMe[cannot-resolve-module]
      UI = require('@expo/ui/swift-ui');
      // $FlowFixMe[cannot-resolve-module]
      UI.modifiers = require('@expo/ui/swift-ui/modifiers');
    });
    const {Host, VStack, HStack, Text, Button, Spacer} = UI;
    const {padding, frame} = UI.modifiers;
    const capabilities = JSON.parse(Native.getCapabilities());
    expect(capabilities).toContain('expoUI.swiftUILayout');
    expect(capabilities).not.toContain('expoUI.fakeLayout');

    const presses: Array<string> = [];
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const surfaceId = root.getRootTag();
    const render = () =>
      Fantom.runTask(() => {
        root.render(
          <Host matchContents={{vertical: true}}>
            <VStack spacing={8} alignment="leading" modifiers={[padding({all: 16})]}>
              <Text>Hello</Text>
              <Button label="Go" onPress={() => presses.push('go')} modifiers={[frame({width: 100})]} />
              <HStack>
                <Text>Left</Text>
                <Spacer />
                <Text>Right</Text>
              </HStack>
            </VStack>
          </Host>,
        );
      });
    render();
    settle();
    const t = tree(root);
    const frames = findAll(t, n => String(n.type).startsWith('ExpoUI.')).map(n => [n.type, n.frame]);
    console.log('SWIFTUI_ENGINE_FRAMES ' + JSON.stringify(frames));
    const [host] = findAll(t, n => n.type === 'ExpoUI.HostView');
    const [vstack] = findAll(t, n => n.type === 'ExpoUI.VStackView');
    const [hello, left, right] = findAll(t, n => n.type === 'ExpoUI.TextView');
    const [button] = findAll(t, n => n.type === 'ExpoUI.Button');
    const [hstack] = findAll(t, n => n.type === 'ExpoUI.HStackView');
    const line = 61 / 3; // one line of body text on iOS: ceil(20.287) to 1/3 pt
    // Host: matchContents vertical -> 16 + 3 lines + 2 x 8 + 16; width from RN (390).
    expect(host.frame.width).toBe(390);
    expect(host.frame.height).toBeCloseTo(32 + 3 * line + 16, 2);
    // The VStack fills the width (the HStack's Spacer), padding 16.
    expect(vstack.frame).toEqual({x: 0, y: 0, width: 390, height: host.frame.height});
    expect([hello.frame.x, hello.frame.y, hello.frame.width]).toEqual([16, 16, 39]);
    expect(hello.frame.height).toBeCloseTo(line, 2);
    // Button: plain (iOS .automatic), frame(width: 100), below the Text by 8.
    expect(button.frame.x).toBe(16);
    expect(button.frame.y).toBeCloseTo(16 + line + 8, 2);
    expect(button.frame.width).toBe(100);
    expect(button.frame.height).toBeCloseTo(line, 2);
    // HStack: full width inside the padding, Text / Spacer / Text.
    expect(hstack.frame.x).toBe(16);
    expect(hstack.frame.y).toBeCloseTo(16 + 2 * line + 16, 2);
    expect(hstack.frame.width).toBe(358);
    expect(left.frame.x).toBe(0);
    expect(right.frame.x + right.frame.width).toBeCloseTo(358, 2);

    // Hit test at the Button's center: the Button (it has no child views).
    const cx = host.frame.x + vstack.frame.x + button.frame.x + button.frame.width / 2;
    const cy = host.frame.y + vstack.frame.y + button.frame.y + button.frame.height / 2;
    const hit = JSON.parse(Native.hitTest(surfaceId, cx, cy));
    console.log('SWIFTUI_ENGINE_HIT ' + JSON.stringify(hit));
    expect(hit.tag).toBe(button.tag);

    // macOS metrics: body text is 13 pt.
    Native.setExpoUIPlatform('macos');
    render();
    Fantom.runTask(() => root.render(<Host matchContents={{vertical: true}}><Text>Hello</Text></Host>));
    settle();
    const [macText] = findAll(tree(root), n => n.type === 'ExpoUI.TextView');
    console.log('SWIFTUI_ENGINE_MACOS ' + JSON.stringify(macText.frame));
    expect(macText.frame.height).toBeLessThan(18);
    Native.setExpoUIPlatform('ios');
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
