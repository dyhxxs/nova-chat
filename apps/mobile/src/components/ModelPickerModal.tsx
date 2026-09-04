import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { ThemedTextInput as TextInput } from './ThemedText';
import { ThemedText as Text } from './ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareView } from './KeyboardAwareView';
import { useAppTheme } from '../hooks/useAppTheme';

type Props = {
  visible: boolean;
  models: string[];
  selectedModel: string;
  onSelect: (model: string) => void;
  onClose: () => void;
};

export function ModelPickerModal({ visible, models, selectedModel, onSelect, onClose }: Props) {
  const theme = useAppTheme();
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? models.filter((model) => model.toLowerCase().includes(needle)) : models;
  }, [models, query]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAwareView style={styles.container}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
          <View>
            <Text style={[styles.title, { color: theme.colors.text }]}>选择模型</Text>
            <Text style={[styles.count, { color: theme.colors.textSecondary }]}>{models.length} 个可用模型</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭模型列表" hitSlop={10} onPress={onClose}>
            <Ionicons name="close-circle" size={30} color={theme.colors.textSecondary} />
          </Pressable>
        </View>
        <View style={[styles.searchWrap, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
          <Ionicons name="search-outline" size={18} color={theme.colors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="搜索模型 ID"
            placeholderTextColor={theme.colors.textTertiary}
            style={[styles.search, { color: theme.colors.text }]}
          />
          {!!query && <Pressable hitSlop={8} onPress={() => setQuery('')}><Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} /></Pressable>}
        </View>
        <FlatList
          style={styles.listView}
          data={filtered}
          keyExtractor={(item) => item}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const selected = item === selectedModel;
            return (
              <Pressable
                onPress={() => { onSelect(item); onClose(); }}
                style={({ pressed }) => [styles.row, { backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface, borderColor: selected ? theme.colors.primary : theme.colors.border }, pressed && { opacity: 0.75 }]}
              >
                <Ionicons name={selected ? 'checkmark-circle' : 'cube-outline'} size={21} color={selected ? theme.colors.primary : theme.colors.textSecondary} />
                <Text selectable numberOfLines={2} style={[styles.model, { color: selected ? theme.colors.primary : theme.colors.text }]}>{item}</Text>
              </Pressable>
            );
          }}
          ListEmptyComponent={<Text style={[styles.empty, { color: theme.colors.textSecondary }]}>没有匹配的模型，可关闭后手动填写模型 ID。</Text>}
        />
      </SafeAreaView>
      </KeyboardAwareView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  listView: { flex: 1 },
  header: { minHeight: 68, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: '800' },
  count: { marginTop: 2, fontSize: 12 },
  searchWrap: { margin: 16, height: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { flex: 1, height: 42, fontSize: 14 },
  list: { paddingHorizontal: 16, paddingBottom: 28, gap: 8 },
  row: { minHeight: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  model: { flex: 1, fontSize: 14, fontWeight: '600' },
  empty: { textAlign: 'center', padding: 30, fontSize: 13, lineHeight: 19 },
});
