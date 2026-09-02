import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ReasoningEffort, Verbosity } from '@nova-chat/protocol';
import { SafeAreaView } from 'react-native-safe-area-context';
import { KeyboardAwareView } from './KeyboardAwareView';
import { useAppTheme } from '../hooks/useAppTheme';

type Props = {
  visible: boolean;
  models: string[];
  selectedModel: string;
  reasoningEffort: ReasoningEffort;
  verbosity: Verbosity;
  onSelectModel: (model: string) => void;
  onSelectReasoning: (effort: ReasoningEffort) => void;
  onSelectVerbosity: (verbosity: Verbosity) => void;
  onClose: () => void;
};

const efforts: { value: ReasoningEffort; label: string }[] = [
  { value: 'none', label: '无' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
];
const verbosities: { value: Verbosity; label: string }[] = [
  { value: 'low', label: '简洁' },
  { value: 'medium', label: '适中' },
  { value: 'high', label: '详细' },
];

export function ChatOptionsModal({
  visible,
  models,
  selectedModel,
  reasoningEffort,
  verbosity,
  onSelectModel,
  onSelectReasoning,
  onSelectVerbosity,
  onClose,
}: Props) {
  const theme = useAppTheme();
  const [query, setQuery] = useState('');
  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? models.filter((model) => model.toLowerCase().includes(needle)) : models;
  }, [models, query]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAwareView style={styles.container}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
          <View>
            <Text style={[styles.title, { color: theme.colors.text }]}>对话设置</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>仅影响后续发送的消息</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="关闭对话设置" hitSlop={10} onPress={onClose}>
            <Ionicons name="close-circle" size={30} color={theme.colors.textSecondary} />
          </Pressable>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>模型</Text>
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
          <View style={styles.modelList}>
            {filteredModels.map((model) => {
              const selected = model === selectedModel;
              return (
                <Pressable
                  key={model}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelectModel(model)}
                  style={({ pressed }) => [styles.modelRow, { backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface, borderColor: selected ? theme.colors.primary : theme.colors.border }, pressed && { opacity: 0.75 }]}
                >
                  <Ionicons name={selected ? 'checkmark-circle' : 'cube-outline'} size={21} color={selected ? theme.colors.primary : theme.colors.textSecondary} />
                  <Text selectable numberOfLines={2} style={[styles.modelText, { color: selected ? theme.colors.primary : theme.colors.text }]}>{model}</Text>
                </Pressable>
              );
            })}
            {!filteredModels.length && <Text style={[styles.empty, { color: theme.colors.textSecondary }]}>{models.length ? '没有匹配的模型。' : '管理员还没有发布可用模型。'}</Text>}
          </View>

          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>推理强度</Text>
          <Text style={[styles.hint, { color: theme.colors.textSecondary }]}>可选值对应兼容接口的 none、low、medium、high、xhigh；不同模型的实际上限由服务商决定。</Text>
          <View style={styles.chips}>
            {efforts.map((item) => {
              const selected = reasoningEffort === item.value;
              return <Pressable key={item.value} onPress={() => onSelectReasoning(item.value)} style={[styles.chip, { backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceMuted, borderColor: selected ? theme.colors.primary : theme.colors.border }]}><Text style={[styles.chipText, { color: selected ? theme.colors.primary : theme.colors.textSecondary }]}>{item.label}</Text></Pressable>;
            })}
          </View>

          <Text style={[styles.sectionTitle, { color: theme.colors.text }]}>回答详略</Text>
          <View style={styles.chips}>
            {verbosities.map((item) => {
              const selected = verbosity === item.value;
              return <Pressable key={item.value} onPress={() => onSelectVerbosity(item.value)} style={[styles.chip, { backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surfaceMuted, borderColor: selected ? theme.colors.primary : theme.colors.border }]}><Text style={[styles.chipText, { color: selected ? theme.colors.primary : theme.colors.textSecondary }]}>{item.label}</Text></Pressable>;
            })}
          </View>

          <Pressable accessibilityRole="button" onPress={onClose} style={[styles.doneButton, { backgroundColor: theme.colors.primary }]}><Text style={styles.doneText}>完成</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
      </KeyboardAwareView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  header: { minHeight: 68, paddingHorizontal: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 20, fontWeight: '800' },
  subtitle: { marginTop: 2, fontSize: 12 },
  content: { padding: 16, paddingBottom: 34 },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginTop: 8, marginBottom: 8 },
  searchWrap: { height: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { flex: 1, height: 42, fontSize: 14 },
  modelList: { gap: 8, marginTop: 10 },
  modelRow: { minHeight: 50, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 13, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  modelText: { flex: 1, fontSize: 14, fontWeight: '600' },
  empty: { textAlign: 'center', padding: 18, fontSize: 13, lineHeight: 19 },
  hint: { fontSize: 11, lineHeight: 17, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { minWidth: 52, minHeight: 35, paddingHorizontal: 11, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 12, fontWeight: '700' },
  doneButton: { height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  doneText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
