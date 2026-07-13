import { ServiceProvider, StoreKey } from "@/app/constant";
import {
  buildPersistedStoreState,
  unwrapPersistedStoreState,
} from "@/app/utils/sync-store-keys";
import { fetchModelsFromProviderForServer } from "@/app/utils/server/provider-model-fetch";
import { ensureSyncStorageSchema } from "./postgres";
import { getStoreSnapshot, setStoreSnapshot } from "./sync-store-repository";
import { getDefaultSyncUserId } from "./sync-user";
import { saveProviderModelCachedPath } from "./provider-model-repository";
import { getProviderBalanceConfig } from "./provider-balance-repository";
import { getOrCreateSyncAppUserId } from "./sync-app-user";

type AccessProfile = {
  id: string;
  name: string;
  provider: ServiceProvider;
  baseUrl: string;
  apiKey: string;
  modelFetchApiKey?: string;
  apiKeyGroups?: Record<string, string>;
  multiKeyGroupOrder?: string[];
  multiKeyEnabled?: boolean;
  enabled: boolean;
  openAICompatible?: boolean;
  authType?: string;
  authQueryParam?: string;
  extraHeaders?: string;
  cachedModels?: string;
  modelCount?: number;
};

type AccessState = {
  apiProfiles?: AccessProfile[];
  [key: string]: unknown;
};

type ProviderRefreshSummary = {
  profileId: string;
  profileName: string;
  provider: string;
  providerId: string;
  fetchedCount: number;
  previousCloudCount: number;
  mergedCount: number;
  updatedAt: string;
};

type RefreshConfiguredProviderModelsResult = {
  ok: true;
  profileCount: number;
  modelCount: number;
  providers: ProviderRefreshSummary[];
  updatedStoreKeys: string[];
};

function toIsoNow() {
  return new Date().toISOString();
}

function normalizeProviderId(
  profile: Pick<AccessProfile, "provider" | "name">,
) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`
    : profile.provider === ServiceProvider.Local
    ? `${String(profile.provider).toLowerCase()}_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

async function getCloudAccessState(userId: string) {
  const payload = await getStoreSnapshot(StoreKey.Access, userId);
  return unwrapPersistedStoreState<AccessState | null>(payload) || {};
}

function shouldSyncProfile(profile: AccessProfile) {
  return Boolean(
    profile.id &&
      profile.name &&
      profile.baseUrl &&
      (profile.modelFetchApiKey ||
        profile.apiKey ||
        Object.values(profile.apiKeyGroups || {}).some(Boolean)),
  );
}

export async function refreshConfiguredProviderModels(
  triggerSource = "manual",
  userId = getDefaultSyncUserId(),
  profileId?: string,
): Promise<RefreshConfiguredProviderModelsResult> {
  await ensureSyncStorageSchema();
  void triggerSource;

  const accessState = await getCloudAccessState(userId);
  const appUserId = await getOrCreateSyncAppUserId(userId);
  const profiles = (accessState.apiProfiles || []).filter(
    (profile) =>
      shouldSyncProfile(profile) && (!profileId || profile.id === profileId),
  );

  const summaries: ProviderRefreshSummary[] = [];

  for (const profile of profiles) {
    const providerId = normalizeProviderId(profile);
    const profileModelKey = profile.modelFetchApiKey || profile.apiKey;
    const managementKey =
      (await getProviderBalanceConfig(profile.id))?.managementKey || "";
    const apiKeyGroups = { ...(profile.apiKeyGroups || {}) };
    const primaryFallbackGroup = "__profile_model_key";
    if (managementKey && profileModelKey && managementKey !== profileModelKey) {
      apiKeyGroups[primaryFallbackGroup] = profileModelKey;
    }
    const result = await fetchModelsFromProviderForServer(
      profile.provider,
      profile.baseUrl,
      managementKey || profileModelKey,
      profile.name,
      apiKeyGroups,
      profile.openAICompatible,
      [
        ...(managementKey &&
        profileModelKey &&
        managementKey !== profileModelKey
          ? [primaryFallbackGroup]
          : []),
        ...(profile.multiKeyGroupOrder || []),
      ],
      {
        authType: profile.authType,
        authQueryParam: profile.authQueryParam,
        extraHeaders: profile.extraHeaders,
        userId: appUserId,
        profileId: profile.id,
      },
    );

    // 成功获取后保存模型接口路径
    if (result.cachedPath && result.models.length > 0) {
      try {
        await saveProviderModelCachedPath(profile.id, {
          cachedModelPath: result.cachedPath,
          cachedModelBaseUrl: result.cachedBaseUrl,
          cachedModelAuthType: result.cachedAuthType,
          cachedModelApiKey: result.cachedApiKey,
        });
        console.log("[Fetch Models] 💾 已保存模型获取缓存", {
          profile: profile.name,
          url: `${result.cachedBaseUrl || profile.baseUrl}${result.cachedPath}`,
          authType: result.cachedAuthType || "unknown",
          apiKey: result.cachedApiKey
            ? `${result.cachedApiKey.slice(0, 4)}***${result.cachedApiKey.slice(
                -4,
              )}`
            : "未缓存",
        });
      } catch (e) {
        // 忽略保存失败
      }
    }

    summaries.push({
      profileId: profile.id,
      profileName: profile.name,
      provider: profile.provider,
      providerId,
      fetchedCount: result.models.length,
      previousCloudCount: 0,
      mergedCount: result.models.length,
      updatedAt: toIsoNow(),
    });
  }

  // 手动获取单个供应商只保存模型路径/Key 缓存，禁止回写 Access 快照，
  // 避免和首页原有聊天同步争用同一同步生命周期。
  if (!profileId) {
    const nextProfiles = (accessState.apiProfiles || []).map((profile) => {
      const matched = summaries.find((item) => item.profileId === profile.id);
      if (!matched) return profile;
      return { ...profile };
    });

    await setStoreSnapshot(
      StoreKey.Access,
      buildPersistedStoreState(StoreKey.Access, {
        ...accessState,
        apiProfiles: nextProfiles,
      }),
      userId,
    );
  }

  // 计算各平台数量相加的总数（不去重）
  const totalCount = summaries.reduce(
    (sum, item) => sum + item.fetchedCount,
    0,
  );

  const summary = {
    profileCount: summaries.length,
    modelCount: totalCount,
    providers: summaries,
    updatedStoreKeys: [StoreKey.Access],
  };

  return {
    ok: true,
    ...summary,
  };
}
