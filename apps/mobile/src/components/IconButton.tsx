import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, type PressableProps } from 'react-native';
import { useAppTheme } from '../hooks/useAppTheme';

type Props = PressableProps & { name: keyof typeof Ionicons.glyphMap; size?: number; color?: string; accessibilityLabel: string };
export function IconButton({ name, size = 22, color, style, ...props }: Props) {
  const theme = useAppTheme();
  return (
    <Pressable
      hitSlop={10}
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: theme.colors.surfaceMuted }, typeof style === 'function' ? style({ pressed }) : style]}
      {...props}
    >
      <Ionicons name={name} size={size} color={color ?? theme.colors.text} />
    </Pressable>
  );
}
const styles = StyleSheet.create({ button: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' } });
