import {Button, Column, Host, Switch, Text} from '@expo/ui';
import {useState} from 'react';
import {Text as RNText, View} from 'react-native';

/** Universal @expo/ui (Compose views with --platform android). */
export default function UniversalScreen() {
  const [pressed, setPressed] = useState(false);
  const [remember, setRemember] = useState(true);
  const [taps, setTaps] = useState(0);
  return (
    <View style={{flex: 1, padding: 16}}>
      <Host matchContents>
        <Column spacing={8}>
          <Text testID="greeting" onPress={() => setTaps(n => n + 1)}>
            Hello
          </Text>
          <Button testID="go" label="Go" onPress={() => setPressed(true)} />
          <Switch testID="remember" value={remember} onValueChange={setRemember} label="Remember" />
        </Column>
      </Host>
      <RNText testID="status">{pressed ? 'Pressed' : 'Idle'}</RNText>
      <RNText testID="remember-state">{remember ? 'Remember: on' : 'Remember: off'}</RNText>
      <RNText testID="taps">{`Taps: ${taps}`}</RNText>
    </View>
  );
}
