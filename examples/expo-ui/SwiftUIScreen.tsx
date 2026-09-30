import {Button, Host, Text, Toggle, VStack} from '@expo/ui/swift-ui';
import {accessibilityLabel, frame, onTapGesture, padding} from '@expo/ui/swift-ui/modifiers';
import {useState} from 'react';
import {Text as RNText, View} from 'react-native';

/** @expo/ui/swift-ui (SwiftUI views on any bundle platform). */
export default function SwiftUIScreen() {
  const [pressed, setPressed] = useState(false);
  const [remember, setRemember] = useState(true);
  const [taps, setTaps] = useState(0);
  return (
    <View style={{flex: 1, padding: 16}}>
      <Host matchContents>
        <VStack spacing={8} modifiers={[padding({all: 8})]}>
          <Text
            testID="greeting"
            modifiers={[accessibilityLabel('Greeting'), onTapGesture(() => setTaps(n => n + 1))]}>
            Hello
          </Text>
          <Button testID="go" label="Go" onPress={() => setPressed(true)} modifiers={[frame({height: 44})]} />
          <Toggle testID="remember" isOn={remember} onIsOnChange={setRemember} label="Remember" />
        </VStack>
      </Host>
      <RNText testID="status">{pressed ? 'Pressed' : 'Idle'}</RNText>
      <RNText testID="remember-state">{remember ? 'Remember: on' : 'Remember: off'}</RNText>
      <RNText testID="taps">{`Taps: ${taps}`}</RNText>
    </View>
  );
}
