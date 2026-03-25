import { ServiceProvider, StoreKey } from "@/app/constant";
import {
  buildPersistedStoreState,
  unwrapPersistedStoreState,
} from "@/app/utils/sync-store-keys";
import {
  fetchModelsFromProviderForServer,
  modelsToCustomModelsString,
  type SyncedLLMModel,
} from "@/app/utils/server/provider-model-fetch";
import {
  getTodayPublishedAt,
  normalizePublishedAt,
} from "@/app/utils/model-published-at";
import {
  type ModelCatalogUpsertRow,
  upsertModelCatalogRows,
} from "./model-catalog-repository";
import { ensureSyncStorageSchema, pgQuery } from "./postgres";
import { setLatestModelRefreshState } from "./model-refresh-state-repository";
import { getStoreSnapshot, setStoreSnapshot } from "./sync-store-repository";
import { getDefaultSyncUserId } from "./sync-user";

const LEGACY_UNKNOWN_MODEL_PUBLISHED_AT = 20260101;
const LEGACY_UNKNOWN_MODEL_CUTOFF = 20260325;

type AccessProfile = {
  id: string;
  name: string;
  provider: ServiceProvider;
  baseUrl: string;
  apiKey: string;
  balanceQueryApiKey?: string;
  apiKeyGroups?: Record<string, string>;
  enabled: boolean;
  openAICompatible?: boolean;
  cachedModels?: string;
  modelCount?: number;
};

type AccessState = {
  apiProfiles?: AccessProfile[];
  [key: string]: unknown;
};

type AppConfigState = {
  models?: SyncedLLMModel[];
  [key: string]: unknown;
};

type ModelCacheState = {
  profiles?: Record<
    string,
    {
      profileId: string;
      cachedModels: string;
      modelCount: number;
      updatedAt: number;
      lastError?: string;
    }
  >;
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
  runId: string;
};

function toIsoNow() {
  return new Date().toISOString();
}

function normalizeProviderId(
  profile: Pick<AccessProfile, "provider" | "name">,
) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`
    : String(profile.provider).toLowerCase();
}

function getManagedCloudCount(models: SyncedLLMModel[], providerId: string) {
  const normalizedProviderId = providerId.toLowerCase();
  return models.filter(
    (model) =>
      String(model.provider?.id || "").toLowerCase() === normalizedProviderId,
  ).length;
}

function mergeProviderModels(
  existingModels: SyncedLLMModel[],
  nextModels: SyncedLLMModel[],
  providerIds: string[],
) {
  const blockedProviderIds = new Set(providerIds.map((id) => id.toLowerCase()));
  const mergedModelMap = new Map<string, SyncedLLMModel>();

  existingModels.forEach((model) => {
    const providerId = String(model.provider?.id || "").toLowerCase();
    if (blockedProviderIds.has(providerId)) {
      return;
    }
    mergedModelMap.set(`${model.name}@${providerId}`, model);
  });

  nextModels.forEach((model) => {
    const providerId = String(model.provider?.id || "").toLowerCase();
    const existing =
      mergedModelMap.get(`${model.name}@${providerId}`) ||
      existingModels.find(
        (item) =>
          `${item.name}@${String(item.provider?.id || "").toLowerCase()}` ===
          `${model.name}@${providerId}`,
      );
    const existingPublishedAt = normalizePublishedAt(existing?.publishedAt);
    const nextPublishedAt = normalizePublishedAt(model.publishedAt);
    const nextModel: SyncedLLMModel = {
      ...model,
      available: true,
    };

    if (
      existingPublishedAt &&
      (!nextPublishedAt || existing?.publishedAtSource === "manual")
    ) {
      if (
        existing?.publishedAtSource === "synced_at" &&
        existingPublishedAt < LEGACY_UNKNOWN_MODEL_CUTOFF &&
        !nextPublishedAt
      ) {
        nextModel.publishedAt = LEGACY_UNKNOWN_MODEL_PUBLISHED_AT;
        nextModel.publishedAtSource = "synced_at";
        nextModel.publishedAtUrl = undefined;
        nextModel.publishedAtNote =
          "历史缺少明确发布日期的模型统一回退到 2026-01-01";
      } else {
        nextModel.publishedAt = existingPublishedAt;
        nextModel.publishedAtSource = existing?.publishedAtSource;
        nextModel.publishedAtUrl =
          typeof existing?.publishedAtUrl === "string"
            ? existing.publishedAtUrl
            : undefined;
        nextModel.publishedAtNote =
          typeof existing?.publishedAtNote === "string"
            ? existing.publishedAtNote
            : undefined;
      }
    } else if (!existing && !nextPublishedAt) {
      nextModel.publishedAt = getTodayPublishedAt();
      nextModel.publishedAtSource = "synced_at";
      nextModel.publishedAtNote =
        nextModel.publishedAtNote || "缺少明确发布日期时按首次同步日期兜底";
    }

    mergedModelMap.set(`${model.name}@${providerId}`, nextModel);
  });

  return [...mergedModelMap.values()];
}

function toCatalogRows(
  profile: AccessProfile,
  models: SyncedLLMModel[],
): ModelCatalogUpsertRow[] {
  return models.map((model) => ({
    providerId: String(model.provider?.id || normalizeProviderId(profile)),
    providerName: profile.name,
    sourceFile: `provider:${profile.id}`,
    modelName: model.name,
    displayName: model.displayName ?? model.name,
    vendorName: model.vendor?.name,
    vendorIcon: model.vendor?.icon,
    modelType: model.type,
    category: model.category,
    categorySource: model.categorySource,
    types: model.types,
    categories: model.categories,
    features: model.features,
    capabilities: model.capabilities,
    publishedAtInt: model.publishedAt,
    publishedAtSource: model.publishedAtSource,
    publishedAtUrl: model.publishedAtUrl,
    publishedAtNote: model.publishedAtNote,
    apiKeyGroup: model.apiKeyGroup,
    sortOrder: model.sorted,
    isAvailable: model.available,
    rawPayload: model,
  }));
}

async function getCloudAccessState(userId: string) {
  const payload = await getStoreSnapshot(StoreKey.Access, userId);
  return unwrapPersistedStoreState<AccessState | null>(payload) || {};
}

async function getCloudAppConfigState(userId: string) {
  const payload = await getStoreSnapshot(StoreKey.Config, userId);
  return unwrapPersistedStoreState<AppConfigState | null>(payload) || {};
}

function shouldSyncProfile(profile: AccessProfile) {
  return Boolean(
    profile.id && profile.name && profile.baseUrl && profile.apiKey,
  );
}

async function createRun(triggerSource: string) {
  const result = await pgQuery<{ id: string }>(
    `insert into model_sync_runs (trigger_source, provider_id, status, summary_json, started_at)
     values ($1, $2, $3, $4::jsonb, now())
     returning id::text as id`,
    [
      triggerSource,
      "configured_profiles",
      "running",
      JSON.stringify({ source: "provider-auto-refresh" }),
    ],
  );

  return result.rows[0].id;
}

async function finishRun(
  runId: string,
  status: "completed" | "failed",
  summary: unknown,
  errorMessage?: string,
) {
  await pgQuery(
    `update model_sync_runs
     set status = $2,
         summary_json = $3::jsonb,
         error_message = $4,
         finished_at = now()
     where id = $1::uuid`,
    [runId, status, JSON.stringify(summary), errorMessage ?? null],
  );
}

export async function refreshConfiguredProviderModels(
  triggerSource = "manual",
  userId = getDefaultSyncUserId(),
): Promise<RefreshConfiguredProviderModelsResult> {
  await ensureSyncStorageSchema();
  const runId = await createRun(triggerSource);

  try {
    const accessState = await getCloudAccessState(userId);
    const appConfigState = await getCloudAppConfigState(userId);
    const profiles = (accessState.apiProfiles || []).filter(shouldSyncProfile);

    const existingModels = Array.isArray(appConfigState.models)
      ? appConfigState.models
      : [];
    const fetchedModels: SyncedLLMModel[] = [];
    const summaries: ProviderRefreshSummary[] = [];

    for (const profile of profiles) {
      const providerId = normalizeProviderId(profile);
      const result = await fetchModelsFromProviderForServer(
        profile.provider,
        profile.baseUrl,
        profile.apiKey,
        profile.name,
        profile.apiKeyGroups,
        profile.balanceQueryApiKey,
      );

      fetchedModels.push(...result.models);
      summaries.push({
        profileId: profile.id,
        profileName: profile.name,
        provider: profile.provider,
        providerId,
        fetchedCount: result.models.length,
        previousCloudCount: getManagedCloudCount(existingModels, providerId),
        mergedCount: result.models.length,
        updatedAt: toIsoNow(),
      });

      if (result.models.length > 0) {
        await upsertModelCatalogRows(toCatalogRows(profile, result.models));
      }
    }

    const mergedModels = mergeProviderModels(
      existingModels,
      fetchedModels,
      summaries.map((item) => item.providerId),
    );

    const nextProfiles = (accessState.apiProfiles || []).map((profile) => {
      const matched = summaries.find((item) => item.profileId === profile.id);
      if (!matched) return profile;
      return { ...profile };
    });

    const modelCacheSnapshot = await getStoreSnapshot(
      StoreKey.ModelCache,
      userId,
    );
    const modelCacheState = unwrapPersistedStoreState<ModelCacheState>(
      modelCacheSnapshot,
    ) ?? { profiles: {} };
    const nextModelCacheProfiles = { ...(modelCacheState.profiles || {}) };

    summaries.forEach((item) => {
      const profileModels = fetchedModels.filter(
        (model) =>
          String(model.provider?.id || "").toLowerCase() ===
          item.providerId.toLowerCase(),
      );

      nextModelCacheProfiles[item.profileId] = {
        profileId: item.profileId,
        cachedModels: modelsToCustomModelsString(profileModels),
        modelCount: profileModels.length,
        updatedAt: Date.now(),
      };
    });

    await setStoreSnapshot(
      StoreKey.Config,
      buildPersistedStoreState(StoreKey.Config, {
        ...appConfigState,
        models: mergedModels,
      }),
      userId,
    );

    await setStoreSnapshot(
      StoreKey.Access,
      buildPersistedStoreState(StoreKey.Access, {
        ...accessState,
        apiProfiles: nextProfiles,
      }),
      userId,
    );

    await setStoreSnapshot(
      StoreKey.ModelCache,
      buildPersistedStoreState(StoreKey.ModelCache, {
        ...modelCacheState,
        profiles: nextModelCacheProfiles,
      }),
      userId,
    );

    // 计算各平台数量相加的总数（不去重）
    const totalCount = summaries.reduce(
      (sum, item) => sum + item.fetchedCount,
      0,
    );

    const summary = {
      profileCount: summaries.length,
      modelCount: totalCount,
      providers: summaries,
      updatedStoreKeys: [StoreKey.Config, StoreKey.Access, StoreKey.ModelCache],
    };

    // 保存模型刷新记录到数据库
    await setLatestModelRefreshState(userId, {
      ...summary,
      triggerSource,
      finishedAt: toIsoNow(),
    });

    await finishRun(runId, "completed", summary);

    return {
      ok: true,
      ...summary,
      runId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishRun(
      runId,
      "failed",
      { ok: false, error: message, triggerSource },
      message,
    );
    throw error;
  }
}
