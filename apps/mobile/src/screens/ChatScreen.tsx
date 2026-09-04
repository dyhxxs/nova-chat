import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, Platform, Pressable, StyleSheet, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ThemedText as Text } from '../components/ThemedText';
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
import { resumeGeneration, startGeneration, type GenerationController } from '../services/chatClient';
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
const IMAGE_MIME_PREFIX = 'image/';

const reasoningLabels: Record<string, string> = { none: '直接回答', low: '轻度思考', medium: '中等思考', high: '深度思考', xhigh: '高强度思考', max: '高强度思考' };

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

function pickedMimeType(name: string, provided?: string | null): string {
  const normalized = provided?.toLowerCase().split(';', 1)[0]?.trim();
  if (normalized && normalized !== 'application/octet-stream' && normalized !== 'binary/octet-stream') return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  const extension = name.toLowerCase().split(/[?#]/, 1)[0]?.split('.').pop() ?? '';
  const byExtension: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
    pdf: 'application/pdf', txt: 'text/plain', text: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values', json: 'application/json', jsonl: 'application/jsonl', geojson: 'application/geo+json', graphql: 'application/graphql', gql: 'application/graphql', xml: 'application/xml', html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', ts: 'text/typescript', tsx: 'text/typescript', jsx: 'text/javascript', py: 'text/x-python', java: 'text/x-java-source', kt: 'text/x-kotlin', sql: 'text/x-sql', srt: 'text/plain', vtt: 'text/vtt', ics: 'text/calendar', vcf: 'text/vcard', properties: 'text/plain', env: 'text/plain', yaml: 'application/yaml', yml: 'application/yaml', toml: 'application/toml', rtf: 'application/rtf',
    doc: 'application/msword', dot: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dotx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.template', docm: 'application/vnd.ms-word.document.macroenabled.12', xls: 'application/vnd.ms-excel', xlt: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', xltx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.template', xlsm: 'application/vnd.ms-excel.sheet.macroenabled.12', ppt: 'application/vnd.ms-powerpoint', pps: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', potx: 'application/vnd.openxmlformats-officedocument.presentationml.template', pptm: 'application/vnd.ms-powerpoint.presentation.macroenabled.12', potm: 'application/vnd.ms-powerpoint.template.macroenabled.12', ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow', ppsm: 'application/vnd.ms-powerpoint.slideshow.macroenabled.12', epub: 'application/epub+zip', mobi: 'application/x-mobipocket-ebook', odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet', odp: 'application/vnd.oasis.opendocument.presentation',
  };
  return byExtension[extension] ?? normalized ?? 'application/octet-stream';
}

function attachmentValidationError(name: string, _mimeType: string, size?: number): string | undefined {
  if (size !== undefined && size > MAX_FILE_BYTES) return `${name} 超过 25 MB，无法添加。`;
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
  const modelCatalogRequest = useRef(0);
  const [pendingByConversation, setPendingByConversation] = useState<Record<string, PendingAttachment[]>>({});
  const [uploadingConversations, setUploadingConversations] = useState<Set<string>>(() => new Set());
  const [uploadStatesByConversation, setUploadStatesByConversation] = useState<Record<string, Record<string, AttachmentUploadState>>>({});
  const uploadedAttachments = useRef(new Map<string, Map<string, AttachmentRef>>());

  const conversations = useAppStore((state) => state.conversations);
  const activeConversationId = useAppStore((state) => state.activeConversationId);
  const settings = useAppStore((state) => state.settings);
  const [availableModels, setAvailableModels] = useState<string[]>(() => (settings.model.trim() ? [settings.model.trim()] : []));
  const [optionsVisible, setOptionsVisible] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
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
  const bindAssistantGeneration = useAppStore((state) => state.bindAssistantGeneration);
  const setConnectionStatus = useAppStore((state) => state.setConnectionStatus);
  const updateSettings = useAppStore((state) => state.updateSettings);

  const refreshAvailableModels = useCallback(async () => {
    const requestSequence = ++modelCatalogRequest.current;
    const currentState = useAppStore.getState();
    const serverUrl = currentState.settings.serverUrl.trim();
    const token = currentState.accessToken;
    const keepKnownModels = () => {
      if (modelCatalogRequest.current !== requestSequence) return;
      setAvailableModels((current) => {
        if (current.length) return current;
        const currentModel = useAppStore.getState().settings.model.trim();
        return currentModel ? [currentModel] : [];
      });
    };

    if (!token || !serverUrl) {
      keepKnownModels();
      return;
    }
    try {
      const result = await fetchGatewayModels(serverUrl, token);
      if (modelCatalogRequest.current !== requestSequence) return;
      const models = [...new Set(result.models.map((model) => model.trim()).filter(Boolean))];
      const latestModel = useAppStore.getState().settings.model;
      const selectedModel = selectGatewayModel(latestModel, models, result.defaultModel);
      setAvailableModels(models.length ? models : (selectedModel ? [selectedModel] : []));
      if (selectedModel !== latestModel) updateSettings({ model: selectedModel });
    } catch {
      keepKnownModels();
    }
  }, [updateSettings]);

  useEffect(() => {
    const currentModel = useAppStore.getState().settings.model.trim();
    setAvailableModels(currentModel ? [currentModel] : []);
    void refreshAvailableModels();
    return () => { modelCatalogRequest.current += 1; };
  }, [accessToken, refreshAvailableModels, settings.serverUrl]);

  const openOptions = useCallback(() => {
    setOptionsVisible(true);
    void refreshAvailableModels();
  }, [refreshAvailableModels]);

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
    autoFollow.current = true;
    setShowScrollButton(false);
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
          onPress={openOptions}
          style={styles.headerTitleButton}
        >
          <View style={styles.headerTitle}>
            <Text numberOfLines={1} style={[styles.headerName, { color: theme.colors.text, fontFamily: theme.fonts.bold }]}>Nova</Text>
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
  }, [navigation, newConversation, openOptions, theme.colors.text, theme.colors.textSecondary]);

  const runGeneration = useCallback((conversationId: string, assistantMessageId: string): boolean => {
    const currentState = useAppStore.getState();
    const currentConversation = currentState.conversations.find((item) => item.id === conversationId);
    const assistantMessage = currentConversation?.messages.find((item) => item.id === assistantMessageId);
    if (!currentConversation || assistantMessage?.role !== 'assistant' || assistantMessage.status !== 'streaming') return false;
    if ([...activeGenerations.current.values()].some((item) => item.messageId === assistantMessageId)) return false;
    const context = buildConversationContext(currentConversation.messages, assistantMessageId);
    if (!context.length) {
      failAssistant(conversationId, assistantMessageId, '没有可发送的消息内容。', false);
      return false;
    }

    const currentSettings = currentState.settings;
    const requestedModel = assistantMessage.requestedModel?.trim() || currentSettings.model.trim() || DEFAULT_MODEL_ID;
    const requestId = createId();
    const frozenOptions = {
      reasoningEffort: currentSettings.reasoningEffort,
      verbosity: currentSettings.verbosity,
      maxOutputTokens: currentSettings.maxOutputTokens,
      webSearch: currentSettings.webSearch,
      codeInterpreter: currentSettings.codeInterpreter,
    };
    if (!bindAssistantGeneration(conversationId, assistantMessageId, {
      requestId,
      options: frozenOptions,
      startedAt: Date.now(),
    })) return false;
    const request: GenerateRequest = {
      requestId,
      conversationId,
      deviceId: currentState.deviceId,
      messages: context,
      options: {
        model: requestedModel,
        ...frozenOptions,
        instructions: currentSettings.instructions,
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
          appendDelta(conversationId, assistantMessageId, delta, requestId);
          if (isVisibleConversation(conversationId) && autoFollow.current) scrollToBottom(false);
        },
        onTextSnapshot: (text) => {
          replaceAssistantContent(conversationId, assistantMessageId, text, requestId);
          if (isVisibleConversation(conversationId) && autoFollow.current) scrollToBottom(false);
        },
        onDone: (details) => {
          completeAssistant(conversationId, assistantMessageId, {
            requestId,
            model: details.model,
            usage: details.usage,
            attachments: details.attachments,
          });
          removeActiveGeneration(conversationId, requestId);
          setConnectionStatus('online');
          if (isVisibleConversation(conversationId)) {
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            scrollToBottom();
          }
        },
        onCancelled: () => {
          cancelAssistant(conversationId, assistantMessageId, requestId);
          removeActiveGeneration(conversationId, requestId);
        },
        onError: (error) => {
          failAssistant(conversationId, assistantMessageId, friendlyNetworkError(error.message), error.retryable, requestId);
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
  }, [appendDelta, availableModels, bindAssistantGeneration, cancelAssistant, completeAssistant, failAssistant, isVisibleConversation, removeActiveGeneration, replaceAssistantContent, scrollToBottom, setConnectionStatus]);

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

  const takePhoto = useCallback(async () => {
    if (!conversation) return;
    if (pendingAttachments.length >= MAX_ATTACHMENTS) {
      Alert.alert('附件已满', '每条消息最多可以添加 8 个附件。');
      return;
    }
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('需要相机权限', '请在系统设置中允许 Nova 使用相机，才能拍照提问。');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 1,
        allowsEditing: false,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const mimeType = imageMimeType(asset.uri, asset.mimeType);
      const name = imageFileName(asset.uri, asset.fileName, 0);
      const error = attachmentValidationError(name, mimeType, asset.fileSize);
      if (error) {
        Alert.alert('照片未添加', error);
        return;
      }
      addPendingAttachments(conversation.id, [{
        localId: createId(),
        uri: asset.uri,
        name,
        mimeType,
        size: asset.fileSize,
        kind: 'image',
      }]);
      void Haptics.selectionAsync();
    } catch (error) {
      Alert.alert('无法拍照', error instanceof Error ? error.message : '相机发生错误，请重试。');
    }
  }, [addPendingAttachments, conversation, pendingAttachments.length]);

  const pickDocuments = useCallback(async () => {
    if (!conversation) return;
    const remaining = MAX_ATTACHMENTS - pendingAttachments.length;
    if (remaining <= 0) { Alert.alert('附件已满', '每条消息最多可以添加 8 个附件。'); return; }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;
      const additions: PendingAttachment[] = [];
      const errors: string[] = [];
      result.assets.slice(0, remaining).forEach((asset) => {
        const mimeType = pickedMimeType(asset.name, asset.mimeType);
        const error = attachmentValidationError(asset.name, mimeType, asset.size);
        if (error) errors.push(error);
        else additions.push({ localId: createId(), uri: asset.uri, name: asset.name, mimeType, size: asset.size, kind: mimeType.startsWith(IMAGE_MIME_PREFIX) ? 'image' : 'document' });
      });
      if (additions.length) addPendingAttachments(conversation.id, additions);
      if (result.assets.length > remaining) errors.push(`本次只添加了前 ${remaining} 个文件。`);
      if (errors.length) Alert.alert('部分文件未添加', errors.slice(0, 4).join('\n'));
    } catch (error) {
      Alert.alert('无法添加文件', error instanceof Error ? error.message : '文件选择器发生错误，请重试。');
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
      const turn = beginTurn(text, uploaded, conversationId, currentSettings.model);
      if (isVisibleConversation(turn.conversationId)) scrollToBottom(false);
      if (!runGeneration(turn.conversationId, turn.assistantMessageId)) {
        failAssistant(turn.conversationId, turn.assistantMessageId, '无法启动生成请求，请点击重新生成。', true);
      }
      // The turn is already stored in history, so clear the composer even if
      // generation could not be started. This avoids sending the same input twice.
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
      cancelAssistant(generation.conversationId, generation.messageId, generation.requestId);
      removeActiveGeneration(generation.conversationId, generation.requestId);
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [cancelAssistant, conversation, removeActiveGeneration]);

  const regenerate = useCallback((messageId: string) => {
    if (!conversation || !prepareRegeneration(conversation.id, messageId)) return;
    if (!runGeneration(conversation.id, messageId)) {
      failAssistant(conversation.id, messageId, '无法启动生成请求，请稍后重试。', true);
    }
  }, [conversation, failAssistant, prepareRegeneration, runGeneration]);

  useEffect(() => {
    const serverUrl = settings.serverUrl.trim();
    if (!accessToken || !serverUrl) return;

    for (const item of conversations) {
      for (const message of item.messages) {
        const requestId = message.generationRequestId?.trim();
        if (message.role !== 'assistant' || message.status !== 'streaming' || !requestId) continue;
        if (activeGenerations.current.has(requestId)) continue;
        if ([...activeGenerations.current.values()].some((active) => active.messageId === message.id)) continue;

        setConnectionStatus('checking');
        const controller = resumeGeneration({
          serverUrl,
          accessToken,
          requestId,
          conversationId: item.id,
          initialText: message.content,
          handlers: {
            onStarted: () => setConnectionStatus('online'),
            onDelta: (delta) => {
              appendDelta(item.id, message.id, delta, requestId);
              if (isVisibleConversation(item.id) && autoFollow.current) scrollToBottom(false);
            },
            onTextSnapshot: (text) => {
              replaceAssistantContent(item.id, message.id, text, requestId);
              if (isVisibleConversation(item.id) && autoFollow.current) scrollToBottom(false);
            },
            onDone: (details) => {
              completeAssistant(item.id, message.id, {
                requestId,
                model: details.model,
                usage: details.usage,
                attachments: details.attachments,
              });
              removeActiveGeneration(item.id, requestId);
              setConnectionStatus('online');
              if (isVisibleConversation(item.id)) scrollToBottom();
            },
            onCancelled: () => {
              cancelAssistant(item.id, message.id, requestId);
              removeActiveGeneration(item.id, requestId);
            },
            onError: (error) => {
              failAssistant(item.id, message.id, friendlyNetworkError(error.message), error.retryable, requestId);
              removeActiveGeneration(item.id, requestId);
              if (error.code !== 'job_not_found') setConnectionStatus('offline');
            },
          },
        });
        activeGenerations.current.set(requestId, {
          controller,
          requestId,
          conversationId: item.id,
          messageId: message.id,
        });
      }
    }
  }, [accessToken, appendDelta, cancelAssistant, completeAssistant, conversations, failAssistant, isVisibleConversation, removeActiveGeneration, replaceAssistantContent, scrollToBottom, setConnectionStatus, settings.serverUrl]);

  useEffect(() => () => {
    for (const active of activeGenerations.current.values()) active.controller.dispose();
    activeGenerations.current.clear();
    clearScrollTimers();
  }, [clearScrollTimers]);

  useEffect(() => {
    for (const [requestId, active] of activeGenerations.current) {
      const activeConversation = conversations.find((item) => item.id === active.conversationId);
      const activeMessage = activeConversation?.messages.find((item) => item.id === active.messageId);
      if (!activeConversation || activeMessage?.status !== 'streaming') {
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
    const nearBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height) < 120;
    autoFollow.current = nearBottom;
    setShowScrollButton(!nearBottom);
  };

  if (!conversation) return null;
  const reasoningLabel = reasoningLabels[settings.reasoningEffort] ?? '中等思考';
  const content = (
    <>
      {conversation.messages.length === 0 ? (
        <EmptyState
          onTakePhoto={() => { void takePhoto(); }}
          onSuggestion={(prompt) => { void send(prompt); }}
        />
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
          ListFooterComponent={<Text style={[styles.disclaimer, { color: theme.colors.textTertiary, fontFamily: theme.fonts.regular }]}>AI 可能会出错，重要信息请核实。</Text>}
        />
      )}
      {showScrollButton && conversation.messages.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="回到最新消息"
          onPress={() => scrollToBottom()}
          style={({ pressed }) => [styles.scrollButton, { backgroundColor: theme.colors.surfaceElevated, borderColor: theme.colors.border }, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-down" size={18} color={theme.colors.primary} />
          <Text style={[styles.scrollButtonText, { color: theme.colors.text, fontFamily: theme.fonts.medium }]}>最新消息</Text>
        </Pressable>
      )}
      <Composer
        key={conversation.id}
        generating={generating}
        uploading={uploading}
        attachments={pendingAttachments}
        uploadStates={uploadStates}
        reasoningLabel={reasoningLabel}
        webSearch={settings.webSearch}
        codeInterpreter={settings.codeInterpreter}
        onOpenOptions={openOptions}
        onToggleWebSearch={() => updateSettings({ webSearch: !settings.webSearch })}
        onToggleCodeInterpreter={() => updateSettings({ codeInterpreter: !settings.codeInterpreter })}
        onTakePhoto={() => { void takePhoto(); }}
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
  headerName: { fontSize: 15, fontWeight: '800', letterSpacing: 0.1, maxWidth: 215 },
  headerActions: { flexDirection: 'row', marginRight: -6 },
  scrollButton: {
    position: 'absolute',
    right: 18,
    bottom: 104,
    zIndex: 10,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  scrollButtonText: { fontSize: 12, fontWeight: '700' },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
  disclaimer: { textAlign: 'center', fontSize: 11, paddingVertical: 14, paddingHorizontal: 16 },
});
