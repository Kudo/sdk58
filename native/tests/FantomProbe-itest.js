/**
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';

describe('FantomProbe', () => {
  it('lays out a View', () => {
    const root = Fantom.createRoot({viewportWidth: 200, viewportHeight: 600});
    const ref = createRef<HostInstance>();
    Fantom.runTask(() => {
      root.render(<View ref={ref} collapsable={false} style={{width: '50%', height: '10%'}} />);
    });
    const rect = nullthrows(ref.current).getBoundingClientRect();
    console.log(
      'PROBE_VIEW_RECT ' +
        JSON.stringify({x: rect.x, y: rect.y, width: rect.width, height: rect.height}),
    );
    console.log(
      'PROBE_VIEW_JSON ' +
        JSON.stringify(
          root.getRenderedOutput({includeLayoutMetrics: true}).toJSON(),
        ),
    );
    console.log(
      'PROBE_VIEW_JSON_ROOT ' +
        JSON.stringify(
          root
            .getRenderedOutput({includeLayoutMetrics: true, includeRoot: true})
            .toJSON(),
        ),
    );
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(60);
  });

  it('lays out a Text', () => {
    const root = Fantom.createRoot({viewportWidth: 200, viewportHeight: 600});
    const ref = createRef<HostInstance>();
    Fantom.runTask(() => {
      root.render(
        <View>
          <Text ref={ref} style={{fontSize: 20}}>Hello Fantom world</Text>
        </View>,
      );
    });
    const rect = nullthrows(ref.current).getBoundingClientRect();
    console.log(
      'PROBE_TEXT_RECT ' +
        JSON.stringify({x: rect.x, y: rect.y, width: rect.width, height: rect.height}),
    );
    console.log(
      'PROBE_TEXT_JSON ' +
        JSON.stringify(
          root.getRenderedOutput({includeLayoutMetrics: true}).toJSON(),
        ),
    );
  });
});
