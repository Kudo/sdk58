import React, {useState} from 'react';
import {Pressable, Text, View} from 'react-native';
import {GlassContainer, GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable} from 'expo-glass-effect';
import {BlurView, BlurTargetView} from 'expo-blur';
import {LinearGradient} from 'expo-linear-gradient';

export default function App() {
  const [pressed, setPressed] = useState(false);
  return (
    <View style={{padding: 16}}>
      <Text testID="availability">{`${isLiquidGlassAvailable()}/${isGlassEffectAPIAvailable()}`}</Text>
      <GlassContainer testID="glass-container" spacing={12} style={{width: 240, height: 80}}>
        <GlassView testID="glass" glassEffectStyle="regular" tintColor="#abcdef" isInteractive colorScheme="dark" style={{width: 200, height: 64}}>
          <Pressable testID="glass-button" accessibilityRole="button" onPress={() => setPressed(true)} style={{width: 120, height: 48}}>
            <Text>{pressed ? 'Pressed through glass' : 'Press glass'}</Text>
          </Pressable>
        </GlassView>
      </GlassContainer>
      <BlurTargetView testID="blur-target" style={{width: 240, height: 64}}><Text>Blur target child</Text></BlurTargetView>
      <BlurView testID="blur" intensity={40} tint="dark" style={{width: 240, height: 64}}><Text>Blur child</Text></BlurView>
      <LinearGradient testID="gradient" colors={['#ff0000', '#0000ff']} style={{width: 240, height: 64}}><Text>Gradient child</Text></LinearGradient>
    </View>
  );
}
