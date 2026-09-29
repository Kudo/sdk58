import {NavigationContainer} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {Pressable, StyleSheet, Text, View} from 'react-native';

type StackParamList = {
  Home: undefined;
  Details: {id: number};
};

const Stack = createNativeStackNavigator<StackParamList>();

function HomeScreen({navigation}: NativeStackScreenProps<StackParamList, 'Home'>) {
  return (
    <View style={styles.screen}>
      <Text>Home screen</Text>
      <Pressable
        testID="go-details"
        role="button"
        style={styles.button}
        onPress={() => navigation.navigate('Details', {id: 42})}>
        <Text>Go to details</Text>
      </Pressable>
    </View>
  );
}

function DetailsScreen({
  navigation,
  route,
}: NativeStackScreenProps<StackParamList, 'Details'>) {
  return (
    <View style={styles.screen}>
      <Text testID="details-text">{`Details ${route.params.id}`}</Text>
      <Pressable
        testID="go-back"
        role="button"
        style={styles.button}
        onPress={() => navigation.goBack()}>
        <Text>Back</Text>
      </Pressable>
    </View>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} options={{title: 'Home'}} />
        <Stack.Screen
          name="Details"
          component={DetailsScreen}
          options={{title: 'Details'}}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  screen: {flex: 1, padding: 24, gap: 16},
  button: {padding: 12, backgroundColor: '#ddd'},
});
