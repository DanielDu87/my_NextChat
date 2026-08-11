import { ServiceProvider } from "../constant";
import type { LLMModel } from "../client/api";

type ProfileLike = {
  id: string;
  name: string;
  provider: ServiceProvider;
  cachedModels?: string;
};

type CacheLike = {
  cachedModels?: string;
};

/**
 * 把每个 profile 的 model-cache 中的全量模型展开为 LLMModel 数组，
 * 用于辅助"最新 OpenAI 模型"等判断；本身不会写入 appConfig.models。
 */
export function buildCachedExtraModels(
  profiles: readonly ProfileLike[],
  cacheMap: Record<string, CacheLike>,
): LLMModel[] {
  const extras: LLMModel[] = [];
  profiles.forEach((profile) => {
    const cache = cacheMap?.[profile.id];
    const cachedModelsStr = cache?.cachedModels || profile.cachedModels || "";
    if (!cachedModelsStr) return;
    const providerId =
      profile.provider === ServiceProvider.Custom
        ? `custom_${profile.name}`.toLowerCase()
        : String(profile.provider || "").toLowerCase();
    String(cachedModelsStr)
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean)
      .forEach((modelName) => {
        const cleaned = modelName.replace(/^[+-]/, "").split("=")[0];
        const [name] = cleaned.split("@");
        if (!name) return;
        extras.push({
          name,
          available: true,
          provider: {
            id: providerId,
            providerName: profile.provider,
            providerType: providerId,
          },
        } as LLMModel);
      });
  });
  return extras;
}
