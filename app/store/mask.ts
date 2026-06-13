import { getLang, Lang } from "../locales";
import type { ChatMessage } from "./chat";
import { DEFAULT_TOPIC } from "./chat-defaults";
import { DEFAULT_CONFIG, ModelConfig, ModelType, useAppConfig } from "./config";
import { ServiceProvider } from "../constant";
import { nanoid } from "nanoid";
import { useAccessStore } from "./access";
import {
  collectModelsWithDefaultModel,
  getPreferredDefaultChatModel,
} from "../utils/model";
import { sanitizeModelConfigForCapability } from "../client/model-parameter-rules";
import { safeLocalStorage } from "../utils/safe-local-storage";
import {
  buildAutoModelCandidates,
  type AutoModelCandidate,
} from "../utils/auto-model";
import type { AutoModelSeriesKey } from "./config";
import { BUILTIN_PLUGIN_IDS } from "./plugin";

export type Mask = {
  id: string;
  createdAt: number;
  avatar: string;
  name: string;
  hideContext?: boolean;
  context: ChatMessage[];
  syncGlobalConfig?: boolean;
  modelConfig: ModelConfig;
  lang: Lang;
  builtin: boolean;
  plugin?: string[];
  enableArtifacts?: boolean;
  enableCodeFold?: boolean;
};

export const DEFAULT_MASK_STATE = {
  masks: {} as Record<string, Mask>,
  language: undefined as Lang | undefined,
};

export type MaskState = typeof DEFAULT_MASK_STATE & {
  language?: Lang | undefined;
};

export const DEFAULT_MASK_AVATAR = "gpt-bot";
const localStorage = safeLocalStorage();
const LAST_MODEL_SELECTION_STORAGE_KEY = "nextchat:last-model-selection";
const LAST_PROVIDER_STORAGE_KEY = "nextchat:model-selector-provider";
let lastAutoModeBranchLogKey = "";
const DEFAULT_MASK_PLUGINS = [...BUILTIN_PLUGIN_IDS];

function parseStoredModelSelection(value: string) {
  const trimmed = String(value || "").trim();
  const atIndex = trimmed.lastIndexOf("@");
  if (atIndex <= 0) {
    return undefined;
  }

  return {
    model: trimmed.slice(0, atIndex),
    providerId: trimmed.slice(atIndex + 1).toLowerCase(),
  };
}

export function getPreferredStartupProfile(
  apiProfiles: Array<{
    id: string;
    name: string;
    provider: string;
    enabled?: boolean;
    baseUrl?: string;
  }>,
) {
  const profiles = apiProfiles || [];
  const isAihubMixProfile = (profile: {
    name?: string;
    provider?: string;
    baseUrl?: string;
  }) =>
    profile.provider === ServiceProvider.Custom &&
    (String(profile.name || "")
      .trim()
      .toLowerCase() === "aihubmix" ||
      String(profile.baseUrl || "")
        .toLowerCase()
        .includes("aihubmix.com"));

  return (
    profiles.find((profile) => profile.enabled && isAihubMixProfile(profile)) ||
    profiles.find((profile) => isAihubMixProfile(profile)) ||
    profiles.find(
      (profile) =>
        profile.enabled && profile.provider === ServiceProvider.Custom,
    ) ||
    profiles.find(
      (profile) =>
        profile.enabled && profile.provider !== ServiceProvider.Local,
    ) ||
    profiles.find((profile) => profile.provider === ServiceProvider.Custom) ||
    profiles.find((profile) => profile.enabled) ||
    profiles[0]
  );
}

export const createEmptyMask = () => {
  const appConfig = useAppConfig.getState();
  const accessStore = useAccessStore.getState();
  const allModels = collectModelsWithDefaultModel(
    appConfig.models,
    appConfig.customModels,
    accessStore.defaultModel,
  );

  // 自动模式优先：autoModelSeries 已通过云端同步，直接选首个候选
  const autoSeries = (appConfig.autoModelSeries || []) as AutoModelSeriesKey[];
  const defaultPlaceholder = DEFAULT_CONFIG.modelConfig.model;
  const syncedModel = appConfig.modelConfig.model;
  // 模型列表未加载时，直接信任已同步的 appConfig.modelConfig
  if (
    allModels.length === 0 &&
    syncedModel &&
    syncedModel !== defaultPlaceholder
  ) {
    const syncedModelConfig = sanitizeModelConfigForCapability({
      ...appConfig.modelConfig,
    });
    const syncedProviderId = (appConfig.modelConfig as any).providerId;
    if (syncedProviderId) {
      (syncedModelConfig as any).providerId = syncedProviderId;
    }
    const syncedProfile = (accessStore.apiProfiles || []).find((profile) => {
      const pid =
        profile.provider === ServiceProvider.Custom
          ? `custom_${profile.name}`.toLowerCase()
          : String(profile.provider || "").toLowerCase();
      return pid === syncedProviderId;
    });
    if (syncedProfile?.id) {
      (syncedModelConfig as any).profileId = syncedProfile.id;
    }
    return {
      id: nanoid(),
      avatar: DEFAULT_MASK_AVATAR,
      name: DEFAULT_TOPIC,
      context: [],
      syncGlobalConfig: true,
      modelConfig: syncedModelConfig,
      lang: getLang(),
      builtin: false,
      createdAt: Date.now(),
      plugin: DEFAULT_MASK_PLUGINS,
    } as Mask;
  }
  if (autoSeries.length > 0) {
    const candidates: AutoModelCandidate[] = buildAutoModelCandidates(
      allModels as any,
      accessStore.apiProfiles || [],
      autoSeries,
    );
    const autoCandidate = candidates[0];
    const autoModeBranchLogKey = `${candidates.length}|${
      autoCandidate
        ? `${autoCandidate.model}@${autoCandidate.providerId}`
        : "(无候选)"
    }`;
    if (autoModeBranchLogKey !== lastAutoModeBranchLogKey) {
      lastAutoModeBranchLogKey = autoModeBranchLogKey;
      console.debug(
        `[Mask] 🆕 自动模式分支: 候选数=${candidates.length}` +
          ` | 选中=${
            autoCandidate
              ? `${autoCandidate.model}@${autoCandidate.providerId}`
              : "(无候选)"
          }`,
      );
    }
    if (autoCandidate) {
      const autoModelConfig = sanitizeModelConfigForCapability({
        ...appConfig.modelConfig,
        model: autoCandidate.model as ModelType,
        providerName: autoCandidate.providerName,
      });
      (autoModelConfig as any).providerId = autoCandidate.providerId;
      const autoProfile = (accessStore.apiProfiles || []).find((profile) => {
        const providerId =
          profile.provider === ServiceProvider.Custom
            ? `custom_${profile.name}`.toLowerCase()
            : String(profile.provider || "").toLowerCase();
        return providerId === autoCandidate.providerId;
      });
      if (autoProfile?.id) {
        (autoModelConfig as any).profileId = autoProfile.id;
      }
      return {
        id: nanoid(),
        avatar: DEFAULT_MASK_AVATAR,
        name: DEFAULT_TOPIC,
        context: [],
        syncGlobalConfig: true,
        modelConfig: autoModelConfig,
        lang: getLang(),
        builtin: false,
        createdAt: Date.now(),
        plugin: DEFAULT_MASK_PLUGINS,
      } as Mask;
    }
  }

  const storedSelection = parseStoredModelSelection(
    localStorage.getItem(LAST_MODEL_SELECTION_STORAGE_KEY) || "",
  );
  const storedProviderName = String(
    localStorage.getItem(LAST_PROVIDER_STORAGE_KEY) || "",
  ).trim();
  const enabledProfile = getPreferredStartupProfile(
    accessStore.apiProfiles || [],
  );
  const storedProfile =
    accessStore.apiProfiles.find((profile) => {
      const providerId =
        profile.provider === ServiceProvider.Custom
          ? `custom_${profile.name}`.toLowerCase()
          : String(profile.provider || "").toLowerCase();
      return providerId === storedSelection?.providerId;
    }) ||
    accessStore.apiProfiles.find(
      (profile) => profile.name === storedProviderName,
    );
  const startupProfile = storedProfile || enabledProfile;
  const startupProviderName =
    (startupProfile?.provider as ServiceProvider | undefined) ||
    appConfig.modelConfig.providerName;
  const startupProviderId =
    startupProfile?.provider === ServiceProvider.Custom
      ? `custom_${startupProfile.name}`.toLowerCase()
      : String(startupProfile?.provider || "").toLowerCase();
  const startupBaseModelConfig = {
    ...appConfig.modelConfig,
    providerName: startupProviderName,
  } as ModelConfig;
  delete (startupBaseModelConfig as any).providerId;
  delete (startupBaseModelConfig as any).profileId;
  const storedModel = storedSelection
    ? allModels.find(
        (model) =>
          model.available &&
          model.name === storedSelection.model &&
          String(model.provider?.id || "").toLowerCase() ===
            storedSelection.providerId,
      )
    : undefined;
  const providerScopedModels = startupProviderId
    ? allModels.filter(
        (model) =>
          model.available &&
          String(model.provider?.id || "").toLowerCase() === startupProviderId,
      )
    : [];
  const fallbackProviderModel = providerScopedModels[0];
  const preferredModelConfig =
    storedModel && storedModel.provider?.providerName
      ? {
          model: storedModel.name as ModelType,
          providerName: storedModel.provider.providerName as ServiceProvider,
        }
      : fallbackProviderModel?.provider?.providerName
      ? {
          model: fallbackProviderModel.name as ModelType,
          providerName: fallbackProviderModel.provider
            .providerName as ServiceProvider,
        }
      : getPreferredDefaultChatModel(
          allModels,
          {
            ...startupBaseModelConfig,
            model: DEFAULT_CONFIG.modelConfig.model,
          },
          accessStore.apiProfiles,
        );
  const initialModelConfig = sanitizeModelConfigForCapability({
    ...startupBaseModelConfig,
    ...(preferredModelConfig || {}),
  });

  if (startupProviderId) {
    (initialModelConfig as any).providerId = startupProviderId;
  }
  if (startupProfile?.id) {
    (initialModelConfig as any).profileId = startupProfile.id;
  }

  const modelSource = storedModel
    ? "storedModel"
    : fallbackProviderModel
    ? "fallbackProvider"
    : "getPreferredDefault";
  void modelSource;

  return {
    id: nanoid(),
    avatar: DEFAULT_MASK_AVATAR,
    name: DEFAULT_TOPIC,
    context: [],
    syncGlobalConfig: true,
    modelConfig: initialModelConfig,
    lang: getLang(),
    builtin: false,
    createdAt: Date.now(),
    plugin: DEFAULT_MASK_PLUGINS,
  } as Mask;
};

// Mask 模板管理功能已移除，useMaskStore 已删除
// Mask 类型和 createEmptyMask 仍保留，供 chat session 使用
