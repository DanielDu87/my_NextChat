import { LLMModel } from "../client/api";
import { DalleQuality, DalleStyle, ModelSize } from "../typing";
import { getClientConfig } from "../config/client";
import {
  DEFAULT_MODELS,
  DEFAULT_INPUT_TEMPLATE,
  DEFAULT_SIDEBAR_WIDTH,
  DEFAULT_TTS_ENGINE,
  DEFAULT_TTS_ENGINES,
  DEFAULT_TTS_MODEL,
  DEFAULT_TTS_MODELS,
  DEFAULT_TTS_VOICE,
  DEFAULT_TTS_VOICES,
  StoreKey,
  ServiceProvider,
} from "../constant";
import { createPersistStore } from "../utils/store";
import { safeLocalStorage } from "../utils/safe-local-storage";
import { normalizePublishedAt } from "../utils/model-published-at";
import type { Voice } from "rt-client";

const LEGACY_UNKNOWN_MODEL_PUBLISHED_AT = 20260101;
const LEGACY_UNKNOWN_MODEL_CUTOFF = 20260325;
const LEGACY_UNKNOWN_MODEL_PUBLISHED_AT_NOTE =
  "缺少明确发布日期的模型统一回退到 2026-01-01";

export type ModelType = (typeof DEFAULT_MODELS)[number]["name"];
export type TTSModelType = (typeof DEFAULT_TTS_MODELS)[number];
export type TTSVoiceType = (typeof DEFAULT_TTS_VOICES)[number];
export type TTSEngineType = (typeof DEFAULT_TTS_ENGINES)[number];
export type AutoModelSeriesKey = "gpt" | "deepseek" | "doubao";

export enum SubmitKey {
  Enter = "Enter",
  CtrlEnter = "Ctrl + Enter",
  ShiftEnter = "Shift + Enter",
  AltEnter = "Alt + Enter",
  MetaEnter = "Meta + Enter",
}

export enum Theme {
  Auto = "auto",
  Dark = "dark",
  Light = "light",
}

const config = getClientConfig();
const localStorage = safeLocalStorage();
const THEME_KEY = "appConfig.theme";
const TIGHT_BORDER_KEY = "appConfig.tightBorder";
const SIDEBAR_WIDTH_KEY = "sidebarWidth";
const DEFAULT_THEME = Theme.Auto;
const DEFAULT_TIGHT_BORDER = !!config?.isApp;
const DEFAULT_LOCAL_SIDEBAR_WIDTH = DEFAULT_SIDEBAR_WIDTH;

function readThemeFromLocalStorage() {
  const stored = String(localStorage.getItem(THEME_KEY) || "").trim();
  return Object.values(Theme).includes(stored as Theme)
    ? (stored as Theme)
    : DEFAULT_THEME;
}

function readTightBorderFromLocalStorage() {
  const stored = String(localStorage.getItem(TIGHT_BORDER_KEY) || "").trim();
  if (stored === "true") return true;
  if (stored === "false") return false;
  return DEFAULT_TIGHT_BORDER;
}

function readSidebarWidthFromLocalStorage() {
  const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
  if (!stored) return DEFAULT_LOCAL_SIDEBAR_WIDTH;
  const width = Number(stored);
  return Number.isFinite(width) ? width : DEFAULT_LOCAL_SIDEBAR_WIDTH;
}

export function getLocalOnlyAppConfig() {
  return {
    theme: readThemeFromLocalStorage(),
    tightBorder: readTightBorderFromLocalStorage(),
    sidebarWidth: readSidebarWidthFromLocalStorage(),
  };
}

export const DEFAULT_CONFIG = {
  lastUpdate: Date.now(), // timestamp, to merge state

  submitKey: SubmitKey.Enter,
  avatar: "1f603",
  fontSize: 14,
  fontFamily: "",
  theme: DEFAULT_THEME as Theme,
  tightBorder: DEFAULT_TIGHT_BORDER,
  sendPreviewBubble: true,
  enableAutoGenerateTitle: true,
  sidebarWidth: DEFAULT_LOCAL_SIDEBAR_WIDTH,

  enableArtifacts: true, // show artifacts config

  enableCodeFold: true, // code fold config

  disablePromptHint: false,

  dontShowMaskSplashScreen: false, // dont show splash screen when create chat
  hideBuiltinMasks: false, // dont add builtin masks

  customModels: "",
  models: [] as LLMModel[],
  autoModelSeries: [] as AutoModelSeriesKey[],

  modelConfig: {
    model: "gpt-4o-mini" as ModelType,
    providerName: "OpenAI" as ServiceProvider,
    temperature: 0.5,
    top_p: 1,
    max_tokens: 4000,
    presence_penalty: 0,
    frequency_penalty: 0,
    sendMemory: true,
    historyMessageCount: 4,
    compressMessageLengthThreshold: 1000,
    compressModel: "",
    compressProviderName: "",
    enableInjectSystemPrompts: true,
    template: config?.template ?? DEFAULT_INPUT_TEMPLATE,
    size: "1024x1024" as ModelSize,
    quality: "standard" as DalleQuality,
    style: "vivid" as DalleStyle,
    seconds: "4",
    webSearch: false,
    webSearchContextSize: "",
    reasoningEffort: "",
    reasoningMaxTokens: 0,
    includeThoughts: false,
    anthropicBeta: "",
    mediaResolution: "",
    structuredOutput: false,
    jsonSchema: "",
  },

  ttsConfig: {
    enable: false,
    autoplay: false,
    engine: DEFAULT_TTS_ENGINE,
    model: DEFAULT_TTS_MODEL,
    voice: DEFAULT_TTS_VOICE,
    speed: 1.0,
  },

  realtimeConfig: {
    enable: false,
    provider: "OpenAI" as ServiceProvider,
    model: "gpt-4o-realtime-preview-2024-10-01",
    apiKey: "",
    azure: {
      endpoint: "",
      deployment: "",
    },
    temperature: 0.9,
    voice: "alloy" as Voice,
  },
};

export type ChatConfig = typeof DEFAULT_CONFIG;

export type ModelConfig = ChatConfig["modelConfig"];
export type TTSConfig = ChatConfig["ttsConfig"];
export type RealtimeConfig = ChatConfig["realtimeConfig"];

export function limitNumber(
  x: number,
  min: number,
  max: number,
  defaultValue: number,
) {
  if (isNaN(x)) {
    return defaultValue;
  }

  return Math.min(max, Math.max(min, x));
}

export const TTSConfigValidator = {
  engine(x: string) {
    return x as TTSEngineType;
  },
  model(x: string) {
    return x as TTSModelType;
  },
  voice(x: string) {
    return x as TTSVoiceType;
  },
  speed(x: number) {
    return limitNumber(x, 0.25, 4.0, 1.0);
  },
};

export const ModalConfigValidator = {
  model(x: string) {
    return x as ModelType;
  },
  max_tokens(x: number) {
    return limitNumber(x, 0, 512000, 1024);
  },
  presence_penalty(x: number) {
    return limitNumber(x, -2, 2, 0);
  },
  frequency_penalty(x: number) {
    return limitNumber(x, -2, 2, 0);
  },
  temperature(x: number) {
    return limitNumber(x, 0, 2, 1);
  },
  top_p(x: number) {
    return limitNumber(x, 0, 1, 1);
  },
};

export const useAppConfig = createPersistStore(
  { ...DEFAULT_CONFIG },
  (set, get) => ({
    reset() {
      set(() => ({ ...DEFAULT_CONFIG }));
    },

    mergeModels(
      newModels: LLMModel[],
      options?: { silent?: boolean; allowedProviderIds?: string[] },
    ) {
      if (!newModels || newModels.length === 0) {
        return;
      }

      // 收集新模型涉及的 provider id
      const newProviderIds = new Set(
        newModels.map((m) => m?.provider?.id).filter(Boolean),
      );

      const oldModels = get().models;
      const modelMap: Record<string, LLMModel> = {};
      const allowedProviderIds = options?.allowedProviderIds
        ? new Set(
            options.allowedProviderIds.map((id) => String(id).toLowerCase()),
          )
        : undefined;

      for (const model of oldModels) {
        const pid = model?.provider?.id;
        if (
          allowedProviderIds &&
          pid &&
          !allowedProviderIds.has(String(pid).toLowerCase())
        ) {
          continue;
        }
        // 跳过即将被新模型替换的 provider 的旧模型
        if (pid && newProviderIds.has(pid)) {
          continue;
        }
        // 清理旧的 "custom" provider 模型（已迁移为 custom_XXX）
        if (pid === "custom") {
          continue;
        }
        // 清理内置供应商的旧模型（用户只用自定义供应商）
        const builtinProviders = [
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
        ];
        if (pid && builtinProviders.includes(pid.toLowerCase())) {
          continue;
        }
        modelMap[`${model.name}@${pid}`] = model;
      }

      for (const model of newModels) {
        model.available = true;
        const key = `${model.name}@${model?.provider?.id}`;
        const existing = oldModels.find(
          (item) => `${item.name}@${item?.provider?.id}` === key,
        );
        const shouldPreserveManualCategory =
          !!existing?.category &&
          (existing.categorySource === 1 ||
            existing.categorySource === undefined);

        if (shouldPreserveManualCategory) {
          model.category = existing.category;
          model.categorySource = 1;
        }
        const existingCategories = Array.isArray(existing?.categories)
          ? existing?.categories
          : undefined;
        if (
          shouldPreserveManualCategory &&
          existingCategories &&
          existingCategories.length > 0
        ) {
          model.categories = existingCategories;
        }
        if (!shouldPreserveManualCategory && model.category) {
          model.categorySource = model.categorySource ?? 0;
        }
        const existingPublishedAt = normalizePublishedAt(existing?.publishedAt);
        const nextPublishedAt = normalizePublishedAt(model.publishedAt);
        if (
          existing &&
          existingPublishedAt &&
          (!nextPublishedAt || existing.publishedAtSource === "manual")
        ) {
          if (
            existing.publishedAtSource === "synced_at" &&
            existingPublishedAt < LEGACY_UNKNOWN_MODEL_CUTOFF &&
            !nextPublishedAt
          ) {
            model.publishedAt = LEGACY_UNKNOWN_MODEL_PUBLISHED_AT;
            model.publishedAtSource = "synced_at";
            model.publishedAtUrl = undefined;
            model.publishedAtNote =
              "历史缺少明确发布日期的模型统一回退到 2026-01-01";
          } else {
            model.publishedAt = existingPublishedAt;
            model.publishedAtSource = existing.publishedAtSource;
            model.publishedAtUrl =
              typeof existing?.publishedAtUrl === "string"
                ? existing.publishedAtUrl
                : undefined;
            model.publishedAtNote =
              typeof existing?.publishedAtNote === "string"
                ? existing.publishedAtNote
                : undefined;
          }
        } else if (!existing && !nextPublishedAt) {
          model.publishedAt = LEGACY_UNKNOWN_MODEL_PUBLISHED_AT;
          model.publishedAtSource = "synced_at";
          if (!model.publishedAtNote) {
            model.publishedAtNote =
              "缺少明确发布日期的模型统一回退到 2026-01-01";
          }
        }
        modelMap[`${model.name}@${model?.provider?.id}`] = model;
      }

      const mergedModels = Object.values(modelMap);
      if (!options?.silent) {
        console.log(
          "[mergeModels] 正在合并模型",
          newModels.length,
          "个，合并后总数：",
          mergedModels.length,
        );
      }

      set(() => ({
        models: mergedModels,
      }));

      // 确保持久化触发
      get().markUpdate();
    },

    allModels() {},

    // localStorage 专用方法：获取/设置 sidebarWidth
    getSidebarWidth() {
      const stored = localStorage.getItem(SIDEBAR_WIDTH_KEY);
      if (!stored) return get().sidebarWidth;
      const width = Number(stored);
      return Number.isFinite(width) ? width : get().sidebarWidth;
    },

    setSidebarWidth(width: number) {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
      set({ sidebarWidth: width });
      window.dispatchEvent(
        new CustomEvent("sidebarWidthChanged", { detail: width }),
      );
    },

    setTheme(theme: Theme) {
      localStorage.setItem(THEME_KEY, theme);
      set({ theme });
    },

    setTightBorder(tightBorder: boolean) {
      localStorage.setItem(TIGHT_BORDER_KEY, String(tightBorder));
      set({ tightBorder });
    },
  }),
  {
    name: StoreKey.Config,
    version: 4.3,
    partialize(state) {
      const { theme, tightBorder, sidebarWidth, ...rest } = state as ChatConfig;
      return rest as typeof state;
    },

    merge(persistedState, currentState) {
      const state = persistedState as ChatConfig | undefined;
      if (!state) {
        return {
          ...currentState,
          theme: readThemeFromLocalStorage(),
          tightBorder: readTightBorderFromLocalStorage(),
          sidebarWidth: readSidebarWidthFromLocalStorage(),
        } as typeof currentState;
      }
      const models = currentState.models.slice();
      state.models.forEach((pModel) => {
        const idx = models.findIndex(
          (v) => v.name === pModel.name && v.provider.id === pModel.provider.id,
        );
        if (idx !== -1) models[idx] = pModel;
        else models.push(pModel);
      });
      return {
        ...currentState,
        ...state,
        models: models,
        theme: readThemeFromLocalStorage(),
        tightBorder: readTightBorderFromLocalStorage(),
        sidebarWidth: readSidebarWidthFromLocalStorage(),
      } as typeof currentState;
    },

    migrate(persistedState, version) {
      const state = persistedState as ChatConfig;

      if (version < 3.4) {
        state.modelConfig.sendMemory = true;
        state.modelConfig.historyMessageCount = 4;
        state.modelConfig.compressMessageLengthThreshold = 1000;
        state.modelConfig.frequency_penalty = 0;
        state.modelConfig.top_p = 1;
        state.modelConfig.template = DEFAULT_INPUT_TEMPLATE;
        state.dontShowMaskSplashScreen = false;
        state.hideBuiltinMasks = false;
      }

      if (version < 3.5) {
        state.customModels = "claude,claude-100k";
      }

      if (version < 3.6) {
        state.modelConfig.enableInjectSystemPrompts = true;
      }

      if (version < 3.7) {
        state.enableAutoGenerateTitle = true;
      }

      if (version < 3.8) {
        state.lastUpdate = Date.now();
      }

      if (version < 3.9) {
        state.modelConfig.template =
          state.modelConfig.template !== DEFAULT_INPUT_TEMPLATE
            ? state.modelConfig.template
            : config?.template ?? DEFAULT_INPUT_TEMPLATE;
      }

      if (version < 4.1) {
        state.modelConfig.compressModel =
          DEFAULT_CONFIG.modelConfig.compressModel;
        state.modelConfig.compressProviderName =
          DEFAULT_CONFIG.modelConfig.compressProviderName;
      }

      if (version < 4.2) {
        state.autoModelSeries = [];
      }

      if (version < 4.3 && Array.isArray(state.models)) {
        state.models = state.models.map((model) => {
          if (normalizePublishedAt(model?.publishedAt)) {
            return model;
          }

          return {
            ...model,
            publishedAt: LEGACY_UNKNOWN_MODEL_PUBLISHED_AT,
            publishedAtSource: "synced_at",
            publishedAtNote:
              model?.publishedAtNote || LEGACY_UNKNOWN_MODEL_PUBLISHED_AT_NOTE,
          };
        });
      }

      return state as any;
    },
  },
);

if (typeof window !== "undefined") {
  useAppConfig.subscribe((state, prevState) => {
    if (state.theme !== prevState.theme) {
      localStorage.setItem(THEME_KEY, state.theme);
    }

    if (state.tightBorder !== prevState.tightBorder) {
      localStorage.setItem(TIGHT_BORDER_KEY, String(state.tightBorder));
    }

    if (state.sidebarWidth !== prevState.sidebarWidth) {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(state.sidebarWidth));
      window.dispatchEvent(
        new CustomEvent("sidebarWidthChanged", { detail: state.sidebarWidth }),
      );
    }
  });
}
