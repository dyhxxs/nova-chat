import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { UserAvatar } from '../components/UserAvatar';
import { useAppTheme } from '../hooks/useAppTheme';
import { friendlyNetworkError } from '../lib/errorMessage';
import { createId } from '../lib/id';
import { isCorruptedDisplayName, safeDisplayName } from '../lib/userDisplayName';
import { logout, removeAvatar, updateProfile, uploadAvatar } from '../services/gatewayApiClient';
import { useAppStore } from '../store/useAppStore';
import type { PendingAttachment, RootStackParamList } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'Profile'>;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

function avatarMimeType(uri: string, provided?: string | null): string {
  const normalized = provided?.toLowerCase().trim();
  if (normalized) return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
  const clean = uri.split('?')[0]?.toLowerCase() ?? '';
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function avatarFileName(uri: string, provided: string | null | undefined): string {
  if (provided?.trim()) return provided.trim();
  const fromUri = decodeURIComponent(uri.split('/').pop()?.split('?')[0] ?? '').trim();
  return fromUri || `avatar-${Date.now()}.jpg`;
}

function formatDate(value?: number): string {
  if (!value) return '暂无记录';
  return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function ProfileScreen({ navigation }: Props) {
  const theme = useAppTheme();
  const user = useAppStore((state) => state.user);
  const settings = useAppStore((state) => state.settings);
  const accessToken = useAppStore((state) => state.accessToken);
  const setAuthState = useAppStore((state) => state.setAuthState);
  const clearSession = useAppStore((state) => state.clearSession);
  const [displayName, setDisplayName] = useState(user ? safeDisplayName(user) : '');

  useEffect(() => {
    if (user) setDisplayName(safeDisplayName(user));
  }, [user?.displayName, user?.email, user?.id, user?.role]);
  const [pendingAvatar, setPendingAvatar] = useState<PendingAttachment>();
  const [removeRequested, setRemoveRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string }>();

  if (!user) return null;

  const pickAvatar = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('需要照片权限', '请在系统设置中允许 Nova 访问照片，才能设置头像。');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        shouldDownloadFromNetwork: true,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      if (asset.fileSize !== undefined && asset.fileSize > MAX_AVATAR_BYTES) {
        Alert.alert('头像过大', '请选择 5 MB 以内的图片。');
        return;
      }
      const mimeType = avatarMimeType(asset.uri, asset.mimeType);
      if (!mimeType.startsWith('image/')) {
        Alert.alert('格式不支持', '头像仅支持 JPG、PNG、WebP 或 GIF 图片。');
        return;
      }
      setPendingAvatar({
        localId: createId(), uri: asset.uri, name: avatarFileName(asset.uri, asset.fileName),
        mimeType, size: asset.fileSize, kind: 'image',
      });
      setRemoveRequested(false);
      setStatus(undefined);
    } catch (error) {
      Alert.alert('无法选择头像', error instanceof Error ? error.message : '图片选择器发生错误，请重试。');
    }
  };

  const askRemoveAvatar = () => {
    if (pendingAvatar) {
      setPendingAvatar(undefined);
      setRemoveRequested(Boolean(user.avatarFileId));
      return;
    }
    if (!user.avatarFileId) return;
    Alert.alert('移除头像', '移除后会恢复为默认头像。', [
      { text: '取消', style: 'cancel' },
      { text: '移除', style: 'destructive', onPress: () => setRemoveRequested(true) },
    ]);
  };

  const save = async () => {
    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setStatus({ ok: false, text: '显示名称不能为空。' });
      return;
    }
    if (isCorruptedDisplayName(trimmedName)) {
      setStatus({ ok: false, text: '显示名称包含乱码字符，请重新输入。' });
      return;
    }
    setBusy(true);
    setStatus(undefined);
    let current = user;
    try {
      if (trimmedName !== current.displayName) {
        current = await updateProfile(settings.serverUrl, accessToken, { displayName: trimmedName });
        setAuthState('authenticated', current);
      }
      if (pendingAvatar) {
        current = await uploadAvatar(settings.serverUrl, accessToken, pendingAvatar);
        setAuthState('authenticated', current);
        setPendingAvatar(undefined);
      } else if (removeRequested && current.avatarFileId) {
        current = await removeAvatar(settings.serverUrl, accessToken);
        setAuthState('authenticated', current);
        setRemoveRequested(false);
      }
      setStatus({ ok: true, text: '个人信息已保存。' });
      navigation.goBack();
    } catch (error) {
      setStatus({ ok: false, text: friendlyNetworkError(error) });
    } finally {
      setBusy(false);
    }
  };

  const signOut = () => Alert.alert('退出登录', '退出后本地对话仍会保留。', [
    { text: '取消', style: 'cancel' },
    { text: '退出', style: 'destructive', onPress: () => { void logout(settings.serverUrl, accessToken).catch(() => undefined).finally(() => clearSession()); } },
  ]);

  const previewUri = pendingAvatar?.uri;
  const visibleDisplayName = safeDisplayName(user);
  const avatarUser = previewUri ? { ...user, avatarFileId: undefined } : user;

  return (
    <KeyboardAwareView style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={[styles.hero, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="更换头像" onPress={() => void pickAvatar()} style={styles.avatarButton}>
            <UserAvatar user={avatarUser} serverUrl={settings.serverUrl} accessToken={accessToken} previewUri={previewUri} size={92} />
            <View style={[styles.cameraBadge, { backgroundColor: theme.colors.primary, borderColor: theme.colors.surface }]}><Ionicons name="camera" size={16} color="#fff" /></View>
          </Pressable>
          {(user.avatarFileId || pendingAvatar || removeRequested) && (
            <Pressable accessibilityRole="button" onPress={askRemoveAvatar} style={styles.removeAvatarButton}>
              <Ionicons name="trash-outline" size={15} color={theme.colors.danger} /><Text style={[styles.removeAvatarText, { color: theme.colors.danger }]}>{pendingAvatar ? '取消新头像' : removeRequested ? '已选择移除头像' : '移除头像'}</Text>
            </Pressable>
          )}
          <Text style={[styles.heroName, { color: theme.colors.text }]}>{visibleDisplayName}</Text>
          <Text style={[styles.heroEmail, { color: theme.colors.textSecondary }]}>{user.email}</Text>
        </View>

        <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
          <Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>基本信息</Text>
          <Text style={[styles.label, { color: theme.colors.text }]}>显示名称</Text>
          <TextInput
            value={displayName}
            onChangeText={(value) => { setDisplayName(value); setStatus(undefined); }}
            maxLength={80}
            placeholder="你的名字"
            placeholderTextColor={theme.colors.textTertiary}
            style={[styles.input, { color: theme.colors.text, borderColor: theme.colors.border, backgroundColor: theme.colors.surfaceMuted }]}
          />
          <Text style={[styles.hint, { color: theme.colors.textTertiary }]}>这个名称会显示在账户和个人资料中。</Text>
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <InfoRow label="邮箱" value={user.email} theme={theme} />
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <InfoRow label="账户类型" value={user.role === 'admin' ? '管理员' : '普通用户'} theme={theme} />
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <InfoRow label="注册时间" value={formatDate(user.createdAt)} theme={theme} />
          <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
          <InfoRow label="最近登录" value={formatDate(user.lastLoginAt)} theme={theme} />
        </View>

        {!!status && <Text style={[styles.status, { color: status.ok ? theme.colors.success : theme.colors.danger }]}>{status.text}</Text>}
        <Pressable accessibilityRole="button" onPress={() => void save()} disabled={busy} style={[styles.saveButton, { backgroundColor: theme.colors.primary }, busy && styles.disabled]}>
          {busy ? <ActivityIndicator color="#fff" /> : <><Ionicons name="checkmark-circle-outline" size={18} color="#fff" /><Text style={styles.saveText}>保存个人信息</Text></>}
        </Pressable>

        <Pressable accessibilityRole="button" onPress={signOut} style={({ pressed }) => [styles.signOutButton, { borderColor: theme.colors.border }, pressed && { backgroundColor: theme.colors.surfaceMuted }]}>
          <Ionicons name="log-out-outline" size={18} color={theme.colors.danger} /><Text style={[styles.signOutText, { color: theme.colors.danger }]}>退出登录</Text>
        </Pressable>
      </ScrollView>
    </KeyboardAwareView>
  );
}

function InfoRow({ label, value, theme }: { label: string; value: string; theme: ReturnType<typeof useAppTheme> }) {
  return <View style={styles.infoRow}><Text style={[styles.infoLabel, { color: theme.colors.textSecondary }]}>{label}</Text><Text selectable numberOfLines={1} style={[styles.infoValue, { color: theme.colors.text }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1 }, scroll: { flex: 1 }, container: { padding: 16, paddingBottom: 46 },
  hero: { alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 20, padding: 22 }, avatarButton: { position: 'relative' }, cameraBadge: { position: 'absolute', right: -2, bottom: -2, width: 29, height: 29, borderRadius: 10, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  removeAvatarButton: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 8, marginTop: 6 }, removeAvatarText: { fontSize: 12, fontWeight: '700' }, heroName: { fontSize: 22, fontWeight: '800', marginTop: 13 }, heroEmail: { fontSize: 13, marginTop: 4 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, marginTop: 16, overflow: 'hidden', paddingHorizontal: 14 }, sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.4, marginTop: 14, marginBottom: 14, textTransform: 'uppercase' }, label: { fontSize: 13, fontWeight: '700', marginBottom: 7 }, input: { height: 45, borderRadius: 11, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, fontSize: 14 }, hint: { fontSize: 11, lineHeight: 16, marginTop: 7 }, divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 }, infoRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12 }, infoLabel: { width: 72, fontSize: 13 }, infoValue: { flex: 1, fontSize: 13, fontWeight: '600', textAlign: 'right' }, status: { fontSize: 12, lineHeight: 17, marginTop: 13, textAlign: 'center' }, saveButton: { height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: 14 }, saveText: { color: '#fff', fontSize: 14, fontWeight: '800' }, signOutButton: { height: 46, borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginTop: 11 }, signOutText: { fontSize: 14, fontWeight: '700' }, disabled: { opacity: 0.55 },
});

