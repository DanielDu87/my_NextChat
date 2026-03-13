import { useState, useEffect, useRef } from "react";

import styles from "./api-config.module.scss";

import CloseIcon from "../icons/close.svg";
import ConfirmIcon from "../icons/confirm.svg";
import LoadingIcon from "../icons/three-dots.svg";
import UploadIcon from "../icons/upload.svg";
import DownloadIcon from "../icons/download.svg";
import RobotIcon from "../icons/robot.svg";
import TrashIcon from "../icons/trash.svg";

import { IconButton } from "./button";
import { List, ListItem, Select, showToast, showConfirm } from "./ui-lib";
import AddIcon from "../icons/add.svg";
import {
  AI302,
  Alibaba,
  Anthropic,
  Azure,
  Baidu,
  ByteDance,
  ChatGLM,
  DeepSeek,
  DEFAULT_MODELS,
  Google,
  Iflytek,
  Moonshot,
  OPENAI_BASE_URL,
  Path,
  ServiceProvider,
  SiliconFlow,
  Stability,
  Tencent,
  XAI,
} from "../constant";
import { STORAGE_KEY } from "../constant";
import { StoreKey } from "../constant";
import { useAccessStore, useAppConfig, useChatStore } from "../store";
import { useSyncStore } from "../store/sync";
import { ProviderType } from "../utils/cloud";
import { AppState, getLocalAppState, setLocalAppState } from "../utils/sync";
import { writeAccessSnapshot } from "../utils/access-snapshot";
import { LLMModel } from "../client/api";
import { useNavigate } from "react-router-dom";
import { useModelFetcher } from "../utils/useModelFetcher";
import { getProviderDisplayName } from "../utils/models";

type AccessState = ReturnType<typeof useAccessStore.getState>;
type ModelFetchStatus = {
  count?: number;
  fetching?: boolean;
  error?: string;
};

type ProviderField = {
  key: keyof AccessState;
  label: string;
  placeholder?: string;
  subTitle?: string;
  profileManaged?: boolean;
};

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
] as const;

const SYNC_STORE_KEYS: StoreKey[] = [
  StoreKey.Chat,
  StoreKey.Access,
  StoreKey.Config,
  StoreKey.Mask,
  StoreKey.Prompt,
];

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
};

function getProfileBaseUrl(
  provider: ServiceProvider,
  accessStore: AccessState,
) {
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
    default:
      return "";
  }
}

function createProfile(provider: ServiceProvider, accessStore: AccessState) {
  return {
    id: `profile_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: `${provider} ${new Date().toLocaleTimeString()}`,
    provider,
    baseUrl: getProfileBaseUrl(provider, accessStore),
    apiKey: getProfileApiKey(provider, accessStore),
    enabled: false,
    openAICompatible:
      provider === ServiceProvider.Custom
        ? accessStore.customOpenAICompatible
        : undefined,
  };
}

function getDefaultModelForProvider(
  provider: ServiceProvider,
  models: LLMModel[],
): string | undefined {
  if (provider === ServiceProvider.Custom) {
    return (
      DEFAULT_MODELS.find(
        (m) => m.provider?.providerName === ServiceProvider.OpenAI,
      )?.name ?? "gpt-4o-mini"
    );
  }
  const fromStore = models.find((m) => m.provider?.providerName === provider)
    ?.name;
  if (fromStore) return fromStore;
  return DEFAULT_MODELS.find((m) => m.provider?.providerName === provider)
    ?.name;
}

export function ApiConfigPage() {
  const navigate = useNavigate();
  const accessStore = useAccessStore();
  const appConfig = useAppConfig();
  const chatStore = useChatStore();
  const syncStore = useSyncStore();
  const [syncing, setSyncing] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [isTightMode, setIsTightMode] = useState(false);
  const [modelFetchStatusMap, setModelFetchStatusMap] = useState<
    Partial<Record<string, ModelFetchStatus>>
  >({});
  const { fetchFromProvider, loading: fetchingModels } = useModelFetcher();

  // 检测是否是沾满模式
  useEffect(() => {
    const checkTightMode = () => {
      // 全局查询 tight-container 类
      const hasTightContainer =
        document.querySelector('[class*="tight-container"]') !== null;
      setIsTightMode(!!hasTightContainer);
    };

    // 初始检查
    checkTightMode();

    // 监听 DOM 变化
    const observer = new MutationObserver(checkTightMode);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const styleId = "small-modal-style";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        .modal-mask .modal-container {
          max-width: 400px !important;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // 注入全局样式 - 只影响 API 配置页面的表格
  useEffect(() => {
    const styleId = "api-config-styles";
    const styleElement =
      (document.getElementById(styleId) as HTMLStyleElement) ||
      document.createElement("style");
    styleElement.id = styleId;

    // 只在非沾满模式下（有留白）应用样式
    styleElement.textContent = `
      /* 当前模式: ${isTightMode ? "沾满" : "有留白"} */
      .api-config_profileTable,
      div[class*="api-config_profileTable"] {
        ${
          !isTightMode
            ? `
        /* 隐藏 select 下拉箭头 - 有留白模式 */
        .select-with-icon-icon,
        [class*="select-with-icon-icon"] {
          display: none !important;
        }

        /* 去除 select 的左右 padding - 有留白模式 */
        .select-with-icon-select,
        [class*="select-with-icon-select"] {
          padding-left: 0 !important;
          padding-right: 0 !important;
        }
        `
            : `
        /* 沾满模式 - 不修改样式 */
        `
        }
      }
    `;

    if (!document.getElementById(styleId)) {
      document.head.appendChild(styleElement);
    }
  }, [isTightMode]);

  const usingCustomConfig = accessStore.useCustomConfig;

  const providerFields = PROVIDER_FIELDS[accessStore.provider] ?? [];
  const extraFields = providerFields.filter((f) => !f.profileManaged);
  const providerProfiles = accessStore.apiProfiles;
  const webdavEndpoint = syncStore.webdav.endpoint.trim();
  const allowedWebDavEndpoints = accessStore.allowedWebDavEndpoints ?? [];
  const fallbackWebdavEndpoint =
    allowedWebDavEndpoints
      .find((endpoint) => endpoint.trim().length > 0)
      ?.trim() ?? "";
  const webdavBasePath =
    webdavEndpoint || fallbackWebdavEndpoint || "未获取到 WebDAV 地址";
  const webdavFolderPath = `${webdavBasePath.replace(
    /\/?$/,
    "/",
  )}${STORAGE_KEY}/`;

  // 计算所有已配置供应商的模型总数（从持久化的 modelCount 计算）
  const allProfiles = accessStore.apiProfiles;

  // 从持久化的 modelCount 计算总数（优先从 cachedModels 计算）
  const totalModelCountFromCache = allProfiles.reduce((sum, profile) => {
    // 优先使用 cachedModels 计算实际数量
    if (profile.cachedModels) {
      return sum + profile.cachedModels.split(",").filter(Boolean).length;
    }
    return sum + (profile.modelCount ?? 0);
  }, 0);

  // 页面加载时输出缓存的模型数量（延迟到云端同步完成后）
  const cacheLoggedRef = useRef(false);
  const logModelCount = () => {
    if (cacheLoggedRef.current) return;
    cacheLoggedRef.current = true;

    const currentProfiles = useAccessStore.getState().apiProfiles;
    const totalCount = currentProfiles.reduce((sum, profile) => {
      const count = profile.cachedModels
        ? profile.cachedModels.split(",").filter(Boolean).length
        : profile.modelCount ?? 0;
      return sum + count;
    }, 0);

    if (totalCount > 0) {
      console.log(`[API Config] 📦 已加载 ${totalCount} 个远程模型`);
      currentProfiles.forEach((p) => {
        const count = p.cachedModels
          ? p.cachedModels.split(",").filter(Boolean).length
          : p.modelCount ?? 0;
        if (count > 0) {
          console.log(`[API Config]   - ${p.name}: ${count} 个`);
        }
      });
    }
  };

  // 云端同步逻辑（提取为函数以复用）
  const performCloudSync = async () => {
    const client = syncStore.getClient() as any;

    // 尝试下载远程配置
    const remoteConfigJson = await client.get(StoreKey.Config);
    if (remoteConfigJson) {
      const remoteConfig = JSON.parse(remoteConfigJson);
      const remoteModels = remoteConfig.models || [];
      if (remoteModels.length > 0) {
        console.log(
          `[API Config] 📦 云端有 ${remoteModels.length} 个模型，开始合并...`,
        );

        // 合并云端模型到本地
        const localModels = appConfig.models || [];
        const modelMap = new Map<string, (typeof localModels)[0]>();

        // 先添加本地所有模型
        localModels.forEach((m: any) => {
          const key = `${m.name}@${m.provider?.id}`;
          modelMap.set(key, m);
        });

        // 添加云端独有的模型
        remoteModels.forEach((m: any) => {
          const key = `${m.name}@${m.provider?.id}`;
          if (!modelMap.has(key)) {
            modelMap.set(key, m);
          } else {
            // 同名模型：如果本地不可用但云端可用，更新为可用
            const existing = modelMap.get(key)!;
            if (!existing.available && m.available) {
              modelMap.set(key, { ...existing, available: true });
            }
          }
        });

        const mergedModels = [...modelMap.values()];
        appConfig.mergeModels(mergedModels);
        console.log(
          `[API Config] ✅ 云端模型合并完成，共 ${mergedModels.length} 个模型`,
        );
      }
    }

    // 同样处理 Access store 中的 apiProfiles
    const remoteAccessJson = await client.get(StoreKey.Access);
    if (remoteAccessJson) {
      const remoteAccess = JSON.parse(remoteAccessJson);
      const remoteProfiles = remoteAccess.apiProfiles || [];
      if (remoteProfiles.length > 0) {
        console.log(
          `[API Config] 📦 云端有 ${remoteProfiles.length} 个配置，开始合并...`,
        );

        // 合并云端配置到本地
        accessStore.update((state) => {
          const localProfileMap = new Map(
            (state.apiProfiles || []).map((p: any) => [p.id, p]),
          );
          const mergedProfiles = [...(state.apiProfiles || [])];

          remoteProfiles.forEach((remoteProfile: any) => {
            if (!localProfileMap.has(remoteProfile.id)) {
              mergedProfiles.push(remoteProfile);
            } else {
              // 同 ID 配置：合并 cachedModels
              const localIndex = mergedProfiles.findIndex(
                (p: any) => p.id === remoteProfile.id,
              );
              if (localIndex >= 0) {
                const local = mergedProfiles[localIndex];
                const localModels = new Set(
                  (local.cachedModels || "").split(",").filter(Boolean),
                );
                const remoteModels = new Set(
                  (remoteProfile.cachedModels || "").split(",").filter(Boolean),
                );
                remoteModels.forEach((m: unknown) =>
                  localModels.add(m as string),
                );
                mergedProfiles[localIndex] = {
                  ...local,
                  cachedModels: [...localModels].join(","),
                  modelCount: Math.max(
                    local.modelCount || 0,
                    remoteProfile.modelCount || 0,
                  ),
                };
              }
            }
          });

          state.apiProfiles = mergedProfiles;
        });
        console.log(`[API Config] ✅ 云端配置合并完成`);
      }
    }

    // 同步完成后输出最终的模型数量
    logModelCount();
  };

  // 页面加载时从云端同步模型数据（只同步，不上传）
  const initialSyncRef = useRef(false);
  useEffect(() => {
    const syncFromCloudOnLoad = async () => {
      if (initialSyncRef.current) return;
      initialSyncRef.current = true;

      // 等待 syncStore 完成水合后再检查 WebDAV 配置
      const checkInterval = setInterval(() => {
        const state = useSyncStore.getState() as any;
        const hasHydrated = state?._hasHydrated;
        console.log(
          `[API Config] 🔍 等待 store 水合... _hasHydrated=${hasHydrated}, webdav.endpoint=${
            state?.webdav?.endpoint || "(空)"
          }`,
        );

        if (hasHydrated) {
          clearInterval(checkInterval);

          // 自动配置 WebDAV（如果环境变量有配置）
          ensureWebDavEndpoint();

          const endpoint = useSyncStore.getState().webdav?.endpoint;

          if (endpoint) {
            console.log(`[API Config] 🔄 页面加载，从云端同步模型数据...`);
            performCloudSync().catch((error) => {
              console.log("[API Config] ℹ️ 云端同步跳过或失败:", error);
              logModelCount();
            });
          } else {
            console.log("[API Config] ℹ️ WebDAV 未配置，跳过云端同步");
            logModelCount();
          }
        }
      }, 200);

      // 30秒后停止检查（防止无限等待）
      setTimeout(() => clearInterval(checkInterval), 30000);
    };

    syncFromCloudOnLoad();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 从当前获取状态计算总数
  const totalModelCountFromStatus = Object.values(modelFetchStatusMap).reduce(
    (sum, status) => sum + (status?.count ?? 0),
    0,
  );

  // 使用当前状态的数量（如果正在获取或刚获取完），否则使用缓存的数量
  const totalModelCount = Object.values(modelFetchStatusMap).some(
    (s) => s?.fetching === true || s?.count !== undefined,
  )
    ? totalModelCountFromStatus
    : totalModelCountFromCache;

  const anyFetching = Object.values(modelFetchStatusMap).some(
    (status) => status?.fetching === true,
  );

  const modelFetchCount = totalModelCount > 0 ? totalModelCount : undefined;
  const modelFetchHint = anyFetching
    ? "正在获取模型..."
    : totalModelCount > 0
    ? `已获取 ${totalModelCount} 个模型`
    : fetchingModels
    ? "正在获取模型..."
    : "点击获取模型数据";
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

    void fetchFromProvider(provider, baseUrl, apiKey, { silent: true })
      .then((result) => {
        setModelFetchStatusMap((prev) => ({
          ...prev,
          [key]: {
            count: result.total,
            fetching: false,
            error: undefined,
          },
        }));

        // 🆕 保存模型数量到对应 profile 的 modelCount
        if (profileId) {
          accessStore.update((state) => {
            state.apiProfiles = state.apiProfiles.map((p) =>
              p.id === profileId ? { ...p, modelCount: result.total } : p,
            );
          });
        }

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
        console.error(
          `[API Config] ❌ 从 ${displayName} 自动获取模型失败:`,
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

    accessStore.update((access) => {
      access.customModels = selectedProfile.cachedModels ?? "";
      access.apiProfiles = access.apiProfiles.map((profile) => {
        const enabled = profile.id === profileId;
        if (!enabled) return { ...profile, enabled: false };

        switch (profile.provider) {
          case ServiceProvider.Custom:
            access.customUrl = profile.baseUrl;
            access.customApiKey = profile.apiKey;
            access.customOpenAICompatible = profile.openAICompatible ?? true;
            break;
          case ServiceProvider.OpenAI:
            access.openaiUrl = profile.baseUrl;
            access.openaiApiKey = profile.apiKey;
            break;
          case ServiceProvider.Azure:
            access.azureUrl = profile.baseUrl;
            access.azureApiKey = profile.apiKey;
            break;
          case ServiceProvider.Google:
            access.googleUrl = profile.baseUrl;
            access.googleApiKey = profile.apiKey;
            break;
          case ServiceProvider.Anthropic:
            access.anthropicUrl = profile.baseUrl;
            access.anthropicApiKey = profile.apiKey;
            break;
          case ServiceProvider.Baidu:
            access.baiduUrl = profile.baseUrl;
            access.baiduApiKey = profile.apiKey;
            break;
          case ServiceProvider.ByteDance:
            access.bytedanceUrl = profile.baseUrl;
            access.bytedanceApiKey = profile.apiKey;
            break;
          case ServiceProvider.Alibaba:
            access.alibabaUrl = profile.baseUrl;
            access.alibabaApiKey = profile.apiKey;
            break;
          case ServiceProvider.Moonshot:
            access.moonshotUrl = profile.baseUrl;
            access.moonshotApiKey = profile.apiKey;
            break;
          case ServiceProvider.Stability:
            access.stabilityUrl = profile.baseUrl;
            access.stabilityApiKey = profile.apiKey;
            break;
          case ServiceProvider.Iflytek:
            access.iflytekUrl = profile.baseUrl;
            access.iflytekApiKey = profile.apiKey;
            break;
          case ServiceProvider.XAI:
            access.xaiUrl = profile.baseUrl;
            access.xaiApiKey = profile.apiKey;
            break;
          case ServiceProvider.ChatGLM:
            access.chatglmUrl = profile.baseUrl;
            access.chatglmApiKey = profile.apiKey;
            break;
          case ServiceProvider.DeepSeek:
            access.deepseekUrl = profile.baseUrl;
            access.deepseekApiKey = profile.apiKey;
            break;
          case ServiceProvider.SiliconFlow:
            access.siliconflowUrl = profile.baseUrl;
            access.siliconflowApiKey = profile.apiKey;
            break;
          case ServiceProvider["302.AI"]:
            access.ai302Url = profile.baseUrl;
            access.ai302ApiKey = profile.apiKey;
            break;
          default:
            break;
        }

        if (profile.provider === ServiceProvider.Custom) {
          access.customOpenAICompatible = profile.openAICompatible ?? true;
        }
        access.provider = profile.provider;
        return { ...profile, enabled: true };
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
          selectedProfile.baseUrl,
          selectedProfile.apiKey,
        );
      }
    }
  };

  const applyProviderToChat = (provider: ServiceProvider) => {
    const model = getDefaultModelForProvider(provider, appConfig.models);
    if (!model) return;

    appConfig.update((config) => {
      config.modelConfig.providerName = provider;
      config.modelConfig.model = model as any;
    });

    const currentSession = chatStore.currentSession();
    chatStore.updateTargetSession(currentSession, (session) => {
      session.mask.modelConfig.providerName = provider;
      session.mask.modelConfig.model = model as any;
    });
  };

  const syncToWebDav = async () => {
    try {
      setSyncing(true);

      accessStore.update((access) => {
        access.useCustomConfig = true;
      });

      // 🆕 如果 WebDAV 未配置，自动使用 allowedWebDavEndpoints 中的第一个地址
      ensureWebDavEndpoint();

      syncStore.update((state) => {
        state.provider = ProviderType.WebDAV;
      });

      const activeProfile = accessStore.apiProfiles.find(
        (profile) => profile.enabled,
      );
      if (activeProfile) {
        syncProfileToAccess(activeProfile.id, { skipFetchModels: true });
      }

      // 🆕 在同步前获取所有平台的模型
      const accessState = useAccessStore.getState();
      const allProfiles = accessState.apiProfiles;

      let totalFetched = 0;
      const results: Array<{ name: string; count: number; success: boolean }> =
        [];

      if (allProfiles.length > 0) {
        console.log("=".repeat(200));
        for (const profile of allProfiles) {
          console.log(`[API Config] 📋 正在获取 ${profile.name} 的模型...`);
          // 设置获取状态
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
              profile.baseUrl,
              profile.apiKey,
              { silent: true, profileName: profile.name },
            );
            totalFetched += result.total;
            results.push({
              name: profile.name,
              count: result.total,
              success: true,
            });

            // 🆕 保存模型数量到对应 profile 的 modelCount
            accessStore.update((state) => {
              state.apiProfiles = state.apiProfiles.map((p) =>
                p.id === profile.id ? { ...p, modelCount: result.total } : p,
              );
            });

            // 更新成功状态
            setModelFetchStatusMap((prev) => ({
              ...prev,
              [profile.id]: {
                count: result.total,
                fetching: false,
                error: undefined,
              },
            }));
            console.log(
              `[API Config] ✅ ${profile.name} 获取了 ${result.total} 个模型`,
            );
            console.log("=".repeat(200));
          } catch (error) {
            results.push({ name: profile.name, count: 0, success: false });
            // 获取失败时，不更新 modelCount，保留云端/缓存的值
            // 更新失败状态（count 设为 undefined 表示使用缓存值）
            setModelFetchStatusMap((prev) => ({
              ...prev,
              [profile.id]: {
                count: undefined, // undefined 表示使用缓存的 modelCount
                fetching: false,
                error: error instanceof Error ? error.message : "获取模型失败",
              },
            }));
            console.error(
              `[API Config] ❌ ${profile.name}: 获取失败，保留云端数据`,
              error,
            );
            console.log("=".repeat(200));
          }
        }
      }

      await syncStore.sync();
      console.log("[API Config] ✅ 同步完成");

      // 汇总放在最后
      if (results.length > 0) {
        const totalFetched = results.reduce(
          (sum, r) => sum + (r.success ? r.count : 0),
          0,
        );

        console.log("=".repeat(200));
        console.log(`[API Config] 📦 本次获取模型总数: ${totalFetched} 个`);
        console.log(`[API Config] 📊 各平台获取数量:`);
        results.forEach(({ name, count, success }) => {
          console.log(
            `[API Config]   - ${name}: ${success ? count : "失败"} 个`,
          );
        });
      }

      showToast("已通过 WebDAV 同步全部配置和对话记录");
    } catch (error) {
      console.error("[API Config] ❌ 同步失败:", error);
      showToast("同步到 WebDAV 失败，请检查网络或凭据");
    } finally {
      setSyncing(false);
    }
  };

  const ensureWebDavEndpoint = () => {
    const currentEndpoint = syncStore.webdav.endpoint.trim();
    const currentUsername = syncStore.webdav.username.trim();
    const currentPassword = syncStore.webdav.password.trim();

    if (!currentEndpoint && allowedWebDavEndpoints.length > 0) {
      const fallbackEndpoint = allowedWebDavEndpoints
        .find((e) => e.trim().length > 0)
        ?.trim();
      if (fallbackEndpoint) {
        console.log(
          `[API Config] 🔧 自动配置 WebDAV 地址: ${fallbackEndpoint}`,
        );
        syncStore.update((state) => {
          state.webdav.endpoint = fallbackEndpoint;
        });
      }
    }

    // 自动设置用户名和密码（如果环境变量有配置）
    if (!currentUsername && accessStore.webdavUsername) {
      console.log(`[API Config] 🔧 自动配置 WebDAV 用户名`);
      syncStore.update((state) => {
        state.webdav.username = accessStore.webdavUsername;
      });
    }

    if (!currentPassword && accessStore.webdavPassword) {
      console.log(`[API Config] 🔧 自动配置 WebDAV 密码`);
      syncStore.update((state) => {
        state.webdav.password = accessStore.webdavPassword;
      });
    }
  };

  const backupToWebDav = async () => {
    console.log("[API Config] ⬆️ 开始上传到云端...");
    try {
      setBackingUp(true);
      ensureWebDavEndpoint();
      const client = syncStore.getClient() as any;
      const localState = getLocalAppState();

      console.log(
        `[API Config] 📦 准备上传 ${SYNC_STORE_KEYS.length} 个数据块`,
      );

      for (const key of SYNC_STORE_KEYS) {
        const storeData = localState[key as keyof AppState];
        console.log(`[API Config] 📤 正在上传: ${key}...`);
        await client.set(key, JSON.stringify(storeData));
      }

      syncStore.markSyncTime();
      console.log("[API Config] ✅ 上传完成");
      showToast("已通过 WebDAV 备份全部配置和对话记录");
    } catch (error) {
      console.error("[API Config] ❌ 上传失败:", error);
      showToast("上传全部配置到云端失败");
    } finally {
      setBackingUp(false);
    }
  };

  const downloadFromWebDav = async () => {
    console.log("[API Config] ⬇️ 开始从云端下载...");
    try {
      setDownloading(true);
      ensureWebDavEndpoint();
      const client = syncStore.getClient() as any;
      const localState = getLocalAppState();
      const nextState = { ...localState } as AppState;
      let hasRemoteData = false;

      console.log(
        `[API Config] 📦 准备下载 ${SYNC_STORE_KEYS.length} 个数据块`,
      );

      for (const key of SYNC_STORE_KEYS) {
        console.log(`[API Config] 📥 正在下载: ${key}...`);
        const remoteStateText = await client.get(key);
        if (!remoteStateText || remoteStateText === "") {
          console.log(`[API Config] ℹ️ ${key}: 云端无数据，跳过`);
          continue;
        }

        const parsedState = JSON.parse(remoteStateText);
        if (!parsedState || typeof parsedState !== "object") {
          throw new Error(`${key} 格式不正确`);
        }

        (nextState as Record<string, unknown>)[key] = parsedState;
        hasRemoteData = true;
        console.log(`[API Config] ✅ ${key}: 下载成功`);
      }

      if (!hasRemoteData) {
        throw new Error("云端配置为空");
      }

      console.log("[API Config] 🔧 正在应用下载的配置...");
      setLocalAppState(nextState);
      const latestAccessState = useAccessStore.getState();
      const latestActiveProfile = latestAccessState.apiProfiles.find(
        (profile) => profile.enabled,
      );

      if (latestActiveProfile) {
        syncProfileToAccess(latestActiveProfile.id);
      } else {
        applyProviderToChat(latestAccessState.provider);
        refreshModelsForProvider(latestAccessState.provider);
      }

      syncStore.markSyncTime();
      console.log("[API Config] ✅ 下载并恢复完成");
      showToast("已通过 WebDAV 下载并恢复全部配置和对话记录");
    } catch (error) {
      console.error("[API Config] ❌ 下载失败:", error);
      showToast("从云端下载全部配置失败: " + (error as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  const clearCloudModels = async () => {
    const confirmed = await showConfirm(
      "确定要清空所有云端模型数据吗？\n此操作不可恢复。",
    );
    if (!confirmed) return;

    console.log("[API Config] 🗑️ 开始清空云端模型数据...");
    try {
      // 清空本地 apiProfiles 的 cachedModels
      accessStore.update((state) => {
        state.apiProfiles = state.apiProfiles.map((p) => ({
          ...p,
          cachedModels: "",
          modelCount: 0,
        }));
      });

      // 清空 appConfig 的 models
      appConfig.update((state) => {
        state.models = [];
      });

      console.log("[API Config] ✅ 云端模型数据已清空");
      showToast("已清空所有云端模型数据");
    } catch (error) {
      console.error("[API Config] ❌ 清空失败:", error);
      showToast("清空云端模型失败");
    }
  };

  return (
    <div className={styles.page}>
      <div className="window-header" data-tauri-drag-region>
        <div className="window-header-title">
          <div className="window-header-main-title">API 配置</div>
          <div className="window-header-sub-title">
            管理多平台配置，并把配置随聊天与设置一起同步到 WebDAV
          </div>
        </div>
        <div className="window-actions">
          <div className="window-action-button">
            <IconButton
              aria="关闭"
              icon={<CloseIcon />}
              onClick={() => navigate(Path.Home)}
              bordered
            />
          </div>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.hint}>
          当前页面会保存多个平台的配置。你可以为每条配置单独选择平台，启用某条后会同步更新当前聊天默认平台，并把设置与聊天记录一起同步到
          WebDAV。
        </div>

        <List>
          <ListItem
            title="当前状态"
            subTitle={
              usingCustomConfig ? (
                <>
                  已启用自定义配置，当前配置：
                  <span className={styles.profileNameHighlight}>
                    {accessStore.apiProfiles.find((p) => p.enabled)?.name ||
                      accessStore.provider}
                  </span>
                </>
              ) : (
                "当前使用服务端默认配置"
              )
            }
          />

          {(providerProfiles.length > 0 || PROVIDER_OPTIONS.length > 0) && (
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
                        access.apiProfiles = [
                          ...access.apiProfiles,
                          createProfile(access.provider, access as any),
                        ];
                      });
                    }}
                  />
                </div>
              }
              subTitle="可以新增多组 Base URL 与 API Key，但只能启用其中一组"
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
                      兼容OPENAI
                    </div>
                    <div className={styles.profileColToggle}>是否启用</div>
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
                          value={profile.baseUrl}
                          onChange={(e) => {
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
                              syncProfileToAccess(profile.id);
                            }
                          }}
                        />
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
                        className={`${styles.profileCell} ${styles.profileColToggle}`}
                      >
                        <div className={styles.profileCellLabel}>是否启用</div>
                        <label className={styles.profileCheck}>
                          <input
                            type="checkbox"
                            checked={profile.enabled}
                            onChange={(e) => {
                              if (!e.currentTarget.checked) {
                                accessStore.update((access) => {
                                  access.apiProfiles = access.apiProfiles.map(
                                    (item) =>
                                      item.id === profile.id
                                        ? { ...item, enabled: false }
                                        : item,
                                  );
                                });
                                return;
                              }

                              syncProfileToAccess(profile.id);
                            }}
                          />
                          <span>{profile.enabled ? "已启用" : "未启用"}</span>
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
            title="WebDAV 同步"
            subTitle={
              <>
                <div>
                  同步方式：通过 WebDAV 按文件读写远程目录，不使用单个压缩包。
                </div>
                <div>远程地址与目录：{webdavFolderPath}</div>
                <div>
                  上传到云端：通过 WebDAV 写入
                  chat.json、config.json、mask.json、prompt.json、access.json，备份全部配置和对话记录。
                </div>
                <div>
                  保存并同步：先启用当前 API 配置，再通过 WebDAV
                  合并并回写上述全部远程文件。
                </div>
                <div>
                  从云端下载：通过 WebDAV
                  读取上述全部远程文件，解析后分别写回本地聊天、设置、提示词和
                  API 配置。
                </div>
              </>
            }
            vertical
          >
            <div className={styles.actions}>
              <div
                style={{
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                  flex: 1,
                }}
              >
                <IconButton
                  icon={backingUp ? <LoadingIcon /> : <UploadIcon />}
                  text={backingUp ? "上传中..." : "上传到云端"}
                  bordered
                  disabled={backingUp || syncing || downloading}
                  onClick={() => {
                    void backupToWebDav();
                  }}
                />
                <IconButton
                  icon={syncing ? <LoadingIcon /> : <ConfirmIcon />}
                  text={syncing ? "同步中..." : "保存并同步"}
                  type="primary"
                  bordered
                  disabled={syncing || backingUp || downloading}
                  onClick={() => {
                    void syncToWebDav();
                  }}
                />
                <IconButton
                  icon={downloading ? <LoadingIcon /> : <DownloadIcon />}
                  text={downloading ? "下载中..." : "从云端下载"}
                  bordered
                  disabled={downloading || syncing || backingUp}
                  onClick={() => {
                    void downloadFromWebDav();
                  }}
                />
                <button
                  type="button"
                  className={styles.modelFetchHint}
                  aria-live="polite"
                  disabled={anyFetching}
                  onClick={async () => {
                    console.log("[API Config] 🔄 开始获取所有配置的模型...");

                    const accessState = useAccessStore.getState();
                    const allProfiles = accessState.apiProfiles;

                    if (allProfiles.length === 0) {
                      // 如果没有配置 profile，使用默认 provider
                      const provider = accessState.provider;
                      refreshModelsForProvider(provider);
                      return;
                    }

                    // 遍历所有配置的 profile 并获取模型
                    let totalFetched = 0;
                    const results: Array<{
                      name: string;
                      count: number;
                      success: boolean;
                    }> = [];

                    for (const profile of allProfiles) {
                      console.log(
                        `[API Config] 📋 正在获取 ${profile.name} 的模型...`,
                      );
                      // 设置获取状态
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
                          profile.baseUrl,
                          profile.apiKey,
                          { silent: true },
                        );
                        totalFetched += result.total;
                        results.push({
                          name: profile.name,
                          count: result.total,
                          success: true,
                        });

                        // 🆕 保存模型数量到对应 profile 的 modelCount
                        accessStore.update((state) => {
                          state.apiProfiles = state.apiProfiles.map((p) =>
                            p.id === profile.id
                              ? { ...p, modelCount: result.total }
                              : p,
                          );
                        });

                        // 更新成功状态
                        setModelFetchStatusMap((prev) => ({
                          ...prev,
                          [profile.id]: {
                            count: result.total,
                            fetching: false,
                            error: undefined,
                          },
                        }));
                        console.log(
                          `[API Config] ✅ ${profile.name}: 获取到 ${result.total} 个模型`,
                        );
                      } catch (error) {
                        results.push({
                          name: profile.name,
                          count: 0,
                          success: false,
                        });
                        // 更新失败状态
                        setModelFetchStatusMap((prev) => ({
                          ...prev,
                          [profile.id]: {
                            count: 0,
                            fetching: false,
                            error:
                              error instanceof Error
                                ? error.message
                                : "获取模型失败",
                          },
                        }));
                        console.error(
                          `[API Config] ❌ ${profile.name}: 获取失败`,
                          error,
                        );
                      }
                    }

                    console.log(`[API Config] 📊 模型获取汇总:`);
                    results.forEach(({ name, count, success }) => {
                      console.log(
                        `[API Config]   - ${name}: ${
                          success ? count : "失败"
                        } 个`,
                      );
                    });
                    console.log(
                      `[API Config] ✅ 所有模型获取完成，共获取 ${totalFetched} 个模型`,
                    );
                  }}
                  title="点击获取模型数据"
                >
                  {anyFetching ? <LoadingIcon /> : <RobotIcon />}
                  <span>
                    {typeof modelFetchCount === "number" ? (
                      <>
                        已获取 <strong>{modelFetchCount}</strong> 个远程模型
                      </>
                    ) : (
                      modelFetchHint
                    )}
                  </span>
                </button>
              </div>
              <IconButton
                icon={<TrashIcon />}
                text="清空模型数据"
                bordered
                className={styles.dangerButton}
                onClick={() => {
                  void clearCloudModels();
                }}
              />
            </div>
          </ListItem>
        </List>
      </div>
    </div>
  );
}
