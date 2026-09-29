/**
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';
import './fantomReanimatedPrelude';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import NativeFantom from 'react-native/src/private/testing/fantom/specs/NativeFantom';

// The modules serialize worklets at import time, which creates WeakRefs; Fantom
// only allows that inside the event loop (runtime/patchWeakRef.js).
let Animated: $FlowFixMe;
let FadeIn: $FlowFixMe;
let useAnimatedStyle: $FlowFixMe;
let useSharedValue: $FlowFixMe;
let withTiming: $FlowFixMe;
let runOnJS: $FlowFixMe;
let runOnUI: $FlowFixMe;
function loadModules() {
  Fantom.runTask(() => {
    const Reanimated = require('react-native-reanimated');
    const Worklets = require('react-native-worklets');
    Animated = Reanimated.default;
    ({FadeIn, useAnimatedStyle, useSharedValue, withTiming} = Reanimated);
    ({runOnJS, runOnUI} = Worklets);
  });
}

function getA11yTree(root: Fantom.Root): $FlowFixMe {
  // $FlowFixMe[prop-missing] getA11yTree is registered natively.
  return JSON.parse(NativeFantom.getA11yTree(root.getRootTag()));
}

function find(node: $FlowFixMe, testID: string): $FlowFixMe {
  if (node.testID === testID) {
    return node;
  }
  for (const child of node.children ?? []) {
    const found = find(child, testID);
    if (found != null) {
      return found;
    }
  }
  return null;
}

function log(label: string, value: unknown) {
  console.log('REA ' + label + ' ' + JSON.stringify(value));
}

describe('reanimated in Fantom', () => {
  beforeAll(loadModules);

  it('(a) withTiming drives width in the shadow tree', () => {
    let widthSV: $FlowFixMe = null;
    function Box() {
      const width = useSharedValue(0);
      widthSV = width;
      const style = useAnimatedStyle(() => ({width: width.value}));
      return <Animated.View testID="box" style={[{height: 10}, style]} />;
    }

    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    Fantom.runTask(() => {
      root.render(<Box />);
    });
    const w0 = find(getA11yTree(root), 'box').frame.width;

    Fantom.runTask(() => {
      widthSV.value = withTiming(200, {duration: 300});
    });
    const wStart = find(getA11yTree(root), 'box').frame.width;

    Fantom.unstable_produceFramesForDuration(150);
    const w150 = find(getA11yTree(root), 'box').frame.width;

    Fantom.unstable_produceFramesForDuration(200);
    const w350 = find(getA11yTree(root), 'box').frame.width;
    log('a', {w0, wStart, w150, w350});

    expect(w0).toBe(0);
    expect(w150).toBeGreaterThan(50);
    expect(w150).toBeLessThan(150);
    expect(w350).toBe(200);
    root.destroy();
  });

  it('(b) useAnimatedStyle transform from a shared value set in JS', () => {
    let txSV: $FlowFixMe = null;
    function Box() {
      const tx = useSharedValue(0);
      txSV = tx;
      const style = useAnimatedStyle(() => ({
        transform: [{translateX: tx.value}],
      }));
      return (
        <Animated.View testID="moved" style={[{width: 10, height: 10}, style]} />
      );
    }

    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    Fantom.runTask(() => {
      root.render(<Box />);
    });
    const before = find(getA11yTree(root), 'moved').transform ?? null;

    Fantom.runTask(() => {
      txSV.value = 42;
    });
    const after = find(getA11yTree(root), 'moved').transform;
    log('b', {before, after});

    expect(after[12]).toBe(42);
    root.destroy();
  });

  it('(c) entering={FadeIn} layout animation', () => {
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const opacity = () => {
      const output = root.getRenderedOutput({props: ['opacity']}).toJSON();
      return output?.props?.opacity ?? null;
    };
    Fantom.runTask(() => {
      root.render(
        <Animated.View
          testID="fade"
          entering={FadeIn}
          style={{width: 10, height: 10}}
        />,
      );
    });
    const o0 = opacity();
    const node0 = find(getA11yTree(root), 'fade');
    Fantom.unstable_produceFramesForDuration(150);
    const o150 = opacity();
    const node150 = find(getA11yTree(root), 'fade');
    Fantom.unstable_produceFramesForDuration(1000);
    const oEnd = opacity();
    const nodeEnd = find(getA11yTree(root), 'fade');
    const shadowOpacity = nodeEnd.opacity ?? 1;
    log('c', {
      o0,
      o150,
      oEnd,
      shadowOpacity,
      mounted0: node0.mounted,
      mounted150: node150.mounted,
      opacity150: node150.opacity,
      mountedEnd: nodeEnd.mounted,
    });

    expect(oEnd == null || oEnd === 1).toBe(true);
    expect(shadowOpacity).toBe(1);
    // getA11yTree reports the mounted values that differ from the shadow tree.
    expect(node150.opacity ?? 1).toBe(1);
    expect(node150.mounted?.opacity).toBeCloseTo(0.5, 1);
    expect(nodeEnd.mounted).toBeUndefined();
    root.destroy();
  });

  it('(d) runOnUI runs a worklet and runOnJS calls back', () => {
    let result: ?number = null;
    const setResult = (value: number) => {
      result = value;
    };
    Fantom.runTask(() => {
      // No Flow annotations inside worklets: the worklets plugin runs before
      // Flow types are stripped and re-parses the function source.
      // $FlowFixMe[missing-local-annot]
      runOnUI(x => {
        'worklet';
        // $FlowFixMe[prop-missing]
        runOnJS(setResult)(x * 2 + (globalThis._WORKLET === true ? 1 : 0));
      })(20);
    });
    log('d', {result});
    expect(result).toBe(41);
  });

  it('(e) frames + mocked timers advanced together (as the CLI wait action)', () => {
    // $FlowFixMe[prop-missing]
    expect(typeof globalThis.__reanimatedModuleProxy).toBe('object');
    let widthSV: $FlowFixMe = null;
    function Box() {
      const width = useSharedValue(0);
      widthSV = width;
      const style = useAnimatedStyle(() => ({width: width.value}));
      return <Animated.View testID="timed" style={[{height: 10}, style]} />;
    }
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    Fantom.runTask(() => {
      root.render(<Box />);
    });
    const timers = Fantom.installTimerMock();
    let fired: ?number = null;
    Fantom.runTask(() => {
      widthSV.value = withTiming(200, {duration: 300});
      setTimeout(() => {
        fired = find(getA11yTree(root), 'timed').frame.width;
      }, 150);
    });
    // runtime/actions.js advance(): produceFramesForDuration + advanceTimersByTime per slice.
    const advance = (ms: number) => {
      for (let remaining = ms; remaining > 0; remaining -= 16) {
        const slice = Math.min(16, remaining);
        Fantom.unstable_produceFramesForDuration(slice);
        timers.advanceTimersByTime(slice);
      }
    };
    advance(150);
    const w150 = find(getA11yTree(root), 'timed').frame.width;
    advance(200);
    const w350 = find(getA11yTree(root), 'timed').frame.width;
    timers.uninstall();
    log('e', {fired, w150, w350});
    expect(w150).toBeGreaterThan(50);
    expect(w150).toBeLessThan(150);
    expect(fired).toBe(w150);
    expect(w350).toBe(200);
    root.destroy();
  });
});
