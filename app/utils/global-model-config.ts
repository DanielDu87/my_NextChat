const GLOBAL_MODEL_CONFIG_KEY = "nextchat:global-model-config";

export type StoredGlobalModelConfig = Record<string, unknown> & {
  model?: string;
  providerName?: string;
  providerId?: string;
  profileId?: string;
  modelSelectionUpdatedAt?: number;
};

function getLocalStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readStoredGlobalModelConfig(): StoredGlobalModelConfig | null {
  try {
    const raw = getLocalStorage()?.getItem(GLOBAL_MODEL_CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as StoredGlobalModelConfig;
  } catch {
    return null;
  }
}

export function writeStoredGlobalModelConfig(
  modelConfig: Record<string, unknown> | null | undefined,
) {
  if (
    !modelConfig ||
    typeof modelConfig !== "object" ||
    Array.isArray(modelConfig)
  ) {
    return;
  }

  try {
    getLocalStorage()?.setItem(
      GLOBAL_MODEL_CONFIG_KEY,
      JSON.stringify(modelConfig),
    );
  } catch {}
}

export function getStoredGlobalModelSelectionUpdatedAt(
  modelConfig?: Record<string, unknown> | null,
) {
  return Number(modelConfig?.modelSelectionUpdatedAt) || 0;
}
