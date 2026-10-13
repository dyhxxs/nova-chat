import { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { invalidateGatewayImage, loadGatewayImage } from '../services/gatewayImageCache';

export function CompanionAvatar({ name, fileId, serverUrl, accessToken, size = 48 }: { name: string; fileId?: string | null; serverUrl: string; accessToken: string; size?: number }) {
  const theme = useAppTheme();
  const [image, setImage] = useState<{ fileId: string; uri: string }>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setImage(undefined);
    setFailed(false);
    if (fileId && serverUrl && accessToken) {
      void loadGatewayImage(serverUrl, accessToken, { id: fileId, mimeType: 'image/jpeg' })
        .then(uri => { if (active) setImage({ fileId, uri }); })
        .catch(() => { if (active) setFailed(true); });
    }
    return () => { active = false; };
  }, [fileId, serverUrl, accessToken]);
  const shape = { width: size, height: size, borderRadius: size * 0.32 };
  if (image && image.fileId === fileId && !failed) return <Image key={image.uri} accessibilityLabel={`${name}的长相`} source={{ uri: image.uri }} style={shape} onError={() => { invalidateGatewayImage(serverUrl, { id: image.fileId, mimeType: 'image/jpeg' }); setFailed(true); }} />;
  return <View style={[shape, { backgroundColor: theme.colors.primarySoft, alignItems: 'center', justifyContent: 'center' }]}><Text style={{ color: theme.colors.primary, fontSize: size * 0.38, fontWeight: '600' }}>{Array.from(name)[0] || 'TA'}</Text></View>;
}
