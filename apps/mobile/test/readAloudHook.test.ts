import { createElement, StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  focused: true, appState: 'active',
  focusListeners: new Map<string, Set<() => void>>(), appListeners: new Set<(state: string) => void>(),
  speak: vi.fn(), stop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('react-native', () => ({ AppState: {
  get currentState() { return mocks.appState; },
  addEventListener: (_event: string, handler: (state: string) => void) => { mocks.appListeners.add(handler); return { remove: () => mocks.appListeners.delete(handler) }; },
} }));
vi.mock('@react-navigation/native', () => {
  const navigation = {
    isFocused: () => mocks.focused,
    addListener: (event: string, handler: () => void) => {
      const listeners = mocks.focusListeners.get(event) ?? new Set(); listeners.add(handler); mocks.focusListeners.set(event, listeners);
      return () => listeners.delete(handler);
    },
  };
  return { useNavigation: () => navigation };
});
vi.mock('../src/services/speechDriver', () => ({ speechDriver: { maxLength: 4000, speak: mocks.speak, stop: mocks.stop } }));
vi.mock('../src/store/useAppStore', async () => {
  const { create } = await import('zustand');
  return { useAppStore: create(() => ({})) };
});
import { useReadAloud } from '../src/hooks/useReadAloud';
import { useAppStore } from '../src/store/useAppStore';
let result: ReturnType<typeof useReadAloud>;
let root: ReactTestRenderer | undefined;
function Harness() { result = useReadAloud(); return null; }
async function mount(strict = false) { await act(async () => { root = create(strict ? createElement(StrictMode, null, createElement(Harness)) : createElement(Harness)); }); }
async function openAndPlay() { await act(async () => result.open('answer')); await act(async () => result.play(1, 'auto')); }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.speak.mockReset(); mocks.stop.mockReset().mockResolvedValue(undefined);
  mocks.focused = true; mocks.appState = 'active'; mocks.focusListeners.clear(); mocks.appListeners.clear();
  useAppStore.setState({ dataOwnerId: 'a', dataOwnerServerUrl: 'https://a.test', accessToken: 'synthetic', activeConversationId: 'chat', conversations: [{ id: 'chat', title: 'synthetic', createdAt: 1, updatedAt: 1, messages: [
    { id: 'answer', role: 'assistant', status: 'complete', content: '测试回复。'.repeat(90), createdAt: 1, attachments: [] },
    { id: 'second', role: 'assistant', status: 'complete', content: '另一条回复', createdAt: 2, attachments: [] },
  ] }] });
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.unstubAllGlobals(); });

describe('mounted read-aloud hook lifecycle', () => {
  it('opens a consent target without sending text; only confirmation speaks', async () => {
    await mount(); await act(async () => result.open('answer'));
    expect(result.selected?.messageId).toBe('answer'); expect(mocks.speak).not.toHaveBeenCalled();
    await act(async () => result.play(0.8, 'zh-CN')); expect(result.selected).toBeUndefined(); expect(mocks.speak).toHaveBeenCalledTimes(1);
  });
  it('ignores double confirmation and stale confirmation from another message', async () => {
    await mount(); await act(async () => result.open('answer')); const oldPlay = result.play;
    await act(async () => result.open('second')); await act(async () => oldPlay(1, 'auto'));
    expect(mocks.speak).not.toHaveBeenCalled(); expect(result.selected?.messageId).toBe('second');
    const currentPlay = result.play; await act(async () => { currentPlay(1, 'auto'); currentPlay(1, 'auto'); });
    expect(mocks.speak).toHaveBeenCalledTimes(1); expect(mocks.speak.mock.calls[0]![0]).toBe('另一条回复');
  });
  it('closes old consent and refuses its callback after account change', async () => {
    await mount(); await act(async () => result.open('answer')); const oldPlay = result.play; const oldOpen = result.open;
    await act(async () => { useAppStore.setState({ accessToken: 'different-synthetic' }); oldPlay(1, 'auto'); oldOpen('answer'); });
    expect(result.selected).toBeUndefined(); expect(mocks.speak).not.toHaveBeenCalled();
  });
  it('stops immediately on account switch, including old engine completion', async () => {
    await mount(); await openAndPlay(); const oldOptions = mocks.speak.mock.calls[0]![1];
    await act(async () => { useAppStore.setState({ dataOwnerId: 'b' }); oldOptions.onDone(); });
    expect(result.state.phase).toBe('idle'); expect(mocks.speak).toHaveBeenCalledTimes(1);
  });
  it.each(['blur', 'background'] as const)('closes consent and stops playback on %s without auto-resuming', async event => {
    await mount(); await openAndPlay();
    await act(async () => {
      if (event === 'blur') { mocks.focused = false; for (const fn of mocks.focusListeners.get('blur') ?? []) fn(); }
      else { mocks.appState = 'background'; for (const fn of mocks.appListeners) fn('background'); }
    });
    expect(result.state.phase).toBe('idle');
    await act(async () => result.open('second')); expect(result.selected).toBeUndefined();
    await act(async () => {
      mocks.focused = true; mocks.appState = 'active'; for (const fn of mocks.focusListeners.get('focus') ?? []) fn(); for (const fn of mocks.appListeners) fn('active');
    });
    expect(mocks.speak).toHaveBeenCalledTimes(1);
  });
  it('regeneration stops playback before the source text is replaced', async () => {
    await mount(); await openAndPlay();
    await act(async () => useAppStore.setState(state => ({ conversations: state.conversations.map(chat => ({ ...chat, messages: chat.messages.map(message => message.id === 'answer' ? { ...message, status: 'streaming' } : message) })) })));
    expect(result.state.phase).toBe('idle');
  });
  it('pressing the currently playing answer stops without opening another consent', async () => {
    await mount(); await openAndPlay(); await act(async () => result.open('answer'));
    expect(result.state.phase).toBe('idle'); expect(result.selected).toBeUndefined(); expect(mocks.speak).toHaveBeenCalledTimes(1);
  });
  it('survives StrictMode effect replay and removes all listeners on unmount', async () => {
    await mount(true); await openAndPlay(); expect(mocks.speak).toHaveBeenCalledTimes(1);
    const oldOptions = mocks.speak.mock.calls[0]![1]; await act(async () => root!.unmount()); root = undefined;
    oldOptions.onDone(); await Promise.resolve();
    expect(mocks.appListeners.size).toBe(0); expect([...mocks.focusListeners.values()].every(set => set.size === 0)).toBe(true);
    expect(mocks.speak).toHaveBeenCalledTimes(1);
  });
});
