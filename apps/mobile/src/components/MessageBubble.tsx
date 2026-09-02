import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Linking, Platform, Pressable, StyleSheet, Text, View, type ImageStyle, type TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { Renderer, useMarkdown, type MarkedStyles } from 'react-native-marked';
import type { AttachmentRef } from '@nova-chat/protocol';
import type { AppAttachment, AppMessage, UserProfile } from '../types';
import { useAppTheme } from '../hooks/useAppTheme';
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

class SafeRenderer extends Renderer {
  link(children: string | ReactNode[], href: string, styles?: TextStyle, title?: string): ReactNode {
    if (!/^https?:\/\//i.test(href)) return <Text selectable key={this.getKey()} style={styles}>{children}</Text>;
    return <Text selectable accessibilityRole="link" accessibilityLabel={title || '链接'} key={this.getKey()} onPress={() => void Linking.openURL(href)} style={styles}>{children}</Text>;
  }
  image(_uri: string, alt?: string, style?: ImageStyle): ReactNode {
    return <Text selectable key={this.getKey()} style={style as TextStyle}>〔图片：{alt || '已隐藏远程图片'}〕</Text>;
  }
  linkImage(_href: string, _imageUrl: string, alt?: string, style?: ImageStyle): ReactNode {
    return this.image('', alt, style);
  }
}

function AssistantMarkdown({ content }: { content: string }) {
  const theme = useAppTheme();
  const renderer = useMemo(() => new SafeRenderer(), []);
  const styles = useMemo<MarkedStyles>(() => ({
    text: { color: theme.colors.text, fontSize: 16, lineHeight: 25 },
    paragraph: { marginTop: 0, marginBottom: 12 },
    h1: { color: theme.colors.text, fontSize: 25, lineHeight: 32, fontWeight: '700', marginTop: 12, marginBottom: 10 },
    h2: { color: theme.colors.text, fontSize: 21, lineHeight: 28, fontWeight: '700', marginTop: 10, marginBottom: 8 },
    h3: { color: theme.colors.text, fontSize: 18, lineHeight: 25, fontWeight: '700', marginTop: 8, marginBottom: 6 },
    strong: { fontWeight: '700' }, em: { fontStyle: 'italic' },
    link: { color: theme.colors.primary, textDecorationLine: 'underline' },
    blockquote: { backgroundColor: theme.colors.surfaceMuted, borderLeftColor: theme.colors.primary, borderLeftWidth: 3, paddingHorizontal: 12, paddingVertical: 7, marginBottom: 10 },
    codespan: { backgroundColor: theme.colors.codeBackground, color: theme.colors.text, borderRadius: 5, paddingHorizontal: 5, fontFamily: 'monospace' },
    code: { backgroundColor: theme.colors.codeBackground, borderColor: theme.colors.border, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, marginBottom: 12 },
    list: { marginBottom: 10 }, li: { color: theme.colors.text, fontSize: 16, lineHeight: 24 },
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
      <Image
        key={`${imageUri}-${attempt}`}
        accessibilityLabel={`图片 ${attachment.name}`}
        source={{ uri: imageUri }}
        resizeMode="cover"
        onError={failDecodedImage}
        style={styles.attachmentImage}
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
    <Image
      accessibilityLabel={`图片 ${attachment.name}`}
      source={{ uri: attachment.uri }}
      resizeMode="cover"
      onError={() => setFailed(true)}
      style={styles.attachmentImage}
    />
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
            <View key={attachment.id} style={[styles.imageCard, { borderColor: user ? 'rgba(255,255,255,0.25)' : theme.colors.border }]}>
              <LocalAttachmentImage attachment={attachment} user={user} />
              <Text numberOfLines={1} style={[styles.imageName, { color: user ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary }]}>{attachment.name}</Text>
            </View>
          );
        }
        if (attachment.kind === 'image' && serverUrl) {
          return (
            <View key={attachment.id} style={[styles.imageCard, { borderColor: user ? 'rgba(255,255,255,0.25)' : theme.colors.border }]}>
              <GatewayAttachmentImage
                attachment={attachment}
                serverUrl={serverUrl}
                accessToken={accessToken}
                user={user}
              />
              <Text numberOfLines={1} style={[styles.imageName, { color: user ? 'rgba(255,255,255,0.85)' : theme.colors.textSecondary }]}>{attachment.name}</Text>
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
              <Text numberOfLines={1} style={[styles.documentName, { color: user ? '#FFFFFF' : theme.colors.text }]}>{attachment.name}</Text>
              <Text style={[styles.documentSize, { color: user ? 'rgba(255,255,255,0.7)' : theme.colors.textTertiary }]}>{attachment.mimeType} · {formatBytes(attachment.size)}</Text>
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
            {!!message.content && <Text selectable style={styles.userText}>{message.content}</Text>}
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
        {message.status !== 'streaming' && (
          <View style={styles.actions}>
            {!!message.content && (
              <Pressable accessibilityRole="button" accessibilityLabel="复制回复" onPress={() => void copy()} style={styles.actionButton}>
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={17} color={copied ? theme.colors.success : theme.colors.textTertiary} />
                <Text style={[styles.actionText, { color: copied ? theme.colors.success : theme.colors.textTertiary }]}>{copied ? '已复制' : '复制'}</Text>
              </Pressable>
            )}
            {(['error', 'complete', 'cancelled'] as const).includes(message.status as 'error' | 'complete' | 'cancelled') && onRetry && (
              <Pressable accessibilityRole="button" accessibilityLabel="重新生成" onPress={onRetry} style={styles.actionButton}>
                <Ionicons name="refresh" size={17} color={theme.colors.textTertiary} />
                <Text style={[styles.actionText, { color: theme.colors.textTertiary }]}>重新生成</Text>
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
  imageCard: { overflow: 'hidden', borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, maxWidth: 260 },
  attachmentImage: { width: 250, height: 180, backgroundColor: '#D5D7DC' },
  imagePlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 14 },
  imagePlaceholderText: { fontSize: 11, textAlign: 'center' },
  imageName: { fontSize: 11, paddingHorizontal: 9, paddingVertical: 6 },
  documentCard: { minWidth: 210, maxWidth: 280, flexDirection: 'row', alignItems: 'center', borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, padding: 10 },
  documentMeta: { flex: 1, minWidth: 0, marginLeft: 9 },
  documentName: { fontSize: 13, fontWeight: '600' },
  documentSize: { fontSize: 10, marginTop: 3 },
  errorBox: { flexDirection: 'row', gap: 8, padding: 10, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, marginTop: 2 },
  errorText: { flex: 1, fontSize: 13, lineHeight: 19 },
  cancelled: { fontSize: 13, lineHeight: 19, fontStyle: 'italic', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 18, marginTop: 1, minHeight: 28 },
  actionButton: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5 },
  actionText: { fontSize: 12 },
});
