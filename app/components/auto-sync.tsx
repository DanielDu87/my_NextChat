"use client";

import { useEffect } from "react";
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
        .autoSync()
        .then(() => {
          console.log("[AutoSync] ✅ 自动同步完成");
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

  return null;
}
