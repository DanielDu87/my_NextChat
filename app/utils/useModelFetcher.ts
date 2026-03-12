import { useState, useCallback } from "react";
import { ServiceProvider } from "../constant";
import { fetchModelsFromProvider, updateModelsInStore } from "./models";
import { LLMModel } from "../client/api";

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
    ): Promise<LLMModel[]> => {
      setLoading(true);
      setError(null);

      try {
        const models = await fetchModelsFromProvider(provider, baseUrl, apiKey);

        await updateModelsInStore(models);

        if (!options?.silent) {
          console.log(`[Model Fetcher] 已成功获取 ${models.length} 个模型`);
        }

        return models;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "获取模型失败";
        setError(errorMsg);
        console.error("[Model Fetcher] 获取模型失败:", errorMsg);
        return [];
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
