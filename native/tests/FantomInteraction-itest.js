/**
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Pressable, ScrollView, Text, TextInput, View} from 'react-native';
import NativeFantom from 'react-native/src/private/testing/fantom/specs/NativeFantom';

// $FlowFixMe[unclear-type] methods registered natively, not in the codegen spec.
const Native: any = NativeFantom;

function tree(root: Fantom.Root): $FlowFixMe {
  return JSON.parse(Native.getA11yTree(root.getRootTag(), false));
}

function find(node: $FlowFixMe, predicate: $FlowFixMe => boolean): $FlowFixMe {
  if (predicate(node)) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = find(child, predicate);
    if (found != null) {
      return found;
    }
  }
  return null;
}

function absoluteFrame(root: $FlowFixMe, tag: number): $FlowFixMe {
  function walk(node: $FlowFixMe, x: number, y: number): $FlowFixMe {
    const nx = x + (node.frame?.x ?? 0);
    const ny = y + (node.frame?.y ?? 0);
    if (node.tag === tag) {
      return {x: nx, y: ny, width: node.frame.width, height: node.frame.height};
    }
    for (const child of node.children ?? []) {
      const found = walk(child, nx, ny);
      if (found != null) {
        return found;
      }
    }
    return null;
  }
  return walk(root, 0, 0);
}

function onUIThread(task: () => void) {
  task();
  NativeFantom.flushEventQueue();
  Fantom.runWorkLoop();
}

describe('hitTest and by-tag events', () => {
  it('works', () => {
    const root = Fantom.createRoot({viewportWidth: 300, viewportHeight: 800});
    const surfaceId = root.getRootTag();
    let presses = 0;
    const changes: Array<string> = [];
    const scrolls: Array<number> = [];

    Fantom.runTask(() => {
      root.render(
        <View style={{padding: 20}}>
          <View>
            <Pressable
              testID="press"
              hitSlop={10}
              onPress={() => {
                presses++;
              }}
              style={{width: 100, height: 40, backgroundColor: 'blue'}}>
              <Text>Press me</Text>
            </Pressable>
            <View
              testID="overlay"
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: 200,
                height: 60,
                backgroundColor: 'rgba(0,0,0,0.1)',
              }}
            />
          </View>
          <View style={{alignItems: 'flex-start'}}>
            <TextInput
              testID="input"
              placeholder="Type"
              style={{fontSize: 16}}
              onChangeText={text => changes.push(text)}
            />
          </View>
          <ScrollView
            testID="scroll"
            style={{height: 100}}
            onScroll={e => scrolls.push(e.nativeEvent.contentOffset.y)}>
            <View style={{height: 1000}} />
          </ScrollView>
        </View>,
      );
    });

    let t = tree(root);
    const press = find(t, n => n.testID === 'press');
    const input = find(t, n => n.testID === 'input');
    const scroll = find(t, n => n.testID === 'scroll');
    const pressFrame = absoluteFrame(t, press.tag);
    console.log('PRESS_FRAME ' + JSON.stringify(pressFrame));

    // Inside the Pressable (and under the pointerEvents="none" overlay).
    const inside = JSON.parse(Native.hitTest(surfaceId, pressFrame.x + 50, pressFrame.y + 20));
    console.log('HIT_INSIDE ' + JSON.stringify(inside));
    expect(inside.tag).toBe(press.tag);

    // 5dp right of the Pressable's frame: only inside its hitSlop.
    const slop = JSON.parse(
      Native.hitTest(surfaceId, pressFrame.x + pressFrame.width + 5, pressFrame.y + 20),
    );
    console.log('HIT_SLOP ' + JSON.stringify(slop));
    expect(slop.tag).toBe(press.tag);
    expect(slop.viaHitSlop).toBe(true);

    // 15dp right: outside hitSlop, lands on the container View.
    const outside = JSON.parse(
      Native.hitTest(surfaceId, pressFrame.x + pressFrame.width + 15, pressFrame.y + 20),
    );
    console.log('HIT_OUTSIDE ' + JSON.stringify(outside));
    expect(outside.tag).not.toBe(press.tag);
    console.log('HIT_NONE ' + Native.hitTest(surfaceId, 1000, 1000));

    // click
    onUIThread(() => Native.enqueueNativeEventByTag(surfaceId, press.tag, 'click', {}));
    console.log('PRESSES_AFTER_CLICK ' + presses);

    // touchStart / touchEnd
    const touch = {
      pageX: pressFrame.x + 50,
      pageY: pressFrame.y + 20,
      locationX: 50,
      locationY: 20,
      screenX: pressFrame.x + 50,
      screenY: pressFrame.y + 20,
      identifier: 0,
      target: press.tag,
      timestamp: 1000,
      force: 1,
    };
    const before = presses;
    onUIThread(() =>
      Native.enqueueNativeEventByTag(surfaceId, press.tag, 'touchStart', {
        touches: [touch],
        changedTouches: [touch],
        targetTouches: [touch],
      }),
    );
    onUIThread(() =>
      Native.enqueueNativeEventByTag(surfaceId, press.tag, 'touchEnd', {
        touches: [],
        changedTouches: [{...touch, timestamp: 1050}],
        targetTouches: [],
      }),
    );
    console.log('PRESSES_AFTER_TOUCH ' + presses + ' (before ' + before + ')');

    // Events dispatched to the Paragraph inside the Pressable.
    const label = find(press, n => n.type === 'Paragraph');
    const hitLabel = JSON.parse(Native.hitTest(surfaceId, pressFrame.x + 5, pressFrame.y + 5));
    console.log('HIT_LABEL ' + JSON.stringify(hitLabel) + ' label ' + label.tag);
    const beforeLabel = presses;
    onUIThread(() => Native.enqueueNativeEventByTag(surfaceId, label.tag, 'click', {}));
    const afterLabelClick = presses;
    const labelTouch = {...touch, target: label.tag, locationX: 5, locationY: 5};
    onUIThread(() =>
      Native.enqueueNativeEventByTag(surfaceId, label.tag, 'touchStart', {
        touches: [labelTouch],
        changedTouches: [labelTouch],
        targetTouches: [labelTouch],
      }),
    );
    onUIThread(() =>
      Native.enqueueNativeEventByTag(surfaceId, label.tag, 'touchEnd', {
        touches: [],
        changedTouches: [labelTouch],
        targetTouches: [],
      }),
    );
    console.log(
      'LABEL_PRESSES click:' + (afterLabelClick - beforeLabel) + ' touch:' + (presses - afterLabelClick),
    );

    // TextInput
    const widthBefore = input.frame.width;
    onUIThread(() => Native.setTextInputTextByTag(surfaceId, input.tag, 'hello@example.com'));
    console.log('INPUT_AFTER_SET ' + JSON.stringify(find(tree(root), n => n.tag === input.tag).frame));
    onUIThread(() =>
      Native.enqueueNativeEventByTag(surfaceId, input.tag, 'change', {
        text: 'hello@example.com',
        eventCount: 1,
        target: input.tag,
      }),
    );
    t = tree(root);
    const inputAfter = find(t, n => n.tag === input.tag);
    console.log('CHANGES ' + JSON.stringify(changes));
    console.log(
      'INPUT ' + JSON.stringify({before: input, after: inputAfter, widthBefore}),
    );
    expect(changes).toEqual(['hello@example.com']);
    expect(inputAfter.text).toBe('hello@example.com');
    expect(inputAfter.frame.width).toBeGreaterThan(widthBefore);

    // ScrollView
    onUIThread(() => Native.enqueueScrollEventByTag(surfaceId, scroll.tag, {x: 0, y: 250}));
    t = tree(root);
    const scrollAfter = find(t, n => n.tag === scroll.tag);
    console.log('SCROLL ' + JSON.stringify({contentOffset: scrollAfter.contentOffset, scrolls}));
    expect(scrollAfter.contentOffset.y).toBe(250);
    expect(scrolls).toEqual([250]);

    // Unknown tag
    expect(() => Native.enqueueNativeEventByTag(surfaceId, 99999, 'click', {})).toThrow();

    expect(presses).toBeGreaterThanOrEqual(1);
  });
});
