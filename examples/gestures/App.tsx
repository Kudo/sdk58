import {useState} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  RectButton,
} from 'react-native-gesture-handler';
import Animated, {useAnimatedStyle, useSharedValue} from 'react-native-reanimated';
import {runOnJS} from 'react-native-worklets';

export default function App() {
  const [tapOut, setTapOut] = useState('none');
  const [longOut, setLongOut] = useState('none');
  const [rectOut, setRectOut] = useState('none');
  const [pos, setPos] = useState(0);
  const [uiTapped, setUiTapped] = useState('none');
  const tx = useSharedValue(0);

  // JS callbacks (runOnJS(true)): no worklets needed. v2 API (Gesture.*).
  const tap = Gesture.Tap()
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (success) setTapOut('tapped');
    });
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onUpdate(e => setPos(Math.round(e.translationX)));
  const longPress = Gesture.LongPress()
    .runOnJS(true)
    .onStart(() => setLongOut('long-pressed'));
  // Worklet callbacks (no runOnJS(true)): the handlers run on the UI
  // runtime through Reanimated (ActionType.REANIMATED_WORKLET).
  const uiPan = Gesture.Pan().onUpdate(e => {
    tx.value = e.translationX;
  });
  const uiTap = Gesture.Tap().onEnd(() => {
    runOnJS(setUiTapped)('ui-tapped');
  });
  const uiStyle = useAnimatedStyle(() => ({transform: [{translateX: tx.value}]}));

  return (
    <GestureHandlerRootView style={styles.root}>
      <GestureDetector gesture={Gesture.Race(pan, longPress, tap)}>
        <View testID="drag" style={[styles.box, {left: pos}]} />
      </GestureDetector>
      <Text testID="tap-out">{tapOut}</Text>
      <Text testID="long-out">{longOut}</Text>
      <Text testID="pos-out">{`pos ${pos}`}</Text>
      {/* v3 NativeDetector + Native gesture on RNGestureHandlerButton. */}
      <RectButton testID="rect" style={styles.button} onPress={() => setRectOut('rect-pressed')}>
        <Text>Rect button</Text>
      </RectButton>
      <Text testID="rect-out">{rectOut}</Text>
      <GestureDetector gesture={Gesture.Race(uiPan, uiTap)}>
        <Animated.View testID="drag-ui" style={[styles.box, uiStyle]} />
      </GestureDetector>
      <Text testID="ui-tap-out">{uiTapped}</Text>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, padding: 24, gap: 12},
  box: {width: 120, height: 120, backgroundColor: '#1e6fff'},
  button: {height: 48, justifyContent: 'center', paddingHorizontal: 16, backgroundColor: '#ddd'},
});
