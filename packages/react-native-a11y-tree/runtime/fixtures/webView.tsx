import React from 'react';
import {Text, View} from 'react-native';

console.warn('[NATIVE_COMPONENT_FALLBACK] RNCWebView: placeholder; page content and navigation are not simulated.');

export function WebView(props: {testID?: string; style?: object; accessibilityLabel?: string}) {
  return <View testID={props.testID} style={props.style} accessibilityLabel={props.accessibilityLabel ?? 'WebView content not simulated'}>
    <Text>WebView content not simulated</Text>
  </View>;
}

export default WebView;
