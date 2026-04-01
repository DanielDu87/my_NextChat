import { StoreKey } from "../constant";

export const PERSIST_STORE_KEYS = [
  StoreKey.Chat,
  StoreKey.Plugin,
  StoreKey.Access,
  StoreKey.Config,
  StoreKey.ModelCache,
  StoreKey.Mask,
  StoreKey.Prompt,
  StoreKey.Update,
  StoreKey.SdList,
  StoreKey.Sync,
] as const satisfies readonly StoreKey[];

export type PersistStoreKey = (typeof PERSIST_STORE_KEYS)[number];
export type SyncStoreKey = Exclude<PersistStoreKey, StoreKey.Sync>;

export const SYNC_STORE_KEYS = PERSIST_STORE_KEYS.filter(
  (key) => key !== StoreKey.Sync,
) as SyncStoreKey[];

const SYNC_KEY_PRIORITIES: Partial<Record<StoreKey, number>> = {
  [StoreKey.Chat]: 0,
  [StoreKey.Config]: 1,
};

SYNC_STORE_KEYS.sort((a, b) => {
  const priorityA = SYNC_KEY_PRIORITIES[a] ?? Number.MAX_SAFE_INTEGER;
  const priorityB = SYNC_KEY_PRIORITIES[b] ?? Number.MAX_SAFE_INTEGER;

  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }

  return 0;
});

export const AUTO_SYNC_STORE_KEYS = SYNC_STORE_KEYS.filter(
  (key) => key !== StoreKey.Config && key !== StoreKey.ModelCache,
) as SyncStoreKey[];

export const MODEL_SYNC_STORE_KEYS = [
  StoreKey.Access,
  StoreKey.ModelCache,
] as const;

export function isPersistStoreKey(
  key: string,
): key is (typeof PERSIST_STORE_KEYS)[number] {
  return (PERSIST_STORE_KEYS as readonly string[]).includes(key);
}

export const STORE_PERSIST_VERSION: Record<
  (typeof PERSIST_STORE_KEYS)[number],
  number
> = {
  [StoreKey.Chat]: 3.7,
  [StoreKey.Plugin]: 1,
  [StoreKey.Access]: 4,
  [StoreKey.Config]: 4.4,
  [StoreKey.ModelCache]: 1,
  [StoreKey.Mask]: 3.1,
  [StoreKey.Prompt]: 3,
  [StoreKey.Update]: 1,
  [StoreKey.SdList]: 1,
  [StoreKey.Sync]: 1.5,
};

export function unwrapPersistedStoreState<T = unknown>(payload: unknown): T {
  if (
    payload &&
    typeof payload === "object" &&
    "state" in (payload as Record<string, unknown>)
  ) {
    return (payload as { state: T }).state;
  }

  return payload as T;
}

export function parseStoreStatePayload<T = unknown>(text: string): T {
  return unwrapPersistedStoreState<T>(JSON.parse(text));
}

export function stringifyPersistedStoreState(
  key: (typeof PERSIST_STORE_KEYS)[number],
  state: unknown,
) {
  return JSON.stringify(buildPersistedStoreState(key, state));
}

export function buildPersistedStoreState(
  key: (typeof PERSIST_STORE_KEYS)[number],
  state: unknown,
) {
  return {
    state,
    version: STORE_PERSIST_VERSION[key],
  };
}
