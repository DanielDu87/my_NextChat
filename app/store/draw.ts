import {
  Stability,
  StoreKey,
  ACCESS_CODE_PREFIX,
  ApiPath,
  OpenaiPath,
  ServiceProvider,
} from "@/app/constant";
import { getBearerToken } from "@/app/client/api";
import {
  buildAiHubMixPredictionPayload,
  getAiHubMixPredictionModelPath,
} from "@/app/client/platforms/openai";
import { createPersistStore } from "@/app/utils/store";
import { appendAihubmixHeaders, isAiHubMixUrl } from "@/app/utils/aihubmix";
import { nanoid } from "nanoid";
import {
  DEFAULT_DRAW_MODELS,
  getModelParamBasicData,
  makeDrawModel,
} from "@/app/components/draw/draw-panel";
import { logger } from "@/app/utils/logger";
import { useAccessStore } from "./access";
import {
  getDrawModelFamily,
  normalizeOpenAICompatibleImageQuality,
  parseDrawImageSize,
  pickSupportedDrawParams,
  toBooleanParam,
  toDashScopeSize,
} from "@/app/utils/draw-model-params";

const OPENAI_COMPATIBLE_DRAW_PROVIDERS = new Set<string>([
  ServiceProvider.Custom,
  ServiceProvider.OpenAI,
  ServiceProvider.Google,
  ServiceProvider.Alibaba,
  ServiceProvider.ByteDance,
  ServiceProvider.ChatGLM,
  ServiceProvider.DeepSeek,
  ServiceProvider.Moonshot,
  ServiceProvider.SiliconFlow,
  ServiceProvider.XAI,
  ServiceProvider["302.AI"],
]);

function normalizeBaseUrl(baseUrl: string) {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("/api/")) {
    return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
  }
  const normalized = trimmed.startsWith("http")
    ? trimmed
    : `https://${trimmed}`;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function joinUrl(baseUrl: string, path: string) {
  const normalizedBase = normalizeBaseUrl(baseUrl);
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  return `${normalizedBase}/${normalizedPath}`;
}

function hasDrawParam(value: unknown) {
  return value !== undefined && value !== null && value !== "";
}

function assignDrawParam(
  payload: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (hasDrawParam(value)) {
    payload[key] = value;
  }
}

function assignDrawSeed(
  payload: Record<string, unknown>,
  params: Record<string, unknown>,
  allowZero = false,
) {
  if (!hasDrawParam(params.seed)) return;
  const seed = Number(params.seed);
  if (Number.isFinite(seed) && (allowZero ? seed >= 0 : seed > 0)) {
    payload.seed = seed;
  }
}

function isSeedreamSingleImageFamily(family: string) {
  return [
    "bytedance-seedream-5-lite",
    "bytedance-seedream-45",
    "bytedance-seedream-40",
  ].includes(family);
}

function buildOpenAICompatibleDrawPayload(
  model: string,
  provider: string,
  params: Record<string, unknown>,
) {
  const family = getDrawModelFamily(model, provider);
  const payload: Record<string, unknown> = {
    model,
    prompt: params.prompt || "",
  };

  switch (family) {
    case "google-gemini-31-image":
    case "google-gemini-3-pro-image": {
      payload.response_format = {
        image: {
          aspect_ratio: params.aspect_ratio || "1:1",
          image_size: params.resolution || "1K",
        },
      };
      return payload;
    }
    case "google-gemini-25-image":
    case "google-gemini-image": {
      payload.response_format = {
        image: {
          aspect_ratio: params.aspect_ratio || "1:1",
        },
      };
      return payload;
    }
    case "google-imagen": {
      assignDrawParam(payload, "n", params.n ? Number(params.n) : undefined);
      payload.response_format = {
        image: {
          aspect_ratio: params.aspect_ratio || "1:1",
          image_size: params.resolution || "1K",
        },
      };
      return payload;
    }
    case "alibaba-qwen":
    case "alibaba-qwen-fixed":
      assignDrawParam(payload, "n", params.n ? Number(params.n) : undefined);
      assignDrawParam(payload, "size", toDashScopeSize(params.image_size));
      assignDrawParam(payload, "negative_prompt", params.negative_prompt);
      if (hasDrawParam(params.prompt_extend)) {
        payload.prompt_extend = toBooleanParam(params.prompt_extend);
      }
      if (hasDrawParam(params.watermark)) {
        payload.watermark = toBooleanParam(params.watermark);
      }
      assignDrawSeed(payload, params);
      return payload;
    case "alibaba-wan-27-pro":
    case "alibaba-wan-27":
      assignDrawParam(payload, "n", params.n ? Number(params.n) : undefined);
      assignDrawParam(payload, "size", params.resolution || "2K");
      if (hasDrawParam(params.thinking_mode)) {
        payload.thinking_mode = toBooleanParam(params.thinking_mode);
      }
      if (hasDrawParam(params.watermark)) {
        payload.watermark = toBooleanParam(params.watermark);
      }
      assignDrawSeed(payload, params, true);
      return payload;
    case "alibaba-wan-26-t2i":
      payload.n = 1;
      assignDrawParam(
        payload,
        "size",
        toDashScopeSize(params.image_size || "1280x1280"),
      );
      assignDrawParam(payload, "negative_prompt", params.negative_prompt);
      if (hasDrawParam(params.prompt_extend)) {
        payload.prompt_extend = toBooleanParam(params.prompt_extend);
      }
      if (hasDrawParam(params.watermark)) {
        payload.watermark = toBooleanParam(params.watermark);
      }
      assignDrawSeed(payload, params, true);
      return payload;
    case "alibaba-wan-26-image":
      payload.n = 1;
      payload.enable_interleave = true;
      assignDrawParam(
        payload,
        "size",
        toDashScopeSize(params.image_size || "1280x1280"),
      );
      assignDrawParam(payload, "negative_prompt", params.negative_prompt);
      if (hasDrawParam(params.watermark)) {
        payload.watermark = toBooleanParam(params.watermark);
      }
      assignDrawSeed(payload, params, true);
      return payload;
    case "alibaba-wan-25-t2i":
    case "alibaba-wan-22-t2i":
    case "alibaba-wan-21-t2i":
    case "alibaba-wan-20-t2i":
      assignDrawParam(payload, "n", params.n ? Number(params.n) : undefined);
      assignDrawParam(
        payload,
        "size",
        toDashScopeSize(params.image_size || "1024x1024"),
      );
      assignDrawParam(payload, "negative_prompt", params.negative_prompt);
      if (hasDrawParam(params.prompt_extend)) {
        payload.prompt_extend = toBooleanParam(params.prompt_extend);
      }
      if (hasDrawParam(params.watermark)) {
        payload.watermark = toBooleanParam(params.watermark);
      }
      assignDrawSeed(payload, params, true);
      return payload;
    case "alibaba-wanx-v1":
      assignDrawParam(payload, "n", params.n ? Number(params.n) : undefined);
      assignDrawParam(
        payload,
        "size",
        toDashScopeSize(params.image_size || "1024x1024"),
      );
      assignDrawParam(payload, "negative_prompt", params.negative_prompt);
      assignDrawParam(payload, "style", params.style);
      assignDrawSeed(payload, params, true);
      return payload;
    case "alibaba-wan":
      assignDrawParam(
        payload,
        "size",
        toDashScopeSize(params.image_size || "1024x1024"),
      );
      assignDrawParam(payload, "negative_prompt", params.negative_prompt);
      if (hasDrawParam(params.watermark)) {
        payload.watermark = toBooleanParam(params.watermark);
      }
      assignDrawSeed(payload, params, true);
      return payload;
    case "bytedance-seedream-5-lite":
    case "bytedance-seedream-45":
    case "bytedance-seedream-40":
    case "bytedance-seedream-30":
    case "bytedance-seedream":
      assignDrawParam(
        payload,
        "size",
        params.resolution ||
          (family === "bytedance-seedream-30" ? "1024x1024" : "2048x2048"),
      );
      payload.response_format = params.response_format || "url";
      if (hasDrawParam(params.watermark)) {
        payload.watermark = toBooleanParam(params.watermark);
      }
      if (family === "bytedance-seedream-5-lite") {
        assignDrawParam(
          payload,
          "output_format",
          params.output_format || "jpeg",
        );
        if (toBooleanParam(params.web_search)) {
          payload.tools = [{ type: "web_search" }];
        }
      }
      if (isSeedreamSingleImageFamily(family)) {
        payload.sequential_image_generation = "disabled";
      }
      if (hasDrawParam(params.optimize_prompt_mode)) {
        payload.optimize_prompt_options = {
          mode: params.optimize_prompt_mode,
        };
      }
      if (family === "bytedance-seedream-30") {
        const seed = Number(params.seed);
        if (Number.isFinite(seed) && seed >= -1) {
          payload.seed = seed;
        }
        if (hasDrawParam(params.guidance_scale)) {
          payload.guidance_scale = Number(params.guidance_scale);
        }
      }
      return payload;
    case "bfl-flux-2": {
      const size = parseDrawImageSize(params.image_size) || {
        width: 1024,
        height: 1024,
      };
      payload.width = size.width;
      payload.height = size.height;
      assignDrawParam(payload, "output_format", params.output_format);
      assignDrawParam(payload, "safety_tolerance", params.safety_tolerance);
      assignDrawSeed(payload, params);
      return payload;
    }
    case "bfl-flux-aspect":
      assignDrawParam(payload, "aspect_ratio", params.aspect_ratio || "1:1");
      assignDrawParam(payload, "output_format", params.output_format);
      if (hasDrawParam(params.prompt_upsampling)) {
        payload.prompt_upsampling = toBooleanParam(params.prompt_upsampling);
      }
      assignDrawParam(payload, "safety_tolerance", params.safety_tolerance);
      assignDrawSeed(payload, params);
      return payload;
    case "fluxapi-kontext":
      assignDrawParam(payload, "aspectRatio", params.aspect_ratio || "16:9");
      assignDrawParam(payload, "outputFormat", params.output_format || "jpeg");
      if (hasDrawParam(params.prompt_upsampling)) {
        payload.promptUpsampling = toBooleanParam(params.prompt_upsampling);
      }
      assignDrawParam(payload, "safetyTolerance", params.safety_tolerance);
      if (hasDrawParam(params.enable_translation)) {
        payload.enableTranslation = toBooleanParam(params.enable_translation);
      }
      return payload;
    case "ideogram-v4":
      payload.text_prompt = payload.prompt;
      delete payload.prompt;
      assignDrawParam(payload, "resolution", params.resolution || "2048x2048");
      assignDrawParam(payload, "rendering_speed", params.rendering_speed);
      return payload;
    case "ideogram-v3":
      assignDrawParam(
        payload,
        "aspect_ratio",
        String(params.aspect_ratio || "1:1").replace(":", "x"),
      );
      assignDrawParam(payload, "rendering_speed", params.rendering_speed);
      assignDrawParam(payload, "negative_prompt", params.negative_prompt);
      assignDrawParam(payload, "style_type", params.style_type);
      assignDrawParam(payload, "magic_prompt", params.magic_prompt);
      assignDrawParam(
        payload,
        "num_images",
        params.n ? Number(params.n) : undefined,
      );
      assignDrawSeed(payload, params);
      return payload;
    case "zhipu-glm-image":
    case "zhipu-cogview":
      assignDrawParam(payload, "size", params.image_size || "1280x1280");
      assignDrawParam(payload, "quality", params.quality);
      if (hasDrawParam(params.watermark)) {
        payload.watermark_enabled = toBooleanParam(params.watermark);
      }
      return payload;
    default:
      assignDrawParam(payload, "n", params.n ? Number(params.n) : undefined);
      assignDrawParam(payload, "size", params.image_size || "1024x1024");
      if (hasDrawParam(params.quality)) {
        const quality = normalizeOpenAICompatibleImageQuality(
          model,
          params.quality,
        );
        assignDrawParam(payload, "quality", quality);
      }
      assignDrawParam(payload, "style", params.style);
      assignDrawParam(payload, "output_format", params.output_format);
      assignDrawParam(payload, "response_format", params.response_format);
      assignDrawParam(payload, "background", params.background);
      if (
        ["jpeg", "webp"].includes(String(params.output_format || "")) &&
        hasDrawParam(params.output_compression)
      ) {
        payload.output_compression = Number(params.output_compression);
      }
      assignDrawParam(payload, "moderation", params.moderation);
      return payload;
  }
}

function buildGoogleNativeDrawPayload(
  model: string,
  params: Record<string, unknown>,
) {
  const family = getDrawModelFamily(model, ServiceProvider.Google);
  const prompt = String(params.prompt || "");

  if (family === "google-imagen") {
    const parameters: Record<string, unknown> = {
      sampleCount: Number(params.n || 1),
      aspectRatio: params.aspect_ratio || "1:1",
    };
    if (params.resolution) {
      parameters.imageSize = params.resolution;
    }
    if (params.person_generation) {
      parameters.personGeneration = params.person_generation;
    }
    return {
      instances: [{ prompt }],
      parameters,
    };
  }

  const imageConfig: Record<string, unknown> = {};
  if (params.aspect_ratio) {
    imageConfig.aspectRatio = params.aspect_ratio;
  }
  if (params.resolution) {
    imageConfig.imageSize = params.resolution;
  }

  // Gemini 3.1 Flash Image（Nano Banana 2）支持思考级别，REST 枚举为首字母大写。
  const generationConfig: Record<string, unknown> = {
    responseModalities: ["IMAGE"],
  };
  if (Object.keys(imageConfig).length > 0) {
    generationConfig.imageConfig = imageConfig;
  }
  if (family === "google-gemini-31-image" && params.thinking_level) {
    const level = String(params.thinking_level);
    generationConfig.thinkingConfig = {
      thinkingLevel: level.charAt(0).toUpperCase() + level.slice(1),
    };
  }

  return {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig,
  };
}

function getDrawProfile(accessStore: any, selectedProvider: string) {
  const profiles = Array.isArray(accessStore.apiProfiles)
    ? accessStore.apiProfiles
    : [];
  return (
    profiles.find((profile: any) => profile?.id === selectedProvider) ||
    profiles.find((profile: any) => profile?.enabled) ||
    undefined
  );
}

function getProfileApiKey(accessStore: any, profile: any) {
  if (profile?.apiKey) {
    return String(profile.apiKey).trim();
  }

  switch (profile?.provider) {
    case ServiceProvider.OpenAI:
      return String(accessStore.openaiApiKey || "").trim();
    case ServiceProvider.Google:
      return String(accessStore.googleApiKey || "").trim();
    case ServiceProvider.Alibaba:
      return String(accessStore.alibabaApiKey || "").trim();
    case ServiceProvider.ByteDance:
      return String(accessStore.bytedanceApiKey || "").trim();
    case ServiceProvider.ChatGLM:
      return String(accessStore.chatglmApiKey || "").trim();
    case ServiceProvider.DeepSeek:
      return String(accessStore.deepseekApiKey || "").trim();
    case ServiceProvider.Moonshot:
      return String(accessStore.moonshotApiKey || "").trim();
    case ServiceProvider.SiliconFlow:
      return String(accessStore.siliconflowApiKey || "").trim();
    case ServiceProvider.XAI:
      return String(accessStore.xaiApiKey || "").trim();
    case ServiceProvider["302.AI"]:
      return String(accessStore.ai302ApiKey || "").trim();
    case ServiceProvider.Stability:
      return String(accessStore.stabilityApiKey || "").trim();
    case ServiceProvider.Custom:
      return String(accessStore.customApiKey || "").trim();
    default:
      return "";
  }
}

function getProfileBaseUrl(accessStore: any, profile: any) {
  if (profile?.baseUrl) {
    return String(profile.baseUrl).trim();
  }

  switch (profile?.provider) {
    case ServiceProvider.OpenAI:
      return accessStore.openaiUrl || ApiPath.OpenAI;
    case ServiceProvider.Google:
      return accessStore.googleUrl || ApiPath.Google;
    case ServiceProvider.Alibaba:
      return accessStore.alibabaUrl || ApiPath.Alibaba;
    case ServiceProvider.ByteDance:
      return accessStore.bytedanceUrl || ApiPath.ByteDance;
    case ServiceProvider.ChatGLM:
      return accessStore.chatglmUrl || ApiPath.ChatGLM;
    case ServiceProvider.DeepSeek:
      return accessStore.deepseekUrl || ApiPath.DeepSeek;
    case ServiceProvider.Moonshot:
      return accessStore.moonshotUrl || ApiPath.Moonshot;
    case ServiceProvider.SiliconFlow:
      return accessStore.siliconflowUrl || ApiPath.SiliconFlow;
    case ServiceProvider.XAI:
      return accessStore.xaiUrl || ApiPath.XAI;
    case ServiceProvider["302.AI"]:
      return accessStore.ai302Url || ApiPath["302.AI"];
    case ServiceProvider.Stability:
      return accessStore.stabilityUrl || ApiPath.Stability;
    case ServiceProvider.Custom:
      return accessStore.customUrl || ApiPath.OpenAI;
    default:
      return "";
  }
}

function buildOpenAICompatibleImageUrl(baseUrl: string, provider: string) {
  const isGoogle = provider === ServiceProvider.Google;
  const normalizedBase = normalizeBaseUrl(baseUrl);

  if (isGoogle) {
    const hasGoogleOpenAIPath = normalizedBase.includes("/v1beta/openai");
    return joinUrl(
      normalizedBase,
      hasGoogleOpenAIPath
        ? "images/generations"
        : "v1beta/openai/images/generations",
    );
  }

  const hasV1Path =
    normalizedBase.endsWith("/v1") || normalizedBase.includes("/v1/");
  return joinUrl(
    normalizedBase,
    hasV1Path ? "images/generations" : OpenaiPath.ImagePath,
  );
}

function buildGoogleNativeImageUrl(baseUrl: string, model: string) {
  const normalizedModel = encodeURIComponent(String(model || "").trim());
  const family = getDrawModelFamily(model, ServiceProvider.Google);
  return joinUrl(
    baseUrl,
    family === "google-imagen"
      ? `v1beta/models/${normalizedModel}:predict`
      : `v1beta/models/${normalizedModel}:generateContent`,
  );
}

function redactLongString(value: unknown, maxLength = 240): unknown {
  if (typeof value === "string" && value.length > maxLength) {
    return `${value.slice(0, maxLength)}...(${value.length} chars)`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactLongString(item, maxLength));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        redactLongString(item, maxLength),
      ]),
    );
  }

  return value;
}

function logDrawRequest(payload: {
  provider: string;
  profileId?: string;
  url: string;
  model: string;
  params: Record<string, unknown>;
}) {
  logger.chat.log("===== 🎨🎨🎨 绘图请求开始 | draw 请求 =====", {
    供应商: payload.provider,
    配置ID: payload.profileId || "",
    请求地址: payload.url,
    模型: payload.model,
    请求参数: redactLongString(payload.params),
  });
}

function logDrawResponse(payload: {
  status: number;
  url: string;
  response: unknown;
}) {
  logger.chat.log("===== 🎨🎨🎨 绘图请求返回 | draw 响应 =====", {
    HTTP状态: payload.status,
    请求地址: payload.url,
    返回内容: redactLongString(payload.response),
  });
}

function extractDrawImageResult(resData: any): {
  base64Image?: string;
  mimeType?: string;
  imageUrl?: string;
} {
  const imageData = resData?.data?.[0];
  const openAIBase64 = imageData?.b64_json;
  const openAIUrl = imageData?.url;
  if (openAIBase64 || openAIUrl) {
    return {
      base64Image: openAIBase64,
      mimeType: imageData?.mimeType || imageData?.mime_type,
      imageUrl: openAIUrl,
    };
  }

  const geminiParts = resData?.candidates?.[0]?.content?.parts;
  if (Array.isArray(geminiParts)) {
    const imagePart = geminiParts.find((part: any) => part?.inlineData?.data);
    if (imagePart?.inlineData?.data) {
      return {
        base64Image: imagePart.inlineData.data,
        mimeType: imagePart.inlineData.mimeType,
      };
    }
  }

  const googlePrediction = Array.isArray(resData?.predictions)
    ? resData.predictions[0]
    : undefined;
  const googlePredictionBase64 =
    googlePrediction?.bytesBase64Encoded ||
    googlePrediction?.image?.bytesBase64Encoded ||
    googlePrediction?.image?.imageBytes;
  if (googlePredictionBase64) {
    return {
      base64Image: googlePredictionBase64,
      mimeType: googlePrediction?.mimeType || googlePrediction?.image?.mimeType,
    };
  }

  const output = resData?.output;
  const outputBase64Item = Array.isArray(output?.b64_json)
    ? output.b64_json[0]
    : undefined;
  const outputBase64 =
    typeof outputBase64Item === "string"
      ? outputBase64Item
      : outputBase64Item?.bytesBase64 ||
        outputBase64Item?.b64_json ||
        outputBase64Item?.base64;
  if (outputBase64) {
    return {
      base64Image: outputBase64,
      mimeType: outputBase64Item?.mimeType || outputBase64Item?.mime_type,
    };
  }

  const outputUrl = Array.isArray(output?.urls) ? output.urls[0] : undefined;
  if (typeof outputUrl === "string" && outputUrl) {
    return { imageUrl: outputUrl };
  }

  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === "string") {
      return { imageUrl: first };
    }
    return {
      imageUrl: first?.url || first?.image_url || first?.imageUrl,
    };
  }

  if (output && typeof output === "object") {
    return {
      imageUrl: output.url || output.image_url || output.imageUrl,
    };
  }

  return {};
}

function getDrawErrorMessage(resData: any) {
  if (resData?.error?.message) {
    return String(resData.error.message);
  }
  if (typeof resData?.error === "string") {
    return resData.error;
  }
  if (resData?.error) {
    return JSON.stringify(resData.error);
  }
  if (Array.isArray(resData?.errors) && resData.errors.length > 0) {
    return typeof resData.errors[0] === "string"
      ? resData.errors[0]
      : JSON.stringify(resData.errors[0]);
  }
  return JSON.stringify(resData);
}

function normalizeBase64ImageDataUrl(
  base64Image: string,
  mimeType = "image/png",
) {
  const trimmed = String(base64Image || "").trim();
  if (trimmed.startsWith("data:")) {
    return trimmed;
  }
  return `data:${mimeType || "image/png"};base64,${trimmed}`;
}

// 当前画图模型为设备本地偏好，仅存 localStorage，不进 IndexedDB、不参与云同步。
const DRAW_CURRENT_MODEL_STORAGE_KEY = "nextchat-draw-current-model";

function readInitialDrawModelValue() {
  if (typeof window === "undefined") return DEFAULT_DRAW_MODELS[0];
  try {
    const saved = window.localStorage.getItem(DRAW_CURRENT_MODEL_STORAGE_KEY);
    if (saved && typeof saved === "string" && saved.trim()) {
      return saved.trim();
    }
  } catch {
    // localStorage 不可用时回退到列表首项
  }
  return DEFAULT_DRAW_MODELS[0];
}

export function persistDrawCurrentModel(value: string) {
  if (typeof window === "undefined" || !value) return;
  try {
    window.localStorage.setItem(DRAW_CURRENT_MODEL_STORAGE_KEY, value);
  } catch {
    // 忽略写入异常
  }
}

const defaultDrawModel = makeDrawModel(readInitialDrawModelValue());
const defaultDrawParams = getModelParamBasicData(defaultDrawModel.params(), {});

const DEFAULT_DRAW_STATE = {
  currentId: 0,
  draw: [],
  models: DEFAULT_DRAW_MODELS,
  currentModel: defaultDrawModel,
  currentParams: defaultDrawParams,
  selectedProvider: "",
  lastRequestLog: "",
  lastResponseLog: "",
};

export const useDrawStore = createPersistStore<
  {
    currentId: number;
    draw: any[];
    models: string[];
    currentModel: typeof defaultDrawModel;
    currentParams: any;
    selectedProvider: string;
    lastRequestLog: string;
    lastResponseLog: string;
  },
  {
    getNextId: () => number;
    sendTask: (data: any, okCall?: Function) => void;
    updateDraw: (draw: any) => void;
    removeDraw: (id: string) => void;
    clearAllDraw: () => void;
    clearRequestLogs: () => void;
    setModels: (models: string[]) => void;
    setCurrentModel: (model: any) => void;
    setCurrentParams: (data: any) => void;
    setSelectedProvider: (provider: string) => void;
  }
>(
  DEFAULT_DRAW_STATE,
  (set, _get) => {
    function get() {
      return {
        ..._get(),
        ...methods,
      };
    }

    const methods = {
      getNextId() {
        const id = ++_get().currentId;
        set({ currentId: id });
        get().markUpdate();
        return id;
      },
      sendTask(data: any, okCall?: Function) {
        this.clearRequestLogs();
        data = { ...data, id: nanoid(), status: "running" };
        set({ draw: [data, ..._get().draw] });
        get().markUpdate();
        this.getNextId();
        this.drawRequestCall(data);
        okCall?.();
      },
      drawRequestCall(data: any) {
        const accessStore = useAccessStore.getState() as any;
        const selectedProvider = _get().selectedProvider;
        const selectedProfile = getDrawProfile(accessStore, selectedProvider);
        const provider = String(
          selectedProfile?.provider ||
            (accessStore.useCustomConfig
              ? ServiceProvider.Custom
              : ServiceProvider.Stability),
        );
        data = {
          ...data,
          params: pickSupportedDrawParams(
            data.model,
            data.params || {},
            provider,
          ),
        };
        const apiKey = getProfileApiKey(accessStore, selectedProfile);
        let bearerToken = getBearerToken(apiKey);
        if (!bearerToken && accessStore.enabledAccessControl()) {
          bearerToken = getBearerToken(
            ACCESS_CODE_PREFIX + accessStore.accessCode,
          );
        }

        let path = "";
        let headers: Record<string, string> = {
          Accept: "application/json",
        };
        let body: BodyInit;
        let requestBodyLog: Record<string, unknown>;
        let responseMode:
          | "stability"
          | "openai-compatible"
          | "aihubmix-prediction" = "stability";

        if (provider === ServiceProvider.Stability) {
          const prefix = getProfileBaseUrl(accessStore, selectedProfile);
          path = `${normalizeBaseUrl(prefix || ApiPath.Stability)}/${
            Stability.GeneratePath
          }/${data.model}`;
          headers.Authorization = bearerToken;
          const formData = new FormData();
          for (let paramsKey in data.params) {
            if (paramsKey === "model") continue;
            formData.append(paramsKey, String(data.params[paramsKey]));
          }
          body = formData;
          requestBodyLog = { ...data.params };
        } else if (OPENAI_COMPATIBLE_DRAW_PROVIDERS.has(provider)) {
          const baseUrl = getProfileBaseUrl(accessStore, selectedProfile);
          const normalizedBaseUrl = normalizeBaseUrl(baseUrl || ApiPath.OpenAI);
          const aiHubMixPredictionPath = isAiHubMixUrl(normalizedBaseUrl)
            ? getAiHubMixPredictionModelPath(data.model)
            : null;

          if (
            provider === ServiceProvider.Google &&
            !aiHubMixPredictionPath &&
            [
              "google-gemini-31-image",
              "google-gemini-3-pro-image",
              "google-gemini-25-image",
              "google-gemini-image",
              "google-imagen",
            ].includes(getDrawModelFamily(data.model, provider))
          ) {
            path = buildGoogleNativeImageUrl(normalizedBaseUrl, data.model);
            responseMode = "openai-compatible";
            headers["x-goog-api-key"] = apiKey;
            headers["Content-Type"] = "application/json";
            const payload = buildGoogleNativeDrawPayload(
              data.model,
              data.params || {},
            );
            body = JSON.stringify(payload);
            requestBodyLog = payload;
          } else if (aiHubMixPredictionPath) {
            path = joinUrl(
              normalizedBaseUrl,
              `v1/models/${aiHubMixPredictionPath}/predictions`,
            );
            responseMode = "aihubmix-prediction";
            headers.Authorization = bearerToken;
            headers["Content-Type"] = "application/json";
            appendAihubmixHeaders(headers, normalizedBaseUrl);
            const payload = buildAiHubMixPredictionPayload(
              data.model,
              {
                messages: [
                  { role: "user", content: data.params?.prompt || "" },
                ],
                config: {
                  model: data.model,
                  size: data.params?.image_size || data.params?.resolution,
                  quality: data.params?.quality,
                  style: data.params?.style,
                },
                onFinish() {},
              } as any,
              data.params || {},
            );
            if ((payload as any)?.input?.quality === "auto") {
              delete (payload as any).input.quality;
            }
            body = JSON.stringify(payload);
            requestBodyLog = payload as Record<string, unknown>;
          } else {
            path = buildOpenAICompatibleImageUrl(normalizedBaseUrl, provider);
            responseMode = "openai-compatible";
            if (provider === ServiceProvider.Google) {
              headers["x-goog-api-key"] = apiKey;
            } else {
              headers.Authorization = bearerToken;
            }
            headers["Content-Type"] = "application/json";
            if (isAiHubMixUrl(normalizedBaseUrl)) {
              appendAihubmixHeaders(headers, normalizedBaseUrl);
            }
            const payload = buildOpenAICompatibleDrawPayload(
              data.model,
              provider,
              data.params || {},
            );
            body = JSON.stringify(payload);
            requestBodyLog = payload;
          }
        } else {
          const unsupportedMessage = `当前模型供应商 ${provider} 暂未接入绘图请求路由，请先切换到 OpenAI 兼容或 Stability 供应商。`;
          set({ lastRequestLog: "", lastResponseLog: unsupportedMessage });
          get().markUpdate();
          this.updateDraw({
            ...data,
            status: "error",
            error: unsupportedMessage,
          });
          this.getNextId();
          return;
        }

        const requestLogPayload = {
          provider,
          profileId: selectedProfile?.id || "",
          url: path,
          model: data.model,
          params: requestBodyLog,
        };

        logDrawRequest(requestLogPayload);

        set({
          lastRequestLog: JSON.stringify(requestLogPayload, null, 2),
          lastResponseLog: "",
        });
        get().markUpdate();

        fetch(path, {
          method: "POST",
          headers,
          body,
        })
          .then(async (response) => {
            const rawText = await response.text();
            set({
              lastResponseLog: `HTTP ${response.status}\n${
                rawText || "(empty)"
              }`,
            });
            get().markUpdate();

            if (!rawText) {
              logDrawResponse({
                status: response.status,
                url: path,
                response: "(empty)",
              });
              return {};
            }

            try {
              const json = JSON.parse(rawText);
              logDrawResponse({
                status: response.status,
                url: path,
                response: json,
              });
              return json;
            } catch {
              logDrawResponse({
                status: response.status,
                url: path,
                response: rawText,
              });
              throw new Error(rawText);
            }
          })
          .then((resData) => {
            if (resData.errors && resData.errors.length > 0) {
              this.updateDraw({
                ...data,
                status: "error",
                error: getDrawErrorMessage(resData),
              });
              this.getNextId();
              return;
            }
            const self = this;
            if (
              responseMode === "stability" &&
              resData.finish_reason === "SUCCESS"
            ) {
              self.updateDraw({
                ...data,
                status: "success",
                img_data: normalizeBase64ImageDataUrl(resData.image),
              });
            } else if (
              responseMode === "openai-compatible" ||
              responseMode === "aihubmix-prediction"
            ) {
              const { base64Image, imageUrl, mimeType } =
                extractDrawImageResult(resData);
              if (base64Image) {
                self.updateDraw({
                  ...data,
                  status: "success",
                  img_data: normalizeBase64ImageDataUrl(base64Image, mimeType),
                });
              } else if (imageUrl) {
                self.updateDraw({
                  ...data,
                  status: "success",
                  img_data: imageUrl,
                });
              } else if (resData?.error?.message || resData?.error) {
                self.updateDraw({
                  ...data,
                  status: "error",
                  error: getDrawErrorMessage(resData),
                });
              } else {
                self.updateDraw({
                  ...data,
                  status: "error",
                  error: getDrawErrorMessage(resData),
                });
              }
            } else {
              self.updateDraw({
                ...data,
                status: "error",
                error: getDrawErrorMessage(resData),
              });
            }
            this.getNextId();
          })
          .catch((error) => {
            set({
              lastResponseLog: String(
                _get().lastResponseLog || error.message || error,
              ),
            });
            get().markUpdate();
            this.updateDraw({ ...data, status: "error", error: error.message });
            console.error("Error:", error);
            this.getNextId();
          });
      },
      updateDraw(_draw: any) {
        const draw = [...(_get().draw || [])];
        draw.some((item, index) => {
          if (item.id === _draw.id) {
            draw[index] = _draw;
            set(() => ({ draw }));
            get().markUpdate();
            return true;
          }
        });
      },
      removeDraw(id: string) {
        const draw = (_get().draw || []).filter((item) => item.id !== id);
        set({ draw });
        get().markUpdate();
      },
      clearAllDraw() {
        set({ draw: [], currentId: 0 });
        get().markUpdate();
      },
      // 以下为设备本地偏好/调试日志，仅本地持久化、不触发云同步（绘画记录仍正常同步）。
      clearRequestLogs() {
        set({ lastRequestLog: "", lastResponseLog: "" });
      },
      setModels(models: string[]) {
        set({ models });
      },
      setCurrentModel(model: any) {
        const value =
          typeof model === "string" ? model : String(model?.value || "");
        if (value) persistDrawCurrentModel(value);
        set({ currentModel: makeDrawModel(value) });
      },
      setCurrentParams(data: any) {
        set({
          currentParams: data,
        });
      },
      setSelectedProvider(provider: string) {
        set({ selectedProvider: provider });
      },
    };

    return methods;
  },
  {
    name: StoreKey.DrawList,
    version: 2,
  },
);
