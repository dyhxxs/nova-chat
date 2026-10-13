import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { isInvalidSession, isRetryableSessionError, restoreGatewaySession } from '../services/restoreGatewaySession';
import { useAppStore } from '../store/useAppStore';

type RecoveryStatus = { error: string; retrying: boolean; retryScheduled: boolean };
type RecoveryControls = { serverUrl: string; accessToken: string; retry: () => void; exit: () => void };
const idle: RecoveryStatus = { error: '', retrying: false, retryScheduled: false };

/** Only restores the saved session at its existing origin; never starts a chat or changes gateways. */
export function useSessionRecovery() {
  const hydrated = useAppStore((state) => state.hydrated);
  const authStatus = useAppStore((state) => state.authStatus);
  const serverUrl = useAppStore((state) => state.settings.serverUrl);
  const accessToken = useAppStore((state) => state.accessToken);
  const [status, setStatus] = useState<RecoveryStatus>(idle);
  const controls = useRef<RecoveryControls | undefined>(undefined);

  useEffect(() => {
    setStatus(idle);
    if (!hydrated || authStatus !== 'unknown') return;
    if (!accessToken || !serverUrl.trim()) {
      if (accessToken) void useAppStore.getState().clearSession();
      else useAppStore.getState().setAuthState('unauthenticated');
      return;
    }
    let disposed = false;
    let terminal = false;
    let foreground = AppState.currentState === 'active' || AppState.currentState == null;
    let inFlight = false;
    let sequence = 0;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    const isCurrent = () => {
      const current = useAppStore.getState();
      return !disposed && current.hydrated && current.authStatus === 'unknown'
        && current.accessToken === accessToken && current.settings.serverUrl === serverUrl;
    };
    const clearTimer = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
    const cancelRequest = () => {
      clearTimer(); sequence++; inFlight = false;
      controller?.abort(); controller = undefined;
    };
    const stop = () => { disposed = true; cancelRequest(); };
    const run = async (manual = false) => {
      if (!isCurrent() || !foreground || inFlight || (terminal && !manual)) return;
      if (manual) { failures = 0; terminal = false; }
      clearTimer();
      const request = new AbortController();
      controller = request;
      const id = ++sequence;
      inFlight = true;
      setStatus((previous) => ({ ...previous, retrying: true, retryScheduled: false }));
      const canApply = () => isCurrent() && foreground && id === sequence && !request.signal.aborted;
      try {
        const { user, catalog } = await restoreGatewaySession(serverUrl, accessToken, request.signal);
        if (!canApply()) return;
        await useAppStore.getState().restoreUserState(user, catalog);
        if (!disposed && id === sequence) {
          terminal = true;
          if (canApply()) setStatus(idle);
        }
      } catch (error: unknown) {
        if (!canApply()) return;
        if (isInvalidSession(error)) {
          stop();
          await useAppStore.getState().clearSession();
          return;
        }
        const retryable = isRetryableSessionError(error);
        terminal = !retryable;
        failures++;
        setStatus({ error: error instanceof Error ? error.message : '连接服务器失败，请重试。', retrying: false, retryScheduled: retryable });
        if (retryable) {
          const delay = Math.min(30_000, 3_000 * 2 ** Math.min(failures - 1, 4));
          timer = setTimeout(() => { timer = undefined; void run(); }, delay);
        }
      } finally {
        if (!disposed && id === sequence) {
          inFlight = false; controller = undefined;
          setStatus((previous) => ({ ...previous, retrying: false }));
        }
      }
    };
    const entry: RecoveryControls = {
      serverUrl, accessToken,
      retry: () => { void run(true); },
      exit: () => { if (!isCurrent()) return; stop(); void useAppStore.getState().clearSession(); },
    };
    controls.current = entry;
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      if (foreground === active) return;
      foreground = active;
      if (!foreground) {
        cancelRequest();
        if (isCurrent()) setStatus((previous) => ({ ...previous, retrying: false, retryScheduled: false }));
      } else if (!terminal) { void run(); }
    });
    void run();
    return () => {
      stop(); subscription.remove();
      if (controls.current === entry) controls.current = undefined;
    };
  }, [accessToken, authStatus, hydrated, serverUrl]);

  const matchingControls = () => {
    const current = controls.current;
    return current?.serverUrl === serverUrl && current.accessToken === accessToken ? current : undefined;
  };
  return { ...status, retryNow: () => matchingControls()?.retry(), exitSession: () => matchingControls()?.exit() };
}
