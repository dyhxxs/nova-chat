import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => vi.stubEnv('EXPO_PUBLIC_GATEWAY_URL', ''));
afterAll(() => vi.unstubAllEnvs());
const storage = vi.hoisted(() => new Map<string,string>());
const secure = vi.hoisted(() => new Map<string,string>());
vi.mock('@react-native-async-storage/async-storage',()=>({default:{ getItem:vi.fn(async (key:string)=>storage.get(key)??null), setItem:vi.fn(async(key:string,value:string)=>{storage.set(key,value);}), removeItem:vi.fn(async(key:string)=>{storage.delete(key);}) }}));
vi.mock('expo-secure-store',()=>({getItemAsync:vi.fn(async(key:string)=>secure.get(key)??null),setItemAsync:vi.fn(async(key:string,value:string)=>{secure.set(key,value);}),deleteItemAsync:vi.fn(async(key:string)=>{secure.delete(key);})}));
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAppStore } from '../src/store/useAppStore';
import { accountScope } from '../src/lib/accountScope';
import type { ForkSelection } from '../src/lib/conversationFork';
import { forkFixture, forkServer, forkUser } from './helpers/conversationForkFixture';
const state=()=>useAppStore.getState();
const select=():ForkSelection=>({scope:accountScope(state()),serverUrl:forkServer,conversation:state().conversations[0]!,messageId:'q2',mode:'rewrite'});
const key=`@nova-chat/account/v1/${encodeURIComponent(forkUser.id)}:${encodeURIComponent(forkServer)}`;
beforeEach(async()=>{
  useAppStore.setState({storageReadBlocked:false});
  vi.mocked(AsyncStorage.setItem).mockImplementation(async(key,value)=>{storage.set(key,value);});
  await state().clearSession(); await state().flushPersistence(); storage.clear(); vi.clearAllMocks();
  await state().setSession('synthetic-fork-token',forkUser,forkServer);
  const source=forkFixture(); useAppStore.setState({conversations:[source],activeConversationId:source.id,storageReadBlocked:false});
});
afterEach(async()=>{ await state().flushPersistence().catch(()=>undefined); vi.restoreAllMocks(); });
describe('account-scoped fork store action',()=>{
  it('atomically adds and selects a fork while retaining the original object and draft',async()=>{
    const source=state().conversations[0]!; const id=state().forkConversation(select());
    expect(state().conversations).toHaveLength(2); expect(state().activeConversationId).toBe(id); expect(state().conversations[1]).toBe(source);
    expect(source.draft).toBe('尚未发送的旧草稿'); expect(state().conversations[0]!.draft).toBe('请换一种解释');
    await state().flushPersistence(); const saved=storage.get(key)!; expect(saved).not.toContain('synthetic-fork-token'); expect(saved).not.toContain('scope');
    expect(JSON.parse(saved).conversations).toHaveLength(2); expect(storage.get('@nova-chat/settings/v1')).not.toContain('问题一');
  });
  it('persists across logout and remains isolated from another account',async()=>{
    const id=state().forkConversation(select()); await state().clearSession();
    await state().setSession('synthetic-other',{...forkUser,id:'other'},forkServer); expect(state().conversations.some(item=>item.id===id)).toBe(false);
    await state().setSession('synthetic-new-session',forkUser,forkServer); expect(state().conversations.find(item=>item.id===id)?.draft).toBe('请换一种解释');
  });
  it('keeps forks isolated from another gateway for the same user',async()=>{
    const id=state().forkConversation(select()); await state().clearSession();
    await state().setSession('synthetic-other',forkUser,'https://other.example.test'); expect(state().conversations.some(item=>item.id===id)).toBe(false);
  });
  it.each(['token','owner','gateway','active','auth','user'] as const)('rejects a stale %s identity before copying',kind=>{
    const selection=select(); const original=state().conversations;
    if(kind==='token')useAppStore.setState({accessToken:'changed'});
    if(kind==='owner')useAppStore.setState({dataOwnerId:'changed'});
    if(kind==='gateway')useAppStore.setState({settings:{...state().settings,serverUrl:'https://changed.test'}});
    if(kind==='active')useAppStore.setState({activeConversationId:'changed'});
    if(kind==='auth')useAppStore.setState({authStatus:'unauthenticated'});
    if(kind==='user')useAppStore.setState({user:{...forkUser,id:'changed'}});
    expect(()=>state().forkConversation(selection)).toThrow('已变化'); expect(state().conversations).toBe(original);
  });
  it('rejects deleted or immutably changed source even when the message ID is reused',()=>{
    const selection=select(); useAppStore.setState({conversations:[{...selection.conversation,draft:'new draft'}]});
    expect(()=>state().forkConversation(selection)).toThrow('已变化');
    useAppStore.setState({conversations:[]}); expect(()=>state().forkConversation(selection)).toThrow('已变化');
  });
  it('rejects duplicate confirmation after the new fork becomes active',()=>{
    const selection=select(); state().forkConversation(selection); expect(()=>state().forkConversation(selection)).toThrow(); expect(state().conversations).toHaveLength(2);
  });
  it('refuses to create extra private data while original storage is read-blocked',()=>{
    useAppStore.setState({storageReadBlocked:true}); expect(()=>state().forkConversation(select())).toThrow('恢复数据'); expect(state().conversations).toHaveLength(1);
  });
  it('keeps the in-memory fork and reports persistence failure, then retries',async()=>{
    vi.mocked(AsyncStorage.setItem).mockRejectedValue(new Error('synthetic full disk'));
    const id=state().forkConversation(select()); await expect(state().flushPersistence()).rejects.toThrow('synthetic full disk');
    expect(state().conversations.some(item=>item.id===id)).toBe(true); expect(state().persistenceError).toBeTruthy();
    vi.mocked(AsyncStorage.setItem).mockImplementation(async(key,value)=>{storage.set(key,value);});
    await state().flushPersistence(); expect(state().persistenceError).toBeUndefined(); expect(JSON.parse(storage.get(key)!).conversations).toHaveLength(2);
  });
  it('caps conversation count before creating a duplicate',()=>{
    const source=state().conversations[0]!; useAppStore.setState({conversations:[source,...Array.from({length:4999},(_,i)=>({...source,id:`other-${i}`,messages:[]}))]});
    expect(()=>state().forkConversation(select())).toThrow('5000'); expect(state().conversations).toHaveLength(5000);
  });
});
