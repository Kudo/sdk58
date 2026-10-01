import React, {useState} from 'react';
import {Pressable, Text, requireNativeComponent, type ViewProps} from 'react-native';

const UnavailableView = requireNativeComponent<ViewProps>('ExampleUnavailableView');
export default function Legacy() {
  const [pressed, setPressed] = useState(false);
  return <UnavailableView testID="legacy" style={{width: 200, height: 80}}>
    <Pressable testID="child-button" accessibilityRole="button" onPress={() => setPressed(true)} style={{width: 180, height: 48}}>
      <Text>{pressed ? 'Child pressed' : 'Press child'}</Text>
    </Pressable>
  </UnavailableView>;
}
