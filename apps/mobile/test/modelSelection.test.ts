import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_ID } from '@nova-chat/protocol';
import { selectGatewayModel } from '../src/lib/modelSelection';

describe('gateway model selection', () => {
  it('keeps the current model when the administrator still allows it', () => {
    expect(selectGatewayModel('model-b', ['model-a', 'model-b'], 'model-a')).toBe('model-b');
  });

  it('migrates a stale model to the administrator default', () => {
    expect(selectGatewayModel('gpt-5.6', ['gpt-5.6-sol', 'gpt-5.6-terra'], 'gpt-5.6-sol')).toBe('gpt-5.6-sol');
  });

  it('uses the first allowed model when an invalid default is returned', () => {
    expect(selectGatewayModel('', [' model-a ', 'model-a', 'model-b'], 'missing')).toBe('model-a');
  });

  it('has a safe local fallback for an empty catalog', () => {
    expect(selectGatewayModel('', [], '')).toBe(DEFAULT_MODEL_ID);
  });
});
