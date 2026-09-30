/**
 * @flow strict-local
 * @format
 */

import '@react-native/fantom/src/setUpDefaultReactNativeEnvironment';

import * as Fantom from '@react-native/fantom';
import * as React from 'react';
import {Image, Pressable, ScrollView, Switch, Text, TextInput, View} from 'react-native';
import NativeFantom from 'react-native/src/private/testing/fantom/specs/NativeFantom';

function getA11yTree(root: Fantom.Root, includeDebugProps?: boolean): $FlowFixMe {
  // $FlowFixMe[prop-missing] getA11yTree is registered natively, not in the codegen spec.
  const json: string = NativeFantom.getA11yTree(root.getRootTag(), includeDebugProps);
  return JSON.parse(json);
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

describe('getA11yTree', () => {
  it('dumps the shadow tree with accessibility info', () => {
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    Fantom.runTask(() => {
      root.render(
        <View style={{padding: 16, backgroundColor: '#fafafa'}}>
          <Text accessibilityRole="header" style={{fontSize: 24, fontWeight: 'bold'}}>
            Sign in
          </Text>
          <Image
            accessibilityLabel="Company logo"
            source={{uri: 'https://example.com/logo.png', width: 64, height: 64}}
            style={{width: 64, height: 64}}
          />
          <Pressable role="button" testID="submit" onPress={() => {}}>
            <Text>
              Continue <Text style={{fontWeight: 'bold'}}>now</Text>
            </Text>
          </Pressable>
        </View>,
      );
    });

    const tree = getA11yTree(root);
    console.log('A11Y_TREE ' + JSON.stringify(tree, null, 2));

    const header = find(tree, n => n.accessibilityRole === 'header');
    expect(header.type).toBe('Paragraph');
    expect(header.text).toBe('Sign in');
    expect(header.frame.height).toBeGreaterThan(0);

    const button = find(tree, n => n.testID === 'submit');
    expect(button.role).toBe('button');
    expect(button.type).toBe('View');
    // The nested Text stays under the Pressable's View (no promotion).
    expect(button.children[0].type).toBe('Paragraph');
    expect(button.children[0].text).toBe('Continue now');
    expect(typeof button.frame.width).toBe('number');

    const image = find(tree, n => n.type === 'Image');
    expect(image.accessibilityLabel).toBe('Company logo');

    const withDebug = getA11yTree(root, true);
    console.log(
      'A11Y_DEBUG_PROPS ' +
        JSON.stringify(find(withDebug, n => n.testID === 'submit').debugProps),
    );
  });

  it('dumps other components', () => {
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    Fantom.runTask(() => {
      root.render(
        <ScrollView horizontal contentOffset={{x: 5, y: 0}}>
          <TextInput placeholder="Email" defaultValue="a@b.c" editable={false} />
          <TextInput value="secret" secureTextEntry />
          <Switch value={true} accessibilityLabel="Remember me" />
          <View
            accessibilityState={{checked: true, expanded: false}}
            accessibilityValue={{min: 0, max: 10, now: 3}}
            accessibilityActions={[{name: 'activate'}, {name: 'increment'}]}
            importantForAccessibility="no-hide-descendants"
            accessibilityLiveRegion="polite"
            pointerEvents="box-none"
            nativeID="native-1"
            style={{
              opacity: 0.5,
              borderWidth: 2,
              borderColor: 'red',
              borderRadius: 4,
              transform: [{translateX: 10}],
              zIndex: 3,
              flexDirection: 'row',
              margin: 4,
              marginTop: 8,
              width: '50%',
              minHeight: 10,
              gap: 2,
            }}
          />
        </ScrollView>,
      );
    });
    console.log('A11Y_TREE2 ' + JSON.stringify(getA11yTree(root)));
  });

  it('reports capabilities', () => {
    // $FlowFixMe[prop-missing] registered natively, not in the codegen spec.
    const capabilities = JSON.parse(NativeFantom.getCapabilities());
    console.log('CAPABILITIES ' + JSON.stringify(capabilities));
    expect(capabilities).toContain('getA11yTree');
    expect(capabilities).toContain('getA11yTree.mounted');
  });

  it('reports shadow tree and mounted revisions, effectiveBackground', () => {
    const root = Fantom.createRoot({viewportWidth: 390, viewportHeight: 844});
    const surfaceId = root.getRootTag();
    const revisions = () => ({
      // $FlowFixMe[prop-missing] registered natively
      shadow: NativeFantom.getShadowTreeRevision(surfaceId),
      // $FlowFixMe[prop-missing] registered natively
      mounted: NativeFantom.getMountedRevision(surfaceId),
    });
    const r0 = revisions();
    Fantom.runTask(() => {
      root.render(
        <View style={{backgroundColor: 'rgba(0, 0, 255, 0.5)', padding: 10}}>
          <Text>Half blue</Text>
        </View>,
      );
    });
    const r1 = revisions();
    Fantom.runTask(() => {
      root.render(
        <View style={{backgroundColor: 'rgba(0, 0, 255, 0.5)', padding: 20}}>
          <Text>Half blue</Text>
        </View>,
      );
    });
    const r2 = revisions();
    const r3 = revisions();
    const tree = getA11yTree(root);
    const paragraph = find(tree, n => n.type === 'Paragraph');
    const view = find(tree, n => n.type === 'View');
    console.log('REVISIONS ' + JSON.stringify({r0, r1, r2, r3}));
    console.log(
      'EFFECTIVE ' +
        JSON.stringify({
          view: [view.backgroundColor, view.effectiveBackground],
          paragraph: paragraph.effectiveBackground,
        }),
    );
    expect(r2.shadow).toBeGreaterThan(r1.shadow);
    expect(r3).toEqual(r2);
    expect(r2.mounted).toBe(r2.shadow);
    expect(paragraph.effectiveBackground).toBe('rgba(127, 127, 255, 1)');
  });
});
