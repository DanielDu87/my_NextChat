import { getClientConfig } from "../config/client";
import {
  ACCESS_CODE_PREFIX,
  ModelProvider,
  ServiceProvider,
} from "../constant";
import {
  ChatMessageTool,
  ChatMessage,
  ModelType,
  useAccessStore,
  useAppConfig,
  useChatStore,
} from "../store";
import { ChatGPTApi, DalleRequestPayload } from "./platforms/openai";
import { GeminiProApi } from "./platforms/google";
import { ClaudeApi } from "./platforms/anthropic";
import { ErnieApi } from "./platforms/baidu";
import { DoubaoApi } from "./platforms/bytedance";
import { QwenApi } from "./platforms/alibaba";
import { HunyuanApi } from "./platforms/tencent";
import { MoonshotApi } from "./platforms/moonshot";
import { SparkApi } from "./platforms/iflytek";
import { DeepSeekApi } from "./platforms/deepseek";
import { XAIApi } from "./platforms/xai";
import { ChatGLMApi } from "./platforms/glm";
import { SiliconflowApi } from "./platforms/siliconflow";
import { Ai302Api } from "./platforms/ai302";
import type { ModelPublishedAtSource } from "../utils/model-published-at";

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export const Models = ["gpt-3.5-turbo", "gpt-4"] as const;
export const TTSModels = ["tts-1", "tts-1-hd"] as const;
export type ChatModel = ModelType;

export interface MultimodalContent {
  type: "text" | "image_url";
  text?: string;
  image_url?: {
    url: string;
  };
}

export interface MultimodalContentForAlibaba {
  text?: string;
  image?: string;
}

export interface RequestMessage {
  role: MessageRole;
  content: string | MultimodalContent[];
  reasoning_details?: Record<string, unknown>;
}

export interface LLMConfig {
  model: string;
  providerName?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  presence_penalty?: number;
  frequency_penalty?: number;
  size?: DalleRequestPayload["size"];
  quality?: DalleRequestPayload["quality"];
  style?: DalleRequestPayload["style"];
  seconds?: string;
  webSearch?: boolean;
  webSearchContextSize?: string;
  reasoningEffort?: string;
  reasoningMaxTokens?: number;
  includeThoughts?: boolean;
  anthropicBeta?: string;
  mediaResolution?: string;
  structuredOutput?: boolean;
  jsonSchema?: string;
}

export interface SpeechOptions {
  model: string;
  input: string;
  voice: string;
  response_format?: string;
  speed?: number;
  onController?: (controller: AbortController) => void;
}

export interface ChatOptions {
  messages: RequestMessage[];
  config: LLMConfig;

  onUpdate?: (message: string, chunk: string) => void;
  onFinish: (message: string, responseRes: Response) => void;
  onError?: (err: Error) => void;
  onController?: (controller: AbortController) => void;
  onBeforeTool?: (tool: ChatMessageTool) => void;
  onAfterTool?: (tool: ChatMessageTool) => void;
}

export interface LLMUsage {
  used: number;
  total: number;
}

export interface LLMModel {
  name: string;
  displayName?: string;
  available: boolean;
  provider: LLMModelProvider;
  sorted: number;
  publishedAt?: number;
  publishedAtSource?: ModelPublishedAtSource;
  publishedAtUrl?: string;
  publishedAtNote?: string;
  vendor?: LLMModelVendor; // 供应商信息
  category?: string;
  categorySource?: 0 | 1;
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
  categories?: string[];
  apiKeyGroup?: string;
}

export interface LLMModelProvider {
  id: string;
  providerName: string;
  providerType: string;
  sorted: number;
}

export interface LLMModelVendor {
  id: number;
  name: string;
  icon?: string;
}

export abstract class LLMApi {
  abstract chat(options: ChatOptions): Promise<void>;
  abstract speech(options: SpeechOptions): Promise<ArrayBuffer>;
  abstract usage(): Promise<LLMUsage>;
  abstract models(): Promise<LLMModel[]>;
}

type ProviderName = "openai" | "azure" | "claude" | "palm";

interface Model {
  name: string;
  provider: ProviderName;
  ctxlen: number;
}

interface ChatProvider {
  name: ProviderName;
  apiConfig: {
    baseUrl: string;
    apiKey: string;
    summaryModel: Model;
  };
  models: Model[];

  chat: () => void;
  usage: () => void;
}

export class ClientApi {
  public llm: LLMApi;

  constructor(provider: ModelProvider = ModelProvider.GPT) {
    switch (provider) {
      case ModelProvider.GeminiPro:
        this.llm = new GeminiProApi();
        break;
      case ModelProvider.Anthropic:
        this.llm = new ClaudeApi();
        break;
      case ModelProvider.Ernie:
        this.llm = new ErnieApi();
        break;
      case ModelProvider.Doubao:
        this.llm = new DoubaoApi();
        break;
      case ModelProvider.Qwen:
        this.llm = new QwenApi();
        break;
      case ModelProvider.Hunyuan:
        this.llm = new HunyuanApi();
        break;
      case ModelProvider.Moonshot:
        this.llm = new MoonshotApi();
        break;
      case ModelProvider.Iflytek:
        this.llm = new SparkApi();
        break;
      case ModelProvider.DeepSeek:
        this.llm = new DeepSeekApi();
        break;
      case ModelProvider.XAI:
        this.llm = new XAIApi();
        break;
      case ModelProvider.ChatGLM:
        this.llm = new ChatGLMApi();
        break;
      case ModelProvider.SiliconFlow:
        this.llm = new SiliconflowApi();
        break;
      case ModelProvider["302.AI"]:
        this.llm = new Ai302Api();
        break;
      default:
        this.llm = new ChatGPTApi();
    }
  }

  config() {}

  prompts() {}

  masks() {}

  async share(messages: ChatMessage[], avatarUrl: string | null = null) {
    const msgs = messages
      .map((m) => ({
        from: m.role === "user" ? "human" : "gpt",
        value: m.content,
      }))
      .concat([
        {
          from: "human",
          value:
            "Share from [NextChat]: https://github.com/Yidadaa/ChatGPT-Next-Web",
        },
      ]);
    // 敬告二开开发者们，为了开源大模型的发展，请不要修改上述消息，此消息用于后续数据清洗使用
    // Please do not modify this message

    console.log("[Share]", messages, msgs);
    const clientConfig = getClientConfig();
    const proxyUrl = "/sharegpt";
    const rawUrl = "https://sharegpt.com/api/conversations";
    const shareUrl = clientConfig?.isApp ? rawUrl : proxyUrl;
    const res = await fetch(shareUrl, {
      body: JSON.stringify({
        avatarUrl,
        items: msgs,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const resJson = await res.json();
    console.log("[Share]", resJson);
    if (resJson.id) {
      return `https://shareg.pt/${resJson.id}`;
    }
  }
}

export function getBearerToken(
  apiKey: string,
  noBearer: boolean = false,
): string {
  return validString(apiKey)
    ? `${noBearer ? "" : "Bearer "}${apiKey.trim()}`
    : "";
}

export function validString(x: string): boolean {
  return x?.length > 0;
}

function getYutoFallbackGroupOrder(modelName: string) {
  const lowerModelName = modelName.toLowerCase();
  if (lowerModelName.startsWith("claude")) {
    return ["anthropic", "enterprise", "discount", "user", "default"];
  }
  return ["enterprise", "discount", "user", "anthropic", "default"];
}

export function getHeaders(ignoreHeaders: boolean = false) {
  const accessStore = useAccessStore.getState();
  const appConfigStore = useAppConfig.getState();
  const chatStore = useChatStore.getState();
  let headers: Record<string, string> = {};
  if (!ignoreHeaders) {
    headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  const clientConfig = getClientConfig();

  function getConfig() {
    const modelConfig = chatStore.currentSession().mask.modelConfig;
    const isCustom = modelConfig.providerName === ServiceProvider.Custom;
    const isGoogle = modelConfig.providerName === ServiceProvider.Google;
    const isAzure = modelConfig.providerName === ServiceProvider.Azure;
    const isAnthropic = modelConfig.providerName === ServiceProvider.Anthropic;
    const isBaidu = modelConfig.providerName == ServiceProvider.Baidu;
    const isByteDance = modelConfig.providerName === ServiceProvider.ByteDance;
    const isAlibaba = modelConfig.providerName === ServiceProvider.Alibaba;
    const isMoonshot = modelConfig.providerName === ServiceProvider.Moonshot;
    const isIflytek = modelConfig.providerName === ServiceProvider.Iflytek;
    const isDeepSeek = modelConfig.providerName === ServiceProvider.DeepSeek;
    const isXAI = modelConfig.providerName === ServiceProvider.XAI;
    const isChatGLM = modelConfig.providerName === ServiceProvider.ChatGLM;
    const isSiliconFlow =
      modelConfig.providerName === ServiceProvider.SiliconFlow;
    const isAI302 = modelConfig.providerName === ServiceProvider["302.AI"];
    const isEnabledAccessControl = accessStore.needCode;

    // 调试信息
    // console.log("[API Request] Session Provider:", modelConfig.providerName);
    // console.log("[API Request] AccessStore Provider:", accessStore.provider);
    // console.log("[API Request] customApiKey:", accessStore.customApiKey ? "***" : "EMPTY");
    // console.log("[API Request] openaiApiKey:", accessStore.openaiApiKey ? "***" : "EMPTY");

    // 使用当前会话的 provider，或者是全局设置的 Custom provider
    const effectiveProvider =
      accessStore.provider === ServiceProvider.Custom
        ? ServiceProvider.Custom
        : modelConfig.providerName;

    const enabledCustomProfile = accessStore.apiProfiles.find(
      (profile) =>
        profile.enabled &&
        profile.provider === ServiceProvider.Custom &&
        profile.baseUrl,
    );

    const resolveCustomApiKey = () => {
      if (!enabledCustomProfile) {
        return {
          current: accessStore.customApiKey,
          fallback: [],
          fallbackGroups: [],
        };
      }

      const profileProviderId = `custom_${enabledCustomProfile.name}`;
      const matchedModel = (appConfigStore.models || []).find(
        (model) =>
          model.name === modelConfig.model &&
          model.provider?.id === profileProviderId,
      );

      const groupedKeys = enabledCustomProfile.apiKeyGroups || {};
      const groupOrder = getYutoFallbackGroupOrder(modelConfig.model);

      // 构建降级 API key 列表
      const fallbackApiKeys: string[] = [];
      const fallbackApiKeyGroups: string[] = [];

      const pushFallbackKey = (groupName: string, key: string | undefined) => {
        if (!key || fallbackApiKeys.includes(key)) {
          return;
        }
        fallbackApiKeys.push(key);
        fallbackApiKeyGroups.push(groupName);
      };

      const matchedGroup = matchedModel?.apiKeyGroup;
      const hasMatchedGroup =
        Boolean(matchedGroup) && Boolean(groupedKeys[matchedGroup as string]);

      // 先尝试命中分组，命中失败再按分组顺序继续降级重试
      if (hasMatchedGroup) {
        pushFallbackKey(
          matchedGroup as string,
          groupedKeys[matchedGroup as string],
        );
      }

      for (const group of groupOrder) {
        pushFallbackKey(group, groupedKeys[group]);
      }

      console.log("[API] Debug:", {
        modelConfigModel: modelConfig.model,
        profileProviderId,
        matchedModel: matchedModel
          ? {
              name: matchedModel.name,
              apiKeyGroup: matchedModel.apiKeyGroup,
            }
          : null,
        fallbackGroups: fallbackApiKeyGroups,
        fallbackKeys: fallbackApiKeys.map((k) => k.slice(0, 10) + "..."),
      });

      return {
        current: fallbackApiKeys[0] || "",
        fallback: fallbackApiKeys,
        fallbackGroups: fallbackApiKeyGroups,
      };
    };

    const apiKeyInfo =
      effectiveProvider === ServiceProvider.Custom
        ? resolveCustomApiKey()
        : {
            current:
              effectiveProvider === ServiceProvider.Google
                ? accessStore.googleApiKey
                : effectiveProvider === ServiceProvider.Azure
                ? accessStore.azureApiKey
                : effectiveProvider === ServiceProvider.Anthropic
                ? accessStore.anthropicApiKey
                : effectiveProvider === ServiceProvider.ByteDance
                ? accessStore.bytedanceApiKey
                : effectiveProvider === ServiceProvider.Alibaba
                ? accessStore.alibabaApiKey
                : effectiveProvider === ServiceProvider.Moonshot
                ? accessStore.moonshotApiKey
                : effectiveProvider === ServiceProvider.XAI
                ? accessStore.xaiApiKey
                : effectiveProvider === ServiceProvider.DeepSeek
                ? accessStore.deepseekApiKey
                : effectiveProvider === ServiceProvider.ChatGLM
                ? accessStore.chatglmApiKey
                : effectiveProvider === ServiceProvider.SiliconFlow
                ? accessStore.siliconflowApiKey
                : effectiveProvider === ServiceProvider.Iflytek
                ? accessStore.iflytekApiKey && accessStore.iflytekApiSecret
                  ? accessStore.iflytekApiKey +
                    ":" +
                    accessStore.iflytekApiSecret
                  : ""
                : effectiveProvider === ServiceProvider["302.AI"]
                ? accessStore.ai302ApiKey
                : accessStore.openaiApiKey,
            fallback: [],
          };

    // console.log("[API Request] Effective Provider:", effectiveProvider);
    // console.log("[API Request] API Key:", apiKeyInfo.current ? "***" : "EMPTY");
    return {
      isCustom,
      isGoogle,
      isAzure,
      isAnthropic,
      isBaidu,
      isByteDance,
      isAlibaba,
      isMoonshot,
      isIflytek,
      isDeepSeek,
      isXAI,
      isChatGLM,
      isSiliconFlow,
      isAI302,
      apiKey: apiKeyInfo.current,
      fallbackApiKeys: apiKeyInfo.fallback,
      fallbackApiKeyGroups: (apiKeyInfo as any).fallbackGroups || [],
      isEnabledAccessControl,
    };
  }

  function getAuthHeader(): string {
    return isAzure
      ? "api-key"
      : isAnthropic
      ? "x-api-key"
      : isGoogle
      ? "x-goog-api-key"
      : "Authorization";
  }

  const {
    isCustom,
    isGoogle,
    isAzure,
    isAnthropic,
    isBaidu,
    isByteDance,
    isAlibaba,
    isMoonshot,
    isIflytek,
    isDeepSeek,
    isXAI,
    isChatGLM,
    isSiliconFlow,
    isAI302,
    apiKey,
    fallbackApiKeys,
    fallbackApiKeyGroups,
    isEnabledAccessControl,
  } = getConfig();
  // when using baidu api in app, not set auth header
  if (isBaidu && clientConfig?.isApp) return headers;

  const authHeader = getAuthHeader();

  const bearerToken = getBearerToken(
    apiKey,
    isAzure || isAnthropic || isGoogle,
  );

  if (bearerToken) {
    headers[authHeader] = bearerToken;
  } else if (isEnabledAccessControl && validString(accessStore.accessCode)) {
    headers["Authorization"] = getBearerToken(
      ACCESS_CODE_PREFIX + accessStore.accessCode,
    );
  }

  // 添加降级 API key 列表用于重试
  if (fallbackApiKeys && fallbackApiKeys.length > 0) {
    (headers as any)["x-fallback-api-keys"] = fallbackApiKeys;
    (headers as any)["x-fallback-api-key-groups"] = fallbackApiKeyGroups;
  }

  return headers;
}

export function getClientApi(provider: ServiceProvider): ClientApi {
  switch (provider) {
    case ServiceProvider.Google:
      return new ClientApi(ModelProvider.GeminiPro);
    case ServiceProvider.Anthropic:
      return new ClientApi(ModelProvider.Anthropic);
    case ServiceProvider.Baidu:
      return new ClientApi(ModelProvider.Ernie);
    case ServiceProvider.ByteDance:
      return new ClientApi(ModelProvider.Doubao);
    case ServiceProvider.Alibaba:
      return new ClientApi(ModelProvider.Qwen);
    case ServiceProvider.Tencent:
      return new ClientApi(ModelProvider.Hunyuan);
    case ServiceProvider.Moonshot:
      return new ClientApi(ModelProvider.Moonshot);
    case ServiceProvider.Iflytek:
      return new ClientApi(ModelProvider.Iflytek);
    case ServiceProvider.DeepSeek:
      return new ClientApi(ModelProvider.DeepSeek);
    case ServiceProvider.XAI:
      return new ClientApi(ModelProvider.XAI);
    case ServiceProvider.ChatGLM:
      return new ClientApi(ModelProvider.ChatGLM);
    case ServiceProvider.SiliconFlow:
      return new ClientApi(ModelProvider.SiliconFlow);
    case ServiceProvider["302.AI"]:
      return new ClientApi(ModelProvider["302.AI"]);
    default:
      return new ClientApi(ModelProvider.GPT);
  }
}
