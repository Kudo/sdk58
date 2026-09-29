/**
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Switch, TextInput, View} from 'react-native';
import NativeFantom from 'react-native/src/private/testing/fantom/specs/NativeFantom';

function getA11yTree(root: Fantom.Root): $FlowFixMe {
  // $FlowFixMe[prop-missing] registered natively, not in the codegen spec.
  return JSON.parse(NativeFantom.getA11yTree(root.getRootTag(), false));
}

function strip(node: $FlowFixMe): $FlowFixMe {
  const {children, yogaStyle, layoutDirection, ...rest} = node;
  return {...rest, children: (children ?? []).map(strip)};
}

describe('TextInput and Switch', () => {
  it('measures TextInput and sizes Switch', () => {
    const root = Fantom.createRoot({viewportWidth: 300, viewportHeight: 800});
    Fantom.runTask(() => {
      root.render(
        <View style={{alignItems: 'flex-start'}}>
          <TextInput placeholder="Email" defaultValue="a@b.c" style={{fontSize: 16}} />
          <TextInput placeholder="Password" secureTextEntry style={{fontSize: 16}} />
          <TextInput
            multiline
            value={'line one\nline two\nline three'}
            style={{fontSize: 16, width: 200}}
          />
          <TextInput placeholder="Stretched" style={{fontSize: 16, alignSelf: 'stretch', padding: 8}} />
          <TextInput editable={false} value="read only" />
          <Switch value />
          <Switch value={false} disabled />
          <Switch value style={{width: 80, height: 40}} />
        </View>,
      );
    });
    const tree = getA11yTree(root);
    console.log('INPUTS ' + JSON.stringify(strip(tree.children[0]).children));
    const [email, password, multi, stretched, readOnly, sw, swOff, swSized] =
      tree.children[0].children;
    expect(email.type).toBe('AndroidTextInput');
    expect(email.frame.height).toBeGreaterThan(15);
    expect(email.frame.width).toBeGreaterThan(0);
    expect(password.secureTextEntry).toBe(true);
    expect(multi.frame.height).toBeGreaterThan(email.frame.height * 2);
    expect(stretched.frame.width).toBe(300);
    expect(readOnly.editable).toBe(false);
    expect(sw.type).toBe('AndroidSwitch');
    expect(sw.value).toBe(true);
    expect(sw.frame.width).toBe(51);
    expect(sw.frame.height).toBe(31);
    expect(swOff.value).toBe(false);
    expect(swSized.frame.width).toBe(80);
  });
});
