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
          // 输出模型统计
          logModelCount();
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

  const logModelCount = () => {
    const currentProfiles = useAccessStore.getState().apiProfiles || [];
    const currentModels = useAppConfig.getState().models || [];
    const totalCount = countCloudMergedModels(currentModels, currentProfiles);
    const platformCounts = getCloudMergedPlatformCounts(
      currentModels,
      currentProfiles,
    );

    console.log("[AutoSync] 📊 当前本地缓存模型汇总");
    console.log(`[AutoSync] - 总模型数: ${totalCount} 个`);
    platformCounts.forEach(({ name, count }) => {
      console.log(`[AutoSync] - ${name}: ${count} 个模型`);
    });
  };

  function countCloudMergedModels(models: any[], profiles: any[]): number {
    return models.filter((model) => {
      const providerId = String(model?.provider?.id || "").toLowerCase();
      return profiles.some(
        (p) => `custom_${p.name}`.toLowerCase() === providerId,
      );
    }).length;
  }

  function getCloudMergedPlatformCounts(
    models: any[],
    profiles: any[],
  ): Array<{ name: string; count: number }> {
    const counts = new Map<string, number>();

    models.forEach((model) => {
      const providerId = String(model.provider?.id || "").toLowerCase();
      if (!providerId || providerId.startsWith("custom_")) {
        const profileName = providerId.replace("custom_", "");
        counts.set(profileName, (counts.get(profileName) ?? 0) + 1);
      }
    });

    return profiles.map((profile) => ({
      name: profile.name,
      count: counts.get(profile.name.toLowerCase()) ?? 0,
    }));
  }

  return null;
}
