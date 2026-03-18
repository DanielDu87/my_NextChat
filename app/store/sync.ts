import { getClientConfig } from "../config/client";
import { STORAGE_KEY, StoreKey } from "../constant";
import { createPersistStore } from "../utils/store";
import {
  AppState,
  GetStoreState,
  getLocalAppState,
  mergeAppState,
  mergeStoreState,
  setLocalAppState,
} from "../utils/sync";
import { downloadAs, readFromFile } from "../utils";
import {
  AUTO_SYNC_STORE_KEYS,
  MODEL_SYNC_STORE_KEYS,
  parseStoreStatePayload,
  type SyncStoreKey,
  stringifyPersistedStoreState,
  SYNC_STORE_KEYS,
} from "../utils/sync-store-keys";
import {
  buildChatIndexPayload,
  buildChatStateFromIndex,
  createChatIndexEntryMap,
  createChatSessionMap,
  type ChatIndexSessionEntry,
} from "../utils/chat-sync";
import { showToast } from "../components/ui-lib";
import Locale from "../locales";
import { createSyncClient, ProviderType } from "../utils/cloud";
import { useAppConfig } from "./config";
import type { StoreSnapshotMeta } from "../utils/cloud/database";
import { createEmptySession } from "./chat";

export interface WebDavConfig {
  server: string;
  username: string;
  password: string;
}

type DatabaseCacheMeta = Record<
  string,
  {
    updatedAt: string;
    checksum: string;
    sizeBytes: number;
    validatedAt: number;
  }
>;

const isApp = !!getClientConfig()?.isApp;
export type SyncStore = GetStoreState<typeof useSyncStore>;
const LOG_SEPARATOR = "=".repeat(50);
let syncInFlight: Promise<void> | null = null;
const RETRYABLE_DB_SYNC_ERROR = /\[DB Sync\] (404|408|5\d{2})\b/;

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// 防抖同步相关
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_DELAY = 3000; // 3秒防抖
const SYNC_DEBOUNCE_KEY = "nextchat_sync_debounce";

type PendingDebounceSyncTask = {
  keys: SyncStoreKey[];
  scheduledAt: number;
};

const STORE_DISPLAY_NAMES: Record<SyncStoreKey, string> = {
  [StoreKey.Chat]: "会话",
  [StoreKey.Plugin]: "插件",
  [StoreKey.Access]: "设置",
  [StoreKey.Config]: "模型",
  [StoreKey.ModelCache]: "模型缓存",
  [StoreKey.Mask]: "面具",
  [StoreKey.Prompt]: "提示词",
  [StoreKey.Update]: "应用更新状态",
  [StoreKey.SdList]: "绘图",
};

function getStoreSummary(key: SyncStoreKey, state: any) {
  switch (key) {
    case StoreKey.Chat:
      return `${
        Array.isArray(state?.sessions) ? state.sessions.length : 0
      } 个会话`;
    case StoreKey.Plugin:
      return `${Object.keys(state?.plugins ?? {}).length} 个插件`;
    case StoreKey.Access:
      return `${
        Array.isArray(state?.apiProfiles) ? state.apiProfiles.length : 0
      } 个API配置`;
    case StoreKey.Config:
      return `${Array.isArray(state?.models) ? state.models.length : 0} 个模型`;
    case StoreKey.ModelCache:
      return `${Object.keys(state?.profiles ?? {}).length} 个平台缓存`;
    case StoreKey.Mask:
      return `${Object.keys(state?.masks ?? {}).length} 个面具`;
    case StoreKey.Prompt:
      return `${Object.keys(state?.prompts ?? {}).length} 个提示词`;
    case StoreKey.Update:
      return `${state?.lastUpdateTime ? 1 : 0} 条应用更新状态`;
    case StoreKey.SdList:
      return `${Array.isArray(state?.draw) ? state.draw.length : 0} 条绘图记录`;
    default:
      return "0 项";
  }
}

function isSyncStoreKey(key: unknown): key is SyncStoreKey {
  return SYNC_STORE_KEYS.includes(key as SyncStoreKey);
}

function normalizeSyncKeys(keys?: SyncStoreKey[]) {
  const normalized = (keys || [...SYNC_STORE_KEYS]).filter(isSyncStoreKey);
  return normalized.length > 0 ? normalized : [...SYNC_STORE_KEYS];
}

function readPendingDebounceTask(): PendingDebounceSyncTask | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = localStorage.getItem(SYNC_DEBOUNCE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PendingDebounceSyncTask>;
    if (
      !Array.isArray(parsed.keys) ||
      typeof parsed.scheduledAt !== "number" ||
      !Number.isFinite(parsed.scheduledAt)
    ) {
      localStorage.removeItem(SYNC_DEBOUNCE_KEY);
      return null;
    }

    return {
      keys: normalizeSyncKeys(parsed.keys as SyncStoreKey[]),
      scheduledAt: parsed.scheduledAt,
    };
  } catch {
    localStorage.removeItem(SYNC_DEBOUNCE_KEY);
    return null;
  }
}

function writePendingDebounceTask(task: PendingDebounceSyncTask) {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.setItem(SYNC_DEBOUNCE_KEY, JSON.stringify(task));
}

function clearPendingDebounceTask() {
  if (typeof window === "undefined") {
    return;
  }

  localStorage.removeItem(SYNC_DEBOUNCE_KEY);
}

function measureJsonBytes(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }

  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function shouldFetchRemoteChatSession(
  localEntry: ChatIndexSessionEntry | undefined,
  remoteEntry: ChatIndexSessionEntry,
) {
  if (!localEntry) {
    return true;
  }

  if (remoteEntry.lastUpdate > localEntry.lastUpdate) {
    return true;
  }

  return (
    remoteEntry.lastUpdate === localEntry.lastUpdate &&
    remoteEntry.messageCount !== localEntry.messageCount
  );
}

function shouldUploadChatSession(
  localEntry: ChatIndexSessionEntry,
  remoteEntry: ChatIndexSessionEntry | undefined,
) {
  if (!remoteEntry) {
    return true;
  }

  if (localEntry.lastUpdate > remoteEntry.lastUpdate) {
    return true;
  }

  return (
    localEntry.lastUpdate === remoteEntry.lastUpdate &&
    localEntry.messageCount !== remoteEntry.messageCount
  );
}

function getChatGlobalClearAt(state: unknown) {
  const value =
    isObjectLike(state) && "globalClearAt" in state ? state.globalClearAt : 0;
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 0;
}

function getChatSessionLastUpdate(session: unknown) {
  const value =
    isObjectLike(session) && "lastUpdate" in session ? session.lastUpdate : 0;
  const nextValue = Number(value);
  return Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 0;
}

function buildClearedChatState(state: any, clearAt: number) {
  const sessions = Array.isArray(state?.sessions) ? state.sessions : [];
  const keptSessions = sessions.filter(
    (session) => getChatSessionLastUpdate(session) > clearAt,
  );
  const currentSessionId = sessions[state?.currentSessionIndex ?? 0]?.id ?? "";
  const nextCurrentSessionIndex = currentSessionId
    ? keptSessions.findIndex((session) => session?.id === currentSessionId)
    : 0;

  return {
    ...state,
    sessions: keptSessions,
    currentSessionIndex:
      nextCurrentSessionIndex >= 0 ? nextCurrentSessionIndex : 0,
    globalClearAt: clearAt,
  };
}

async function withRetry<T>(
  task: () => Promise<T>,
  options?: {
    retryable?: (error: unknown) => boolean;
    retries?: number;
    onRetry?: (attempt: number, error: unknown) => void;
  },
) {
  const retries = options?.retries ?? 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task();
    } catch (error) {
      const canRetry =
        attempt < retries && (options?.retryable?.(error) ?? false);
      if (!canRetry) {
        throw error;
      }
      options?.onRetry?.(attempt + 1, error);
    }
  }

  throw new Error("[Sync] 未知重试状态");
}

const DEFAULT_SYNC_STATE = {
  provider: ProviderType.Database,
  useProxy: true,
  proxyUrl: "/api/webdav", // 旧同步代理路径，仅兼容历史配置

  database: {
    cacheMeta: {} as DatabaseCacheMeta,
    lastMetaSyncTime: 0,
  },

  webdav: {
    endpoint: "",
    username: "",
    password: "",
  },

  upstash: {
    endpoint: "",
    username: STORAGE_KEY,
    apiKey: "",
  },

  lastSyncTime: 0,
  lastProvider: "",
};

export const useSyncStore = createPersistStore(
  DEFAULT_SYNC_STATE,
  (set, get) => {
    async function syncChatStore(
      client: {
        getChatIndex?: () => Promise<any>;
        getChatSessions?: (ids: string[]) => Promise<Record<string, unknown>>;
        setChatDelta?: (params: {
          index: ReturnType<typeof buildChatIndexPayload>;
          upsertSessions: Array<Record<string, unknown>>;
          deleteSessionIds?: string[];
        }) => Promise<void>;
        set: (key: string, value: string) => Promise<void>;
      },
      localChatState: any,
    ) {
      const localSessions = Array.isArray(localChatState.sessions)
        ? localChatState.sessions
        : [];
      const remoteIndex = await client.getChatIndex?.();

      if (!remoteIndex) {
        const localIndex = buildChatIndexPayload(localChatState);
        const uploadBytes =
          measureJsonBytes(localIndex) + measureJsonBytes(localSessions);
        await client.setChatDelta?.({
          index: localIndex,
          upsertSessions: localSessions,
          deleteSessionIds: [],
        });

        return {
          remoteSummary: "远端 0 个会话",
          mergedStoreState: localChatState,
          mergedSummary: getStoreSummary(StoreKey.Chat, localChatState),
          status: "uploaded" as const,
          metrics: {
            downloadedSessionCount: 0,
            downloadedBytes: 0,
            uploadedSessionCount: localSessions.length,
            uploadedBytes: uploadBytes,
            deletedSessionCount: 0,
          },
        };
      }

      const localIndex = buildChatIndexPayload(localChatState);
      const localEntryMap = createChatIndexEntryMap(localIndex.sessions);
      const remoteEntryMap = createChatIndexEntryMap(
        remoteIndex.sessions || [],
      );
      const remoteSessionIdsToFetch = (remoteIndex.sessions || [])
        .filter((entry: ChatIndexSessionEntry) =>
          shouldFetchRemoteChatSession(localEntryMap.get(entry.id), entry),
        )
        .map((entry: ChatIndexSessionEntry) => entry.id);
      const remoteSessions = await client.getChatSessions?.(
        remoteSessionIdsToFetch,
      );
      const downloadedBytes =
        measureJsonBytes(
          (remoteIndex.sessions || []).filter((entry: ChatIndexSessionEntry) =>
            remoteSessionIdsToFetch.includes(entry.id),
          ),
        ) + measureJsonBytes(remoteSessions || {});
      const remotePartialState = buildChatStateFromIndex(
        remoteIndex,
        remoteSessions || {},
      );
      const localGlobalClearAt = getChatGlobalClearAt(localChatState);
      const remoteGlobalClearAt = getChatGlobalClearAt(remotePartialState);

      if (remoteGlobalClearAt > localGlobalClearAt) {
        const clearedLocalState = buildClearedChatState(
          localChatState,
          remoteGlobalClearAt,
        );
        const clearedRemoteState = buildClearedChatState(
          remotePartialState,
          remoteGlobalClearAt,
        );
        const mergedAfterClear = mergeStoreState(
          StoreKey.Chat,
          clearedLocalState,
          clearedRemoteState,
        );
        const mergedStoreState =
          Array.isArray(mergedAfterClear?.sessions) &&
          mergedAfterClear.sessions.length > 0
            ? mergedAfterClear
            : {
                ...mergedAfterClear,
                sessions: [createEmptySession()],
                currentSessionIndex: 0,
              };
        const mergedIndex = buildChatIndexPayload(mergedStoreState);
        const mergedSessionMap = createChatSessionMap(
          Array.isArray(mergedStoreState?.sessions)
            ? mergedStoreState.sessions
            : [],
        );
        const upsertSessions = mergedIndex.sessions
          .filter((entry) =>
            shouldUploadChatSession(entry, remoteEntryMap.get(entry.id)),
          )
          .map((entry) => mergedSessionMap.get(entry.id))
          .filter(Boolean) as Array<Record<string, unknown>>;
        const deleteSessionIds = [...remoteEntryMap.keys()].filter(
          (sessionId) => !mergedSessionMap.has(sessionId),
        );
        const uploadedBytes =
          measureJsonBytes(mergedIndex) + measureJsonBytes(upsertSessions);

        await client.setChatDelta?.({
          index: mergedIndex,
          upsertSessions,
          deleteSessionIds,
        });

        return {
          remoteSummary: getStoreSummary(StoreKey.Chat, {
            sessions: remoteIndex.sessions || [],
          }),
          mergedStoreState,
          mergedSummary: getStoreSummary(StoreKey.Chat, mergedStoreState),
          status: "merged" as const,
          metrics: {
            downloadedSessionCount: remoteSessionIdsToFetch.length,
            downloadedBytes,
            uploadedSessionCount: upsertSessions.length,
            uploadedBytes,
            deletedSessionCount: deleteSessionIds.length,
          },
        };
      }

      const mergedStoreState = mergeStoreState(
        StoreKey.Chat,
        localChatState,
        remotePartialState as any,
      );
      const mergedIndex = buildChatIndexPayload(mergedStoreState as any);
      const mergedSessionMap = createChatSessionMap(
        Array.isArray((mergedStoreState as any)?.sessions)
          ? (mergedStoreState as any).sessions
          : [],
      );
      const upsertSessions = mergedIndex.sessions
        .filter((entry) =>
          shouldUploadChatSession(entry, remoteEntryMap.get(entry.id)),
        )
        .map((entry) => mergedSessionMap.get(entry.id))
        .filter(Boolean) as Array<Record<string, unknown>>;
      const deleteSessionIds = [...remoteEntryMap.keys()].filter(
        (sessionId) => !mergedSessionMap.has(sessionId),
      );
      const uploadedBytes =
        measureJsonBytes(mergedIndex) + measureJsonBytes(upsertSessions);

      await client.setChatDelta?.({
        index: mergedIndex,
        upsertSessions,
        deleteSessionIds,
      });

      return {
        remoteSummary: getStoreSummary(StoreKey.Chat, {
          sessions: remoteIndex.sessions || [],
        }),
        mergedStoreState,
        mergedSummary: getStoreSummary(StoreKey.Chat, mergedStoreState),
        status: "merged" as const,
        metrics: {
          downloadedSessionCount: remoteSessionIdsToFetch.length,
          downloadedBytes,
          uploadedSessionCount: upsertSessions.length,
          uploadedBytes,
          deletedSessionCount: deleteSessionIds.length,
        },
      };
    }

    return {
      cloudSync() {
        const config = get()[get().provider];
        return Object.values(config).every((c) => c.toString().length > 0);
      },

      markSyncTime() {
        set({ lastSyncTime: Date.now(), lastProvider: get().provider });
      },

      export() {
        const state = getLocalAppState();
        const datePart = isApp
          ? `${new Date().toLocaleDateString().replace(/\//g, "_")} ${new Date()
              .toLocaleTimeString()
              .replace(/:/g, "_")}`
          : new Date().toLocaleString();

        const fileName = `Backup-${datePart}.json`;
        downloadAs(JSON.stringify(state), fileName);
      },

      async import() {
        try {
          const rawContent = await readFromFile();
          const parsedState = JSON.parse(rawContent) as unknown;
          if (!isObjectLike(parsedState)) {
            throw new Error("[Import] 备份文件格式无效");
          }

          const remoteState = parsedState as AppState;
          const localState = getLocalAppState();
          mergeAppState(localState, remoteState);
          setLocalAppState(localState);
          location.reload();
        } catch (e) {
          if (
            e instanceof Error &&
            e.message.includes("[File] 用户取消选择文件")
          ) {
            console.log("[Import] 用户取消选择备份文件");
            return;
          }
          console.error("[Import]", e);
          showToast(Locale.Settings.Sync.ImportFailed);
        }
      },

      getClient() {
        const provider = get().provider;
        const client = createSyncClient(provider, get());
        return client;
      },

      triggerDebounceSync(storeKeys?: SyncStoreKey[]) {
        const keysToSync = normalizeSyncKeys(storeKeys);

        // 清除之前的定时器
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        const executeSync = async () => {
          clearPendingDebounceTask();

          // 检查是否已配置同步
          if (!this.cloudSync()) {
            console.log("[Sync] 🔕 同步未配置，跳过防抖同步");
            return;
          }

          console.log("[Sync] 🚀 防抖同步触发", {
            keys: keysToSync.map((k) => STORE_DISPLAY_NAMES[k]).join(", "),
          });

          try {
            await this.sync(keysToSync);
          } catch (error) {
            console.error("[Sync] ❌ 防抖同步失败:", error);
            writePendingDebounceTask({
              keys: keysToSync,
              scheduledAt: Date.now(),
            });
          }
        };

        // 设置新的防抖定时器
        debounceTimer = setTimeout(executeSync, DEBOUNCE_DELAY);

        writePendingDebounceTask({
          keys: keysToSync,
          scheduledAt: Date.now() + DEBOUNCE_DELAY,
        });
      },

      async resumePendingDebounceSync() {
        const pendingTask = readPendingDebounceTask();
        if (!pendingTask) {
          return false;
        }

        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }

        console.log("[Sync] ♻️ 恢复未完成的防抖同步", {
          keys: pendingTask.keys.map((k) => STORE_DISPLAY_NAMES[k]).join(", "),
        });

        clearPendingDebounceTask();

        try {
          await this.sync(pendingTask.keys);
          return true;
        } catch (error) {
          console.error("[Sync] ❌ 恢复防抖同步失败:", error);
          writePendingDebounceTask({
            keys: pendingTask.keys,
            scheduledAt: Date.now(),
          });
          throw error;
        }
      },

      updateDatabaseMeta(metas: StoreSnapshotMeta[]) {
        const nextMeta = { ...get().database.cacheMeta };
        const validatedAt = Date.now();

        metas.forEach((meta) => {
          nextMeta[meta.key] = {
            updatedAt: meta.updatedAt,
            checksum: meta.checksum,
            sizeBytes: meta.sizeBytes,
            validatedAt,
          };
        });

        set({
          database: {
            ...get().database,
            cacheMeta: nextMeta,
            lastMetaSyncTime: validatedAt,
          },
        });
      },

      async sync(storeKeys: SyncStoreKey[] = [...SYNC_STORE_KEYS]) {
        if (syncInFlight) {
          console.log("[Sync] ⏳ 已有同步进行中，等待当前任务完成...");
          await syncInFlight;
        }

        syncInFlight = (async () => {
          console.log("[Sync] 🔄 开始同步...");

          const client = this.getClient() as any;

          console.log(`[Sync] 📋 准备同步 ${storeKeys.length} 个数据块`);

          const appConfig = useAppConfig.getState() as any;
          const localSidebarWidth = localStorage.getItem("sidebarWidth");
          const localTightBorder = appConfig.tightBorder;

          try {
            const syncResults: Array<{
              key: SyncStoreKey;
              name: string;
              summary: string;
              status: "downloaded" | "uploaded" | "merged";
            }> = [];
            const failedKeys: Array<{
              key: SyncStoreKey;
              name: string;
              error: unknown;
            }> = [];

            for (const [index, key] of storeKeys.entries()) {
              try {
                const displayName = STORE_DISPLAY_NAMES[key];
                const stepLabel = `${index + 1}/${storeKeys.length}`;
                console.log(
                  `[Sync] 📋 [${stepLabel}] 正在同步${displayName}...`,
                );
                const localState = getLocalAppState();
                const localStoreState = localState[key];

                if (
                  key === StoreKey.Chat &&
                  typeof client.getChatIndex === "function" &&
                  typeof client.getChatSessions === "function" &&
                  typeof client.setChatDelta === "function"
                ) {
                  const chatResult = await syncChatStore(
                    client,
                    localStoreState,
                  );
                  console.log(
                    `[Sync] ✅ [${stepLabel}] ${displayName}读取完成，${chatResult.remoteSummary}`,
                  );
                  syncResults.push({
                    key,
                    name: displayName,
                    summary: chatResult.mergedSummary,
                    status: chatResult.status,
                  });

                  console.log(
                    `[Sync] 📦 [${stepLabel}] ${displayName}分片统计:`,
                    {
                      下载会话数: chatResult.metrics.downloadedSessionCount,
                      下载体积: formatBytes(chatResult.metrics.downloadedBytes),
                      上传会话数: chatResult.metrics.uploadedSessionCount,
                      上传体积: formatBytes(chatResult.metrics.uploadedBytes),
                      删除会话数: chatResult.metrics.deletedSessionCount,
                    },
                  );

                  setLocalAppState({
                    ...localState,
                    [key]: chatResult.mergedStoreState,
                  } as AppState);

                  console.log(
                    `[Sync] ✅ [${stepLabel}] ${displayName}同步完成，合并后 ${chatResult.mergedSummary}`,
                  );
                  console.log(LOG_SEPARATOR);
                  continue;
                }

                const remoteDataText = await withRetry<string>(
                  () => client.get(key),
                  {
                    retries: 1,
                    retryable: (error) =>
                      error instanceof Error &&
                      RETRYABLE_DB_SYNC_ERROR.test(error.message),
                    onRetry: (attempt, error) => {
                      console.warn(
                        `[Sync] ⚠️ [${stepLabel}] ${displayName}读取失败，准备第 ${attempt} 次重试:`,
                        error,
                      );
                    },
                  },
                );

                if (!remoteDataText || remoteDataText === "") {
                  await client.set(
                    key,
                    stringifyPersistedStoreState(key, localStoreState),
                  );
                  const summary = getStoreSummary(key, localStoreState);
                  syncResults.push({
                    key,
                    name: displayName,
                    summary,
                    status: "uploaded",
                  });
                  console.log(
                    `[Sync] ✅ [${stepLabel}] ${displayName}同步完成，已上传 ${summary}`,
                  );
                  console.log(LOG_SEPARATOR);
                } else {
                  const parsedRemoteState =
                    parseStoreStatePayload(remoteDataText);
                  const summary = getStoreSummary(key, parsedRemoteState);
                  console.log(
                    `[Sync] ✅ [${stepLabel}] ${displayName}读取完成，远端 ${summary}`,
                  );
                  syncResults.push({
                    key,
                    name: displayName,
                    summary,
                    status: "downloaded",
                  });

                  const nextLocalState = getLocalAppState();
                  const mergedStoreState = mergeStoreState(
                    key,
                    nextLocalState[key],
                    parsedRemoteState,
                  );

                  setLocalAppState({
                    ...nextLocalState,
                    [key]: mergedStoreState,
                  } as AppState);

                  await client.set(
                    key,
                    stringifyPersistedStoreState(key, mergedStoreState),
                  );

                  const mergedSummary = getStoreSummary(key, mergedStoreState);
                  const result = syncResults.find((item) => item.key === key);
                  if (result) {
                    result.summary = mergedSummary;
                    result.status = "merged";
                  }
                  console.log(
                    `[Sync] ✅ [${stepLabel}] ${displayName}同步完成，合并后 ${mergedSummary}`,
                  );
                  console.log(LOG_SEPARATOR);
                }
              } catch (e) {
                failedKeys.push({
                  key,
                  name: STORE_DISPLAY_NAMES[key],
                  error: e,
                });
                console.error(
                  `[Sync] ❌ [${index + 1}/${storeKeys.length}] ${
                    STORE_DISPLAY_NAMES[key]
                  }同步失败:`,
                  e,
                );
                console.log(LOG_SEPARATOR);
              }
            }

            if (localSidebarWidth && appConfig.setSidebarWidth) {
              appConfig.setSidebarWidth(parseInt(localSidebarWidth));
            }
            if (localTightBorder !== undefined) {
              useAppConfig.setState({ tightBorder: localTightBorder });
            }

            console.log("[Sync] 📊 数据同步汇总");
            syncResults.forEach((item) => {
              console.log(`[Sync] - ${item.name}: ${item.summary}`);
            });

            if (failedKeys.length > 0) {
              const failedSummary = failedKeys
                .map(
                  (item) =>
                    `${item.name}: ${
                      item.error instanceof Error
                        ? item.error.message
                        : String(item.error)
                    }`,
                )
                .join(" | ");
              console.error(`[Sync] ❌ 本次同步存在失败项: ${failedSummary}`);
              console.log(LOG_SEPARATOR);
              throw new Error(`[Sync] 部分数据同步失败: ${failedSummary}`);
            }

            console.log("[Sync] ✅ 同步完成");
            console.log(LOG_SEPARATOR);
          } catch (e) {
            console.error("[Sync] ❌ 同步失败:", e);
            console.log(LOG_SEPARATOR);
            throw e;
          }

          this.markSyncTime();
        })();

        try {
          await syncInFlight;
        } finally {
          syncInFlight = null;
        }
      },

      async autoSync() {
        await this.sync([StoreKey.Chat]);

        const remainingKeys = AUTO_SYNC_STORE_KEYS.filter(
          (key) => key !== StoreKey.Chat,
        );
        if (remainingKeys.length > 0) {
          await this.sync(remainingKeys);
        }
      },

      async syncModels() {
        return this.sync([...MODEL_SYNC_STORE_KEYS]);
      },

      async check() {
        const client = this.getClient();
        return await client.check();
      },
    };
  },
  {
    name: StoreKey.Sync,
    version: 1.4,

    migrate(persistedState, version) {
      const newState = persistedState as typeof DEFAULT_SYNC_STATE;

      if (version < 1.1) {
        newState.upstash.username = STORAGE_KEY;
      }

      if (version < 1.2) {
        if (
          (persistedState as typeof DEFAULT_SYNC_STATE).proxyUrl ===
          "/api/cors/"
        ) {
          newState.proxyUrl = "";
        }
      }

      if (version < 1.3) {
        newState.provider = ProviderType.Database;
      }

      if (version < 1.4) {
        newState.database = {
          cacheMeta: {},
          lastMetaSyncTime: 0,
        };
      }

      return newState as any;
    },
  },
);
