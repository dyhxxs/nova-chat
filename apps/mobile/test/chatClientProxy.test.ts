import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('expo-constants', () => ({ default: { expoConfig: { version: 'test' } } }));
vi.mock('../src/services/gatewayApiClient', () => ({ getGenerationJob: vi.fn(), cancelGenerationJob: vi.fn() }));
import { startGeneration } from '../src/services/chatClient';

const request = {
  requestId: '123e4567-e89b-12d3-a456-426614174000', conversationId: '123e4567-e89b-12d3-a456-426614174001', deviceId: 'test-device-id',
  messages: [{ role: 'user' as const, content: 'hello', attachments: [] }],
  options: { model: 'model-a', reasoningEffort: 'low' as const, verbosity: 'low' as const, instructions: '', maxOutputTokens: 256, webSearch: false, codeInterpreter: false },
};

describe('REST generation proxy fallback', () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each([200, 530])('does not turn an HTML HTTP %s proxy page into an empty successful reply', async (status) => {
    vi.stubGlobal('WebSocket', class { constructor() { throw new Error('WebSocket unavailable'); } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Proxy error</html>', { status })));
    const onDone = vi.fn();
    const error = await new Promise<{code:string}>((resolve) => {
      startGeneration({ serverUrl:'https://gateway.test', accessToken:'token', request,
        handlers: { onDelta:vi.fn(), onDone, onCancelled:vi.fn(), onError:resolve },
      });
    });
    expect(error.code).toBe(status === 200 ? 'invalid_gateway_response' : 'http_530');
    expect(onDone).not.toHaveBeenCalled();
  });
});
