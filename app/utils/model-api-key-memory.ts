import type { LLMModel } from "@/app/client/api";
import { ServiceProvider } from "@/app/constant";
import { useAppConfig } from "@/app/store/config";
import { useAccessStore } from "@/app/store/access";
import { runWithImmediateStoreSyncPaused } from "@/app/utils/store";

const API_KEY_GROUP_MEMORY_STORAGE_KEY = "nextchat:api-key-group-memory";

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

function shouldPreferOcoolDefaultGroup(
  modelName: string,
  profile: CustomProfile,
) {
  return (
    isOcoolaiBaseUrl(profile.baseUrl) &&
    modelName.toLowerCase().startsWith("gpt-image")
  );
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

function getMemoryKey(
  profile: Pick<CustomProfile, "id" | "name">,
  modelName: string,
) {
  const profileKey = String(profile.id || profile.name || "").trim();
  return `${profileKey}:${String(modelName || "").trim()}`.toLowerCase();
}

function readApiKeyGroupMemory(): Record<string, string> {
  try {
    const raw = globalThis.localStorage?.getItem(
      API_KEY_GROUP_MEMORY_STORAGE_KEY,
    );
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeApiKeyGroupMemory(memory: Record<string, string>) {
  try {
    globalThis.localStorage?.setItem(
      API_KEY_GROUP_MEMORY_STORAGE_KEY,
      JSON.stringify(memory),
    );
  } catch {
    // localStorage 不可用时跳过，保留原有模型配置记忆逻辑。
  }
}

function getRememberedApiKeyGroup(
  profile: Pick<CustomProfile, "id" | "name">,
  modelName: string,
) {
  return readApiKeyGroupMemory()[getMemoryKey(profile, modelName)];
}

function setRememberedApiKeyGroup(params: {
  profile: Pick<CustomProfile, "id" | "name">;
  modelName: string;
  groupName: string;
}) {
  const memory = readApiKeyGroupMemory();
  memory[getMemoryKey(params.profile, params.modelName)] = params.groupName;
  writeApiKeyGroupMemory(memory);
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

  const rememberedGroup = getRememberedApiKeyGroup(profile, modelName);
  const matchedGroup = rememberedGroup || matchedModel?.apiKeyGroup;
  const hasMatchedGroup =
    Boolean(matchedGroup) && Boolean(groupedKeys[matchedGroup as string]);
  const preferOcoolDefaultGroup = shouldPreferOcoolDefaultGroup(
    modelName,
    profile,
  );

  console.log("[API Key Memory] 记忆分组检查", {
    rememberedGroup,
    matchedGroup,
    hasMatchedGroup,
    hasKeyInGroup: Boolean(matchedGroup && groupedKeys[matchedGroup as string]),
    preferOcoolDefaultGroup,
  });

  if (hasMatchedGroup && !preferOcoolDefaultGroup) {
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

  if (hasMatchedGroup && preferOcoolDefaultGroup) {
    console.log("[API Key Memory] Ocoolai 图片模型优先使用全模型分组", {
      rememberedGroup,
      firstGroup: fallbackApiKeyGroups[0],
    });
    pushFallbackKey(
      matchedGroup as string,
      groupedKeys[matchedGroup as string],
    );
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
  profileId?: string;
  providerId?: string;
}) {
  const {
    modelName,
    groupName,
    profileId,
    providerId: targetProviderId,
  } = params;
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
  const enabledCustomProfile = accessStore.apiProfiles.find((profile) => {
    const profileProviderId = getProviderIdForProfile(profile);
    const matchedByRequest =
      (profileId && profile.id === profileId) ||
      (targetProviderId &&
        profileProviderId === targetProviderId.toLowerCase());
    return (
      profile.provider === ServiceProvider.Custom &&
      profile.baseUrl &&
      (matchedByRequest || (!profileId && !targetProviderId && profile.enabled))
    );
  });

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

  setRememberedApiKeyGroup({
    profile: enabledCustomProfile,
    modelName,
    groupName,
  });

  const configStore = useAppConfig.getState() as any;
  const providerId = getProviderIdForProfile(enabledCustomProfile);
  const targetIndex = (configStore.models || []).findIndex(
    (model: LLMModel) =>
      model.name === modelName && model.provider?.id === providerId,
  );

  if (targetIndex < 0) {
    console.log(
      "[API Key Memory] localStorage 分组记忆已保存，跳过模型配置更新",
      {
        modelName,
        providerId,
        totalModels: (configStore.models || []).length,
      },
    );
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
