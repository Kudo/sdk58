// A medium-size screen for performance measurements (docs/perf-analysis.md):
// native stack with 2 screens, safe area, a FlatList of 60 cards, a form,
// a Reanimated pan box and a footer. About 600-1000 shadow nodes.
import {NavigationContainer} from '@react-navigation/native';
import {
  createNativeStackNavigator,
  type NativeStackScreenProps,
} from '@react-navigation/native-stack';
import {useState} from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import {Gesture, GestureDetector, GestureHandlerRootView} from 'react-native-gesture-handler';
import Animated, {useAnimatedStyle, useSharedValue} from 'react-native-reanimated';
import {SafeAreaProvider} from 'react-native-safe-area-context';

type StackParamList = {Home: undefined; Settings: undefined};
const Stack = createNativeStackNavigator<StackParamList>();

const CARDS = Array.from({length: 60}, (_, i) => ({
  id: String(i),
  title: `Card ${i}`,
  subtitle: `Subtitle for card number ${i}, with some longer text to wrap`,
}));

function Card({item, onOpen}: {item: (typeof CARDS)[number]; onOpen: (id: string) => void}) {
  const index = Number(item.id);
  const [enabled, setEnabled] = useState(index % 2 === 0);
  return (
    <View style={styles.card} testID={`card-${item.id}`}>
      <Image
        style={styles.thumb}
        source={{uri: `https://example.com/img/${item.id}.png`, width: 48, height: 48}}
        accessibilityLabel={`Image for ${item.title}`}
      />
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle}>{item.title}</Text>
        <Text style={styles.cardSubtitle} numberOfLines={2}>
          {item.subtitle}
        </Text>
        <View style={styles.badges}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{index % 3 === 0 ? 'new' : 'seen'}</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{`${index * 7} views`}</Text>
          </View>
        </View>
      </View>
      <Pressable
        testID={`open-${item.id}`}
        role="button"
        accessibilityLabel={`Open ${item.title}`}
        accessibilityHint="Opens the details"
        style={styles.smallButton}
        onPress={() => onOpen(item.id)}>
        <Text>Open</Text>
      </Pressable>
      {index % 5 === 0 ? (
        <Switch
          testID={`switch-${item.id}`}
          accessibilityLabel={`Enable ${item.title}`}
          value={enabled}
          onValueChange={setEnabled}
        />
      ) : null}
    </View>
  );
}

function Form() {
  const [name, setName] = useState('');
  const [notify, setNotify] = useState(true);
  const [dark, setDark] = useState(false);
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Profile
      </Text>
      <TextInput testID="name" placeholder="Name" style={styles.input} onChangeText={setName} />
      <TextInput testID="email" placeholder="Email" style={styles.input} />
      <TextInput testID="city" placeholder="City" style={styles.input} />
      <View style={styles.row}>
        <Text>Notifications</Text>
        <Switch testID="notify" accessibilityLabel="Notifications" value={notify} onValueChange={setNotify} />
      </View>
      <View style={styles.row}>
        <Text>Dark mode</Text>
        <Switch testID="dark" accessibilityLabel="Dark mode" value={dark} onValueChange={setDark} />
      </View>
      <Text testID="name-echo">{name === '' ? 'no name' : `Hello ${name}`}</Text>
    </View>
  );
}

function PanBox() {
  const tx = useSharedValue(0);
  const pan = Gesture.Pan().onUpdate(e => {
    tx.value = e.translationX;
  });
  const style = useAnimatedStyle(() => ({transform: [{translateX: tx.value}]}));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View testID="pan-box" style={[styles.panBox, style]} />
    </GestureDetector>
  );
}

function HomeScreen({navigation}: NativeStackScreenProps<StackParamList, 'Home'>) {
  const [opened, setOpened] = useState('none');
  return (
    <FlatList
      testID="list"
      data={CARDS}
      initialNumToRender={60}
      keyExtractor={item => item.id}
      ListHeaderComponent={
        <View>
          <Pressable
            testID="go-settings"
            role="button"
            style={[styles.smallButton, {margin: 16}]}
            onPress={() => navigation.navigate('Settings')}>
            <Text>Settings</Text>
          </Pressable>
          <Form />
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Drag me
            </Text>
            <PanBox />
          </View>
          <Text testID="opened" style={styles.section}>{`opened ${opened}`}</Text>
        </View>
      }
      renderItem={({item}) => <Card item={item} onOpen={setOpened} />}
      ListFooterComponent={
        <View style={styles.footer}>
          {['Help', 'Terms', 'Privacy', 'About'].map(label => (
            <Pressable key={label} role="button" style={styles.smallButton} onPress={() => {}}>
              <Text>{label}</Text>
            </Pressable>
          ))}
          <Pressable role="button" style={styles.smallButton} onPress={() => {}}>
            <Text>Contact</Text>
          </Pressable>
        </View>
      }
    />
  );
}

function SettingsScreen({navigation}: NativeStackScreenProps<StackParamList, 'Settings'>) {
  return (
    <View style={styles.section}>
      <Text testID="settings-text">Settings screen</Text>
      <Pressable testID="settings-back" role="button" style={styles.smallButton} onPress={() => navigation.goBack()}>
        <Text>Back</Text>
      </Pressable>
    </View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen name="Home" component={HomeScreen} options={{title: 'Medium app'}} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{title: 'Settings'}} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
  section: {padding: 16, gap: 8},
  sectionTitle: {fontSize: 20, fontWeight: '700'},
  input: {borderWidth: 1, borderColor: '#ccc', padding: 8, fontSize: 16},
  row: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  panBox: {width: 80, height: 80, backgroundColor: '#1e6fff'},
  card: {flexDirection: 'row', alignItems: 'center', padding: 12, gap: 12, borderBottomWidth: 1, borderColor: '#eee'},
  thumb: {width: 48, height: 48, borderRadius: 8},
  cardBody: {flex: 1},
  cardTitle: {fontSize: 16, fontWeight: '600'},
  cardSubtitle: {fontSize: 13, color: '#666'},
  badges: {flexDirection: 'row', gap: 4, marginTop: 4},
  badge: {paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#f0f0f0'},
  badgeText: {fontSize: 11},
  smallButton: {paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#eee', borderRadius: 6},
  footer: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 16},
});
