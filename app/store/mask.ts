import { BUILTIN_MASKS } from "../masks";
import { getLang, Lang } from "../locales";
import type { ChatMessage } from "./chat";
import { DEFAULT_TOPIC } from "./chat-defaults";
import { ModelConfig, ModelType, useAppConfig } from "./config";
import { ServiceProvider, StoreKey } from "../constant";
import { nanoid } from "nanoid";
import { createPersistStore } from "../utils/store";
import { useAccessStore } from "./access";
import {
  collectModelsWithDefaultModel,
  getPreferredDefaultChatModel,
} from "../utils/model";
import { sanitizeModelConfigForCapability } from "../client/model-parameter-rules";
import { safeLocalStorage } from "../utils/safe-local-storage";

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
            model: "gpt-5.4" as ModelType,
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

  return {
    id: nanoid(),
    avatar: DEFAULT_MASK_AVATAR,
    name: DEFAULT_TOPIC,
    context: [],
    syncGlobalConfig: false,
    modelConfig: initialModelConfig,
    lang: getLang(),
    builtin: false,
    createdAt: Date.now(),
    plugin: [],
  } as Mask;
};

export const useMaskStore = createPersistStore(
  { ...DEFAULT_MASK_STATE },

  (set, get) => ({
    create(mask?: Partial<Mask>) {
      const masks = get().masks;
      const id = nanoid();
      masks[id] = {
        ...createEmptyMask(),
        ...mask,
        id,
        builtin: false,
      };

      set(() => ({ masks }));
      get().markUpdate();

      return masks[id];
    },
    updateMask(id: string, updater: (mask: Mask) => void) {
      const masks = get().masks;
      const mask = masks[id];
      if (!mask) return;
      const updateMask = { ...mask };
      updater(updateMask);
      masks[id] = updateMask;
      set(() => ({ masks }));
      get().markUpdate();
    },
    delete(id: string) {
      const masks = get().masks;
      delete masks[id];
      set(() => ({ masks }));
      get().markUpdate();
    },

    get(id?: string) {
      return get().masks[id ?? 1145141919810];
    },
    getAll() {
      const userMasks = Object.values(get().masks).sort(
        (a, b) => b.createdAt - a.createdAt,
      );
      const config = useAppConfig.getState();
      if (config.hideBuiltinMasks) return userMasks;
      const buildinMasks = BUILTIN_MASKS.map(
        (m) =>
          ({
            ...m,
            modelConfig: {
              ...config.modelConfig,
              ...m.modelConfig,
            },
          }) as Mask,
      );
      return userMasks.concat(buildinMasks);
    },
    search(text: string) {
      return Object.values(get().masks);
    },
    setLanguage(language: Lang | undefined) {
      set({
        language,
      });
    },
  }),
  {
    name: StoreKey.Mask,
    version: 3.1,

    migrate(state, version) {
      const newState = JSON.parse(JSON.stringify(state)) as MaskState;

      // migrate mask id to nanoid
      if (version < 3) {
        Object.values(newState.masks).forEach((m) => (m.id = nanoid()));
      }

      if (version < 3.1) {
        const updatedMasks: Record<string, Mask> = {};
        Object.values(newState.masks).forEach((m) => {
          updatedMasks[m.id] = m;
        });
        newState.masks = updatedMasks;
      }

      return newState as any;
    },
  },
);
