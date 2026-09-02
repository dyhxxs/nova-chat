import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, Platform, Pressable, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { DEFAULT_MODEL_ID, type AttachmentRef, type GenerateRequest } from '@nova-chat/protocol';
import { Ionicons } from '@expo/vector-icons';
import { ChatOptionsModal } from '../components/ChatOptionsModal';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { Composer } from '../components/Composer';
import { EmptyState } from '../components/EmptyState';
import { IconButton } from '../components/IconButton';
import { MessageBubble } from '../components/MessageBubble';
import { buildConversationContext } from '../lib/conversationContext';
import { uploadProgressPercent } from '../lib/uploadProgress';
import { friendlyNetworkError } from '../lib/errorMessage';
import { createId } from '../lib/id';
import { startGeneration, type GenerationController } from '../services/chatClient';
import { fetchGatewayModels, GatewayApiError, uploadAttachment } from '../services/gatewayApiClient';
import { useAppStore } from '../store/useAppStore';
import type { AttachmentUploadState, PendingAttachment, RootStackParamList } from '../types';
import { useAppTheme } from '../hooks/useAppTheme';
import { selectGatewayModel } from '../lib/modelSelection';

type Props = NativeStackScreenProps<RootStackParamList, 'Chat'>;
type ActiveGeneration = { controller: GenerationController; requestId: string; conversationId: string; messageId: string };

class AttachmentUploadFailure extends Error {
  constructor(readonly fileName: string, message: string) {
    super(message);
    this.name = 'AttachmentUploadFailure';
  }
}

const MAX_ATTACHMENTS = 8;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

const reasoningLabels: Record<string, string> = { none: '无', low: '低', medium: '中', high: '高', xhigh: '极高', max: '极高' };

function isImageModelId(model: string | undefined): boolean {
  return /^gpt-image(?:[-.]|$)/i.test(model?.trim() ?? '');
}

function imageMimeType(uri: string, provided?: string | null): string {
  const normalized = provided?.toLowerCase().trim();
  if (normalized) return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  const clean = uri.split('?')[0]?.toLowerCase() ?? '';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function imageFileName(uri: string, provided: string | null | undefined, index: number): string {
  if (provided?.trim()) return provided.trim();
  const fromUri = decodeURIComponent(uri.split('/').pop()?.split('?')[0] ?? '').trim();
  return fromUri || `image-${Date.now()}-${index + 1}.jpg`;
}

function attachmentValidationError(name: string, mimeType: string, size?: number): string | undefined {
  if (size !== undefined && size > MAX_FILE_BYTES) return `${name} 超过 25 MB，无法上传。`;
  if (mimeType.startsWith('image/') && !IMAGE_MIME_TYPES.has(mimeType)) return `${name} 的格式暂不支持，请选择 JPG、PNG、WebP 或 GIF。`;
  return undefined;
}

export function ChatScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const listRef = useRef<FlatList>(null);
  const scrollTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const autoFollow = useRef(true);
  // Keep one controller per request rather than one per conversation. This
  // lets a user send a follow-up while an earlier answer is still streaming.
  const activeGenerations = useRef(new Map<string, ActiveGeneration>());
  const [pendingByConversation, setPendingByConversation] = useState<Record<string, PendingAttachment[]>>({});
  const [uploadingConversations, setUploadingConversations] = useState<Set<string>>(() => new Set());
  const [uploadStatesByConversation, setUploadStatesByConversation] = useState<Record<string, Record<string, AttachmentUploadState>>>({});
  const uploadedAttachments = useRef(new Map<string, Map<string, AttachmentRef>>());

  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const settings = useAppStore((state) => state.settings);
  const [availableModels, setAvailableModels] = useState<string[]>(() => (settings.model.trim() ? [settings.model.trim()] : []));
  const [optionsVisible, setOptionsVisible] = useState(false);
  const accessToken = useAppStore((state) => state.accessToken);
  const currentUser = useAppStore((state) => state.user);
  const newConversation = useAppStore((state) => state.newConversation);
  const beginTurn = useAppStore((state) => state.beginTurn);
  const appendDelta = useAppStore((state) => state.appendAssistantDelta);
  const completeAssistant = useAppStore((state) => state.completeAssistant);
  const replaceAssistantContent = useAppStore((state) => state.replaceAssistantContent);
  const failAssistant = useAppStore((state) => state.failAssistant);
  const cancelAssistant = useAppStore((state) => state.cancelAssistant);
  const prepareRegeneration = useAppStore((state) => state.prepareRegeneration);
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus);
  const updateSettings = useAppStore((state) => state.updateSettings);

  useEffect(() => {
    let cancelled = false;
    const currentModel = settings.model.trim();
    const keepCurrentModel = () => {
      if (!cancelled) setAvailableModels(currentModel ? [currentModel] : []);
    };

    if (!accessToken || !settings.serverUrl.trim()) {
      keepCurrentModel();
      return () => { cancelled = true; };
    }
    void fetchGatewayModels(settings.serverUrl, accessToken)
      .then((result) => {
        if (cancelled) return;
        const models = [...new Set(result.models.map((model) => model.trim()).filter(Boolean))];
        const selectedModel = selectGatewayModel(useAppStore.getState().settings.model, models, result.defaultModel);
        setAvailableModels(models.length ? models : (selectedModel ? [selectedModel] : []));
        if (selectedModel !== useAppStore.getState().settings.model) updateSettings({ model: selectedModel });
      })
      .catch(keepCurrentModel);
    return () => { cancelled = true; };
  }, [accessToken, settings.model, settings.serverUrl, updateSettings]);

  const conversation = useMemo(
    () => conversations.find((item) => item.id === activeConversationId) ?? conversations[0],
    [conversations, activeConversationId],
  );
  const currentConversationId = conversation?.id ?? '';
  const pendingAttachments = pendingByConversation[currentConversationId] ?? [];
  const uploadStates = uploadStatesByConversation[currentConversationId] ?? {};
  const generating = Boolean(conversation?.messages.some((message) => message.status === 'streaming'));
  const uploading = uploadingConversations.has(currentConversationId);

  const clearScrollTimers = useCallback(() => {
    for (const timer of scrollTimers.current) clearTimeout(timer);
    scrollTimers.current = [];
  }, []);

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  const scheduleScrollToBottom = useCallback((force = false) => {
    if (force) autoFollow.current = true;
    if (!force && !autoFollow.current) return;
    clearScrollTimers();
    // Android lays out the IME, the composer and the FlatList in separate
    // frames. Repeating the scroll after each frame keeps the newest message
    // above the keyboard, like a native chat app.
    scrollTimers.current = [0, 80, 180, 320, 500].map((delay) => setTimeout(() => {
      if (autoFollow.current) scrollToBottom(delay > 0);
    }, delay));
  }, [clearScrollTimers, scrollToBottom]);

  const isVisibleConversation = useCallback((conversationId: string) => (
    useAppStore.getState().activeConversationId === conversationId
  ), []);

  const removeActiveGeneration = useCallback((conversationId: string, requestId: string) => {
    const active = activeGenerations.current.get(requestId);
    if (active?.conversationId === conversationId) activeGenerations.current.delete(requestId);
  }, []);

  const updateUploadState = useCallback((conversationId: string, localId: string, patch: Partial<AttachmentUploadState>) => {
    setUploadStatesByConversation((current) => {
      const conversationStates = current[conversationId] ?? {};
      const previous = conversationStates[localId] ?? { status: 'queued' as const, progress: 0 };
      return {
        ...current,
        [conversationId]: {
          ...conversationStates,
          [localId]: { ...previous, ...patch },
        },
      };
    });
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="打开对话设置"
          onPress={() => setOptionsVisible(true)}
          style={styles.headerTitleButton}
        >
          <View style={styles.headerTitle}>
            <Text numberOfLines={1} style={[styles.headerName, { color: theme.colors.text }]}>Nova</Text>
            <Text numberOfLines={1} style={[styles.headerModel, { color: theme.colors.textTertiary }]}>{settings.model || '未选择模型'}</Text>
          </View>
          <Ionicons name="chevron-down" size={15} color={theme.colors.textSecondary} />
        </Pressable>
      ),
      headerLeft: () => <IconButton name="menu-outline" accessibilityLabel="打开对话历史" onPress={() => navigation.navigate('History')} />,
      headerRight: () => (
        <View style={styles.headerActions}>
          <IconButton name="add-outline" accessibilityLabel="新建对话" onPress={() => { newConversation(); void Haptics.selectionAsync(); }} />
          <IconButton name="settings-outline" accessibilityLabel="打开设置" onPress={() => navigation.navigate('Settings')} />
        </View>
      ),
    });
  }, [navigation, newConversation, settings.model, theme.colors.text, theme.colors.textSecondary, theme.colors.textTertiary]);

  const runGeneration = useCallback((conversationId: string, assistantMessageId: string): boolean => {
    const currentState = useAppStore.getState();
    const currentConversation = currentState.conversations.find((item) => item.id === conversationId);
    if (!currentConversation) return false;
    const context = buildConversationContext(currentConversation.messages, assistantMessageId);
    if (!context.length) {
      failAssistant(conversationId, assistantMessageId, '没有可发送的消息内容。', false);
      return false;
    }

    const currentSettings = currentState.settings;
    const requestId = createId();
    const request: GenerateRequest = {
      requestId,
      conversationId,
      deviceId: currentState.deviceId,
      messages: context,
      options: {
        model: currentSettings.model.trim() || DEFAULT_MODEL_ID,
        reasoningEffort: currentSettings.reasoningEffort,
        verbosity: currentSettings.verbosity,
        instructions: currentSettings.instructions,
        maxOutputTokens: currentSettings.maxOutputTokens,
        webSearch: currentSettings.webSearch,
        codeInterpreter: currentSettings.codeInterpreter,
      },
    };

    setConnectionStatus('checking');
    const controller = startGeneration({
      serverUrl: currentSettings.serverUrl,
      accessToken: currentState.accessToken,
      availableModels,
      request,
      handlers: {
        onStarted: () => setConnectionStatus('online'),
        onDelta: (delta) => {
          appendDelta(conversationId, assistantMessageId, delta);
          if (isVisibleConversation(conversationId) && autoFollow.current) scrollToBottom(false);
        },
        onTextSnapshot: (text) => {
          replaceAssistantContent(conversationId, assistantMessageId, text);
          if (isVisibleConversation(conversationId) && autoFollow.current) scrollToBottom(false);
        },
        onDone: (details) => {
          // A text model can internally route an image request to gpt-image-*.
          // Do not replace the user's selected conversation model with that
          // implementation detail.
          if (details.model && !isImageModelId(request.options.model) && !isImageModelId(details.model)
            && details.model !== useAppStore.getState().settings.model) {
            updateSettings({ model: details.model });
          }
          completeAssistant(conversationId, assistantMessageId, details.usage, details.attachments);
          removeActiveGeneration(conversationId, requestId);
          setConnectionStatus('online');
          if (isVisibleConversation(conversationId)) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            scrollToBottom();
          }
        },
        onCancelled: () => {
          cancelAssistant(conversationId, assistantMessageId);
          removeActiveGeneration(conversationId, requestId);
        },
        onError: (error) => {
          failAssistant(conversationId, assistantMessageId, friendlyNetworkError(error.message), error.retryable);
          removeActiveGeneration(conversationId, requestId);
          if (['network_error', 'connection_closed', 'hello_timeout', 'stream_stalled'].includes(error.code)) setConnectionStatus('offline');
          if (isVisibleConversation(conversationId)) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            scrollToBottom();
          }
        },
      },
    });
    activeGenerations.current.set(requestId, { controller, requestId, conversationId, messageId: assistantMessageId });
    return true;
  }, [appendDelta, availableModels, cancelAssistant, completeAssistant, failAssistant, isVisibleConversation, removeActiveGeneration, replaceAssistantContent, scrollToBottom, setConnectionStatus, updateSettings]);

  const addPendingAttachments = useCallback((conversationId: string, additions: PendingAttachment[]) => {
    setPendingByConversation((current) => {
      const existing = current[conversationId] ?? [];
      const known = new Set(existing.map((item) => `${item.uri}|${item.name}`));
      const unique = additions.filter((item) => !known.has(`${item.uri}|${item.name}`));
      return { ...current, [conversationId]: [...existing, ...unique].slice(0, MAX_ATTACHMENTS) };
    });
  }, []);


  const pickImages = useCallback(async () => {
    if (!conversation) return;
    const remaining = MAX_ATTACHMENTS - pendingAttachments.length;
    if (remaining <= 0) { Alert.alert('附件已满', '每条消息最多可以添加 8 个附件。'); return; }
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('需要照片权限', '请在系统设置中允许 Nova 访问照片，才能选择图片。');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 1,
        orderedSelection: true,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        shouldDownloadFromNetwork: true,
      });
      if (result.canceled) return;
      const additions: PendingAttachment[] = [];
      const errors: string[] = [];
      result.assets.slice(0, remaining).forEach((asset, index) => {
        const mimeType = imageMimeType(asset.uri, asset.mimeType);
        const name = imageFileName(asset.uri, asset.fileName, index);
        const error = attachmentValidationError(name, mimeType, asset.fileSize);
        if (error) errors.push(error);
        else additions.push({ localId: createId(), uri: asset.uri, name, mimeType, size: asset.fileSize, kind: 'image' });
      });
      if (additions.length) addPendingAttachments(conversation.id, additions);
      if (errors.length) Alert.alert('部分图片未添加', errors.slice(0, 4).join('\n'));
    } catch (error) {
      Alert.alert('无法选择图片', error instanceof Error ? error.message : '图片选择器发生错误，请重试。');
    }
  }, [addPendingAttachments, conversation, pendingAttachments.length]);

  const pickDocuments = useCallback(async () => {
    if (!conversation) return;
    const remaining = MAX_ATTACHMENTS - pendingAttachments.length;
    if (remaining <= 0) { Alert.alert('附件已满', '每条消息最多可以添加 8 个附件。'); return; }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      const additions: PendingAttachment[] = [];
      const errors: string[] = [];
      result.assets.slice(0, remaining).forEach((asset) => {
        const mimeType = asset.mimeType?.toLowerCase() === 'application/pdf' || asset.name.toLowerCase().endsWith('.pdf')
          ? 'application/pdf'
          : (asset.mimeType ?? 'application/octet-stream');
        const error = mimeType !== 'application/pdf'
          ? `${asset.name} 不是 PDF 文件。`
          : attachmentValidationError(asset.name, mimeType, asset.size);
        if (error) errors.push(error);
        else additions.push({ localId: createId(), uri: asset.uri, name: asset.name, mimeType, size: asset.size, kind: 'document' });
      });
      if (additions.length) addPendingAttachments(conversation.id, additions);
      if (result.assets.length > remaining) errors.push(`本次只添加了前 ${remaining} 个文件。`);
      if (errors.length) Alert.alert('部分文件未添加', errors.slice(0, 4).join('\n'));
    } catch (error) {
      Alert.alert('无法选择 PDF', error instanceof Error ? error.message : '文档选择器发生错误，请重试。');
    }
  }, [addPendingAttachments, conversation, pendingAttachments.length]);

  const removePendingAttachment = useCallback((localId: string) => {
    if (!conversation) return;
    uploadedAttachments.current.get(conversation.id)?.delete(localId);
    updateUploadState(conversation.id, localId, { status: 'queued', progress: 0, error: undefined });
    setPendingByConversation((current) => ({
      ...current,
      [conversation.id]: (current[conversation.id] ?? []).filter((item) => item.localId !== localId),
    }));
    setUploadStatesByConversation((current) => {
      const next = { ...current };
      if (next[conversation.id]) {
        const conversationStates = { ...next[conversation.id] };
        delete conversationStates[localId];
        next[conversation.id] = conversationStates;
      }
      return next;
    });
  }, [conversation, updateUploadState]);

  const send = useCallback(async (text: string): Promise<boolean> => {
    if (!conversation) return false;
    const currentState = useAppStore.getState();
    const currentSettings = currentState.settings;
    if (!currentSettings.serverUrl.trim()) { navigation.navigate('Settings'); return false; }

    const conversationId = conversation.id;
    const selectedAttachments = pendingByConversation[conversationId] ?? [];
    if (!text.trim() && !selectedAttachments.length) return false;
    if (!currentState.accessToken) {
      Alert.alert('登录已失效', '请重新登录后再发送消息。');
      return false;
    }

    setUploadingConversations((current) => new Set(current).add(conversationId));
    for (const attachment of selectedAttachments) {
      updateUploadState(conversationId, attachment.localId, { status: 'queued', progress: 0, error: undefined });
    }
    try {
      const uploaded: AttachmentRef[] = [];
      const cachedForConversation = uploadedAttachments.current.get(conversationId) ?? new Map<string, AttachmentRef>();
      uploadedAttachments.current.set(conversationId, cachedForConversation);
      for (const attachment of selectedAttachments) {
        const cached = cachedForConversation.get(attachment.localId);
        if (cached) {
          updateUploadState(conversationId, attachment.localId, { status: 'complete', progress: 100 });
          uploaded.push(cached);
          continue;
        }
        updateUploadState(conversationId, attachment.localId, { status: 'uploading', progress: 0, error: undefined });
        try {
          const result = await uploadAttachment(currentSettings.serverUrl, currentState.accessToken, attachment, ({ bytesSent, totalBytes }) => {
            const progress = uploadProgressPercent(bytesSent, totalBytes);
            updateUploadState(conversationId, attachment.localId, {
              status: 'uploading',
              ...(progress === undefined ? {} : { progress }),
            });
          });
          cachedForConversation.set(attachment.localId, result);
          updateUploadState(conversationId, attachment.localId, { status: 'complete', progress: 100, error: undefined });
          uploaded.push(result);
        } catch (error) {
          const message = error instanceof GatewayApiError ? error.message : error instanceof Error ? error.message : '附件上传失败，请重试。';
          updateUploadState(conversationId, attachment.localId, { status: 'error', error: '上传失败，可重试' });
          throw new AttachmentUploadFailure(attachment.name, message);
        }
      }
      const uploadedIds = new Set(selectedAttachments.map((item) => item.localId));
      setPendingByConversation((current) => ({
        ...current,
        [conversationId]: (current[conversationId] ?? []).filter((item) => !uploadedIds.has(item.localId)),
      }));
      uploadedAttachments.current.delete(conversationId);
      setUploadStatesByConversation((current) => {
        const next = { ...current };
        delete next[conversationId];
        return next;
      });
      autoFollow.current = true;
      const turn = beginTurn(text, uploaded, conversationId);
      if (isVisibleConversation(turn.conversationId)) scrollToBottom(false);
      if (!runGeneration(turn.conversationId, turn.assistantMessageId)) {
        failAssistant(turn.conversationId, turn.assistantMessageId, '当前对话已有回复正在生成。', true);
        return false;
      }
      return true;
    } catch (error) {
      const message = error instanceof AttachmentUploadFailure
        ? `“${error.fileName}”上传失败：${error.message}`
        : error instanceof GatewayApiError ? error.message : error instanceof Error ? error.message : '附件上传失败，请重试。';
      Alert.alert('附件上传失败', message);
      return false;
    } finally {
      setUploadingConversations((current) => {
        const next = new Set(current);
        next.delete(conversationId);
        return next;
      });
    }
  }, [beginTurn, conversation, failAssistant, isVisibleConversation, navigation, pendingByConversation, runGeneration, scrollToBottom, updateUploadState]);

  const stop = useCallback(() => {
    if (!conversation) return;
    const active = [...activeGenerations.current.values()].filter((item) => item.conversationId === conversation.id);
    if (!active.length) return;
    for (const generation of active) {
      generation.controller.cancel();
      cancelAssistant(generation.conversationId, generation.messageId);
      removeActiveGeneration(generation.conversationId, generation.requestId);
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [cancelAssistant, conversation, removeActiveGeneration]);

  const regenerate = useCallback((messageId: string) => {
    if (!conversation) return;
    if (prepareRegeneration(conversation.id, messageId)) runGeneration(conversation.id, messageId);
  }, [conversation, prepareRegeneration, runGeneration]);

  useEffect(() => () => {
    for (const active of activeGenerations.current.values()) active.controller.cancel();
    activeGenerations.current.clear();
    clearScrollTimers();
  }, [clearScrollTimers]);

  useEffect(() => {
    const existing = new Set(conversations.map((item) => item.id));
    for (const [requestId, active] of activeGenerations.current) {
      if (!existing.has(active.conversationId)) {
        active.controller.cancel();
        activeGenerations.current.delete(requestId);
      }
    }
  }, [conversations]);

  useEffect(() => {
    const eventNames = Platform.OS === 'ios'
      ? ['keyboardWillShow', 'keyboardWillChangeFrame'] as const
      : ['keyboardDidShow', 'keyboardDidChangeFrame'] as const;
    const subscriptions = eventNames.map((eventName) => Keyboard.addListener(eventName, () => {
      scheduleScrollToBottom(true);
    }));
    return () => {
      subscriptions.forEach((subscription) => subscription.remove());
      clearScrollTimers();
    };
  }, [clearScrollTimers, scheduleScrollToBottom]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    autoFollow.current = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
  };

  if (!conversation) return null;
  const content = (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="打开模型和对话设置"
        onPress={() => setOptionsVisible(true)}
        style={({ pressed }) => [styles.optionsBar, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }, pressed && { opacity: 0.78 }]}
      >
        <View style={styles.optionsMain}>
          <View style={[styles.optionsIcon, { backgroundColor: theme.colors.primarySoft }]}>
            <Ionicons name="cube-outline" size={18} color={theme.colors.primary} />
          </View>
          <View style={styles.optionsText}>
            <Text style={[styles.optionsLabel, { color: theme.colors.textSecondary }]}>当前模型</Text>
            <Text numberOfLines={1} style={[styles.optionsModel, { color: theme.colors.text }]}>{settings.model || '未选择模型'}</Text>
          </View>
        </View>
        <View style={styles.optionsMeta}>
          <Text style={[styles.optionsEffort, { color: theme.colors.primary }]}>{reasoningLabels[settings.reasoningEffort] ?? settings.reasoningEffort}</Text>
          <Ionicons name="options-outline" size={17} color={theme.colors.textSecondary} />
          <Ionicons name="chevron-forward" size={17} color={theme.colors.textTertiary} />
        </View>
      </Pressable>
      {conversation.messages.length === 0 ? (
        <EmptyState onSuggestion={(prompt) => { void send(prompt); }} />
      ) : (
        <FlatList
          ref={listRef}
          style={styles.messageList}
          data={conversation.messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              serverUrl={settings.serverUrl}
              accessToken={accessToken}
              user={currentUser}
              onRetry={item.role === 'assistant' ? () => regenerate(item.id) : undefined}
            />
          )}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          onScroll={onScroll}
          scrollEventThrottle={80}
          onContentSizeChange={() => { scheduleScrollToBottom(false); }}
          ListFooterComponent={<Text style={[styles.disclaimer, { color: theme.colors.textTertiary }]}>AI 可能会出错，重要信息请核实。</Text>}
        />
      )}
      <Composer
        key={conversation.id}
        generating={generating}
        uploading={uploading}
        attachments={pendingAttachments}
        uploadStates={uploadStates}
        onAddImage={() => { void pickImages(); }}
        onAddDocument={() => { void pickDocuments(); }}
        onRemoveAttachment={removePendingAttachment}
        onSend={send}
        onStop={stop}
        onInputFocus={() => scheduleScrollToBottom(true)}
        onInputContentSizeChange={() => scheduleScrollToBottom(false)}
      />
      <ChatOptionsModal
        visible={optionsVisible}
        models={availableModels}
        selectedModel={settings.model}
        reasoningEffort={settings.reasoningEffort}
        verbosity={settings.verbosity}
        onSelectModel={(model) => updateSettings({ model })}
        onSelectReasoning={(reasoningEffort) => updateSettings({ reasoningEffort })}
        onSelectVerbosity={(verbosity) => updateSettings({ verbosity })}
        onClose={() => setOptionsVisible(false)}
      />
    </>
  );

  return (
    <KeyboardAwareView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      iosKeyboardVerticalOffset={88}
    >
      {content}
    </KeyboardAwareView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  messageList: { flex: 1 },
  listContent: { paddingTop: 8, paddingBottom: 8, flexGrow: 1 },
  headerTitleButton: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: 235 },
  headerTitle: { alignItems: 'center', maxWidth: 215 },
  headerName: { fontSize: 15, fontWeight: '700', maxWidth: 215 },
  headerModel: { fontSize: 10, marginTop: 1, maxWidth: 215 },
  headerActions: { flexDirection: 'row', marginRight: -6 },
  optionsBar: { minHeight: 58, marginHorizontal: 12, marginTop: 8, marginBottom: 2, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 15, borderWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optionsMain: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  optionsIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  optionsText: { flex: 1, minWidth: 0 },
  optionsLabel: { fontSize: 10, lineHeight: 14 },
  optionsModel: { fontSize: 13, fontWeight: '700', marginTop: 1 },
  optionsMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingLeft: 8 },
  optionsEffort: { fontSize: 12, fontWeight: '800' },
  disclaimer: { textAlign: 'center', fontSize: 11, paddingVertical: 12, paddingHorizontal: 16 },
});
