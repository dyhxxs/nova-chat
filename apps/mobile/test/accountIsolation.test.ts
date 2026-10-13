import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Test self-hosted URL switching independently of the release shell's preset.
vi.hoisted(() => vi.stubEnv('EXPO_PUBLIC_GATEWAY_URL', ''));
afterAll(() => vi.unstubAllEnvs());

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn().mockResolvedValue(null),
    setItem: vi.fn().mockResolvedValue(undefined),
    removeItem: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn().mockResolvedValue(''),
  setItemAsync: vi.fn().mockResolvedValue(undefined),
  deleteItemAsync: vi.fn().mockResolvedValue(undefined),
}));

import { useAppStore } from '../src/store/useAppStore';

const userA = {
  id: 'user-a',
  email: 'a@example.com',
  displayName: 'User A',
  role: 'user' as const,
  disabled: false,
  createdAt: 1,
  updatedAt: 1,
};
const userB = {
  ...userA,
  id: 'user-b',
  email: 'b@example.com',
  displayName: 'User B',
};

function currentMessages() {
  return useAppStore.getState().conversations.flatMap((conversation) => conversation.messages);
}

describe('account-scoped local state', () => {
  it('applies a refreshed default model before exposing the authenticated screen', async () => {
    await useAppStore.getState().setSession('token-b', userB, 'https://new.example.com');
    useAppStore.getState().updateSettings({ model: 'removed-model' });
    await useAppStore.getState().restoreUserState(userB, { models: ['new-default'], defaultModel: 'new-default' });
    expect(useAppStore.getState().settings.model).toBe('new-default');
    expect(useAppStore.getState().authStatus).toBe('authenticated');
  });

  it('uses the explicitly authenticated server when switching self-hosted gateways', async () => {
    useAppStore.getState().updateSettings({ serverUrl: 'https://old.example.com' });
    await useAppStore.getState().setSession('token-b', userB, 'https://new.example.com');
    expect(useAppStore.getState().settings.serverUrl).toBe('https://new.example.com');
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    await useAppStore.getState().clearSession();
  });

  it('does not expose the previous account conversations after switching accounts', async () => {
    await useAppStore.getState().setSession('token-a', userA);
    const firstTurn = useAppStore.getState().beginTurn('这是账号 A 的私密内容');
    useAppStore.getState().completeAssistant(firstTurn.conversationId, firstTurn.assistantMessageId, { model: 'model-a' });
    expect(currentMessages().some((message) => message.content.includes('账号 A'))).toBe(true);

    // Exercise the actual logout -> login path used by the settings/profile screens.
    await useAppStore.getState().clearSession();
    await useAppStore.getState().setSession('token-b', userB);

    expect(useAppStore.getState().user?.id).toBe('user-b');
    expect(useAppStore.getState().dataOwnerId).toBe('user-b');
    expect(currentMessages()).toEqual([]);
    expect(useAppStore.getState().conversations).toHaveLength(1);
  });

  it('clears local data if authentication resolves to a different account', async () => {
    await useAppStore.getState().setSession('token-a', userA);
    const firstTurn = useAppStore.getState().beginTurn('账号 A 不应出现在账号 B 中');
    useAppStore.getState().completeAssistant(firstTurn.conversationId, firstTurn.assistantMessageId);

    // This mirrors App.tsx validating a restored token with /v1/auth/me.
    useAppStore.getState().setAuthState('authenticated', userB);

    expect(useAppStore.getState().dataOwnerId).toBe('user-b');
    expect(currentMessages()).toEqual([]);
  });
});

it('does not carry explicit library opt-in across accounts', async () => {
  await useAppStore.getState().setSession('token-a', userA, 'https://library.example');
  useAppStore.getState().updateSettings({ knowledgeBase: true });
  await useAppStore.getState().setSession('token-b', userB, 'https://library.example');
  expect(useAppStore.getState().settings.knowledgeBase).toBe(false);
});
