import type { LLMModel } from "../client/api";
import { ServiceProvider } from "../constant";
import { useAccessStore } from "../store/access";
import { useAppConfig } from "../store/config";
import { useModelCacheStore } from "../store/model-cache";
import modelPublishedAtUtils from "./model-published-at";

const { applyModelPublishedAt } = modelPublishedAtUtils;

function normalizeModelAlias(name: unknown) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\bgpt-40\b/g, "gpt-4o")
    .replace(/\bgpt-40(?=[-_.])/g, "gpt-4o")
    .replace(/\bchatgpt-40\b/g, "chatgpt-4o")
    .replace(/\bchatgpt-40(?=[-_.])/g, "chatgpt-4o");
}

function getProfileProviderId(profile: { provider: string; name: string }) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`.toLowerCase()
    : profile.provider === ServiceProvider.Local
    ? `${String(profile.provider).toLowerCase()}_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

// 模块级缓存：如果传入数据与上次完全相同则跳过执行
let lastProfilesHash = "";

function computeProfilesHash(
  profiles: Array<{ id: string; cachedModels?: string }>,
  modelCacheProfiles: Record<string, { cachedModels?: string }> | undefined,
): string {
  const parts: string[] = [];
  for (const p of profiles) {
    const cache = modelCacheProfiles?.[p.id];
    const models = cache?.cachedModels || p.cachedModels || "";
    parts.push(`${p.id}:${models}`);
  }
  return parts.join("|");
}

export function rebuildManagedModelsFromCache() {
  const accessStore = useAccessStore.getState();
  const appConfig = useAppConfig.getState();
  const modelCacheStore = useModelCacheStore.getState();
  const profiles = accessStore.apiProfiles || [];

  // 数据去重：与上次相同则跳过
  const currentHash = computeProfilesHash(profiles, modelCacheStore.profiles);
  if (currentHash === lastProfilesHash) {
    return;
  }
  lastProfilesHash = currentHash;

  const rebuiltModels: LLMModel[] = [];
  const allowedProviderIds = profiles.map((profile) =>
    getProfileProviderId(profile),
  );
  const existingModelMap = new Map<string, LLMModel>();

  (appConfig.models || []).forEach((model) => {
    const key = `${normalizeModelAlias(model?.name || "")}@${String(
      model?.provider?.id || "",
    ).toLowerCase()}`;
    if (key !== "@") {
      existingModelMap.set(key, model);
    }
  });

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
      .forEach((rawModelName, index) => {
        const existingModel = existingModelMap.get(
          `${normalizeModelAlias(rawModelName)}@${providerId}`,
        );
        rebuiltModels.push(
          applyModelPublishedAt({
            ...existingModel,
            name: rawModelName,
            displayName: existingModel?.displayName || rawModelName,
            available: true,
            sorted: index,
            provider: {
              id: providerId,
              providerName:
                existingModel?.provider?.providerName || profile.provider,
              providerType:
                existingModel?.provider?.providerType ||
                (profile.provider === ServiceProvider.Local
                  ? "openai"
                  : "custom"),
              sorted: existingModel?.provider?.sorted ?? 0,
            },
          }),
        );
      });
  });

  if (rebuiltModels.length === 0) {
    return;
  }

  const allowedProviderIdSet = new Set(
    allowedProviderIds.map((id) => String(id).toLowerCase()),
  );
  const unmanagedModels = (appConfig.models || []).filter((model) => {
    const providerId = String(model?.provider?.id || "").toLowerCase();
    return !allowedProviderIdSet.has(providerId);
  });

  useAppConfig.setState({
    ...appConfig,
    models: unmanagedModels,
  });

  appConfig.mergeModels(rebuiltModels, {
    silent: true,
    skipMarkUpdate: true,
    allowedProviderIds,
  });
}
