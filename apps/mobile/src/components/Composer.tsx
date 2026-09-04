import { useCallback, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAppTheme } from '../hooks/useAppTheme';
import type { AttachmentUploadState, PendingAttachment } from '../types';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

type Props = {
  generating: boolean;
  uploading: boolean;
  attachments: PendingAttachment[];
  uploadStates?: Record<string, AttachmentUploadState>;
  reasoningLabel: string;
  webSearch: boolean;
  codeInterpreter: boolean;
  onOpenOptions: () => void;
  onToggleWebSearch: () => void;
  onToggleCodeInterpreter: () => void;
  onTakePhoto: () => void;
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
  reasoningLabel,
  webSearch,
  codeInterpreter,
  onOpenOptions,
  onToggleWebSearch,
  onToggleCodeInterpreter,
  onTakePhoto,
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
  const [attachmentTrayOpen, setAttachmentTrayOpen] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const submittingRef = useRef(false);
  const busy = uploading || submitting;
  const hasContent = text.trim().length > 0 || attachments.length > 0;
  const canSend = hasContent && !busy;
  const attachmentsFull = attachments.length >= 8;

  const submit = useCallback(async () => {
    if (!canSend || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const sent = await onSend(text.trim());
      if (sent) {
        setText('');
        setAttachmentTrayOpen(false);
        Keyboard.dismiss();
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [canSend, onSend, text]);

  const chooseAttachment = useCallback((action: () => void) => {
    if (busy || attachmentsFull) return;
    action();
  }, [attachmentsFull, busy]);

  const featureChip = (
    label: string,
    icon: IoniconName,
    onPress: () => void,
    selected = false,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.featureChip,
        {
          backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
        },
        pressed && styles.pressed,
      ]}
    >
      <Ionicons name={icon} size={15} color={selected ? theme.colors.primary : theme.colors.textSecondary} />
      <Text style={[styles.featureText, { color: selected ? theme.colors.primary : theme.colors.textSecondary, fontFamily: theme.fonts.medium }]}>{label}</Text>
    </Pressable>
  );

  const trayItem = (label: string, note: string, icon: IoniconName, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}，${note}`}
      disabled={busy || attachmentsFull}
      onPress={() => chooseAttachment(onPress)}
      style={({ pressed }) => [
        styles.trayItem,
        { backgroundColor: theme.colors.surfaceMuted },
        (busy || attachmentsFull) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.trayIcon, { backgroundColor: theme.colors.surfaceElevated }]}>
        <Ionicons name={icon} size={23} color={theme.colors.primary} />
      </View>
      <Text style={[styles.trayLabel, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>{label}</Text>
      <Text numberOfLines={1} style={[styles.trayNote, { color: theme.colors.textTertiary, fontFamily: theme.fonts.regular }]}>{note}</Text>
    </Pressable>
  );

  return (
    <View style={[styles.wrap, { backgroundColor: theme.colors.background }]}>
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
            if (attachment.kind === 'image') {
              return (
                <View
                  key={attachment.localId}
                  style={[styles.imageAttachment, uploadState?.status === 'error' && { opacity: 0.78 }]}
                >
                  <Image
                    accessibilityLabel={`待发送图片 ${attachment.name}`}
                    source={{ uri: attachment.uri }}
                    resizeMode="cover"
                    style={styles.attachmentPhoto}
                  />
                  {(uploadState?.status === 'uploading' || uploadState?.status === 'error') && (
                    <View pointerEvents="none" style={styles.imageStatusOverlay}>
                      <Text style={[styles.imageStatusText, { color: '#FFFFFF', fontFamily: theme.fonts.medium }]}>
                        {uploadState.status === 'uploading'
                          ? `上传${uploadState.progress > 0 ? ` ${uploadState.progress}%` : '…'}`
                          : uploadState.error ?? '上传失败'}
                      </Text>
                      {uploadState.status === 'uploading' && (
                        <View style={styles.imageProgressTrack}>
                          <View style={[styles.imageProgressFill, { width: `${Math.max(0, Math.min(100, uploadState.progress))}%`, backgroundColor: theme.colors.primary }]} />
                        </View>
                      )}
                    </View>
                  )}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`移除附件 ${attachment.name}`}
                    disabled={busy}
                    hitSlop={6}
                    onPress={() => onRemoveAttachment(attachment.localId)}
                    style={({ pressed }) => [styles.imageRemoveButton, busy && styles.disabled, pressed && styles.pressed]}
                  >
                    <Ionicons name="close" size={16} color="#FFFFFF" />
                  </Pressable>
                </View>
              );
            }

            return (
              <View
                key={attachment.localId}
                style={[styles.attachmentChip, { backgroundColor: theme.colors.surface, borderColor: stateColor }]}
              >
                <View style={[styles.fileIcon, { backgroundColor: theme.colors.primarySoft }]}>
                  <Ionicons name="document-text" size={19} color={theme.colors.primary} />
                </View>
                <View style={styles.attachmentMeta}>
                  <Text numberOfLines={1} style={[styles.attachmentName, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>{attachment.name}</Text>
                  {uploadState?.status === 'uploading' ? (
                    <>
                      <Text style={[styles.attachmentSize, { color: theme.colors.primary, fontFamily: theme.fonts.regular }]}>正在上传{uploadState.progress > 0 ? ` ${uploadState.progress}%` : '…'}</Text>
                      <View style={[styles.progressTrack, { backgroundColor: theme.colors.border }]}>
                        <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, uploadState.progress))}%`, backgroundColor: theme.colors.primary }]} />
                      </View>
                    </>
                  ) : (
                    <Text style={[styles.attachmentSize, { color: uploadState?.status === 'error' ? theme.colors.danger : theme.colors.textTertiary, fontFamily: theme.fonts.regular }]}>
                      {uploadState?.status === 'error' ? uploadState.error ?? '上传失败' : formatBytes(attachment.size) || '文件'}
                    </Text>
                  )}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`移除附件 ${attachment.name}`}
                  disabled={busy}
                  hitSlop={6}
                  onPress={() => onRemoveAttachment(attachment.localId)}
                  style={({ pressed }) => [styles.removeButton, busy && styles.disabled, pressed && styles.pressed]}
                >
                  <Ionicons name="close-circle" size={20} color={theme.colors.textTertiary} />
                </Pressable>
              </View>
            );
          })}
          {!attachmentsFull && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="添加图片"
              disabled={busy}
              onPress={() => chooseAttachment(onAddImage)}
              style={({ pressed }) => [
                styles.addImageTile,
                { backgroundColor: theme.colors.surfaceMuted },
                busy && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="add" size={28} color={theme.colors.textSecondary} />
              <Text style={[styles.addImageLabel, { color: theme.colors.textTertiary, fontFamily: theme.fonts.medium }]}>添加</Text>
            </Pressable>
          )}
        </ScrollView>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.featureBar}
      >
        {featureChip(reasoningLabel, 'sparkles-outline', onOpenOptions, true)}
        {featureChip('网页搜索', 'globe-outline', onToggleWebSearch, webSearch)}
        {featureChip('代码工具', 'code-slash-outline', onToggleCodeInterpreter, codeInterpreter)}
        {featureChip(attachmentTrayOpen ? '收起附件' : '添加附件', attachmentTrayOpen ? 'chevron-down' : 'attach-outline', () => setAttachmentTrayOpen((open) => !open), attachmentTrayOpen)}
      </ScrollView>

      {attachmentTrayOpen && (
        <View style={[styles.tray, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <View style={styles.trayGrid}>
            {trayItem('相机', '立即拍照', 'camera-outline', onTakePhoto)}
            {trayItem('相册', '选择图片', 'images-outline', onAddImage)}
            {trayItem('文件', '从设备选择', 'document-text-outline', onAddDocument)}
          </View>
          <Text style={[styles.trayHint, { color: theme.colors.textTertiary, fontFamily: theme.fonts.regular }]}>最多 8 个附件，单个不超过 25 MB。</Text>
        </View>
      )}

      <View
        style={[
          styles.composer,
          {
            backgroundColor: theme.colors.surfaceElevated,
            borderColor: theme.colors.border,
            shadowColor: theme.dark ? '#000000' : '#4D5360',
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="拍照"
          disabled={busy || attachmentsFull}
          onPress={() => chooseAttachment(onTakePhoto)}
          hitSlop={5}
          style={({ pressed }) => [styles.roundAction, busy && styles.disabled, pressed && styles.pressed]}
        >
          <Ionicons name="camera-outline" size={22} color={busy || attachmentsFull ? theme.colors.textTertiary : theme.colors.textSecondary} />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={setText}
          placeholder={uploading ? '正在上传附件…' : '给 Nova 发消息…'}
          placeholderTextColor={theme.colors.textTertiary}
          style={[styles.input, { color: theme.colors.text, fontFamily: theme.fonts.regular }]}
          multiline
          maxLength={10_000}
          editable={!busy}
          textAlignVertical="center"
          accessibilityLabel="消息输入框"
          onFocus={onInputFocus}
          onContentSizeChange={onInputContentSizeChange}
          returnKeyType="send"
          enterKeyHint="send"
          submitBehavior="submit"
          onSubmitEditing={() => { void submit(); }}
        />
        {generating && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="停止生成"
            onPress={onStop}
            hitSlop={5}
            style={({ pressed }) => [styles.stopButton, { backgroundColor: theme.colors.surfaceMuted }, pressed && styles.pressed]}
          >
            <Ionicons name="stop" size={16} color={theme.colors.text} />
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={attachmentTrayOpen ? '收起附件选项' : '展开附件选项'}
          onPress={() => setAttachmentTrayOpen((open) => !open)}
          hitSlop={5}
          style={({ pressed }) => [styles.roundAction, pressed && styles.pressed]}
        >
          <Ionicons name={attachmentTrayOpen ? 'close' : 'add'} size={25} color={theme.colors.textSecondary} />
        </Pressable>
        {(canSend || busy) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={busy ? '正在发送' : '发送消息'}
            onPress={() => void submit()}
            disabled={!canSend}
            style={({ pressed }) => [
              styles.send,
              { backgroundColor: canSend ? theme.colors.primary : theme.colors.surfaceMuted },
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator size="small" color={theme.colors.textTertiary} />
            ) : (
              <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
            )}
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 7, paddingBottom: 8 },
  attachmentList: { gap: 9, alignItems: 'center', paddingHorizontal: 1, paddingBottom: 8 },
  attachmentChip: { width: 188, height: 58, flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 15, padding: 6 },
  imageAttachment: { width: 82, height: 82, borderRadius: 16, overflow: 'hidden', position: 'relative', backgroundColor: '#D7D9DE' },
  attachmentPhoto: { width: '100%', height: '100%', backgroundColor: '#D7D9DE' },
  imageRemoveButton: { position: 'absolute', top: 5, right: 5, width: 23, height: 23, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.58)' },
  imageStatusOverlay: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 6, paddingTop: 5, paddingBottom: 6, backgroundColor: 'rgba(0,0,0,0.55)' },
  imageStatusText: { fontSize: 9, lineHeight: 12, textAlign: 'center' },
  imageProgressTrack: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 4, backgroundColor: 'rgba(255,255,255,0.35)' },
  imageProgressFill: { height: '100%', borderRadius: 2 },
  addImageTile: { width: 82, height: 82, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  addImageLabel: { fontSize: 10, marginTop: 1 },
  fileIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  attachmentMeta: { flex: 1, minWidth: 0, paddingHorizontal: 8 },
  attachmentName: { fontSize: 12, fontWeight: '700' },
  attachmentSize: { fontSize: 10, marginTop: 3 },
  progressTrack: { height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 4 },
  progressFill: { height: '100%', borderRadius: 2 },
  removeButton: { alignSelf: 'flex-start', padding: 1 },
  featureBar: { gap: 8, paddingHorizontal: 1, paddingBottom: 8 },
  featureChip: { minHeight: 34, borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  featureText: { fontSize: 12, fontWeight: '700' },
  tray: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, marginBottom: 8, padding: 10 },
  trayGrid: { flexDirection: 'row', gap: 8 },
  trayItem: { flex: 1, minWidth: 0, minHeight: 96, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  trayIcon: { width: 45, height: 45, borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginBottom: 7 },
  trayLabel: { fontSize: 13, fontWeight: '800' },
  trayNote: { fontSize: 9, marginTop: 2, textAlign: 'center' },
  trayHint: { fontSize: 10, lineHeight: 15, textAlign: 'center', marginTop: 8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 27,
    minHeight: 54,
    paddingHorizontal: 6,
    paddingVertical: 6,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  roundAction: { width: 38, height: 40, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 40, maxHeight: 150, fontSize: 16, lineHeight: 22, paddingHorizontal: 5, paddingTop: 9, paddingBottom: 7 },
  stopButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 3, marginHorizontal: 2 },
  send: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginBottom: 1, marginLeft: 2 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.45 },
});
