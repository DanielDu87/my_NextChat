import {
  GoogleSafetySettingsThreshold,
  ServiceProvider,
  StoreKey,
  ApiPath,
  OPENAI_BASE_URL,
  ANTHROPIC_BASE_URL,
  GEMINI_BASE_URL,
  BAIDU_BASE_URL,
  BYTEDANCE_BASE_URL,
  ALIBABA_BASE_URL,
  TENCENT_BASE_URL,
  MOONSHOT_BASE_URL,
  STABILITY_BASE_URL,
  IFLYTEK_BASE_URL,
  DEEPSEEK_BASE_URL,
  XAI_BASE_URL,
  CHATGLM_BASE_URL,
  SILICONFLOW_BASE_URL,
  AI302_BASE_URL,
} from "../constant";
import { getClientConfig } from "../config/client";
import { createPersistStore } from "../utils/store";
import { ensure } from "../utils/clone";
import { DEFAULT_CONFIG } from "./config";
import { getModelProvider } from "../utils/model";
import { sanitizeModelConfigForCapability } from "../client/model-parameter-rules";

let fetchState = 0; // 0 not fetch, 1 fetching, 2 done

const isApp = getClientConfig()?.buildMode === "export";

const DEFAULT_OPENAI_URL = isApp ? OPENAI_BASE_URL : ApiPath.OpenAI;

const DEFAULT_GOOGLE_URL = isApp ? GEMINI_BASE_URL : ApiPath.Google;

const DEFAULT_ANTHROPIC_URL = isApp ? ANTHROPIC_BASE_URL : ApiPath.Anthropic;

const DEFAULT_BAIDU_URL = isApp ? BAIDU_BASE_URL : ApiPath.Baidu;

const DEFAULT_BYTEDANCE_URL = isApp ? BYTEDANCE_BASE_URL : ApiPath.ByteDance;

const DEFAULT_ALIBABA_URL = isApp ? ALIBABA_BASE_URL : ApiPath.Alibaba;

const DEFAULT_TENCENT_URL = isApp ? TENCENT_BASE_URL : ApiPath.Tencent;

const DEFAULT_MOONSHOT_URL = isApp ? MOONSHOT_BASE_URL : ApiPath.Moonshot;

const DEFAULT_STABILITY_URL = isApp ? STABILITY_BASE_URL : ApiPath.Stability;

const DEFAULT_IFLYTEK_URL = isApp ? IFLYTEK_BASE_URL : ApiPath.Iflytek;

const DEFAULT_DEEPSEEK_URL = isApp ? DEEPSEEK_BASE_URL : ApiPath.DeepSeek;

const DEFAULT_XAI_URL = isApp ? XAI_BASE_URL : ApiPath.XAI;

const DEFAULT_CHATGLM_URL = isApp ? CHATGLM_BASE_URL : ApiPath.ChatGLM;

const DEFAULT_SILICONFLOW_URL = isApp
  ? SILICONFLOW_BASE_URL
  : ApiPath.SiliconFlow;

const DEFAULT_AI302_URL = isApp ? AI302_BASE_URL : ApiPath["302.AI"];
const DEFAULT_AIHUBMIX_URL = "https://aihubmix.com";
const DEFAULT_AIHUBMIX_PROFILE_ID = "default_aihubmix_profile";

const DEFAULT_ACCESS_STATE = {
  accessCode: "",
  useCustomConfig: true,

  provider: ServiceProvider.Custom,
  apiProfiles: [
    {
      id: DEFAULT_AIHUBMIX_PROFILE_ID,
      name: "AihubMix",
      provider: ServiceProvider.Custom,
      baseUrl: DEFAULT_AIHUBMIX_URL,
      apiKey: "",
      modelFetchApiKey: "",
      balanceQueryApiKey: "",
      balanceQueryUrl: "",
      balanceQueryField: "",
      apiKeyGroups: {},
      enabled: true,
      openAICompatible: true,
      cachedModels: "",
      modelCount: 0,
    },
  ] as Array<{
    id: string;
    name: string;
    provider: ServiceProvider;
    baseUrl: string;
    apiKey: string;
    modelFetchApiKey?: string;
    balanceQueryApiKey?: string;
    balanceQueryUrl?: string;
    balanceQueryField?: string;
    apiKeyGroups?: Record<string, string>;
    enabled: boolean;
    openAICompatible?: boolean;
    cachedModels?: string;
    modelCount?: number; // 🆕 存储该平台获取的模型数量
  }>,

  // custom
  customUrl: DEFAULT_AIHUBMIX_URL,
  customApiKey: "",
  customOpenAICompatible: true,

  // openai
  openaiUrl: DEFAULT_OPENAI_URL,
  openaiApiKey: "",

  // azure
  azureUrl: "",
  azureApiKey: "",
  azureApiVersion: "2023-08-01-preview",

  // google ai studio
  googleUrl: DEFAULT_GOOGLE_URL,
  googleApiKey: "",
  googleApiVersion: "v1",
  googleSafetySettings: GoogleSafetySettingsThreshold.BLOCK_ONLY_HIGH,

  // anthropic
  anthropicUrl: DEFAULT_ANTHROPIC_URL,
  anthropicApiKey: "",
  anthropicApiVersion: "2023-06-01",

  // baidu
  baiduUrl: DEFAULT_BAIDU_URL,
  baiduApiKey: "",
  baiduSecretKey: "",

  // bytedance
  bytedanceUrl: DEFAULT_BYTEDANCE_URL,
  bytedanceApiKey: "",

  // alibaba
  alibabaUrl: DEFAULT_ALIBABA_URL,
  alibabaApiKey: "",

  // moonshot
  moonshotUrl: DEFAULT_MOONSHOT_URL,
  moonshotApiKey: "",

  //stability
  stabilityUrl: DEFAULT_STABILITY_URL,
  stabilityApiKey: "",

  // tencent
  tencentUrl: DEFAULT_TENCENT_URL,
  tencentSecretKey: "",
  tencentSecretId: "",

  // iflytek
  iflytekUrl: DEFAULT_IFLYTEK_URL,
  iflytekApiKey: "",
  iflytekApiSecret: "",

  // deepseek
  deepseekUrl: DEFAULT_DEEPSEEK_URL,
  deepseekApiKey: "",

  // xai
  xaiUrl: DEFAULT_XAI_URL,
  xaiApiKey: "",

  // chatglm
  chatglmUrl: DEFAULT_CHATGLM_URL,
  chatglmApiKey: "",

  // siliconflow
  siliconflowUrl: DEFAULT_SILICONFLOW_URL,
  siliconflowApiKey: "",

  // 302.AI
  ai302Url: DEFAULT_AI302_URL,
  ai302ApiKey: "",

  // Local
  localUrl: "",
  localApiKey: "",

  // server config
  needCode: true,
  hideUserApiKey: false,
  disableGPT4: false,
  disableFastLink: false,
  customModels: "",
  defaultModel: "gpt-5.4",
  visionModels: "",

  // tts config
  edgeTTSVoiceName: "zh-CN-YunxiNeural",
};

export const useAccessStore = createPersistStore(
  { ...DEFAULT_ACCESS_STATE },

  (set, get) => ({
    enabledAccessControl() {
      (get() as any).fetch();

      return get().needCode;
    },
    getVisionModels() {
      (get() as any).fetch();
      return get().visionModels;
    },
    edgeVoiceName() {
      (get() as any).fetch();

      return get().edgeTTSVoiceName;
    },

    isValidOpenAI() {
      return ensure(get(), ["openaiApiKey"]);
    },

    isValidCustom() {
      return ensure(get(), ["customUrl", "customApiKey"]);
    },

    isValidAzure() {
      return ensure(get(), ["azureUrl", "azureApiKey", "azureApiVersion"]);
    },

    isValidGoogle() {
      return ensure(get(), ["googleApiKey"]);
    },

    isValidAnthropic() {
      return ensure(get(), ["anthropicApiKey"]);
    },

    isValidBaidu() {
      return ensure(get(), ["baiduApiKey", "baiduSecretKey"]);
    },

    isValidByteDance() {
      return ensure(get(), ["bytedanceApiKey"]);
    },

    isValidAlibaba() {
      return ensure(get(), ["alibabaApiKey"]);
    },

    isValidTencent() {
      return ensure(get(), ["tencentSecretKey", "tencentSecretId"]);
    },

    isValidMoonshot() {
      return ensure(get(), ["moonshotApiKey"]);
    },
    isValidIflytek() {
      return ensure(get(), ["iflytekApiKey"]);
    },
    isValidDeepSeek() {
      return ensure(get(), ["deepseekApiKey"]);
    },

    isValidXAI() {
      return ensure(get(), ["xaiApiKey"]);
    },

    isValidChatGLM() {
      return ensure(get(), ["chatglmApiKey"]);
    },

    isValidSiliconFlow() {
      return ensure(get(), ["siliconflowApiKey"]);
    },

    updateApiProfiles(profiles: typeof DEFAULT_ACCESS_STATE.apiProfiles) {
      set({ apiProfiles: profiles });
      get().markUpdate();
    },

    isAuthorized() {
      (get() as any).fetch();

      // 已禁用访问码检查，始终返回授权状态
      // 用户通过 API 配置页面设置自定义 API
      return true;
    },
    fetch() {
      if (fetchState > 0 || getClientConfig()?.buildMode === "export") return;
      if (!get()._hasHydrated) {
        // 等持久化状态恢复后再拉服务端配置，避免用默认值覆盖本地已保存的自定义模型。
        setTimeout(() => {
          if (fetchState === 0) {
            (get() as any).fetch();
          }
        }, 50);
        return;
      }

      fetchState = 1;
      fetch("/api/config", {
        method: "post",
        body: null,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      })
        .then((res) => res.json())
        .then((res) => {
          const defaultModel = res.defaultModel ?? "";
          if (defaultModel !== "") {
            const [model, providerName] = getModelProvider(defaultModel);
            DEFAULT_CONFIG.modelConfig.model = model;
            DEFAULT_CONFIG.modelConfig.providerName = providerName as any;
            DEFAULT_CONFIG.modelConfig = sanitizeModelConfigForCapability(
              DEFAULT_CONFIG.modelConfig,
            );
          }

          return res;
        })
        .then((res: DangerConfig) => {
          // Docker / Web 部署优先以服务端配置为准，避免浏览器残留的旧模型列表继续污染当前实例。
          // 仅在显式启用自定义配置时保留本地字段，兼容用户手动维护的自定义 endpoint。
          set((state) => ({
            ...res,
            customModels: state.useCustomConfig
              ? res.customModels ?? state.customModels
              : res.customModels ?? "",
            defaultModel: state.useCustomConfig
              ? res.defaultModel ?? state.defaultModel
              : res.defaultModel ?? "",
            visionModels: state.useCustomConfig
              ? res.visionModels ?? state.visionModels
              : res.visionModels ?? "",
          }));
        })
        .catch(() => {
          console.error("[Config] failed to fetch config");
        })
        .finally(() => {
          fetchState = 2;
        });
    },
  }),
  {
    name: StoreKey.Access,
    version: 5,
    migrate(persistedState, version) {
      if (version < 2) {
        const state = persistedState as {
          token: string;
          openaiApiKey: string;
          azureApiVersion: string;
          googleApiKey: string;
        };
        state.openaiApiKey = state.token;
        state.azureApiVersion = "2023-08-01-preview";
      }

      if (version < 3) {
        const state = persistedState as typeof DEFAULT_ACCESS_STATE;
        state.customUrl = state.customUrl ?? "";
        state.customApiKey = state.customApiKey ?? "";
        state.customOpenAICompatible = state.customOpenAICompatible ?? true;
      }

      if (version < 4) {
        const state = persistedState as typeof DEFAULT_ACCESS_STATE;
        state.apiProfiles = state.apiProfiles ?? [];
      }

      if (version < 5) {
        const state = persistedState as typeof DEFAULT_ACCESS_STATE & {
          allowedWebDavEndpoints?: string[];
          webdavUsername?: string;
          webdavPassword?: string;
        };
        delete state.allowedWebDavEndpoints;
        delete state.webdavUsername;
        delete state.webdavPassword;
      }

      return persistedState as any;
    },
  },
);
