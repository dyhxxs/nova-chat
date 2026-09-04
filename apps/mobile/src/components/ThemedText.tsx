import { forwardRef, useMemo } from 'react';
import {
  StyleSheet,
  Text as NativeText,
  TextInput as NativeTextInput,
  type TextInputProps,
  type TextProps,
  type TextStyle,
} from 'react-native';
import { useAppTheme } from '../hooks/useAppTheme';

type FontVariant = 'regular' | 'medium' | 'bold' | 'heavy' | 'mono';

function variantForWeight(weight: TextStyle['fontWeight']): FontVariant {
  if (weight === '800' || weight === '900') return 'heavy';
  if (weight === '700' || weight === 'bold') return 'bold';
  if (weight === '500' || weight === '600') return 'medium';
  return 'regular';
}

function themedFontFamily(style: TextStyle | TextStyle[] | undefined, theme: ReturnType<typeof useAppTheme>): string {
  const flattened = StyleSheet.flatten(style) as TextStyle | undefined;
  return flattened?.fontFamily ?? theme.fonts[variantForWeight(flattened?.fontWeight)];
}

export function ThemedText({ style, children, ...props }: TextProps) {
  const theme = useAppTheme();
  const fontFamily = useMemo(() => themedFontFamily(style as TextStyle | TextStyle[] | undefined, theme), [style, theme]);
  return <NativeText {...props} style={[{ fontFamily }, style]}>{children}</NativeText>;
}

export const ThemedTextInput = forwardRef<NativeTextInput, TextInputProps>(function ThemedTextInput({ style, ...props }, ref) {
  const theme = useAppTheme();
  const fontFamily = useMemo(() => themedFontFamily(style as TextStyle | TextStyle[] | undefined, theme), [style, theme]);
  return <NativeTextInput ref={ref} {...props} style={[{ fontFamily }, style]} />;
});

export type { FontVariant };
