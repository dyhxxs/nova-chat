import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemedText as Text } from './ThemedText';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAppStore } from '../store/useAppStore';

/** Outside navigation so failed logout cleanup remains visible on Login. */
export function CredentialNotice() {
  const theme = useAppTheme();
  const error = useAppStore((state) => state.credentialError);
  const operation = useAppStore((state) => state.credentialOperation);
  const [busy, setBusy] = useState(false);
  if (!error) return null;
  return <SafeAreaView edges={['top', 'left', 'right']} style={{ backgroundColor: theme.colors.surface }}>
    <View accessibilityRole="alert" style={{ padding: 12, gap: 6, borderBottomWidth: 1, borderColor: theme.colors.danger }}>
      <Text style={{ color: theme.colors.danger, fontSize: 12, lineHeight: 18 }}>{error}</Text>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => {
        setBusy(true);
        void useAppStore.getState().retryCredentialPersistence().catch(() => undefined).finally(() => setBusy(false));
      }} style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
        {busy ? <ActivityIndicator color={theme.colors.primary} /> : <Text style={{ color: theme.colors.primary, fontWeight: '700' }}>{operation === 'delete' ? '重试清理凭据' : operation === 'read' ? '重试读取登录' : '重试保存登录'}</Text>}
      </Pressable>
    </View>
  </SafeAreaView>;
}
