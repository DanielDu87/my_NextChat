type SyncProfileLike = {
  name?: string;
  provider?: string;
};

type SyncModelLike = {
  provider?: {
    id?: string | number;
  };
};

type RemoteProviderLike = {
  profileName?: string;
  fetchedCount?: number;
};

export function describeModelCountDiff(
  localCount: number,
  remoteCount: number,
) {
  const diff = localCount - remoteCount;

  if (diff === 0) {
    return "本地与云端数量一致";
  }

  if (diff > 0) {
    return `本地比云端多 ${diff} 个`;
  }

  return `本地比云端少 ${Math.abs(diff)} 个`;
}

function normalizeManagedProviderId(profile: SyncProfileLike) {
  if (profile.provider === "Custom") {
    return `custom_${String(profile.name || "")}`.toLowerCase();
  }

  if (profile.provider === "Local") {
    const profileName = String(profile.name || "").trim();
    return profileName ? `local_${profileName}`.toLowerCase() : "local";
  }

  return String(profile.provider || "").toLowerCase();
}

export function countCloudMergedModels(
  models: SyncModelLike[],
  profiles: SyncProfileLike[],
): number {
  if (!Array.isArray(models) || !Array.isArray(profiles)) {
    return 0;
  }

  const managedProviderIds = new Set(
    profiles
      .map((profile) => normalizeManagedProviderId(profile))
      .filter(Boolean),
  );

  return models.filter((model) => {
    const providerId = String(model?.provider?.id || "").toLowerCase();
    return providerId && managedProviderIds.has(providerId);
  }).length;
}

export function getCloudMergedPlatformCounts(
  models: SyncModelLike[],
  profiles: SyncProfileLike[],
): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();

  (Array.isArray(models) ? models : []).forEach((model) => {
    const providerId = String(model?.provider?.id || "").toLowerCase();
    if (!providerId) {
      return;
    }

    const profile = (Array.isArray(profiles) ? profiles : []).find(
      (item) => normalizeManagedProviderId(item) === providerId,
    );

    if (profile?.name) {
      counts.set(profile.name, (counts.get(profile.name) ?? 0) + 1);
    }
  });

  return (Array.isArray(profiles) ? profiles : []).map((profile) => ({
    name: String(profile.name || ""),
    count: counts.get(String(profile.name || "")) ?? 0,
  }));
}

export function buildProviderDiffSummaries(
  localProviders: Array<{ name: string; count: number }>,
  remoteProviders: RemoteProviderLike[],
) {
  const remoteCountMap = new Map<string, number>();
  (Array.isArray(remoteProviders) ? remoteProviders : []).forEach(
    (provider) => {
      const name = String(provider.profileName || "");
      if (!name) {
        return;
      }

      remoteCountMap.set(name, Number(provider.fetchedCount) || 0);
    },
  );

  const localCountMap = new Map<string, number>();
  (Array.isArray(localProviders) ? localProviders : []).forEach((provider) => {
    const name = String(provider.name || "");
    if (!name) {
      return;
    }

    localCountMap.set(name, Number(provider.count) || 0);
  });

  const providerNames = [
    ...new Set([...localCountMap.keys(), ...remoteCountMap.keys()]),
  ];

  return providerNames
    .map((name) => {
      const localCount = localCountMap.get(name) ?? 0;
      const remoteCount = remoteCountMap.get(name) ?? 0;

      return {
        name,
        localCount,
        remoteCount,
        diff: localCount - remoteCount,
        description: describeModelCountDiff(localCount, remoteCount),
      };
    })
    .filter((item) => item.diff !== 0)
    .sort(
      (a, b) =>
        Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name),
    );
}
