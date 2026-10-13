import { ScrollView, StyleSheet, View } from 'react-native';
import { ThemedText as Text } from '../components/ThemedText';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useAppTheme } from '../hooks/useAppTheme';

const items = [
  ['git-branch-outline', '对话分支与提问改写', '从已完成回复复制独立分支，或把纯文字提问放入新分支草稿后修改；不覆盖原对话，不自动发送。'],
  ['volume-high-outline', '回复朗读', '完成的文字回复可按段朗读，支持语速和中英文选择。主动确认后交给设备/浏览器语音服务，可能联网；不调用模型、不用麦克风，不支持后台播放。'],
  ['library-outline', '个人资料库', '支持文字型 PDF 与常见文档导入、中文关键词检索和带原文来源的资料问答；编辑草稿按账户保留在本设备，不代替服务器保存，也不是 OCR 或离线问答。'],
  ['construct-outline', '常用工具', '网关内置天气、当前时间、计算器、单位和日期换算、参考汇率、联网搜索与网页阅读；按需查询并说明来源，数据服务不可用时如实提示。'],
  ['shield-checkmark-outline', '统一安全网关', '所有登录、模型请求和附件上传都经由项目 Gateway，普通用户无需填写第三方 API 地址或接触 API Key。'],
  ['lock-closed-outline', '安全存储', '会话口令保存在 iOS Keychain / Android Keystore；正式环境只使用 HTTPS/WSS。'],
  ['phone-portrait-outline', '本地会话', '聊天记录默认只保存在当前设备，可随时在设置中清空。'],
  ['person-circle-outline', '个人信息', '支持修改显示名称、上传或移除头像，聊天消息会显示当前用户头像。'],
  ['shield-checkmark-outline', '最小权限', '仅在你主动拍照或选择照片时申请相机和照片权限，不申请麦克风、通讯录或定位权限。'],
] as const;

export function AboutScreen() {
  const theme = useAppTheme();
  return <ScrollView style={{ backgroundColor: theme.colors.background }} contentContainerStyle={styles.container}>
    <LinearGradient colors={theme.dark ? ['#393276', '#1D1B3A'] : ['#E9E7FF', '#F5F4FF']} style={styles.logo}><Ionicons name="sparkles" size={39} color={theme.colors.primary} /></LinearGradient>
    <Text style={[styles.name, { color: theme.colors.text }]}>Nova Chat</Text>
    <Text style={[styles.version, { color: theme.colors.textSecondary }]}>版本 {Constants.expoConfig?.version ?? '1.0.0'}</Text>
    <Text style={[styles.intro, { color: theme.colors.textSecondary }]}>一个面向 Android 与 iOS 的私有 AI 对话客户端，模型请求统一通过项目 Gateway 访问管理员配置的 GPT-5.6 或兼容模型；主动朗读使用设备或浏览器语音服务。</Text>
    <View style={[styles.card, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>{items.map(([icon, title, text], index) => <View key={title} style={[styles.item, index > 0 && { borderTopColor: theme.colors.border, borderTopWidth: StyleSheet.hairlineWidth }]}><View style={[styles.itemIcon, { backgroundColor: theme.colors.primarySoft }]}><Ionicons name={icon} size={21} color={theme.colors.primary} /></View><View style={styles.itemBody}><Text style={[styles.itemTitle, { color: theme.colors.text }]}>{title}</Text><Text style={[styles.itemText, { color: theme.colors.textSecondary }]}>{text}</Text></View></View>)}</View>
    <Text style={[styles.note, { color: theme.colors.textTertiary }]}>本项目为独立客户端，不代表或隶属于任何模型服务商。请求内容会经由管理员配置的模型服务处理；模型输出可能不准确，请核实重要信息。</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({ container: { alignItems: 'center', padding: 24, paddingBottom: 50 }, logo: { width: 84, height: 84, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginTop: 16 }, name: { fontSize: 27, fontWeight: '800', marginTop: 16 }, version: { fontSize: 12, marginTop: 5 }, intro: { fontSize: 14, lineHeight: 22, textAlign: 'center', marginTop: 18, maxWidth: 390 }, card: { width: '100%', borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, marginTop: 28, overflow: 'hidden' }, item: { flexDirection: 'row', padding: 15 }, itemIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 12 }, itemBody: { flex: 1 }, itemTitle: { fontSize: 15, fontWeight: '700' }, itemText: { fontSize: 12, lineHeight: 18, marginTop: 4 }, note: { fontSize: 11, lineHeight: 17, textAlign: 'center', marginTop: 24 } });
