import React, {type PropsWithChildren} from 'react';
import {Pressable, Text, View} from 'react-native';
import {ExpoRoot, router, usePathname} from 'expo-router';
import {ctx} from 'expo-router/_ctx';

// These controls exercise Router state, not the platform's native tab bar.
// All upstream routes, including the root layout and NativeTabs, stay intact.
function NavigationProbe({children}: PropsWithChildren) {
  const pathname = usePathname();
  return <View style={{flex: 1}}>
    <Text testID="router-pathname">{pathname}</Text>
    <Pressable testID="router-explore" accessibilityRole="button" onPress={() => router.navigate('/explore')}>
      <Text>Harness: navigate Explore</Text>
    </Pressable>
    <Pressable testID="router-home" accessibilityRole="button" onPress={() => router.navigate('/')}>
      <Text>Harness: navigate Home</Text>
    </Pressable>
    {children}
  </View>;
}

export default function RouterApp() {
  return <ExpoRoot context={ctx} location="/" wrapper={NavigationProbe} />;
}
