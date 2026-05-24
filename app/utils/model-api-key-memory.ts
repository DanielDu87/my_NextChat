import type { LLMModel } from "@/app/client/api";
import { ServiceProvider } from "@/app/constant";
import { useAppConfig } from "@/app/store/config";
import { useAccessStore } from "@/app/store/access";
import { runWithImmediateStoreSyncPaused } from "@/app/utils/store";

type CustomProfile = {
  id: string;
  name: string;
  provider: ServiceProvider;
  baseUrl: string;
  apiKey: string;
  apiKeyGroups?: Record<string, string>;
  enabled: boolean;
};

export function getYutoFallbackGroupOrder(modelName: string) {
  const lowerModelName = modelName.toLowerCase();
  if (lowerModelName.startsWith("claude")) {
    return ["anthropic", "enterprise", "discount", "user", "default"];
  }
  return ["enterprise", "discount", "user", "anthropic", "default"];
}

export function getOcoolFallbackGroupOrder(modelName: string) {
  const lowerModelName = modelName.toLowerCase();

  if (lowerModelName.startsWith("claude")) {
    return ["default", "official", "cc", "cn", "open_source_cn"];
  }

  return ["default", "official", "open_source_cn", "cn", "cc"];
}

export function isYutoApiBaseUrl(baseUrl?: string) {
  if (!baseUrl) return false;

  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "cn.gptapi.asia" || hostname === "gptapi.asia";
  } catch {
    return false;
  }
}

export function isOcoolaiBaseUrl(baseUrl?: string) {
  if (!baseUrl) return false;

  try {
    const hostname = new URL(baseUrl).hostname;
    return (
      hostname === "one.ocoolai.com" ||
      hostname === "ocoolai.com" ||
      hostname === "one.ooo.cool"
    );
  } catch {
    return false;
  }
}

export function supportsApiKeyGroupingForProfile(
  profile?: Pick<CustomProfile, "baseUrl">,
) {
  return (
    isYutoApiBaseUrl(profile?.baseUrl) || isOcoolaiBaseUrl(profile?.baseUrl)
  );
}

// 保留旧的函数名作为兼容
export const isRememberedApiKeyProfile = supportsApiKeyGroupingForProfile;

function getProviderIdForProfile(profile: Pick<CustomProfile, "name">) {
  return `custom_${profile.name}`.toLowerCase();
}

export function getCustomModelApiKeySelection(
  modelName: string,
  profile: CustomProfile | undefined,
  models: LLMModel[],
) {
  if (!profile) {
    const accessStore = useAccessStore.getState();
    return {
      current: accessStore.customApiKey,
      fallback: [] as string[],
      fallbackGroups: [] as string[],
    };
  }

  const groupedKeys = profile.apiKeyGroups || {};
  const matchedModel = models.find(
    (model) =>
      model.name === modelName &&
      model.provider?.id === getProviderIdForProfile(profile),
  );

  console.log("[API Key Memory] 查找模型记忆", {
    modelName,
    providerId: getProviderIdForProfile(profile),
    matchedModel: matchedModel
      ? {
          name: matchedModel.name,
          apiKeyGroup: matchedModel.apiKeyGroup,
        }
      : null,
  });

  const groupOrder = isOcoolaiBaseUrl(profile.baseUrl)
    ? getOcoolFallbackGroupOrder(modelName)
    : getYutoFallbackGroupOrder(modelName);

  const fallbackApiKeys: string[] = [];
  const fallbackApiKeyGroups: string[] = [];

  const pushFallbackKey = (groupName: string, key: string | undefined) => {
    const normalizedKey = key?.trim();
    if (!normalizedKey || fallbackApiKeys.includes(normalizedKey)) {
      return;
    }
    fallbackApiKeys.push(normalizedKey);
    fallbackApiKeyGroups.push(groupName);
  };

  const matchedGroup = matchedModel?.apiKeyGroup;
  const hasMatchedGroup =
    Boolean(matchedGroup) && Boolean(groupedKeys[matchedGroup as string]);

  console.log("[API Key Memory] 记忆分组检查", {
    matchedGroup,
    hasMatchedGroup,
    hasKeyInGroup: Boolean(matchedGroup && groupedKeys[matchedGroup as string]),
  });

  if (hasMatchedGroup) {
    console.log("[API Key Memory] 使用记忆分组", {
      groupName: matchedGroup,
    });
    pushFallbackKey(
      matchedGroup as string,
      groupedKeys[matchedGroup as string],
    );
  }

  for (const group of groupOrder) {
    pushFallbackKey(group, groupedKeys[group]);
  }

  const primaryApiKey = profile.apiKey || "";

  return {
    current: fallbackApiKeys[0] || primaryApiKey,
    fallback: fallbackApiKeys,
    fallbackGroups: fallbackApiKeyGroups,
  };
}

export function rememberSuccessfulCustomModelApiKeyGroup(params: {
  modelName?: string;
  groupName?: string;
}) {
  const { modelName, groupName } = params;
  if (!modelName || !groupName) {
    console.log("[API Key Memory] 记忆失败：缺少参数", {
      modelName,
      groupName,
    });
    return;
  }

  console.log("[API Key Memory] 开始记忆成功的 API Key 分组", {
    modelName,
    groupName,
  });

  const accessStore = useAccessStore.getState();
  const enabledCustomProfile = accessStore.apiProfiles.find(
    (profile) =>
      profile.enabled &&
      profile.provider === ServiceProvider.Custom &&
      profile.baseUrl,
  );

  if (
    !enabledCustomProfile ||
    !isRememberedApiKeyProfile(enabledCustomProfile)
  ) {
    console.log("[API Key Memory] 记忆失败：未找到支持 API Key 分组的配置", {
      hasProfile: Boolean(enabledCustomProfile),
      supportsGrouping: Boolean(
        enabledCustomProfile && isRememberedApiKeyProfile(enabledCustomProfile),
      ),
    });
    return;
  }

  const configStore = useAppConfig.getState() as any;
  const providerId = getProviderIdForProfile(enabledCustomProfile);
  const targetIndex = (configStore.models || []).findIndex(
    (model: LLMModel) =>
      model.name === modelName && model.provider?.id === providerId,
  );

  if (targetIndex < 0) {
    console.log("[API Key Memory] 记忆失败：未找到模型", {
      modelName,
      providerId,
      totalModels: (configStore.models || []).length,
    });
    return;
  }

  const targetModel = configStore.models[targetIndex] as LLMModel;
  if (targetModel.apiKeyGroup === groupName) {
    console.log("[API Key Memory] 已经是当前分组，无需更新", {
      modelName,
      groupName,
    });
    return;
  }

  console.log("[API Key Memory] 更新模型 API Key 分组", {
    modelName,
    oldGroup: targetModel.apiKeyGroup,
    newGroup: groupName,
  });

  void runWithImmediateStoreSyncPaused(async () => {
    configStore.update((state: { models: LLMModel[] }) => {
      const currentModel = state.models[targetIndex];
      if (!currentModel) {
        return;
      }
      state.models[targetIndex] = {
        ...currentModel,
        apiKeyGroup: groupName,
      };
    });
  });

  console.log("[API Key Memory] 模型 API Key 分组已更新（跳过立即同步）", {
    modelName,
    groupName,
  });
}
