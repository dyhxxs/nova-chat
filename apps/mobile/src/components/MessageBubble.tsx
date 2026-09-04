import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, View, type ImageStyle, type TextStyle } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Renderer, useMarkdown, type MarkedStyles } from 'react-native-marked';
import type { AttachmentRef } from '@nova-chat/protocol';
import type { AppAttachment, AppMessage, UserProfile } from '../types';
import { useAppTheme } from '../hooks/useAppTheme';
import { assistantMessageDetails, assistantModelLabel } from '../lib/messageModel';
import { invalidateGatewayImage, loadGatewayImage } from '../services/gatewayImageCache';
import { TypingDots } from './TypingDots';
import { UserAvatar } from './UserAvatar';

type Props = {
  message: AppMessage;
  serverUrl?: string;
  accessToken?: string;
  user?: UserProfile;
  onRetry?: () => void;
};

const DEFAULT_IMAGE_ASPECT_RATIO = 4 / 3;

function validImageAspectRatio(width: number, height: number): number | undefined {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return undefined;
  return width / height;
}

function MarkdownImage({ uri, alt, style }: { uri: string; alt?: string; style?: ImageStyle }) {
  const theme = useAppTheme();
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_IMAGE_ASPECT_RATIO);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setAspectRatio(DEFAULT_IMAGE_ASPECT_RATIO);
    setLoading(true);
    setFailed(false);

    // Resolve dimensions first so portrait and landscape images keep their
    // original proportions instead of being rendered as a cropped card.
    Image.getSize(
      uri,
      (width, height) => {
        if (!active) return;
        const ratio = validImageAspectRatio(width, height);
        if (ratio) setAspectRatio(ratio);
      },
      // Some image hosts reject a separate HEAD/dimension request even though
      // the actual Image request works, so the Image component remains the
      // source of truth for success/failure.
      () => undefined,
    );

    return () => { active = false; };
  }, [uri]);

  if (failed) {
    return (
      <View style={[styles.markdownImageFrame, styles.markdownImageFailure, { backgroundColor: theme.colors.surfaceMuted }]}>
        <Ionicons name="image-outline" size={24} color={theme.colors.textTertiary} />
        <Text style={[styles.imagePlaceholderText, { color: theme.colors.textTertiary }]}>
          {alt ? `图片加载失败：${alt}` : '图片加载失败'}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.markdownImageFrame}>
      <Image
        accessibilityRole="image"
        accessibilityLabel={alt || '图片'}
        source={{ uri }}
        resizeMode="contain"
        onLoad={({ nativeEvent }) => {
          const ratio = validImageAspectRatio(nativeEvent.source.width, nativeEvent.source.height);
          if (ratio) setAspectRatio(ratio);
          setLoading(false);
        }}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        style={[styles.markdownImage, style, { aspectRatio }]}
      />
      {loading && (
        <View pointerEvents="none" style={styles.markdownImageLoading}>
          <ActivityIndicator size="small" color={theme.colors.primary} />
        </View>
      )}
    </View>
  );
}

class SafeRenderer extends Renderer {
  link(children: string | ReactNode[], href: string, styles?: TextStyle, title?: string): ReactNode {
    if (!/^https?:\/\//i.test(href)) return <Text selectable key={this.getKey()} style={styles}>{children}</Text>;
    return <Text selectable accessibilityRole="link" accessibilityLabel={title || '链接'} key={this.getKey()} onPress={() => void Linking.openURL(href)} style={styles}>{children}</Text>;
  }
  image(uri: string, alt?: string, style?: ImageStyle, title?: string): ReactNode {
    return <MarkdownImage key={this.getKey()} uri={uri} alt={alt || title} style={style} />;
  }
  linkImage(href: string, imageUrl: string, alt?: string, style?: ImageStyle, title?: string | null): ReactNode {
    const image = this.image(imageUrl, alt, style, title ?? undefined);
    if (!/^https?:\/\//i.test(href)) return image;
    return (
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={title || alt || '打开图片链接'}
        key={this.getKey()}
        onPress={() => void Linking.openURL(href)}
      >
        {image}
      </Pressable>
    );
  }
}

function AssistantMarkdown({ content }: { content: string }) {
  const theme = useAppTheme();
  const renderer = useMemo(() => new SafeRenderer(), []);
  const styles = useMemo<MarkedStyles>(() => ({
    text: { color: theme.colors.text, fontSize: 16, lineHeight: 25, fontFamily: theme.fonts.regular },
    paragraph: { marginTop: 0, marginBottom: 12 },
    h1: { color: theme.colors.text, fontSize: 25, lineHeight: 32, fontWeight: '700', marginTop: 12, marginBottom: 10 },
    h2: { color: theme.colors.text, fontSize: 21, lineHeight: 28, fontWeight: '700', marginTop: 10, marginBottom: 8 },
    h3: { color: theme.colors.text, fontSize: 18, lineHeight: 25, fontWeight: '700', marginTop: 8, marginBottom: 6 },
    strong: { fontWeight: '700' }, em: { fontStyle: 'italic' },
    link: { color: theme.colors.primary, textDecorationLine: 'underline' },
    blockquote: { backgroundColor: theme.colors.surfaceMuted, borderLeftColor: theme.colors.primary, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 10 },
    codespan: { backgroundColor: theme.colors.codeBackground, color: theme.colors.text, borderRadius: 5, paddingHorizontal: 5, fontFamily: theme.fonts.mono },
    code: { backgroundColor: theme.colors.codeBackground, borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, marginBottom: 12 },
    list: { marginBottom: 10 }, li: { color: theme.colors.text, fontSize: 16, lineHeight: 24, fontFamily: theme.fonts.regular },
    table: { borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth, marginBottom: 12 },
    tableRow: { borderColor: theme.colors.border }, tableCell: { borderColor: theme.colors.border, padding: 7 },
    hr: { height: StyleSheet.hairlineWidth, backgroundColor: theme.colors.border, marginVertical: 12 },
  }), [theme]);
  const elements = useMarkdown(content, {
    renderer,
    styles,
    colorScheme: theme.dark ? 'dark' : 'light',
    theme: { colors: { text: theme.colors.text, code: theme.colors.codeBackground, link: theme.colors.primary, border: theme.colors.border } },
  });
  return <View>{elements}</View>;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileTypeLabel(name: string, mimeType: string): string {
  const extension = name.split(/[?#]/, 1)[0]?.split('.').pop()?.trim().toUpperCase();
  if (extension && extension.length <= 8) return extension;
  if (mimeType.startsWith('image/')) return '图片';
  return '文件';
}

function GatewayAttachmentImage({ attachment, serverUrl, accessToken, user }: {
  attachment: AttachmentRef;
  serverUrl: string;
  accessToken?: string;
  user: boolean;
}) {
  const theme = useAppTheme();
  const [imageUri, setImageUri] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setImageUri(undefined);
    setFailed(false);
    setLoading(true);

    if (Platform.OS === 'web' || !accessToken) {
      setLoading(false);
      setFailed(true);
      return () => { active = false; };
    }

    void loadGatewayImage(serverUrl, accessToken, attachment)
      .then((uri) => {
        if (!active) return;
        setImageUri(uri);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setFailed(true);
      });

    return () => { active = false; };
  }, [accessToken, attachment.id, attachment.mimeType, attachment.size, attempt, serverUrl]);

  const failDecodedImage = () => {
    invalidateGatewayImage(serverUrl, attachment);
    setImageUri(undefined);
    setLoading(false);
    setFailed(true);
  };

  const retry = () => {
    invalidateGatewayImage(serverUrl, attachment);
    setAttempt((current) => current + 1);
  };

  if (imageUri) {
    return (
      <NaturalAttachmentImage
        key={`${imageUri}-${attempt}`}
        uri={imageUri}
        name={attachment.name}
        onError={failDecodedImage}
      />
    );
  }

  return (
    <Pressable
      accessibilityRole={failed ? 'button' : undefined}
      accessibilityLabel={failed ? `重新加载图片 ${attachment.name}` : `正在加载图片 ${attachment.name}`}
      disabled={!failed}
      onPress={retry}
      style={[styles.attachmentImage, styles.imagePlaceholder]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={user ? 'rgba(255,255,255,0.8)' : theme.colors.primary} />
      ) : (
        <>
          <Ionicons name="image-outline" size={25} color={user ? 'rgba(255,255,255,0.85)' : theme.colors.textTertiary} />
          <Text style={[styles.imagePlaceholderText, { color: user ? 'rgba(255,255,255,0.85)' : theme.colors.textTertiary }]}>图片加载失败，点按重试</Text>
        </>
      )}
    </Pressable>
  );
}

function NaturalAttachmentImage({ uri, name, onError }: { uri: string; name: string; onError: () => void }) {
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_IMAGE_ASPECT_RATIO);
  return (
    <Image
      accessibilityRole="image"
      accessibilityLabel={`图片 ${name}`}
      source={{ uri }}
      resizeMode="contain"
      onLoad={({ nativeEvent }) => {
        const ratio = validImageAspectRatio(nativeEvent.source.width, nativeEvent.source.height);
        if (ratio) setAspectRatio(ratio);
      }}
      onError={onError}
      style={[styles.attachmentImage, { aspectRatio }]}
    />
  );
}


function LocalAttachmentImage({ attachment, user }: { attachment: AppAttachment; user: boolean }) {
  const theme = useAppTheme();
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <View style={[styles.attachmentImage, styles.imagePlaceholder]}>
        <Ionicons name="image-outline" size={25} color={user ? 'rgba(255,255,255,0.85)' : theme.colors.textTertiary} />
        <Text style={[styles.imagePlaceholderText, { color: user ? 'rgba(255,255,255,0.85)' : theme.colors.textTertiary }]}>图片缓存已失效，请重新生成</Text>
      </View>
    );
  }
  return (
    <NaturalAttachmentImage uri={attachment.uri ?? ''} name={attachment.name} onError={() => setFailed(true)} />
  );
}

function AttachmentGallery({ attachments, serverUrl, accessToken, user }: {
  attachments: AppAttachment[];
  serverUrl?: string;
  accessToken?: string;
  user: boolean;
}) {
  const theme = useAppTheme();
  if (!attachments.length) return null;
  return (
    <View style={[styles.attachments, user && styles.userAttachments]}>
      {attachments.map((attachment) => {
        if (attachment.kind === 'image' && attachment.uri) {
          return (
            <View key={attachment.id} style={styles.imageCard}>
              <LocalAttachmentImage attachment={attachment} user={user} />
            </View>
          );
        }
        if (attachment.kind === 'image' && serverUrl) {
          return (
            <View key={attachment.id} style={styles.imageCard}>
              <GatewayAttachmentImage
                attachment={attachment}
                serverUrl={serverUrl}
                accessToken={accessToken}
                user={user}
              />
            </View>
          );
        }
        return (
          <View
            key={attachment.id}
            style={[
              styles.documentCard,
              {
                backgroundColor: user ? 'rgba(255,255,255,0.12)' : theme.colors.surfaceMuted,
                borderColor: user ? 'rgba(255,255,255,0.22)' : theme.colors.border,
              },
            ]}
          >
            <Ionicons name={attachment.kind === 'image' ? 'image-outline' : 'document-text-outline'} size={22} color={user ? '#FFFFFF' : theme.colors.primary} />
            <View style={styles.documentMeta}>
              <Text numberOfLines={1} style={[styles.documentName, { color: user ? '#FFFFFF' : theme.colors.text, fontFamily: theme.fonts.medium }]}>{attachment.name}</Text>
              <Text style={[styles.documentSize, { color: user ? 'rgba(255,255,255,0.7)' : theme.colors.textTertiary, fontFamily: theme.fonts.regular }]}>{fileTypeLabel(attachment.name, attachment.mimeType)} · {formatBytes(attachment.size)}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export const MessageBubble = memo(function MessageBubble({ message, serverUrl, accessToken, user, onRetry }: Props) {
  const theme = useAppTheme();
  const [copied, setCopied] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const modelLabel = message.role === 'assistant' ? assistantModelLabel(message) : undefined;
  const messageDetails = useMemo(() => assistantMessageDetails(message), [message]);
  const copy = async () => {
    if (!message.content) return;
    await Clipboard.setStringAsync(message.content);
    void Haptics.selectionAsync();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (message.role === 'user') {
    return (
      <View style={styles.userRow}>
        <View style={styles.userMessageRow}>
          <Pressable onLongPress={() => void copy()} style={[styles.userBubble, { backgroundColor: theme.colors.userBubble }]}>
            <AttachmentGallery attachments={message.attachments} serverUrl={serverUrl} accessToken={accessToken} user />
            {!!message.content && <Text selectable style={[styles.userText, { fontFamily: theme.fonts.regular }]}>{message.content}</Text>}
          </Pressable>
          <UserAvatar user={user} serverUrl={serverUrl} accessToken={accessToken} size={30} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.assistantRow}>
      <View style={[styles.avatar, { backgroundColor: theme.colors.primarySoft }]}><Ionicons name="sparkles" size={16} color={theme.colors.primary} /></View>
      <View style={styles.assistantBody}>
        <AttachmentGallery attachments={message.attachments} serverUrl={serverUrl} accessToken={accessToken} user={false} />
        {!message.content && message.status === 'streaming' ? <TypingDots /> : !!message.content && <AssistantMarkdown content={message.content} />}
        {message.status === 'error' && (
          <View style={[styles.errorBox, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
            <Ionicons name="alert-circle-outline" size={18} color={theme.colors.danger} />
            <Text style={[styles.errorText, { color: theme.colors.textSecondary }]}>{message.errorMessage}</Text>
          </View>
        )}
        {message.status === 'cancelled' && <Text style={[styles.cancelled, { color: theme.colors.textTertiary }]}>已停止生成；这段未完成内容不会加入后续上下文。</Text>}
        {message.status === 'streaming' && (
          <View style={styles.streamingMeta}>
            <ActivityIndicator size="small" color={theme.colors.primary} />
            <Text style={[styles.streamingText, { color: theme.colors.textSecondary }]}>
              {message.generationRequestId ? '正在生成，可离开页面后继续' : '正在生成回复'}
            </Text>
          </View>
        )}
        {(!!modelLabel || messageDetails.length > 0) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={detailsOpen ? '收起回答详情' : '展开回答详情'}
            onPress={() => setDetailsOpen((open) => !open)}
            hitSlop={4}
            style={({ pressed }) => [styles.modelMeta, pressed && { opacity: 0.65 }]}
          >
            <Ionicons name="cube-outline" size={13} color={theme.colors.textTertiary} />
            <Text numberOfLines={detailsOpen ? undefined : 1} style={[styles.modelMetaText, { color: theme.colors.textTertiary }]}>{modelLabel ?? '回答详情'}</Text>
            <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={13} color={theme.colors.textTertiary} />
          </Pressable>
        )}
        {detailsOpen && messageDetails.length > 0 && (
          <View style={[styles.detailsCard, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }]}>
            {messageDetails.map((detail) => (
              <View key={`${detail.label}-${detail.value}`} style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: theme.colors.textTertiary }]}>{detail.label}</Text>
                <Text selectable style={[styles.detailValue, { color: theme.colors.text }]}>{detail.value}</Text>
              </View>
            ))}
          </View>
        )}
        {message.status !== 'streaming' && (
          <View style={styles.actions}>
            {!!message.content && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="复制回复"
                onPress={() => void copy()}
                style={({ pressed }) => [styles.actionButton, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }, pressed && { opacity: 0.65 }]}
              >
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={15} color={copied ? theme.colors.success : theme.colors.textSecondary} />
                <Text style={[styles.actionText, { color: copied ? theme.colors.success : theme.colors.textSecondary, fontFamily: theme.fonts.medium }]}>{copied ? '已复制' : '复制'}</Text>
              </Pressable>
            )}
            {(['error', 'complete', 'cancelled'] as const).includes(message.status as 'error' | 'complete' | 'cancelled') && onRetry && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="重新生成"
                onPress={onRetry}
                style={({ pressed }) => [styles.actionButton, { backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border }, pressed && { opacity: 0.65 }]}
              >
                <Ionicons name="refresh" size={15} color={theme.colors.textSecondary} />
                <Text style={[styles.actionText, { color: theme.colors.textSecondary, fontFamily: theme.fonts.medium }]}>重新生成</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  userRow: { alignItems: 'flex-end', paddingLeft: 42, paddingRight: 16, marginVertical: 10 },
  userMessageRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '100%' },
  userBubble: { maxWidth: '92%', borderRadius: 20, borderBottomRightRadius: 6, paddingHorizontal: 13, paddingVertical: 10 },
  userText: { color: '#FFFFFF', fontSize: 16, lineHeight: 23, paddingHorizontal: 3 },
  assistantRow: { flexDirection: 'row', paddingHorizontal: 16, marginVertical: 12, alignItems: 'flex-start' },
  avatar: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 10, marginTop: 1 },
  assistantBody: { flex: 1, minWidth: 0, paddingTop: 2 },
  attachments: { gap: 8, marginBottom: 9 },
  userAttachments: { marginBottom: 8 },
  imageCard: { width: 280, maxWidth: '100%', overflow: 'hidden', borderRadius: 14 },
  attachmentImage: { width: '100%', maxHeight: 360, backgroundColor: '#D5D7DC' },
  markdownImageFrame: { width: '100%', maxWidth: 300, maxHeight: 360, overflow: 'hidden', borderRadius: 14, marginBottom: 12, backgroundColor: '#D5D7DC' },
  markdownImage: { width: '100%', minHeight: 120 },
  markdownImageLoading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  markdownImageFailure: { minHeight: 120, alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14 },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  imagePlaceholderText: { fontSize: 11, textAlign: 'center' },
  documentCard: { minWidth: 210, maxWidth: 280, flexDirection: 'row', alignItems: 'center', borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, padding: 10 },
  documentMeta: { flex: 1, minWidth: 0, marginLeft: 9 },
  documentName: { fontSize: 13, fontWeight: '600' },
  documentSize: { fontSize: 10, marginTop: 3 },
  errorBox: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 19 },
  cancelled: { fontSize: 13, lineHeight: 19, fontStyle: 'italic', marginTop: 2 },
  streamingMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 24, marginTop: 2 },
  streamingText: { fontSize: 11, lineHeight: 16 },
  modelMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 3, minHeight: 40, paddingVertical: 8 },
  modelMetaText: { flex: 1, fontSize: 11, lineHeight: 16 },
  detailsCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, paddingHorizontal: 11, paddingVertical: 7, marginBottom: 7 },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, gap: 10 },
  detailLabel: { width: 72, fontSize: 11, lineHeight: 16 },
  detailValue: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2, minHeight: 38 },
  actionButton: { minHeight: 36, borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6 },
  actionText: { fontSize: 11, fontWeight: '700' },
});
