import {useState} from 'react';
import {Pressable, StyleSheet, Text, View} from 'react-native';
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import {runOnJS, runOnUI} from 'react-native-worklets';

function Button({testID, label, onPress}: {testID: string; label: string; onPress: () => void}) {
  return (
    <Pressable testID={testID} role="button" style={styles.button} onPress={onPress}>
      <Text>{label}</Text>
    </Pressable>
  );
}

export default function App() {
  const sv = useSharedValue(50);
  const tx = useSharedValue(0);
  const [showFade, setShowFade] = useState(false);
  const [label, setLabel] = useState('none');

  const boxStyle = useAnimatedStyle(() => ({width: sv.value}));
  const slideStyle = useAnimatedStyle(() => ({transform: [{translateX: tx.value}]}));

  return (
    <View style={styles.container}>
      <Animated.View testID="box" style={[styles.box, boxStyle]} />
      <Button testID="grow" label="Grow" onPress={() => (sv.value = withTiming(250, {duration: 400}))} />

      <Animated.View testID="slide" style={[styles.box, {width: 50}, slideStyle]} />
      <Button testID="slide-btn" label="Slide" onPress={() => (tx.value = withSpring(120))} />

      <Button testID="show" label="Show" onPress={() => setShowFade(true)} />
      {showFade ? (
        <Animated.View testID="fade" entering={FadeIn.duration(300)} style={styles.box} />
      ) : null}

      <Button
        testID="ui"
        label="UI roundtrip"
        onPress={() =>
          runOnUI(() => {
            'worklet';
            runOnJS(setLabel)('from-ui');
          })()
        }
      />
      <Text testID="label">{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 24, gap: 12},
  box: {height: 40, width: 50, backgroundColor: '#1e6fff'},
  button: {padding: 10, backgroundColor: '#ddd'},
});
