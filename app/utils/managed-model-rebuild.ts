import type { LLMModel } from "../client/api";
import { ServiceProvider } from "../constant";
import { useAccessStore } from "../store/access";
import { useAppConfig } from "../store/config";
import { useModelCacheStore } from "../store/model-cache";

function getProfileProviderId(profile: { provider: string; name: string }) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`.toLowerCase()
    : profile.provider === ServiceProvider.Local
    ? `${String(profile.provider).toLowerCase()}_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

export function rebuildManagedModelsFromCache() {
  const accessStore = useAccessStore.getState();
  const appConfig = useAppConfig.getState();
  const modelCacheStore = useModelCacheStore.getState();
  const profiles = accessStore.apiProfiles || [];
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
