function getPersistedLastUpdateTime(value: string | null | undefined) {
  if (!value) return 0;

  try {
    const parsed = JSON.parse(value);
    return Number(parsed?.state?.lastUpdateTime || 0) || 0;
  } catch {
    return 0;
  }
}

export function resolveHydratedStateValue(
  pendingValue: string | undefined,
  hydratedValue: string | null,
) {
  if (pendingValue) return pendingValue;
  return hydratedValue;
}

export function resolveNewestHydratedStateValue(
  pendingValue: string | undefined,
  localStorageValue: string | null,
  indexedDbValue: string | null,
) {
  if (pendingValue) return pendingValue;
  if (!localStorageValue) return indexedDbValue;
  if (!indexedDbValue) return localStorageValue;

  return getPersistedLastUpdateTime(localStorageValue) >
    getPersistedLastUpdateTime(indexedDbValue)
    ? localStorageValue
    : indexedDbValue;
}
