/**
 * @flow strict-local
 * @format
 */

// The embedded Roboto (native/fonts/roboto, FANTOM_WITH_EMBEDDED_FONTS): React
// Native text with `fontFamily: "Roboto"` is measured with Android's font, not
// the macOS system font. CoreText advances of "Hello world" at 14 pt: Roboto
// Regular 70.226, Roboto Medium 70.875, the system font 72.338.

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import type {HostInstance} from 'react-native';

import * as Fantom from '@react-native/fantom';
import nullthrows from 'nullthrows';
import * as React from 'react';
import {createRef} from 'react';
import {Text, View} from 'react-native';

function width(element: React.Node): number {
  const root = Fantom.createRoot({viewportWidth: 300, viewportHeight: 800});
  const ref = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      <View style={{alignItems: 'flex-start'}}>
        {React.cloneElement(element as $FlowFixMe, {ref})}
      </View>,
    );
  });
  const w = nullthrows(ref.current).getBoundingClientRect().width;
  root.destroy();
  return w;
}

describe('FantomRoboto', () => {
  it('measures fontFamily "Roboto" with the embedded font', () => {
    // The system font first: the fonts register on the first "Roboto" lookup.
    const system = width(<Text style={{fontSize: 14}}>Hello world</Text>);
    const regular = width(
      <Text style={{fontFamily: 'Roboto', fontSize: 14}}>Hello world</Text>,
    );
    const medium = width(
      <Text style={{fontFamily: 'Roboto', fontSize: 14, fontWeight: '500'}}>
        Hello world
      </Text>,
    );
    console.log('PROBE roboto ' + JSON.stringify({regular, medium, system}));
    // Text sizes round up to the pixel grid.
    expect(regular).toBeGreaterThanOrEqual(70.2);
    expect(regular).toBeLessThanOrEqual(71);
    expect(medium).toBeGreaterThanOrEqual(70.8);
    expect(medium).toBeLessThanOrEqual(71.5);
    expect(system).toBeGreaterThan(72);
  });
});
