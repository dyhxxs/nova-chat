import { createElement, StrictMode } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ appState: 'active', listeners: new Set<(state: string) => void>(), fetch: vi.fn(), restore: vi.fn(), clear: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' }, AppState: { get currentState() { return mocks.appState; }, addEventListener: (_event: string, callback: (state: string) => void) => { mocks.listeners.add(callback); return { remove: () => mocks.listeners.delete(callback) }; } } }));
vi.mock('../src/store/useAppStore', async () => { const { create } = await import('zustand'); return { useAppStore: create(() => ({})) }; });
vi.mock('../src/services/restoreGatewaySession', async (original) => ({ ...await original<typeof import('../src/services/restoreGatewaySession')>(), restoreGatewaySession: mocks.fetch }));
import { useAppStore } from '../src/store/useAppStore';
import { GatewayApiError } from '../src/services/gatewayApiClient';
import { useSessionRecovery } from '../src/hooks/useSessionRecovery';

let result: ReturnType<typeof useSessionRecovery>;
let root: ReactTestRenderer | undefined;
const user = { id: 'recovery-user', email: 'test@example.com', displayName: 'Test', role: 'user' as const, disabled: false, createdAt: 1, updatedAt: 1 };
const reply = { user, catalog: undefined };
const outage = () => new GatewayApiError('http_530', '入口不可用', true, 530);
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function Harness() { result = useSessionRecovery(); return null; }
async function mount(strict = false) { await act(async () => { root = create(strict ? createElement(StrictMode, null, createElement(Harness)) : createElement(Harness)); }); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function appState(state: string) { await act(async () => { mocks.appState = state; for (const callback of mocks.listeners) callback(state); }); }
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mocks.appState = 'active'; mocks.listeners.clear(); mocks.fetch.mockReset(); mocks.restore.mockReset(); mocks.clear.mockReset();
  mocks.fetch.mockRejectedValue(outage());
  mocks.restore.mockImplementation(async () => { useAppStore.setState({ authStatus: 'authenticated', user }); });
  mocks.clear.mockImplementation(async () => { useAppStore.setState({ accessToken: '', authStatus: 'unauthenticated', user: undefined }); });
  useAppStore.setState({ hydrated: true, authStatus: 'unknown', accessToken: 'synthetic-session', user: undefined, settings: { ...useAppStore.getState().settings, serverUrl: 'https://gateway.test' }, restoreUserState: mocks.restore, clearSession: mocks.clear, setAuthState: (authStatus) => useAppStore.setState({ authStatus }) });
});
afterEach(async () => { if (root) await act(async () => { root!.unmount(); }); root = undefined; vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('saved-session recovery', () => {
  it('restores automatically when the same gateway comes back without a tap', async () => {
    mocks.fetch.mockRejectedValueOnce(outage()).mockResolvedValueOnce(reply);
    await mount(); expect(result.error).toBe('入口不可用'); expect(result.retryScheduled).toBe(true);
    await advance(2999); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await advance(1); expect(mocks.restore).toHaveBeenCalledWith(user, undefined);
    expect(useAppStore.getState().authStatus).toBe('authenticated');
    await advance(120000); expect(mocks.fetch).toHaveBeenCalledTimes(2); expect(mocks.clear).not.toHaveBeenCalled();
  });
  it('backs off 3/6/12/24 seconds and caps at 30 seconds', async () => {
    await mount(); let calls = 1;
    for (const delay of [3000, 6000, 12000, 24000, 30000, 30000]) {
      await advance(delay - 1); expect(mocks.fetch).toHaveBeenCalledTimes(calls);
      await advance(1); expect(mocks.fetch).toHaveBeenCalledTimes(++calls);
    }
    for (const [url, token] of mocks.fetch.mock.calls) { expect(url).toBe('https://gateway.test'); expect(token).toBe('synthetic-session'); }
  });
  it('does not start duplicate requests when retry is tapped repeatedly', async () => {
    const pending = deferred<typeof reply>(); mocks.fetch.mockReturnValue(pending.promise);
    await mount(); await act(async () => { result.retryNow(); result.retryNow(); result.retryNow(); });
    expect(result.retrying).toBe(true); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(reply); }); expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it('manual retry replaces the scheduled timer without an extra request', async () => {
    await mount(); mocks.fetch.mockResolvedValue(reply);
    await act(async () => { result.retryNow(); result.retryNow(); });
    await advance(60000); expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });
  it.each([408, 425, 429])('automatically retries transient HTTP %s even without a server retry flag', async (status) => {
    mocks.fetch.mockRejectedValue(new GatewayApiError(`http_${status}`, '稍后重试', false, status));
    await mount(); await advance(3000); expect(mocks.fetch).toHaveBeenCalledTimes(2); expect(mocks.clear).not.toHaveBeenCalled();
  });
  it.each([401, 403])('clears a session only for an explicit gateway auth error (%s)', async (status) => {
    mocks.fetch.mockRejectedValue(new GatewayApiError('unauthorized', '登录失效', false, status));
    await mount(); expect(mocks.clear).toHaveBeenCalledTimes(1); await advance(60000); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401, 403])('preserves credentials on a proxy HTTP %s and does not hammer a denied endpoint', async (status) => {
    mocks.fetch.mockRejectedValue(new GatewayApiError(`http_${status}`, '代理拒绝', false, status));
    await mount(); expect(result.retryScheduled).toBe(false); expect(mocks.clear).not.toHaveBeenCalled();
    await advance(60000); await appState('background'); await appState('active'); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    mocks.fetch.mockResolvedValue(reply); await act(async () => { result.retryNow(); }); expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it('aborts pending requests and ignores late results after switching credentials', async () => {
    const old = deferred<typeof reply>(); const next = deferred<typeof reply>(); mocks.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await mount(); const signal = mocks.fetch.mock.calls[0]![2] as AbortSignal;
    await act(async () => { useAppStore.setState({ accessToken: 'new-session' }); });
    expect(signal.aborted).toBe(true);
    await act(async () => { old.resolve(reply); }); expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls[1]![1]).toBe('new-session');
    await act(async () => { next.resolve(reply); }); expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it('does not apply an old gateway result or let an old exit button clear the new account', async () => {
    const old = deferred<typeof reply>(); const next = deferred<typeof reply>(); mocks.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await mount(); const staleExit = result.exitSession; const staleRetry = result.retryNow;
    await act(async () => { useAppStore.setState((state) => ({ accessToken: 'other-session', settings: { ...state.settings, serverUrl: 'https://other.test' } })); old.resolve(reply); });
    await act(async () => { staleExit(); staleRetry(); });
    expect(mocks.clear).not.toHaveBeenCalled(); expect(mocks.restore).not.toHaveBeenCalled();
    expect(mocks.fetch.mock.calls.map(([url, token]) => [url, token])).toEqual([['https://gateway.test', 'synthetic-session'], ['https://other.test', 'other-session']]);
    await act(async () => { next.resolve(reply); }); expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it('ignores an old unauthorized reply after a new session is installed', async () => {
    const old = deferred<typeof reply>(); mocks.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(new Promise(() => undefined));
    await mount(); await act(async () => { useAppStore.setState({ accessToken: 'new-session' }); old.reject(new GatewayApiError('unauthorized', 'old session', false, 401)); });
    expect(mocks.clear).not.toHaveBeenCalled();
  });
  it('pauses scheduled retries in the background and retries on return', async () => {
    await mount(); await appState('background'); await advance(120000); expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(result.retryScheduled).toBe(false); mocks.fetch.mockResolvedValue(reply);
    await appState('active'); expect(mocks.fetch).toHaveBeenCalledTimes(2); expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it('aborts an in-flight request in the background and discards its late result', async () => {
    const old = deferred<typeof reply>(); const next = deferred<typeof reply>(); mocks.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await mount(); const signal = mocks.fetch.mock.calls[0]![2] as AbortSignal;
    await appState('background'); expect(signal.aborted).toBe(true);
    await act(async () => { old.resolve(reply); }); expect(mocks.restore).not.toHaveBeenCalled();
    await appState('active'); await appState('active'); expect(mocks.fetch).toHaveBeenCalledTimes(2);
    await act(async () => { next.resolve(reply); }); expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it('does not start while mounted in the background', async () => {
    mocks.appState = 'background'; await mount(); expect(mocks.fetch).not.toHaveBeenCalled();
    await appState('active'); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('exit cancels the request before clearing the session', async () => {
    const old = deferred<typeof reply>(); mocks.fetch.mockReturnValueOnce(old.promise); await mount();
    const signal = mocks.fetch.mock.calls[0]![2] as AbortSignal;
    await act(async () => { result.exitSession(); old.resolve(reply); });
    expect(signal.aborted).toBe(true); expect(mocks.clear).toHaveBeenCalledTimes(1); expect(mocks.restore).not.toHaveBeenCalled();
    await advance(120000); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('cleans timers and listeners on unmount', async () => {
    await mount(); await act(async () => { root!.unmount(); }); root = undefined;
    expect(mocks.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0);
    await advance(120000); expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
  it('cleans up the first StrictMode request and does not restore its stale result', async () => {
    const old = deferred<typeof reply>(); const next = deferred<typeof reply>(); mocks.fetch.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    await mount(true); expect(mocks.fetch).toHaveBeenCalledTimes(2); expect((mocks.fetch.mock.calls[0]![2] as AbortSignal).aborted).toBe(true);
    await act(async () => { old.resolve(reply); }); expect(mocks.restore).not.toHaveBeenCalled();
    await act(async () => { next.resolve(reply); }); expect(mocks.restore).toHaveBeenCalledTimes(1);
  });
  it.each(['not-hydrated', 'authenticated', 'no-token', 'no-server'] as const)('does not request a session when %s', async (mode) => {
    if (mode === 'not-hydrated') useAppStore.setState({ hydrated: false });
    if (mode === 'authenticated') useAppStore.setState({ authStatus: 'authenticated' });
    if (mode === 'no-token') useAppStore.setState({ accessToken: '' });
    if (mode === 'no-server') useAppStore.setState((state) => ({ settings: { ...state.settings, serverUrl: '' } }));
    await mount(); expect(mocks.fetch).not.toHaveBeenCalled(); expect(mocks.clear).toHaveBeenCalledTimes(mode === 'no-server' ? 1 : 0);
  });
  it('does not automatically repeat network requests for a local data restore failure', async () => {
    mocks.fetch.mockResolvedValue(reply); mocks.restore.mockRejectedValue(new Error('本地读取失败'));
    await mount(); expect(result.error).toBe('本地读取失败'); expect(result.retryScheduled).toBe(false);
    await advance(120000); expect(mocks.fetch).toHaveBeenCalledTimes(1); expect(mocks.clear).not.toHaveBeenCalled();
  });
});
