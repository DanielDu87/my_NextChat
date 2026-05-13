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
import { useChatIndexStore } from "../store/chat-index";
import { useSyncStore } from "../store/sync";
import { useAuthStore } from "../store/auth";
import { showToast } from "./ui-lib";
import { withSyncUserHeaders } from "../utils/sync-user-client";
import { hasMeaningfulAccessState } from "../utils/sync";
import { rebuildManagedModelsFromCache } from "../utils/managed-model-rebuild";
import { readAccessSnapshot } from "../utils/access-snapshot";
import {
  ensureProviderModelsReady,
  getDefaultBootstrapProfile,
  getProfileProviderId,
} from "../utils/provider-sync";
import {
  AUTO_SYNC_CHANNEL_NAME,
  AUTO_SYNC_LOCK_KEY,
  AUTO_SYNC_LOCK_TTL_MS,
  CHAT_SYNC_HINT_KEY,
  CHAT_SYNC_UPDATED_MESSAGE_TYPE,
  buildAutoSyncLock,
  getOrCreateAutoSyncTabId,
  parseChatSyncHint,
  parseAutoSyncLock,
  shouldAutoSyncLockBeTakenOver,
} from "../utils/sync-tab-coordination";
import { isPerfFeatureEnabled, logPerfSummary, nowMs } from "../utils/perf";

let autoSyncEffectActive = false;
let lastAutoSyncBootstrapAt = 0;
const LOG_SEPARATOR = "=".repeat(5);
const autoSyncLogQueue: Array<{
  level: "log" | "info" | "warn" | "error";
  message: string;
  payload?: unknown;
}> = [];
let autoSyncLogFlushScheduled = false;

function flushAutoSyncLogs() {
  autoSyncLogFlushScheduled = false;
  const logs = autoSyncLogQueue.splice(0, autoSyncLogQueue.length);
  logs.forEach(({ level, message, payload }) => {
    if (payload === undefined) {
      console[level](message);
      return;
    }
    console[level](message, payload);
  });
}

function scheduleAutoSyncLogFlush() {
  if (autoSyncLogFlushScheduled) {
    return;
  }

  autoSyncLogFlushScheduled = true;

  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    (
      window as typeof window & {
        requestIdleCallback: (
          callback: () => void,
          options?: { timeout?: number },
        ) => number;
      }
    ).requestIdleCallback(flushAutoSyncLogs, { timeout: 500 });
    return;
  }

  setTimeout(flushAutoSyncLogs, 0);
}

function formatAutoSyncLogTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
}

function autoSyncConsole(
  level: "log" | "info" | "warn" | "error",
  message: string,
  payload?: unknown,
) {
  const prefixedMessage = `${formatAutoSyncLogTimestamp()} ${message}`;
  if (level === "warn" || level === "error") {
    if (payload === undefined) {
      console[level](prefixedMessage);
      return;
    }
    console[level](prefixedMessage, payload);
    return;
  }

  autoSyncLogQueue.push({
    level,
    message: prefixedMessage,
    payload,
  });
  scheduleAutoSyncLogFlush();
}

function logCriticalStartupSyncBanner(
  phase: "start" | "complete",
  detail?: string,
) {
  const title = phase === "start" ? "🔄 开始同步检查" : "✅ 同步检查完成";
  autoSyncConsole(
    "info",
    detail
      ? `${LOG_SEPARATOR} ${title} | ${detail} ${LOG_SEPARATOR}`
      : `${LOG_SEPARATOR} ${title} ${LOG_SEPARATOR}`,
  );
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

function scheduleDeferredSyncTask(
  task: () => void,
  options: {
    visibleDelayMs: number;
    hiddenDelayMs: number;
  },
) {
  const delayMs = document.hidden
    ? options.hiddenDelayMs
    : options.visibleDelayMs;

  // 前台页面严格按延时执行，避免 requestIdleCallback 抢跑影响首屏交互。
  if (!document.hidden) {
    return setTimeout(task, delayMs);
  }

  if (typeof window !== "undefined" && "requestIdleCallback" in window) {
    return (
      window as typeof window & {
        requestIdleCallback: (
          callback: () => void,
          options?: { timeout?: number },
        ) => number;
      }
    ).requestIdleCallback(task, { timeout: delayMs });
  }

  return setTimeout(task, delayMs);
}

export default function AutoSync() {
  const authUser = useAuthStore((state) => state.user);
  const authInitialized = useAuthStore((state) => state.initialized);
  const ensureRemoteBootstrapState = async () => {
    const syncStore = useSyncStore.getState();
    const client = syncStore.getClient() as any;
    if (typeof client.getMeta !== "function") {
      return false;
    }

    const metas = await client.getMeta([StoreKey.Access, StoreKey.Chat]);
    const remoteMetaKeys = new Set(
      (metas || []).map((meta: { key: string }) => meta.key),
    );
    const missingStoreKeys = [StoreKey.Access].filter(
      (key) => !remoteMetaKeys.has(key),
    );

    const localAccess = useAccessStore.getState() as Record<string, any>;
    const hasStoreBootstrapData = hasMeaningfulAccessState(localAccess);

    if (missingStoreKeys.length > 0 && !hasStoreBootstrapData) {
      autoSyncConsole(
        "log",
        `[AutoSync] ℹ️ 云端缺少初始化配置(${missingStoreKeys.join(
          ", ",
        )})，但本地也暂无可上传数据，跳过初始化上传`,
      );
    } else if (missingStoreKeys.length > 0) {
      autoSyncConsole(
        "log",
        `[AutoSync] ☁️ 检测到云端缺少初始化配置(${missingStoreKeys.join(
          ", ",
        )})，开始上传本地配置`,
      );
      await syncStore.sync([StoreKey.Access]);
      showToast(
        `检测到云端缺少初始化配置，已自动上传本地数据：${missingStoreKeys.join(
          ", ",
        )}`,
      );
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

    autoSyncConsole("log", "[AutoSync] 📊 模型数据汇总:");
    autoSyncConsole("log", "[AutoSync] 📍 本地数据:");
    autoSyncConsole("log", `[AutoSync] - 本地模型总数: ${localTotalCount} 个`);
    autoSyncConsole("log", "[AutoSync] 📋 本地各平台模型数量:");
    localPlatformCounts.forEach(({ name, count }) => {
      autoSyncConsole("log", `[AutoSync] - ${name}: ${count} 个模型`);
    });

    autoSyncConsole("log", "[AutoSync] ☁️ 云端数据:");
    if (remoteCount !== undefined) {
      autoSyncConsole("log", `[AutoSync] - 云端模型总数: ${remoteCount} 个`);
      if (remoteProviders && remoteProviders.length > 0) {
        autoSyncConsole("log", "[AutoSync] 📋 云端各平台模型数量:");
        remoteProviders.forEach((provider: any) => {
          autoSyncConsole(
            "log",
            `[AutoSync] - ${provider.profileName}: ${provider.fetchedCount} 个模型`,
          );
        });
      } else {
        autoSyncConsole("log", "[AutoSync] - 云端无平台数据");
      }

      autoSyncConsole("log", "[AutoSync] 🔍 比较结果:");
      autoSyncConsole(
        "log",
        `[AutoSync] - 状态: ${
          localTotalCount === remoteCount ? "✅ 一致" : "❌ 不一致，提示更新"
        }`,
      );
      autoSyncConsole(
        "log",
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
        autoSyncConsole("log", "[AutoSync] 📋 平台差异明细:");
        providerDiffs.forEach((item) => {
          autoSyncConsole(
            "log",
            `[AutoSync] - ${item.name}: 本地 ${item.localCount} / 云端 ${item.remoteCount}，${item.description}`,
          );
        });
      }
    } else {
      autoSyncConsole("log", "[AutoSync] - 云端模型总数: 无数据（已清空）");
      autoSyncConsole("log", "[AutoSync] 🔍 比较结果:");
      autoSyncConsole(
        "log",
        "[AutoSync] - 状态: ℹ️ 云端数据已清空，建议同步更新云端数据",
      );
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
      autoSyncConsole("error", "[AutoSync] ❌ 获取云端数据失败:", e);
      logModelCount();
    }
  };

  useEffect(() => {
    if (!authInitialized || !authUser) {
      return;
    }

    if (autoSyncEffectActive) {
      autoSyncConsole("log", "[AutoSync] ⏭️ 已存在自动同步实例，跳过重复挂载");
      return;
    }
    autoSyncEffectActive = true;

    const sessionStorage =
      typeof window !== "undefined" ? window.sessionStorage : null;
    const tabId = getOrCreateAutoSyncTabId(sessionStorage);
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
    let hasBootstrappedProviderModels = false;
    let hasDeferredRemoteBootstrap = false;
    let bootstrapProviderModelsPromise: Promise<any> | null = null;
    let lastForegroundSyncAt = 0;
    let lastExternalChatHintAt = 0;
    let hasRestoredModelsFromHydratedCache = false;
    let pendingBootstrapProfileId = "";
    let pendingBootstrapProfileName = "";
    let chatMetaPollTimer: ReturnType<typeof setInterval> | null = null;
    let deferredFallbackTimer: ReturnType<typeof setTimeout> | null = null;

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
      if (chatMetaPollTimer) {
        clearInterval(chatMetaPollTimer);
        chatMetaPollTimer = null;
      }

      if (!localStorage) {
        try {
          channel?.postMessage({ type: "auto-sync-finished", owner: tabId });
        } catch {}
        return;
      }

      const currentLock = parseAutoSyncLock(
        localStorage.getItem(AUTO_SYNC_LOCK_KEY),
      );
      if (currentLock?.owner === tabId) {
        localStorage.removeItem(AUTO_SYNC_LOCK_KEY);
      }

      try {
        channel?.postMessage({ type: "auto-sync-finished", owner: tabId });
      } catch {}
    };

    const clearRetryTimer = () => {
      if (!retryTimer) {
        return;
      }
      clearTimeout(retryTimer);
      retryTimer = null;
    };

    const triggerExternalChatSync = (source: string) => {
      if (!authInitialized || !authUser || autoSyncInProgress) {
        return;
      }

      const now = Date.now();
      if (now - lastExternalChatHintAt < 300) {
        return;
      }
      lastExternalChatHintAt = now;

      const syncStore = useSyncStore.getState() as any;
      void Promise.resolve()
        .then(
          () =>
            syncStore.resumePendingDebounceSync?.({
              excludeKeys: [StoreKey.Config],
            }),
        )
        .then(
          () =>
            syncStore.syncChatIfRemoteChanged?.({
              source,
              minIntervalMs: 0,
            }),
        )
        .catch((error: unknown) => {
          autoSyncConsole(
            "error",
            "[AutoSync] ❌ 外部聊天变更同步失败:",
            error,
          );
        });
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

    autoSyncConsole("log", "[AutoSync] 📍 组件已挂载");
    // 移除挂载时立即调用的 rebuildManagedModelsFromCache()
    // hydration 完成后（scheduleStart）会调用，数据更完整

    let timer: ReturnType<typeof setTimeout> | null = null;
    let clearHydrationBarrier: (() => void) | null = null;
    const startedAt = nowMs();
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
        hydrationState.chat
      );
    };

    const restoreLocalCriticalState = () => {
      if (hasRestoredModelsFromHydratedCache || !areCriticalStoresHydrated()) {
        return;
      }

      const restoreStartedAt = nowMs();
      hasRestoredModelsFromHydratedCache = true;
      const accessSnapshot = readAccessSnapshot();
      const currentAccessState = useAccessStore.getState() as Record<
        string,
        any
      >;
      const currentProfiles = Array.isArray(currentAccessState.apiProfiles)
        ? currentAccessState.apiProfiles
        : [];
      const shouldRestoreAccessSnapshot =
        currentProfiles.length <= 1 &&
        currentProfiles.every(
          (profile: Record<string, any>) =>
            String(profile?.id || "") === "default_aihubmix_profile",
        ) &&
        Array.isArray(accessSnapshot?.apiProfiles) &&
        (accessSnapshot?.apiProfiles?.length || 0) > 1;

      if (shouldRestoreAccessSnapshot) {
        useAccessStore.setState({
          ...currentAccessState,
          ...accessSnapshot,
          _hasHydrated: true,
        } as any);
        autoSyncConsole(
          "log",
          `[AutoSync] ♻️ 已从本地快照恢复 API 配置: ${
            accessSnapshot?.apiProfiles.length || 0
          } 个`,
        );
      }
      hasRestoredModelsFromHydratedCache = true;
      logPerfSummary("StartupSync", {
        localCriticalRestoreDurationMs: Number(
          (nowMs() - restoreStartedAt).toFixed(2),
        ),
      });
    };

    const restoreLocalModelCacheState = () => {
      const restoreStartedAt = nowMs();
      useModelCacheStore.getState().migrateFromAccessProfiles?.();
      const bootstrapProfile = getDefaultBootstrapProfile();
      if (bootstrapProfile?.id) {
        rebuildManagedModelsFromCache({
          force: true,
          providerIds: [getProfileProviderId(bootstrapProfile)],
        });
      } else {
        rebuildManagedModelsFromCache({ force: true });
      }
      const hasBootstrapCache = Boolean(
        bootstrapProfile?.id &&
          (useModelCacheStore.getState() as any).profiles?.[bootstrapProfile.id]
            ?.cachedModels,
      );
      if (bootstrapProfile?.id) {
        pendingBootstrapProfileId = bootstrapProfile.id;
        pendingBootstrapProfileName = bootstrapProfile.name;
        autoSyncConsole(
          "info",
          `${LOG_SEPARATOR} 🗂️ Provider 模型就绪检查 | ${bootstrapProfile.name} ${LOG_SEPARATOR}`,
        );
      }
      if (hasBootstrapCache) {
        autoSyncConsole(
          "info",
          `${LOG_SEPARATOR} 📦 本地模型缓存恢复完成 | [AutoSync] 已在首开同步前恢复本地模型缓存 ${LOG_SEPARATOR}`,
        );
      } else {
        autoSyncConsole(
          "info",
          `${LOG_SEPARATOR} 📦 本地模型缓存检查完成 | [AutoSync] 当前没有可用缓存，将走首次同步 ${LOG_SEPARATOR}`,
        );
      }
      logPerfSummary("StartupSync", {
        localModelRestoreDurationMs: Number(
          (nowMs() - restoreStartedAt).toFixed(2),
        ),
      });
    };

    const bootstrapProviderModels = (options?: { remoteRefresh?: boolean }) => {
      restoreLocalModelCacheState();
      if (!pendingBootstrapProfileId) {
        bootstrapProviderModelsPromise = Promise.resolve();
        return bootstrapProviderModelsPromise;
      }

      const shouldRemoteRefresh = Boolean(options?.remoteRefresh);

      if (!shouldRemoteRefresh) {
        if (hasBootstrappedProviderModels) {
          return bootstrapProviderModelsPromise ?? Promise.resolve();
        }
        hasBootstrappedProviderModels = true;
      } else {
        if (hasDeferredRemoteBootstrap) {
          return bootstrapProviderModelsPromise ?? Promise.resolve();
        }
        hasDeferredRemoteBootstrap = true;
      }

      bootstrapProviderModelsPromise = ensureProviderModelsReady(
        pendingBootstrapProfileId,
        {
          background: shouldRemoteRefresh,
          silent: false,
          reason: shouldRemoteRefresh ? "bootstrap" : "background",
        },
      ).catch((error) => {
        autoSyncConsole(
          "error",
          `[AutoSync] 默认 provider 模型校验失败: ${pendingBootstrapProfileName}`,
          error,
        );
      });

      return bootstrapProviderModelsPromise;
    };
    const waitForCriticalStoreHydration = async () => {
      if (!isPerfFeatureEnabled("PERF_ENABLE_LIGHT_STARTUP_SYNC")) {
        return {
          timedOut: false,
          pendingStores: [] as string[],
          durationMs: 0,
        };
      }

      const waitStartedAt = nowMs();
      if (areCriticalStoresHydrated()) {
        return {
          timedOut: false,
          pendingStores: [] as string[],
          durationMs: Number((nowMs() - waitStartedAt).toFixed(2)),
        };
      }

      return new Promise<{
        timedOut: boolean;
        pendingStores: string[];
        durationMs: number;
      }>((resolve) => {
        const finish = (timedOut: boolean) => {
          clearHydrationBarrier?.();
          clearHydrationBarrier = null;
          const hydrationState = getHydrationState();
          const pendingStores = Object.entries(hydrationState)
            .filter(
              ([name, hydrated]) =>
                !hydrated &&
                ["sync", "access", "config", "modelCache"].includes(name),
            )
            .map(([name]) => name);

          resolve({
            timedOut,
            pendingStores,
            durationMs: Number((nowMs() - waitStartedAt).toFixed(2)),
          });
        };

        const check = () => {
          restoreLocalCriticalState();
          if (areCriticalStoresHydrated()) {
            finish(false);
          }
        };

        const timeoutId = window.setTimeout(() => finish(true), 5000);
        const unsubscribers = [
          useSyncStore.subscribe(check),
          useAccessStore.subscribe(check),
          useAppConfig.subscribe(check),
          useModelCacheStore.subscribe(check),
        ];

        clearHydrationBarrier = () => {
          window.clearTimeout(timeoutId);
          unsubscribers.forEach((unsubscribe) => unsubscribe());
        };

        check();
      });
    };

    const startAutoSync = () => {
      autoSyncConsole("log", "[AutoSync] ⏰ 延迟时间到，开始检查同步配置");

      const syncStore = useSyncStore.getState();
      const modelCacheStore = useModelCacheStore.getState();

      autoSyncConsole("log", "[AutoSync] 🔍 检查同步配置:", {
        provider: syncStore.provider,
        cloudSyncResult: syncStore.cloudSync(),
        databaseConfig: syncStore.database,
      });

      // 检查是否已配置同步
      if (!syncStore.provider) {
        autoSyncConsole("log", "[AutoSync] 🔕 没有设置 provider，跳过自动同步");
        return;
      }

      const canSync = syncStore.cloudSync();
      autoSyncConsole("log", "[AutoSync] 🔍 cloudSync() 返回:", canSync);

      if (!canSync) {
        autoSyncConsole("log", "[AutoSync] 🔕 同步未配置，跳过自动同步");
        return;
      }

      const attemptAutoSync = () => {
        if (hasCompletedAutoSync || autoSyncInProgress) {
          return;
        }

        if (Date.now() - lastAutoSyncBootstrapAt < 5000) {
          autoSyncConsole(
            "log",
            "[AutoSync] ℹ️ 检测到重复首开同步触发，已跳过",
          );
          return;
        }
        lastAutoSyncBootstrapAt = Date.now();

        // 迁移模型缓存
        modelCacheStore.migrateFromAccessProfiles?.();

        if (!acquireLock()) {
          autoSyncConsole(
            "log",
            "[AutoSync] 🔒 其他标签页正在执行自动同步，当前标签页等待锁释放",
          );
          scheduleRetry(attemptAutoSync);
          return;
        }

        clearRetryTimer();
        autoSyncInProgress = true;
        const criticalSyncStartedAt = nowMs();
        heartbeatTimer = setInterval(
          refreshLock,
          Math.max(1000, AUTO_SYNC_LOCK_TTL_MS / 3),
        );
        autoSyncConsole(
          "info",
          `${LOG_SEPARATOR} 🚀 AutoSync 启动流程开始 ${LOG_SEPARATOR}`,
        );
        logCriticalStartupSyncBanner("start", "聊天记录优先");
        autoSyncConsole("log", "[AutoSync] 🚀 开始自动同步...");

        Promise.resolve()
          .then(() => syncStore.autoSyncCritical?.() || syncStore.autoSync())
          .catch((error: unknown) => {
            autoSyncConsole(
              "error",
              "[AutoSync] ⚠️ 关键同步失败（不阻止后台同步）:",
              error,
            );
          })
          .then(async () => {
            // 不再自动同步全量模型，模型由用户手动添加后按需获取
            // void bootstrapProviderModels();
            hasCompletedAutoSync = true;
            const elapsedMs = nowMs() - criticalSyncStartedAt;
            const elapsedSeconds = (elapsedMs / 1000).toFixed(2);
            logPerfSummary("StartupSync", {
              autoSyncCriticalDurationMs: Number(elapsedMs.toFixed(2)),
            });
            logCriticalStartupSyncBanner(
              "complete",
              `用时 ${elapsedSeconds} 秒`,
            );
            autoSyncConsole(
              "log",
              "[AutoSync] ✅ 关键同步完成，页面已可直接对话",
            );

            let deferredSyncExecuted = false;
            const deferredSyncTask = () => {
              if (deferredSyncExecuted) return;
              deferredSyncExecuted = true;
              if (deferredFallbackTimer) {
                clearTimeout(deferredFallbackTimer);
                deferredFallbackTimer = null;
              }

              void Promise.resolve()
                .then(() => {
                  autoSyncConsole(
                    "log",
                    "[AutoSync] 📤 后台上传本地会话到远端...",
                  );
                  return syncStore.sync([StoreKey.Chat], {
                    isolateQueue: true,
                    force: true,
                  });
                })
                .then(() => {
                  autoSyncConsole("log", "[AutoSync] ✅ 本地会话上传完成");
                })
                .catch((uploadError: unknown) => {
                  autoSyncConsole(
                    "error",
                    "[AutoSync] ⚠️ 本地会话上传失败:",
                    uploadError,
                  );
                })
                .then(
                  () =>
                    syncStore.resumePendingDebounceSync?.({
                      excludeKeys: [StoreKey.Config],
                    }),
                )
                .then((resumed: boolean | void) => {
                  if (resumed) {
                    autoSyncConsole(
                      "log",
                      "[AutoSync] ♻️ 已补跑未完成的本地同步任务",
                    );
                  }
                })
                .catch((error: unknown) => {
                  autoSyncConsole(
                    "error",
                    "[AutoSync] ❌ 补跑未完成同步失败:",
                    error,
                  );
                });

              autoSyncConsole(
                "info",
                `${LOG_SEPARATOR} 💾 对话与设置后台同步开始 ${LOG_SEPARATOR}`,
              );
              const deferredSync =
                syncStore.autoSyncDeferred?.() ?? Promise.resolve();
              void deferredSync
                .then(() => {
                  scheduleIdleTask(() => {
                    void logModelCountWithRemote();
                  });
                  autoSyncConsole(
                    "log",
                    "[AutoSync] ✅ 后台同步完成（含对话记录）",
                  );
                  autoSyncConsole(
                    "info",
                    `${LOG_SEPARATOR} 💾 对话与设置后台同步完成 ${LOG_SEPARATOR}`,
                  );
                })
                .catch((error: unknown) => {
                  autoSyncConsole(
                    "error",
                    "[AutoSync] ❌ 后台同步失败（含对话记录）:",
                    error,
                  );
                });

              const ensureRemoteBootstrapStartedAt = nowMs();
              void ensureRemoteBootstrapState()
                .then(() => {
                  logPerfSummary("StartupSync", {
                    ensureRemoteBootstrapStateDurationMs: Number(
                      (nowMs() - ensureRemoteBootstrapStartedAt).toFixed(2),
                    ),
                  });
                })
                .catch((error: unknown) => {
                  autoSyncConsole(
                    "error",
                    "[AutoSync] ❌ 远端初始化补齐失败:",
                    error,
                  );
                });
            };

            const deferredVisibleDelayMs = 15000;
            const deferredHiddenDelayMs = 2500;
            const deferredFallbackDelayMs = document.hidden ? 5000 : 20000;
            scheduleDeferredSyncTask(deferredSyncTask, {
              visibleDelayMs: deferredVisibleDelayMs,
              hiddenDelayMs: deferredHiddenDelayMs,
            });
            deferredFallbackTimer = setTimeout(
              deferredSyncTask,
              deferredFallbackDelayMs,
            );
          })
          .catch((error: unknown) => {
            autoSyncConsole("error", "[AutoSync] ❌ 同步失败:", error);
          })
          .finally(() => {
            autoSyncInProgress = false;
            releaseLock();
          });
      };

      channel?.addEventListener("message", (event: MessageEvent) => {
        if (
          event.data?.type === CHAT_SYNC_UPDATED_MESSAGE_TYPE &&
          event.data?.owner &&
          event.data.owner !== tabId
        ) {
          triggerExternalChatSync("broadcast");
          return;
        }

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

    void waitForCriticalStoreHydration().then((result) => {
      if (!autoSyncEffectActive) {
        return;
      }

      restoreLocalCriticalState();
      logPerfSummary("StartupSync", {
        hydrationWaitDurationMs: result.durationMs,
        firstInteractiveAt: Number((nowMs() - startedAt).toFixed(2)),
        pendingHydrationStores: result.pendingStores,
        hydrationTimedOut: result.timedOut,
      });

      if (result.timedOut && result.pendingStores.length > 0) {
        autoSyncConsole(
          "log",
          `[AutoSync] ℹ️ 关键 store hydration 等待超时，继续执行首开同步；未完成: ${result.pendingStores.join(
            ", ",
          )}`,
        );
      }

      timer = setTimeout(
        startAutoSync,
        isPerfFeatureEnabled("PERF_ENABLE_LIGHT_STARTUP_SYNC") ? 0 : 80,
      );
    });

    const triggerForegroundChatSync = () => {
      if (
        !authInitialized ||
        !authUser ||
        document.hidden ||
        autoSyncInProgress ||
        !hasCompletedAutoSync
      ) {
        return;
      }

      const now = Date.now();
      if (now - lastForegroundSyncAt < 3000) {
        return;
      }
      lastForegroundSyncAt = now;

      const syncStore = useSyncStore.getState();
      void Promise.resolve()
        .then(
          () =>
            syncStore.resumePendingDebounceSync?.({
              excludeKeys: [StoreKey.Config],
            }),
        )
        .then(
          () =>
            (syncStore as any).syncChatIfRemoteChanged?.({
              source: "foreground",
              minIntervalMs: 0,
            }),
        )
        .catch((error: unknown) => {
          autoSyncConsole(
            "error",
            "[AutoSync] ❌ 前台快速聊天同步失败:",
            error,
          );
        });
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        triggerForegroundChatSync();
      }
    };

    const handleWindowFocus = () => {
      triggerForegroundChatSync();
    };

    const handlePageHide = () => {
      const syncStore = useSyncStore.getState() as any;
      syncStore.flushPendingDebounceSync?.([StoreKey.Chat]);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== CHAT_SYNC_HINT_KEY) {
        return;
      }

      const hint = parseChatSyncHint(event.newValue);
      if (!hint || hint.owner === tabId) {
        return;
      }

      triggerExternalChatSync("storage");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("storage", handleStorage);

    chatMetaPollTimer = setInterval(() => {
      if (autoSyncInProgress || !hasCompletedAutoSync) {
        return;
      }
      if (!document.hidden) {
        return;
      }

      const now = Date.now();
      if (now - startedAt < 15000 || now - lastExternalChatHintAt < 15000) {
        return;
      }

      triggerExternalChatSync("poll");
    }, 15000);

    return () => {
      autoSyncConsole("log", "[AutoSync] 🧹 组件卸载");
      autoSyncEffectActive = false;
      if (timer) {
        clearTimeout(timer);
      }
      if (deferredFallbackTimer) {
        clearTimeout(deferredFallbackTimer);
      }
      clearHydrationBarrier?.();
      clearHydrationBarrier = null;
      clearRetryTimer();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("storage", handleStorage);
      releaseLock();
      channel?.close();
    };
    // 仅在客户端初始化后执行一次自动同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authInitialized, authUser]);

  return null;
}
