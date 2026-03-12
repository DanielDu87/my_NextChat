import { useState, useCallback } from "react";
import { ServiceProvider } from "../constant";
import {
  fetchModelsFromProvider,
  updateModelsInStore,
  FetchModelsResult,
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
      },
    ): Promise<FetchModelsResult> => {
      setLoading(true);
      setError(null);

      try {
        const result = await fetchModelsFromProvider(provider, baseUrl, apiKey);

        await updateModelsInStore(result.models);

        if (!options?.silent) {
          console.log(`[Model Fetcher] 已成功获取 ${result.total} 个模型`);
        }

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "获取模型失败";
        setError(errorMsg);
        console.error("[Model Fetcher] 获取模型失败:", errorMsg);
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
