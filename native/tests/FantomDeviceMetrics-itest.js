/**
 * @flow
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Dimensions, PixelRatio, Text, useWindowDimensions} from 'react-native';
import NativeFantom from 'react-native/src/private/testing/fantom/specs/NativeFantom';

// $FlowFixMe[unclear-type] registered natively, not in the codegen spec.
const Native: any = NativeFantom;

function settle() {
  for (let i = 0; i < 3; i++) {
    NativeFantom.flushEventQueue();
    Fantom.runWorkLoop();
  }
}

describe('DeviceInfo metrics (Dimensions, PixelRatio)', () => {
  it('follows the surface by default and setDeviceMetrics afterwards', () => {
    expect(JSON.parse(Native.getCapabilities())).toContain('deviceMetrics');

    // Default: the started surface (viewport, devicePixelRatio 3 in Fantom).
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    settle();
    const seen: Array<$FlowFixMe> = [];
    function Probe() {
      const window = useWindowDimensions();
      seen.push({width: window.width, height: window.height, scale: window.scale, fontScale: window.fontScale});
      return <Text>probe</Text>;
    }
    Fantom.runTask(() => {
      root.render(<Probe />);
    });
    settle();
    const initial = Dimensions.get('window');
    console.log('DIMS_DEFAULT ' + JSON.stringify({window: initial, screen: Dimensions.get('screen'), ratio: PixelRatio.get()}));
    expect(initial.width).toBe(390);
    expect(initial.height).toBe(844);
    expect(initial.scale).toBe(3);
    expect(initial.fontScale).toBe(1);
    expect(PixelRatio.get()).toBe(3);

    // setDeviceMetrics: didUpdateDimensions re-renders useWindowDimensions users.
    Native.setDeviceMetrics({width: 412, height: 915, scale: 2.625, fontScale: 1.3});
    settle();
    const updated = Dimensions.get('window');
    console.log('DIMS_SET ' + JSON.stringify({window: updated, screen: Dimensions.get('screen'), ratio: PixelRatio.get(), fontScale: PixelRatio.getFontScale(), seen}));
    expect(updated).toEqual({width: 412, height: 915, scale: 2.625, fontScale: 1.3});
    expect(Dimensions.get('screen')).toEqual({width: 412, height: 915, scale: 2.625, fontScale: 1.3});
    expect(PixelRatio.get()).toBe(2.625);
    expect(PixelRatio.getFontScale()).toBe(1.3);
    expect(seen[seen.length - 1]).toEqual({width: 412, height: 915, scale: 2.625, fontScale: 1.3});

    // A later surface does not override explicit metrics.
    const other = Fantom.createRoot({viewportWidth: 200, viewportHeight: 300});
    settle();
    expect(Dimensions.get('window').width).toBe(412);
    other.destroy();
    root.destroy();
  });
});
