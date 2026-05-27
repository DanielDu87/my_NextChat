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
import { hydrateModelsWithAiHubMixMetadata } from "../utils/aihubmix-model-metadata";
import { recordModelSyncDiff } from "../utils/model-sync-diff";
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
const DEFAULT_TIGHT_BORDER = true;

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

function hasStoredTightBorderPreference() {
  return localStorage.getItem(TIGHT_BORDER_KEY) !== null;
}

function readSidebarWidthFromLocalStorage() {
  return DEFAULT_SIDEBAR_WIDTH;
}

function normalizeModelProviderId(providerId: unknown) {
  return String(providerId || "").toLowerCase();
}

function normalizeModelAlias(name: unknown) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\bgpt-40\b/g, "gpt-4o")
    .replace(/\bgpt-40(?=[-_.])/g, "gpt-4o")
    .replace(/\bchatgpt-40\b/g, "chatgpt-4o")
    .replace(/\bchatgpt-40(?=[-_.])/g, "chatgpt-4o");
}

function buildModelProviderKey(name: unknown, providerId: unknown) {
  return `${normalizeModelAlias(name)}@${normalizeModelProviderId(providerId)}`;
}

function hydrateModelsForStore(models: LLMModel[]) {
  return hydrateModelsWithAiHubMixMetadata(models);
}

let uiPreferenceSyncTimer: ReturnType<typeof setTimeout> | null = null;

function getUiPreferenceSummary() {
  const state = useAppConfig.getState();
  return `主题=${state.theme}，页面=${
    state.tightBorder ? "全屏/无边框" : "普通/窄边框"
  }，侧边栏宽度=${state.sidebarWidth}px`;
}

function scheduleUiPreferenceSync(reason: string) {
  if (typeof window === "undefined") {
    return;
  }

  if (uiPreferenceSyncTimer) {
    clearTimeout(uiPreferenceSyncTimer);
  }

  uiPreferenceSyncTimer = setTimeout(() => {
    uiPreferenceSyncTimer = null;
    void import("./sync")
      .then(async ({ useSyncStore }) => {
        const syncStore = useSyncStore.getState();
        if (!syncStore.cloudSync()) {
          console.log(
            `[Config] ⏭️ 界面偏好未同步: 云同步未启用（${getUiPreferenceSummary()}）`,
          );
          return false;
        }

        console.log(
          `[Config] ☁️ 自动同步界面偏好: ${reason}（${getUiPreferenceSummary()}）`,
        );
        await syncStore.sync([StoreKey.Config], {
          isolateQueue: true,
          silentSummary: true,
        });
        return true;
      })
      .then((synced) => {
        if (synced) {
          console.log(
            `[Config] ✅ 界面偏好已同步（${getUiPreferenceSummary()}）`,
          );
        }
      })
      .catch((error: unknown) => {
        console.error("[Config] ❌ 界面偏好同步失败:", error);
      });
  }, 500);
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
  sidebarWidth: DEFAULT_SIDEBAR_WIDTH,

  enableArtifacts: true, // show artifacts config

  enableCodeFold: true, // code fold config

  disablePromptHint: false,

  dontShowMaskSplashScreen: true, // dont show splash screen when create chat
  hideBuiltinMasks: true, // dont add builtin masks

  customModels: "",
  models: [] as LLMModel[],
  autoModelSeries: [] as AutoModelSeriesKey[],

  // 字段级同步时间戳：跨浏览器同步时按字段独立判定胜方，避免相互覆盖
  customModelsUpdatedAt: 0,
  autoModelSeriesUpdatedAt: 0,
  modelSelectionUpdatedAt: 0,

  modelConfig: {
    model: "gpt-5.1" as ModelType,
    providerName: "Custom" as ServiceProvider,
    stream: true,
    temperature: 1,
    top_p: 1,
    max_tokens: 4000,
    presence_penalty: 0,
    frequency_penalty: 0,
    sendMemory: true,
    historyMessageCount: 12,
    compressMessageLengthThreshold: 12000,
    compressModel: "",
    compressProviderName: "",
    enableInjectSystemPrompts: true,
    template: config?.template ?? DEFAULT_INPUT_TEMPLATE,
    size: "1024x1024" as ModelSize,
    quality: "standard" as DalleQuality,
    style: "vivid" as DalleStyle,
    seconds: "4",
    webSearch: false,
    webSearchContextSize: "medium",
    reasoningEffort: "none",
    reasoningMaxTokens: 0,
    includeThoughts: true,
    anthropicBeta: "",
    mediaResolution: "",
    structuredOutput: true,
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

export function getOpenAIStandardReasoningEffort(model: string) {
  const normalizedModel = String(model || "").toLowerCase();
  if (normalizedModel === "gpt-5.1") {
    return "none";
  }
  if (normalizedModel === "gpt-5-pro") {
    return "high";
  }
  return "medium";
}

export function applyOpenAIStandardModelConfig<T extends Partial<ModelConfig>>(
  modelConfig: T,
): T {
  const model = String(modelConfig.model || DEFAULT_CONFIG.modelConfig.model);
  return {
    ...modelConfig,
    stream: true,
    temperature: 1,
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
    webSearchContextSize: "medium",
    reasoningEffort: getOpenAIStandardReasoningEffort(model),
    reasoningMaxTokens: 0,
    includeThoughts: true,
    sendMemory: true,
    enableInjectSystemPrompts: true,
    historyMessageCount: 12,
    structuredOutput: true,
    jsonSchema: "",
  };
}

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
      options?: {
        silent?: boolean;
        allowedProviderIds?: string[];
        skipMarkUpdate?: boolean;
        diffBaseModels?: LLMModel[];
      },
    ) {
      if (!newModels || newModels.length === 0) {
        return;
      }

      const hydratedNewModels = hydrateModelsForStore(newModels);

      // 收集新模型涉及的 provider id
      const newProviderIds = new Set(
        hydratedNewModels
          .map((m) => normalizeModelProviderId(m?.provider?.id))
          .filter(Boolean),
      );

      const oldModels = get().models;
      const modelMap: Record<string, LLMModel> = {};
      // 预构建 oldModelLookup，将 O(n*m) 的 find 降为 O(1) 的 Map 查找
      const oldModelLookup = new Map<string, LLMModel>();
      for (const m of oldModels) {
        oldModelLookup.set(buildModelProviderKey(m.name, m?.provider?.id), m);
      }
      const allowedProviderIds = options?.allowedProviderIds
        ? new Set(
            options.allowedProviderIds.map((id) => String(id).toLowerCase()),
          )
        : undefined;

      for (const model of oldModels) {
        const pid = model?.provider?.id;
        const normalizedPid = normalizeModelProviderId(pid);
        if (
          allowedProviderIds &&
          pid &&
          !allowedProviderIds.has(normalizedPid)
        ) {
          continue;
        }
        // 跳过即将被新模型替换的 provider 的旧模型
        if (normalizedPid && newProviderIds.has(normalizedPid)) {
          continue;
        }
        // 清理旧的 "custom" provider 模型（已迁移为 custom_XXX）
        if (normalizedPid === "custom") {
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
        if (normalizedPid && builtinProviders.includes(normalizedPid)) {
          continue;
        }
        modelMap[buildModelProviderKey(model.name, pid)] = model;
      }

      for (const model of hydratedNewModels) {
        model.available = true;
        const key = buildModelProviderKey(model.name, model?.provider?.id);
        const existing = oldModelLookup.get(key);
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
        modelMap[buildModelProviderKey(model.name, model?.provider?.id)] =
          model;
      }

      const mergedModels = Object.values(modelMap);
      const changedProviderIds =
        allowedProviderIds && allowedProviderIds.size > 0
          ? allowedProviderIds
          : newProviderIds;
      recordModelSyncDiff(
        options?.diffBaseModels ?? oldModels,
        mergedModels,
        changedProviderIds,
      );
      if (!options?.silent) {
        console.log(
          "[mergeModels] 正在合并模型",
          hydratedNewModels.length,
          "个，合并后总数：",
          mergedModels.length,
        );
      }

      set(() => ({
        models: mergedModels,
      }));

      if (!options?.skipMarkUpdate) {
        get().markUpdate();
      }
    },

    allModels() {},

    // 侧边栏宽度固定，保留方法仅用于兼容旧配置调用。
    getSidebarWidth() {
      return DEFAULT_SIDEBAR_WIDTH;
    },

    setSidebarWidth() {
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_SIDEBAR_WIDTH));
      set({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, lastUpdateTime: Date.now() });
      window.dispatchEvent(
        new CustomEvent("sidebarWidthChanged", {
          detail: DEFAULT_SIDEBAR_WIDTH,
        }),
      );
    },

    setTheme(theme: Theme) {
      localStorage.setItem(THEME_KEY, theme);
      set({ theme, lastUpdateTime: Date.now() });
      scheduleUiPreferenceSync("主题");
    },

    setTightBorder(tightBorder: boolean) {
      localStorage.setItem(TIGHT_BORDER_KEY, String(tightBorder));
      set({ tightBorder, lastUpdateTime: Date.now() });
      scheduleUiPreferenceSync("全屏/无边框模式");
    },
  }),
  {
    name: StoreKey.Config,
    version: 4.6,

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
      hydrateModelsForStore(state.models || []).forEach((pModel) => {
        const idx = models.findIndex(
          (v) =>
            v.name === pModel.name &&
            normalizeModelProviderId(v.provider.id) ===
              normalizeModelProviderId(pModel.provider.id),
        );
        if (idx !== -1) models[idx] = pModel;
        else models.push(pModel);
      });
      return {
        ...currentState,
        ...state,
        modelConfig: applyOpenAIStandardModelConfig({
          ...currentState.modelConfig,
          ...state.modelConfig,
        }),
        models: hydrateModelsForStore(models),
        theme: state.theme ?? readThemeFromLocalStorage(),
        tightBorder: hasStoredTightBorderPreference()
          ? readTightBorderFromLocalStorage()
          : DEFAULT_TIGHT_BORDER,
        sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      } as typeof currentState;
    },

    migrate(persistedState, version) {
      const state = persistedState as ChatConfig;

      if (version < 3.4) {
        state.modelConfig.sendMemory = false;
        state.modelConfig.historyMessageCount = 6;
        state.modelConfig.compressMessageLengthThreshold = 12000;
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

      if (version < 4.4) {
        state.modelConfig.webSearch = true;
      }

      if (version < 4.5) {
        (state as any).customModelsUpdatedAt = 0;
        (state as any).autoModelSeriesUpdatedAt = 0;
        (state as any).modelSelectionUpdatedAt = 0;
      }

      if (version < 4.6) {
        state.modelConfig = applyOpenAIStandardModelConfig(state.modelConfig);
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
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_SIDEBAR_WIDTH));
      window.dispatchEvent(
        new CustomEvent("sidebarWidthChanged", {
          detail: DEFAULT_SIDEBAR_WIDTH,
        }),
      );
    }
  });
}
