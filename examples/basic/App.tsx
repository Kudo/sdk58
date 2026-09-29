import {Image, Pressable, StyleSheet, Text, View} from 'react-native';

export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title} accessibilityRole="header">
        Sign in
      </Text>
      <Image
        style={styles.logo}
        source={{uri: 'https://example.com/logo.png', width: 64, height: 64}}
        accessibilityLabel="Company logo"
      />
      <Pressable
        style={styles.button}
        accessibilityRole="button"
        testID="submit"
        onPress={() => {}}>
        <Text style={styles.buttonLabel}>Submit</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 16,
  },
  logo: {
    width: 64,
    height: 64,
    marginBottom: 16,
  },
  button: {
    height: 48,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1e6fff',
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 16,
  },
});
