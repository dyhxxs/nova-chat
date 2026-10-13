import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { KnowledgeResult } from '@nova-chat/protocol';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';

export function KnowledgeSources({ result }: { result: KnowledgeResult }) {
  const theme = useAppTheme();
  const [open, setOpen] = useState(false);
  return <View style={{ marginTop: 10, padding: 12, gap: 10, borderRadius: 12, backgroundColor: theme.colors.surfaceMuted }}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)}>
      <Text style={{ color: theme.colors.primary, fontWeight: '600' }}>{result.sources.length ? `${open ? '收起' : '查看'}资料来源 · ${result.sources.length}个片段` : '资料检索：未命中'}</Text>
    </Pressable>
    {open && <>
      <Text style={{ color: theme.colors.textSecondary, fontSize: 12 }}>检索词：{result.query}。以下是本轮提供给模型的原文快照，不代表每项都被答案采用，也不是完整文档。请核对回答中的编号与证据。</Text>
      {result.sources.map(source => <View key={source.label} style={{ gap: 6 }}>
        <Text selectable style={{ color: theme.colors.text, fontWeight: '600' }}>[{source.label}] {source.title} · 片段{source.chunk}</Text>
        <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>资料更新时间：{new Date(source.updatedAt).toLocaleString()}</Text>
        <Text selectable style={{ color: theme.colors.text, lineHeight: 22 }}>{source.excerpt}</Text>
      </View>)}
      <Text style={{ color: theme.colors.textTertiary, fontSize: 12 }}>删除或编辑资料不会修改已生成回答及其片段快照；需另行删除对应聊天。标准聊天备份不包含这些来源快照。</Text>
    </>}
  </View>;
}
