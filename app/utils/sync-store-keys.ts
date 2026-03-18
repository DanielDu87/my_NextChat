import { StoreKey } from "../constant";

export const PERSIST_STORE_KEYS = [
  StoreKey.Chat,
  StoreKey.Plugin,
  StoreKey.Access,
  StoreKey.Config,
  StoreKey.Mask,
  StoreKey.Prompt,
  StoreKey.Update,
  StoreKey.SdList,
  StoreKey.Sync,
] as const satisfies readonly StoreKey[];

export const SYNC_STORE_KEYS = PERSIST_STORE_KEYS.filter(
  (key) => key !== StoreKey.Sync,
) as StoreKey[];

export function isPersistStoreKey(
  key: string,
): key is (typeof PERSIST_STORE_KEYS)[number] {
  return (PERSIST_STORE_KEYS as readonly string[]).includes(key);
}

export const STORE_PERSIST_VERSION: Record<
  (typeof PERSIST_STORE_KEYS)[number],
  number
> = {
  [StoreKey.Chat]: 3.3,
  [StoreKey.Plugin]: 1,
  [StoreKey.Access]: 4,
  [StoreKey.Config]: 4.1,
  [StoreKey.Mask]: 3.1,
  [StoreKey.Prompt]: 3,
  [StoreKey.Update]: 1,
  [StoreKey.SdList]: 1,
  [StoreKey.Sync]: 1.3,
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
