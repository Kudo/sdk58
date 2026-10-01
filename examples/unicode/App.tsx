import {StyleSheet, Text, View} from 'react-native';

// The Unicode and locale functions that Hermes implements with the platform
// (CoreFoundation on macOS, ICU elsewhere). One Text per call.
const values: Array<[string, string]> = [
  ['locale-compare', `localeCompare ${'a'.localeCompare('b')} ${'b'.localeCompare('a')} ${'é'.localeCompare('é')}`],
  ['date', `date ${new Date(0).toLocaleDateString('en-US', {timeZone: 'UTC'})}`],
  ['number', `number ${(1234.5).toLocaleString('en-US')}`],
  ['lower', `lower ${[...'İ'.toLowerCase()].map(c => c.codePointAt(0)?.toString(16)).join(' ')}`],
  ['upper', `upper ${'ß'.toUpperCase()}`],
  ['nfd', `nfd ${'é'.normalize('NFD').length} nfc ${'é'.normalize('NFC').length} nfkc ${'ﬁ'.normalize('NFKC')}`],
];

export default function App() {
  return (
    <View style={styles.container}>
      {values.map(([id, text]) => (
        <Text key={id} testID={id}>
          {text}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, padding: 24},
});
