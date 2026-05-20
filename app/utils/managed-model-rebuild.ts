import type { LLMModel } from "../client/api";
import { ServiceProvider } from "../constant";
import { useAccessStore } from "../store/access";
import { useAppConfig } from "../store/config";
import { useModelCacheStore } from "../store/model-cache";
import {
  hydrateModelsWithAiHubMixMetadata,
  seedAiHubMixMetadataCacheFromModels,
} from "./aihubmix-model-metadata";
import modelPublishedAtUtils from "./model-published-at";
import { comparePublishedAt } from "./model-published-at";

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
  providerIds?: string[],
): string {
  const providerIdFilter = providerIds
    ? new Set(providerIds.map((id) => String(id).toLowerCase()))
    : null;
  const parts: string[] = [];
  for (const p of profiles) {
    const providerId = p.id.toLowerCase();
    if (providerIdFilter && !providerIdFilter.has(providerId)) {
      continue;
    }
    const cache = modelCacheProfiles?.[p.id];
    const models = cache?.cachedModels || p.cachedModels || "";
    parts.push(`${p.id}:${models}`);
  }
  return parts.join("|");
}

export function rebuildManagedModelsFromCache(options?: {
  force?: boolean;
  providerIds?: string[];
}) {
  const accessStore = useAccessStore.getState();
  const appConfig = useAppConfig.getState();
  const modelCacheStore = useModelCacheStore.getState();
  const profiles = accessStore.apiProfiles || [];
  const providerIdFilter = options?.providerIds
    ? new Set(options.providerIds.map((id) => String(id).toLowerCase()))
    : null;

  // 数据去重：与上次相同则跳过
  const currentHash = computeProfilesHash(
    profiles,
    modelCacheStore.profiles,
    options?.providerIds,
  );
  if (!options?.force && currentHash === lastProfilesHash) {
    return;
  }
  lastProfilesHash = currentHash;

  const rebuiltModels: LLMModel[] = [];
  const managedProviderIds = profiles.map((profile) =>
    getProfileProviderId(profile),
  );
  const allowedProviderIds = profiles
    .map((profile) => getProfileProviderId(profile))
    .filter((providerId) =>
      providerIdFilter
        ? providerIdFilter.has(String(providerId).toLowerCase())
        : true,
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
    const providerId = getProfileProviderId(profile);
    if (providerIdFilter && !providerIdFilter.has(providerId.toLowerCase())) {
      return;
    }

    const cache = modelCacheStore.profiles?.[profile.id];
    const cachedModels = cache?.cachedModels || profile.cachedModels || "";
    if (!cachedModels) {
      return;
    }

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

  seedAiHubMixMetadataCacheFromModels(appConfig.models || []);
  const hydratedRebuiltModels =
    hydrateModelsWithAiHubMixMetadata(rebuiltModels);
  const sortedHydratedModels = [...hydratedRebuiltModels]
    .sort((left, right) => comparePublishedAt(left, right))
    .map((model, index) => ({
      ...model,
      sorted: index,
    }));

  const sortedCacheNamesByProviderId = new Map<string, string[]>();
  sortedHydratedModels.forEach((model) => {
    const providerId = String(model?.provider?.id || "").toLowerCase();
    if (!providerId) {
      return;
    }
    const names = sortedCacheNamesByProviderId.get(providerId) || [];
    names.push(String(model.name || ""));
    sortedCacheNamesByProviderId.set(providerId, names);
  });

  const sortedCacheByProviderId = new Map<string, string>(
    [...sortedCacheNamesByProviderId.entries()].map(([providerId, names]) => [
      providerId,
      names.join(","),
    ]),
  );

  if (sortedCacheByProviderId.size > 0) {
    useAccessStore.setState((state) => ({
      ...state,
      apiProfiles: (state.apiProfiles || []).map((profile) => {
        const providerId = getProfileProviderId(profile).toLowerCase();
        const sortedCachedModels = sortedCacheByProviderId.get(providerId);
        if (
          !sortedCachedModels ||
          profile.cachedModels === sortedCachedModels
        ) {
          return profile;
        }
        return {
          ...profile,
          cachedModels: sortedCachedModels,
        };
      }),
    }));

    useModelCacheStore.setState((state: any) => ({
      ...state,
      profiles: Object.fromEntries(
        Object.entries(state.profiles || {}).map(([profileId, cache]: any) => {
          const profile = profiles.find((item) => item.id === profileId);
          const providerId = profile
            ? getProfileProviderId(profile).toLowerCase()
            : "";
          const sortedCachedModels = providerId
            ? sortedCacheByProviderId.get(providerId)
            : undefined;

          if (
            !sortedCachedModels ||
            cache?.cachedModels === sortedCachedModels
          ) {
            return [profileId, cache];
          }

          return [
            profileId,
            {
              ...cache,
              cachedModels: sortedCachedModels,
            },
          ];
        }),
      ),
    }));
  }

  const managedProviderIdSet = new Set(
    managedProviderIds.map((id) => String(id).toLowerCase()),
  );
  const unmanagedModels = (appConfig.models || []).filter((model) => {
    const providerId = String(model?.provider?.id || "").toLowerCase();
    return !managedProviderIdSet.has(providerId);
  });

  useAppConfig.setState({
    ...appConfig,
    models: unmanagedModels,
  });

  appConfig.mergeModels(sortedHydratedModels, {
    silent: true,
    skipMarkUpdate: true,
    allowedProviderIds,
    diffBaseModels: appConfig.models || [],
  });
}
