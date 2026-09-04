import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { Ionicons } from '@expo/vector-icons';
import type { UserProfile } from '../types';
import { useAppTheme } from '../hooks/useAppTheme';
import { invalidateGatewayImage, loadGatewayImage } from '../services/gatewayImageCache';
import { safeDisplayName } from '../lib/userDisplayName';

type Props = {
  user?: Pick<UserProfile, 'displayName' | 'email' | 'role' | 'avatarFileId'>;
  serverUrl?: string;
  accessToken?: string;
  previewUri?: string;
  size?: number;
};

function initials(user?: Pick<UserProfile, 'displayName' | 'email' | 'role'>): string {
  if (!user) return '?';
  const source = safeDisplayName(user);
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
  return Array.from(source).slice(0, 2).join('').toUpperCase() || '?';
}

export function UserAvatar({ user, serverUrl, accessToken, previewUri, size = 40 }: Props) {
  const theme = useAppTheme();
  const [cachedUri, setCachedUri] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const avatarFileId = user?.avatarFileId;
  const canLoadImage = Boolean(avatarFileId && serverUrl && accessToken);

  useEffect(() => {
    let active = true;
    setCachedUri(undefined);
    setFailed(false);
    setLoading(Boolean(canLoadImage && !previewUri));

    if (!canLoadImage || previewUri) return () => { active = false; };

    void loadGatewayImage(serverUrl!, accessToken!, { id: avatarFileId!, mimeType: 'image/jpeg' })
      .then((uri) => {
        if (!active) return;
        setCachedUri(uri);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        setFailed(true);
      });

    return () => { active = false; };
  }, [accessToken, avatarFileId, canLoadImage, previewUri, serverUrl]);

  const imageSourceUri = previewUri || cachedUri || '';
  const radius = Math.round(size * 0.3);
  const accessibleName = safeDisplayName(user ?? { displayName: '', email: '', role: 'user' });

  const failImage = () => {
    if (!previewUri && avatarFileId && serverUrl) {
      invalidateGatewayImage(serverUrl, { id: avatarFileId, mimeType: 'image/jpeg' });
    }
    setCachedUri(undefined);
    setLoading(false);
    setFailed(true);
  };

  return (
    <View
      accessible
      accessibilityLabel={`${accessibleName}的头像`}
      style={[styles.root, { width: size, height: size, borderRadius: radius, backgroundColor: theme.colors.primarySoft }]}
    >
      {imageSourceUri && !failed ? (
        <Image
          key={imageSourceUri}
          source={{ uri: imageSourceUri }}
          onError={failImage}
          style={{ width: size, height: size, borderRadius: radius }}
        />
      ) : loading ? (
        <ActivityIndicator size="small" color={theme.colors.primary} />
      ) : user ? (
        <Text style={[styles.initials, { color: theme.colors.primary, fontSize: Math.max(12, Math.round(size * 0.32)) }]}>{initials(user)}</Text>
      ) : (
        <Ionicons name="person-outline" size={Math.round(size * 0.42)} color={theme.colors.primary} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { fontWeight: '800', letterSpacing: 0.5 },
});
