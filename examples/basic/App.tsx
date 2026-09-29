import {useState} from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';

export default function App() {
  const [remember, setRemember] = useState(true);
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);

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
      <TextInput
        placeholder="Email"
        testID="email"
        style={{fontSize: 16, borderWidth: 1, padding: 8, marginBottom: 16}}
        onChangeText={setEmail}
      />
      {email !== '' ? <Text testID="echo">{email}</Text> : null}
      <Switch
        value={remember}
        onValueChange={setRemember}
        testID="remember"
        accessibilityLabel="Remember me"
        style={styles.switch}
      />
      <Pressable
        style={styles.button}
        role="button"
        testID="submit"
        onPress={() => setSubmitted(true)}>
        <Text style={styles.buttonLabel}>Submit</Text>
      </Pressable>
      {submitted ? <Text testID="status">Submitted</Text> : null}
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
  switch: {
    // Without this, the column layout stretches the Switch to full width.
    alignSelf: 'flex-start',
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
