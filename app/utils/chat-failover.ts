import type { LLMModel } from "../client/api";
import { ServiceProvider } from "../constant";
import {
  compareModelsWithinSeries,
  getModelDisplaySeries,
} from "./model-series-order";

type AccessProfileLike = {
  id?: string;
  name: string;
  provider: ServiceProvider;
  baseUrl?: string;
  apiKey?: string;
  apiKeyGroups?: Record<string, string>;
  openAICompatible?: boolean;
};

type FailoverModel = Pick<
  LLMModel,
  | "name"
  | "displayName"
  | "available"
  | "category"
  | "categories"
  | "type"
  | "types"
  | "features"
  | "capabilities"
  | "publishedAt"
> & {
  provider?: LLMModel["provider"];
};

export type ChatFailoverCandidate = {
  model: string;
  displayName: string;
  providerName: ServiceProvider;
  providerId: string;
  providerDisplayName: string;
  publishedAt?: number;
  profile?: AccessProfileLike;
};

const nameCollator = new Intl.Collator("zh-CN-u-co-pinyin", {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

export function getChatModelSeries(model: {
  name?: string;
  model?: string;
  displayName?: string;
}) {
  return getModelDisplaySeries(model);
}

function getProfileProviderId(profile: AccessProfileLike) {
  if (profile.provider === ServiceProvider.Custom) {
    return `custom_${profile.name}`.toLowerCase();
  }
  if (profile.provider === ServiceProvider.Local) {
    return `local_${profile.name}`.toLowerCase();
  }
  return String(profile.provider).toLowerCase();
}

export function buildChatFailoverCandidates(
  allModels: FailoverModel[],
  profiles: AccessProfileLike[],
  current: {
    model: string;
    providerName: ServiceProvider;
    providerId?: string;
    profileId?: string;
    providerDisplayName?: string;
  },
): ChatFailoverCandidate[] {
  const normalizedCurrentProviderId = String(current.providerId || "")
    .trim()
    .toLowerCase();
  const currentProfile = profiles.find((profile) => {
    if (current.profileId && profile.id === current.profileId) {
      return true;
    }
    return (
      normalizedCurrentProviderId &&
      getProfileProviderId(profile) === normalizedCurrentProviderId
    );
  });
  const currentProviderId =
    normalizedCurrentProviderId ||
    (currentProfile
      ? getProfileProviderId(currentProfile)
      : String(current.providerName).toLowerCase());

  const candidateByKey = new Map<string, ChatFailoverCandidate>();
  for (const model of allModels) {
    if (!model.available || !model.name) continue;

    const providerId = String(model.provider?.id || "")
      .trim()
      .toLowerCase();
    const providerName = model.provider?.providerName as
      | ServiceProvider
      | undefined;
    if (!providerId || !providerName) continue;

    const profile = profiles.find(
      (item) => getProfileProviderId(item) === providerId,
    );
    if (providerName === ServiceProvider.Custom && !profile?.baseUrl) {
      continue;
    }
    if (!profile && providerId !== currentProviderId) {
      continue;
    }

    candidateByKey.set(`${providerId}\u0000${model.name}`, {
      model: model.name,
      displayName: model.displayName || model.name,
      providerName,
      providerId,
      providerDisplayName: profile?.name || String(providerName),
      publishedAt: model.publishedAt,
      profile,
    });
  }

  const currentModelCandidate =
    candidateByKey.get(`${currentProviderId}\u0000${current.model}`) ||
    ({
      model: current.model,
      displayName: current.model,
      providerName: current.providerName,
      providerId: currentProviderId,
      providerDisplayName:
        current.providerDisplayName ||
        currentProfile?.name ||
        String(current.providerName),
      profile: currentProfile,
    } satisfies ChatFailoverCandidate);

  const grouped = new Map<string, ChatFailoverCandidate[]>();
  for (const candidate of candidateByKey.values()) {
    if (
      candidate.providerId === currentProviderId &&
      candidate.model === current.model
    ) {
      continue;
    }
    const group = grouped.get(candidate.providerId) || [];
    group.push(candidate);
    grouped.set(candidate.providerId, group);
  }

  for (const group of grouped.values()) {
    group.sort((left, right) => nameCollator.compare(left.model, right.model));
  }

  const currentSeries = getChatModelSeries(currentModelCandidate);
  const sameSeriesCandidates = currentSeries
    ? [...grouped.values()]
        .flat()
        .filter((candidate) => getChatModelSeries(candidate) === currentSeries)
        .sort((left, right) => {
          const versionDiff = compareModelsWithinSeries(left, right);
          if (versionDiff !== 0) return versionDiff;
          if (left.providerId === currentProviderId) return -1;
          if (right.providerId === currentProviderId) return 1;
          const providerDiff = nameCollator.compare(
            left.providerDisplayName,
            right.providerDisplayName,
          );
          return providerDiff || nameCollator.compare(left.model, right.model);
        })
    : [];
  const sameSeriesKeys = new Set(
    sameSeriesCandidates.map(
      (candidate) => `${candidate.providerId}\u0000${candidate.model}`,
    ),
  );
  for (const [providerId, group] of grouped) {
    grouped.set(
      providerId,
      group.filter(
        (candidate) =>
          !sameSeriesKeys.has(
            `${candidate.providerId}\u0000${candidate.model}`,
          ),
      ),
    );
  }

  const currentProviderCandidates = grouped.get(currentProviderId) || [];
  grouped.delete(currentProviderId);
  const otherProviderCandidates = [...grouped.values()]
    .sort((left, right) =>
      nameCollator.compare(
        left[0]?.providerDisplayName || "",
        right[0]?.providerDisplayName || "",
      ),
    )
    .flat();

  return [
    currentModelCandidate,
    ...sameSeriesCandidates,
    ...currentProviderCandidates,
    ...otherProviderCandidates,
  ];
}
