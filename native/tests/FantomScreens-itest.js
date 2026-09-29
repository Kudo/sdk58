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

function tap(surfaceId: number, root: Fantom.Root, testID: string) {
  const t = tree(root);
  const node = findAll(t, n => n.testID === testID)[0];
  const frame = absoluteFrame(t, node.tag);
  const x = frame.x + frame.width / 2;
  const y = frame.y + frame.height / 2;
  const hit = JSON.parse(Native.hitTest(surfaceId, x, y));
  const touch = {
    pageX: x,
    pageY: y,
    locationX: x - frame.x,
    locationY: y - frame.y,
    screenX: x,
    screenY: y,
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
  return hit;
}

describe('react-native-screens native stack', () => {
  afterEach(() => {
    Native.setSafeAreaInsets({top: 0, left: 0, right: 0, bottom: 0});
  });

  it('navigates (examples/navigation-stack/App.tsx)', () => {
    // $FlowFixMe[cannot-resolve-module]
    const App = require('./FantomNavigationStackApp').default;
    Native.setSafeAreaInsets({top: 47, left: 0, right: 0, bottom: 34});
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const surfaceId = root.getRootTag();
    Fantom.runTask(() => {
      root.render(<App />);
    });
    settle();

    let t = tree(root);
    const provider = findAll(t, n => n.type === 'RNCSafeAreaProvider')[0];
    console.log('PROVIDER ' + JSON.stringify({frame: provider.frame, insets: provider.insets}));
    expect(provider.insets).toEqual({top: 47, left: 0, right: 0, bottom: 34});
    console.log('BEFORE ' + JSON.stringify(findAll(t, n => n.type === 'RNSScreenStack').map(summarize)));
    expect(findAll(t, n => n.type === 'RNSScreen').length).toBe(1);

    const hit = tap(surfaceId, root, 'go-details');
    console.log('HIT ' + JSON.stringify(hit));

    t = tree(root);
    const stack = findAll(t, n => n.type === 'RNSScreenStack')[0];
    console.log('AFTER ' + JSON.stringify(summarize(stack)));
    const screens = stack.children.filter(n => n.type === 'RNSScreen');
    expect(screens.length).toBe(2);
    expect(absoluteFrame(t, screens[1].tag)).toEqual(absoluteFrame(t, stack.tag));
    const headers = findAll(screens[1], n => n.type === 'RNSScreenStackHeaderConfig');
    expect(headers[0].title).toBe('Details');
    expect(findAll(screens[0], n => n.testID === 'go-details').length).toBe(1);
    const detailsText = findAll(t, n => n.testID === 'details-text')[0];
    console.log('DETAILS_TEXT ' + JSON.stringify({text: detailsText.text, frame: absoluteFrame(t, detailsText.tag)}));

    tap(surfaceId, root, 'go-back');
    t = tree(root);
    const screensAfterBack = findAll(t, n => n.type === 'RNSScreen');
    console.log('AFTER_BACK ' + JSON.stringify(screensAfterBack.map(s => ({tag: s.tag, screenId: s.screenId, activityState: s.activityState}))));
    expect(screensAfterBack.length).toBe(1);
  });
});
