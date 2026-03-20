function toPositiveNumber(value: unknown) {
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 0;
}

export function getChatGlobalClearAtFromState(state: unknown) {
  if (!state || typeof state !== "object" || !("globalClearAt" in state)) {
    return 0;
  }

  return toPositiveNumber((state as { globalClearAt?: unknown }).globalClearAt);
}

export function getDeletedSessionTimestampsFromState(state: unknown) {
  if (
    !state ||
    typeof state !== "object" ||
    !("deletedSessionTimestamps" in state)
  ) {
    return {} as Record<string, number>;
  }

  const deletedSessionTimestamps = (
    state as {
      deletedSessionTimestamps?: unknown;
    }
  ).deletedSessionTimestamps;

  if (
    !deletedSessionTimestamps ||
    typeof deletedSessionTimestamps !== "object"
  ) {
    return {} as Record<string, number>;
  }

  return Object.fromEntries(
    Object.entries(deletedSessionTimestamps)
      .map(([sessionId, value]) => [sessionId, Number(value)] as const)
      .filter(([, deletedAt]) => Number.isFinite(deletedAt) && deletedAt > 0),
  ) as Record<string, number>;
}

export function isEffectivelyEmptyRemoteChatState(state: unknown) {
  return (
    getChatGlobalClearAtFromState(state) <= 0 &&
    Object.keys(getDeletedSessionTimestampsFromState(state)).length === 0
  );
}
