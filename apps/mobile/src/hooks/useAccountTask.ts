import { useEffect, useRef, useState } from 'react';
import { accountScope } from '../lib/accountScope';
import { useAppStore } from '../store/useAppStore';

/** Discards late UI results, and provides an authority check before external sharing. */
export function useAccountTask() {
  const scope = useAppStore(accountScope);
  const sequence = useRef(0);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    sequence.current++; running.current = false; setBusy(false);
    return () => { sequence.current++; running.current = false; };
  }, [scope]);
  const run = async (action: (isCurrent: () => boolean) => Promise<void>, onError: (error: unknown) => void) => {
    const startingScope = accountScope(useAppStore.getState());
    if (running.current || startingScope !== scope) return;
    running.current = true;
    const id = ++sequence.current;
    const isCurrent = () => id === sequence.current && startingScope === accountScope(useAppStore.getState());
    setBusy(true);
    try { await action(isCurrent); }
    catch (error) { if (isCurrent()) onError(error); }
    finally { if (isCurrent()) { running.current = false; setBusy(false); } }
  };
  return { scope, busy, run };
}
