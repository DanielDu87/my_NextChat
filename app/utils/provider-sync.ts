import { ServiceProvider, StoreKey } from "../constant";
import { useAccessStore, useAppConfig, useModelCacheStore } from "../store";
import { useSyncStore } from "../store/sync";
import { withSyncUserHeaders } from "./sync-user-client";
import { MODEL_SYNC_STORE_KEYS } from "./sync-store-keys";
import {
  runWithImmediateStoreSyncPaused,
  waitForImmediateStoreSyncQueueIdle,
} from "./store";
import { ProviderType } from "./cloud";
import { FetchModelsResult, modelsToCustomModelsString } from "./models";
import { parseStoreStatePayload } from "./sync-store-keys";
import { runWithBalanceRefreshPaused } from "../store/update";

type ApiProfile = {
  id: string;
  name: string;
  provider: ServiceProvider;
  baseUrl: string;
  apiKey: string;
  apiKeyGroups?: Record<string, string>;
  enabled: boolean;
};

type FetchFromProvider = (
  provider: ServiceProvider,
  baseUrl?: string,
  apiKey?: string,
  options?: {
    silent?: boolean;
    profileName?: string;
    apiKeyGroups?: Record<string, string>;
    throwOnError?: boolean;
  },
) => Promise<FetchModelsResult>;

type SyncAllProfilesResult = {
  totalFetched: number;
  results: Array<{
    name: string;
    count: number;
    success: boolean;
  }>;
};

function getProfileProviderId(profile: Pick<ApiProfile, "provider" | "name">) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`
    : profile.provider === ServiceProvider.Local
    ? `${String(profile.provider).toLowerCase()}_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

function getProfileActualCount(profile: Pick<ApiProfile, "provider" | "name">) {
  const providerId = getProfileProviderId(profile).toLowerCase();
  return (useAppConfig.getState().models || []).filter(
    (model) => String(model.provider?.id || "").toLowerCase() === providerId,
  ).length;
}

async function updateRemoteModelCount(
  totalCount: number,
  results: SyncAllProfilesResult["results"],
  profiles: ApiProfile[],
) {
  const providers = results
    .map((entry) => {
      const profile = profiles.find((item) => item.name === entry.name);
      if (!profile) {
        return null;
      }

      return {
        profileId: profile.id,
        profileName: profile.name,
        providerId: getProfileProviderId(profile).toLowerCase(),
        fetchedCount: entry.success ? entry.count : 0,
      };
    })
    .filter(Boolean);

  await fetch("/api/db/models/count", {
    method: "POST",
    headers: withSyncUserHeaders({
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      count: totalCount,
      providers,
    }),
  });
}

async function ensureProfilesLoadedFromDatabase() {
  const syncStore = useSyncStore.getState() as any;
  if (syncStore.provider !== ProviderType.Database) {
    return [] as ApiProfile[];
  }

  const client = syncStore.getClient?.() as any;
  if (!client || typeof client.get !== "function") {
    return [] as ApiProfile[];
  }

  const remoteAccessJson = await client.get(StoreKey.Access);
  if (!remoteAccessJson) {
    return [] as ApiProfile[];
  }

  const remoteAccess = parseStoreStatePayload<any>(remoteAccessJson);
  const remoteProfiles = Array.isArray(remoteAccess?.apiProfiles)
    ? (remoteAccess.apiProfiles.filter((profile: ApiProfile) => profile?.id) as
        | ApiProfile[]
        | undefined) || []
    : [];

  if (remoteProfiles.length === 0) {
    return [];
  }

  useAccessStore.getState().update((state: any) => {
    state.useCustomConfig = remoteAccess?.useCustomConfig ?? true;
    state.provider = remoteAccess?.provider || state.provider;
    state.apiProfiles = remoteProfiles;
  });

  return remoteProfiles;
}

export async function syncAllProfilesToDatabase(params: {
  fetchFromProvider: FetchFromProvider;
}) {
  const { fetchFromProvider } = params;

  return runWithBalanceRefreshPaused(() =>
    runWithImmediateStoreSyncPaused(async () => {
      const accessStore = useAccessStore.getState() as any;
      const syncStore = useSyncStore.getState() as any;
      let profiles = (useAccessStore.getState().apiProfiles ||
        []) as ApiProfile[];

      if (profiles.length === 0) {
        profiles = await ensureProfilesLoadedFromDatabase();
      }

      if (profiles.length === 0) {
        throw new Error(
          "没有可同步的配置条目，请先从数据库下载配置或在本地添加 API 配置",
        );
      }

      accessStore.update((access: any) => {
        access.useCustomConfig = true;
      });

      syncStore.update((state: any) => {
        state.provider = ProviderType.Database;
      });

      let totalFetched = 0;
      const results: SyncAllProfilesResult["results"] = [];

      for (const profile of profiles) {
        console.log(`[API Config] 📋 正在获取 ${profile.name} 的模型...`);

        try {
          const result = await fetchFromProvider(
            profile.provider,
            profile.baseUrl,
            profile.apiKey,
            {
              silent: true,
              throwOnError: true,
              profileName: profile.name,
              apiKeyGroups: profile.apiKeyGroups,
            },
          );

          const fetchedModels = modelsToCustomModelsString(result.models);

          accessStore.update((state: any) => {
            if (
              state.apiProfiles.find((p: ApiProfile) => p.id === profile.id)
                ?.enabled
            ) {
              state.customModels = fetchedModels;
            }
          });
          useModelCacheStore.getState().upsertProfileCache(profile.id, {
            cachedModels: fetchedModels,
            modelCount: result.total,
          });

          const mergedCount = getProfileActualCount(profile);
          totalFetched += mergedCount;
          results.push({
            name: profile.name,
            count: mergedCount,
            success: true,
          });

          console.log(`[API Config] ✅ ${profile.name} 获取完成`);
        } catch (error) {
          results.push({
            name: profile.name,
            count: 0,
            success: false,
          });
          console.error(`[API Config] ❌ ${profile.name} 获取失败`, error);
        }
      }

      console.log("[API Config] ⏳ 模型获取完成，等待数据库同步完成...");
      await waitForImmediateStoreSyncQueueIdle();
      await syncStore.sync([...MODEL_SYNC_STORE_KEYS]);
      await updateRemoteModelCount(totalFetched, results, profiles);

      return {
        totalFetched,
        results,
      } satisfies SyncAllProfilesResult;
    }),
  );
}
