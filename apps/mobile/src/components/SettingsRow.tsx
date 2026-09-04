import { Pressable, StyleSheet, View } from 'react-native';
import { ThemedText as Text } from './ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../hooks/useAppTheme';

export function SettingsSection({ title, children }: { title: string; children: React.ReactNode }) {
  const theme = useAppTheme();
  return <View style={styles.section}><Text style={[styles.sectionTitle, { color: theme.colors.textSecondary }]}>{title}</Text><View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>{children}</View></View>;
}
export function SettingsLink({ icon, title, subtitle, onPress, danger = false }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle?: string; onPress: () => void; danger?: boolean }) {
  const theme = useAppTheme();
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.link, pressed && { backgroundColor: theme.colors.surfaceMuted }]}><View style={[styles.icon, { backgroundColor: danger ? 'transparent' : theme.colors.primarySoft }]}><Ionicons name={icon} size={19} color={danger ? theme.colors.danger : theme.colors.primary} /></View><View style={styles.linkBody}><Text style={[styles.linkTitle, { color: danger ? theme.colors.danger : theme.colors.text }]}>{title}</Text>{subtitle && <Text style={[styles.linkSubtitle, { color: theme.colors.textSecondary }]}>{subtitle}</Text>}</View><Ionicons name="chevron-forward" size={18} color={theme.colors.textTertiary} /></Pressable>;
}
const styles = StyleSheet.create({ section: { marginBottom: 22 }, sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginLeft: 4, marginBottom: 8, textTransform: 'uppercase' }, card: { borderRadius: 17, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' }, link: { minHeight: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 }, icon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginRight: 11 }, linkBody: { flex: 1 }, linkTitle: { fontSize: 15, fontWeight: '600' }, linkSubtitle: { fontSize: 11, marginTop: 3, lineHeight: 15 } });
