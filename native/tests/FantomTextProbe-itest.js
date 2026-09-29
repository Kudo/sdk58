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

const LONG =
  'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump!';

function measure(name: string, element: React.Node, width: number = 300) {
  const root = Fantom.createRoot({viewportWidth: width, viewportHeight: 800});
  const ref = createRef<HostInstance>();
  Fantom.runTask(() => {
    root.render(
      <View style={{alignItems: 'flex-start'}}>
        {React.cloneElement(element as $FlowFixMe, {ref})}
      </View>,
    );
  });
  const rect = nullthrows(ref.current).getBoundingClientRect();
  const out = {x: rect.x, y: rect.y, width: rect.width, height: rect.height};
  console.log('PROBE ' + name + ' ' + JSON.stringify(out));
  return out;
}

describe('FantomTextProbe', () => {
  it('measures text', () => {
    const short16 = measure('short16', <Text style={{fontSize: 16}}>Hello world</Text>);
    const defaultSize = measure('default14', <Text>Hello world</Text>);
    const bold16 = measure(
      'bold16',
      <Text style={{fontSize: 16, fontWeight: 'bold'}}>Hello world</Text>,
    );
    const italic16 = measure(
      'italic16',
      <Text style={{fontSize: 16, fontStyle: 'italic'}}>Hello world</Text>,
    );
    const spaced16 = measure(
      'letterSpacing2_16',
      <Text style={{fontSize: 16, letterSpacing: 2}}>Hello world</Text>,
    );
    const long16 = measure('long16', <Text style={{fontSize: 16}}>{LONG}</Text>);
    const long16lh = measure(
      'long16_lineHeight24',
      <Text style={{fontSize: 16, lineHeight: 24}}>{LONG}</Text>,
    );
    const oneLine = measure(
      'long16_numberOfLines1',
      <Text style={{fontSize: 16}} numberOfLines={1}>
        {LONG}
      </Text>,
    );
    const twoLines = measure(
      'long16_numberOfLines2',
      <Text style={{fontSize: 16}} numberOfLines={2}>
        {LONG}
      </Text>,
    );
    measure(
      'georgia16',
      <Text style={{fontSize: 16, fontFamily: 'Georgia'}}>Hello world</Text>,
    );
    measure(
      'inlineView',
      <Text style={{fontSize: 16}}>
        Hi <View style={{width: 20, height: 10}} /> there
      </Text>,
    );

    expect(short16.height).toBeGreaterThan(0);
    expect(short16.width).toBeGreaterThan(0);
    expect(short16.width).toBeLessThan(300);
    expect(defaultSize.width).toBeLessThan(short16.width);
    expect(bold16.width).toBeGreaterThan(short16.width);
    expect(italic16.height).toBe(short16.height);
    expect(spaced16.width).toBeGreaterThan(short16.width);
    expect(long16.height).toBeGreaterThan(short16.height * 2);
    expect(long16.width).toBe(300);
    expect(long16lh.height).toBeGreaterThan(long16.height);
    expect(oneLine.height).toBe(short16.height);
    expect(twoLines.height).toBeGreaterThan(oneLine.height);
    expect(twoLines.height).toBeLessThan(long16.height);
  });

  it('lays out inline views', () => {
    const root = Fantom.createRoot({viewportWidth: 300, viewportHeight: 800});
    const inlineRef = createRef<HostInstance>();
    Fantom.runTask(() => {
      root.render(
        <View style={{alignItems: 'flex-start'}}>
          <Text style={{fontSize: 16}}>
            Hi{' '}
            <View
              ref={inlineRef}
              collapsable={false}
              style={{width: 20, height: 30, backgroundColor: 'red'}}
            />{' '}
            there
          </Text>
        </View>,
      );
    });
    const r = nullthrows(inlineRef.current).getBoundingClientRect();
    console.log(
      'PROBE inlineViewRect ' +
        JSON.stringify({x: r.x, y: r.y, width: r.width, height: r.height}),
    );
    console.log(
      'PROBE inlineViewTall ' +
        JSON.stringify(
          root.getRenderedOutput({includeLayoutMetrics: true, props: ['layoutMetrics-frame']}).toJSON(),
        ),
    );
  });
});
