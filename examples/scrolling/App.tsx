import {useState} from 'react';
import {FlatList, Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';

const ROWS = Array.from({length: 30}, (_, i) => i);
const ITEMS = Array.from({length: 100}, (_, i) => ({key: String(i), index: i}));

export default function App() {
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <View style={styles.container}>
      <Text testID="offset">{`offset ${offset}`}</Text>
      <Text testID="selected">{selected == null ? 'none' : `row ${selected}`}</Text>
      <ScrollView
        testID="list"
        style={styles.list}
        onScroll={event => setOffset(Math.round(event.nativeEvent.contentOffset.y))}
        scrollEventThrottle={16}>
        {ROWS.map(i => (
          <Pressable
            key={i}
            testID={`row-${i}`}
            role="button"
            style={styles.row}
            onPress={() => setSelected(i)}>
            <Text>{`Row ${i}`}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        testID="flat"
        style={styles.flat}
        data={ITEMS}
        initialNumToRender={5}
        maxToRenderPerBatch={5}
        windowSize={2}
        getItemLayout={(_, index) => ({length: 60, offset: 60 * index, index})}
        renderItem={({item}) => (
          <View testID={`flat-row-${item.index}`} style={styles.row}>
            <Text>{`Item ${item.index}`}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex: 1, paddingTop: 20},
  list: {height: 400, flexGrow: 0},
  flat: {height: 300, flexGrow: 0},
  row: {height: 60, justifyContent: 'center', paddingHorizontal: 16},
});
