import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText as Text, ThemedTextInput as TextInput } from './ThemedText';
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

type ReasoningOption = {
  value: Exclude<ReasoningEffort, 'max'>;
  label: string;
  description: string;
  default?: boolean;
};

const efforts: ReasoningOption[] = [
  { value: 'none', label: '直接回答', description: '更快，适合简单问答' },
  { value: 'low', label: '轻度思考', description: '快速梳理后回答' },
  { value: 'medium', label: '中等思考', description: '质量与速度更均衡', default: true },
  { value: 'high', label: '深度思考', description: '适合复杂分析和规划' },
  { value: 'xhigh', label: '高强度思考', description: '更充分推理，耗时可能更久' },
];

const verbosities: { value: Verbosity; label: string; description: string }[] = [
  { value: 'low', label: '简洁', description: '只保留重点' },
  { value: 'medium', label: '适中', description: '说明与篇幅平衡' },
  { value: 'high', label: '详细', description: '给出更多步骤和背景' },
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
  const normalizedReasoning = reasoningEffort === 'max' ? 'xhigh' : reasoningEffort;
  const filteredModels = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? models.filter((model) => model.toLowerCase().includes(needle)) : models;
  }, [models, query]);

  useEffect(() => {
    if (!visible) setQuery('');
  }, [visible]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAwareView style={styles.container}>
        <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]} edges={['top', 'bottom']}>
          <View style={[styles.header, { borderBottomColor: theme.colors.border, backgroundColor: theme.colors.surface }]}>
            <View style={styles.headerText}>
              <Text style={[styles.title, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>模型与回答方式</Text>
              <Text style={[styles.subtitle, { color: theme.colors.textSecondary, fontFamily: theme.fonts.regular }]}>更改只会用于之后发送的消息</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="关闭模型与回答方式"
              hitSlop={8}
              onPress={onClose}
              style={({ pressed }) => [styles.closeButton, { backgroundColor: theme.colors.surfaceMuted }, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={21} color={theme.colors.textSecondary} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={styles.sectionHeading}>
              <View style={[styles.sectionIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons name="cube-outline" size={17} color={theme.colors.primary} />
              </View>
              <View style={styles.sectionHeadingText}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>选择模型</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.colors.textSecondary, fontFamily: theme.fonts.regular }]}>模型 ID 由你的网关管理员提供</Text>
              </View>
            </View>

            <View style={[styles.sectionCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <View style={[styles.searchWrap, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
                <Ionicons name="search-outline" size={18} color={theme.colors.textTertiary} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="搜索模型 ID"
                  placeholderTextColor={theme.colors.textTertiary}
                  style={[styles.search, { color: theme.colors.text, fontFamily: theme.fonts.regular }]}
                />
                {!!query && (
                  <Pressable accessibilityRole="button" accessibilityLabel="清除模型搜索" hitSlop={8} onPress={() => setQuery('')}>
                    <Ionicons name="close-circle" size={18} color={theme.colors.textTertiary} />
                  </Pressable>
                )}
              </View>

              <View style={styles.modelList}>
                {filteredModels.map((model) => {
                  const selected = model === selectedModel;
                  return (
                    <Pressable
                      key={model}
                      accessibilityRole="button"
                      accessibilityLabel={`选择模型 ${model}`}
                      accessibilityState={{ selected }}
                      onPress={() => onSelectModel(model)}
                      style={({ pressed }) => [
                        styles.modelRow,
                        { backgroundColor: selected ? theme.colors.primarySoft : theme.colors.background, borderColor: selected ? theme.colors.primary : theme.colors.border },
                        pressed && styles.pressed,
                      ]}
                    >
                      <View style={[styles.modelIcon, { backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceMuted }]}>
                        <Ionicons name="cube-outline" size={17} color={selected ? '#FFFFFF' : theme.colors.textSecondary} />
                      </View>
                      <Text selectable numberOfLines={2} style={[styles.modelText, { color: selected ? theme.colors.primary : theme.colors.text, fontFamily: theme.fonts.medium }]}>{model}</Text>
                      {selected ? (
                        <View style={[styles.selectedBadge, { backgroundColor: theme.colors.primary }]}>
                          <Ionicons name="checkmark" size={12} color="#FFFFFF" />
                          <Text style={styles.selectedBadgeText}>已选择</Text>
                        </View>
                      ) : (
                        <Ionicons name="chevron-forward" size={17} color={theme.colors.textTertiary} />
                      )}
                    </Pressable>
                  );
                })}
                {!filteredModels.length && (
                  <View style={styles.emptyWrap}>
                    <Ionicons name="search-outline" size={24} color={theme.colors.textTertiary} />
                    <Text style={[styles.empty, { color: theme.colors.textSecondary, fontFamily: theme.fonts.regular }]}>{models.length ? '没有匹配的模型' : '管理员还没有发布可用模型'}</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={styles.sectionHeading}>
              <View style={[styles.sectionIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons name="bulb-outline" size={18} color={theme.colors.primary} />
              </View>
              <View style={styles.sectionHeadingText}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>思考强度</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.colors.textSecondary, fontFamily: theme.fonts.regular }]}>中等思考是默认值，可兼顾质量与速度</Text>
              </View>
            </View>

            <View style={styles.optionGrid}>
              {efforts.map((item) => {
                const selected = normalizedReasoning === item.value;
                return (
                  <Pressable
                    key={item.value}
                    accessibilityRole="button"
                    accessibilityLabel={`${item.label}${item.default ? '，默认' : ''}`}
                    accessibilityState={{ selected }}
                    onPress={() => onSelectReasoning(item.value)}
                    style={({ pressed }) => [
                      styles.optionCard,
                      styles.reasoningCard,
                      { backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface, borderColor: selected ? theme.colors.primary : theme.colors.border },
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.optionTopRow}>
                      <Text style={[styles.optionTitle, { color: selected ? theme.colors.primary : theme.colors.text, fontFamily: theme.fonts.bold }]}>{item.label}</Text>
                      {item.default && (
                        <View style={[styles.defaultBadge, { backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceMuted }]}>
                          <Text style={[styles.defaultBadgeText, { color: selected ? '#FFFFFF' : theme.colors.textSecondary, fontFamily: theme.fonts.bold }]}>默认</Text>
                        </View>
                      )}
                    </View>
                    <Text style={[styles.optionDescription, { color: theme.colors.textSecondary, fontFamily: theme.fonts.regular }]}>{item.description}</Text>
                    <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? theme.colors.primary : theme.colors.textTertiary} style={styles.radio} />
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.sectionHeading}>
              <View style={[styles.sectionIcon, { backgroundColor: theme.colors.surfaceMuted }]}>
                <Ionicons name="reader-outline" size={17} color={theme.colors.primary} />
              </View>
              <View style={styles.sectionHeadingText}>
                <Text style={[styles.sectionTitle, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>回答详略</Text>
                <Text style={[styles.sectionSubtitle, { color: theme.colors.textSecondary, fontFamily: theme.fonts.regular }]}>控制答案篇幅，不改变问题本身</Text>
              </View>
            </View>

            <View style={[styles.verbosityGroup, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              {verbosities.map((item, index) => {
                const selected = verbosity === item.value;
                return (
                  <View key={item.value}>
                    {index > 0 && <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`回答${item.label}`}
                      accessibilityState={{ selected }}
                      onPress={() => onSelectVerbosity(item.value)}
                      style={({ pressed }) => [styles.verbosityRow, pressed && styles.pressed]}
                    >
                      <View style={styles.verbosityText}>
                        <Text style={[styles.optionTitle, { color: selected ? theme.colors.primary : theme.colors.text, fontFamily: theme.fonts.bold }]}>{item.label}</Text>
                        <Text style={[styles.optionDescription, { color: theme.colors.textSecondary, fontFamily: theme.fonts.regular }]}>{item.description}</Text>
                      </View>
                      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={20} color={selected ? theme.colors.primary : theme.colors.textTertiary} />
                    </Pressable>
                  </View>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="完成模型与回答方式设置"
              onPress={onClose}
              style={({ pressed }) => [styles.doneButton, { backgroundColor: theme.colors.primary }, pressed && { backgroundColor: theme.colors.primaryPressed }]}
            >
              <Text style={[styles.doneText, { fontFamily: theme.fonts.bold }]}>完成</Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </KeyboardAwareView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  header: {
    minHeight: 72,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { flex: 1, minWidth: 0, paddingRight: 12 },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.25 },
  subtitle: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  closeButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', maxWidth: 680, alignSelf: 'center', padding: 16, paddingBottom: 38 },
  currentCard: {
    minHeight: 76,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: 'row',
    alignItems: 'center',
  },
  currentIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  currentBody: { flex: 1, minWidth: 0, paddingRight: 8 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5, marginBottom: 3 },
  currentModel: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', marginTop: 22, marginBottom: 10 },
  sectionIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  sectionHeadingText: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 15, fontWeight: '800' },
  sectionSubtitle: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  sectionCard: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 10 },
  searchWrap: { height: 44, borderWidth: StyleSheet.hairlineWidth, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  search: { flex: 1, height: 42, fontSize: 14 },
  modelList: { gap: 7, marginTop: 9 },
  modelRow: { minHeight: 54, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 11, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 9 },
  modelIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modelText: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontWeight: '600' },
  selectedBadge: { minHeight: 24, paddingHorizontal: 8, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 3 },
  selectedBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  emptyWrap: { alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 20, paddingHorizontal: 12 },
  empty: { textAlign: 'center', fontSize: 12, lineHeight: 18 },
  optionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  optionCard: { borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 12 },
  reasoningCard: { flexGrow: 1, flexBasis: '46%', minWidth: 132, minHeight: 105 },
  optionTopRow: { minHeight: 22, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingRight: 20 },
  optionTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  optionDescription: { fontSize: 11, lineHeight: 16, marginTop: 4 },
  defaultBadge: { minHeight: 20, paddingHorizontal: 7, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  defaultBadgeText: { fontSize: 9, fontWeight: '800' },
  radio: { position: 'absolute', right: 10, top: 11 },
  verbosityGroup: { borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  verbosityRow: { minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  verbosityText: { flex: 1, minWidth: 0, paddingRight: 12 },
  divider: { height: StyleSheet.hairlineWidth, marginLeft: 14 },
  doneButton: { height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  doneText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.99 }] },
});
