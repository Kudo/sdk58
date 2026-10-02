import React, {useState} from 'react';
import {Pressable, Text, TextInput, View} from 'react-native';
import {createMMKV} from 'react-native-mmkv';

// The real package calls the explicit MMKVFactory / MMKVPlatformContext
// fixtures. Its built-in Jest mock would use a different default storage id.
const storage = createMMKV();
export default function App() {
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('Ready');
  return <View style={{padding: 24, gap: 12}}>
    <Text accessibilityRole="header">MMKV through explicit Nitro fixtures</Text>
    <Text testID="storage-id">{storage.id}</Text>
    <TextInput testID="note" accessibilityLabel="Note" value={note} onChangeText={setNote} style={{height: 48}} />
    <Pressable testID="save" accessibilityRole="button" onPress={() => {storage.set('note', note); setStatus('Saved');}}><Text>Save</Text></Pressable>
    <Pressable testID="load" accessibilityRole="button" onPress={() => {setNote(storage.getString('note') ?? ''); setStatus('Loaded');}}><Text>Load</Text></Pressable>
    <Pressable testID="remove" accessibilityRole="button" onPress={() => {setStatus(storage.remove('note') ? 'Removed' : 'Absent');}}><Text>Remove</Text></Pressable>
    <Text testID="status">{status}</Text>
  </View>;
}
