import type { Theme as NavigationTheme } from '@react-navigation/native';

export type AppTheme = {
  dark: boolean;
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

export const lightTheme: AppTheme = {
  dark: false,
  colors: {
    background: '#F7F8FA', surface: '#FFFFFF', surfaceElevated: '#FFFFFF', surfaceMuted: '#EFF1F5',
    text: '#17191D', textSecondary: '#5D626C', textTertiary: '#8C929E', border: '#E3E6EB',
    primary: '#6157E8', primaryPressed: '#4C43C8', primarySoft: '#ECEAFF', success: '#208A5D',
    warning: '#A9680B', danger: '#C9414A', userBubble: '#6157E8', assistantBubble: '#FFFFFF',
    overlay: 'rgba(10,12,18,0.45)', codeBackground: '#F0F1F4',
  },
  navigation: {
    dark: false,
    colors: { primary: '#6157E8', background: '#F7F8FA', card: '#FFFFFF', text: '#17191D', border: '#E3E6EB', notification: '#C9414A' },
    fonts: { regular: { fontFamily: 'System', fontWeight: '400' }, medium: { fontFamily: 'System', fontWeight: '500' }, bold: { fontFamily: 'System', fontWeight: '700' }, heavy: { fontFamily: 'System', fontWeight: '800' } },
  },
};

export const darkTheme: AppTheme = {
  dark: true,
  colors: {
    background: '#0E0F13', surface: '#17191F', surfaceElevated: '#1D2027', surfaceMuted: '#242730',
    text: '#F3F4F7', textSecondary: '#B4B8C2', textTertiary: '#7F8591', border: '#2C3039',
    primary: '#8D85FF', primaryPressed: '#766DF0', primarySoft: '#29264E', success: '#52C995',
    warning: '#E5A64B', danger: '#FF747D', userBubble: '#6258D8', assistantBubble: '#17191F',
    overlay: 'rgba(0,0,0,0.7)', codeBackground: '#111217',
  },
  navigation: {
    dark: true,
    colors: { primary: '#8D85FF', background: '#0E0F13', card: '#17191F', text: '#F3F4F7', border: '#2C3039', notification: '#FF747D' },
    fonts: { regular: { fontFamily: 'System', fontWeight: '400' }, medium: { fontFamily: 'System', fontWeight: '500' }, bold: { fontFamily: 'System', fontWeight: '700' }, heavy: { fontFamily: 'System', fontWeight: '800' } },
  },
};
