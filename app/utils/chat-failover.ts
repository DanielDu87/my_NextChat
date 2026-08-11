import type { LLMModel } from "../client/api";
import { ServiceProvider } from "../constant";
import { getModelDisplayGroup } from "./model-display-group";
import {
  compareModelsBySeriesVersion,
  compareProviderDisplayNames,
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
  | "vendor"
> & {
  provider?: LLMModel["provider"];
};

export type ChatFailoverCandidate = {
  model: string;
  displayName: string;
  providerName: ServiceProvider;
  providerId: string;
  providerDisplayName: string;
  vendorGroup: string;
  publishedAt?: number;
  profile?: AccessProfileLike;
};

const PROVIDER_BALANCE_FAILURE_PATTERNS = [
  /insufficient[_\s-]*(?:balance|quota|credit|funds?)/i,
  /(?:balance|quota|credits?|funds?)[_\s-]*(?:is[_\s-]*)?(?:insufficient|exhausted|depleted|too low)/i,
  /(?:out of|no)\s+(?:balance|quota|credits?|funds?)/i,
  /(?:billing|payment)[_\s-]*(?:not[_\s-]*)?(?:active|required)/i,
  /(?:余额|额度|配额|点数|积分)(?:不足|已用完|耗尽|不足以)/,
  /(?:账户|账号).{0,8}(?:欠费|余额不足|额度不足)/,
  /请.{0,6}(?:充值|续费)/,
];

export function isProviderBalanceFailure(
  reason: unknown,
  responseStatus?: number,
) {
  if (responseStatus === 402) {
    return true;
  }

  const text = String(
    reason instanceof Error ? reason.message : reason || "",
  ).trim();
  return PROVIDER_BALANCE_FAILURE_PATTERNS.some((pattern) =>
    pattern.test(text),
  );
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
    displayName?: string;
    providerName: ServiceProvider;
    providerId?: string;
    profileId?: string;
    providerDisplayName?: string;
    /** 当前供应商在配置页已添加的模型；未提供时仅保留当前模型。 */
    allowedFallbackModelNames?: ReadonlySet<string>;
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
    const modelProviderName = model.provider?.providerName as
      ServiceProvider | undefined;
    if (!providerId || !modelProviderName) continue;

    const profile = profiles.find(
      (item) => getProfileProviderId(item) === providerId,
    );
    const providerName = profile?.provider || modelProviderName;
    if (providerName === ServiceProvider.Custom && !profile?.baseUrl) {
      continue;
    }
    // 故障转移绝不跨供应商，并且只使用当前供应商在配置页已添加的模型。
    if (
      providerId !== currentProviderId ||
      !current.allowedFallbackModelNames?.has(model.name)
    ) {
      continue;
    }

    candidateByKey.set(`${providerId}\u0000${model.name}`, {
      model: model.name,
      displayName: model.displayName || model.name,
      providerName,
      providerId,
      providerDisplayName: profile?.name || String(providerName),
      vendorGroup: getModelDisplayGroup({
        modelName: model.name,
        displayName: model.displayName,
        vendorName: model.vendor?.name,
        vendorId: model.vendor?.id,
        providerName: profile?.name || String(providerName),
      }),
      publishedAt: model.publishedAt,
      profile,
    });
  }

  const currentModelCandidate =
    candidateByKey.get(`${currentProviderId}\u0000${current.model}`) ||
    ({
      model: current.model,
      // 优先使用用户选择的 displayName，保持与模型选择器一致
      displayName: current.displayName || current.model,
      providerName: current.providerName,
      providerId: currentProviderId,
      providerDisplayName:
        current.providerDisplayName ||
        currentProfile?.name ||
        String(current.providerName),
      vendorGroup: getModelDisplayGroup({
        modelName: current.model,
        displayName: current.displayName,
        providerName:
          current.providerDisplayName ||
          currentProfile?.name ||
          String(current.providerName),
      }),
      profile: currentProfile,
    } satisfies ChatFailoverCandidate);

  const currentProviderCandidates: ChatFailoverCandidate[] = [];

  for (const candidate of candidateByKey.values()) {
    if (
      candidate.providerId === currentProviderId &&
      candidate.model === current.model
    ) {
      continue;
    }
    currentProviderCandidates.push(candidate);
  }

  const sortModels = (candidates: ChatFailoverCandidate[]) =>
    candidates.sort(compareModelsBySeriesVersion);
  const groupByVendor = (candidates: ChatFailoverCandidate[]) => {
    const groups = new Map<string, ChatFailoverCandidate[]>();
    for (const candidate of candidates) {
      const group = groups.get(candidate.vendorGroup) || [];
      group.push(candidate);
      groups.set(candidate.vendorGroup, group);
    }
    return groups;
  };
  const flattenVendorGroups = (candidates: ChatFailoverCandidate[]) => {
    return [...groupByVendor(candidates)]
      .sort(([left], [right]) => compareProviderDisplayNames(left, right))
      .flatMap(([, models]) => sortModels(models));
  };

  const currentVendorCandidates: ChatFailoverCandidate[] = [];
  const currentProviderOtherVendors: ChatFailoverCandidate[] = [];
  for (const candidate of currentProviderCandidates) {
    if (candidate.vendorGroup === currentModelCandidate.vendorGroup) {
      currentVendorCandidates.push(candidate);
    } else {
      currentProviderOtherVendors.push(candidate);
    }
  }

  return [
    currentModelCandidate,
    ...sortModels(currentVendorCandidates),
    ...flattenVendorGroups(currentProviderOtherVendors),
  ];
}
