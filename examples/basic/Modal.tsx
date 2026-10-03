import {Modal, Pressable, Text, View} from 'react-native';

export default function ModalFixture() {
  return <View><Modal visible><Pressable testID="modal-action" onPress={() => {}}><Text>Save</Text></Pressable></Modal></View>;
}
