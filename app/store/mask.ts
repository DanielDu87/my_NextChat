import { BUILTIN_MASKS } from "../masks";
import { getLang, Lang } from "../locales";
import type { ChatMessage } from "./chat";
import { DEFAULT_TOPIC } from "./chat-defaults";
import {
  AutoModelSeriesKey,
  ModelConfig,
  ModelType,
  useAppConfig,
} from "./config";
import { ServiceProvider, StoreKey } from "../constant";
import { nanoid } from "nanoid";
import { createPersistStore } from "../utils/store";
import { useAccessStore } from "./access";
import {
  collectModelsWithDefaultModel,
  getPreferredDefaultChatModel,
} from "../utils/model";
import { sanitizeModelConfigForCapability } from "../client/model-parameter-rules";
import { buildAutoModelCandidates } from "../utils/auto-model";

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
    profiles.find(
      (profile) =>
        profile.enabled && profile.provider === ServiceProvider.Custom,
    ) ||
    profiles.find(
      (profile) =>
        profile.enabled && profile.provider !== ServiceProvider.Local,
    ) ||
    profiles.find((profile) => isAihubMixProfile(profile)) ||
    profiles.find((profile) => profile.provider === ServiceProvider.Custom) ||
    profiles.find((profile) => profile.enabled) ||
    profiles[0]
  );
}

export const createEmptyMask = () => {
  const appConfig = useAppConfig.getState();
  const accessStore = useAccessStore.getState();
  const autoModelSeries = (appConfig.autoModelSeries ||
    []) as AutoModelSeriesKey[];
  const allModels = collectModelsWithDefaultModel(
    appConfig.models,
    appConfig.customModels,
    accessStore.defaultModel,
  );
  const autoCandidates =
    autoModelSeries.length > 0
      ? buildAutoModelCandidates(
          allModels,
          accessStore.apiProfiles,
          autoModelSeries,
        )
      : [];
  const enabledProfile = getPreferredStartupProfile(
    accessStore.apiProfiles || [],
  );
  const initialModelConfig =
    autoCandidates.length > 0
      ? sanitizeModelConfigForCapability({
          ...appConfig.modelConfig,
          model: autoCandidates[0].model as ModelType,
          providerName: autoCandidates[0].providerName,
        })
      : sanitizeModelConfigForCapability({
          ...appConfig.modelConfig,
          ...(getPreferredDefaultChatModel(
            allModels,
            {
              ...appConfig.modelConfig,
              providerName:
                (enabledProfile?.provider as ServiceProvider | undefined) ||
                appConfig.modelConfig.providerName,
            },
            accessStore.apiProfiles,
          ) || {}),
        });

  return {
    id: nanoid(),
    avatar: DEFAULT_MASK_AVATAR,
    name: DEFAULT_TOPIC,
    context: [],
    syncGlobalConfig: true, // use global config as default
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
