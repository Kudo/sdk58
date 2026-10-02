import React, {useState} from 'react';
import {Pressable, Text, TextInput, View} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function App() {
  const [note, setNote] = useState('');
  const [status, setStatus] = useState('Ready');
  const perform = (action: () => Promise<void>) => async () => {
    try {await action();} catch (error) {setStatus(`Error: ${(error as Error).message}`);}
  };
  return <View style={{padding: 24, gap: 12}}>
    <Text accessibilityRole="header">Saved note</Text>
    <TextInput testID="note" accessibilityLabel="Note" value={note} onChangeText={setNote} style={{height: 48}} />
    <Pressable testID="save" accessibilityRole="button" onPress={perform(async () => {
      await AsyncStorage.setItem('note', note); setStatus('Saved');
    })}><Text>Save</Text></Pressable>
    <Pressable testID="load" accessibilityRole="button" onPress={perform(async () => {
      setNote(await AsyncStorage.getItem('note') ?? ''); setStatus('Loaded');
    })}><Text>Load</Text></Pressable>
    <Pressable testID="remove" accessibilityRole="button" onPress={perform(async () => {
      await AsyncStorage.removeItem('note'); setStatus('Removed');
    })}><Text>Remove</Text></Pressable>
    <Text testID="status">{status}</Text>
  </View>;
}
