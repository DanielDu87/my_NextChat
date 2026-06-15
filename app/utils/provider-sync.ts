import { ServiceProvider, StoreKey } from "../constant";
import type { LLMModel } from "../client/api";
import { useAccessStore } from "../store/access";
import { useAppConfig } from "../store/config";
import { useModelCacheStore } from "../store/model-cache";
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
import { writeAccessSnapshot } from "./access-snapshot";
import { rebuildManagedModelsFromCache } from "./managed-model-rebuild";
import { logger } from "./logger";
import { compareModelsForDisplay } from "./model-published-at";

export type ApiProfile = {
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

type FetchFromProvider = (
  provider: ServiceProvider,
  baseUrl?: string,
  apiKey?: string,
  options?: {
    silent?: boolean;
    profileName?: string;
    apiKeyGroups?: Record<string, string>;
    multiKeyGroupOrder?: string[];
    throwOnError?: boolean;
  },
) => Promise<FetchModelsResult>;

type SyncAllProfilesResult = {
  totalFetched: number;
  results: Array<{
    name: string;
    count: number;
    added: number;
    deleted: number;
    finalCount: number;
    success: boolean;
  }>;
};

const PROVIDER_MODEL_SYNC_TTL_MS = 5 * 60 * 1000;
const providerSyncInFlight = new Map<string, Promise<FetchModelsResult>>();

function getProfileModelKeySet(
  profile: Pick<ApiProfile, "provider" | "name">,
  models: LLMModel[] = [],
) {
  const providerId = getProfileProviderId(profile).toLowerCase();
  return new Set(
    models
      .filter(
        (model) =>
          String(model.provider?.id || "").toLowerCase() === providerId,
      )
      .map((model) => `${model.name}@${providerId}`),
  );
}

function getProfileModelSyncStats(
  profile: Pick<ApiProfile, "provider" | "name">,
  beforeModels: LLMModel[],
  afterModels: LLMModel[],
) {
  const beforeKeys = getProfileModelKeySet(profile, beforeModels);
  const afterKeys = getProfileModelKeySet(profile, afterModels);
  const added = [...afterKeys].filter((key) => !beforeKeys.has(key)).length;
  const deleted = [...beforeKeys].filter((key) => !afterKeys.has(key)).length;

  return {
    added,
    deleted,
    finalCount: afterKeys.size,
  };
}

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
      profile.multiKeyGroupOrder,
    );

    const sortedModels = [...result.models]
      .sort((left, right) => compareModelsForDisplay(left, right))
      .map((model, index) => ({
        ...model,
        sorted: index,
      }));
    const fetchedModels = modelsToCustomModelsString(sortedModels);

    // 记录合并前的模型名集合，用于计算 diff
    const beforeModels = useAppConfig.getState().models || [];
    const beforeNames = new Set(
      beforeModels
        .filter(
          (m) => String(m.provider?.id || "").toLowerCase() === providerId,
        )
        .map((m) => m.name)
        .filter(Boolean),
    );

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

    // 计算合并后的模型 diff
    const afterModels = useAppConfig.getState().models || [];
    const afterNames = new Set(
      afterModels
        .filter(
          (m) => String(m.provider?.id || "").toLowerCase() === providerId,
        )
        .map((m) => m.name)
        .filter(Boolean),
    );
    const added = [...afterNames].filter((n) => !beforeNames.has(n));
    const deleted = [...beforeNames].filter((n) => !afterNames.has(n));

    persistAccessSnapshot();

    console.log(
      `[Provider Sync] ✅ ${displayName}: 新增 ${added.length} 个，删除 ${deleted.length} 个，本地可用 ${afterNames.size} 个模型`,
    );
    if (added.length > 0) {
      console.log(
        `[Provider Sync] ➕ ${displayName} 新增: ${added.join("、")}`,
      );
    }
    if (deleted.length > 0) {
      console.log(
        `[Provider Sync] ➖ ${displayName} 删除: ${deleted.join("、")}`,
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

  return runWithImmediateStoreSyncPaused(async () => {
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
        : [];

    let totalFetched = 0;
    const results: SyncAllProfilesResult["results"] = [];

    if (profiles.length === 0) {
      logger.providerSync.log("没有用户手动添加模型，跳过供应商全量模型拉取");
    }

    for (const profile of profiles) {
      logger.providerSync.banner("Provider 同步开始", profile.name);

      try {
        const beforeModels = useAppConfig.getState().models || [];
        await syncProfileModels(profile.id, {
          silent: true,
          reason: "manual",
        });

        const afterModels = useAppConfig.getState().models || [];
        const syncStats = getProfileModelSyncStats(
          profile,
          beforeModels,
          afterModels,
        );
        const mergedCount = syncStats.finalCount;
        totalFetched += mergedCount;
        results.push({
          name: profile.name,
          count: mergedCount,
          added: syncStats.added,
          deleted: syncStats.deleted,
          finalCount: syncStats.finalCount,
          success: true,
        });

        logger.providerSync.banner(
          "Provider 同步完成",
          `${profile.name} 本次新增 ${syncStats.added} 个，删除 ${syncStats.deleted} 个，本地可用 ${syncStats.finalCount} 个模型`,
        );
      } catch (error) {
        results.push({
          name: profile.name,
          count: 0,
          added: 0,
          deleted: 0,
          finalCount: 0,
          success: false,
        });
        logger.providerSync.error(`${profile.name} 获取失败`, error);
      }
    }

    logger.providerSync.log("本地远程模型检查完成，正在同步数据库配置...");
    await waitForImmediateStoreSyncQueueIdle();
    await syncStore.sync([...MODEL_SYNC_STORE_KEYS]);

    return {
      totalFetched,
      results,
    } satisfies SyncAllProfilesResult;
  });
}
