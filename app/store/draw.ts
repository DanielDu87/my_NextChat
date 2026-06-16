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
import {
  createPersistStore,
  runWithImmediateStoreSyncPaused,
  runWithImmediateStoreSyncPausedSync,
} from "@/app/utils/store";
import { appendAihubmixHeaders, isAiHubMixUrl } from "@/app/utils/aihubmix";
import { nanoid } from "nanoid";
import {
  DEFAULT_DRAW_MODELS,
  getModelParamBasicData,
  makeDrawModel,
} from "@/app/components/draw/draw-panel";
import { logger } from "@/app/utils/logger";
import { useAccessStore } from "./access";
import { useAppConfig } from "./config";
import {
  getDrawModelFamily,
  normalizeOpenAICompatibleImageQuality,
  parseDrawImageSize,
  pickSupportedDrawParams,
  toBooleanParam,
  toDashScopeSize,
} from "@/app/utils/draw-model-params";
import {
  getCustomModelApiKeySelection,
  isRememberedApiKeyProfile,
  rememberSuccessfulCustomModelApiKeyGroup,
} from "@/app/utils/model-api-key-memory";

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
  const trimmed = String(baseUrl || "")
    .trim()
    .replace(/^['"`\s]+/, "")
    .replace(/['"`\s,]+$/, "");
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
      if (provider !== ServiceProvider.Google) {
        payload.text_prompt = payload.prompt;
        delete payload.prompt;
        payload.response_format = params.response_format || "url";
        assignDrawParam(payload, "aspect_ratio", params.aspect_ratio || "1:1");
        assignDrawParam(payload, "resolution", params.resolution || "1K");
        return payload;
      }
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
      if (provider !== ServiceProvider.Google) {
        payload.text_prompt = payload.prompt;
        delete payload.prompt;
        payload.response_format = params.response_format || "url";
        assignDrawParam(payload, "aspect_ratio", params.aspect_ratio || "1:1");
        return payload;
      }
      payload.response_format = {
        image: {
          aspect_ratio: params.aspect_ratio || "1:1",
        },
      };
      return payload;
    }
    case "google-imagen": {
      assignDrawParam(payload, "n", params.n ? Number(params.n) : undefined);
      if (provider !== ServiceProvider.Google) {
        payload.text_prompt = payload.prompt;
        delete payload.prompt;
        payload.response_format = params.response_format || "url";
        assignDrawParam(payload, "aspect_ratio", params.aspect_ratio || "1:1");
        assignDrawParam(payload, "resolution", params.resolution || "1K");
        return payload;
      }
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

function normalizeLogUrl(url: string) {
  return String(url || "")
    .trim()
    .replace(/^['"`\s]+/, "")
    .replace(/['"`\s,]+$/, "");
}

function isDebugDrawLogsEnabled() {
  if (process.env.NODE_ENV === "test") {
    return false;
  }

  try {
    return globalThis.localStorage?.getItem("debug-draw-logs") === "1";
  } catch {
    return false;
  }
}

function logDrawRequest(payload: {
  provider: string;
  profileId?: string;
  url: string;
  model: string;
  params: Record<string, unknown>;
}) {
  logger.draw.log("===== 🎨🎨🎨 绘图请求开始 | draw 请求 =====", {
    供应商: payload.provider,
    配置ID: payload.profileId || "",
    请求地址: normalizeLogUrl(payload.url),
    模型: payload.model,
    请求参数: redactLongString(payload.params),
  });
}

function logDrawResponse(payload: {
  status: number;
  url: string;
  response: unknown;
  force?: boolean;
}) {
  if (!payload.force && !isDebugDrawLogsEnabled()) {
    return;
  }

  logger.draw.log("===== 🎨🎨🎨 绘图请求返回 | draw 响应 =====", {
    HTTP状态: payload.status,
    请求地址: normalizeLogUrl(payload.url),
    返回内容: redactLongString(payload.response),
  });
}

function getDrawMultiKeyGroupName(groups: string[], index: number) {
  return groups[index] || `index-${index}`;
}

function getSafeDrawRetryReason(reason: string, maxLength = 200) {
  return String(reason || "")
    .replace(/当前分组\s+[^"\s]+?\s+下/g, "当前分组 [provider-internal] 下")
    .substring(0, maxLength);
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

  if (typeof output === "string" && output) {
    return { imageUrl: output };
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

  logger.draw.warn("extractDrawImageResult 无法解析图片数据", {
    hasData: !!resData?.data,
    hasCandidates: !!resData?.candidates,
    hasPredictions: !!resData?.predictions,
    outputType: typeof resData?.output,
    outputKeys: resData?.output ? Object.keys(resData.output) : [],
    hasOutput: !!resData?.output,
  });
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

function getDrawMultiKeyRetryableErrorMessage(resData: any) {
  const errorCode = String(resData?.error?.code || resData?.code || "").trim();
  const errorMessage = String(
    resData?.error?.message || resData?.message || "",
  ).trim();

  if (!errorCode && !errorMessage) {
    return "";
  }

  if (
    errorCode === "model_not_found" ||
    errorMessage.includes("无可用渠道") ||
    errorMessage.includes("no available distributor") ||
    errorMessage.includes("无效的令牌") ||
    errorMessage.toLowerCase().includes("invalid token")
  ) {
    return errorMessage || errorCode;
  }

  return "";
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

// 本地 localStorage 仍保留最近一次画图模型，作为冷启动回退值；
// 实际供应商维度模型列表与当前模型会持久化到 draw store，并参与数据库同步。
const DRAW_CURRENT_MODEL_STORAGE_KEY = "nextchat-draw-current-model";
const DRAW_LEGACY_PROVIDER_BUCKET = "__legacy__";

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

function normalizeDrawProviderKey(provider: unknown) {
  return String(provider || "").trim();
}

function getDrawModelsForProvider(
  state: {
    providerModels?: Record<string, string[]>;
    models?: string[];
  },
  provider: unknown,
) {
  const providerKey = normalizeDrawProviderKey(provider);
  const providerModels = state.providerModels || {};
  const hasProviderModels = Object.prototype.hasOwnProperty.call(
    providerModels,
    providerKey,
  );
  const hasLegacyProviderModels = Object.prototype.hasOwnProperty.call(
    providerModels,
    DRAW_LEGACY_PROVIDER_BUCKET,
  );
  const nextModels = hasProviderModels
    ? providerModels[providerKey]
    : hasLegacyProviderModels
    ? providerModels[DRAW_LEGACY_PROVIDER_BUCKET]
    : state.models || DEFAULT_DRAW_MODELS;

  const normalized = Array.from(
    new Set(
      (Array.isArray(nextModels) ? nextModels : DEFAULT_DRAW_MODELS).filter(
        Boolean,
      ),
    ),
  );

  return normalized;
}

function getDrawCurrentModelForProvider(
  state: {
    providerCurrentModelMap?: Record<string, string>;
    currentModel?: { value?: string };
    providerModels?: Record<string, string[]>;
    models?: string[];
  },
  provider: unknown,
) {
  const providerKey = normalizeDrawProviderKey(provider);
  const models = getDrawModelsForProvider(state, providerKey);
  const providerCurrentModel =
    state.providerCurrentModelMap?.[providerKey] ||
    state.providerCurrentModelMap?.[DRAW_LEGACY_PROVIDER_BUCKET] ||
    state.currentModel?.value ||
    readInitialDrawModelValue();

  return models.includes(providerCurrentModel)
    ? providerCurrentModel
    : models[0] || DEFAULT_DRAW_MODELS[0];
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
  deletedTaskIds: {} as Record<string, number>,
  providerModels: {} as Record<string, string[]>,
  providerCurrentModelMap: {} as Record<string, string>,
  models: DEFAULT_DRAW_MODELS,
  currentModel: defaultDrawModel,
  currentParams: defaultDrawParams,
  selectedProvider: "",
  lastRequestLog: "",
  lastResponseLog: "",
};

const activeDrawRequestIds = new Set<string>();
const MAX_DRAW_RESUME_ATTEMPTS = 3;

export const useDrawStore = createPersistStore<
  {
    currentId: number;
    draw: any[];
    deletedTaskIds: Record<string, number>;
    providerModels: Record<string, string[]>;
    providerCurrentModelMap: Record<string, string>;
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
    resumePendingTasks: () => void;
    updateDraw: (draw: any) => void;
    removeDraw: (id: string) => void;
    clearAllDraw: () => void;
    clearRequestLogs: () => void;
    setModels: (models: string[], provider?: string) => void;
    setCurrentModel: (model: any, provider?: string) => void;
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

    function markTaskDeleted(taskIds: string[]) {
      if (taskIds.length === 0) return;

      set((prev) => {
        const prevState = prev as any;
        const nextDeletedTaskIds = {
          ...(prevState.deletedTaskIds || {}),
        } as Record<string, number>;
        const deletedAt = Date.now();
        taskIds.forEach((taskId) => {
          if (taskId) {
            nextDeletedTaskIds[taskId] = deletedAt;
          }
        });

        const recentEntries = Object.entries(nextDeletedTaskIds)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 300);

        return {
          deletedTaskIds: Object.fromEntries(recentEntries),
        };
      });
    }

    const methods = {
      getNextId() {
        const id = ++_get().currentId;
        set({ currentId: id });
        get().markUpdate();
        return id;
      },
      sendTask(data: any, okCall?: Function) {
        get().clearRequestLogs();
        data = {
          ...data,
          id: nanoid(),
          status: "running",
          selectedProvider: _get().selectedProvider,
          requestedAt: Date.now(),
        };
        logger.draw.log(
          `🚀 创建任务 id=${data.id}, 模型=${data.model}, 供应商=${data.selectedProvider}`,
        );
        runWithImmediateStoreSyncPausedSync(() => {
          set({ draw: [data, ..._get().draw] });
          get().markUpdate();
        });
        runWithImmediateStoreSyncPausedSync(() => get().getNextId());
        get().drawRequestCall(data);
        okCall?.();
      },
      resumePendingTasks() {
        const pendingTasks = (_get().draw || []).filter(
          (item: any) =>
            item?.status === "running" &&
            item?.id &&
            !activeDrawRequestIds.has(String(item.id)),
        );

        if (pendingTasks.length === 0) {
          return;
        }

        const resumableTasks: any[] = [];
        const failedTaskIds: string[] = [];

        set((prev) => {
          const prevState = prev as any;
          const nextDraw = (prevState.draw || []).map((item: any) => {
            const taskId = String(item?.id || "");
            if (
              !pendingTasks.some((task: any) => String(task?.id) === taskId)
            ) {
              return item;
            }

            const resumeAttempts = Number(item?.resumeAttempts || 0);
            if (resumeAttempts >= MAX_DRAW_RESUME_ATTEMPTS) {
              failedTaskIds.push(taskId);
              return {
                ...item,
                status: "error",
                error:
                  item?.error ||
                  "页面刷新后多次恢复绘图任务仍未完成，请点击重试重新生成",
                interruptedAt: Date.now(),
              };
            }

            const nextTask = {
              ...item,
              status: "running",
              error: "",
              resumeAttempts: resumeAttempts + 1,
              resumedAt: Date.now(),
            };
            resumableTasks.push(nextTask);
            return nextTask;
          });

          return { draw: nextDraw };
        });

        if (resumableTasks.length > 0) {
          logger.draw.warn(
            `检测到 ${resumableTasks.length} 个中断的绘图任务，正在自动恢复生成`,
            { ids: resumableTasks.map((item) => item.id) },
          );
        }

        if (failedTaskIds.length > 0) {
          logger.draw.warn(
            `检测到 ${failedTaskIds.length} 个绘图任务超过恢复次数，已改为失败状态`,
            { ids: failedTaskIds },
          );
        }

        get().markUpdate();

        resumableTasks.forEach((task) => {
          get().drawRequestCall(task);
        });
      },
      drawRequestCall(data: any) {
        const requestId = String(data?.id || "");
        if (requestId) {
          if (activeDrawRequestIds.has(requestId)) {
            return;
          }
          activeDrawRequestIds.add(requestId);
        }
        const accessStore = useAccessStore.getState() as any;
        const selectedProvider =
          data.selectedProvider || _get().selectedProvider;
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
        const appConfigStore = useAppConfig.getState();
        let apiKey = getProfileApiKey(accessStore, selectedProfile);
        const shouldEnableMultiKeyFallback =
          provider === ServiceProvider.Custom &&
          Boolean(
            selectedProfile && isRememberedApiKeyProfile(selectedProfile),
          );
        const apiKeySelection = shouldEnableMultiKeyFallback
          ? getCustomModelApiKeySelection(
              data.model,
              selectedProfile as any,
              appConfigStore.models || [],
            )
          : {
              current: apiKey,
              fallback: [] as string[],
              fallbackGroups: [] as string[],
              rememberedGroup: "",
            };

        if (
          shouldEnableMultiKeyFallback &&
          apiKeySelection.fallback.length > 0
        ) {
          apiKey = apiKeySelection.current;
        }

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
          get().updateDraw({
            ...data,
            status: "error",
            error: unsupportedMessage,
          });
          get().getNextId();
          return;
        }

        const requestLogPayload = {
          method: "POST",
          provider,
          profileId: selectedProfile?.id || "",
          url: path,
          model: data.model,
          body: requestBodyLog,
        };

        logDrawRequest({ ...requestLogPayload, params: requestBodyLog });

        set({
          lastRequestLog: JSON.stringify(requestLogPayload, null, 2),
          lastResponseLog: "",
        });

        void runWithImmediateStoreSyncPaused(async () => {
          const fallbackApiKeys = apiKeySelection.fallback || [];
          const fallbackApiKeyGroups = apiKeySelection.fallbackGroups || [];
          const supportsMultiKeyRetry =
            shouldEnableMultiKeyFallback && fallbackApiKeys.length > 1;
          let retryCount = 0;
          let lastRetryReason = "";

          const getAuthHeaderKey = () => {
            return Object.keys(headers).find(
              (key) =>
                key.toLowerCase() === "authorization" ||
                key.toLowerCase() === "x-api-key",
            );
          };

          const applyApiKeyToHeaders = (nextApiKey: string) => {
            const authHeader = getAuthHeaderKey();
            if (!authHeader) {
              return;
            }
            headers[authHeader] = `Bearer ${nextApiKey}`;
          };

          const applyDrawResult = (resData: any) => {
            if (resData.errors && resData.errors.length > 0) {
              const errMsg = getDrawErrorMessage(resData);
              logger.draw.warn(`❌ 失败 id=${data.id}, 错误=${errMsg}`);
              get().updateDraw({
                ...data,
                status: "error",
                error: errMsg,
              });
              return false;
            }
            if (
              responseMode === "stability" &&
              resData.finish_reason === "SUCCESS"
            ) {
              const img = normalizeBase64ImageDataUrl(resData.image);
              logger.draw.log(
                `✅ 成功 id=${data.id}, 图片=${img.slice(0, 80)}...`,
              );
              get().updateDraw({
                ...data,
                status: "success",
                img_data: img,
              });
              return true;
            }
            if (
              responseMode === "openai-compatible" ||
              responseMode === "aihubmix-prediction"
            ) {
              const { base64Image, imageUrl, mimeType } =
                extractDrawImageResult(resData);
              if (base64Image) {
                const img = normalizeBase64ImageDataUrl(base64Image, mimeType);
                logger.draw.log(
                  `✅ 成功 id=${data.id}, 图片(base64长度=${base64Image.length}, mime=${mimeType})`,
                );
                get().updateDraw({
                  ...data,
                  status: "success",
                  img_data: img,
                });
                return true;
              }
              if (imageUrl) {
                logger.draw.log(
                  `✅ 成功 id=${data.id}, 图片URL=${normalizeLogUrl(imageUrl)}`,
                );
                get().updateDraw({
                  ...data,
                  status: "success",
                  img_data: imageUrl,
                });
                return true;
              }
              const errMsg = getDrawErrorMessage(resData);
              logger.draw.warn(`❌ 失败 id=${data.id}, 错误=${errMsg}`);
              get().updateDraw({
                ...data,
                status: "error",
                error: errMsg,
              });
              return false;
            }

            const errMsg = getDrawErrorMessage(resData);
            logger.draw.warn(
              `❌ 失败 id=${data.id}, 未知响应模式=${responseMode}, 错误=${errMsg}`,
            );
            get().updateDraw({
              ...data,
              status: "error",
              error: errMsg,
            });
            return false;
          };

          while (true) {
            if (supportsMultiKeyRetry) {
              const currentApiKey = fallbackApiKeys[retryCount];
              if (currentApiKey) {
                applyApiKeyToHeaders(currentApiKey);
              }
              const currentGroup = getDrawMultiKeyGroupName(
                fallbackApiKeyGroups,
                retryCount,
              );
              const rememberedGroup = apiKeySelection.rememberedGroup || "";
              if (retryCount === 0 && rememberedGroup === currentGroup) {
                logger.draw.log("[MultiKey] 绘图命中已记忆分组，正在尝试", {
                  currentGroup,
                  attempt: retryCount + 1,
                  totalGroups: fallbackApiKeys.length,
                  loadedFromLocalStorage: true,
                });
              } else {
                logger.draw.log("[MultiKey] 绘图正在尝试分组", {
                  currentGroup,
                  attempt: retryCount + 1,
                  totalGroups: fallbackApiKeys.length,
                });
              }
            }

            const response = await fetch(path, {
              method: "POST",
              headers,
              body,
            });

            const rawText = await response.text();
            set({
              lastResponseLog: `HTTP ${response.status}\n${
                rawText || "(empty)"
              }`,
            });

            let resData: any = {};
            if (!rawText) {
              logDrawResponse({
                status: response.status,
                url: path,
                response: "(empty)",
                force: !supportsMultiKeyRetry,
              });
            } else {
              try {
                resData = JSON.parse(rawText);
                logDrawResponse({
                  status: response.status,
                  url: path,
                  response: resData,
                  force: !supportsMultiKeyRetry,
                });
              } catch {
                resData = { error: { message: rawText } };
                logDrawResponse({
                  status: response.status,
                  url: path,
                  response: rawText,
                  force: !supportsMultiKeyRetry,
                });
              }
            }

            const retryableError =
              getDrawMultiKeyRetryableErrorMessage(resData);
            const errorMessage = String(
              resData?.error?.message || resData?.message || "",
            );
            const failureReason =
              retryableError ||
              errorMessage ||
              (response.ok ? "" : `HTTP ${response.status}`);
            const shouldRetry =
              supportsMultiKeyRetry &&
              retryCount < fallbackApiKeys.length - 1 &&
              (!response.ok || Boolean(retryableError));

            if (shouldRetry) {
              const currentGroup = getDrawMultiKeyGroupName(
                fallbackApiKeyGroups,
                retryCount,
              );
              const nextGroup = getDrawMultiKeyGroupName(
                fallbackApiKeyGroups,
                retryCount + 1,
              );
              lastRetryReason = failureReason;
              logger.draw.warn(
                `[MultiKey Retry] 绘图分组尝试失败，切换分组 (${
                  retryCount + 1
                }/${fallbackApiKeys.length})`,
                {
                  httpStatus: response.status,
                  currentGroup,
                  nextGroup,
                  reason: getSafeDrawRetryReason(failureReason),
                },
              );
              if (apiKeySelection.rememberedGroup === currentGroup) {
                logger.draw.warn(
                  "[MultiKey Retry] 绘图已记忆分组失败，将继续尝试全部剩余分组",
                  {
                    rememberedGroup: currentGroup,
                    remainingGroups: fallbackApiKeyGroups.slice(retryCount + 1),
                  },
                );
              }
              retryCount += 1;
              continue;
            }

            if (supportsMultiKeyRetry) {
              logDrawResponse({
                status: response.status,
                url: path,
                response: resData,
                force: true,
              });
            }

            if (supportsMultiKeyRetry && !response.ok) {
              logger.draw.warn("[MultiKey Retry] 绘图所有分组重试失败", {
                currentGroup: getDrawMultiKeyGroupName(
                  fallbackApiKeyGroups,
                  retryCount,
                ),
                attempt: retryCount + 1,
                totalGroups: fallbackApiKeys.length,
                reason: getSafeDrawRetryReason(
                  failureReason || lastRetryReason,
                ),
              });
            }

            if (!response.ok || resData.errors?.length > 0) {
              const errMsg = getDrawErrorMessage(resData);
              logger.draw.warn(`❌ 失败 id=${data.id}, 错误=${errMsg}`);
              get().updateDraw({
                ...data,
                status: "error",
                error: errMsg,
              });
              get().getNextId();
              break;
            }

            const drawSucceeded = applyDrawResult(resData);

            if (supportsMultiKeyRetry && drawSucceeded) {
              const groupName = fallbackApiKeyGroups[retryCount] || "";
              if (groupName) {
                logger.draw.log("[MultiKey] 绘图分组请求成功，写入记忆", {
                  currentGroup: groupName,
                  attempt: retryCount + 1,
                  totalGroups: fallbackApiKeys.length,
                  willSaveToLocalStorage: true,
                });
                rememberSuccessfulCustomModelApiKeyGroup({
                  modelName: data.model,
                  groupName,
                  profileId: selectedProfile?.id || "",
                  providerId: selectedProfile?.name
                    ? `custom_${selectedProfile.name}`.toLowerCase()
                    : "",
                });
              }
            }

            get().getNextId();
            break;
          }
        })
          .catch((error) => {
            const errMsg = String(error?.message || error);
            logger.draw.error(
              `❌ 网络错误 id=${data.id}, 错误=${errMsg}`,
              error,
            );
            set({
              lastResponseLog: String(_get().lastResponseLog || errMsg),
            });
            get().updateDraw({
              ...data,
              status: "error",
              error: errMsg,
            });
            get().getNextId();
          })
          .finally(() => {
            if (requestId) {
              activeDrawRequestIds.delete(requestId);
            }
            get().markUpdate();
          });
      },
      updateDraw(_draw: any) {
        if (!_draw?.id) {
          return;
        }

        if (_get().deletedTaskIds?.[_draw.id]) {
          logger.draw.log(
            `updateDraw 已跳过已删除任务 id=${_draw.id}, status=${_draw.status}`,
          );
          return;
        }

        set((prev) => {
          const prevState = prev as any;
          const draw = [...(prevState.draw || [])];
          let found = false;
          draw.some((item, index) => {
            if (item.id === _draw.id) {
              draw[index] = _draw;
              found = true;
              return true;
            }
          });
          if (!found) {
            logger.draw.warn("updateDraw 未找到匹配条目，已自动补回", {
              status: _draw.status,
              id: _draw.id,
              currentCount: draw.length,
            });
            draw.unshift(_draw);
            return { draw };
          }
          return { draw };
        });
        get().markUpdate();
      },
      removeDraw(id: string) {
        markTaskDeleted([id]);
        const draw = (_get().draw || []).filter((item) => item.id !== id);
        set({ draw });
        get().markUpdate();
      },
      clearAllDraw() {
        const taskIds = (_get().draw || [])
          .map((item: any) => String(item?.id || ""))
          .filter(Boolean);
        markTaskDeleted(taskIds);
        set({ draw: [], currentId: 0 });
        get().markUpdate();
      },
      // 以下为本地参数编辑态/调试日志；模型列表与供应商选择会参与云同步。
      clearRequestLogs() {
        set({ lastRequestLog: "", lastResponseLog: "" });
      },
      setModels(models: string[], provider?: string) {
        const providerKey = normalizeDrawProviderKey(
          provider ?? _get().selectedProvider,
        );
        const normalizedModels = Array.from(
          new Set((models || []).filter(Boolean)),
        );
        const nextModels = normalizedModels;

        set((prev) => {
          const prevState = prev as any;
          const providerModels = {
            ...(prevState.providerModels || {}),
            [providerKey]: nextModels,
          };
          const currentValue = getDrawCurrentModelForProvider(
            {
              ...prevState,
              providerModels,
            },
            providerKey,
          );
          return {
            providerModels,
            models:
              providerKey ===
              normalizeDrawProviderKey(prevState.selectedProvider)
                ? nextModels.length > 0
                  ? nextModels
                  : []
                : prevState.models,
            currentModel:
              providerKey ===
              normalizeDrawProviderKey(prevState.selectedProvider)
                ? makeDrawModel(currentValue)
                : prevState.currentModel,
            providerCurrentModelMap: {
              ...(prevState.providerCurrentModelMap || {}),
              [providerKey]: currentValue,
            },
          };
        });
        get().markUpdate();
      },
      setCurrentModel(model: any, provider?: string) {
        const value =
          typeof model === "string" ? model : String(model?.value || "");
        if (value) persistDrawCurrentModel(value);
        const providerKey = normalizeDrawProviderKey(
          provider ?? _get().selectedProvider,
        );
        set((prev) => {
          const prevState = prev as any;
          const nextCurrentMap = {
            ...(prevState.providerCurrentModelMap || {}),
            [providerKey]: value,
          };
          return {
            providerCurrentModelMap: nextCurrentMap,
            currentModel:
              providerKey ===
              normalizeDrawProviderKey(prevState.selectedProvider)
                ? makeDrawModel(value)
                : prevState.currentModel,
          };
        });
        get().markUpdate();
      },
      setCurrentParams(data: any) {
        set({
          currentParams: data,
        });
        get().markUpdate();
      },
      setSelectedProvider(provider: string) {
        const providerKey = normalizeDrawProviderKey(provider);
        const nextModels = getDrawModelsForProvider(_get(), providerKey);
        const nextCurrentModel = getDrawCurrentModelForProvider(
          _get(),
          providerKey,
        );
        if (nextCurrentModel) persistDrawCurrentModel(nextCurrentModel);
        set({
          selectedProvider: provider,
          models: nextModels,
          currentModel: makeDrawModel(nextCurrentModel),
        });
        get().markUpdate();
      },
    };

    return methods;
  },
  {
    name: StoreKey.DrawList,
    version: 3,
    migrate: (persistedState: any, version) => {
      if (!persistedState || typeof persistedState !== "object") {
        return persistedState;
      }
      if ((version || 0) >= 3) {
        return persistedState;
      }

      const legacyProviderKey =
        normalizeDrawProviderKey(persistedState.selectedProvider) ||
        DRAW_LEGACY_PROVIDER_BUCKET;
      const legacyModels = Array.isArray(persistedState.models)
        ? persistedState.models.filter(Boolean)
        : [];
      const legacyCurrentModel = String(
        persistedState.currentModel?.value || persistedState.currentModel || "",
      ).trim();

      return {
        ...persistedState,
        providerModels:
          legacyModels.length > 0
            ? {
                ...(persistedState.providerModels || {}),
                [legacyProviderKey]: legacyModels,
              }
            : persistedState.providerModels || {},
        providerCurrentModelMap: legacyCurrentModel
          ? {
              ...(persistedState.providerCurrentModelMap || {}),
              [legacyProviderKey]: legacyCurrentModel,
            }
          : persistedState.providerCurrentModelMap || {},
      };
    },
  },
);
