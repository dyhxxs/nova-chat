import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '../hooks/useAppTheme';
import type { AttachmentUploadState, PendingAttachment } from '../types';

type Props = {
  generating: boolean;
  uploading: boolean;
  attachments: PendingAttachment[];
  uploadStates?: Record<string, AttachmentUploadState>;
  onAddImage: () => void;
  onAddDocument: () => void;
  onRemoveAttachment: (localId: string) => void;
  onSend: (text: string) => boolean | Promise<boolean>;
  onStop: () => void;
  onInputFocus?: () => void;
  onInputContentSizeChange?: () => void;
};

function formatBytes(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function Composer({
  generating,
  uploading,
  attachments,
  uploadStates,
  onAddImage,
  onAddDocument,
  onRemoveAttachment,
  onSend,
  onStop,
  onInputFocus,
  onInputContentSizeChange,
}: Props) {
  const theme = useAppTheme();
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const submittingRef = useRef(false);
  // A response in this conversation must not lock the composer. Users can
  // queue a follow-up while an earlier answer is still being prepared, like
  // they can in Codex. Uploading and the local submit guard are the only
  // states that temporarily block editing.
  const busy = uploading || submitting;
  const hasContent = text.trim().length > 0 || attachments.length > 0;
  const canSend = hasContent && !busy;
  const canStop = generating && !hasContent && !busy;

  const submit = useCallback(async () => {
    if (!canSend || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const sent = await onSend(text.trim());
      if (sent) {
        setText('');
        Keyboard.dismiss();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [canSend, onSend, text]);

  return (
    <View style={[styles.wrap, { borderTopColor: theme.colors.border, backgroundColor: theme.colors.background }]}>
      {attachments.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.attachmentList}
        >
          {attachments.map((attachment) => {
            const uploadState = uploadStates?.[attachment.localId];
            const stateColor = uploadState?.status === 'error' ? theme.colors.danger : theme.colors.border;
            return (
              <View
                key={attachment.localId}
                style={[styles.attachmentChip, { backgroundColor: theme.colors.surfaceMuted, borderColor: stateColor }]}
              >
                {attachment.kind === 'image' ? (
                  <Image source={{ uri: attachment.uri }} style={styles.thumbnail} />
                ) : (
                  <View style={[styles.fileIcon, { backgroundColor: theme.colors.primarySoft }]}>
                    <Ionicons name="document-text" size={19} color={theme.colors.primary} />
                  </View>
                )}
                <View style={styles.attachmentMeta}>
                  <Text numberOfLines={1} style={[styles.attachmentName, { color: theme.colors.text }]}>{attachment.name}</Text>
                  {uploadState?.status === 'uploading' ? (
                    <>
                      <Text style={[styles.attachmentSize, { color: theme.colors.primary }]}>正在上传{uploadState.progress > 0 ? ` ${uploadState.progress}%` : '…'}</Text>
                      <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
                        <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, uploadState.progress))}%`, backgroundColor: theme.colors.primary }]} />
                      </View>
                    </>
                  ) : uploadState?.status === 'error' ? (
                    <Text numberOfLines={1} style={[styles.attachmentSize, { color: theme.colors.danger }]}>{uploadState.error || '上传失败，可重试'}</Text>
                  ) : uploadState?.status === 'complete' ? (
                    <Text style={[styles.attachmentSize, { color: theme.colors.success }]}>已上传</Text>
                  ) : (
                    <Text style={[styles.attachmentSize, { color: theme.colors.textTertiary }]}>{formatBytes(attachment.size) || '待发送'}</Text>
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`移除 ${attachment.name}`}
                  disabled={busy}
                  hitSlop={8}
                  onPress={() => onRemoveAttachment(attachment.localId)}
                  style={({ pressed }) => [styles.removeButton, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="close-circle" size={20} color={theme.colors.textTertiary} />
                </Pressable>
              </View>
            );
          })}
        </ScrollView>
      )}

      <View style={[styles.composer, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }]}>
        <View style={styles.attachActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="添加图片"
            disabled={busy || attachments.length >= 8}
            onPress={onAddImage}
            hitSlop={6}
            style={({ pressed }) => [styles.attachButton, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="image-outline" size={21} color={busy || attachments.length >= 8 ? theme.colors.textTertiary : theme.colors.textSecondary} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="添加 PDF"
            disabled={busy || attachments.length >= 8}
            onPress={onAddDocument}
            hitSlop={6}
            style={({ pressed }) => [styles.attachButton, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="document-attach-outline" size={21} color={busy || attachments.length >= 8 ? theme.colors.textTertiary : theme.colors.textSecondary} />
          </Pressable>
        </View>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={uploading ? '正在上传附件…' : '给 Nova 发消息…'}
          placeholderTextColor={theme.colors.textTertiary}
          style={[styles.input, { color: theme.colors.text }]}
          multiline
          maxLength={10_000}
          editable={!uploading && !submitting}
          textAlignVertical="center"
          accessibilityLabel="消息输入框"
          onFocus={onInputFocus}
          onContentSizeChange={onInputContentSizeChange}
          returnKeyType="send"
          enterKeyHint="send"
          submitBehavior="submit"
          onSubmitEditing={() => { void submit(); }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={canSend ? '发送消息' : uploading || submitting ? '正在发送' : canStop ? '停止生成' : '发送消息'}
          onPress={canSend ? () => void submit() : canStop ? onStop : undefined}
          disabled={!canSend && !canStop}
          style={({ pressed }) => [
            styles.send,
            { backgroundColor: canSend ? theme.colors.primary : theme.colors.surfaceMuted },
            pressed && { opacity: 0.75 },
          ]}
        >
          {uploading || submitting ? (
            <ActivityIndicator size="small" color={theme.colors.textTertiary} />
          ) : (
            <Ionicons name={canStop ? 'stop' : 'arrow-up'} size={20} color={canSend ? '#FFFFFF' : canStop ? theme.colors.text : theme.colors.textTertiary} />
          )}
        </Pressable>
      </View>
      <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>最多 8 个附件，单个不超过 25 MB；PDF 需要 Responses 模式。</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 9, paddingBottom: 7, borderTopWidth: StyleSheet.hairlineWidth },
  attachmentList: { gap: 8, paddingBottom: 8 },
  attachmentChip: { width: 190, height: 58, flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 13, padding: 6 },
  thumbnail: { width: 44, height: 44, borderRadius: 9, backgroundColor: '#D7D9DE' },
  fileIcon: { width: 44, height: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  attachmentMeta: { flex: 1, minWidth: 0, paddingHorizontal: 8 },
  attachmentName: { fontSize: 12, fontWeight: '600' },
  attachmentSize: { fontSize: 10, marginTop: 3 },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  progressFill: { height: '100%', borderRadius: 2 },
  removeButton: { alignSelf: 'flex-start', padding: 1 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', borderWidth: 1, borderRadius: 24, minHeight: 52, paddingLeft: 5, paddingRight: 6, paddingVertical: 5 },
  attachActions: { flexDirection: 'row', alignItems: 'center', paddingBottom: 4 },
  attachButton: { width: 32, height: 34, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 40, maxHeight: 150, fontSize: 16, lineHeight: 22, paddingHorizontal: 7, paddingTop: 9, paddingBottom: 7 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginLeft: 3 },
  hint: { fontSize: 10, lineHeight: 14, textAlign: 'center', paddingTop: 4 },
});
