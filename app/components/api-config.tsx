import { useState, useEffect } from "react";

import styles from "./api-config.module.scss";

import CloseIcon from "../icons/close.svg";
import ConfirmIcon from "../icons/confirm.svg";
import ResetIcon from "../icons/reload.svg";
import LoadingIcon from "../icons/three-dots.svg";

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
import { StoreKey } from "../constant";
import { useAccessStore, useAppConfig, useChatStore } from "../store";
import { useSyncStore } from "../store/sync";
import { ProviderType } from "../utils/cloud";
import { LLMModel } from "../client/api";
import { useNavigate } from "react-router-dom";

type AccessState = ReturnType<typeof useAccessStore.getState>;

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
  const [cleaningUp, setCleaningUp] = useState(false);
  const [isTightMode, setIsTightMode] = useState(false);

  // 检测是否是沾满模式
  useEffect(() => {
    const checkTightMode = () => {
      // 全局查询 tight-container 类
      const hasTightContainer =
        document.querySelector('[class*="tight-container"]') !== null;
      console.log("[API Config] 检测到 tight-container:", hasTightContainer);
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

    console.log("[API Config] isTightMode:", isTightMode);

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
  const profileManagedFields = providerFields.filter((f) => f.profileManaged);
  const extraFields = providerFields.filter((f) => !f.profileManaged);
  const providerProfiles = accessStore.apiProfiles;
  const customProviderUnsupported =
    accessStore.provider === ServiceProvider.Custom &&
    !accessStore.customOpenAICompatible;

  const syncProfileToAccess = (profileId: string) => {
    accessStore.update((access) => {
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

      syncStore.update((state) => {
        state.provider = ProviderType.WebDAV;
      });

      const activeProfile = accessStore.apiProfiles.find(
        (profile) => profile.enabled,
      );
      if (activeProfile) {
        syncProfileToAccess(activeProfile.id);
      }

      await syncStore.sync();
      showToast("API 配置已保存并同步到 WebDAV");
    } catch (error) {
      console.error("[API Config Sync]", error);
      showToast("同步到 WebDAV 失败，请检查网络或凭据");
    } finally {
      setSyncing(false);
    }
  };

  const backupToWebDav = async () => {
    try {
      setBackingUp(true);
      const client = syncStore.getClient() as any;

      // 分文件上传：只上传 Access Store (API 配置)
      const accessState = { ...useAccessStore.getState() };
      await client.set(StoreKey.Access, JSON.stringify(accessState));

      syncStore.markSyncTime();
      showToast("已上传 API 配置到云端");
    } catch (error) {
      console.error("[Backup]", error);
      showToast("上传配置到云端失败");
    } finally {
      setBackingUp(false);
    }
  };

  const downloadFromWebDav = async () => {
    try {
      setDownloading(true);

      // 使用 syncStore 的客户端获取云端 API 配置
      const client = syncStore.getClient() as any;

      const remoteStateText = await client.get(StoreKey.Access);

      if (!remoteStateText || remoteStateText === "") {
        throw new Error("云端配置为空");
      }

      // 解析云端状态
      const parsedAccessState = JSON.parse(remoteStateText);

      // 验证是否为有效的格式
      if (!parsedAccessState || typeof parsedAccessState !== "object") {
        throw new Error("云端配置格式不正确");
      }

      // 更新 access store
      useAccessStore.setState(parsedAccessState);

      syncStore.markSyncTime();
      showToast("已从云端下载 API 配置");
    } catch (error) {
      console.error("[Download Cloud Config]", error);
      showToast("从云端下载配置失败: " + (error as Error).message);
    } finally {
      setDownloading(false);
    }
  };

  // 清理云端的旧备份文件
  const cleanupLegacyBackup = async () => {
    try {
      setCleaningUp(true);
      const client = syncStore.getClient() as any;

      if (client.deleteLegacy) {
        const deleted = await client.deleteLegacy();
        if (deleted) {
          showToast("已清理云端旧备份文件");
        } else {
          showToast("云端没有旧备份文件或清理失败");
        }
      } else {
        showToast("当前同步方式不支持清理旧文件");
      }
    } catch (error) {
      console.error("[Cleanup]", error);
      showToast("清理旧备份文件失败");
    } finally {
      setCleaningUp(false);
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
            subTitle={`默认同步到 ${syncStore.webdav.endpoint} ，账号 ${syncStore.webdav.username}`}
            vertical
          >
            <div className={styles.actions}>
              <IconButton
                icon={<ResetIcon />}
                text="恢复默认"
                bordered
                onClick={() => {
                  accessStore.update((access) => {
                    access.useCustomConfig = false;
                  });
                  showToast("已恢复为服务端默认配置");
                }}
              />
              <IconButton
                icon={backingUp ? <LoadingIcon /> : <ConfirmIcon />}
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
                icon={downloading ? <LoadingIcon /> : <ConfirmIcon />}
                text={downloading ? "下载中..." : "从云端下载"}
                bordered
                disabled={downloading || syncing || backingUp}
                onClick={() => {
                  void downloadFromWebDav();
                }}
              />
              <IconButton
                icon={cleaningUp ? <LoadingIcon /> : <ResetIcon />}
                text={cleaningUp ? "清理中..." : "清理旧文件"}
                bordered
                disabled={cleaningUp || syncing || backingUp || downloading}
                onClick={() => {
                  void cleanupLegacyBackup();
                }}
              />
            </div>
          </ListItem>
        </List>
      </div>
    </div>
  );
}
