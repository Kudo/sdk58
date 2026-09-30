import {Dimensions, PixelRatio, StyleSheet, Text, useWindowDimensions, View} from 'react-native';

// Read at import time, like many apps do.
const screenAtImport = Dimensions.get('screen');

/** Dimensions and PixelRatio as the app sees them (--preset, --scale, --font-scale). */
export default function App() {
  const window = useWindowDimensions();
  return (
    <View style={styles.container}>
      <Text testID="window">{`window ${window.width}x${window.height} scale ${window.scale} fontScale ${window.fontScale}`}</Text>
      <Text testID="screen">{`screen ${screenAtImport.width}x${screenAtImport.height}`}</Text>
      <Text testID="pixel-ratio">{`pixelRatio ${PixelRatio.get()} fontScale ${PixelRatio.getFontScale()}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 24},
});
