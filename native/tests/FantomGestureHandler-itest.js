/**
 * @flow
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {View} from 'react-native';
import NativeFantom from 'react-native/src/private/testing/fantom/specs/NativeFantom';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  useTapGesture,
  // $FlowFixMe[cannot-resolve-module]
} from 'react-native-gesture-handler';
// $FlowFixMe[cannot-resolve-module]
import RNGestureHandlerDetectorNativeComponent from 'react-native-gesture-handler/src/specs/RNGestureHandlerDetectorNativeComponent';

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

function strip(node: $FlowFixMe): $FlowFixMe {
  const {yogaStyle, layoutDirection, children, ...rest} = node;
  return {...rest, children: (children ?? []).map(strip)};
}

function dispatch(surfaceId: number, tag: number, type: string, payload: {...}) {
  Native.enqueueNativeEventByTag(surfaceId, tag, type, payload);
  NativeFantom.flushEventQueue();
  Fantom.runWorkLoop();
}

const State = {UNDETERMINED: 0, FAILED: 1, BEGAN: 2, CANCELLED: 3, ACTIVE: 4, END: 5};

describe('react-native-gesture-handler', () => {
  it('v3 GestureDetector with useTapGesture', () => {
    const calls: Array<string> = [];
    function App() {
      const tap = useTapGesture({
        onBegin: () => calls.push('begin'),
        onActivate: e => calls.push('activate ' + JSON.stringify(e)),
        onDeactivate: (e, success) => calls.push('deactivate ' + String(success)),
        onFinalize: () => calls.push('finalize'),
      });
      return (
        <GestureHandlerRootView style={{flex: 1}}>
          <GestureDetector gesture={tap}>
            <View testID="box" style={{width: 100, height: 100, margin: 20}} />
          </GestureDetector>
        </GestureHandlerRootView>
      );
    }
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const surfaceId = root.getRootTag();
    Fantom.runTask(() => root.render(<App />));
    NativeFantom.flushEventQueue();
    Fantom.runWorkLoop();

    const t = tree(root);
    const rootView = findAll(t, n => n.type === 'RNGestureHandlerRootView')[0];
    const detector = findAll(t, n => n.type === 'RNGestureHandlerDetector')[0];
    console.log('V3_TREE ' + JSON.stringify(strip(rootView)));
    expect(rootView.frame.width).toBe(390);
    expect(detector.frame).toEqual({x: 20, y: 20, width: 100, height: 100});
    expect(detector.handlerTags.length).toBe(1);
    const hit = JSON.parse(Native.hitTest(surfaceId, 70, 70));
    console.log('V3_HIT ' + JSON.stringify(hit));

    const handlerTag = detector.handlerTags[0];
    const handlerData = {numberOfPointers: 1, pointerType: 0, x: 50, y: 50, absoluteX: 70, absoluteY: 70};
    dispatch(surfaceId, detector.tag, 'gestureHandlerStateChange', {
      handlerTag,
      state: State.BEGAN,
      oldState: State.UNDETERMINED,
      handlerData,
    });
    dispatch(surfaceId, detector.tag, 'gestureHandlerStateChange', {
      handlerTag,
      state: State.ACTIVE,
      oldState: State.BEGAN,
      handlerData,
    });
    dispatch(surfaceId, detector.tag, 'gestureHandlerStateChange', {
      handlerTag,
      state: State.END,
      oldState: State.ACTIVE,
      handlerData,
    });
    console.log('V3_CALLS ' + JSON.stringify(calls));
    expect(calls[0]).toBe('begin');
    expect(calls.some(c => c.startsWith('activate'))).toBe(true);
    expect(calls.some(c => c.startsWith('deactivate'))).toBe(true);
    expect(calls).toContain('finalize');
  });

  it('delivers detector events to the native component props', () => {
    const received: Array<{name: string, nativeEvent: mixed}> = [];
    const record = (name: string) => (e: $FlowFixMe) =>
      received.push({name, nativeEvent: {...e.nativeEvent}});
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const surfaceId = root.getRootTag();
    Fantom.runTask(() =>
      root.render(
        <RNGestureHandlerDetectorNativeComponent
          handlerTags={[7]}
          moduleId={0}
          style={{display: 'contents'}}
          onGestureHandlerStateChange={record('onGestureHandlerStateChange')}
          onGestureHandlerEvent={record('onGestureHandlerEvent')}
          onGestureHandlerTouchEvent={record('onGestureHandlerTouchEvent')}>
          <View style={{width: 50, height: 50}} />
        </RNGestureHandlerDetectorNativeComponent>,
      ),
    );
    const detector = findAll(tree(root), n => n.type === 'RNGestureHandlerDetector')[0];
    dispatch(surfaceId, detector.tag, 'gestureHandlerStateChange', {
      handlerTag: 7,
      state: State.ACTIVE,
      oldState: State.BEGAN,
      handlerData: {numberOfPointers: 1, pointerType: 0, x: 1, y: 2, absoluteX: 3, absoluteY: 4},
    });
    dispatch(surfaceId, detector.tag, 'gestureHandlerEvent', {
      handlerTag: 7,
      state: State.ACTIVE,
      handlerData: {numberOfPointers: 1, pointerType: 0, x: 1, y: 2, absoluteX: 3, absoluteY: 4},
    });
    dispatch(surfaceId, detector.tag, 'gestureHandlerTouchEvent', {
      handlerTag: 7,
      state: State.ACTIVE,
      eventType: 1,
      numberOfTouches: 1,
      pointerType: 0,
      changedTouches: [{id: 0, x: 1, y: 2, absoluteX: 3, absoluteY: 4}],
      allTouches: [{id: 0, x: 1, y: 2, absoluteX: 3, absoluteY: 4}],
    });
    console.log('RECEIVED ' + JSON.stringify(received));
    expect(received.map(r => r.name)).toEqual([
      'onGestureHandlerStateChange',
      'onGestureHandlerEvent',
      'onGestureHandlerTouchEvent',
    ]);
    console.log('DETECTOR ' + JSON.stringify(strip(detector)));
  });

  it('legacy Gesture.Tap() with GestureDetector', () => {
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    Fantom.runTask(() =>
      root.render(
        <GestureHandlerRootView style={{flex: 1}}>
          <GestureDetector gesture={Gesture.Tap()}>
            <View style={{width: 100, height: 100}} />
          </GestureDetector>
        </GestureHandlerRootView>,
      ),
    );
    NativeFantom.flushEventQueue();
    Fantom.runWorkLoop();
    const rootView = findAll(tree(root), n => n.type === 'RNGestureHandlerRootView')[0];
    console.log('LEGACY_TREE ' + JSON.stringify(strip(rootView)));
    expect(rootView).toBeTruthy();
  });
});
