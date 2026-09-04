import { createContext, useContext, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import { applyFontTheme, darkTheme, lightTheme } from '../theme';

const FontLoadContext = createContext(false);

export function AppThemeProvider({ customFontsLoaded, children }: PropsWithChildren<{ customFontsLoaded: boolean }>) {
  return <FontLoadContext.Provider value={customFontsLoaded}>{children}</FontLoadContext.Provider>;
}

export function useAppTheme(customFontsLoaded?: boolean) {
  const contextFontsLoaded = useContext(FontLoadContext);
  const theme = useColorScheme() === 'dark' ? darkTheme : lightTheme;
  return applyFontTheme(theme, customFontsLoaded ?? contextFontsLoaded);
}
