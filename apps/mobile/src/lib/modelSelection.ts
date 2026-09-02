import { DEFAULT_MODEL_ID } from '@nova-chat/protocol';

export type GatewayModelCatalog = {
  models: string[];
  defaultModel: string;
};

function normalizedModels(models: readonly string[]): string[] {
  return [...new Set(models.map((model) => model.trim()).filter(Boolean))];
}

/**
 * Keeps a valid user choice, otherwise migrates stale clients to the
 * administrator's default model and finally to the first allowed model.
 */
export function selectGatewayModel(
  currentModel: string,
  models: readonly string[],
  defaultModel: string,
): string {
  const allowedModels = normalizedModels(models);
  const current = currentModel.trim();
  const preferred = defaultModel.trim();
  if (current && allowedModels.includes(current)) return current;
  if (preferred && allowedModels.includes(preferred)) return preferred;
  return allowedModels[0] ?? (preferred || current || DEFAULT_MODEL_ID);
}

