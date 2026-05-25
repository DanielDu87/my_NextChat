const MANUAL_MODEL_SELECTION_STORAGE_KEY =
  "nextchat:manual-session-model-selection";
const MANUAL_MODEL_SELECTION_TTL_MS = 30 * 60 * 1000;

type ManualModelSelectionPayload = {
  sessionId: string;
  modelConfig: Record<string, unknown>;
  updatedAt: number;
};

function pickManualModelIdentity(modelConfig: Record<string, unknown>) {
  return {
    model: modelConfig.model,
    providerName: modelConfig.providerName,
    providerId: modelConfig.providerId,
    profileId: modelConfig.profileId,
  };
}

export function saveManualSessionModelSelection(
  sessionId: string,
  modelConfig: Record<string, unknown>,
) {
  if (typeof window === "undefined" || !sessionId) {
    return;
  }

  try {
    const payload: ManualModelSelectionPayload = {
      sessionId,
      modelConfig: pickManualModelIdentity(modelConfig),
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(
      MANUAL_MODEL_SELECTION_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {}
}

export function readManualSessionModelSelection(sessionId: string) {
  if (typeof window === "undefined" || !sessionId) {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(MANUAL_MODEL_SELECTION_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }

    const payload = JSON.parse(raw) as Partial<ManualModelSelectionPayload>;
    if (
      payload.sessionId !== sessionId ||
      !payload.modelConfig ||
      Date.now() - Number(payload.updatedAt || 0) >
        MANUAL_MODEL_SELECTION_TTL_MS
    ) {
      return undefined;
    }

    return pickManualModelIdentity(payload.modelConfig);
  } catch {
    return undefined;
  }
}
