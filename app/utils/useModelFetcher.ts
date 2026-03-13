import { useState, useCallback } from "react";
import { ServiceProvider } from "../constant";
import {
  fetchModelsFromProvider,
  updateModelsInStore,
  FetchModelsResult,
  getProviderDisplayName,
} from "./models";

export function useModelFetcher() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 从指定供应商获取模型并更新到配置
   */
  const fetchFromProvider = useCallback(
    async (
      provider: ServiceProvider,
      baseUrl?: string,
      apiKey?: string,
      options?: {
        silent?: boolean;
        profileName?: string;
      },
    ): Promise<FetchModelsResult> => {
      const displayName = getProviderDisplayName(provider, baseUrl);
      if (!options?.silent) {
        console.log(`[Model Fetcher] 🔍 开始从 ${displayName} 获取模型...`);
        if (baseUrl) {
          console.log(`[Model Fetcher] 🌐 API 地址: ${baseUrl}`);
        }
      }
      setLoading(true);
      setError(null);

      try {
        const result = await fetchModelsFromProvider(
          provider,
          baseUrl,
          apiKey,
          options?.profileName,
        );

        await updateModelsInStore(result.models);

        if (!options?.silent) {
          console.log(
            `[Model Fetcher] ✅ 从 ${displayName} 获取成功: ${result.total} 个模型`,
          );
          console.log(
            `[Model Fetcher] ✅ 已成功获取并保存 ${result.total} 个模型`,
          );
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "获取模型失败";
        setError(errorMsg);
        console.error(
          `[Model Fetcher] ❌ 从 ${displayName} 获取模型失败:`,
          errorMsg,
        );
        return { models: [], total: 0 };
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return {
    loading,
    error,
    fetchFromProvider,
  };
}
