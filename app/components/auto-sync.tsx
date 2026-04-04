"use client";

import { useEffect } from "react";
import {
  buildProviderDiffSummaries,
  countCloudMergedModels,
  describeModelCountDiff,
  getCloudMergedPlatformCounts,
} from "../utils/auto-sync-model-diff";
import { StoreKey } from "../constant";
import { useAppConfig } from "../store/config";
import { useAccessStore } from "../store/access";
import { useModelCacheStore } from "../store/model-cache";
import { useChatStore } from "../store/chat";
import { useSyncStore } from "../store/sync";
import { showToast } from "./ui-lib";
import { withSyncUserHeaders } from "../utils/sync-user-client";
import { waitForImmediateStoreSyncQueueIdle } from "../utils/store";
import {
  getNonFunctionFileds,
  hasMeaningfulAccessState,
  hasMeaningfulConfigState,
  hasMeaningfulModelCacheState,
} from "../utils/sync";
import { rebuildManagedModelsFromCache } from "../utils/managed-model-rebuild";
import {
  buildChatIndexPayload,
  getSyncableChatSessions,
} from "../utils/chat-sync";
import { isEffectivelyEmptyRemoteChatState } from "../utils/chat-sync-state";
import {
  AUTO_SYNC_CHANNEL_NAME,
  AUTO_SYNC_LOCK_KEY,
  AUTO_SYNC_LOCK_TTL_MS,
  buildAutoSyncLock,
  parseAutoSyncLock,
  shouldAutoSyncLockBeTakenOver,
} from "../utils/sync-tab-coordination";

let autoSyncEffectActive = false;
const AUTO_SYNC_TAB_ID_KEY = "nextchat_auto_sync_tab_id";

function logCriticalModelSyncBanner(
  phase: "start" | "complete",
  detail?: string,
) {
  const title = phase === "start" ? "🔄 模型同步开始" : "✅ 模型同步完成";
  console.info(`===== ${title} =====`);
  if (detail) {
    console.info(`[AutoSync] ${detail}`);
  }
  console.info("=====");
}

function scheduleIdleTask(task: () => void, timeout = 800) {
  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    (
      window as typeof window & {
        requestIdleCallback: (
          callback: () => void,
          options?: { timeout?: number },
        ) => number;
      }
    ).requestIdleCallback(task, { timeout });
    return;
  }

  setTimeout(task, 0);
}

function hasMeaningfulLocalChatState(state: Record<string, any>) {
  const sessions = getSyncableChatSessions(state?.sessions || []);
  if (sessions.length === 0) {
    return false;
  }

  return sessions.some(
    (session) =>
      (Array.isArray(session?.messages) && session.messages.length > 0) ||
      sessions.length > 1,
  );
}

export default function AutoSync() {
  const ensureRemoteBootstrapState = async () => {
    const syncStore = useSyncStore.getState();
    const client = syncStore.getClient() as any;
    if (typeof client.getMeta !== "function") {
      return false;
    }

    const metas = await client.getMeta([
      StoreKey.Config,
      StoreKey.Access,
      StoreKey.ModelCache,
      StoreKey.Chat,
    ]);
    const remoteMetaKeys = new Set(
      (metas || []).map((meta: { key: string }) => meta.key),
    );
    const missingStoreKeys = [
      StoreKey.Config,
      StoreKey.Access,
      StoreKey.ModelCache,
    ].filter((key) => !remoteMetaKeys.has(key));

    const localConfig = useAppConfig.getState() as Record<string, any>;
    const localAccess = useAccessStore.getState() as Record<string, any>;
    const localModelCache = useModelCacheStore.getState() as Record<
      string,
      any
    >;
    const hasStoreBootstrapData =
      hasMeaningfulConfigState(localConfig) ||
      hasMeaningfulAccessState(localAccess) ||
      hasMeaningfulModelCacheState(localModelCache);

    if (missingStoreKeys.length > 0 && !hasStoreBootstrapData) {
      console.log(
        `[AutoSync] ℹ️ 云端缺少初始化配置(${missingStoreKeys.join(
          ", ",
        )})，但本地也暂无可上传数据，跳过初始化上传`,
      );
    } else if (missingStoreKeys.length > 0) {
      console.log(
        `[AutoSync] ☁️ 检测到云端缺少初始化配置(${missingStoreKeys.join(
          ", ",
        )})，开始上传本地配置`,
      );
      await syncStore.sync([
        StoreKey.Config,
        StoreKey.Access,
        StoreKey.ModelCache,
      ]);
      showToast(
        `检测到云端缺少初始化配置，已自动上传本地数据：${missingStoreKeys.join(
          ", ",
        )}`,
      );
    }

    const localChatState = getNonFunctionFileds(
      useChatStore.getState(),
    ) as Record<string, any>;
    const localChatSessions = getSyncableChatSessions(
      localChatState.sessions || [],
    );
    const localChatIndex = buildChatIndexPayload(localChatState as any);
    const remoteChatIndex =
      typeof client.getChatIndex === "function"
        ? await client.getChatIndex()
        : null;
    const remoteChatSessions = Array.isArray(remoteChatIndex?.sessions)
      ? remoteChatIndex.sessions
      : [];
    const remoteChatLooksEmpty =
      !remoteChatIndex ||
      (remoteChatSessions.length === 0 &&
        isEffectivelyEmptyRemoteChatState(remoteChatIndex?.state)) ||
      (remoteChatSessions.every(
        (session: { messageCount?: number }) =>
          Number(session?.messageCount || 0) <= 0,
      ) &&
        isEffectivelyEmptyRemoteChatState(remoteChatIndex?.state));

    if (
      remoteChatLooksEmpty &&
      hasMeaningfulLocalChatState(localChatState) &&
      typeof client.setChatDelta === "function"
    ) {
      const localSessionIds = new Set(
        (localChatIndex.state.sessionIds as string[]) || [],
      );
      const deleteSessionIds = remoteChatSessions
        .map((session: { id?: string }) => String(session?.id || ""))
        .filter(Boolean)
        .filter((id: string) => !localSessionIds.has(id));

      console.log("[AutoSync] ☁️ 检测到云端缺少聊天数据，开始上传本地会话");
      await client.setChatDelta({
        index: localChatIndex,
        upsertSessions: localChatSessions as Array<Record<string, unknown>>,
        deleteSessionIds,
      });
      showToast("检测到云端缺少聊天数据，已自动上传本地会话");
      return true;
    }

    return missingStoreKeys.length > 0;
  };

  const logModelCount = (remoteCount?: number, remoteProviders?: any[]) => {
    const currentProfiles = useAccessStore.getState().apiProfiles || [];
    const currentModels = useAppConfig.getState().models || [];
    const localTotalCount = countCloudMergedModels(
      currentModels,
      currentProfiles,
    );
    const localPlatformCounts = getCloudMergedPlatformCounts(
      currentModels,
      currentProfiles,
    );

    console.log("[AutoSync] 📊 模型数据汇总:");
    console.log("[AutoSync] 📍 本地数据:");
    console.log(`[AutoSync] - 本地模型总数: ${localTotalCount} 个`);
    console.log("[AutoSync] 📋 本地各平台模型数量:");
    localPlatformCounts.forEach(({ name, count }) => {
      console.log(`[AutoSync] - ${name}: ${count} 个模型`);
    });

    console.log("[AutoSync] ☁️ 云端数据:");
    if (remoteCount !== undefined) {
      console.log(`[AutoSync] - 云端模型总数: ${remoteCount} 个`);
      if (remoteProviders && remoteProviders.length > 0) {
        console.log("[AutoSync] 📋 云端各平台模型数量:");
        remoteProviders.forEach((provider: any) => {
          console.log(
            `[AutoSync] - ${provider.profileName}: ${provider.fetchedCount} 个模型`,
          );
        });
      } else {
        console.log("[AutoSync] - 云端无平台数据");
      }

      console.log("[AutoSync] 🔍 比较结果:");
      console.log(
        `[AutoSync] - 状态: ${
          localTotalCount === remoteCount ? "✅ 一致" : "❌ 不一致，提示更新"
        }`,
      );
      console.log(
        `[AutoSync] - 差异: ${describeModelCountDiff(
          localTotalCount,
          remoteCount,
        )}`,
      );

      const providerDiffs = buildProviderDiffSummaries(
        localPlatformCounts,
        remoteProviders || [],
      );
      if (providerDiffs.length > 0) {
        console.log("[AutoSync] 📋 平台差异明细:");
        providerDiffs.forEach((item) => {
          console.log(
            `[AutoSync] - ${item.name}: 本地 ${item.localCount} / 云端 ${item.remoteCount}，${item.description}`,
          );
        });
      }
    } else {
      console.log("[AutoSync] - 云端模型总数: 无数据（已清空）");
      console.log("[AutoSync] 🔍 比较结果:");
      console.log("[AutoSync] - 状态: ℹ️ 云端数据已清空，建议同步更新云端数据");
    }
  };

  const logModelCountWithRemote = async () => {
    try {
      const res = await fetch("/api/db/models/latest", {
        cache: "no-store",
        headers: withSyncUserHeaders(),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.ok && data.latest) {
          const remote = data.latest;
          logModelCount(remote.modelCount, remote.providers);
          return;
        }
      }
      logModelCount();
    } catch (e) {
      console.error("[AutoSync] ❌ 获取云端数据失败:", e);
      logModelCount();
    }
  };

  useEffect(() => {
    if (autoSyncEffectActive) {
      console.log("[AutoSync] ⏭️ 已存在自动同步实例，跳过重复挂载");
      return;
    }
    autoSyncEffectActive = true;

    const sessionStorage =
      typeof window !== "undefined" ? window.sessionStorage : null;
    const getOrCreateTabId = () => {
      const existing = String(
        sessionStorage?.getItem(AUTO_SYNC_TAB_ID_KEY) || "",
      ).trim();
      if (existing) {
        return existing;
      }

      const nextId =
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage?.setItem(AUTO_SYNC_TAB_ID_KEY, nextId);
      return nextId;
    };
    const tabId = getOrCreateTabId();
    const localStorage =
      typeof window !== "undefined" ? window.localStorage : null;
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel(AUTO_SYNC_CHANNEL_NAME)
        : null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let hasCompletedAutoSync = false;
    let autoSyncInProgress = false;
    let hasRestoredModelsFromHydratedCache = false;

    const writeLock = () => {
      if (!localStorage) {
        return false;
      }

      const lock = buildAutoSyncLock(tabId);
      localStorage.setItem(AUTO_SYNC_LOCK_KEY, JSON.stringify(lock));
      const confirmedLock = parseAutoSyncLock(
        localStorage.getItem(AUTO_SYNC_LOCK_KEY),
      );

      return confirmedLock?.owner === tabId;
    };

    const acquireLock = () => {
      if (!localStorage) {
        return true;
      }

      const now = Date.now();
      const currentLock = parseAutoSyncLock(
        localStorage.getItem(AUTO_SYNC_LOCK_KEY),
      );
      if (!shouldAutoSyncLockBeTakenOver(currentLock, tabId, now)) {
        return false;
      }

      return writeLock();
    };

    const refreshLock = () => {
      if (!localStorage) {
        return;
      }

      const currentLock = parseAutoSyncLock(
        localStorage.getItem(AUTO_SYNC_LOCK_KEY),
      );
      if (currentLock?.owner !== tabId) {
        return;
      }

      localStorage.setItem(
        AUTO_SYNC_LOCK_KEY,
        JSON.stringify(buildAutoSyncLock(tabId)),
      );
    };

    const releaseLock = () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }

      if (!localStorage) {
        channel?.postMessage({ type: "auto-sync-finished", owner: tabId });
        return;
      }

      const currentLock = parseAutoSyncLock(
        localStorage.getItem(AUTO_SYNC_LOCK_KEY),
      );
      if (currentLock?.owner === tabId) {
        localStorage.removeItem(AUTO_SYNC_LOCK_KEY);
      }

      channel?.postMessage({ type: "auto-sync-finished", owner: tabId });
    };

    const clearRetryTimer = () => {
      if (!retryTimer) {
        return;
      }
      clearTimeout(retryTimer);
      retryTimer = null;
    };

    const scheduleRetry = (attemptAutoSync: () => void) => {
      if (retryTimer || hasCompletedAutoSync || autoSyncInProgress) {
        return;
      }

      retryTimer = setTimeout(() => {
        retryTimer = null;
        attemptAutoSync();
      }, AUTO_SYNC_LOCK_TTL_MS + 500);
    };

    console.log("[AutoSync] 📍 组件已挂载");
    // 移除挂载时立即调用的 rebuildManagedModelsFromCache()
    // hydration 完成后（scheduleStart）会调用，数据更完整

    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const getHydrationState = () => {
      return {
        sync: Boolean(useSyncStore.getState()._hasHydrated),
        access: Boolean(useAccessStore.getState()._hasHydrated),
        config: Boolean(useAppConfig.getState()._hasHydrated),
        modelCache: Boolean(useModelCacheStore.getState()._hasHydrated),
        chat: Boolean(useChatStore.getState()._hasHydrated),
      };
    };
    const areCriticalStoresHydrated = () => {
      const hydrationState = getHydrationState();
      return (
        hydrationState.sync &&
        hydrationState.access &&
        hydrationState.config &&
        hydrationState.modelCache
      );
    };

    const startAutoSync = () => {
      console.log("[AutoSync] ⏰ 延迟时间到，开始检查同步配置");

      const syncStore = useSyncStore.getState();
      const modelCacheStore = useModelCacheStore.getState();

      console.log("[AutoSync] 🔍 检查同步配置:", {
        provider: syncStore.provider,
        cloudSyncResult: syncStore.cloudSync(),
        databaseConfig: syncStore.database,
      });

      // 检查是否已配置同步
      if (!syncStore.provider) {
        console.log("[AutoSync] 🔕 没有设置 provider，跳过自动同步");
        return;
      }

      const canSync = syncStore.cloudSync();
      console.log("[AutoSync] 🔍 cloudSync() 返回:", canSync);

      if (!canSync) {
        console.log("[AutoSync] 🔕 同步未配置，跳过自动同步");
        return;
      }

      const attemptAutoSync = () => {
        if (hasCompletedAutoSync || autoSyncInProgress) {
          return;
        }

        // 迁移模型缓存
        modelCacheStore.migrateFromAccessProfiles?.();

        if (!acquireLock()) {
          console.log(
            "[AutoSync] 🔒 其他标签页正在执行自动同步，当前标签页等待锁释放",
          );
          scheduleRetry(attemptAutoSync);
          return;
        }

        clearRetryTimer();
        autoSyncInProgress = true;
        const criticalSyncStartedAt = Date.now();
        heartbeatTimer = setInterval(
          refreshLock,
          Math.max(1000, AUTO_SYNC_LOCK_TTL_MS / 3),
        );
        logCriticalModelSyncBanner("start", "开始执行首开关键模型同步");
        console.log("[AutoSync] 🚀 开始自动同步...");

        Promise.resolve()
          .then(async () => {
            await waitForImmediateStoreSyncQueueIdle();
            return syncStore.resumePendingDebounceSync?.();
          })
          .catch((error: unknown) => {
            console.error("[AutoSync] ❌ 恢复未完成同步失败:", error);
            return false;
          })
          .then((resumed: boolean | void) => {
            if (resumed) {
              console.log("[AutoSync] ℹ️ 已恢复待执行同步，跳过重复自动同步");
              return;
            }

            return syncStore.autoSyncCritical?.() || syncStore.autoSync();
          })
          .then(async () => {
            await ensureRemoteBootstrapState();
            hasCompletedAutoSync = true;
            const elapsedMs = Date.now() - criticalSyncStartedAt;
            logCriticalModelSyncBanner(
              "complete",
              `关键模型数据已恢复，用时 ${elapsedMs} ms`,
            );
            console.log("[AutoSync] ✅ 关键自动同步完成，模型数据已优先恢复");
            scheduleIdleTask(() => {
              void logModelCountWithRemote();
            });
            setTimeout(() => {
              const deferredSync =
                syncStore.autoSyncDeferred?.() ?? Promise.resolve();
              void deferredSync
                .then(() => {
                  console.log("[AutoSync] ✅ 后台同步完成");
                })
                .catch((error: unknown) => {
                  console.error("[AutoSync] ❌ 后台同步失败:", error);
                });
            }, 0);
          })
          .catch((error: unknown) => {
            console.error("[AutoSync] ❌ 同步失败:", error);
          })
          .finally(() => {
            autoSyncInProgress = false;
            releaseLock();
          });
      };

      channel?.addEventListener("message", (event: MessageEvent) => {
        if (
          event.data?.type === "auto-sync-finished" &&
          !hasCompletedAutoSync &&
          !autoSyncInProgress
        ) {
          attemptAutoSync();
        }
      });

      attemptAutoSync();
    };

    const scheduleStart = () => {
      const elapsed = Date.now() - startedAt;
      if (!hasRestoredModelsFromHydratedCache && areCriticalStoresHydrated()) {
        useModelCacheStore.getState().migrateFromAccessProfiles?.();
        rebuildManagedModelsFromCache();
        hasRestoredModelsFromHydratedCache = true;
        console.info("===== 📦 本地模型缓存恢复完成 =====");
        console.info("[AutoSync] 已在首开同步前恢复本地模型缓存");
        console.info("=====");
      }

      if (!areCriticalStoresHydrated() && elapsed < 5000) {
        timer = setTimeout(scheduleStart, 80);
        return;
      }

      if (!areCriticalStoresHydrated()) {
        const hydrationState = getHydrationState();
        const pendingStores = Object.entries(hydrationState)
          .filter(([, hydrated]) => !hydrated)
          .map(([name]) => name);
        console.log(
          `[AutoSync] ℹ️ 关键 store hydration 等待超时，继续执行首开同步；未完成: ${pendingStores.join(
            ", ",
          )}`,
        );
      }

      timer = setTimeout(startAutoSync, 80);
    };

    scheduleStart();

    return () => {
      console.log("[AutoSync] 🧹 组件卸载");
      autoSyncEffectActive = false;
      if (timer) {
        clearTimeout(timer);
      }
      clearRetryTimer();
      releaseLock();
      channel?.close();
    };
    // 仅在客户端初始化后执行一次自动同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
