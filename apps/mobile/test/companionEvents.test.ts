vi.mock('../src/services/companionNotifications', () => ({ presentCompanionNotification: vi.fn(async () => {}) }));
import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ state: {} as any, list: vi.fn(), append: vi.fn(), listener: undefined as undefined | ((state: string) => void), appState: { currentState: 'active', addEventListener: vi.fn() } }));
vi.mock('react-native', () => ({ AppState: mocks.appState }));
vi.mock('../src/services/gatewayApiClient', () => ({ listCompanionEvents: mocks.list }));
vi.mock('../src/store/useAppStore', () => ({ useAppStore: Object.assign((selector: (state: any) => unknown) => selector(mocks.state), { getState: () => mocks.state }) }));
import { useCompanionEvents } from '../src/hooks/useCompanionEvents';
const event = { eventId: 'event-1', companionId: 'person-1', conversationId: 'topic-1', kind: 'message', content: '想起上次说的书了', attachments: [], createdAt: 30 };
let root: ReactTestRenderer | undefined;
function Receiver() { useCompanionEvents(); return null; }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); mocks.list.mockReset(); mocks.append.mockReset();
  mocks.appState.currentState = 'active';
  mocks.appState.addEventListener.mockImplementation((_event, listener) => { mocks.listener = listener; return { remove: vi.fn() }; });
  mocks.state = { accessToken: 'account-1-token', user: { id: 'account-1' }, settings: { serverUrl: 'https://gateway.test' }, activeConversationId: 'ordinary-topic',
    conversations: [{ id: 'ordinary-topic', messages: [] }, { id: 'topic-1', companionId: 'person-1', messages: [{ sourceEventId: 'old-event', createdAt: 20 }, { createdAt: 100 }] }], appendCompanionEvent: mocks.append };
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const mount = async () => { await act(async () => { root = create(createElement(Receiver)); }); };
describe('global companion event reception', () => {
  it('receives a photo or proactive message in an unopened topic using the last persisted event cursor', async () => {
    mocks.list.mockResolvedValue([event]); await mount();
    expect(mocks.list).toHaveBeenCalledWith('https://gateway.test', 'account-1-token', 'person-1', 'topic-1', 20, expect.any(AbortSignal));
    expect(mocks.append).toHaveBeenCalledWith('topic-1', event);
  });
  it('pauses in the background and polls immediately when returning to the foreground', async () => {
    mocks.list.mockResolvedValue([]); mocks.appState.currentState = 'background'; await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(24_000); }); expect(mocks.list).not.toHaveBeenCalled();
    mocks.appState.currentState = 'active'; await act(async () => { mocks.listener?.('active'); });
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });
  it('rejects a stale response after changing account and aborts on unmount', async () => {
    let resolve!: (events: unknown[]) => void; mocks.list.mockImplementation(() => new Promise(done => { resolve = done; })); await mount();
    const signal = mocks.list.mock.calls[0]![5] as AbortSignal;
    mocks.state = { ...mocks.state, accessToken: 'account-2-token', user: { id: 'account-2' } };
    await act(async () => { resolve([event]); }); expect(mocks.append).not.toHaveBeenCalled();
    await act(async () => { root!.unmount(); }); root = undefined; expect(signal.aborted).toBe(true);
  });
});
