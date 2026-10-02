import {requireOptionalNativeModule} from 'expo';
import {Image} from 'expo-image';
import {useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';

const optional = requireOptionalNativeModule('ExampleUnavailableOptionalModule');
export default function App() {
  const [result, setResult] = useState('Not loaded');
  const insets = useSafeAreaInsets();
  return <View>
    <Text testID="optional">{optional === null ? 'Optional module unavailable' : 'Unexpected module'}</Text>
    <Text testID="insets">{JSON.stringify(insets)}</Text>
    <Image testID="image" accessible accessibilityRole="image" accessibilityLabel="Expo logo" source={require('../sdk58-default/assets/images/expo-logo.png')} style={{width: 120, height: 80}} contentFit="contain" />
    <Pressable testID="load-image" accessibilityRole="button" onPress={async () => {
      try {await Image.loadAsync('https://example.com/image.png'); setResult('Unexpected success');}
      catch (error) {setResult((error as Error).message);}
    }}><Text>Load image</Text></Pressable>
    <Text testID="result">{result}</Text>
  </View>;
}
