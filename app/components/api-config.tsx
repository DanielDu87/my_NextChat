import { useState, useEffect, useMemo, useRef } from "react";

import styles from "./api-config.module.scss";

import CloseIcon from "../icons/close.svg";
import ConfirmIcon from "../icons/confirm.svg";
import LoadingIcon from "../icons/three-dots.svg";
import UploadIcon from "../icons/upload.svg";
import DownloadIcon from "../icons/download.svg";
import AddIcon from "../icons/add.svg";
import TrashIcon from "../icons/trash.svg";

import { IconButton } from "./button";
import { List, ListItem, Select, showToast, showConfirm } from "./ui-lib";
import {
  AI302,
  Alibaba,
  Anthropic,
  Azure,
  Baidu,
  ByteDance,
  ChatGLM,
  DeepSeek,
  Google,
  Iflytek,
  Local,
  Moonshot,
  OPENAI_BASE_URL,
  Path,
  ServiceProvider,
  SiliconFlow,
  Stability,
  Tencent,
  XAI,
} from "../constant";
import { StoreKey } from "../constant";
import {
  useAccessStore,
  useAppConfig,
  useChatStore,
  useModelCacheStore,
} from "../store";
import { useSyncStore, waitForSyncIdleSafely } from "../store/sync";
import { ProviderType } from "../utils/cloud";
import type { StoreSnapshotMeta } from "../utils/cloud/database";
import { AppState, getLocalAppState, setLocalAppState } from "../utils/sync";
import {
  parseStoreStatePayload,
  stringifyPersistedStoreState,
  SYNC_STORE_KEYS,
  type SyncStoreKey,
} from "../utils/sync-store-keys";
import { writeAccessSnapshot } from "../utils/access-snapshot";
import { runWithImmediateStoreSyncPaused } from "../utils/store";
import { LLMModel } from "../client/api";
import { useNavigate } from "react-router-dom";
import { useModelFetcher } from "../utils/useModelFetcher";
import { sanitizeModelConfigForCapability } from "../client/model-parameter-rules";
import {
  getProviderDisplayName,
  modelsToCustomModelsString,
} from "../utils/models";
import { runWithManualDatabaseSyncActive } from "../utils/manual-sync-guard";
import { dedupeAccessProfiles } from "../utils/access-profiles";
import {
  getEffectiveProviderBaseUrl,
  getOfficialProviderBaseUrl,
  isOfficialProviderBaseUrlLocked,
} from "../utils/provider-url";
import {
  MULTI_KEY_GROUP_IDS,
  createEmptyMultiKeyGroups,
  isOcoolProfileLike,
  isYutoProfileLike,
  normalizeMultiKeyGroupOrder,
  normalizeMultiKeyGroups,
} from "../utils/multi-key";
import {
  markRouteSyncStart,
  prepareRouteEntryForSync,
} from "../utils/route-sync-entry";

function isYutoProfile(profile: { name: string; baseUrl: string }) {
  return isYutoProfileLike(profile);
}

function isAihubMixProfile(profile: { name: string; baseUrl: string }) {
  const name = profile.name.toLowerCase();
  const baseUrl = profile.baseUrl.toLowerCase();
  return name.includes("aihubmix") || baseUrl.includes("aihubmix.com");
}

function isVisibleApiConfigProfile(profile: {
  id?: string;
  provider?: ServiceProvider;
  name: string;
  baseUrl: string;
}) {
  return (
    String(profile.id || "").startsWith("profile_") ||
    String(profile.id || "").startsWith("default_") ||
    profile.name === "默认新增配置" ||
    isYutoProfile(profile) ||
    isOcoolProfile(profile) ||
    profile.provider === ServiceProvider.Custom ||
    isAihubMixProfile(profile)
  );
}

function normalizeProfileBaseUrl(profile: {
  provider: ServiceProvider;
  baseUrl?: string;
}) {
  return getEffectiveProviderBaseUrl(profile.provider, profile.baseUrl);
}

function createVisibleApiConfigProfile(): AccessState["apiProfiles"][number] {
  const timestamp = Date.now();

  return {
    id: `profile_${timestamp}`,
    name: "默认新增配置",
    provider: ServiceProvider.Custom,
    baseUrl: `xxx-${timestamp}`,
    apiKey: "xxx",
    modelFetchApiKey: "",
    apiKeyGroups: createEmptyMultiKeyGroups(),
    multiKeyGroupOrder: [...MULTI_KEY_GROUP_IDS],
    multiKeyEnabled: false,
    enabled: false,
    openAICompatible: true,
    cachedModels: "",
    modelCount: 0,
  };
}

function isOcoolProfile(profile: { name: string; baseUrl: string }) {
  return isOcoolProfileLike(profile);
}

type AccessState = ReturnType<typeof useAccessStore.getState>;
type ModelFetchStatus = {
  count?: number;
  fetching?: boolean;
  error?: string;
};

type RemoteStoreMeta = {
  key: string;
  updatedAt: string;
  checksum: string;
};

type ProviderField = {
  key: keyof AccessState;
  label: string;
  placeholder?: string;
  subTitle?: string;
  profileManaged?: boolean;
};

const LOG_SEPARATOR = "=".repeat(5);
const DATABASE_META_KEYS = [StoreKey.Config, StoreKey.Access] as const;
const DATABASE_META_REFRESH_TIMEOUT_MS = 20000;
const BUILTIN_PROVIDER_IDS = new Set([
  "openai",
  "azure",
  "claude",
  "palm",
  "google",
  "anthropic",
  "baidu",
  "bytedance",
  "alibaba",
  "tencent",
  "moonshot",
  "stability",
  "iflytek",
  "xai",
  "chatglm",
  "deepseek",
  "siliconflow",
  "302ai",
]);
const ENCRYPTED_SECRET_PLACEHOLDER = "__encrypted__";
const ACCESS_SECRET_FIELD_KEYS = [
  "apiKey",
  "modelFetchApiKey",
  "customApiKey",
  "openaiApiKey",
  "azureApiKey",
  "googleApiKey",
  "anthropicApiKey",
  "baiduApiKey",
  "baiduSecretKey",
  "bytedanceApiKey",
  "alibabaApiKey",
  "moonshotApiKey",
  "stabilityApiKey",
  "tencentSecretKey",
  "tencentSecretId",
  "iflytekApiKey",
  "iflytekApiSecret",
  "deepseekApiKey",
  "xaiApiKey",
  "chatglmApiKey",
  "siliconflowApiKey",
  "ai302ApiKey",
] as const;

function restoreEncryptedAccessSecrets(
  localAccessState: Record<string, any> | undefined,
  remoteAccessState: Record<string, any> | undefined,
) {
  if (!remoteAccessState || typeof remoteAccessState !== "object") {
    return remoteAccessState;
  }

  const nextAccessState = { ...remoteAccessState };
  const currentLocalAccessState =
    localAccessState && typeof localAccessState === "object"
      ? localAccessState
      : {};

  ACCESS_SECRET_FIELD_KEYS.forEach((key) => {
    if (
      nextAccessState[key] === ENCRYPTED_SECRET_PLACEHOLDER ||
      (String(nextAccessState[key] || "").trim().length === 0 &&
        String(currentLocalAccessState[key] || "").trim().length > 0)
    ) {
      nextAccessState[key] = currentLocalAccessState[key] || "";
    }
  });

  if (Array.isArray(nextAccessState.apiProfiles)) {
    const localProfileMap = new Map(
      Array.isArray(currentLocalAccessState.apiProfiles)
        ? currentLocalAccessState.apiProfiles.map((profile: any) => [
            String(profile?.id || ""),
            profile,
          ])
        : [],
    );

    nextAccessState.apiProfiles = dedupeAccessProfiles(
      nextAccessState.apiProfiles.map((profile: any) => {
        if (!profile || typeof profile !== "object") {
          return profile;
        }

        const localProfile = localProfileMap.get(String(profile.id || ""));
        const nextProfile = { ...profile };

        ["apiKey", "modelFetchApiKey"].forEach((key) => {
          if (
            nextProfile[key] === ENCRYPTED_SECRET_PLACEHOLDER ||
            (String(nextProfile[key] || "").trim().length === 0 &&
              String(localProfile?.[key] || "").trim().length > 0)
          ) {
            nextProfile[key] = localProfile?.[key] || "";
          }
        });

        if (
          nextProfile.apiKeyGroups &&
          typeof nextProfile.apiKeyGroups === "object"
        ) {
          const localGroups =
            localProfile?.apiKeyGroups &&
            typeof localProfile.apiKeyGroups === "object"
              ? localProfile.apiKeyGroups
              : {};
          nextProfile.apiKeyGroups = Object.fromEntries(
            Object.entries(nextProfile.apiKeyGroups).map(
              ([groupKey, value]) => [
                groupKey,
                value === ENCRYPTED_SECRET_PLACEHOLDER ||
                (String(value || "").trim().length === 0 &&
                  String(localGroups[groupKey] || "").trim().length > 0)
                  ? localGroups[groupKey] || ""
                  : value,
              ],
            ),
          );
        }

        return nextProfile;
      }),
    );
  }

  return nextAccessState;
}

function normalizeAccessStateForUi(
  accessState: Record<string, any> | undefined,
) {
  if (!accessState || typeof accessState !== "object") {
    return accessState;
  }

  const nextAccessState = { ...accessState };

  ACCESS_SECRET_FIELD_KEYS.forEach((key) => {
    if (nextAccessState[key] === undefined || nextAccessState[key] === null) {
      nextAccessState[key] = "";
    }
  });

  if (Array.isArray(nextAccessState.apiProfiles)) {
    nextAccessState.apiProfiles = dedupeAccessProfiles(
      nextAccessState.apiProfiles.map((profile: any) => {
        if (!profile || typeof profile !== "object") {
          return profile;
        }

        const nextProfile = { ...profile };
        nextProfile.baseUrl = String(nextProfile.baseUrl || "");
        nextProfile.apiKey = String(nextProfile.apiKey || "");
        nextProfile.modelFetchApiKey = String(
          nextProfile.modelFetchApiKey || "",
        );

        if (
          nextProfile.apiKeyGroups &&
          typeof nextProfile.apiKeyGroups === "object"
        ) {
          nextProfile.apiKeyGroups = Object.fromEntries(
            Object.entries(nextProfile.apiKeyGroups).map(
              ([groupKey, value]) => [groupKey, String(value || "")],
            ),
          );
        }

        return nextProfile;
      }),
    );
  }

  return nextAccessState;
}

function normalizeDownloadedStoreState(
  key: SyncStoreKey,
  parsedState: unknown,
  localAccessState: Record<string, any>,
) {
  if (key === StoreKey.Access) {
    const safeAccessState =
      parsedState &&
      typeof parsedState === "object" &&
      !Array.isArray(parsedState)
        ? (parsedState as Record<string, any>)
        : {};

    if (
      !parsedState ||
      typeof parsedState !== "object" ||
      Array.isArray(parsedState)
    ) {
      console.warn(
        `[API Config] ⚠️ ${key} 云端快照不是对象，已回退为空对象兼容导入`,
        parsedState,
      );
    }

    return normalizeAccessStateForUi(
      restoreEncryptedAccessSecrets(localAccessState, safeAccessState),
    );
  }

  if (key === StoreKey.Config) {
    if (
      !parsedState ||
      typeof parsedState !== "object" ||
      Array.isArray(parsedState)
    ) {
      console.warn(
        `[API Config] ⚠️ ${key} 云端快照不是对象，已回退为空对象兼容导入`,
        parsedState,
      );
      return {};
    }
  }

  return parsedState;
}

async function refreshDatabaseMetaSafely(
  client: any,
  keys: readonly SyncStoreKey[],
  updateStoredMeta: (metas: StoreSnapshotMeta[]) => void,
) {
  if (typeof client.getMeta !== "function") {
    return;
  }

  try {
    updateStoredMeta(
      await client.getMeta([...keys], {
        timeoutMs: DATABASE_META_REFRESH_TIMEOUT_MS,
        retries: 0,
      }),
    );
  } catch (error) {
    console.warn(
      "[API Config] ⚠️ 同步主体已完成，刷新数据库元数据失败，已跳过:",
      error,
    );
  }
}

function mergeCachedModels(existing: string | undefined, incoming: string) {
  const merged = new Set((existing || "").split(",").filter(Boolean));
  incoming
    .split(",")
    .filter(Boolean)
    .forEach((model) => merged.add(model));
  return [...merged].join(",");
}

function countCachedModels(cachedModels?: string, fallbackCount?: number) {
  if (cachedModels) {
    return cachedModels.split(",").filter(Boolean).length;
  }
  return fallbackCount ?? 0;
}

function countUserAddedModels(customModels?: string) {
  return String(customModels || "")
    .split(",")
    .map((model) => model.trim())
    .filter((model) => model.startsWith("+")).length;
}

function getProfileCacheSnapshot(profileId: string) {
  return useModelCacheStore.getState().profiles?.[profileId];
}

function getProfileCachedModels(profile: {
  id: string;
  cachedModels?: string;
}) {
  return (
    getProfileCacheSnapshot(profile.id)?.cachedModels ??
    profile.cachedModels ??
    ""
  );
}

function getProfileCachedModelCount(profile: {
  id: string;
  cachedModels?: string;
  modelCount?: number;
}) {
  const cache = getProfileCacheSnapshot(profile.id);
  return countCachedModels(
    cache?.cachedModels ?? profile.cachedModels,
    cache?.modelCount ?? profile.modelCount,
  );
}

function getManagedProviderIds(profiles: AccessState["apiProfiles"] = []) {
  return new Set(
    profiles.map((profile) => getProfileProviderId(profile).toLowerCase()),
  );
}

function getManagedCloudModels(
  models: LLMModel[] = [],
  profiles: AccessState["apiProfiles"] = [],
) {
  const managedProviderIds = getManagedProviderIds(profiles);
  return models.filter((model) => {
    const providerId = String(model.provider?.id || "").toLowerCase();
    return (
      providerId.length > 0 &&
      !BUILTIN_PROVIDER_IDS.has(providerId) &&
      managedProviderIds.has(providerId)
    );
  });
}

function countCloudMergedModels(
  models: LLMModel[] = [],
  profiles: AccessState["apiProfiles"] = [],
) {
  return getManagedCloudModels(models, profiles).length;
}

function getProfileProviderId(profile: {
  provider: ServiceProvider;
  name: string;
}) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`
    : profile.provider === ServiceProvider.Local
    ? `${String(profile.provider).toLowerCase()}_${profile.name}`.toLowerCase()
    : String(profile.provider).toLowerCase();
}

function getCloudMergedPlatformCounts(
  models: LLMModel[] = [],
  profiles: AccessState["apiProfiles"] = [],
) {
  const counts = new Map<string, number>();

  models.forEach((model) => {
    const providerId = String(model.provider?.id || "").toLowerCase();
    if (!providerId || BUILTIN_PROVIDER_IDS.has(providerId)) {
      return;
    }
    counts.set(providerId, (counts.get(providerId) ?? 0) + 1);
  });

  return profiles.map((profile) => ({
    name: profile.name,
    count: counts.get(getProfileProviderId(profile).toLowerCase()) ?? 0,
  }));
}

function formatModelDelta(delta: number) {
  if (delta > 0) {
    return `+${delta}`;
  }
  return `${delta}`;
}

function getProfileActualModelsString(
  profile: {
    provider: ServiceProvider;
    name: string;
  },
  models: LLMModel[] = [],
) {
  const providerId = getProfileProviderId(profile).toLowerCase();
  const profileModels = models.filter(
    (model) => String(model.provider?.id || "").toLowerCase() === providerId,
  );
  return modelsToCustomModelsString(profileModels);
}

function getProfileActualCount(
  profile: {
    provider: ServiceProvider;
    name: string;
  },
  models: LLMModel[] = [],
) {
  const providerId = getProfileProviderId(profile).toLowerCase();
  return models.filter(
    (model) => String(model.provider?.id || "").toLowerCase() === providerId,
  ).length;
}

const PROVIDER_OPTIONS = [
  ServiceProvider.Custom,
  ServiceProvider.OpenAI,
  ServiceProvider.Azure,
  ServiceProvider.Google,
  ServiceProvider.Anthropic,
  ServiceProvider.Baidu,
  ServiceProvider.ByteDance,
  ServiceProvider.Alibaba,
  ServiceProvider.Tencent,
  ServiceProvider.Moonshot,
  ServiceProvider.Stability,
  ServiceProvider.Iflytek,
  ServiceProvider.XAI,
  ServiceProvider.ChatGLM,
  ServiceProvider.DeepSeek,
  ServiceProvider.SiliconFlow,
  ServiceProvider["302.AI"],
  ServiceProvider.Local,
] as const;

const PROVIDER_FIELDS: Record<ServiceProvider, ProviderField[]> = {
  [ServiceProvider.OpenAI]: [
    {
      key: "openaiUrl",
      label: "Base URL",
      placeholder: OPENAI_BASE_URL,
      subTitle: "OpenAI 官方地址或你的中转地址",
      profileManaged: true,
    },
    {
      key: "openaiApiKey",
      label: "API Key",
      placeholder: "sk-...",
      profileManaged: true,
    },
  ],
  [ServiceProvider.Custom]: [
    {
      key: "customUrl",
      label: "Base URL",
      placeholder: "https://your-api.example.com/v1",
      subTitle: "自定义平台地址，仅在 OPENAI 兼容时可直接用于聊天",
      profileManaged: true,
    },
    {
      key: "customApiKey",
      label: "API Key",
      placeholder: "custom-api-key",
      profileManaged: true,
    },
  ],
  [ServiceProvider.Azure]: [
    {
      key: "azureUrl",
      label: "Endpoint",
      placeholder: Azure.ExampleEndpoint,
      subTitle: "Azure OpenAI 资源地址",
      profileManaged: true,
    },
    {
      key: "azureApiKey",
      label: "API Key",
      placeholder: "Azure API Key",
      profileManaged: true,
    },
    {
      key: "azureApiVersion",
      label: "API Version",
      placeholder: "2023-08-01-preview",
    },
  ],
  [ServiceProvider.Google]: [
    {
      key: "googleUrl",
      label: "Base URL",
      placeholder: Google.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "googleApiKey",
      label: "API Key",
      placeholder: "Google API Key",
      profileManaged: true,
    },
    {
      key: "googleApiVersion",
      label: "API Version",
      placeholder: "v1",
    },
  ],
  [ServiceProvider.Anthropic]: [
    {
      key: "anthropicUrl",
      label: "Base URL",
      placeholder: Anthropic.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "anthropicApiKey",
      label: "API Key",
      placeholder: "Anthropic API Key",
      profileManaged: true,
    },
    {
      key: "anthropicApiVersion",
      label: "API Version",
      placeholder: "2023-06-01",
    },
  ],
  [ServiceProvider.Baidu]: [
    {
      key: "baiduUrl",
      label: "Base URL",
      placeholder: Baidu.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "baiduApiKey",
      label: "API Key",
      placeholder: "Baidu API Key",
      profileManaged: true,
    },
    {
      key: "baiduSecretKey",
      label: "Secret Key",
      placeholder: "Baidu Secret Key",
    },
  ],
  [ServiceProvider.ByteDance]: [
    {
      key: "bytedanceUrl",
      label: "Base URL",
      placeholder: ByteDance.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "bytedanceApiKey",
      label: "API Key",
      placeholder: "ByteDance API Key",
      profileManaged: true,
    },
  ],
  [ServiceProvider.Alibaba]: [
    {
      key: "alibabaUrl",
      label: "Base URL",
      placeholder: Alibaba.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "alibabaApiKey",
      label: "API Key",
      placeholder: "Alibaba API Key",
      profileManaged: true,
    },
  ],
  [ServiceProvider.Tencent]: [
    {
      key: "tencentUrl",
      label: "Base URL",
      placeholder: Tencent.ExampleEndpoint,
    },
    {
      key: "tencentSecretId",
      label: "Secret ID",
      placeholder: "Tencent Secret ID",
    },
    {
      key: "tencentSecretKey",
      label: "Secret Key",
      placeholder: "Tencent Secret Key",
    },
  ],
  [ServiceProvider.Moonshot]: [
    {
      key: "moonshotUrl",
      label: "Base URL",
      placeholder: Moonshot.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "moonshotApiKey",
      label: "API Key",
      placeholder: "Moonshot API Key",
      profileManaged: true,
    },
  ],
  [ServiceProvider.Stability]: [
    {
      key: "stabilityUrl",
      label: "Base URL",
      placeholder: Stability.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "stabilityApiKey",
      label: "API Key",
      placeholder: "Stability API Key",
      profileManaged: true,
    },
  ],
  [ServiceProvider.Iflytek]: [
    {
      key: "iflytekUrl",
      label: "Base URL",
      placeholder: Iflytek.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "iflytekApiKey",
      label: "API Key",
      placeholder: "Iflytek API Key",
      profileManaged: true,
    },
    {
      key: "iflytekApiSecret",
      label: "API Secret",
      placeholder: "Iflytek API Secret",
    },
  ],
  [ServiceProvider.XAI]: [
    {
      key: "xaiUrl",
      label: "Base URL",
      placeholder: XAI.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "xaiApiKey",
      label: "API Key",
      placeholder: "xAI API Key",
      profileManaged: true,
    },
  ],
  [ServiceProvider.ChatGLM]: [
    {
      key: "chatglmUrl",
      label: "Base URL",
      placeholder: ChatGLM.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "chatglmApiKey",
      label: "API Key",
      placeholder: "ChatGLM API Key",
      profileManaged: true,
    },
  ],
  [ServiceProvider.DeepSeek]: [
    {
      key: "deepseekUrl",
      label: "Base URL",
      placeholder: DeepSeek.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "deepseekApiKey",
      label: "API Key",
      placeholder: "DeepSeek API Key",
      profileManaged: true,
    },
  ],
  [ServiceProvider.SiliconFlow]: [
    {
      key: "siliconflowUrl",
      label: "Base URL",
      placeholder: SiliconFlow.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "siliconflowApiKey",
      label: "API Key",
      placeholder: "SiliconFlow API Key",
      profileManaged: true,
    },
  ],
  [ServiceProvider["302.AI"]]: [
    {
      key: "ai302Url",
      label: "Base URL",
      placeholder: AI302.ExampleEndpoint,
      profileManaged: true,
    },
    {
      key: "ai302ApiKey",
      label: "API Key",
      placeholder: "302.AI API Key",
      profileManaged: true,
    },
  ],
  [ServiceProvider.Local]: [
    {
      key: "localUrl",
      label: "Base URL",
      placeholder: Local.ExampleEndpoint,
      subTitle: "本地 API 地址",
      profileManaged: true,
    },
    {
      key: "localApiKey",
      label: "API Key",
      placeholder: "your-api-key",
      profileManaged: true,
    },
  ],
};

function getProfileBaseUrl(
  provider: ServiceProvider,
  accessStore: AccessState,
) {
  const officialBaseUrl = getOfficialProviderBaseUrl(provider);
  if (officialBaseUrl) {
    return officialBaseUrl;
  }

  switch (provider) {
    case ServiceProvider.Custom:
      return accessStore.customUrl;
    case ServiceProvider.OpenAI:
      return accessStore.openaiUrl;
    case ServiceProvider.Azure:
      return accessStore.azureUrl;
    case ServiceProvider.Google:
      return accessStore.googleUrl;
    case ServiceProvider.Anthropic:
      return accessStore.anthropicUrl;
    case ServiceProvider.Baidu:
      return accessStore.baiduUrl;
    case ServiceProvider.ByteDance:
      return accessStore.bytedanceUrl;
    case ServiceProvider.Alibaba:
      return accessStore.alibabaUrl;
    case ServiceProvider.Tencent:
      return accessStore.tencentUrl;
    case ServiceProvider.Moonshot:
      return accessStore.moonshotUrl;
    case ServiceProvider.Stability:
      return accessStore.stabilityUrl;
    case ServiceProvider.Iflytek:
      return accessStore.iflytekUrl;
    case ServiceProvider.XAI:
      return accessStore.xaiUrl;
    case ServiceProvider.ChatGLM:
      return accessStore.chatglmUrl;
    case ServiceProvider.DeepSeek:
      return accessStore.deepseekUrl;
    case ServiceProvider.SiliconFlow:
      return accessStore.siliconflowUrl;
    case ServiceProvider["302.AI"]:
      return accessStore.ai302Url;
    case ServiceProvider.Local:
      return accessStore.localUrl;
    default:
      return "";
  }
}

function getProfileApiKey(provider: ServiceProvider, accessStore: AccessState) {
  switch (provider) {
    case ServiceProvider.Custom:
      return accessStore.customApiKey;
    case ServiceProvider.OpenAI:
      return accessStore.openaiApiKey;
    case ServiceProvider.Azure:
      return accessStore.azureApiKey;
    case ServiceProvider.Google:
      return accessStore.googleApiKey;
    case ServiceProvider.Anthropic:
      return accessStore.anthropicApiKey;
    case ServiceProvider.Baidu:
      return accessStore.baiduApiKey;
    case ServiceProvider.ByteDance:
      return accessStore.bytedanceApiKey;
    case ServiceProvider.Alibaba:
      return accessStore.alibabaApiKey;
    case ServiceProvider.Moonshot:
      return accessStore.moonshotApiKey;
    case ServiceProvider.Stability:
      return accessStore.stabilityApiKey;
    case ServiceProvider.Iflytek:
      return accessStore.iflytekApiKey;
    case ServiceProvider.XAI:
      return accessStore.xaiApiKey;
    case ServiceProvider.ChatGLM:
      return accessStore.chatglmApiKey;
    case ServiceProvider.DeepSeek:
      return accessStore.deepseekApiKey;
    case ServiceProvider.SiliconFlow:
      return accessStore.siliconflowApiKey;
    case ServiceProvider["302.AI"]:
      return accessStore.ai302ApiKey;
    case ServiceProvider.Local:
      return accessStore.localApiKey;
    default:
      return "";
  }
}

function getDefaultModelForProvider(
  provider: ServiceProvider,
  models: LLMModel[],
): string | undefined {
  const fromStore = models.find((m) => m.provider?.providerName === provider)
    ?.name;
  if (fromStore) return fromStore;
  if (provider === ServiceProvider.Custom) {
    return models.find(
      (m) => m.provider?.providerName === ServiceProvider.Custom,
    )?.name;
  }
  return undefined;
}

export function ApiConfigPage() {
  const navigate = useNavigate();
  const accessStore = useAccessStore();
  const appConfig = useAppConfig() as any;
  const chatStore = useChatStore();
  const syncStore = useSyncStore();
  const [syncing, setSyncing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [modelFetchStatusMap, setModelFetchStatusMap] = useState<
    Partial<Record<string, ModelFetchStatus>>
  >({});
  const [editingYutoProfileId, setEditingYutoProfileId] = useState("");
  const multiKeyDraftGroupsRef = useRef<Record<string, Record<string, string>>>(
    {},
  );
  const pageLoadSyncNoticeLoggedRef = useRef(false);
  const { fetchFromProvider } = useModelFetcher();

  useEffect(() => {
    prepareRouteEntryForSync(Path.ApiConfig, {
      source: "api-config-page",
    });
  }, []);

  useEffect(() => {
    const hasLegacyMultiKeyProfiles = accessStore.apiProfiles.some(
      (profile) =>
        (isYutoProfile(profile) || isOcoolProfile(profile)) &&
        (typeof profile.multiKeyEnabled !== "boolean" ||
          !Array.isArray(profile.multiKeyGroupOrder) ||
          !MULTI_KEY_GROUP_IDS.every((group) =>
            Object.prototype.hasOwnProperty.call(
              profile.apiKeyGroups || {},
              group,
            ),
          )),
    );

    if (!hasLegacyMultiKeyProfiles) return;

    accessStore.update((access) => {
      access.lastUpdateTime = Date.now();
      access.apiProfiles = access.apiProfiles.map((profile) => {
        if (isYutoProfile(profile) || isOcoolProfile(profile)) {
          const normalizedGroups = normalizeMultiKeyGroups(
            profile.apiKeyGroups,
            profile,
          );
          return {
            ...profile,
            multiKeyEnabled: true,
            apiKeyGroups: normalizedGroups,
            multiKeyGroupOrder: normalizeMultiKeyGroupOrder(
              profile.multiKeyGroupOrder,
              normalizedGroups,
            ),
          };
        }
        return profile;
      });
    });
  }, [accessStore]);

  useEffect(() => {
    const styleId = "small-modal-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .modal-mask .modal-container {
          width: 550px !important;
          max-width: unset !important;
          min-width: unset !important;
          margin: 0 auto !important;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const usingCustomConfig = accessStore.useCustomConfig;

  const providerFields = PROVIDER_FIELDS[accessStore.provider] ?? [];
  const extraFields = providerFields.filter((f) => !f.profileManaged);
  const providerProfiles = useMemo(
    () => (accessStore.apiProfiles || []).filter(isVisibleApiConfigProfile),
    [accessStore.apiProfiles],
  );
  const activeVisibleProfile = providerProfiles.find(
    (profile) => profile.enabled,
  );
  const dbSyncTargetLabel = "PostgreSQL / nextchat";

  const allProfiles = accessStore.apiProfiles;
  const updateStoredMeta = (metas: StoreSnapshotMeta[]) => {
    useSyncStore.getState().updateDatabaseMeta?.(metas);
  };
  // 页面加载时输出缓存的模型数量（延迟到云端同步完成后）
  const buildApiConfigSyncSnapshot = () => {
    const currentProfiles = useAccessStore.getState().apiProfiles || [];
    const currentModels = useAppConfig.getState().models || [];
    return JSON.stringify({
      models: currentModels.map(
        (model) => `${model.name}@${model.provider?.id}`,
      ),
      profiles: currentProfiles.map((profile) => ({
        id: profile.id,
        cachedModels: getProfileCachedModels(profile),
        modelCount: getProfileCachedModelCount(profile),
      })),
    });
  };

  const logModelCount = () => {
    const currentProfiles = useAccessStore.getState().apiProfiles || [];
    const currentModels = useAppConfig.getState().models || [];

    // 使用与 auto-sync 相同的方式计算本地模型总数
    const localTotalCount = countCloudMergedModels(
      currentModels,
      currentProfiles,
    );
    const localPlatformCounts = getCloudMergedPlatformCounts(
      currentModels,
      currentProfiles,
    );

    console.log(`[API Config] 📊 本地临时模型数据:`);
    console.log(`[API Config] - 本地临时模型总数: ${localTotalCount} 个`);
    console.log(`[API Config] 📋 本地各平台模型数量:`);
    localPlatformCounts.forEach(({ name, count }) => {
      console.log(`[API Config] - ${name}: ${count} 个模型`);
    });
  };

  // 云端同步逻辑（提取为函数以复用）
  const performCloudSync = async () => {
    markRouteSyncStart(Path.ApiConfig, "api-config-cloud-sync");
    return runWithImmediateStoreSyncPaused(async () => {
      const beforeSnapshot = buildApiConfigSyncSnapshot();
      const client = syncStore.getClient() as any;
      let accessSyncError: unknown = null;

      try {
        // 先恢复 access-control。完整模型列表只作为本地临时数据，不从远端恢复。
        const remoteAccessJson = await client.get(StoreKey.Access);
        if (remoteAccessJson) {
          const remoteAccess = parseStoreStatePayload<any>(remoteAccessJson);
          const remoteProfiles = remoteAccess.apiProfiles || [];
          if (remoteProfiles.length > 0) {
            accessStore.update((state) => {
              const localProfileMap = new Map(
                (state.apiProfiles || []).map((p: any) => [p.id, p]),
              );
              const mergedProfiles = [...(state.apiProfiles || [])];

              remoteProfiles.forEach((remoteProfile: any) => {
                const {
                  cachedModels,
                  modelCount,
                  ...remoteProfileWithoutModelCache
                } = remoteProfile;
                void cachedModels;
                void modelCount;

                if (!localProfileMap.has(remoteProfile.id)) {
                  mergedProfiles.push(remoteProfileWithoutModelCache);
                } else {
                  const localIndex = mergedProfiles.findIndex(
                    (p: any) => p.id === remoteProfile.id,
                  );
                  if (localIndex >= 0) {
                    const local = mergedProfiles[localIndex];
                    mergedProfiles[localIndex] = {
                      ...local,
                    };
                  }
                }
              });

              state.apiProfiles = dedupeAccessProfiles(mergedProfiles as any);
            });
          }
        }
      } catch (error) {
        accessSyncError = error;
        console.error("[API Config] ❌ 恢复 access-control 失败:", error);
      }

      if (accessSyncError) {
        throw accessSyncError;
      }

      // 同步完成后输出最终的模型数量
      await refreshDatabaseMetaSafely(
        client,
        DATABASE_META_KEYS,
        updateStoredMeta,
      );
      logModelCount();
      return beforeSnapshot !== buildApiConfigSyncSnapshot();
    });
  };

  const ensureRemoteAccessProfilesLoaded = async () => {
    const currentProfiles = useAccessStore.getState().apiProfiles || [];
    if (currentProfiles.length > 0) {
      return currentProfiles.length;
    }

    console.log("[API Config] ☁️ 本地 API 配置为空，正在尝试从数据库恢复...");
    const changed = await performCloudSync();
    const nextProfiles = useAccessStore.getState().apiProfiles || [];
    console.log(
      `[API Config] ☁️ 数据库恢复结果: ${nextProfiles.length} 个配置条目${
        changed ? "，本地状态已更新" : ""
      }`,
    );
    console.log(LOG_SEPARATOR);
    return nextProfiles.length;
  };

  // 页面加载时只展示本地缓存，不自动触发数据库同步
  const accessProfilesSyncFingerprint = useMemo(
    () =>
      JSON.stringify(
        (accessStore.apiProfiles || []).map((profile) => ({
          id: profile.id,
          provider: profile.provider,
          name: profile.name,
          baseUrl: profile.baseUrl,
          apiKey: profile.apiKey,
          enabled: profile.enabled,
          openAICompatible: profile.openAICompatible,
          modelCount: profile.modelCount,
          apiKeyGroups: profile.apiKeyGroups,
        })),
      ),
    [accessStore.apiProfiles],
  );

  useEffect(() => {
    const logLocalCacheOnLoad = () => {
      const checkInterval = setInterval(() => {
        const state = useSyncStore.getState() as any;
        const hasHydrated = state?._hasHydrated;

        if (hasHydrated) {
          clearInterval(checkInterval);
          if (pageLoadSyncNoticeLoggedRef.current) {
            return;
          }
          pageLoadSyncNoticeLoggedRef.current = true;

          if (useSyncStore.getState().provider === ProviderType.Database) {
            useModelCacheStore.getState().migrateFromAccessProfiles?.();
            console.log(
              "[API Config] ℹ️ 进入 API 配置页不会自动同步；请使用上传、保存并同步或从数据库下载按钮手动同步",
            );
          } else {
            console.log("[API Config] ℹ️ 当前未启用数据库同步");
          }
        }
      }, 200);

      // 30秒后停止检查（防止无限等待）
      setTimeout(() => clearInterval(checkInterval), 30000);
    };

    logLocalCacheOnLoad();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    writeAccessSnapshot({
      useCustomConfig: accessStore.useCustomConfig,
      provider: accessStore.provider,
      apiProfiles: accessStore.apiProfiles || [],
      customModels: accessStore.customModels,
      customUrl: accessStore.customUrl,
      customApiKey: accessStore.customApiKey,
      customOpenAICompatible: accessStore.customOpenAICompatible,
    });
  }, [
    accessProfilesSyncFingerprint,
    accessStore.apiProfiles,
    accessStore.useCustomConfig,
    accessStore.provider,
    accessStore.customModels,
    accessStore.customUrl,
    accessStore.customApiKey,
    accessStore.customOpenAICompatible,
  ]);

  const syncActionDisabled = syncing || backingUp || downloading;
  // const customProviderUnsupported =
  //   accessStore.provider === ServiceProvider.Custom &&
  //   !accessStore.customOpenAICompatible;

  const refreshModelsForProvider = (
    provider: ServiceProvider,
    baseUrl?: string,
    apiKey?: string,
    profileId?: string,
  ) => {
    const key = profileId ?? provider;
    setModelFetchStatusMap((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        fetching: true,
        error: undefined,
      },
    }));

    void fetchFromProvider(provider, baseUrl, apiKey, {
      silent: true,
      throwOnError: true,
      apiKeyGroups: profileId
        ? useAccessStore.getState().apiProfiles.find((p) => p.id === profileId)
            ?.apiKeyGroups
        : undefined,
      multiKeyGroupOrder: profileId
        ? useAccessStore.getState().apiProfiles.find((p) => p.id === profileId)
            ?.multiKeyGroupOrder
        : undefined,
    })
      .then((result) => {
        const currentProfile = profileId
          ? useAccessStore
              .getState()
              .apiProfiles.find((p) => p.id === profileId)
          : undefined;
        const actualCount = currentProfile
          ? getProfileActualCount(
              currentProfile,
              useAppConfig.getState().models,
            )
          : result.total;

        setModelFetchStatusMap((prev) => ({
          ...prev,
          [key]: {
            count: actualCount,
            fetching: false,
            error: undefined,
          },
        }));

        if (result.total === 0) {
          const displayName = getProviderDisplayName(provider, baseUrl);
          console.log(
            `[API Config] ⚠️ 从 ${displayName} 未获取到模型，可能该供应商不支持模型列表API`,
          );
        }
      })
      .catch((error) => {
        setModelFetchStatusMap((prev) => ({
          ...prev,
          [key]: {
            count: 0,
            fetching: false,
            error: error instanceof Error ? error.message : "获取模型失败",
          },
        }));
        const displayName = getProviderDisplayName(provider, baseUrl);
        console.warn(
          `[API Config] ⚠️ 从 ${displayName} 自动获取模型失败:`,
          error,
        );
      });
  };

  const syncProfileToAccess = (
    profileId: string,
    options?: { skipFetchModels?: boolean },
  ) => {
    const selectedProfile = accessStore.apiProfiles.find(
      (p) => p.id === profileId,
    );
    if (!selectedProfile) {
      return;
    }

    const actualProfileModels = getProfileActualModelsString(
      selectedProfile,
      useAppConfig.getState().models || [],
    );

    accessStore.update((access) => {
      access.customModels = actualProfileModels;
      (access as any).profileSelectionUpdatedAt = Date.now();
      access.apiProfiles = access.apiProfiles.map((profile) => {
        const enabled = profile.id === profileId;
        if (!enabled) return { ...profile, enabled: false };

        const effectiveBaseUrl = normalizeProfileBaseUrl(profile);

        switch (profile.provider) {
          case ServiceProvider.Custom:
            access.customUrl = effectiveBaseUrl;
            access.customApiKey = profile.apiKey;
            access.customOpenAICompatible = profile.openAICompatible ?? true;
            break;
          case ServiceProvider.OpenAI:
            access.openaiUrl = effectiveBaseUrl;
            access.openaiApiKey = profile.apiKey;
            break;
          case ServiceProvider.Azure:
            access.azureUrl = effectiveBaseUrl;
            access.azureApiKey = profile.apiKey;
            break;
          case ServiceProvider.Google:
            access.googleUrl = effectiveBaseUrl;
            access.googleApiKey = profile.apiKey;
            break;
          case ServiceProvider.Anthropic:
            access.anthropicUrl = effectiveBaseUrl;
            access.anthropicApiKey = profile.apiKey;
            break;
          case ServiceProvider.Baidu:
            access.baiduUrl = effectiveBaseUrl;
            access.baiduApiKey = profile.apiKey;
            break;
          case ServiceProvider.ByteDance:
            access.bytedanceUrl = effectiveBaseUrl;
            access.bytedanceApiKey = profile.apiKey;
            break;
          case ServiceProvider.Alibaba:
            access.alibabaUrl = effectiveBaseUrl;
            access.alibabaApiKey = profile.apiKey;
            break;
          case ServiceProvider.Tencent:
            access.tencentUrl = effectiveBaseUrl;
            break;
          case ServiceProvider.Moonshot:
            access.moonshotUrl = effectiveBaseUrl;
            access.moonshotApiKey = profile.apiKey;
            break;
          case ServiceProvider.Stability:
            access.stabilityUrl = effectiveBaseUrl;
            access.stabilityApiKey = profile.apiKey;
            break;
          case ServiceProvider.Iflytek:
            access.iflytekUrl = effectiveBaseUrl;
            access.iflytekApiKey = profile.apiKey;
            break;
          case ServiceProvider.XAI:
            access.xaiUrl = effectiveBaseUrl;
            access.xaiApiKey = profile.apiKey;
            break;
          case ServiceProvider.ChatGLM:
            access.chatglmUrl = effectiveBaseUrl;
            access.chatglmApiKey = profile.apiKey;
            break;
          case ServiceProvider.DeepSeek:
            access.deepseekUrl = effectiveBaseUrl;
            access.deepseekApiKey = profile.apiKey;
            break;
          case ServiceProvider.SiliconFlow:
            access.siliconflowUrl = effectiveBaseUrl;
            access.siliconflowApiKey = profile.apiKey;
            break;
          case ServiceProvider["302.AI"]:
            access.ai302Url = effectiveBaseUrl;
            access.ai302ApiKey = profile.apiKey;
            break;
          case ServiceProvider.Local:
            access.localUrl = effectiveBaseUrl;
            access.localApiKey = profile.apiKey;
            break;
          default:
            break;
        }

        if (profile.provider === ServiceProvider.Custom) {
          access.customOpenAICompatible = profile.openAICompatible ?? true;
        }
        access.provider = profile.provider;
        return { ...profile, baseUrl: effectiveBaseUrl, enabled: true };
      });
    });

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

    // 延迟检查，确保值已保存
    // 同时更新当前会话的模型提供商
    if (selectedProfile) {
      applyProviderToChat(selectedProfile.provider);
      if (!options?.skipFetchModels) {
        refreshModelsForProvider(
          selectedProfile.provider,
          normalizeProfileBaseUrl(selectedProfile),
          selectedProfile.apiKey,
        );
      }
    }
  };

  const writeLatestAccessSnapshot = () => {
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
  };

  const updateMultiKeyGroups = (
    profileId: string,
    nextGroups: Record<string, string>,
    nextOrder?: string[],
  ) => {
    accessStore.update((access) => {
      access.lastUpdateTime = Date.now();
      access.apiProfiles = access.apiProfiles.map((item) => {
        if (item.id !== profileId) return item;
        const normalizedGroups = normalizeMultiKeyGroups(nextGroups, item);
        const normalizedOrder = normalizeMultiKeyGroupOrder(
          nextOrder || item.multiKeyGroupOrder,
          normalizedGroups,
        );
        multiKeyDraftGroupsRef.current[item.id] = normalizedGroups;
        return {
          ...item,
          multiKeyEnabled: true,
          apiKeyGroups: normalizedGroups,
          multiKeyGroupOrder: normalizedOrder,
        };
      });
    });
    writeLatestAccessSnapshot();
    if (
      useAccessStore
        .getState()
        .apiProfiles.find((item) => item.id === profileId)?.enabled
    ) {
      syncProfileToAccess(profileId, { skipFetchModels: true });
    }
  };

  const moveMultiKeyGroup = (
    profileId: string,
    fromGroup: string,
    toGroup: string,
    currentGroups: Record<string, string>,
    currentOrder: string[],
  ) => {
    if (!fromGroup || !toGroup || fromGroup === toGroup) return;

    const nextOrder = normalizeMultiKeyGroupOrder(currentOrder, currentGroups);
    const fromIndex = nextOrder.indexOf(fromGroup as any);
    const toIndex = nextOrder.indexOf(toGroup as any);
    if (fromIndex < 0 || toIndex < 0) return;

    const [moved] = nextOrder.splice(fromIndex, 1);
    nextOrder.splice(toIndex, 0, moved);
    updateMultiKeyGroups(profileId, currentGroups, nextOrder);
  };

  const applyProviderToChat = (provider: ServiceProvider) => {
    const model = getDefaultModelForProvider(provider, appConfig.models);
    if (!model) return;

    appConfig.update((config: any) => {
      config.modelConfig.providerName = provider;
      config.modelConfig.model = model as any;
      config.modelConfig = sanitizeModelConfigForCapability(config.modelConfig);
    });

    const currentSession = chatStore.currentSession();
    chatStore.updateTargetSession(currentSession, (session) => {
      session.mask.modelConfig.providerName = provider;
      session.mask.modelConfig.model = model as any;
      session.mask.modelConfig = sanitizeModelConfigForCapability(
        session.mask.modelConfig,
      );
    });
  };

  const refreshAllProfilesForSync = async () => {
    const accessState = useAccessStore.getState();
    const allProfiles = accessState.apiProfiles;
    setModelFetchStatusMap({});
    const previousCloudModels = getManagedCloudModels(
      useAppConfig.getState().models || [],
      allProfiles,
    );
    const previousPlatformCounts = getCloudMergedPlatformCounts(
      previousCloudModels,
      allProfiles,
    );
    const previousCloudKeys = new Set(
      previousCloudModels.map((model) => `${model.name}@${model.provider?.id}`),
    );
    const fetchedModelEntries = new Map<
      string,
      {
        name: string;
        profileId: string;
        profileName: string;
        providerId: string;
      }
    >();
    let totalFetched = 0;

    if (allProfiles.length > 0) {
      console.log(`[API Config] 🔄 开始获取模型数据...`);
      console.log(LOG_SEPARATOR);

      for (const profile of allProfiles) {
        console.log(`[API Config] 📋 正在获取 ${profile.name} 的模型...`);
        setModelFetchStatusMap((prev) => ({
          ...prev,
          [profile.id]: {
            ...prev[profile.id],
            fetching: true,
            error: undefined,
          },
        }));

        try {
          const result = await fetchFromProvider(
            profile.provider,
            normalizeProfileBaseUrl(profile),
            profile.apiKey,
            {
              silent: true,
              throwOnError: true,
              profileName: profile.name,
              apiKeyGroups: profile.apiKeyGroups,
              multiKeyGroupOrder: profile.multiKeyGroupOrder,
            },
          );
          totalFetched += result.total;
          const providerId = getProfileProviderId(profile).toLowerCase();
          result.models.forEach((model) => {
            fetchedModelEntries.set(`${model.name}@${model.provider?.id}`, {
              name: model.name,
              profileId: profile.id,
              profileName: profile.name,
              providerId,
            });
          });
          const fetchedModels = modelsToCustomModelsString(result.models);
          const previousProfileCount = getProfileActualCount(
            profile,
            previousCloudModels,
          );
          accessStore.update((state) => {
            state.apiProfiles = (state.apiProfiles || []).map((item) =>
              item.id === profile.id
                ? {
                    ...item,
                    modelCount: result.total,
                  }
                : item,
            );
          });
          const mergedCount = getProfileActualCount(
            profile,
            useAppConfig.getState().models,
          );

          setModelFetchStatusMap((prev) => ({
            ...prev,
            [profile.id]: {
              count: result.total,
              fetching: false,
              error: undefined,
            },
          }));
          console.log(`[API Config] ✅ ${profile.name} 获取完成`);
          console.log(`远程: ${result.total} 个`);
          console.log(`云端原有: ${previousProfileCount} 个`);
          console.log(`合并后: ${mergedCount} 个`);
          console.log(LOG_SEPARATOR);
        } catch (error) {
          // 获取失败时，使用本地已有的模型数据
          const localModels = useAppConfig.getState().models || [];
          const providerId = getProfileProviderId(profile).toLowerCase();
          const profileModels = localModels.filter((model) => {
            const modelProviderId = String(
              model?.provider?.id || "",
            ).toLowerCase();
            return modelProviderId === providerId;
          });

          const localCount = profileModels.length;
          totalFetched += localCount;
          profileModels.forEach((model) => {
            fetchedModelEntries.set(`${model.name}@${model.provider?.id}`, {
              name: model.name,
              profileId: profile.id,
              profileName: profile.name,
              providerId,
            });
          });

          const previousProfileCount = getProfileActualCount(
            profile,
            previousCloudModels,
          );

          setModelFetchStatusMap((prev) => ({
            ...prev,
            [profile.id]: {
              count: localCount,
              fetching: false,
              error:
                error instanceof Error
                  ? error.message
                  : "获取模型失败，已使用本地数据",
            },
          }));
          console.warn(
            `[API Config] ⚠️ ${profile.name} 获取失败，使用本地 ${localCount} 个模型`,
            error,
          );
          console.log(`本地: ${localCount} 个`);
          console.log(`云端原有: ${previousProfileCount} 个`);
          console.log(LOG_SEPARATOR);
        }
      }
    }

    return {
      previousCloudKeys,
      previousPlatformCounts,
      fetchedModelEntries,
      totalFetched,
    };
  };

  const logSyncSummary = (
    title: string,
    previousCloudKeys: Set<string>,
    previousPlatformCounts: Array<{ name: string; count: number }>,
    fetchedModelEntries: Map<
      string,
      {
        name: string;
        profileId: string;
        profileName: string;
        providerId: string;
      }
    >,
    totalFetched: number,
  ) => {
    if (fetchedModelEntries.size === 0) return;

    const addedModels = [...fetchedModelEntries.entries()]
      .filter(([key]) => !previousCloudKeys.has(key))
      .map(([, entry]) => `${entry.name} @ ${entry.profileName}`);
    const mergedProfiles = getCloudMergedPlatformCounts(
      useAppConfig.getState().models || [],
      useAccessStore.getState().apiProfiles,
    );
    // console.log(`[API Config] 📊 ${title}`);
    // console.log(
    //   `[API Config] - 云端之前总数: ${previousCloudKeys.size} 个模型`,
    // );
    // console.log(`[API Config] - 本次获取总数: ${totalFetched} 个模型`);
    // console.log(`[API Config] - 本次新增总数: ${addedModels.length} 个模型`);
    // const previousPlatformCountMap = new Map(
    //   previousPlatformCounts.map((item) => [item.name, item.count]),
    // );
    // mergedProfiles.forEach(({ name, count }) => {
    //   const previousCount = previousPlatformCountMap.get(name) ?? 0;
    //   const delta = count - previousCount;
    //   console.log(
    //     `[API Config] - ${name}: ${previousCount} -> ${count} 个模型 (${formatModelDelta(
    //       delta,
    //     )})`,
    //   );
    // });
    // if (addedModels.length > 0) {
    //   addedModels.forEach((name) => {
    //     console.log(`[API Config] - 新增: ${name}`);
    //   });
    // }
    // console.log(LOG_SEPARATOR);
  };

  const syncToDatabase = async () => {
    console.clear();
    console.log("===== 💾 API配置保存并同步 =====");
    console.log("[API Config] 🚀 开始保存并同步到 PostgreSQL...");
    try {
      setSyncing(true);
      await runWithManualDatabaseSyncActive(async () => {
        syncStore.cancelQueuedAutoSync?.();
        await runWithImmediateStoreSyncPaused(async () => {
          ensureDatabaseSyncProvider();
          await ensureRemoteAccessProfilesLoaded();
          const activeProfile = accessStore.apiProfiles.find(
            (profile) => profile.enabled,
          );
          if (activeProfile) {
            syncProfileToAccess(activeProfile.id, { skipFetchModels: true });
          }
        });

        await syncStore.sync([...SYNC_STORE_KEYS], {
          force: true,
          manual: true,
        });
        const client = syncStore.getClient() as any;
        await refreshDatabaseMetaSafely(
          client,
          SYNC_STORE_KEYS,
          updateStoredMeta,
        );

        const syncedUserModelCount = countUserAddedModels(
          useAppConfig.getState().customModels,
        );
        console.log("[API Config] ✅ 保存并同步完成");
        console.log(LOG_SEPARATOR);
        console.log(
          `[API Config] ✅ 已同步用户添加模型: ${syncedUserModelCount} 个`,
        );
        console.log(
          "[API Config] ℹ️ 本次未刷新供应商完整模型缓存，仅同步用户数据与界面偏好",
        );
        console.log(LOG_SEPARATOR);
        console.log("===== ✅ API配置保存并同步完成 =====");

        showToast("已同步全部配置、用户已添加模型和对话记录到 PostgreSQL");
      });
    } catch (error) {
      console.error("[API Config] ❌ 数据库同步失败:", error);
      showToast("同步到 PostgreSQL 失败，请检查数据库连接");
    } finally {
      setSyncing(false);
    }
  };

  const ensureDatabaseSyncProvider = () => {
    syncStore.update((state) => {
      state.provider = ProviderType.Database;
    });
  };

  const backupToDatabase = async () => {
    console.log("[API Config] ⬆️ 开始上传到数据库...");
    try {
      setBackingUp(true);
      await runWithImmediateStoreSyncPaused(async () => {
        syncStore.cancelQueuedAutoSync?.();
        const idle = await waitForSyncIdleSafely({ timeoutMs: 8000 });
        if (!idle) {
          console.warn(
            "[API Config] ⚠️ 等待同步空闲超时，继续执行上传（可能存在后台同步任务）",
          );
        }
        {
          ensureDatabaseSyncProvider();
          const activeProfile = accessStore.apiProfiles.find(
            (profile) => profile.enabled,
          );
          if (activeProfile) {
            syncProfileToAccess(activeProfile.id, { skipFetchModels: true });
          }

          const syncedUserModelCount = countUserAddedModels(
            useAppConfig.getState().customModels,
          );
          console.log("[API Config] ⏳ 本地快照已准备，等待数据库写入完成...");
          console.log(LOG_SEPARATOR);
          const client = syncStore.getClient() as any;
          const localState = getLocalAppState();

          console.log(
            `[API Config] 📦 准备上传 ${SYNC_STORE_KEYS.length} 个数据块`,
          );

          for (const key of SYNC_STORE_KEYS) {
            const storeData = localState[key as keyof AppState];
            console.log(`[API Config] 📤 正在写入数据库: ${key}...`);
            await client.set(key, stringifyPersistedStoreState(key, storeData));
          }

          syncStore.markSyncTime();
          await refreshDatabaseMetaSafely(
            client,
            SYNC_STORE_KEYS,
            updateStoredMeta,
          );

          console.log("[API Config] ✅ 上传到数据库完成");
          console.log(
            `[API Config] ✅ 已上传用户添加模型: ${syncedUserModelCount} 个`,
          );
          console.log(
            "[API Config] ℹ️ 本次未上传供应商完整模型缓存，仅上传用户数据与界面偏好",
          );
          console.log(LOG_SEPARATOR);
          showToast("已上传全部配置、用户已添加模型和对话记录到 PostgreSQL");
        }
      });
    } catch (error) {
      console.error("[API Config] ❌ 数据库写入失败:", error);
      showToast("上传全部配置到 PostgreSQL 失败");
    } finally {
      setBackingUp(false);
    }
  };

  const downloadAllAndOverwriteLocalFromDatabase = async () => {
    const confirmed = await showConfirm(
      "确定要从数据库下载全部配置、对话和已添加模型，并完全覆盖本地吗？本地当前数据将被替换。",
    );
    if (!confirmed) return;

    console.log("[API Config] ⬇️ 开始从数据库下载并覆盖本地...");
    try {
      setDownloading(true);
      await runWithImmediateStoreSyncPaused(async () => {
        syncStore.cancelQueuedAutoSync?.();
        const idle = await waitForSyncIdleSafely({ timeoutMs: 8000 });
        if (!idle) {
          console.warn(
            "[API Config] ⚠️ 等待同步空闲超时，继续执行下载（可能存在后台同步任务）",
          );
        }
        ensureDatabaseSyncProvider();
        const client = syncStore.getClient() as any;
        const localState = getLocalAppState();
        const nextState = { ...localState } as AppState;
        const fallbackKeys: string[] = [];
        const localAccessProfiles = Array.isArray(
          (localState[StoreKey.Access] as any)?.apiProfiles,
        )
          ? ((localState[StoreKey.Access] as any)?.apiProfiles as any[]) || []
          : [];

        console.log(
          `[API Config] 📦 准备下载 ${SYNC_STORE_KEYS.length} 个数据块`,
        );

        for (const key of SYNC_STORE_KEYS) {
          console.log(`[API Config] 📥 正在下载: ${key}...`);
          const remoteStateText = await client.get(key);
          if (!remoteStateText || remoteStateText === "") {
            console.warn(
              `[API Config] ⚠️ ${key}: 数据库无数据，保留本地当前数据`,
            );
            fallbackKeys.push(key);
            continue;
          }

          try {
            const parsedState = parseStoreStatePayload(remoteStateText);
            (nextState as Record<string, unknown>)[key] =
              normalizeDownloadedStoreState(
                key,
                parsedState,
                (localState[StoreKey.Access] || {}) as Record<string, any>,
              );
          } catch (error) {
            console.warn(
              `[API Config] ⚠️ ${key}: 云端数据不可用，保留本地当前数据`,
              error,
            );
            fallbackKeys.push(key);
            continue;
          }

          if (key === StoreKey.Access) {
            const debugAccessState = (nextState as Record<string, any>)[
              key
            ] as Record<string, any>;
            console.log(
              "[API Config] 🔐 access-control 下载结果",
              (debugAccessState?.apiProfiles || [])
                .slice(0, 3)
                .map((profile: any) => ({
                  id: profile.id,
                  name: profile.name,
                  apiKey: profile.apiKey,
                  modelFetchApiKey: profile.modelFetchApiKey,
                })),
            );
          }
          console.log(`[API Config] ✅ ${key}: 下载成功`);
        }

        const nextAccessProfiles = Array.isArray(
          (nextState[StoreKey.Access] as any)?.apiProfiles,
        )
          ? ((nextState[StoreKey.Access] as any)?.apiProfiles as any[]) || []
          : [];

        if (
          localAccessProfiles.length === 0 &&
          nextAccessProfiles.length === 0
        ) {
          console.warn(
            "[API Config] ⚠️ 数据库中的 access-control 为空或不可用，将保留当前本地 API 配置状态",
          );
          fallbackKeys.push(StoreKey.Access);
        }

        console.log("[API Config] 🔧 正在用数据库快照覆盖本地...");
        setLocalAppState(nextState);
        const latestAccessState = useAccessStore.getState();
        const latestActiveProfile = latestAccessState.apiProfiles.find(
          (profile) => profile.enabled,
        );

        if (latestActiveProfile) {
          syncProfileToAccess(latestActiveProfile.id, {
            skipFetchModels: true,
          });
        } else {
          applyProviderToChat(latestAccessState.provider);
        }

        syncStore.markSyncTime();
        await refreshDatabaseMetaSafely(
          client,
          SYNC_STORE_KEYS,
          updateStoredMeta,
        );

        console.log("[API Config] ✅ 从数据库下载并覆盖本地完成");
        console.log(LOG_SEPARATOR);
        if (fallbackKeys.length > 0) {
          console.warn(
            `[API Config] ⚠️ 以下数据块缺失或格式异常，已保留本地数据: ${fallbackKeys.join(
              ", ",
            )}`,
          );
          showToast(
            `已完成下载，以下数据块因云端为空或格式异常而保留本地数据：${fallbackKeys.join(
              ", ",
            )}`,
          );
        } else {
          showToast(
            "已从 PostgreSQL 下载全部配置、对话和已添加模型，并覆盖本地",
          );
        }
      });
    } catch (error) {
      console.error("[API Config] ❌ 数据库下载失败:", error);
      showToast(
        "从 PostgreSQL 下载并覆盖本地失败: " + (error as Error).message,
      );
    } finally {
      setDownloading(false);
    }
  };

  const clearLocalAndCloudModels = async () => {
    const confirmed = await showConfirm(
      "确定要清空已添加模型吗？这会删除会同步到数据库的用户已添加模型，并清空当前浏览器的临时模型缓存。",
    );
    if (!confirmed) return;

    console.log("[API Config] 🗑️ 开始清空用户已添加模型和本地临时模型缓存...");
    try {
      appConfig.update((config: any) => {
        config.models = [];
        config.customModels = "";
        config.customModelsUpdatedAt = Date.now();
      });

      accessStore.update((state) => {
        state.customModels = "";
        state.apiProfiles = state.apiProfiles.map((profile) => ({
          ...profile,
          cachedModels: undefined,
          modelCount: undefined,
        }));
      });

      useModelCacheStore.getState().clearProfileCaches();

      console.log("[API Config] ✅ 用户已添加模型和本地临时模型缓存已清空");
      console.log(LOG_SEPARATOR);
      showToast("已清空用户已添加模型和当前浏览器临时模型缓存");
    } catch (error) {
      console.error("[API Config] ❌ 清空失败:", error);
      showToast("清空本地模型数据失败");
    }
  };

  return (
    <div className={styles.page}>
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">API 配置</div>
          <div className="window-header-sub-title">
            管理多平台配置、模型刷新与 PostgreSQL 双向同步
          </div>
        </div>
        <div className="window-actions">
          <div className="window-action-button">
            <IconButton
              aria="关闭"
              icon={<CloseIcon />}
              close
              onClick={() => {
                if (window.history.length > 1) {
                  navigate(-1);
                  return;
                }
                navigate(Path.Home);
              }}
              bordered
            />
          </div>
        </div>
      </div>

      <div className={styles.content}>
        <List>
          <ListItem
            title="当前状态"
            subTitle={
              <div>
                <span className={styles.currentStatusText}>
                  {usingCustomConfig ? (
                    <>
                      已启用自定义配置，当前配置：
                      <span className={styles.profileNameHighlight}>
                        {activeVisibleProfile?.name || accessStore.provider}
                      </span>
                    </>
                  ) : (
                    "当前使用服务端默认配置"
                  )}
                </span>
              </div>
            }
          />

          {providerProfiles.length > 0 && (
            <ListItem
              title={
                <div className={styles.profileSectionTitle}>
                  <span>配置条目</span>
                  <IconButton
                    icon={<AddIcon />}
                    text=""
                    bordered
                    className={styles.addProfileButton}
                    onClick={() => {
                      accessStore.update((access) => {
                        access.lastUpdateTime = Date.now();
                        access.apiProfiles = [
                          ...access.apiProfiles,
                          createVisibleApiConfigProfile(),
                        ];
                      });
                      const latestAccessState = useAccessStore.getState();
                      writeAccessSnapshot({
                        useCustomConfig: latestAccessState.useCustomConfig,
                        provider: latestAccessState.provider,
                        apiProfiles: latestAccessState.apiProfiles,
                        customModels: latestAccessState.customModels,
                        customUrl: latestAccessState.customUrl,
                        customApiKey: latestAccessState.customApiKey,
                        customOpenAICompatible:
                          latestAccessState.customOpenAICompatible,
                      });
                    }}
                  />
                </div>
              }
              subTitle="仅显示 YutoAPI 与 AihubMix 的 Base URL 与 API Key"
              vertical
            >
              <div className={styles.profileList}>
                <div className={styles.profileTable}>
                  <div className={styles.profileTableHeader}>
                    <div className={styles.profileColProvider}>平台</div>
                    <div className={styles.profileColName}>名称</div>
                    <div className={styles.profileColBaseUrl}>Base URL</div>
                    <div className={styles.profileColApiKey}>API Key</div>
                    <div className={styles.profileColCompatible}>
                      OPENAI兼容
                    </div>
                    <div className={styles.profileColMultiKey}>是否多key</div>
                    <div className={styles.profileColActions}>操作</div>
                  </div>

                  {providerProfiles.map((profile, index) => (
                    <div key={profile.id} className={styles.profileRow}>
                      <div
                        className={`${styles.profileCell} ${styles.profileColProvider}`}
                      >
                        <div className={styles.profileCellLabel}>平台</div>
                        <Select
                          value={profile.provider}
                          onChange={(e) => {
                            const provider = e.currentTarget
                              .value as ServiceProvider;
                            accessStore.update((access) => {
                              const nextAccess = access as AccessState;
                              access.apiProfiles = access.apiProfiles.map(
                                (item) =>
                                  item.id === profile.id
                                    ? {
                                        ...item,
                                        provider,
                                        baseUrl: getProfileBaseUrl(
                                          provider,
                                          nextAccess,
                                        ),
                                        apiKey: getProfileApiKey(
                                          provider,
                                          nextAccess,
                                        ),
                                        openAICompatible:
                                          provider === ServiceProvider.Custom
                                            ? nextAccess.customOpenAICompatible
                                            : undefined,
                                      }
                                    : item,
                              );
                            });
                            if (profile.enabled) {
                              syncProfileToAccess(profile.id);
                            }
                          }}
                        >
                          {PROVIDER_OPTIONS.map((provider) => (
                            <option key={provider} value={provider}>
                              {provider}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div
                        className={`${styles.profileCell} ${styles.profileColName}`}
                      >
                        <div className={styles.profileCellLabel}>名称</div>
                        <input
                          className={styles.textInput}
                          type="text"
                          placeholder={`${profile.provider} #${index + 1}`}
                          value={profile.name}
                          onChange={(e) => {
                            accessStore.update((access) => {
                              access.apiProfiles = access.apiProfiles.map(
                                (item) =>
                                  item.id === profile.id
                                    ? { ...item, name: e.currentTarget.value }
                                    : item,
                              );
                            });
                          }}
                        />
                      </div>

                      <div
                        className={`${styles.profileCell} ${styles.profileColBaseUrl}`}
                      >
                        <div className={styles.profileCellLabel}>Base URL</div>
                        <input
                          className={styles.textInput}
                          type="text"
                          placeholder={
                            (PROVIDER_FIELDS[profile.provider] ?? []).find(
                              (f) =>
                                String(f.key).toLowerCase().includes("url"),
                            )?.placeholder
                          }
                          value={normalizeProfileBaseUrl(profile)}
                          disabled={isOfficialProviderBaseUrlLocked(
                            profile.provider,
                          )}
                          title={
                            isOfficialProviderBaseUrlLocked(profile.provider)
                              ? "官方配置使用固定 Base URL，不可修改"
                              : undefined
                          }
                          onChange={(e) => {
                            if (
                              isOfficialProviderBaseUrlLocked(profile.provider)
                            ) {
                              return;
                            }
                            const nextValue = e.currentTarget.value;
                            accessStore.update((access) => {
                              access.apiProfiles = access.apiProfiles.map(
                                (item) =>
                                  item.id === profile.id
                                    ? { ...item, baseUrl: nextValue }
                                    : item,
                              );
                            });
                            if (profile.enabled) {
                              syncProfileToAccess(profile.id);
                            }
                          }}
                        />
                      </div>

                      <div
                        className={`${styles.profileCell} ${styles.profileColApiKey}`}
                      >
                        <div className={styles.profileCellLabel}>API Key</div>
                        {profile.multiKeyEnabled ? (
                          <div className={styles.profileApiKeyEditor}>
                            <button
                              type="button"
                              className={`${styles.textInput} ${styles.profileApiKeyButton}`}
                              onClick={() =>
                                setEditingYutoProfileId(profile.id)
                              }
                            >
                              点击编辑分组
                            </button>
                          </div>
                        ) : (
                          <input
                            className={styles.textInput}
                            type="text"
                            placeholder="API Key"
                            value={profile.apiKey}
                            onChange={(e) => {
                              const nextValue = e.currentTarget.value;
                              accessStore.update((access) => {
                                access.apiProfiles = access.apiProfiles.map(
                                  (item) =>
                                    item.id === profile.id
                                      ? { ...item, apiKey: nextValue }
                                      : item,
                                );
                              });
                              if (profile.enabled) {
                                syncProfileToAccess(profile.id, {
                                  skipFetchModels: true,
                                });
                              }
                            }}
                          />
                        )}
                      </div>

                      <div
                        className={`${styles.profileCell} ${styles.profileColCompatible}`}
                      >
                        <div className={styles.profileCellLabel}>兼容</div>
                        <label className={styles.profileCheck}>
                          <input
                            type="checkbox"
                            checked={profile.openAICompatible ?? true}
                            onChange={(e) => {
                              accessStore.update((access) => {
                                access.apiProfiles = access.apiProfiles.map(
                                  (item) =>
                                    item.id === profile.id
                                      ? {
                                          ...item,
                                          openAICompatible:
                                            e.currentTarget.checked,
                                        }
                                      : item,
                                );
                              });
                              if (profile.enabled) {
                                syncProfileToAccess(profile.id);
                              }
                            }}
                          />
                          <span>
                            {profile.openAICompatible ?? true ? "是" : "否"}
                          </span>
                        </label>
                      </div>

                      <div
                        className={`${styles.profileCell} ${styles.profileColMultiKey}`}
                      >
                        <div className={styles.profileCellLabel}>是否多key</div>
                        <label className={styles.profileCheck}>
                          <input
                            type="checkbox"
                            checked={Boolean(profile.multiKeyEnabled)}
                            onChange={(e) => {
                              const checked = e.currentTarget.checked;
                              accessStore.update((access) => {
                                access.lastUpdateTime = Date.now();
                                access.apiProfiles = access.apiProfiles.map(
                                  (item) => {
                                    if (item.id !== profile.id) return item;

                                    const currentGroups =
                                      normalizeMultiKeyGroups(
                                        item.apiKeyGroups,
                                        item,
                                      );
                                    if (!checked) {
                                      multiKeyDraftGroupsRef.current[item.id] =
                                        currentGroups;
                                      return {
                                        ...item,
                                        multiKeyEnabled: false,
                                        apiKeyGroups: item.apiKeyGroups,
                                      };
                                    }

                                    const draftGroups =
                                      multiKeyDraftGroupsRef.current[item.id];
                                    const nextGroups =
                                      draftGroups || currentGroups;
                                    return {
                                      ...item,
                                      multiKeyEnabled: true,
                                      apiKeyGroups: nextGroups,
                                      multiKeyGroupOrder:
                                        normalizeMultiKeyGroupOrder(
                                          item.multiKeyGroupOrder,
                                          nextGroups,
                                        ),
                                    };
                                  },
                                );
                              });
                              if (profile.enabled) {
                                syncProfileToAccess(profile.id);
                              }
                            }}
                          />
                          <span>{profile.multiKeyEnabled ? "是" : "否"}</span>
                        </label>
                      </div>

                      <div
                        className={`${styles.profileCell} ${styles.profileColActions}`}
                      >
                        <div className={styles.profileCellLabel}>操作</div>
                        <div className={styles.profileRowActions}>
                          <IconButton
                            text="删除"
                            type="danger"
                            bordered
                            className={styles.dangerButton}
                            onClick={async () => {
                              const confirmed = await showConfirm(
                                `确定要删除配置"${profile.name}"吗？`,
                              );
                              if (confirmed) {
                                accessStore.update((access) => {
                                  access.apiProfiles =
                                    access.apiProfiles.filter(
                                      (item) => item.id !== profile.id,
                                    );
                                });
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {editingYutoProfileId ? (
                (() => {
                  const editingProfile = providerProfiles.find(
                    (profile) => profile.id === editingYutoProfileId,
                  );
                  if (!editingProfile) return <></>;

                  return (
                    <div
                      className={`modal-mask ${styles.profileYutoModalMask}`}
                    >
                      <div className={styles.profileYutoModalContainer}>
                        <div className={styles.profileYutoModalHeader}>
                          <div className={styles.profileYutoModalTitle}>
                            {`${editingProfile.name} 分组 API Key`}
                          </div>
                          <button
                            type="button"
                            aria-label="关闭"
                            data-close-button="true"
                            className={styles.profileYutoModalClose}
                            onClick={() => {
                              setEditingYutoProfileId("");
                            }}
                          >
                            <CloseIcon />
                          </button>
                        </div>
                        <div className={styles.profileYutoModalBody}>
                          <div className={styles.profileYutoKeyGrid}>
                            {(function () {
                              const apiKeyGroups = normalizeMultiKeyGroups(
                                editingProfile.apiKeyGroups,
                                editingProfile,
                              );
                              const groupOrder = normalizeMultiKeyGroupOrder(
                                editingProfile.multiKeyGroupOrder,
                                apiKeyGroups,
                              );

                              return groupOrder.map((group, index) => {
                                const hasGroupKey = Boolean(
                                  String(apiKeyGroups[group] || "").trim(),
                                );
                                const previousGroup = groupOrder[index - 1];
                                const nextGroup = groupOrder[index + 1];
                                const canMoveUp =
                                  Boolean(previousGroup) &&
                                  hasGroupKey &&
                                  Boolean(
                                    String(
                                      apiKeyGroups[previousGroup] || "",
                                    ).trim(),
                                  );
                                const canMoveDown =
                                  Boolean(nextGroup) &&
                                  hasGroupKey &&
                                  Boolean(
                                    String(
                                      apiKeyGroups[nextGroup] || "",
                                    ).trim(),
                                  );

                                return (
                                  <div
                                    key={group}
                                    className={styles.profileYutoKeyItem}
                                  >
                                    <div className={styles.profileYutoKeyInner}>
                                      <div
                                        className={styles.profileYutoKeyHeader}
                                      >
                                        <div
                                          className={styles.profileCellLabel}
                                        >
                                          {`分组${index + 1}`}
                                        </div>
                                      </div>
                                      <div
                                        className={
                                          styles.profileYutoKeyDescription
                                        }
                                      >
                                        {`分组${index + 1}`}
                                      </div>
                                      <div
                                        className={styles.profileYutoInputRow}
                                      >
                                        <input
                                          className={styles.textInput}
                                          type="text"
                                          placeholder="留空则不尝试请求"
                                          value={apiKeyGroups[group] ?? ""}
                                          onChange={(e) => {
                                            const nextValue =
                                              e.currentTarget.value;
                                            updateMultiKeyGroups(
                                              editingProfile.id,
                                              {
                                                ...apiKeyGroups,
                                                [group]: nextValue,
                                              },
                                            );
                                          }}
                                        />
                                        <div
                                          className={
                                            styles.profileYutoOrderActions
                                          }
                                        >
                                          <button
                                            type="button"
                                            className={`${styles.profileYutoOrderButton} ${styles.profileYutoOrderButtonUp}`}
                                            disabled={!canMoveUp}
                                            title="上移"
                                            aria-label="上移"
                                            onClick={() => {
                                              if (!previousGroup) return;
                                              moveMultiKeyGroup(
                                                editingProfile.id,
                                                group,
                                                previousGroup,
                                                apiKeyGroups,
                                                groupOrder,
                                              );
                                            }}
                                          ></button>
                                          <button
                                            type="button"
                                            className={
                                              styles.profileYutoOrderButton
                                            }
                                            disabled={!canMoveDown}
                                            title="下移"
                                            aria-label="下移"
                                            onClick={() => {
                                              if (!nextGroup) return;
                                              moveMultiKeyGroup(
                                                editingProfile.id,
                                                group,
                                                nextGroup,
                                                apiKeyGroups,
                                                groupOrder,
                                              );
                                            }}
                                          ></button>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                        <div className={styles.profileYutoModalFooter}>
                          <IconButton
                            type="primary"
                            text="关闭"
                            icon={<ConfirmIcon />}
                            onClick={() => {
                              setEditingYutoProfileId("");
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })()
              ) : (
                <></>
              )}
            </ListItem>
          )}

          {extraFields.length > 0 && (
            <ListItem title="附加配置" subTitle="当前平台的额外字段" vertical>
              <div className={styles.fieldGroup}>
                {extraFields.map((field) => {
                  const value = String(accessStore[field.key] ?? "");

                  return (
                    <div key={String(field.key)} className={styles.fieldItem}>
                      <div className={styles.fieldLabel}>{field.label}</div>
                      {field.subTitle && (
                        <div className={styles.fieldSubTitle}>
                          {field.subTitle}
                        </div>
                      )}
                      <input
                        className={styles.textInput}
                        aria-label={field.label}
                        type="text"
                        placeholder={field.placeholder}
                        value={value}
                        onChange={(e) => {
                          accessStore.update((access) => {
                            (access as any)[field.key] = e.currentTarget.value;
                          });
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </ListItem>
          )}

          <ListItem
            className={styles.syncCard}
            title={
              <div className={styles.syncCardTitle}>
                <div className={styles.syncCardTitleMain}>数据库同步</div>
                <div className={styles.syncCardTitleSub}>
                  当前页面会保存多个平台的配置。你可以为每条配置单独选择平台，启用某条后会同步更新当前聊天默认平台；用户已添加模型、API
                  配置、聊天、插件、提示词和面具等数据会一起同步到 PostgreSQL。
                </div>
              </div>
            }
            subTitle={
              <>
                <div>同步方式：通过服务端 API 直接读写 PostgreSQL。</div>
                <div>目标数据库：{dbSyncTargetLabel}</div>
                <div>
                  上传到数据库：把本地聊天、插件、设置、用户已添加模型、提示词、面具、更新状态和绘图等数据写入数据库，不上传供应商完整模型列表。
                </div>
                <div>
                  保存并同步：和 PostgreSQL
                  执行双向合并，最后把最新配置、用户已添加模型和对话记录回写到本地与数据库。
                </div>
                <div>
                  从数据库下载：读取 PostgreSQL 中的完整快照，覆盖本地对话、API
                  配置、用户已添加模型、插件、提示词、面具和绘图记录；供应商模型列表会在管理模型时按需本地拉取。
                </div>
              </>
            }
            vertical
          >
            <div className={styles.actions}>
              <div className={styles.actionPrimaryRow}>
                <IconButton
                  icon={backingUp ? <LoadingIcon /> : <UploadIcon />}
                  text={backingUp ? "上传中..." : "上传到数据库"}
                  bordered
                  disabled={syncActionDisabled}
                  onClick={() => {
                    void backupToDatabase();
                  }}
                />
                <IconButton
                  icon={syncing ? <LoadingIcon /> : <ConfirmIcon />}
                  text={syncing ? "同步中..." : "保存并同步"}
                  type="primary"
                  bordered
                  disabled={syncActionDisabled}
                  onClick={() => {
                    void syncToDatabase();
                  }}
                />
                <IconButton
                  icon={downloading ? <LoadingIcon /> : <DownloadIcon />}
                  text={downloading ? "下载中..." : "从数据库下载"}
                  bordered
                  disabled={syncActionDisabled}
                  onClick={() => {
                    void downloadAllAndOverwriteLocalFromDatabase();
                  }}
                />
                <IconButton
                  icon={<TrashIcon />}
                  text="清空已添加模型"
                  bordered
                  type="danger"
                  className={styles.dangerButton}
                  onClick={() => {
                    void clearLocalAndCloudModels();
                  }}
                />
              </div>
            </div>
          </ListItem>
        </List>
      </div>
    </div>
  );
}
