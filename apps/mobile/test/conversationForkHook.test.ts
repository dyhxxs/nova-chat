import { createElement, StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({ focused:true,appState:'active', listeners:new Map<string,Set<()=>void>>(),appListeners:new Set<(state:string)=>void>(),create:vi.fn() }));
vi.mock('react-native',()=>({AppState:{get currentState(){return mocks.appState;},addEventListener:(_event:string,fn:(state:string)=>void)=>{mocks.appListeners.add(fn);return {remove:()=>mocks.appListeners.delete(fn)};}}}));
vi.mock('@react-navigation/native',()=>{const navigation={isFocused:()=>mocks.focused,addListener:(event:string,fn:()=>void)=>{const set=mocks.listeners.get(event)??new Set();set.add(fn);mocks.listeners.set(event,set);return ()=>set.delete(fn);}};return {useNavigation:()=>navigation};});
vi.mock('../src/store/useAppStore',async()=>{const {create}=await import('zustand');return {useAppStore:create(()=>({}))};});
import { useAppStore } from '../src/store/useAppStore';
import { useConversationFork } from '../src/hooks/useConversationFork';
import { ConversationForkError, createConversationFork, isForkSelectionCurrent } from '../src/lib/conversationFork';
import { forkFixture, forkServer, forkUser } from './helpers/conversationForkFixture';
let result:ReturnType<typeof useConversationFork>;
let root:ReactTestRenderer|undefined;
function Harness({blocked=false}:{blocked?:boolean}){result=useConversationFork(blocked);return null;}
async function mount(strict=false,blocked=false){await act(async()=>{root=create(strict?createElement(StrictMode,null,createElement(Harness,{blocked})):createElement(Harness,{blocked}));});}
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);mocks.focused=true;mocks.appState='active';mocks.listeners.clear();mocks.appListeners.clear();mocks.create.mockReset();
  const source=forkFixture();useAppStore.setState({dataOwnerId:forkUser.id,dataOwnerServerUrl:forkServer,accessToken:'synthetic',authStatus:'authenticated',user:forkUser,settings:{...useAppStore.getState().settings,serverUrl:forkServer},activeConversationId:source.id,conversations:[source],forkConversation:(selection)=>{
    if(!isForkSelectionCurrent(selection,useAppStore.getState()))throw new ConversationForkError('invalid');mocks.create(selection);const fork=createConversationFork(selection.conversation,selection.messageId,selection.mode);useAppStore.setState(state=>({conversations:[fork,...state.conversations],activeConversationId:fork.id}));return fork.id;
  }});
});
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;vi.unstubAllGlobals();});
describe('mounted fork confirmation lifecycle',()=>{
  it('requires explicit confirmation and creates no streaming turn',async()=>{
    await mount();await act(async()=>result.open('q2','rewrite'));expect(result.selected?.preview.draft).toBe('请换一种解释');expect(mocks.create).not.toHaveBeenCalled();
    await act(async()=>result.confirm());expect(mocks.create).toHaveBeenCalledTimes(1);expect(result.selected).toBeUndefined();expect(useAppStore.getState().conversations[0]!.draft).toBe('请换一种解释');expect(useAppStore.getState().conversations[0]!.messages.every(item=>item.status==='complete')).toBe(true);
  });
  it('cancels without creating a fork or altering the original draft',async()=>{
    await mount();await act(async()=>result.open('q2','rewrite'));await act(async()=>result.close());await act(async()=>result.confirm());expect(mocks.create).not.toHaveBeenCalled();expect(useAppStore.getState().conversations[0]!.draft).toBe('尚未发送的旧草稿');
  });
  it('consumes confirmation once even for double taps in one React batch',async()=>{
    await mount();await act(async()=>result.open('a1','continue'));const confirm=result.confirm;await act(async()=>{confirm();confirm();});expect(mocks.create).toHaveBeenCalledTimes(1);
  });
  it('does not let an old modal confirm the newly selected message',async()=>{
    await mount();await act(async()=>result.open('a1','continue'));const old=result.confirm;await act(async()=>result.open('q2','rewrite'));await act(async()=>old());expect(mocks.create).not.toHaveBeenCalled();expect(result.selected?.source.messageId).toBe('q2');
  });
  it.each(['account','session','gateway','conversation','source','deleted'] as const)('invalidates consent immediately on %s changes',async(kind)=>{
    await mount();await act(async()=>result.open('a1','continue'));const oldConfirm=result.confirm;const oldOpen=result.open;
    await act(async()=>{const state=useAppStore.getState();if(kind==='account')useAppStore.setState({dataOwnerId:'other'});if(kind==='session')useAppStore.setState({accessToken:'other'});if(kind==='gateway')useAppStore.setState({settings:{...state.settings,serverUrl:'https://other.test'}});if(kind==='conversation')useAppStore.setState({activeConversationId:'other'});if(kind==='source')useAppStore.setState({conversations:state.conversations.map(item=>({...item,draft:'new'}))});if(kind==='deleted')useAppStore.setState({conversations:[]});oldConfirm();oldOpen('a1','continue');});
    expect(mocks.create).not.toHaveBeenCalled();expect(result.selected).toBeUndefined();
  });
  it.each(['blur','background'] as const)('closes on %s and never automatically creates on return',async(event)=>{
    await mount();await act(async()=>result.open('a1','continue'));const old=result.confirm;
    await act(async()=>{if(event==='blur'){mocks.focused=false;for(const fn of mocks.listeners.get('blur')??[])fn();}else{mocks.appState='background';for(const fn of mocks.appListeners)fn('background');}old();});
    expect(result.selected).toBeUndefined();expect(mocks.create).not.toHaveBeenCalled();await act(async()=>{mocks.focused=true;mocks.appState='active';for(const fn of mocks.listeners.get('focus')??[])fn();for(const fn of mocks.appListeners)fn('active');});expect(mocks.create).not.toHaveBeenCalled();
  });
  it('blocks open and stale confirmation while local attachments or uploads are pending',async()=>{
    await mount(false,true);await act(async()=>result.open('a1','continue'));expect(result.error).toContain('附件');expect(result.selected).toBeUndefined();
    await act(async()=>root!.update(createElement(Harness,{blocked:false})));await act(async()=>result.open('a1','continue'));const old=result.confirm;
    await act(async()=>root!.update(createElement(Harness,{blocked:true})));await act(async()=>old());expect(mocks.create).not.toHaveBeenCalled();expect(result.selected).toBeUndefined();
  });
  it('reports a running source rather than copying partial content',async()=>{
    useAppStore.setState(state=>({conversations:state.conversations.map(item=>({...item,messages:item.messages.map(message=>message.id==='a2'?{...message,status:'streaming' as const}:message)}))}));
    await mount();await act(async()=>result.open('a1','continue'));expect(result.error).toContain('仍在生成');expect(mocks.create).not.toHaveBeenCalled();
  });
  it('survives StrictMode and removes all navigation and app listeners on unmount',async()=>{
    await mount(true);await act(async()=>result.open('a1','continue'));const old=result.confirm;await act(async()=>root!.unmount());root=undefined;old();
    expect(mocks.create).not.toHaveBeenCalled();expect(mocks.appListeners.size).toBe(0);expect([...mocks.listeners.values()].every(set=>set.size===0)).toBe(true);
  });
});
