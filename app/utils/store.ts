import { create } from "zustand";
import { combine, persist, createJSONStorage } from "zustand/middleware";
import { Updater } from "../typing";
import { deepClone } from "./clone";
import { indexedDbStateStorage } from "@/app/utils/indexeddb-state-storage";
import { StoreKey } from "../constant";
import type { SyncStoreKey } from "./sync-store-keys";
import { useAuthStore } from "../store/auth";
import { logger } from "./logger";
import { normalizeSidebarPathname } from "./sidebar-route-state";

type SecondParam<T> = T extends (
  _f: infer _F,
  _s: infer S,
  ...args: infer _U
) => any
  ? S
  : never;

type MakeUpdater<T> = {
  lastUpdateTime: number;
  _hasHydrated: boolean;

  markUpdate: () => void;
  update: Updater<T>;
  setHasHydrated: (state: boolean) => void;
};

type SetStoreState<T> = (
  partial: T | Partial<T> | ((state: T) => T | Partial<T>),
  replace?: boolean | undefined,
) => void;

const IMMEDIATE_SYNC_STORE_KEYS = new Set<SyncStoreKey>([
  StoreKey.Access,
  StoreKey.Config,
  StoreKey.DrawList,
  StoreKey.Plugin,
]);

let immediateStoreSyncPauseCount = 0;

// 同步队列，避免并发同步导致 409 冲突
let syncQueue: Array<() => Promise<void>> = [];
let isSyncQueueProcessing = false;
let syncQueueIdleResolvers: Array<() => void> = [];

function shouldDeferApiConfigImmediateSync(storeKey?: SyncStoreKey) {
  if (
    typeof window === "undefined" ||
    (storeKey !== StoreKey.Access && storeKey !== StoreKey.Config)
  ) {
    return false;
  }

  const hashPath = window.location.hash.replace(/^#/, "").split("?")[0];
  const currentPath = normalizeSidebarPathname(
    hashPath || window.location.pathname,
  );
  return (
    currentPath === "/api-config" ||
    currentPath === "/api_config" ||
    currentPath === "/api-config/backups" ||
    currentPath === "/backup/api_config"
  );
}

function resolveSyncQueueIdle() {
  if (isSyncQueueProcessing || syncQueue.length > 0) {
    return;
  }

  const resolvers = syncQueueIdleResolvers;
  syncQueueIdleResolvers = [];
  resolvers.forEach((resolve) => resolve());
}

async function processSyncQueue() {
  if (isSyncQueueProcessing || syncQueue.length === 0) {
    resolveSyncQueueIdle();
    return;
  }

  isSyncQueueProcessing = true;
  while (syncQueue.length > 0) {
    const task = syncQueue.shift();
    if (task) {
      try {
        await task();
      } catch (error) {
        logger.store.error("❌ 同步队列任务失败:", error);
      }
    }
  }

  isSyncQueueProcessing = false;
  resolveSyncQueueIdle();
}

export async function runWithImmediateStoreSyncPaused<T>(
  task: () => Promise<T> | T,
): Promise<T> {
  immediateStoreSyncPauseCount += 1;
  try {
    return await task();
  } finally {
    immediateStoreSyncPauseCount = Math.max(
      0,
      immediateStoreSyncPauseCount - 1,
    );
  }
}

export function runWithImmediateStoreSyncPausedSync<T>(task: () => T): T {
  immediateStoreSyncPauseCount += 1;
  try {
    return task();
  } finally {
    immediateStoreSyncPauseCount = Math.max(
      0,
      immediateStoreSyncPauseCount - 1,
    );
  }
}

export async function waitForImmediateStoreSyncQueueIdle() {
  if (!isSyncQueueProcessing && syncQueue.length === 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    syncQueueIdleResolvers.push(resolve);
  });
}

function triggerImmediateStoreSync(storeName?: string) {
  const syncStoreKey = storeName as SyncStoreKey | undefined;
  if (
    typeof window === "undefined" ||
    immediateStoreSyncPauseCount > 0 ||
    useAuthStore.getState().readOnly ||
    !syncStoreKey ||
    shouldDeferApiConfigImmediateSync(syncStoreKey) ||
    !IMMEDIATE_SYNC_STORE_KEYS.has(syncStoreKey)
  ) {
    return;
  }

  // 将同步任务加入队列，而不是立即执行
  const syncTask = () =>
    import("../store/sync")
      .then(({ useSyncStore }) => {
        return useSyncStore
          .getState()
          .sync([syncStoreKey])
          .then(() => undefined);
      })
      .catch((error) => {
        logger.store.error(`❌ ${storeName} 立即同步失败:`, error);
      });

  syncQueue.push(syncTask);

  // 异步处理队列
  Promise.resolve().then(() => processSyncQueue());
}

export function createPersistStore<T extends object, M>(
  state: T,
  methods: (
    set: SetStoreState<T & MakeUpdater<T>>,
    get: () => T & MakeUpdater<T>,
  ) => M,
  persistOptions: SecondParam<typeof persist<T & M & MakeUpdater<T>>>,
) {
  persistOptions.storage =
    persistOptions.storage ?? createJSONStorage(() => indexedDbStateStorage);
  const storeName = String((persistOptions as { name?: string })?.name || "");
  const oldOonRehydrateStorage = persistOptions?.onRehydrateStorage;
  persistOptions.onRehydrateStorage = (state) => {
    const postRehydrate = oldOonRehydrateStorage?.(state) as
      | ((...args: any[]) => void)
      | undefined;
    return (...args: unknown[]) => {
      postRehydrate?.(...(args as any[]));
      state.setHasHydrated(true);
    };
  };

  return create(
    persist(
      combine(
        {
          ...state,
          lastUpdateTime: 0,
          _hasHydrated: false,
        },
        (set, get) => {
          return {
            ...methods(set, get as any),

            markUpdate() {
              set({ lastUpdateTime: Date.now() } as Partial<
                T & M & MakeUpdater<T>
              >);
              triggerImmediateStoreSync(storeName);
            },
            update(updater) {
              const state = deepClone(get());
              updater(state);
              set({
                ...state,
                lastUpdateTime: Date.now(),
              });
              triggerImmediateStoreSync(storeName);
            },
            setHasHydrated: (state: boolean) => {
              set({ _hasHydrated: state } as Partial<T & M & MakeUpdater<T>>);
            },
          } as M & MakeUpdater<T>;
        },
      ),
      persistOptions as any,
    ),
  );
}
