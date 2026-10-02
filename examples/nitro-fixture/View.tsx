import React, {useState} from 'react';
import {Pressable, Text, View, type ViewProps} from 'react-native';
import {NitroImage, type NitroImageProps} from 'react-native-nitro-image';
import {callback} from 'react-native-nitro-modules';

export default function NitroViewExample() {
  const [pressed, setPressed] = useState(false);
  const [nativeRef, setNativeRef] = useState(false);
  return <View style={{padding: 24, gap: 12}}>
    <Text accessibilityRole="header">Nitro Image: explicit View fallback</Text>
    {React.createElement(NitroImage, {
      testID: 'nitro-image', accessibilityLabel: 'Fixture image container',
      image: {filePath: '/explicit-fixture/image.png'},
      style: {width: 160, height: 96},
      hybridRef: callback(() => setNativeRef(true)),
    } as NitroImageProps & ViewProps, <Pressable testID="image-child" accessibilityRole="button" style={{width: 140, height: 48}} onPress={() => setPressed(true)}><Text>Press fallback child</Text></Pressable>)}
    <Text testID="child-status">{pressed ? 'Child pressed' : 'Child untouched'}</Text>
    <Text testID="ref-status">{nativeRef ? 'Native hybrid ref delivered' : 'No native hybrid ref'}</Text>
  </View>;
}
