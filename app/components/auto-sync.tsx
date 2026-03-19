"use client";

import { useEffect } from "react";
import { useChatStore } from "../store";
import { useAppConfig } from "../store/config";
import { useAccessStore } from "../store/access";
import { useModelCacheStore } from "../store/model-cache";
import { useSyncStore } from "../store/sync";

export default function AutoSync() {
  useEffect(() => {
    console.log("[AutoSync] 📍 组件已挂载");

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

      // 迁移模型缓存
      modelCacheStore.migrateFromAccessProfiles?.();

      console.log("[AutoSync] 🚀 开始自动同步...");

      syncStore
        .resumePendingDebounceSync?.()
        .catch((error: unknown) => {
          console.error("[AutoSync] ❌ 恢复未完成同步失败:", error);
        })
        .then(() => syncStore.autoSync())
        .then(() => {
          useChatStore.getState().initializeForNewPage();
          console.log("[AutoSync] ✅ 自动同步完成");
          // 自动同步完成后，获取云端数据并输出完整对比
          return logModelCountWithRemote();
        })
        .catch((error: unknown) => {
          console.error("[AutoSync] ❌ 同步失败:", error);
        });
    }, 1000); // 延迟 1 秒

    return () => {
      console.log("[AutoSync] 🧹 组件卸载");
      clearTimeout(timer);
    };
  }, []);

  const logModelCountWithRemote = async () => {
    try {
      // 获取云端数据
      const res = await fetch("/api/db/models/latest", { cache: "no-store" });
      if (res.ok) {
        const data = await res.json();
        if (data?.ok && data.latest) {
          const remote = data.latest;
          logModelCount(remote.modelCount, remote.providers);
          return;
        }
      }
      // 如果获取失败，只输出本地数据
      logModelCount();
    } catch (e) {
      console.error("[AutoSync] ❌ 获取云端数据失败:", e);
      logModelCount();
    }
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
        `[AutoSync] - 差异: ${localTotalCount - remoteCount > 0 ? "+" : ""}${
          localTotalCount - remoteCount
        } 个`,
      );
    } else {
      console.log("[AutoSync] - 云端模型总数: 无数据（已清空）");
      console.log("[AutoSync] 🔍 比较结果:");
      console.log("[AutoSync] - 状态: ℹ️ 云端数据已清空，建议同步更新云端数据");
    }
  };

  function countCloudMergedModels(models: any[], profiles: any[]): number {
    if (!models.length || !profiles.length) return 0;

    // 获取所有管理的 provider IDs
    const managedProviderIds = new Set(
      profiles.map((p) => {
        if (p.provider === "Custom") {
          return `custom_${p.name}`.toLowerCase();
        }
        return String(p.provider).toLowerCase();
      }),
    );

    return models.filter((model) => {
      const providerId = String(model?.provider?.id || "").toLowerCase();
      return providerId && managedProviderIds.has(providerId);
    }).length;
  }

  function getCloudMergedPlatformCounts(
    models: any[],
    profiles: any[],
  ): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();

    models.forEach((model) => {
      const providerId = String(model.provider?.id || "").toLowerCase();
      if (!providerId) return;

      // 找到对应的 profile 名称
      const profile = profiles.find((p) => {
        if (p.provider === "Custom") {
          return `custom_${p.name}`.toLowerCase() === providerId;
        }
        return String(p.provider).toLowerCase() === providerId;
      });

      if (profile) {
        counts.set(profile.name, (counts.get(profile.name) ?? 0) + 1);
      }
    });

    return profiles.map((profile) => ({
      name: profile.name,
      count: counts.get(profile.name) ?? 0,
    }));
  }

  return null;
}
