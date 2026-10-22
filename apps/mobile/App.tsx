import { useCompanionNotifications } from './src/hooks/useCompanionNotifications';
import { appNavigationRef, flushCompanionNotification } from './src/lib/notificationNavigation';
import { useCompanionEvents } from './src/hooks/useCompanionEvents';
import { KnowledgeScreen } from './src/screens/KnowledgeScreen';
import { CredentialNotice } from './src/components/CredentialNotice';
import { DiagnosticsScreen } from './src/screens/DiagnosticsScreen';
import { AssistantsScreen } from './src/screens/AssistantsScreen';
import { CompanionsScreen } from './src/screens/CompanionsScreen';
import { useEffect } from 'react';
import { ActivityIndicator, AppState, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { Manrope_400Regular, Manrope_500Medium, Manrope_600SemiBold, Manrope_700Bold, useFonts } from '@expo-google-fonts/manrope';
import { AppErrorBoundary } from './src/components/AppErrorBoundary';
import { AppThemeProvider, useAppTheme } from './src/hooks/useAppTheme';
import { AboutScreen } from './src/screens/AboutScreen';
import { AdminScreen } from './src/screens/AdminScreen';
import { ChatScreen } from './src/screens/ChatScreen';
import { HistoryScreen } from './src/screens/HistoryScreen';
import { LoginScreen } from './src/screens/LoginScreen';
import { ProfileScreen } from './src/screens/ProfileScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { useSessionRecovery } from './src/hooks/useSessionRecovery';
import { applyAppUpdate, useAppUpdateStore } from './src/lib/appUpdate';
import { fetchAppUpdate } from './src/services/gatewayApiClient';
import { SecurityScreen } from './src/screens/SecurityScreen';
import { DataScreen } from './src/screens/DataScreen';
import { SavedScreen } from './src/screens/SavedScreen';
import { useAppStore } from './src/store/useAppStore';
import type { RootStackParamList } from './src/types';

void SplashScreen.preventAutoHideAsync();
const Stack = createNativeStackNavigator<RootStackParamList>();

function UpdateRequiredGate() {
  const theme = useAppTheme();
  const hydrated = useAppStore((state) => state.hydrated);
  const serverUrl = useAppStore((state) => state.settings.serverUrl);
  const required = useAppUpdateStore((state) => state.required);

  useEffect(() => {
    if (!hydrated || !serverUrl.trim()) return;
    let disposed = false;
    const check = async () => {
      try {
        const result = await fetchAppUpdate(serverUrl);
        if (!disposed) applyAppUpdate(serverUrl, result.update);
      } catch {
        // Temporary network failure must not turn into a false update lock.
      }
    };
    void check();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => { disposed = true; subscription.remove(); };
  }, [hydrated, serverUrl]);

  if (!required) return null;
  const openDownload = () => { void Linking.openURL(required.downloadUrl).catch(() => undefined); };
  return <Modal visible transparent animationType="fade" onRequestClose={() => undefined}>
    <View style={updateStyles.backdrop}>
      <View accessibilityRole="alert" style={[updateStyles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
        <Text style={[updateStyles.title, { color: theme.colors.text }]}>请更新 Nova Chat</Text>
        <Text style={[updateStyles.body, { color: theme.colors.textSecondary }]}>{required.message}。当前版本已停止维护，请更新到 {required.latestVersion} 后继续使用。</Text>
        <Pressable accessibilityRole="button" onPress={openDownload} style={[updateStyles.button, { backgroundColor: theme.colors.primary }]}>
          <Text style={[updateStyles.buttonText, { color: theme.dark ? theme.colors.background : '#FFFFFF' }]}>立即更新</Text>
        </Pressable>
      </View>
    </View>
  </Modal>;
}

function AppContent() {
  useCompanionNotifications();
  useCompanionEvents();
  const { error: sessionError, retrying, retryScheduled, retryNow, exitSession } = useSessionRecovery();
  const [fontsLoaded, fontError] = useFonts({
    Manrope: Manrope_400Regular,
    ManropeMedium: Manrope_500Medium,
    ManropeSemiBold: Manrope_600SemiBold,
    ManropeBold: Manrope_700Bold,
  });
  const theme = useAppTheme(fontsLoaded);
  const hydrated = useAppStore((state) => state.hydrated);
  const hydrate = useAppStore((state) => state.hydrate);
  const authStatus = useAppStore((state) => state.authStatus);

  useEffect(() => { void hydrate(); }, [hydrate]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && useAppStore.getState().hydrated) {
        void useAppStore.getState().flushPersistence().catch(() => undefined);
      }
    });
    return () => subscription.remove();
  }, []);
  useEffect(() => { if (hydrated && (fontsLoaded || fontError)) void SplashScreen.hideAsync(); }, [fontError, fontsLoaded, hydrated]);

  const updateGate = <UpdateRequiredGate />;

  if (hydrated && authStatus === 'unknown' && sessionError && (fontsLoaded || fontError)) {
    return <>{<View style={[styles.loading, { backgroundColor: theme.colors.background, padding: 28, gap: 20 }]}>
      <Text style={{ color: theme.colors.text, textAlign: 'center' }}>{sessionError}</Text>
      <Text style={{ color: theme.colors.textSecondary, textAlign: 'center' }}>{retrying ? '正在重新连接，登录信息和本地记录已保留。' : retryScheduled ? '登录信息已保留，将自动重试连接，无需重新注册。' : '登录信息已保留。请检查服务器状态后重试，无需重新注册。'}</Text>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: retrying, busy: retrying }} disabled={retrying} onPress={retryNow} style={{ padding: 16 }}><Text style={{ color: theme.colors.primary }}>{retrying ? '正在连接…' : '立即重试'}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={exitSession} style={{ padding: 16 }}><Text style={{ color: theme.colors.textSecondary }}>退出当前账号</Text></Pressable>
    </View>}{updateGate}</>;
  }
  if (!hydrated || authStatus === 'unknown' || (!fontsLoaded && !fontError)) {
    return <><View style={[styles.loading, { backgroundColor: theme.colors.background }]}><ActivityIndicator color={theme.colors.primary} /></View>{updateGate}</>;
  }
  const authenticated = authStatus === 'authenticated';
  return (
    <AppThemeProvider customFontsLoaded={fontsLoaded}>
      <View style={styles.root}>
      <CredentialNotice />
      <NavigationContainer ref={appNavigationRef} onReady={flushCompanionNotification} theme={theme.navigation}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack.Navigator screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.background },
        headerTintColor: theme.colors.text,
        headerTitleStyle: { fontFamily: theme.fonts.bold, fontWeight: '700' },
        contentStyle: { backgroundColor: theme.colors.background },
        animation: 'slide_from_right',
      }}>
        {!authenticated ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Chat" getId={() => 'main-chat'} component={ChatScreen} options={{ title: 'Nova' }} />
            <Stack.Screen name="History" component={HistoryScreen} options={{ title: '对话历史', presentation: 'modal' }} />
            <Stack.Screen name="Saved" component={SavedScreen} options={{ title: '收藏夹' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: '设置' }} />
            <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: '个人信息' }} />
            <Stack.Screen name="Admin" component={AdminScreen} options={{ title: '管理控制台' }} />
            <Stack.Screen name="Security" component={SecurityScreen} options={{ title: '账户安全' }} />
            <Stack.Screen name="Knowledge" component={KnowledgeScreen} options={{ title: '个人资料库' }} />
            <Stack.Screen name="Assistants" component={AssistantsScreen} options={{ title: '助手库' }} />
            <Stack.Screen name="Companions" component={CompanionsScreen} options={{ title: 'AI 陪伴' }} />
            <Stack.Screen name="CompanionConversations" component={HistoryScreen} options={{ title: '人设对话' }} />
            <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ title: '连接诊断' }} />
            <Stack.Screen name="Data" component={DataScreen} options={{ title: '数据与备份' }} />
            <Stack.Screen name="About" component={AboutScreen} options={{ title: '关于' }} />
          </>
        )}
      </Stack.Navigator>
      </NavigationContainer>
      </View>
      {updateGate}
    </AppThemeProvider>
  );
}

export default function App() {
  return <GestureHandlerRootView style={styles.root}><SafeAreaProvider><AppErrorBoundary><AppContent /></AppErrorBoundary></SafeAreaProvider></GestureHandlerRootView>;
}
const updateStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 420, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, padding: 24, gap: 16 },
  title: { fontSize: 21, fontWeight: '800' as const },
  body: { fontSize: 15, lineHeight: 23 },
  button: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  buttonText: { fontSize: 15, fontWeight: '700' as const },
});
const styles = StyleSheet.create({ root: { flex: 1 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
