import { createElement, StrictMode, useState } from 'react';
import { CommonActions, StackActions, StackRouter } from '@react-navigation/routers';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ start: vi.fn(), resume: vi.fn(), composer: undefined as any, layout: undefined as undefined | (() => void) }));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Platform: { OS: 'android' },
  Keyboard: { dismiss: vi.fn(), addListener: () => ({ remove: () => {} }) },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  FlatList: 'FlatList', Pressable: 'Pressable', View: 'View', ScrollView: 'ScrollView', Modal: 'Modal', Switch: 'Switch', ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => {}), deleteItemAsync: vi.fn(async () => {}) }));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-haptics', () => ({ notificationAsync: vi.fn(async () => {}), selectionAsync: vi.fn(async () => {}), impactAsync: vi.fn(async () => {}), NotificationFeedbackType: { Success: 'success', Error: 'error' }, ImpactFeedbackStyle: { Medium: 'medium' } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
vi.mock('../src/services/backupFiles', () => ({ shareTextFile: vi.fn(async () => {}) }));
vi.mock('../src/components/ThemedText', () => ({ ThemedText: 'Text', ThemedTextInput: 'TextInput' }));
vi.mock('../src/components/ConversationForkDialog', () => ({ ConversationForkDialog: () => null }));
vi.mock('../src/components/SpeechControls', () => ({ SpeechControls: () => null }));
vi.mock('../src/components/ChatOptionsModal', () => ({ ChatOptionsModal: () => null }));
vi.mock('../src/components/CompanionAvatar', () => ({ CompanionAvatar: () => null }));
vi.mock('../src/components/EmptyState', () => ({ EmptyState: () => null }));
vi.mock('../src/components/IconButton', () => ({ IconButton: () => null }));
vi.mock('../src/components/MessageBubble', () => ({ MessageBubble: () => null }));
vi.mock('../src/components/KeyboardAwareView', () => ({ KeyboardAwareView: ({ children }: any) => children }));
vi.mock('../src/components/Composer', () => ({ Composer: (props: any) => { mocks.composer = props; return null; } }));
vi.mock('../src/hooks/useConversationFork', () => ({ useConversationFork: () => ({}) }));
vi.mock('../src/hooks/useVoiceChat', () => ({ useVoiceChat: () => ({ stop: vi.fn(), play: vi.fn(), retry: vi.fn(), progress: 0 }) }));
vi.mock('../src/services/voiceClient', () => ({ uploadVoice: vi.fn() }));
vi.mock('../src/services/voiceRecordingFiles', () => ({ keepVoiceRecording: vi.fn(async recording => ({ ...recording, uri: 'file:///documents/' + recording.requestId + '.m4a' })), removeVoiceRecording: vi.fn(async () => {}) }));
vi.mock('../src/hooks/useReadAloud', () => ({ useReadAloud: () => ({ state: { phase: 'idle' } }) }));
vi.mock('../src/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: {}, fonts: {} }) }));
vi.mock('../src/services/chatClient', () => ({ startGeneration: mocks.start, resumeGeneration: mocks.resume }));
vi.mock('../src/services/gatewayApiClient', () => ({ fetchGatewayModels: vi.fn(async () => ({ models: ['model-a'], defaultModel: 'model-a' })), listCompanions: vi.fn(async () => [{ id: 'companion-id', name: '小雨', avatarFileId: null, userName: '', personality: [], speakingStyle: [], appearance: '', memoryEnabled: false, memories: [] }]), createCompanion: vi.fn(), updateCompanion: vi.fn(), getCompanion: vi.fn(async () => ({ id: 'companion-id', name: '小雨', avatarFileId: null })), uploadAttachment: vi.fn(), GatewayApiError: class extends Error {} }));
import { uploadVoice } from '../src/services/voiceClient';
import { removeVoiceRecording } from '../src/services/voiceRecordingFiles';
import { createCompanion, updateCompanion, listCompanions } from '../src/services/gatewayApiClient';
import { HistoryScreen } from '../src/screens/HistoryScreen';
import { CompanionsScreen } from '../src/screens/CompanionsScreen';
import { ChatScreen } from '../src/screens/ChatScreen';
import { useAppStore } from '../src/store/useAppStore';
import type { GenerationController, StreamHandlers } from '../src/services/chatClient';
let root: ReactTestRenderer | undefined;
let controllers: GenerationController[];
const navigation = { addListener: vi.fn(() => () => {}), navigate: vi.fn(), setOptions: vi.fn(() => { const fn=mocks.layout; mocks.layout=undefined; fn?.(); }) };
const conversation = () => useAppStore.getState().conversations[0]!;
const assistant = () => conversation().messages.filter(m => m.role === 'assistant').at(-1)!;
async function mount(strict = false) { await act(async () => { const screen=createElement(ChatScreen, { navigation } as any);root = create(strict ? createElement(StrictMode, null, screen) : screen); }); }
beforeEach(() => {
 vi.useFakeTimers();vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);vi.stubGlobal('requestAnimationFrame', () => 0);
 mocks.start.mockReset();mocks.resume.mockReset();vi.mocked(uploadVoice).mockReset();vi.mocked(removeVoiceRecording).mockClear();mocks.layout=undefined;controllers=[];
 const make = ({ handlers }: { handlers: StreamHandlers }) => { const c = { cancel: vi.fn(() => handlers.onCancelled()), dispose: vi.fn() }; controllers.push(c);return c; };
 mocks.start.mockImplementation(make);mocks.resume.mockImplementation(make);
 useAppStore.setState({ hydrated: true, authStatus: 'authenticated', accessToken: 'synthetic', deviceId: 'test-device', connectionStatus: 'unknown',
  settings: { ...useAppStore.getState().settings, serverUrl: 'https://gateway.test', model: 'model-a' },
  conversations: [{ id: 'conversation-a', title: 'Test', createdAt: 1, updatedAt: 1, messages: [] }], activeConversationId: 'conversation-a' });
});
afterEach(async () => { if(root) await act(async () => root!.unmount());root=undefined;vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals(); });
describe('ChatScreen generation lifecycle', () => {
 it('starts a normal send once and does not cancel or restore it on ordinary renders', async () => {
  await mount();await act(async () => { await mocks.composer.onSend('hello'); });
  expect(mocks.start).toHaveBeenCalledTimes(1);expect(mocks.resume).not.toHaveBeenCalled();expect(controllers[0]!.cancel).not.toHaveBeenCalled();expect(assistant().status).toBe('streaming');
 });
 it('does not cancel a newly started request from an older render passive effect', async () => {
  await mount();
  // A navigation layout update starts a turn after render, before that render's passive reconciliation.
  mocks.layout = () => { void mocks.composer.onSend('hello'); };
  await act(async () => { useAppStore.setState({ conversations: [...useAppStore.getState().conversations], connectionStatus: 'checking' }); });
  expect(mocks.start).toHaveBeenCalledTimes(1);expect(controllers[0]!.cancel).not.toHaveBeenCalled();expect(mocks.resume).not.toHaveBeenCalled();expect(assistant().status).toBe('streaming');
 });
});

describe('terminal, retry and recovery ownership', () => {
 it('does not restore or cancel when a controller completes synchronously during startup', async () => {
  mocks.start.mockImplementationOnce(({handlers,request})=>{handlers.onDelta('OK');handlers.onDone({type:'done',requestId:request.requestId,model:'model-a'});const c={cancel:vi.fn(),dispose:vi.fn()};controllers.push(c);return c;});
  await mount();await act(async()=>{await mocks.composer.onSend('hello');});
  expect(assistant().status).toBe('complete');expect(assistant().content).toBe('OK');expect(mocks.resume).not.toHaveBeenCalled();expect(controllers[0]!.cancel).not.toHaveBeenCalled();expect(controllers[0]!.dispose).toHaveBeenCalledOnce();
 });
 it('preserves startup errors instead of replacing them with cancellation',async()=>{
  mocks.start.mockImplementationOnce(({handlers})=>{handlers.onError({code:'invalid_request',message:'synthetic error',retryable:false});const c={cancel:vi.fn(),dispose:vi.fn()};controllers.push(c);return c;});
  await mount();await act(async()=>{await mocks.composer.onSend('hello');});
  expect(assistant().status).toBe('error');expect(assistant().errorMessage).toBe('synthetic error');expect(assistant().errorCode).toBe('invalid_request');expect(mocks.composer.toolStatus).toBe('本轮未完成');expect(mocks.resume).not.toHaveBeenCalled();expect(controllers[0]!.cancel).not.toHaveBeenCalled();
 });
 it('edits a failed photo into the draft without resending or removing history',async()=>{
  await mount();await act(async()=>{await mocks.composer.onSend('发张你在看书的照片');});
  await act(async()=>{mocks.start.mock.calls[0]![0].handlers.onError({code:'provider_content_rejected',message:'图片服务未接受这次描述',retryable:false});});
  const bubble=root!.root.findByType('FlatList' as any).props.renderItem({item:assistant()});
  expect(bubble.props.onRetry).toBeUndefined();
  await act(async()=>{bubble.props.onEditRequest();});
  expect(mocks.composer.text).toBe('发张你在看书的照片');
  expect(mocks.start).toHaveBeenCalledOnce();expect(conversation().messages).toHaveLength(2);expect(assistant().status).toBe('error');
 });
 it('keeps an unsent draft when editing an earlier failed request',async()=>{
  await mount();await act(async()=>{await mocks.composer.onSend('发张照片');});
  await act(async()=>{mocks.start.mock.calls[0]![0].handlers.onError({code:'provider_content_rejected',message:'未通过审核',retryable:false});useAppStore.getState().setConversationDraft(conversation().id,'我还没发送的新消息');});
  const bubble=root!.root.findByType('FlatList' as any).props.renderItem({item:assistant()});
  await act(async()=>{bubble.props.onEditRequest();});
  expect(mocks.composer.text).toBe('我还没发送的新消息');expect(mocks.start).toHaveBeenCalledOnce();
 });
 it('does not turn a completed response into a cancel request',async()=>{
  await mount();await act(async()=>{await mocks.composer.onSend('hello');});
  const {handlers,request}=mocks.start.mock.calls[0]![0];
  await act(async()=>{handlers.onStarted();handlers.onDelta('OK');handlers.onDone({type:'done',requestId:request.requestId,model:'model-a'});});
  expect(assistant().status).toBe('complete');expect(controllers[0]!.cancel).not.toHaveBeenCalled();expect(mocks.resume).not.toHaveBeenCalled();expect(useAppStore.getState().connectionStatus).toBe('online');
 });
 it('cancels only the deleted request, not a concurrent follow-up',async()=>{
  await mount();await act(async()=>{await mocks.composer.onSend('first');});const first=assistant().id;
  await act(async()=>{await mocks.composer.onSend('second');});
  await act(async()=>{useAppStore.setState(state=>({conversations:state.conversations.map(c=>({...c,messages:c.messages.filter(m=>m.id!==first)}))}));});
  expect(controllers[0]!.cancel).toHaveBeenCalledOnce();expect(controllers[1]!.cancel).not.toHaveBeenCalled();expect(assistant().status).toBe('streaming');
 });
 it('explicit stop cancels once and keeps its terminal state',async()=>{
  await mount();await act(async()=>{await mocks.composer.onSend('hello');});await act(async()=>{mocks.composer.onStop();});
  expect(controllers[0]!.cancel).toHaveBeenCalledOnce();expect(assistant().status).toBe('cancelled');expect(mocks.resume).not.toHaveBeenCalled();
 });
 it('unmount detaches without cancelling and remount recovers only once',async()=>{
  await mount();await act(async()=>{await mocks.composer.onSend('hello');});await act(async()=>{root!.unmount();});root=undefined;
  expect(controllers[0]!.dispose).toHaveBeenCalledOnce();expect(controllers[0]!.cancel).not.toHaveBeenCalled();await mount();expect(mocks.resume).toHaveBeenCalledOnce();
  await act(async()=>{useAppStore.getState().setConnectionStatus('checking');});expect(mocks.resume).toHaveBeenCalledOnce();
 });
 it('missing historical job reports its error without sending another cancellation or staying connecting',async()=>{
  const turn=useAppStore.getState().beginTurn('historical');useAppStore.getState().bindAssistantGeneration(turn.conversationId,turn.assistantMessageId,{requestId:'old-request',options:{reasoningEffort:'low',verbosity:'low',maxOutputTokens:256,webSearch:false,codeInterpreter:false}});
  mocks.resume.mockImplementationOnce(({handlers})=>{handlers.onError({code:'job_not_found',message:'not found',retryable:true});const c={cancel:vi.fn(),dispose:vi.fn()};controllers.push(c);return c;});
  await mount();expect(assistant().status).toBe('error');expect(controllers[0]!.cancel).not.toHaveBeenCalled();expect(mocks.composer.toolStatus).toBe('本轮未完成');expect(useAppStore.getState().connectionStatus).toBe('online');
 });
 it('fresh sends survive StrictMode without duplicate recovery',async()=>{
  await mount(true);await act(async()=>{await mocks.composer.onSend('hello');});expect(mocks.start).toHaveBeenCalledOnce();expect(mocks.resume).not.toHaveBeenCalled();expect(controllers[0]!.cancel).not.toHaveBeenCalled();
 });
});


describe('retry and connection scope changes', () => {
 it('retry starts a new request without cancelling it from the previous error render', async () => {
  await mount();
  await act(async () => { await mocks.composer.onSend('hello'); });
  const previous = mocks.start.mock.calls[0]![0];
  await act(async () => { previous.handlers.onError({ code: 'network_error', message: 'synthetic', retryable: true }); });
  const list = root!.root.findByType('FlatList' as any);
  const bubble = list.props.renderItem({ item: assistant() });
  await act(async () => { bubble.props.onRetry(); });
  expect(mocks.start).toHaveBeenCalledTimes(2);
  expect(mocks.start.mock.calls[1]![0].request.requestId).not.toBe(previous.request.requestId);
  expect(controllers[1]!.cancel).not.toHaveBeenCalled();
  expect(mocks.resume).not.toHaveBeenCalled();
  expect(assistant().status).toBe('streaming');
 });
 it('token renewal detaches the old transport and resumes once with the new token', async () => {
  await mount();
  await act(async () => { await mocks.composer.onSend('hello'); });
  await act(async () => { useAppStore.setState({ accessToken: 'synthetic-renewed' }); });
  expect(controllers[0]!.dispose).toHaveBeenCalledOnce();
  expect(controllers[0]!.cancel).not.toHaveBeenCalled();
  expect(mocks.resume).toHaveBeenCalledOnce();
  expect(mocks.resume.mock.calls[0]![0].accessToken).toBe('synthetic-renewed');
 });
 it('server/account switch detaches rather than cancelling through the new scope', async () => {
  await mount();
  await act(async () => { await mocks.composer.onSend('hello'); });
  await act(async () => { useAppStore.setState(state => ({
   accessToken: 'synthetic-other',
   settings: { ...state.settings, serverUrl: 'https://other-gateway.test' },
   conversations: [{ id: 'other-conversation', title: 'Other', createdAt: 1, updatedAt: 1, messages: [] }],
   activeConversationId: 'other-conversation',
  })); });
  expect(controllers[0]!.dispose).toHaveBeenCalledOnce();
  expect(controllers[0]!.cancel).not.toHaveBeenCalled();
  expect(mocks.resume).not.toHaveBeenCalled();
  await act(async () => { await mocks.composer.onSend('other'); });
  expect(mocks.start.mock.calls[1]![0].serverUrl).toBe('https://other-gateway.test');
  expect(mocks.start.mock.calls[1]![0].accessToken).toBe('synthetic-other');
  expect(controllers[1]!.cancel).not.toHaveBeenCalled();
 });
});


describe('companion send isolation', () => {
 it('enables companion internal tools and excludes ordinary controls and knowledge from a reply', async () => {
  useAppStore.setState({ settings: { ...useAppStore.getState().settings, knowledgeBase: true, autoTools: true, webSearch: true, codeInterpreter: true, instructions: 'ordinary instruction' }, conversations: [{ ...conversation(), kind: 'companion', companionId: 'companion-id', companionName: '小雨' }] });
  await mount(); expect(mocks.composer.companion).toBe(true);
  await act(async () => { await mocks.composer.onSend('你在干嘛，发张照片吧'); });
  const options = mocks.start.mock.calls[0]![0];
  expect(options.request.companionId).toBe('companion-id');
  expect(options.request.options).toMatchObject({ autoTools: true, knowledgeBase: false, webSearch: false, codeInterpreter: false, reasoningEffort: 'none' });
  await act(async () => { options.handlers.onDelta('我在看书'); options.handlers.onDone({ type: 'done', requestId: options.request.requestId }); });
  expect(assistant().status).toBe('complete'); expect(assistant().content).toBe('我在看书');
 });
});


describe('companion navigation with the real stack router', () => {
 it('returns to the original chat instance so another page cannot recover a new request', async () => {
  const router = StackRouter({ initialRouteName: 'Chat' });
  const config = { routeNames: ['Chat', 'Companions', 'CompanionConversations'], routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(config);
  state = router.getRehydratedState(router.getStateForAction(state, CommonActions.navigate('Companions'), config)!, config);
  let refresh: (routes: typeof state.routes) => void;
  const dispatch = (action: Parameters<typeof router.getStateForAction>[1]) => {
   state = router.getRehydratedState(router.getStateForAction(state, action, config)!, config);
   refresh(state.routes);
  };
  const stackNavigation = {
   ...navigation, setParams: vi.fn(),
   navigate: (name: string, params?: object) => dispatch(CommonActions.navigate({ name, params })),
   popTo: (name: string) => dispatch(StackActions.popTo(name)),
  };
  function Screens() {
   const [routes, setRoutes] = useState(state.routes); refresh = setRoutes;
   return createElement('Stack', null, ...routes.map(route => createElement(
    route.name === 'Chat' ? ChatScreen : route.name === 'CompanionConversations' ? HistoryScreen : CompanionsScreen as any,
    { key: route.key, navigation: stackNavigation, route } as any,
   )));
  }
  await act(async () => { root = create(createElement(Screens)); });
  const originalChatKey = state.routes[0]!.key;
  for (let visit = 0; visit < 3; visit++) {
   const contact = root!.root.findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel === '查看小雨的对话')!;
   await act(async () => { contact.props.onPress(); });
   expect(state.routes.map(route => route.name)).toEqual(['Chat', 'Companions', 'CompanionConversations']);
   const add = root!.root.findByType(HistoryScreen).findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel === '新建对话')!;
   await act(async () => { add.props.onPress(); });
   expect(state.routes.map(route => route.name)).toEqual(['Chat']);
   expect(state.routes[0]!.key).toBe(originalChatKey);
   expect(root!.root.findAllByType(ChatScreen)).toHaveLength(1);
   if (visit < 2) await act(async () => { stackNavigation.navigate('Companions'); });
  }
  await act(async () => { await mocks.composer.onSend('你好'); });
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.resume).not.toHaveBeenCalled();
  expect(controllers[0]!.cancel).not.toHaveBeenCalled();
  const companionConversation = useAppStore.getState().conversations.find(item => item.kind === 'companion')!;
  expect(companionConversation.messages.at(-1)!.status).toBe('streaming');
 });
});


describe('leaving the companion list', () => {
 it('returns to the recent ordinary chat while preserving companion history', async () => {
  const ordinary = conversation();
  const companion = { ...ordinary, id: 'companion-conversation', kind: 'companion' as const, companionId: 'companion-id', companionName: '小雨' };
  useAppStore.setState({ conversations: [companion, ordinary], activeConversationId: companion.id });
  let leave!: () => void;
  const listNavigation = { ...navigation, addListener: (event: string, callback: () => void) => { if (event === 'beforeRemove') leave = callback; return () => {}; } };
  await act(async () => { root = create(createElement(CompanionsScreen, { navigation: listNavigation, route: {} } as any)); });
  await act(async () => leave());
  expect(useAppStore.getState().activeConversationId).toBe(ordinary.id);
  expect(useAppStore.getState().conversations.find(item => item.id === companion.id)).toEqual(companion);
 });
 it('opens a persona topic list without creating or switching a conversation', async () => {
  let leave!: () => void;
  const listNavigation = { ...navigation, addListener: (event: string, callback: () => void) => { if (event === 'beforeRemove') leave = callback; return () => {}; }, popTo: vi.fn(() => leave()) };
  await act(async () => { root = create(createElement(CompanionsScreen, { navigation: listNavigation, route: {} } as any)); });
  const contact = root!.root.findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel === '查看小雨的对话')!;
  await act(async () => contact.props.onPress());
  expect(useAppStore.getState().conversations.find(item => item.id === useAppStore.getState().activeConversationId)?.kind).not.toBe('companion');
  expect(listNavigation.navigate).toHaveBeenCalledWith('CompanionConversations', { companionId: 'companion-id', companionName: '小雨' });
  expect(listNavigation.popTo).not.toHaveBeenCalled();
 });
});


describe('persona topic lists', () => {
 it('shows only this persona and opens an existing topic without making another one', async () => {
  const state = useAppStore.getState();
  const first = state.newCompanionConversation('companion-id', '小雨');
  state.beginTurn('聊电影', [], first);
  const second = state.newCompanionConversation('companion-id', '小雨');
  const other = state.newCompanionConversation('other-persona', '沈知意');
  const count = useAppStore.getState().conversations.length;
  const listNavigation = { ...navigation, popTo: vi.fn() };
  await act(async () => { root = create(createElement(HistoryScreen, { navigation: listNavigation, route: { name: 'CompanionConversations', params: { companionId: 'companion-id', companionName: '小雨' } } } as any)); });
  const list = root!.root.findByType('FlatList' as any);
  expect(list.props.data.map((item: any) => item.id).sort()).toEqual([first, second].sort());
  expect(list.props.data.some((item: any) => item.id === other)).toBe(false);
  const row = list.props.renderItem({ item: list.props.data.find((item: any) => item.id === first) });
  await act(async () => row.props.onPress());
  expect(useAppStore.getState().activeConversationId).toBe(first);
  expect(useAppStore.getState().conversations).toHaveLength(count);
  expect(listNavigation.popTo).toHaveBeenCalledWith('Chat');
 });
 it('sends only the selected topic history for a persona with multiple topics', async () => {
  const state = useAppStore.getState();
  const first = state.newCompanionConversation('companion-id', '小雨');
  const turn = state.beginTurn('这个话题的秘密是青苹果', [], first);
  state.completeAssistant(first, turn.assistantMessageId);
  state.newCompanionConversation('companion-id', '小雨');
  await mount();
  await act(async () => { await mocks.composer.onSend('你好，新话题'); });
  const request = mocks.start.mock.calls[0]![0].request;
  expect(request.companionId).toBe('companion-id');
  expect(JSON.stringify(request.messages)).not.toContain('青苹果');
  expect(request.messages).toHaveLength(1);
 });
 it('does not reset the selected companion when POP_TO opens a topic', async () => {
  let leave!: (event: any) => void;
  const listNavigation = { ...navigation, addListener: (event: string, callback: (event: any) => void) => { if (event === 'beforeRemove') leave = callback; return () => {}; } };
  const id = useAppStore.getState().newCompanionConversation('companion-id', '小雨');
  await act(async () => { root = create(createElement(CompanionsScreen, { navigation: listNavigation, route: {} } as any)); });
  await act(async () => leave({ data: { action: StackActions.popTo('Chat') } }));
  expect(useAppStore.getState().activeConversationId).toBe(id);
 });
});


describe('editing complete persona prompts', () => {
 it('saves a pasted multiline persona as a character without creating a topic', async () => {
  const listNavigation = { ...navigation, setParams: vi.fn() };
  const personaPrompt = '你是阿川，35岁，烘焙师。\n【节奏】\n只在想说时多说一点。\n【示范】\n用户：忙吗？\n阿川：刚出炉，等会儿。' + '\n具体的人物背景。'.repeat(230);
  vi.mocked(createCompanion).mockResolvedValueOnce({ id: 'new-persona', name: '阿川', personaPrompt } as any);
  await act(async () => { root = create(createElement(CompanionsScreen, { navigation: listNavigation, route: {} } as any)); });
  const add = root!.root.findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel === '创建陪伴角色')!;
  await act(async () => add.props.onPress());
  const promptField = root!.root.findAllByType('TextInput' as any).find(node => node.props.accessibilityLabel === '人设提示词')!;
  await act(async () => promptField.props.onChangeText(personaPrompt));
  const fields = root!.root.findAllByType('TextInput' as any);
  expect(fields.find(node => node.props.accessibilityLabel === '名字')!.props.value).toBe('阿川');
  expect(fields.some(node => node.props.accessibilityLabel === '性格与兴趣')).toBe(false);
  const save = root!.root.findAllByType('Pressable' as any).find(node => node.findAllByType('Text' as any).some(text => text.props.children === '保存'))!;
  await act(async () => save.props.onPress());
  expect(createCompanion).toHaveBeenLastCalledWith('https://gateway.test', 'synthetic', expect.objectContaining({ name: '阿川', personaPrompt }));
  expect(useAppStore.getState().conversations).toHaveLength(1);
  expect(root!.root.findByType('Modal' as any).props.visible).toBe(false);
 });
 it('loads the full prompt for editing and renames the persona without overwriting topic titles', async () => {
  const personaPrompt = '你是小雨。\n【性格】\n喜欢电影，别急着给建议。';
  const existing = { id: 'companion-id', name: '小雨', personaPrompt, avatarFileId: null, userName: '', personality: ['喜欢电影'], speakingStyle: ['简短'], appearance: '', memoryEnabled: false, memories: [] };
  vi.mocked(listCompanions).mockResolvedValueOnce([existing] as any);
  vi.mocked(updateCompanion).mockResolvedValueOnce({ ...existing, name: '小晴' } as any);
  const id = useAppStore.getState().newCompanionConversation(existing.id, existing.name);
  useAppStore.getState().renameConversation(id, '周末的电影');
  const listNavigation = { ...navigation, setParams: vi.fn() };
  await act(async () => { root = create(createElement(CompanionsScreen, { navigation: listNavigation, route: { params: { editId: existing.id } } } as any)); });
  const fields = root!.root.findAllByType('TextInput' as any);
  expect(fields.find(node => node.props.accessibilityLabel === '人设提示词')!.props.value).toBe(personaPrompt);
  await act(async () => fields.find(node => node.props.accessibilityLabel === '名字')!.props.onChangeText('小晴'));
  const save = root!.root.findAllByType('Pressable' as any).find(node => node.findAllByType('Text' as any).some(text => text.props.children === '保存'))!;
  await act(async () => save.props.onPress());
  expect(updateCompanion).toHaveBeenLastCalledWith('https://gateway.test', 'synthetic', existing.id, expect.objectContaining({ name: '小晴', personaPrompt }));
  expect(useAppStore.getState().conversations.find(topic => topic.id === id)).toMatchObject({ title: '周末的电影', companionName: '小晴' });
 });
});


describe('voice sends before transcription', () => {
 const recording = { uri: 'file:///temporary.m4a', durationMs: 3000, mimeType: 'audio/mp4', requestId: '11111111-1111-4111-8111-111111111111' };
 const result = { text: '我想听你的声音', voice: { status: 'ready' as const, requestId: recording.requestId, durationMs: 3000, fileId: '22222222-2222-4222-8222-222222222222' } };
 it('accepts immediately and updates one bubble after a delayed transcription, even after switching topics', async () => {
  let resolve!: (value: typeof result) => void;
  vi.mocked(uploadVoice).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount();
  await act(async () => { expect(await mocks.composer.onRecorded(recording, false)).toBe(true); });
  const original = conversation().messages[0]!;
  expect(conversation().messages).toHaveLength(1);
  expect(original).toMatchObject({ role: 'user', content: '', voice: { status: 'pending' } });
  expect(mocks.composer.uploading).toBe(false);
  expect(mocks.start).not.toHaveBeenCalled();
  await act(async () => { useAppStore.getState().newConversation(); });
  await act(async () => { resolve(result); });
  const sent = useAppStore.getState().conversations.find(item => item.id === 'conversation-a')!;
  expect(sent.messages).toHaveLength(2);
  expect(sent.messages[0]).toMatchObject({ id: original.id, content: result.text, voice: result.voice });
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.resume).not.toHaveBeenCalled();
 });
 it('retains a failed recording and retries the same request and bubble', async () => {
  vi.mocked(uploadVoice).mockRejectedValueOnce(new Error('offline'));
  await mount();
  await act(async () => { await mocks.composer.onRecorded(recording, false); });
  const failed = conversation().messages[0]!;
  expect(failed.voice).toMatchObject({ status: 'error', requestId: recording.requestId, localRecording: { mimeType: 'audio/mp4' } });
  expect(mocks.start).not.toHaveBeenCalled();
  vi.mocked(uploadVoice).mockResolvedValueOnce(result);
  await act(async () => useAppStore.getState().setMessageVoice('conversation-a', failed.id, { ...failed.voice!, status: 'pending', error: undefined }));
  expect(conversation().messages).toHaveLength(2);
  expect(conversation().messages[0]!.id).toBe(failed.id);
  expect(vi.mocked(uploadVoice).mock.calls.at(-1)![2].requestId).toBe(recording.requestId);
  expect(mocks.start).toHaveBeenCalledOnce();
 });
 it('ignores a late recognition result after an account switch', async () => {
  let resolve!: (value: typeof result) => void;
  vi.mocked(uploadVoice).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await mount();
  await act(async () => { await mocks.composer.onRecorded(recording, false); });
  await act(async () => { useAppStore.setState({ accessToken: 'another-account', conversations: [{ id: 'new', title: 'New', createdAt: 1, updatedAt: 1, messages: [] }], activeConversationId: 'new' }); });
  await act(async () => { resolve(result); });
  expect(conversation().messages).toHaveLength(0);
  expect(mocks.start).not.toHaveBeenCalled();
  expect(removeVoiceRecording).not.toHaveBeenCalled();
 });
 it('aborts on unmount and recovers a persisted queue after remounting', async () => {
  vi.mocked(uploadVoice).mockImplementationOnce(() => new Promise(() => {}));
  await mount();
  await act(async () => { await mocks.composer.onRecorded(recording, false); });
  const signal = vi.mocked(uploadVoice).mock.calls.at(-1)![3]!;
  await act(async () => root!.unmount()); root = undefined;
  expect(signal.aborted).toBe(true);
  vi.mocked(uploadVoice).mockResolvedValueOnce(result);
  await mount();
  expect(conversation().messages).toHaveLength(2);
  expect(mocks.start).toHaveBeenCalledOnce();
 });
 it('keeps speech-to-text editable and does not enqueue or send a chat message', async () => {
  vi.mocked(uploadVoice).mockResolvedValueOnce(result);
  await mount();
  await act(async () => { expect(await mocks.composer.onRecorded(recording, true)).toBe(true); });
  expect(conversation().messages).toHaveLength(0);
  expect(conversation().draft).toBe(result.text);
  expect(mocks.start).not.toHaveBeenCalled();
 });
});
