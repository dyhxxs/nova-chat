import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
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
import { selectGatewayModel } from './src/lib/modelSelection';
import { fetchGatewayModels, getMe } from './src/services/gatewayApiClient';
import { useAppStore } from './src/store/useAppStore';
import type { RootStackParamList } from './src/types';

void SplashScreen.preventAutoHideAsync();
const Stack = createNativeStackNavigator<RootStackParamList>();

function AppContent() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope: Manrope_400Regular,
    ManropeMedium: Manrope_500Medium,
    ManropeSemiBold: Manrope_600SemiBold,
    ManropeBold: Manrope_700Bold,
  });
  const theme = useAppTheme(fontsLoaded);
  const hydrated = useAppStore((state) => state.hydrated);
  const hydrate = useAppStore((state) => state.hydrate);
  const settings = useAppStore((state) => state.settings);
  const accessToken = useAppStore((state) => state.accessToken);
  const authStatus = useAppStore((state) => state.authStatus);
  const setAuthState = useAppStore((state) => state.setAuthState);
  const restoreUserState = useAppStore((state) => state.restoreUserState);
  const clearSession = useAppStore((state) => state.clearSession);
  const updateSettings = useAppStore((state) => state.updateSettings);

  useEffect(() => { void hydrate(); }, [hydrate]);
  useEffect(() => { if (hydrated && (fontsLoaded || fontError)) void SplashScreen.hideAsync(); }, [fontError, fontsLoaded, hydrated]);
  useEffect(() => {
    if (!hydrated || authStatus !== 'unknown') return;
    if (!accessToken || !settings.serverUrl.trim()) {
      if (accessToken) void clearSession();
      else setAuthState('unauthenticated');
      return;
    }
    let active = true;
    void Promise.all([
      getMe(settings.serverUrl, accessToken),
      fetchGatewayModels(settings.serverUrl, accessToken),
    ]).then(([user, catalog]) => {
      if (!active) return;
      return restoreUserState(user).then(() => {
        if (!active) return;
        const currentModel = useAppStore.getState().settings.model;
        const model = selectGatewayModel(currentModel, catalog.models, catalog.defaultModel);
        if (model !== currentModel) updateSettings({ model });
      });
    }).catch(() => {
      if (active) void clearSession();
    });
    return () => { active = false; };
  }, [accessToken, authStatus, clearSession, hydrated, restoreUserState, settings.serverUrl, updateSettings]);

  if (!hydrated || authStatus === 'unknown' || (!fontsLoaded && !fontError)) {
    return <View style={[styles.loading, { backgroundColor: theme.colors.background }]}><ActivityIndicator color={theme.colors.primary} /></View>;
  }
  const authenticated = authStatus === 'authenticated';
  return (
    <AppThemeProvider customFontsLoaded={fontsLoaded}>
      <NavigationContainer theme={theme.navigation}>
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
            <Stack.Screen name="Chat" component={ChatScreen} options={{ title: 'Nova' }} />
            <Stack.Screen name="History" component={HistoryScreen} options={{ title: '对话历史', presentation: 'modal' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: '设置' }} />
            <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: '个人信息' }} />
            <Stack.Screen name="Admin" component={AdminScreen} options={{ title: '管理控制台' }} />
            <Stack.Screen name="About" component={AboutScreen} options={{ title: '关于' }} />
          </>
        )}
      </Stack.Navigator>
      </NavigationContainer>
    </AppThemeProvider>
  );
}

export default function App() {
  return <GestureHandlerRootView style={styles.root}><SafeAreaProvider><AppErrorBoundary><AppContent /></AppErrorBoundary></SafeAreaProvider></GestureHandlerRootView>;
}
const styles = StyleSheet.create({ root: { flex: 1 }, loading: { flex: 1, alignItems: 'center', justifyContent: 'center' } });
