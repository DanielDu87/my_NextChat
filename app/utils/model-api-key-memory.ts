import type { LLMModel } from "@/app/client/api";
import { ServiceProvider } from "@/app/constant";
import { useAccessStore } from "@/app/store/access";
import {
  MULTI_KEY_GROUP_IDS,
  normalizeMultiKeyGroups,
  shouldAutoEnableMultiKey,
} from "@/app/utils/multi-key";

const API_KEY_GROUP_MEMORY_STORAGE_KEY = "nextchat:api-key-group-memory";

type CustomProfile = {
  id: string;
  name: string;
  provider: ServiceProvider;
  baseUrl: string;
  apiKey: string;
  apiKeyGroups?: Record<string, string>;
  multiKeyGroupOrder?: string[];
  multiKeyEnabled?: boolean;
  enabled: boolean;
};

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
  profile?: Partial<CustomProfile>,
) {
  if (!profile) {
    return false;
  }

  const normalizedGroups = normalizeMultiKeyGroups(
    profile.apiKeyGroups,
    profile,
  );
  const hasGroupKeys = Object.values(normalizedGroups).some((value) =>
    String(value || "").trim(),
  );

  return Boolean(
    shouldAutoEnableMultiKey({
      ...profile,
      apiKeyGroups: normalizedGroups,
      multiKeyEnabled: hasGroupKeys ? true : profile.multiKeyEnabled,
    }),
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

function isDebugMultiKeyLogsEnabled() {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  try {
    return globalThis.localStorage?.getItem("debug-multikey-logs") === "1";
  } catch {
    return false;
  }
}

function logMultiKeyDebug(message: string, payload?: unknown) {
  if (!isDebugMultiKeyLogsEnabled()) {
    return;
  }
  if (payload === undefined) {
    console.log(message);
    return;
  }
  console.log(message, payload);
}

export function getCustomModelApiKeySelection(
  modelName: string,
  profile: CustomProfile | undefined,
  _models: LLMModel[],
) {
  if (!profile) {
    const accessStore = useAccessStore.getState();
    return {
      current: accessStore.customApiKey,
      fallback: [] as string[],
      fallbackGroups: [] as string[],
      rememberedGroup: "",
    };
  }

  const normalizedProfileGroups = normalizeMultiKeyGroups(
    profile.apiKeyGroups,
    profile,
  );
  const hasGroupKeys = Object.values(normalizedProfileGroups).some((value) =>
    String(value || "").trim(),
  );
  const multiKeyEnabled = shouldAutoEnableMultiKey({
    ...profile,
    apiKeyGroups: normalizedProfileGroups,
    multiKeyEnabled: hasGroupKeys ? true : profile.multiKeyEnabled,
  });
  if (!multiKeyEnabled) {
    return {
      current: profile.apiKey || "",
      fallback: [] as string[],
      fallbackGroups: [] as string[],
      rememberedGroup: "",
    };
  }

  const groupedKeys = normalizedProfileGroups;

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
  const hasRememberedGroup =
    Boolean(rememberedGroup) &&
    MULTI_KEY_GROUP_IDS.includes(rememberedGroup as any) &&
    Boolean(groupedKeys[rememberedGroup as keyof typeof groupedKeys]);

  if (hasRememberedGroup) {
    logMultiKeyDebug(
      "[MultiKey] 从 localStorage 读取到上次成功分组，将优先尝试",
      {
        profileId: profile.id,
        profileName: profile.name,
        modelName,
        rememberedGroup,
        loadedFromLocalStorage: true,
      },
    );
  }

  const groupOrder = [
    ...(hasRememberedGroup ? [rememberedGroup as string] : []),
    ...MULTI_KEY_GROUP_IDS.filter((group) => group !== rememberedGroup),
  ];

  logMultiKeyDebug("[MultiKey] 生成请求分组顺序", {
    profileId: profile.id,
    profileName: profile.name,
    modelName,
    rememberedGroup: hasRememberedGroup ? rememberedGroup : "",
    groupOrder,
    normalizedGroupsOnly: true,
    hasPrimaryApiKey: Boolean(profile.apiKey),
  });

  groupOrder.forEach((group) =>
    pushFallbackKey(group, groupedKeys[group as keyof typeof groupedKeys]),
  );

  const primaryApiKey = profile.apiKey || "";

  return {
    current: fallbackApiKeys[0] || primaryApiKey,
    fallback: fallbackApiKeys,
    fallbackGroups: fallbackApiKeyGroups,
    rememberedGroup: hasRememberedGroup ? rememberedGroup : "",
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
    logMultiKeyDebug("[API Key Memory] 记忆失败：缺少参数", {
      modelName,
      groupName,
    });
    return;
  }

  logMultiKeyDebug("[API Key Memory] 开始记忆成功的 API Key 分组", {
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
    logMultiKeyDebug("[MultiKey] 记忆失败：未找到启用多 key 的配置", {
      hasProfile: Boolean(enabledCustomProfile),
      supportsGrouping: Boolean(
        enabledCustomProfile && isRememberedApiKeyProfile(enabledCustomProfile),
      ),
    });
    return;
  }

  logMultiKeyDebug("[MultiKey] 分组请求成功", {
    profileId: enabledCustomProfile.id,
    profileName: enabledCustomProfile.name,
    modelName,
    groupName,
  });

  if (!MULTI_KEY_GROUP_IDS.includes(groupName as any)) {
    logMultiKeyDebug(
      "[MultiKey] 记忆跳过：普通 API Key 或未知分组不写 localStorage",
      {
        modelName,
        groupName,
        savedToLocalStorage: false,
      },
    );
    return;
  }

  setRememberedApiKeyGroup({
    profile: enabledCustomProfile,
    modelName,
    groupName,
  });

  console.log("[MultiKey] 成功分组已写入 localStorage，下次将优先使用", {
    modelName,
    groupName,
    profileId: enabledCustomProfile.id,
    savedToLocalStorage: true,
  });
}
