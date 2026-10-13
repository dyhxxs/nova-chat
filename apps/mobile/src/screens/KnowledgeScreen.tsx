import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import type { KnowledgeDocument, KnowledgeResult } from '@nova-chat/protocol';
import { ThemedText as Text } from '../components/ThemedText';
import { KeyboardAwareView } from '../components/KeyboardAwareView';
import { KnowledgeSources } from '../components/KnowledgeSources';
import { useAppTheme } from '../hooks/useAppTheme';
import { useAccountTask } from '../hooks/useAccountTask';
import { accountScope } from '../lib/accountScope';
import { createId } from '../lib/id';
import { listKnowledge, getKnowledge, saveKnowledge, deleteKnowledge, searchKnowledge, importKnowledge, uploadAttachment } from '../services/gatewayApiClient';
import { shareTextFile } from '../services/backupFiles';
import { useAppStore } from '../store/useAppStore';
import type { RootStackParamList } from '../types';

export function KnowledgeScreen({ navigation }: NativeStackScreenProps<RootStackParamList, 'Knowledge'>) {
  const theme = useAppTheme();
  const { scope, busy, run } = useAccountTask();
  const scroll = useRef<ScrollView>(null);
  const [library, setLibrary] = useState<Awaited<ReturnType<typeof listKnowledge>>>();
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<KnowledgeResult>();
  const draft = useAppStore(state => state.knowledgeDraft);
  const savedRevision = useAppStore(state => state.knowledgeDraftSavedRevision);
  const persistenceError = useAppStore(state => state.persistenceError);
  const recoveryNotice = useAppStore(state => state.recoveryNotice);
  const [editorHidden, setEditorHidden] = useState(false);
  const [deleting, setDeleting] = useState<KnowledgeDocument>();
  const [discarding, setDiscarding] = useState(false);
  const credentials = () => { const state = useAppStore.getState(); return [state.settings.serverUrl, state.accessToken] as const; };
  const currentDraft = () => { const state = useAppStore.getState(); return accountScope(state) === scope && state.knowledgeDraft?.editId === draft?.editId ? state.knowledgeDraft : undefined; };
  const onError = (error: unknown) => setNotice(error instanceof Error ? error.message : '操作失败，请重试。');
  const refresh = () => run(async isCurrent => {
    setNotice('');
    const data = await listKnowledge(...credentials());
    if (isCurrent()) setLibrary(data);
  }, onError);
  useEffect(() => {
    setLibrary(undefined); setEditorHidden(false); setNotice(''); setResult(undefined); setQuery(''); setDeleting(undefined); setDiscarding(false);
    void refresh();
    // useAccountTask fences late results by account and page lifetime.
  }, [scope]);
  useEffect(() => () => {
    const state = useAppStore.getState();
    if (accountScope(state) === scope) void state.flushPersistence().catch(() => undefined);
  }, [scope]);
  const open = (document: KnowledgeDocument) => run(async isCurrent => {
    if (useAppStore.getState().knowledgeDraft) { setEditorHidden(false); setNotice('每账户保留一份编辑草稿。请先保存或明确放弃当前草稿，再打开其他资料。'); return; }
    setNotice(''); setDeleting(undefined); setDiscarding(false);
    const data = await getKnowledge(...credentials(), document.id);
    if (isCurrent() && useAppStore.getState().setKnowledgeDraft(data, scope)) { setEditorHidden(false); scroll.current?.scrollTo({ y: 0, animated: true }); }
  }, onError);
  const save = (asNew = false) => run(async isCurrent => {
    const submitted = currentDraft();
    if (!submitted?.title.trim() || !submitted.text.trim()) { setNotice('请填写标题和正文。'); return; }
    const auth = credentials();
    const saved = await saveKnowledge(...auth, { title: submitted.title, text: submitted.text, ...(submitted.id && !asNew ? { expectedUpdatedAt: submitted.updatedAt } : {}) }, asNew ? undefined : submitted.id);
    if (!isCurrent()) return;
    useAppStore.getState().clearKnowledgeDraft(scope, submitted.revision); setDiscarding(false); setResult(undefined);
    setNotice(saved.duplicate ? '已有相同正文，已保留原资料，没有重复建立索引。' : '已保存并更新检索索引。');
    const data = await listKnowledge(...auth);
    if (isCurrent()) setLibrary(data);
  }, onError);
  const importFile = () => run(async isCurrent => {
    setNotice(''); setDeleting(undefined);
    const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !isCurrent()) return;
    const asset = picked.assets[0];
    if (!asset) return;
    if (/\.(doc|xls|ppt|mobi)$/i.test(asset.name) || asset.mimeType?.startsWith('image/')) { setNotice('资料库暂不支持图片、旧版 Office 和 MOBI；PDF 需有文字层。请转为 TXT 或 DOCX 等可提取文字的格式。'); return; }
    if (asset.size && asset.size > 25 * 1024 * 1024) { setNotice('文件不能超过25 MB。'); return; }
    const auth = credentials();
    const file = await uploadAttachment(...auth, { localId: createId(), uri: asset.uri, name: asset.name, mimeType: asset.mimeType || 'application/octet-stream', size: asset.size, kind: 'document' });
    if (!isCurrent()) return;
    const saved = await importKnowledge(...auth, file.id);
    if (!isCurrent()) return;
    setResult(undefined);
    const pdfNotice = saved.importInfo ? ` PDF共${saved.importInfo.pages}页；${saved.importInfo.pagesWithoutText.length ? '第 ' + saved.importInfo.pagesWithoutText.join('、') + ' 页未提取到文字，可能为空白页或扫描页，请核对 / OCR。' : '仅提取文字层，图片和表单可能遗漏。'}` : '';
    setNotice((saved.duplicate ? '已有相同正文，没有重复加入资料库。' : `已导入“${saved.document.title}”。请查看提取后的文字，核对表格或排版是否丢失。`) + pdfNotice);
    const data = await listKnowledge(...auth);
    if (isCurrent()) setLibrary(data);
  }, onError);
  const search = () => run(async isCurrent => {
    if (!query.trim()) return;
    setNotice(''); setResult(undefined);
    const data = await searchKnowledge(...credentials(), query);
    if (isCurrent()) setResult(data);
  }, onError);
  const remove = () => run(async isCurrent => {
    if (!deleting) return;
    const auth = credentials();
    await deleteKnowledge(...auth, deleting.id);
    if (!isCurrent()) return;
    setDeleting(undefined); setResult(undefined); setNotice('已删除资料与检索索引。既有聊天、正在进行的回答和原始上传附件不会被删除。');
    const data = await listKnowledge(...auth);
    if (isCurrent()) setLibrary(data);
  }, onError);
  const ask = () => {
    const store = useAppStore.getState();
    const id = store.newConversation();
    store.updateSettings({ knowledgeBase: true });
    if (query.trim()) store.setConversationDraft(id, query.trim());
    navigation.popTo('Chat');
  };
  const exportDraft = () => run(async isCurrent => {
    const latest = currentDraft();
    if (!latest) return;
    await shareTextFile(latest.title + '\n\n' + latest.text, 'md', 'knowledge', isCurrent);
    if (isCurrent()) setNotice('已打开保存/分享入口，请确认接收方实际保存。导出文件包含资料正文，请妥善保管。');
  }, onError);
  const button = (label: string, action: () => void, primary = false, danger = false) => <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={busy} onPress={action} style={[styles.button, { backgroundColor: primary ? theme.colors.primary : theme.colors.surfaceMuted, opacity: busy ? 0.5 : 1 }]}><Text style={{ color: primary ? '#fff' : danger ? theme.colors.danger : theme.colors.text }}>{label}</Text></Pressable>;
  const inputColors = { color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted, borderColor: theme.colors.border };
  return <KeyboardAwareView style={{ flex: 1, backgroundColor: theme.colors.background }}><ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.page}>
    <Text style={[styles.heading, { color: theme.colors.text }]}>让回答有自己的资料依据</Text>
    <Text style={[styles.description, { color: theme.colors.textSecondary }]}>资料保存在当前网关、当前账户，不会自动读取你的聊天或手机文件。开启“资料问答”后，仅检索相关片段并发送给管理员配置的模型服务；本轮关闭搜索、代码和图片生成工具，但不是离线功能。</Text>
    <Text style={[styles.small, { color: theme.colors.textTertiary }]}>默认不启用，重启后需重新开启。每份最多12万字符，最多100份 / 200万字符。采用中文词法检索，不是语义搜索；同义词、泛泛追问或长文总结可能需要换成具体关键词。已生成的回答仍属于聊天上下文，关闭资料模式不会移除这些历史内容。</Text>
    {busy && <ActivityIndicator accessibilityLabel="正在处理资料" color={theme.colors.primary} />}
    {!!notice && <Text accessibilityRole="alert" selectable style={[styles.notice, { color: theme.colors.text, backgroundColor: theme.colors.surfaceMuted }]}>{notice}</Text>}
    {!!persistenceError && <View style={[styles.card, { borderColor: theme.colors.danger }]}><Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>{persistenceError}</Text>{button('重试本地保存', () => { void run(async () => { await useAppStore.getState().flushPersistence(); }, onError); })}</View>}
    {!!recoveryNotice && <Text accessibilityRole="alert" style={{ color: theme.colors.danger }}>{recoveryNotice}</Text>}
    {draft && editorHidden && <View style={[styles.card, { borderColor: theme.colors.border }]}><Text style={{ color: theme.colors.text }}>有一份尚在编辑的草稿：{draft.title || '未命名资料'}</Text>{button('继续编辑草稿', () => setEditorHidden(false), true)}</View>}
    {(!draft || editorHidden) && <View style={styles.row}>{button('新建笔记', () => { if (!useAppStore.getState().knowledgeDraft) useAppStore.getState().setKnowledgeDraft({ title: '', text: '' }, scope); setEditorHidden(false); setNotice(draft ? '已恢复现有草稿，请先保存或放弃后再新建。' : ''); setDeleting(undefined); setDiscarding(false); }, true)}{button('导入文件', () => { void importFile(); })}{button('刷新', () => { void refresh(); })}</View>}
    {draft && !editorHidden ? <View style={[styles.card, { borderColor: theme.colors.border }]}>
      <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{draft.id ? '查看 / 编辑提取文字' : '新建资料'}</Text>
      <TextInput accessibilityLabel="资料标题" editable={!busy} value={draft.title} onChangeText={title => useAppStore.getState().patchKnowledgeDraft({ title }, scope, draft.editId)} placeholder="例如：项目报销制度" placeholderTextColor={theme.colors.textTertiary} maxLength={160} style={[styles.input, inputColors]} />
      <TextInput accessibilityLabel="资料正文" editable={!busy} value={draft.text} onChangeText={text => useAppStore.getState().patchKnowledgeDraft({ text }, scope, draft.editId)} multiline textAlignVertical="top" placeholder="粘贴需要长期查询的文字…" placeholderTextColor={theme.colors.textTertiary} maxLength={120_000} style={[styles.input, styles.editor, inputColors]} />
      <Text style={[styles.small, { color: theme.colors.textTertiary }]}>{draft.text.length.toLocaleString()} / 120,000 字符。编辑后按保存才会更新索引。导出仅包含当前编辑框文字，不包含原文件格式。</Text>
      <Text accessibilityLiveRegion="polite" style={[styles.small, { color: persistenceError ? theme.colors.danger : theme.colors.textSecondary }]}>{persistenceError ? '草稿尚未可靠写入设备，请重试本地保存或导出。' : savedRevision === draft.revision ? '草稿已保存到本设备，尚未提交的编辑不会进入资料索引。' : '正在保存本地草稿…请勿立即强制关闭应用。'}</Text>
      <Text style={[styles.small, { color: theme.colors.textTertiary }]}>每账户 / 网关保留一份本地草稿，可返回页面继续编辑；不会同步到其他设备，也不在标准聊天备份中。卸载、清除应用数据会删除草稿。服务器保存失败不会清空草稿；版本冲突可导出或另存为新资料。</Text>
      <View style={styles.row}>{button('保存资料', () => { void save(); }, true)}{button('导出文字', () => { void exportDraft(); })}{draft.id && button('另存为新资料', () => { void save(true); })}{button('收起编辑（保留草稿）', () => { setEditorHidden(true); void run(async () => { await useAppStore.getState().flushPersistence(); }, onError); })}{button('放弃草稿', () => setDiscarding(true), false, true)}</View>
      {discarding && <View style={{ gap: 8 }}><Text style={{ color: theme.colors.textSecondary }}>确认放弃本地草稿？尚未提交到资料库的编辑将被删除，服务器原资料不受影响。</Text><View style={styles.row}>{button('继续编辑', () => setDiscarding(false))}{button('放弃编辑', () => { useAppStore.getState().clearKnowledgeDraft(scope, draft.revision); setDiscarding(false); }, false, true)}</View></View>}
    </View> : <>
      <Text style={[styles.small, { color: theme.colors.textTertiary }]}>支持文字型 PDF、TXT、Markdown、JSON/CSV、DOCX、XLSX、PPTX、ODT、EPUB 等文字提取。PDF 最多25 MB / 200页，提取后含页码最多12万字符；不支持加密PDF、OCR和旧版二进制 Office。混合扫描页会提示，但即使有文字的页也可能漏掉图片内容。原始文件作为附件上传并保留；删除资料库条目不会删除原附件。敏感资料请先脱敏。</Text>
      <View style={[styles.card, { borderColor: theme.colors.border }]}>
        <TextInput accessibilityLabel="资料检索词" value={query} editable={!busy} onChangeText={value => { setQuery(value); setResult(undefined); }} onSubmitEditing={() => { void search(); }} placeholder="例如：报销 截止 日期" placeholderTextColor={theme.colors.textTertiary} maxLength={200} style={[styles.input, inputColors]} />
        <View style={styles.row}>{button('检索原文（不调用模型）', () => { void search(); })}{button('新建资料问答', ask, true)}</View>
        {result && <KnowledgeSources key={result.query} result={result} />}
      </View>
      <Text style={[styles.heading, { color: theme.colors.text }]}>我的资料 · {library?.usage.documents ?? '—'} / 100</Text>
      {library && <Text style={[styles.small, { color: theme.colors.textTertiary }]}>已使用 {library.usage.chars.toLocaleString()} / {library.limits.totalChars.toLocaleString()} 字符</Text>}
      {library?.documents.length === 0 && <Text style={[styles.description, { color: theme.colors.textSecondary }]}>还没有资料。先新建笔记或导入文件，再用具体关键词提问。</Text>}
      {library?.documents.map(document => <View key={document.id} style={[styles.card, { borderColor: theme.colors.border }]}>
        <Text style={{ color: theme.colors.text, fontWeight: '600' }}>{document.title}</Text>
        <Text style={[styles.small, { color: theme.colors.textSecondary }]}>{document.chars.toLocaleString()} 字符 · {document.chunks} 片段 · {new Date(document.updatedAt).toLocaleString()}</Text>
        {document.sourceName && <Text style={[styles.small, { color: theme.colors.textTertiary }]}>来源：{document.sourceName}</Text>}
        <View style={styles.row}>{button('查看 / 编辑', () => { void open(document); })}{button('删除', () => { setDeleting(document); setNotice(''); }, false, true)}</View>
        {deleting?.id === document.id && <View style={{ gap: 8 }}><Text style={{ color: theme.colors.danger }}>确定删除“{document.title}”？不可撤销，请先导出需要保留的文字。既有聊天、进行中的回答和原上传附件不受影响。</Text><View style={styles.row}>{button('取消', () => setDeleting(undefined))}{button('确认删除', () => { void remove(); }, false, true)}</View></View>}
      </View>)}
    </>}
  </ScrollView></KeyboardAwareView>;
}
const styles = StyleSheet.create({
  page: { padding: 20, paddingBottom: 60, gap: 14 }, heading: { fontSize: 20, fontWeight: '700' },
  description: { fontSize: 14, lineHeight: 22 }, small: { fontSize: 12, lineHeight: 19 }, notice: { padding: 14, borderRadius: 12, lineHeight: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: 44, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, justifyContent: 'center' },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 14, borderRadius: 16, gap: 12 }, input: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 12, fontSize: 15 }, editor: { minHeight: 240, maxHeight: 440, lineHeight: 23 },
});
