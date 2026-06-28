import { StoreKey } from "../constant";

export const PERSIST_STORE_KEYS = [
  StoreKey.Chat,
  StoreKey.Plugin,
  StoreKey.Access,
  StoreKey.Config,
  StoreKey.ModelCache,
  StoreKey.Prompt,
  StoreKey.Update,
  StoreKey.DrawList,
  StoreKey.Sync,
] as const satisfies readonly StoreKey[];

export type PersistStoreKey = (typeof PERSIST_STORE_KEYS)[number];
export type SyncStoreKey = Exclude<
  PersistStoreKey,
  StoreKey.Sync | StoreKey.ModelCache
>;

export const SYNC_STORE_KEYS = PERSIST_STORE_KEYS.filter(
  (key) => key !== StoreKey.Sync && key !== StoreKey.ModelCache,
) as SyncStoreKey[];

const SYNC_KEY_PRIORITIES: Partial<Record<StoreKey, number>> = {
  [StoreKey.Access]: 0,
  [StoreKey.Config]: 1,
  [StoreKey.DrawList]: 2,
  [StoreKey.Chat]: 3,
};

SYNC_STORE_KEYS.sort((a, b) => {
  const priorityA = SYNC_KEY_PRIORITIES[a] ?? Number.MAX_SAFE_INTEGER;
  const priorityB = SYNC_KEY_PRIORITIES[b] ?? Number.MAX_SAFE_INTEGER;

  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }

  return 0;
});

export const AUTO_SYNC_STORE_KEYS = [...SYNC_STORE_KEYS] as SyncStoreKey[];

export const MODEL_SYNC_STORE_KEYS = [StoreKey.Config] as const;

export type AutoSyncScope = "app" | "home" | "chat" | "draw";

export const CHAT_AUTO_SYNC_CRITICAL_STORE_KEYS = [
  StoreKey.Access,
  StoreKey.Config,
] as const satisfies readonly SyncStoreKey[];

export const DRAW_AUTO_SYNC_CRITICAL_STORE_KEYS = [
  StoreKey.Access,
  StoreKey.DrawList,
] as const satisfies readonly SyncStoreKey[];

export const DRAW_AUTO_SYNC_DEFERRED_STORE_KEYS =
  [] as const satisfies readonly SyncStoreKey[];

export const HOME_AUTO_SYNC_DEFERRED_STORE_KEYS = [
  StoreKey.Plugin,
  StoreKey.Prompt,
  StoreKey.Update,
] as const satisfies readonly SyncStoreKey[];

export function getAutoSyncCriticalStoreKeys(scope: AutoSyncScope) {
  switch (scope) {
    case "home":
    case "chat":
      return [...CHAT_AUTO_SYNC_CRITICAL_STORE_KEYS] as SyncStoreKey[];
    case "draw":
      return [...DRAW_AUTO_SYNC_CRITICAL_STORE_KEYS] as SyncStoreKey[];
    case "app":
    default:
      return [StoreKey.Access, StoreKey.Config] as SyncStoreKey[];
  }
}

export function getAutoSyncDeferredStoreKeys(
  scope: AutoSyncScope,
  options?: { includeChat?: boolean },
) {
  switch (scope) {
    case "home":
      return [...HOME_AUTO_SYNC_DEFERRED_STORE_KEYS] as SyncStoreKey[];
    case "chat":
      return AUTO_SYNC_STORE_KEYS.filter(
        (key) =>
          key !== StoreKey.Access &&
          key !== StoreKey.Config &&
          (options?.includeChat !== false || key !== StoreKey.Chat),
      ) as SyncStoreKey[];
    case "draw":
      return [...DRAW_AUTO_SYNC_DEFERRED_STORE_KEYS] as SyncStoreKey[];
    case "app":
    default:
      return AUTO_SYNC_STORE_KEYS.filter(
        (key) =>
          key !== StoreKey.Access &&
          key !== StoreKey.Config &&
          (options?.includeChat !== false || key !== StoreKey.Chat),
      ) as SyncStoreKey[];
  }
}

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
  [StoreKey.Plugin]: 6,
  [StoreKey.Access]: 4,
  [StoreKey.Config]: 4.5,
  [StoreKey.ModelCache]: 1,
  [StoreKey.Prompt]: 3,
  [StoreKey.Update]: 1,
  [StoreKey.DrawList]: 2,
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
