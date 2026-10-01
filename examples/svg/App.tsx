import React from 'react';
import {Text, View} from 'react-native';
import Svg, {Circle, G, Rect} from 'react-native-svg';

export default function App() {
  return <View><Text testID="before">Before SVG</Text>
    <Svg testID="drawing" width={120} height={80} accessibilityRole="image" accessibilityLabel="Demo drawing">
      <G testID="shapes"><Circle testID="circle" cx={20} cy={20} r={10} fill="red" />
        <Circle cx={40} cy={20} r={10} fill="green" />
        <Rect testID="rectangle" x={60} y={10} width={20} height={30} fill="blue" /></G>
    </Svg><Text testID="after">After SVG</Text></View>;
}
