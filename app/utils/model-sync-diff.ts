import type { LLMModel } from "../client/api";

export type ModelSyncPlatformDiff = {
  providerId: string;
  providerName: string;
  added: string[];
  deleted: string[];
  finalCount: number;
};

export type ModelSyncDiffRecord = {
  createdAt: number;
  platforms: ModelSyncPlatformDiff[];
};

type CustomModelSnapshotEntry = {
  name: string;
  providerId: string;
  providerName: string;
};

const MODEL_SYNC_DIFF_TTL_MS = 30_000;
const MODEL_SYNC_CUSTOM_SNAPSHOT_KEY = "nextchat-model-sync-custom-snapshot";
const pendingModelSyncDiffRecords: ModelSyncDiffRecord[] = [];

function normalizeProviderId(providerId?: string) {
  return String(providerId || "")
    .trim()
    .toLowerCase();
}

function getModelProviderId(model: LLMModel) {
  return normalizeProviderId(model.provider?.id);
}

function getModelProviderName(model?: LLMModel) {
  return String(
    model?.provider?.providerName || model?.provider?.id || "未知平台",
  );
}

function buildModelNameSet(models: LLMModel[], providerId: string) {
  return new Set(
    models
      .filter((model) => getModelProviderId(model) === providerId)
      .map((model) => model.name)
      .filter(Boolean),
  );
}

function pruneExpiredRecords(now = Date.now()) {
  while (
    pendingModelSyncDiffRecords.length > 0 &&
    now - pendingModelSyncDiffRecords[0].createdAt > MODEL_SYNC_DIFF_TTL_MS
  ) {
    pendingModelSyncDiffRecords.shift();
  }
}

export function recordModelSyncDiff(
  beforeModels: LLMModel[],
  afterModels: LLMModel[],
  providerIds: Iterable<string>,
) {
  const normalizedProviderIds = [...providerIds]
    .map(normalizeProviderId)
    .filter(Boolean);
  if (normalizedProviderIds.length === 0) {
    return;
  }

  const platforms = normalizedProviderIds
    .map((providerId) => {
      const beforeNames = buildModelNameSet(beforeModels, providerId);
      const afterNames = buildModelNameSet(afterModels, providerId);
      const added = [...afterNames].filter((name) => !beforeNames.has(name));
      const deleted = [...beforeNames].filter((name) => !afterNames.has(name));
      const providerName = getModelProviderName(
        afterModels.find((model) => getModelProviderId(model) === providerId) ||
          beforeModels.find(
            (model) => getModelProviderId(model) === providerId,
          ),
      );

      return {
        providerId,
        providerName,
        added,
        deleted,
        finalCount: afterNames.size,
      };
    })
    .filter(
      (platform) => platform.added.length > 0 || platform.deleted.length > 0,
    );

  if (platforms.length === 0) {
    return;
  }

  const now = Date.now();
  pruneExpiredRecords(now);
  pendingModelSyncDiffRecords.push({
    createdAt: now,
    platforms,
  });
}

export function consumeRecentModelSyncDiff() {
  pruneExpiredRecords();
  if (pendingModelSyncDiffRecords.length === 0) {
    return [];
  }

  const records = pendingModelSyncDiffRecords.splice(
    0,
    pendingModelSyncDiffRecords.length,
  );
  const platformMap = new Map<string, ModelSyncPlatformDiff>();

  records.forEach((record) => {
    record.platforms.forEach((platform) => {
      const current = platformMap.get(platform.providerId);
      if (!current) {
        platformMap.set(platform.providerId, {
          ...platform,
          added: [...platform.added],
          deleted: [...platform.deleted],
        });
        return;
      }

      current.added = [...new Set([...current.added, ...platform.added])];
      current.deleted = [...new Set([...current.deleted, ...platform.deleted])];
      current.finalCount = platform.finalCount;
    });
  });

  return [...platformMap.values()];
}

function parseCustomModelSnapshot(
  customModels: string,
  resolveProviderName?: (providerId: string) => string | undefined,
) {
  return String(customModels || "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.startsWith("+"))
    .map((model): CustomModelSnapshotEntry | undefined => {
      const nameConfig = model.slice(1);
      const [modelWithProvider] = nameConfig.split("=");
      const atIdx = modelWithProvider.lastIndexOf("@");
      if (atIdx <= 0) {
        return undefined;
      }

      const name = modelWithProvider.substring(0, atIdx).trim();
      const providerId = normalizeProviderId(
        modelWithProvider.substring(atIdx + 1),
      );
      if (!name || !providerId) {
        return undefined;
      }

      return {
        name,
        providerId,
        providerName: resolveProviderName?.(providerId) || providerId,
      };
    })
    .filter(Boolean) as CustomModelSnapshotEntry[];
}

function buildCustomModelPlatformDiffs(
  beforeEntries: CustomModelSnapshotEntry[],
  afterEntries: CustomModelSnapshotEntry[],
) {
  const providerIds = new Set([
    ...beforeEntries.map((entry) => entry.providerId),
    ...afterEntries.map((entry) => entry.providerId),
  ]);

  return [...providerIds]
    .map((providerId) => {
      const beforeNames = new Set(
        beforeEntries
          .filter((entry) => entry.providerId === providerId)
          .map((entry) => entry.name),
      );
      const afterNames = new Set(
        afterEntries
          .filter((entry) => entry.providerId === providerId)
          .map((entry) => entry.name),
      );
      const providerName =
        afterEntries.find((entry) => entry.providerId === providerId)
          ?.providerName ||
        beforeEntries.find((entry) => entry.providerId === providerId)
          ?.providerName ||
        providerId;

      return {
        providerId,
        providerName,
        added: [...afterNames].filter((name) => !beforeNames.has(name)),
        deleted: [...beforeNames].filter((name) => !afterNames.has(name)),
        finalCount: afterNames.size,
      };
    })
    .filter(
      (platform) => platform.added.length > 0 || platform.deleted.length > 0,
    );
}

function readStoredCustomModelSnapshot() {
  if (typeof localStorage === "undefined") {
    return undefined;
  }

  try {
    const raw = localStorage.getItem(MODEL_SYNC_CUSTOM_SNAPSHOT_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? (parsed as CustomModelSnapshotEntry[])
      : undefined;
  } catch {
    return undefined;
  }
}

export function buildCustomModelSyncDiffFromLastSnapshot(
  customModels: string,
  resolveProviderName?: (providerId: string) => string | undefined,
) {
  const previousEntries = readStoredCustomModelSnapshot();
  const nextEntries = parseCustomModelSnapshot(
    customModels,
    resolveProviderName,
  );
  if (!previousEntries) {
    return [];
  }

  return buildCustomModelPlatformDiffs(previousEntries, nextEntries);
}

export function buildCustomModelSyncDiffBetween(
  previousCustomModels: string,
  nextCustomModels: string,
  resolveProviderName?: (providerId: string) => string | undefined,
) {
  return buildCustomModelPlatformDiffs(
    parseCustomModelSnapshot(previousCustomModels, resolveProviderName),
    parseCustomModelSnapshot(nextCustomModels, resolveProviderName),
  );
}

export function saveCustomModelSyncSnapshot(
  customModels: string,
  resolveProviderName?: (providerId: string) => string | undefined,
) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(
      MODEL_SYNC_CUSTOM_SNAPSHOT_KEY,
      JSON.stringify(
        parseCustomModelSnapshot(customModels, resolveProviderName),
      ),
    );
  } catch {}
}
