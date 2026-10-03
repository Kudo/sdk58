import React from 'react';
import {Text, View} from 'react-native';

console.warn('[NATIVE_COMPONENT_FALLBACK] MapView: placeholder; map imagery and gestures are not simulated.');

export function Marker(props: {title?: string; testID?: string}) {
  return <Text testID={props.testID}>{props.title ?? 'Map marker'}</Text>;
}

export function MapView(props: {testID?: string; style?: object; children?: React.ReactNode; accessibilityLabel?: string}) {
  return <View testID={props.testID} style={props.style} accessibilityLabel={props.accessibilityLabel ?? 'Map content not simulated'}>
    <Text>Map content not simulated</Text>{props.children}
  </View>;
}

export default MapView;
