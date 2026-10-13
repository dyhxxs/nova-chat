import { createElement, StrictMode, useState } from 'react';
import { CommonActions, StackActions, StackRouter } from '@react-navigation/routers';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ start: vi.fn(), resume: vi.fn(), composer: undefined as any, layout: undefined as undefined | (() => void) }));
vi.mock('react-native', () => ({
  Alert: { alert: vi.fn() }, Platform: { OS: 'android' },
  Keyboard: { addListener: () => ({ remove: () => {} }) },
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  FlatList: 'FlatList', Pressable: 'Pressable', View: 'View', ScrollView: 'ScrollView', Modal: 'Modal', Switch: 'Switch', ActivityIndicator: 'ActivityIndicator',
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}), removeItem: vi.fn(async () => {}) } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: vi.fn(async () => null), setItemAsync: vi.fn(async () => {}), deleteItemAsync: vi.fn(async () => {}) }));
vi.mock('expo-document-picker', () => ({}));
vi.mock('expo-image-picker', () => ({}));
vi.mock('expo-haptics', () => ({ notificationAsync: vi.fn(async () => {}), selectionAsync: vi.fn(async () => {}), impactAsync: vi.fn(async () => {}), NotificationFeedbackType: { Success: 'success', Error: 'error' }, ImpactFeedbackStyle: { Medium: 'medium' } }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: 'Icon' }));
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
vi.mock('../src/hooks/useReadAloud', () => ({ useReadAloud: () => ({ state: { phase: 'idle' } }) }));
vi.mock('../src/hooks/useAppTheme', () => ({ useAppTheme: () => ({ colors: {}, fonts: {} }) }));
vi.mock('../src/services/chatClient', () => ({ startGeneration: mocks.start, resumeGeneration: mocks.resume }));
vi.mock('../src/services/gatewayApiClient', () => ({ fetchGatewayModels: vi.fn(async () => ({ models: ['model-a'], defaultModel: 'model-a' })), listCompanions: vi.fn(async () => [{ id: 'companion-id', name: '小雨', avatarFileId: null, userName: '', personality: [], speakingStyle: [], appearance: '', memoryEnabled: false, memories: [] }]), createCompanion: vi.fn(), updateCompanion: vi.fn(), getCompanion: vi.fn(async () => ({ id: 'companion-id', name: '小雨', avatarFileId: null })), uploadAttachment: vi.fn(), GatewayApiError: class extends Error {} }));
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
 mocks.start.mockReset();mocks.resume.mockReset();mocks.layout=undefined;controllers=[];
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
  const config = { routeNames: ['Chat', 'Companions'], routeParamList: {}, routeGetIdList: {} };
  let state = router.getInitialState(config);
  state = router.getRehydratedState(router.getStateForAction(state, CommonActions.navigate('Companions'), config)!, config);
  let refresh: (routes: typeof state.routes) => void;
  const dispatch = (action: Parameters<typeof router.getStateForAction>[1]) => {
   state = router.getRehydratedState(router.getStateForAction(state, action, config)!, config);
   refresh(state.routes);
  };
  const stackNavigation = {
   ...navigation, setParams: vi.fn(),
   navigate: (name: string) => dispatch(CommonActions.navigate(name)),
   popTo: (name: string) => dispatch(StackActions.popTo(name)),
  };
  function Screens() {
   const [routes, setRoutes] = useState(state.routes); refresh = setRoutes;
   return createElement('Stack', null, ...routes.map(route => createElement(
    route.name === 'Chat' ? ChatScreen : CompanionsScreen as any,
    { key: route.key, navigation: stackNavigation, route } as any,
   )));
  }
  await act(async () => { root = create(createElement(Screens)); });
  const originalChatKey = state.routes[0]!.key;
  for (let visit = 0; visit < 3; visit++) {
   const contact = root!.root.findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel === '和小雨聊天')!;
   await act(async () => { contact.props.onPress(); });
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
 it('keeps the selected companion when opening a contact removes the list', async () => {
  let leave!: () => void;
  const listNavigation = { ...navigation, addListener: (event: string, callback: () => void) => { if (event === 'beforeRemove') leave = callback; return () => {}; }, popTo: vi.fn(() => leave()) };
  await act(async () => { root = create(createElement(CompanionsScreen, { navigation: listNavigation, route: {} } as any)); });
  const contact = root!.root.findAllByType('Pressable' as any).find(node => node.props.accessibilityLabel === '和小雨聊天')!;
  await act(async () => contact.props.onPress());
  expect(useAppStore.getState().conversations.find(item => item.id === useAppStore.getState().activeConversationId)?.companionId).toBe('companion-id');
  expect(listNavigation.popTo).toHaveBeenCalledWith('Chat');
 });
});
