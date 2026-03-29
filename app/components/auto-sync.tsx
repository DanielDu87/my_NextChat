"use client";

import { useEffect } from "react";
import type { LLMModel } from "../client/api";
import {
  buildProviderDiffSummaries,
  countCloudMergedModels,
  describeModelCountDiff,
  getCloudMergedPlatformCounts,
} from "../utils/auto-sync-model-diff";
import { ServiceProvider } from "../constant";
import { useChatStore } from "../store/chat";
import { useAppConfig } from "../store/config";
import { useAccessStore } from "../store/access";
import { useModelCacheStore } from "../store/model-cache";
import { useSyncStore } from "../store/sync";
import { withSyncUserHeaders } from "../utils/sync-user-client";
import {
  AUTO_SYNC_CHANNEL_NAME,
  AUTO_SYNC_LOCK_KEY,
  AUTO_SYNC_LOCK_TTL_MS,
  buildAutoSyncLock,
  parseAutoSyncLock,
  shouldAutoSyncLockBeTakenOver,
} from "../utils/sync-tab-coordination";

let autoSyncEffectActive = false;

function getProfileProviderId(profile: { provider: string; name: string }) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`.toLowerCase()
    : profile.provider === ServiceProvider.Local
    ? `${String(profile.provider).toLowerCase()}_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

function rebuildManagedModelsFromCache() {
  const accessStore = useAccessStore.getState();
  const appConfig = useAppConfig.getState();
  const modelCacheStore = useModelCacheStore.getState();
  const profiles = accessStore.apiProfiles || [];
  const existingManagedCount = countCloudMergedModels(
    appConfig.models || [],
    profiles,
  );

  if (existingManagedCount > 0) {
    return;
  }

  const rebuiltModels: LLMModel[] = [];

  profiles.forEach((profile) => {
    const cache = modelCacheStore.profiles?.[profile.id];
    const cachedModels = cache?.cachedModels || profile.cachedModels || "";
    if (!cachedModels) {
      return;
    }

    const providerId = getProfileProviderId(profile);
    cachedModels
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .forEach((modelName, index) => {
        rebuiltModels.push({
          name: modelName,
          displayName: modelName,
          available: true,
          sorted: index,
          provider: {
            id: providerId,
            providerName: profile.provider,
            providerType:
              profile.provider === ServiceProvider.Local ? "openai" : "custom",
            sorted: 0,
          },
        });
      });
  });

  if (rebuiltModels.length === 0) {
    return;
  }

  appConfig.mergeModels(rebuiltModels, {
    silent: true,
    allowedProviderIds: profiles.map((profile) =>
      getProfileProviderId(profile),
    ),
  });
}

export default function AutoSync() {
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

    const tabId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
    rebuildManagedModelsFromCache();

    // 延迟执行，确保 stores 初始化
    const timer = setTimeout(() => {
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
        heartbeatTimer = setInterval(
          refreshLock,
          Math.max(1000, AUTO_SYNC_LOCK_TTL_MS / 3),
        );
        console.log("[AutoSync] 🚀 开始自动同步...");

        syncStore
          .resumePendingDebounceSync?.()
          .catch((error: unknown) => {
            console.error("[AutoSync] ❌ 恢复未完成同步失败:", error);
            return false;
          })
          .then((resumed: boolean | void) => {
            if (resumed) {
              console.log("[AutoSync] ℹ️ 已恢复待执行同步，跳过重复自动同步");
              return;
            }

            return syncStore.autoSync();
          })
          .then(() => {
            rebuildManagedModelsFromCache();
            hasCompletedAutoSync = true;
            console.log("[AutoSync] ✅ 自动同步完成");
            return logModelCountWithRemote();
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
    }, 1000); // 延迟 1 秒

    return () => {
      console.log("[AutoSync] 🧹 组件卸载");
      autoSyncEffectActive = false;
      clearTimeout(timer);
      clearRetryTimer();
      releaseLock();
      channel?.close();
    };
    // 仅在客户端初始化后执行一次自动同步。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
