import { ServiceProvider, StoreKey } from "../constant";
import { useAccessStore, useAppConfig, useModelCacheStore } from "../store";
import { useSyncStore } from "../store/sync";
import { MODEL_SYNC_STORE_KEYS } from "./sync-store-keys";
import {
  runWithImmediateStoreSyncPaused,
  waitForImmediateStoreSyncQueueIdle,
} from "./store";
import { ProviderType } from "./cloud";
import {
  FetchModelsResult,
  fetchModelsFromProvider,
  getProviderDisplayName,
  modelsToCustomModelsString,
} from "./models";
import { parseStoreStatePayload } from "./sync-store-keys";
import { runWithBalanceRefreshPaused } from "../store/update";
import { writeAccessSnapshot } from "./access-snapshot";
import { rebuildManagedModelsFromCache } from "./managed-model-rebuild";
import { logger } from "./logger";
import { comparePublishedAt } from "./model-published-at";

export type ApiProfile = {
  id: string;
  name: string;
  provider: ServiceProvider;
  baseUrl: string;
  apiKey: string;
  apiKeyGroups?: Record<string, string>;
  enabled: boolean;
  openAICompatible?: boolean;
  cachedModels?: string;
  modelCount?: number;
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

const PROVIDER_MODEL_SYNC_TTL_MS = 5 * 60 * 1000;
const providerSyncInFlight = new Map<string, Promise<FetchModelsResult>>();

export function getProfileProviderId(
  profile: Pick<ApiProfile, "provider" | "name">,
) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`.toLowerCase()
    : profile.provider === ServiceProvider.Local
    ? `${String(profile.provider).toLowerCase()}_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

export function getDefaultBootstrapProfile(
  profiles: ApiProfile[] = (useAccessStore.getState().apiProfiles ||
    []) as ApiProfile[],
) {
  return (
    profiles.find(
      (profile) =>
        profile.provider === ServiceProvider.Custom &&
        profile.name === "AihubMix",
    ) ||
    profiles.find((profile) => profile.enabled) ||
    profiles[0]
  );
}

function getProfileActualModelsString(profile: ApiProfile) {
  const providerId = getProfileProviderId(profile).toLowerCase();
  return modelsToCustomModelsString(
    (useAppConfig.getState().models || []).filter(
      (model) => String(model.provider?.id || "").toLowerCase() === providerId,
    ),
  );
}

function persistAccessSnapshot() {
  const latestAccessState = useAccessStore.getState();
  writeAccessSnapshot({
    useCustomConfig: latestAccessState.useCustomConfig,
    provider: latestAccessState.provider,
    apiProfiles: latestAccessState.apiProfiles,
    customModels: latestAccessState.customModels,
    customUrl: latestAccessState.customUrl,
    customApiKey: latestAccessState.customApiKey,
    customOpenAICompatible: latestAccessState.customOpenAICompatible,
  });
}

export async function syncProfileModels(
  profileId: string,
  options?: {
    silent?: boolean;
    reason?: "bootstrap" | "switch" | "manual" | "background";
  },
) {
  const profile = (useAccessStore.getState().apiProfiles || []).find(
    (item) => item.id === profileId,
  ) as ApiProfile | undefined;
  if (!profile) {
    throw new Error(`[Provider Sync] 未找到 profile: ${profileId}`);
  }

  const modelCacheStore = useModelCacheStore.getState() as any;
  const currentCache = modelCacheStore.profiles?.[profileId];
  const providerId = getProfileProviderId(profile).toLowerCase();

  modelCacheStore.setProfileSyncState?.(profileId, {
    source: currentCache?.cachedModels ? "cache" : "builtin",
    syncStatus: currentCache?.cachedModels ? "syncing" : "first_sync",
    hydrated: true,
    hasRemoteChecked: true,
    lastError: undefined,
  });

  const displayName = getProviderDisplayName(profile.provider, profile.baseUrl);
  const existingSync = providerSyncInFlight.get(profileId);
  if (existingSync) {
    if (!options?.silent) {
      logger.providerSync.log(`${displayName} | 已有同步进行中，复用当前任务`);
    }
    return existingSync;
  }

  const syncPromise = (async () => {
    if (!options?.silent) {
      logger.providerSync.banner(
        "Provider 同步开始",
        `${displayName} (${options?.reason || "manual"})`,
      );
    }

    const result = await fetchModelsFromProvider(
      profile.provider,
      profile.baseUrl,
      profile.apiKey,
      profile.name,
      profile.apiKeyGroups,
    );

    const sortedModels = [...result.models]
      .sort((left, right) => comparePublishedAt(left, right))
      .map((model, index) => ({
        ...model,
        sorted: index,
      }));
    const fetchedModels = modelsToCustomModelsString(sortedModels);

    await runWithImmediateStoreSyncPaused(async () => {
      useAppConfig.getState().mergeModels(sortedModels, {
        silent: true,
        allowedProviderIds: [providerId],
      });

      useAccessStore.getState().update((state: any) => {
        state.apiProfiles = (state.apiProfiles || []).map((item: ApiProfile) =>
          item.id === profileId
            ? {
                ...item,
                cachedModels: fetchedModels,
                modelCount: result.total,
              }
            : item,
        );

        if (
          (state.apiProfiles || []).find(
            (item: ApiProfile) => item.id === profileId,
          )?.enabled
        ) {
          // 不再全量覆盖 customModels，只更新模型数据（mergeModels 已处理）
          // customModels 仅由用户手动添加/删除模型时修改
        }
      });

      modelCacheStore.upsertProfileCache(profileId, {
        cachedModels: fetchedModels,
        modelCount: result.total,
        source: "remote",
        syncStatus: "ready",
        hydrated: true,
        hasRemoteChecked: true,
        lastSyncAt: Date.now(),
        lastError: undefined,
      });
    });

    persistAccessSnapshot();

    if (!options?.silent) {
      logger.providerSync.banner(
        "Provider 同步完成",
        `${displayName} 同步完成: ${result.total} 个模型`,
      );
    }

    return {
      ...result,
      models: sortedModels,
    };
  })().finally(() => {
    providerSyncInFlight.delete(profileId);
  });

  providerSyncInFlight.set(profileId, syncPromise);
  return syncPromise;
}

export async function ensureProviderModelsReady(
  profileId: string,
  options?: {
    background?: boolean;
    silent?: boolean;
    reason?: "bootstrap" | "switch" | "manual" | "background";
  },
) {
  const profile = (useAccessStore.getState().apiProfiles || []).find(
    (item) => item.id === profileId,
  ) as ApiProfile | undefined;
  if (!profile) {
    throw new Error(`[Provider Sync] 未找到 profile: ${profileId}`);
  }

  const modelCacheStore = useModelCacheStore.getState() as any;
  const cache = modelCacheStore.profiles?.[profileId];
  const hasCache = Boolean(cache?.cachedModels || profile.cachedModels);
  const displayName = getProviderDisplayName(profile.provider, profile.baseUrl);

  if (hasCache) {
    if (!options?.silent) {
      logger.providerSync.log(
        `${displayName} | 已命中缓存，直接使用本地/数据库缓存`,
      );
    }
    rebuildManagedModelsFromCache();
    modelCacheStore.setProfileSyncState?.(profileId, {
      source: cache?.source || "cache",
      syncStatus: "using_cache",
      hydrated: true,
      lastError: undefined,
    });
  }

  if (!hasCache) {
    if (!options?.silent) {
      logger.providerSync.log(`${displayName} | 首次同步模型`);
    }
    return syncProfileModels(profileId, {
      silent: options?.silent,
      reason: options?.reason || "bootstrap",
    });
  }

  const shouldRefreshRemote =
    options?.reason === "manual" || options?.reason === "bootstrap";

  if (!shouldRefreshRemote) {
    modelCacheStore.setProfileSyncState?.(profileId, {
      syncStatus: "ready",
      source: cache?.source || "cache",
      hydrated: true,
      hasRemoteChecked: Boolean(cache?.hasRemoteChecked),
      lastError: undefined,
    });
    return {
      models: [],
      total: cache?.modelCount || profile.modelCount || 0,
    } satisfies FetchModelsResult;
  }

  const lastSyncAt = Number(cache?.lastSyncAt || 0);
  if (Date.now() - lastSyncAt < PROVIDER_MODEL_SYNC_TTL_MS) {
    modelCacheStore.setProfileSyncState?.(profileId, {
      syncStatus: "ready",
      hydrated: true,
    });
    return {
      models: [],
      total: cache?.modelCount || 0,
    } satisfies FetchModelsResult;
  }

  if (options?.background) {
    if (!options?.silent) {
      logger.providerSync.log(`${displayName} | 后台同步开始`);
    }
    void syncProfileModels(profileId, {
      silent: options?.silent ?? true,
      reason: options?.reason || "background",
    }).catch((error) => {
      modelCacheStore.setProfileSyncState?.(profileId, {
        syncStatus: "error",
        hydrated: true,
        lastError: error instanceof Error ? error.message : "同步失败",
      });
      logger.providerSync.error("后台同步 provider 失败:", error);
    });

    return {
      models: [],
      total: cache?.modelCount || 0,
    } satisfies FetchModelsResult;
  }

  return syncProfileModels(profileId, {
    silent: options?.silent,
    reason: options?.reason || "manual",
  });
}

function getProfileActualCount(profile: Pick<ApiProfile, "provider" | "name">) {
  const providerId = getProfileProviderId(profile).toLowerCase();
  return (useAppConfig.getState().models || []).filter(
    (model) => String(model.provider?.id || "").toLowerCase() === providerId,
  ).length;
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
  void params;

  return runWithBalanceRefreshPaused(() =>
    runWithImmediateStoreSyncPaused(async () => {
      const accessStore = useAccessStore.getState() as any;
      const syncStore = useSyncStore.getState() as any;
      let allProfiles = (useAccessStore.getState().apiProfiles ||
        []) as ApiProfile[];

      if (allProfiles.length === 0) {
        allProfiles = await ensureProfilesLoadedFromDatabase();
      }

      if (allProfiles.length === 0) {
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

      // 只同步用户已添加的模型涉及的 profiles
      const customModels = String(useAppConfig.getState().customModels || "");
      const addedProviderIds = new Set(
        customModels
          .split(",")
          .map((m) => m.trim())
          .filter((m) => m.startsWith("+"))
          .map((m) => {
            const cleaned = m.substring(1);
            const atIdx = cleaned.lastIndexOf("@");
            return atIdx > 0 ? cleaned.substring(atIdx + 1).toLowerCase() : "";
          })
          .filter(Boolean),
      );

      const profiles =
        addedProviderIds.size > 0
          ? allProfiles.filter((p) =>
              addedProviderIds.has(getProfileProviderId(p).toLowerCase()),
            )
          : allProfiles;

      let totalFetched = 0;
      const results: SyncAllProfilesResult["results"] = [];

      for (const profile of profiles) {
        logger.providerSync.banner("Provider 同步开始", profile.name);

        try {
          const result = await syncProfileModels(profile.id, {
            silent: true,
            reason: "manual",
          });

          const mergedCount = getProfileActualCount(profile);
          totalFetched += mergedCount;
          results.push({
            name: profile.name,
            count: mergedCount,
            success: true,
          });

          logger.providerSync.banner(
            "Provider 同步完成",
            `${profile.name} 同步完成: ${mergedCount} 个模型`,
          );
        } catch (error) {
          results.push({
            name: profile.name,
            count: 0,
            success: false,
          });
          logger.providerSync.error(`${profile.name} 获取失败`, error);
        }
      }

      logger.providerSync.log("模型获取完成，等待数据库同步完成...");
      await waitForImmediateStoreSyncQueueIdle();
      await syncStore.sync([...MODEL_SYNC_STORE_KEYS]);

      return {
        totalFetched,
        results,
      } satisfies SyncAllProfilesResult;
    }),
  );
}
