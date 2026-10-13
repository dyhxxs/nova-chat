import type { Theme as NavigationTheme } from '@react-navigation/native';

export type AppTheme = {
  dark: boolean;
  fonts: { regular: string; medium: string; bold: string; heavy: string; mono: string };
  colors: {
    background: string;
    surface: string;
    surfaceElevated: string;
    surfaceMuted: string;
    text: string;
    textSecondary: string;
    textTertiary: string;
    border: string;
    primary: string;
    primaryPressed: string;
    primarySoft: string;
    success: string;
    warning: string;
    danger: string;
    userBubble: string;
    assistantBubble: string;
    overlay: string;
    codeBackground: string;
  };
  navigation: NavigationTheme;
};

export const customFonts = { regular: 'Manrope', medium: 'ManropeMedium', bold: 'ManropeSemiBold', heavy: 'ManropeBold', mono: 'monospace' };
export const systemFonts = { regular: 'System', medium: 'System', bold: 'System', heavy: 'System', mono: 'monospace' };

export function applyFontTheme(theme: AppTheme, custom: boolean): AppTheme {
  const fonts = custom ? customFonts : systemFonts;
  return { ...theme, fonts, navigation: { ...theme.navigation, fonts: {
    regular: { fontFamily: fonts.regular, fontWeight: '400' },
    medium: { fontFamily: fonts.medium, fontWeight: '500' },
    bold: { fontFamily: fonts.bold, fontWeight: '700' },
    heavy: { fontFamily: fonts.heavy, fontWeight: '800' },
  } } };
}

export const lightTheme: AppTheme = {
  dark: false,
  fonts: customFonts,
  colors: {
    background: '#F6F5F1', surface: '#FFFFFF', surfaceElevated: '#FFFFFF', surfaceMuted: '#ECEDE7',
    text: '#252B28', textSecondary: '#616B64', textTertiary: '#88918A', border: '#E1E4DD',
    primary: '#356859', primaryPressed: '#285445', primarySoft: '#E5EEE7', success: '#208A5D',
    warning: '#A9680B', danger: '#C9414A', userBubble: '#356859', assistantBubble: '#FFFFFF',
    overlay: 'rgba(10,12,18,0.45)', codeBackground: '#EEF0EA',
  },
  navigation: {
    dark: false,
    colors: { primary: '#356859', background: '#F6F5F1', card: '#FFFFFF', text: '#252B28', border: '#E1E4DD', notification: '#C9414A' },
    fonts: { regular: { fontFamily: customFonts.regular, fontWeight: '400' }, medium: { fontFamily: customFonts.medium, fontWeight: '500' }, bold: { fontFamily: customFonts.bold, fontWeight: '700' }, heavy: { fontFamily: customFonts.heavy, fontWeight: '800' } },
  },
};

export const darkTheme: AppTheme = {
  dark: true,
  fonts: customFonts,
  colors: {
    background: '#141917', surface: '#1D2521', surfaceElevated: '#26312B', surfaceMuted: '#303B34',
    text: '#F1F3EE', textSecondary: '#B7C1B8', textTertiary: '#829286', border: '#354238',
    primary: '#98C1A8', primaryPressed: '#7EA68D', primarySoft: '#283D31', success: '#52C995',
    warning: '#E5A64B', danger: '#FF747D', userBubble: '#356859', assistantBubble: '#1D2521',
    overlay: 'rgba(0,0,0,0.7)', codeBackground: '#111217',
  },
  navigation: {
    dark: true,
    colors: { primary: '#98C1A8', background: '#141917', card: '#1D2521', text: '#F1F3EE', border: '#354238', notification: '#FF747D' },
    fonts: { regular: { fontFamily: customFonts.regular, fontWeight: '400' }, medium: { fontFamily: customFonts.medium, fontWeight: '500' }, bold: { fontFamily: customFonts.bold, fontWeight: '700' }, heavy: { fontFamily: customFonts.heavy, fontWeight: '800' } },
  },
};
