/**
 * @flow
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Pressable, Text, View} from 'react-native';
import NativeFantom from 'react-native/src/private/testing/fantom/specs/NativeFantom';
// $FlowFixMe[cannot-resolve-module]
import {NavigationContainer} from '@react-navigation/native';
// $FlowFixMe[cannot-resolve-module]
import {createNativeStackNavigator} from '@react-navigation/native-stack';

// $FlowFixMe[unclear-type] methods registered natively, not in the codegen spec.
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

function absoluteFrame(root: $FlowFixMe, tag: number): $FlowFixMe {
  function walk(node: $FlowFixMe, x: number, y: number): $FlowFixMe {
    const nx = x + (node.frame?.x ?? 0);
    const ny = y + (node.frame?.y ?? 0);
    if (node.tag === tag) {
      return {x: nx, y: ny, width: node.frame.width, height: node.frame.height};
    }
    const cx = nx + (node.contentOriginOffset?.x ?? 0);
    const cy = ny + (node.contentOriginOffset?.y ?? 0);
    for (const child of node.children ?? []) {
      const found = walk(child, cx, cy);
      if (found != null) {
        return found;
      }
    }
    return null;
  }
  return walk(root, 0, 0);
}

function settle() {
  for (let i = 0; i < 5; i++) {
    NativeFantom.flushEventQueue();
    Fantom.runWorkLoop();
  }
}

function summarize(node: $FlowFixMe): $FlowFixMe {
  if (!String(node.type).startsWith('RNS')) {
    return null;
  }
  const {children, yogaStyle, layoutDirection, fragments, ...rest} = node;
  return {
    ...rest,
    children: (children ?? []).map(summarize).filter(Boolean),
  };
}

const Stack = createNativeStackNavigator();

function Home({navigation}: $FlowFixMe) {
  return (
    <View>
      <Text>Home screen</Text>
      <Pressable
        testID="go"
        style={{padding: 12}}
        onPress={() => navigation.navigate('Details')}>
        <Text>Go to details</Text>
      </Pressable>
    </View>
  );
}

function Details() {
  return (
    <View testID="details-content">
      <Text>Details screen</Text>
    </View>
  );
}

describe('react-native-screens native stack', () => {
  it('navigates', () => {
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const surfaceId = root.getRootTag();
    Fantom.runTask(() => {
      root.render(
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen name="Home" component={Home} />
            <Stack.Screen name="Details" component={Details} options={{title: 'Details'}} />
          </Stack.Navigator>
        </NavigationContainer>,
      );
    });
    settle();

    let t = tree(root);
    const stacks = findAll(t, n => n.type === 'RNSScreenStack');
    console.log('BEFORE ' + JSON.stringify(stacks.map(summarize)));

    const button = findAll(t, n => n.testID === 'go')[0];
    const frame = absoluteFrame(t, button.tag);
    console.log('BUTTON ' + JSON.stringify(frame));
    const hit = JSON.parse(Native.hitTest(surfaceId, frame.x + 5, frame.y + 5));
    console.log('HIT ' + JSON.stringify(hit));
    const touch = {
      pageX: frame.x + 5,
      pageY: frame.y + 5,
      locationX: 5,
      locationY: 5,
      screenX: frame.x + 5,
      screenY: frame.y + 5,
      identifier: 0,
      target: hit.tag,
      timestamp: 1000,
      force: 1,
    };
    Native.enqueueNativeEventByTag(surfaceId, hit.tag, 'touchStart', {
      touches: [touch],
      changedTouches: [touch],
      targetTouches: [touch],
    });
    settle();
    Native.enqueueNativeEventByTag(surfaceId, hit.tag, 'touchEnd', {
      touches: [],
      changedTouches: [{...touch, timestamp: 1050}],
      targetTouches: [],
    });
    settle();

    t = tree(root);
    const stack = findAll(t, n => n.type === 'RNSScreenStack')[0];
    console.log('AFTER ' + JSON.stringify(summarize(stack)));
    const screens = stack.children.filter(n => n.type === 'RNSScreen');
    const detailsContent = findAll(t, n => n.testID === 'details-content')[0];
    console.log(
      'DETAILS_CONTENT ' + JSON.stringify(absoluteFrame(t, detailsContent.tag)),
    );
    expect(screens.length).toBe(2);
    expect(screens[1].frame.width).toBe(stack.frame.width);
    expect(screens[1].frame.height).toBe(stack.frame.height);
    const headers = findAll(screens[1], n => n.type === 'RNSScreenStackHeaderConfig');
    expect(headers[0].title).toBe('Details');
    expect(findAll(screens[0], n => n.testID === 'go').length).toBe(1);
  });
});
