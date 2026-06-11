import { ServiceProvider, StoreKey } from "@/app/constant";
import {
  buildPersistedStoreState,
  unwrapPersistedStoreState,
} from "@/app/utils/sync-store-keys";
import { fetchModelsFromProviderForServer } from "@/app/utils/server/provider-model-fetch";
import { ensureSyncStorageSchema } from "./postgres";
import { getStoreSnapshot, setStoreSnapshot } from "./sync-store-repository";
import { getDefaultSyncUserId } from "./sync-user";

type AccessProfile = {
  id: string;
  name: string;
  provider: ServiceProvider;
  baseUrl: string;
  apiKey: string;
  apiKeyGroups?: Record<string, string>;
  multiKeyGroupOrder?: string[];
  multiKeyEnabled?: boolean;
  enabled: boolean;
  openAICompatible?: boolean;
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
    profile.id && profile.name && profile.baseUrl && profile.apiKey,
  );
}

export async function refreshConfiguredProviderModels(
  triggerSource = "manual",
  userId = getDefaultSyncUserId(),
): Promise<RefreshConfiguredProviderModelsResult> {
  await ensureSyncStorageSchema();
  void triggerSource;

  const accessState = await getCloudAccessState(userId);
  const profiles = (accessState.apiProfiles || []).filter(shouldSyncProfile);

  const summaries: ProviderRefreshSummary[] = [];

  for (const profile of profiles) {
    const providerId = normalizeProviderId(profile);
    const result = await fetchModelsFromProviderForServer(
      profile.provider,
      profile.baseUrl,
      profile.apiKey,
      profile.name,
      profile.apiKeyGroups,
    );

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

  // 计算各平台数量相加的总数（不去重）
  const totalCount = summaries.reduce((sum, item) => sum + item.fetchedCount, 0);

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
