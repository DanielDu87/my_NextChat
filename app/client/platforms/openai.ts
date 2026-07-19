"use client";
// azure and openai, using same models. so using same LLMApi.
import { default as constants } from "@/app/constant";
import type { ChatMessageTool } from "@/app/store/chat";
import { useChatStore } from "@/app/store/chat";
import { useAccessStore } from "@/app/store/access";
import { useAppConfig } from "@/app/store/config";
import { usePluginStore } from "@/app/store/plugin";
import {
  collectModelsWithDefaultModel,
  normalizeReservedDisplayModelName,
} from "@/app/utils/model";
import {
  preProcessImageContent,
  uploadImage,
  base64Image2Blob,
  streamWithThink,
  stripInternalChatHeaders,
  getRetryableErrorReason,
} from "@/app/utils/chat";
import { rememberSuccessfulCustomModelApiKeyGroup } from "@/app/utils/model-api-key-memory";
import {
  applyRequestCompatibilityState,
  buildRequestCompatibilityKey,
  getRequestCompatibilityFallback,
  getRequestCompatibilityState,
  rememberRequestCompatibilityState,
} from "@/app/utils/request-compat-memory";
import {
  appendAuthQueryParam,
  replaceUrlQueryParam,
} from "@/app/utils/model-fetch-common";
import {
  getRememberedChatEndpoint,
  rememberChatEndpoint,
} from "@/app/utils/api-path-memory";
import { cloudflareAIGatewayUrl } from "@/app/utils/cloudflare";
import { ModelSize, DalleQuality, DalleStyle } from "@/app/typing";

import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  LLMUsage,
  MultimodalContent,
  SpeechOptions,
} from "../api";
import {
  applyModelSamplingRules,
  getDefaultReasoningSettings,
  getModelParameterSupport,
} from "../model-parameter-rules";
import Locale from "../../locales";
import { getClientConfig } from "@/app/config/client";
import {
  getMessageTextContent,
  getMessageImages,
  isDalle3 as _isDalle3,
  isImageGenerationModel,
  isVideoGenerationModel,
  getTimeoutMSByModel,
  normalizeModelSize,
  normalizeImageQuality,
} from "@/app/utils";
import { fetch } from "@/app/utils/stream";
import { joinUrlPath } from "@/app/utils/url";
import {
  getDrawModelFamily,
  parseDrawImageSize,
  toBooleanParam,
  toDashScopeSize,
} from "@/app/utils/draw-model-params";

const {
  ApiPath,
  OPENAI_BASE_URL,
  OpenaiPath,
  Azure,
  REQUEST_TIMEOUT_MS,
  ServiceProvider,
} = constants;
type ServiceProviderValue =
  (typeof ServiceProvider)[keyof typeof ServiceProvider];

const GENERIC_CHAT_ENDPOINT_CANDIDATES = [
  { path: "v1/chat/completions", method: "POST", format: "openai-chat" },
  { path: "chat/completions", method: "POST", format: "openai-chat" },
  { path: "api/v1/chat/completions", method: "POST", format: "openai-chat" },
  { path: "api/chat/completions", method: "POST", format: "openai-chat" },
  { path: "v1/responses", method: "POST", format: "openai-responses" },
  { path: "responses", method: "POST", format: "openai-responses" },
  { path: "api/v1/responses", method: "POST", format: "openai-responses" },
  { path: "api/responses", method: "POST", format: "openai-responses" },
  { path: "v1/messages", method: "POST", format: "anthropic-messages" },
  { path: "messages", method: "POST", format: "anthropic-messages" },
  { path: "api/v1/messages", method: "POST", format: "anthropic-messages" },
  { path: "api/messages", method: "POST", format: "anthropic-messages" },
] as const;

type GenericChatEndpointFormat =
  (typeof GENERIC_CHAT_ENDPOINT_CANDIDATES)[number]["format"];

type GenericChatEndpointCandidate = {
  path: string;
  method: "POST";
  format: GenericChatEndpointFormat;
};

const DEFAULT_GENERIC_CHAT_ENDPOINT: GenericChatEndpointCandidate = {
  path: normalizeCandidatePath(OpenaiPath.ChatPath),
  method: "POST",
  format: "openai-chat",
};

function buildGenericChatPayload(
  requestPayload:
    | RequestPayload
    | DalleRequestPayload
    | Record<string, unknown>
    | FormData,
  format: GenericChatEndpointFormat,
) {
  if (
    requestPayload instanceof FormData ||
    format === "openai-chat" ||
    !Array.isArray((requestPayload as RequestPayload).messages)
  ) {
    return requestPayload;
  }

  const chatRequestPayload = requestPayload as RequestPayload;

  if (format === "openai-responses") {
    return {
      model: chatRequestPayload.model,
      input: chatRequestPayload.messages.map((message) => ({
        role: message.role === "developer" ? "system" : message.role,
        content: message.content,
      })),
      temperature: chatRequestPayload.temperature,
      top_p: chatRequestPayload.top_p,
      max_output_tokens:
        chatRequestPayload.max_completion_tokens ||
        chatRequestPayload.max_tokens,
      stream: chatRequestPayload.stream,
    };
  }

  if (format === "anthropic-messages") {
    const system = chatRequestPayload.messages
      .filter(
        (message) => message.role === "system" || message.role === "developer",
      )
      .map((message) => message.content)
      .filter((content) => typeof content === "string")
      .join("\n\n");
    return {
      model: chatRequestPayload.model,
      messages: chatRequestPayload.messages
        .filter(
          (message) =>
            message.role !== "system" && message.role !== "developer",
        )
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        })),
      ...(system ? { system } : {}),
      max_tokens:
        chatRequestPayload.max_completion_tokens ||
        chatRequestPayload.max_tokens ||
        1024,
      temperature: chatRequestPayload.temperature,
      top_p: chatRequestPayload.top_p,
      stream: chatRequestPayload.stream,
    };
  }

  return requestPayload;
}

function extractGenericMessage(res: any) {
  const openaiContent = res?.choices?.at?.(0)?.message?.content;
  if (openaiContent) return openaiContent;

  const responseText = res?.output_text;
  if (responseText) return responseText;

  const responseOutput = Array.isArray(res?.output)
    ? res.output
        .flatMap((item: any) => item?.content || [])
        .map((item: any) => item?.text || item?.content || "")
        .filter(Boolean)
        .join("")
    : "";
  if (responseOutput) return responseOutput;

  const anthropicContent = Array.isArray(res?.content)
    ? res.content
        .map((item: any) => item?.text || "")
        .filter(Boolean)
        .join("")
    : "";
  if (anthropicContent) return anthropicContent;

  return "";
}

function normalizeCandidatePath(path?: string) {
  return String(path || "")
    .trim()
    .replace(/^\/+/, "");
}

function isRetryablePathProbeStatus(status: number) {
  return [400, 404, 405, 422].includes(status);
}

function getAccessProviderId(profile: { provider: string; name: string }) {
  return profile.provider === ServiceProvider.Custom
    ? `custom_${profile.name}`.toLowerCase()
    : String(profile.provider || "").toLowerCase();
}

function getCustomProfileForModelConfig(
  accessStore: ReturnType<typeof useAccessStore.getState>,
  modelConfig?: Partial<ChatOptions["config"]>,
) {
  const profileId = String((modelConfig as any)?.profileId || "").trim();
  const providerId = String((modelConfig as any)?.providerId || "")
    .trim()
    .toLowerCase();

  if (!profileId && !providerId) {
    return undefined;
  }

  return accessStore.apiProfiles.find((profile) => {
    if (profile.provider !== ServiceProvider.Custom) {
      return false;
    }
    if (profileId && profile.id === profileId) {
      return true;
    }
    return providerId && getAccessProviderId(profile) === providerId;
  });
}

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

export interface RequestPayload {
  messages: {
    role: "developer" | "system" | "user" | "assistant";
    content: string | MultimodalContent[];
    reasoning_details?: Record<string, unknown>;
  }[];
  modalities?: string[];
  stream?: boolean;
  model: string;
  temperature: number;
  presence_penalty: number;
  frequency_penalty: number;
  top_p: number;
  web_search_options?: {
    search_context_size?: string;
  };
  reasoning_effort?: string;
  reasoning?: {
    effort?: string;
    max_tokens?: number;
  };
  thinking?: {
    type?: string;
  };
  media_resolution?: string;
  response_format?:
    | "url"
    | "b64_json"
    | {
        type: "json_schema";
        json_schema: {
          name: string;
          schema: Record<string, unknown>;
        };
      };
  max_tokens?: number;
  max_completion_tokens?: number;
}

export interface DalleRequestPayload {
  model: string;
  prompt: string;
  response_format: "url" | "b64_json";
  n: number;
  size: ModelSize;
  quality: DalleQuality;
  style: DalleStyle;
}

function normalizeServiceProvider(
  providerName: string | undefined,
  useCustomConfig: boolean,
) {
  if (
    providerName &&
    Object.values(ServiceProvider).includes(
      providerName as ServiceProviderValue,
    )
  ) {
    return providerName as ServiceProviderValue;
  }

  return useCustomConfig ? ServiceProvider.Custom : ServiceProvider.OpenAI;
}

function isGeminiImagePreviewModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.includes("nano-banana") ||
    (lowerModel.startsWith("gemini-") &&
      (lowerModel.includes("image-preview") ||
        lowerModel.includes("image-generation")))
  );
}

function isAiHubMixBaseUrl(baseUrl: string) {
  return (
    baseUrl.includes("aihubmix.com") || baseUrl.includes("api.inferera.com")
  );
}

function isToApisBaseUrl(baseUrl?: string) {
  if (!baseUrl) return false;

  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "toapis.com" || hostname === "www.toapis.com";
  } catch {
    return false;
  }
}

function isCustomDoubaoThinkingModel(
  providerName: ServiceProviderValue | undefined,
  model: string,
) {
  if (providerName !== ServiceProvider.Custom) {
    return false;
  }

  const lowerModel = model.toLowerCase();
  return lowerModel.startsWith("doubao");
}

function isVeoVideoModel(model: string) {
  return model.toLowerCase().includes("veo");
}

function containsCjk(text: string) {
  return /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

function getVeoPromptValidationError(model: string, prompt: string) {
  if (!isVeoVideoModel(model)) {
    return "";
  }

  const normalizedPrompt = prompt.trim();
  if (!normalizedPrompt) {
    return "Veo 视频提示词不能为空。";
  }

  if (containsCjk(normalizedPrompt)) {
    return "Veo 系列当前只接受英文提示词。当前输入包含中文，服务端通常会返回 INVALID_ARGUMENT。请改用英文提示词后重试。";
  }

  return "";
}

function normalizeAiHubMixModelId(model: string) {
  const lowerModel = model.toLowerCase();
  if (lowerModel.endsWith("/qwen-image")) return "qwen-image";
  if (lowerModel.endsWith("/qwen-image-edit")) return "qwen-image-edit";
  if (lowerModel.endsWith("/qwen-image-plus")) return "qwen-image-plus";
  if (lowerModel.endsWith("/gpt-image-2")) return "gpt-image-2";
  if (lowerModel.includes("/gpt-image-2-")) return lowerModel.split("/").pop()!;
  if (lowerModel.endsWith("/gpt-image-1.5")) return "gpt-image-1.5";
  if (lowerModel.endsWith("/gpt-image-1")) return "gpt-image-1";
  if (lowerModel.endsWith("/gpt-image-1-mini")) return "gpt-image-1-mini";
  if (lowerModel.endsWith("/gpt-image-test")) return "gpt-image-test";
  if (lowerModel.endsWith("/dall-e-3")) return "dall-e-3";
  if (lowerModel.endsWith("/dall-e-2")) return "dall-e-2";
  if (
    lowerModel === "ideogram-v4" ||
    lowerModel.endsWith("/ideogram-v4") ||
    lowerModel.includes("ideogram-v4")
  ) {
    return "ideogram-v4";
  }
  if (
    lowerModel === "ideogram-v3" ||
    lowerModel.endsWith("/ideogram-v3") ||
    lowerModel.includes("ideogram-v3")
  ) {
    return "V3";
  }
  if (lowerModel.includes("ideogram")) return "V3";
  if (lowerModel.endsWith("/glm-image")) return "glm-image";
  if (lowerModel.endsWith("/wan2.7-image-pro")) return "wan2.7-image-pro";
  if (lowerModel.endsWith("/wan2.7-image")) return "wan2.7-image";
  if (lowerModel.endsWith("/wan2.6-t2i")) return "wan2.6-t2i";
  if (lowerModel.endsWith("/wan2.6-image")) return "wan2.6-image";
  if (lowerModel.endsWith("/wan2.5-t2i-preview")) return "wan2.5-t2i-preview";
  if (lowerModel.endsWith("/wan2.2-t2i-plus")) return "wan2.2-t2i-plus";
  if (lowerModel.endsWith("/wan2.2-t2i-flash")) return "wan2.2-t2i-flash";
  if (lowerModel.endsWith("/wanx2.1-t2i-plus")) return "wanx2.1-t2i-plus";
  if (lowerModel.endsWith("/wanx2.1-t2i-turbo")) return "wanx2.1-t2i-turbo";
  if (lowerModel.endsWith("/wanx2.0-t2i-turbo")) return "wanx2.0-t2i-turbo";
  if (lowerModel.endsWith("/wanx-v1")) return "wanx-v1";
  if (lowerModel.endsWith("/flux-kontext-pro")) return "flux-kontext-pro";
  if (lowerModel.endsWith("/flux-kontext-max")) return "flux-kontext-max";
  if (lowerModel.endsWith("/irag-1.0")) return "irag-1.0";
  if (lowerModel.endsWith("/ernie-irag-edit")) return "ernie-irag-edit";
  return model;
}

export function getAiHubMixPredictionModelPath(model: string) {
  const normalizedModel = normalizeAiHubMixModelId(model);
  const lowerModel = normalizedModel.toLowerCase();

  if (
    lowerModel.startsWith("gpt-image-") ||
    lowerModel.startsWith("dall-e-") ||
    lowerModel.startsWith("dalle-")
  ) {
    return `openai/${normalizedModel}`;
  }
  if (lowerModel.startsWith("imagen-")) {
    return `google/${normalizedModel}`;
  }
  if (
    lowerModel.includes("qwen-image") ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-")
  ) {
    return `qianfan/${normalizedModel}`;
  }
  if (
    lowerModel.startsWith("doubao-seedream-") ||
    lowerModel.startsWith("seedream-")
  ) {
    return `doubao/${normalizedModel}`;
  }
  if (
    lowerModel.startsWith("flux-2-") ||
    lowerModel.startsWith("flux-kontext-") ||
    lowerModel.startsWith("flux/") ||
    lowerModel.startsWith("FLUX-1.1-pro".toLowerCase())
  ) {
    return `bfl/${normalizedModel}`;
  }
  if (normalizedModel === "V3" || lowerModel.includes("ideogram")) {
    return `ideogram/${normalizedModel}`;
  }
  if (lowerModel === "glm-image") {
    return `openai/glm-image`;
  }
  if (lowerModel.startsWith("wan2.") || lowerModel.startsWith("wanx")) {
    return `bailian/${normalizedModel}`;
  }

  return null;
}

export function isAiHubMixVideoModel(model: string) {
  return isVideoGenerationModel(model);
}

export function buildAiHubMixPredictionPayload(
  model: string,
  options: ChatOptions,
  extraParams?: Record<string, unknown>,
): Record<string, unknown> {
  const normalizedModel = normalizeAiHubMixModelId(model);
  const lowerModel = normalizedModel.toLowerCase();
  const prompt =
    getMessageTextContent(options.messages.slice(-1)?.pop() as any) ||
    String(extraParams?.prompt || "");
  const normalizedSize = normalizeModelSize(model, options.config?.size);
  const config = options.config || {};

  if (lowerModel.startsWith("imagen-")) {
    const imagenInput: Record<string, unknown> = {
      prompt,
      numberOfImages: Number(extraParams?.n || 1),
    };
    if (extraParams?.aspect_ratio) {
      imagenInput.aspectRatio = extraParams.aspect_ratio;
    }
    if (extraParams?.resolution) {
      imagenInput.imageSize = extraParams.resolution;
    }
    if (extraParams?.person_generation) {
      imagenInput.personGeneration = extraParams.person_generation;
    }
    return { input: imagenInput };
  }

  if (
    lowerModel.startsWith("qwen-image") ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-")
  ) {
    const qwenInput: Record<string, unknown> = {
      prompt,
      n: Number(extraParams?.n || 1),
      size: toDashScopeSize(extraParams?.image_size || normalizedSize),
      watermark: toBooleanParam(extraParams?.watermark),
    };
    if (extraParams?.negative_prompt) {
      qwenInput.negative_prompt = extraParams.negative_prompt;
    }
    if (
      extraParams?.prompt_extend !== undefined &&
      extraParams?.prompt_extend !== ""
    ) {
      qwenInput.prompt_extend =
        extraParams.prompt_extend === "true" ||
        extraParams.prompt_extend === true;
    }
    if (
      extraParams?.seed !== undefined &&
      extraParams?.seed !== "" &&
      Number(extraParams.seed) > 0
    ) {
      qwenInput.seed = Number(extraParams.seed);
    }
    return { input: qwenInput };
  }

  if (
    lowerModel.startsWith("doubao-seedream-") ||
    lowerModel.startsWith("seedream-")
  ) {
    const family = getDrawModelFamily(normalizedModel);
    const doubaoInput: Record<string, unknown> = {
      prompt,
      size:
        extraParams?.resolution ||
        (family === "bytedance-seedream-30" ? "1024x1024" : "2048x2048"),
      response_format: extraParams?.response_format || "url",
      watermark:
        extraParams?.watermark === undefined || extraParams.watermark === ""
          ? true
          : toBooleanParam(extraParams.watermark),
    };
    if (family === "bytedance-seedream-5-lite") {
      doubaoInput.output_format = extraParams?.output_format || "jpeg";
      if (toBooleanParam(extraParams?.web_search)) {
        doubaoInput.tools = [{ type: "web_search" }];
      }
    }
    if (
      [
        "bytedance-seedream-5-lite",
        "bytedance-seedream-45",
        "bytedance-seedream-40",
      ].includes(family)
    ) {
      doubaoInput.sequential_image_generation = "disabled";
    }
    if (extraParams?.optimize_prompt_mode) {
      doubaoInput.optimize_prompt_options = {
        mode: extraParams.optimize_prompt_mode,
      };
    }
    if (family === "bytedance-seedream-30") {
      if (
        extraParams?.seed !== undefined &&
        extraParams.seed !== "" &&
        Number(extraParams.seed) >= -1
      ) {
        doubaoInput.seed = Number(extraParams.seed);
      }
      if (
        extraParams?.guidance_scale !== undefined &&
        extraParams.guidance_scale !== ""
      ) {
        doubaoInput.guidance_scale = Number(extraParams.guidance_scale);
      }
    }
    return { input: doubaoInput };
  }

  if (lowerModel.startsWith("wan2.") || lowerModel.startsWith("wanx")) {
    const family = getDrawModelFamily(normalizedModel);
    const isWan27 =
      family === "alibaba-wan-27-pro" || family === "alibaba-wan-27";
    const isWan26Fixed =
      family === "alibaba-wan-26-t2i" || family === "alibaba-wan-26-image";
    const wanInput: Record<string, unknown> = {
      prompt,
      size: isWan27
        ? extraParams?.resolution || "2K"
        : toDashScopeSize(extraParams?.image_size || "1024x1024"),
    };
    if (isWan27) {
      wanInput.n = Number(extraParams?.n || 1);
      wanInput.thinking_mode =
        extraParams?.thinking_mode === undefined ||
        extraParams.thinking_mode === ""
          ? true
          : toBooleanParam(extraParams.thinking_mode);
    } else if (isWan26Fixed) {
      wanInput.n = 1;
      if (
        family === "alibaba-wan-26-t2i" &&
        extraParams?.prompt_extend !== undefined &&
        extraParams.prompt_extend !== ""
      ) {
        wanInput.prompt_extend = toBooleanParam(extraParams.prompt_extend);
      }
      if (family === "alibaba-wan-26-image") {
        wanInput.enable_interleave = true;
      }
    } else if (family === "alibaba-wanx-v1") {
      wanInput.n = Number(extraParams?.n || 1);
      if (extraParams?.style) {
        wanInput.style = extraParams.style;
      }
    } else if (family === "alibaba-wan") {
      // Unknown Wan model: keep a minimal official-compatible subset.
    } else {
      wanInput.n = Number(extraParams?.n || 1);
      if (
        extraParams?.prompt_extend !== undefined &&
        extraParams.prompt_extend !== ""
      ) {
        wanInput.prompt_extend = toBooleanParam(extraParams.prompt_extend);
      }
    }
    if (extraParams?.negative_prompt && !isWan27) {
      wanInput.negative_prompt = extraParams.negative_prompt;
    }
    if (
      extraParams?.seed !== undefined &&
      extraParams.seed !== "" &&
      Number(extraParams.seed) >= 0
    ) {
      wanInput.seed = Number(extraParams.seed);
    }
    if (
      family !== "alibaba-wanx-v1" &&
      extraParams?.watermark !== undefined &&
      extraParams.watermark !== ""
    ) {
      wanInput.watermark = toBooleanParam(extraParams.watermark);
    }
    return { input: wanInput };
  }

  if (lowerModel.startsWith("flux-2-")) {
    const size = parseDrawImageSize(extraParams?.image_size) || {
      width: 1024,
      height: 1024,
    };
    const fluxInput: Record<string, unknown> = {
      prompt,
      width: size.width,
      height: size.height,
      safety_tolerance: Number(extraParams?.safety_tolerance || 2),
    };
    if (extraParams?.output_format) {
      fluxInput.output_format = extraParams.output_format;
    }
    if (
      extraParams?.seed !== undefined &&
      extraParams?.seed !== "" &&
      Number(extraParams.seed) > 0
    ) {
      fluxInput.seed = Number(extraParams.seed);
    }
    return { input: fluxInput };
  }

  if (lowerModel.startsWith("flux-kontext-")) {
    const fluxInput: Record<string, unknown> = {
      prompt,
      aspect_ratio: extraParams?.aspect_ratio || "16:9",
    };
    if (extraParams?.output_format) {
      fluxInput.output_format = extraParams.output_format;
    }
    if (
      extraParams?.prompt_upsampling !== undefined &&
      extraParams?.prompt_upsampling !== ""
    ) {
      fluxInput.prompt_upsampling = toBooleanParam(
        extraParams.prompt_upsampling,
      );
    }
    if (extraParams?.image && typeof extraParams.image === "string") {
      fluxInput.input_image = extraParams.image;
    }
    return { input: fluxInput };
  }

  if (
    lowerModel.includes("FLUX-1.1-pro".toLowerCase()) ||
    lowerModel.includes("flux-1.1")
  ) {
    const fluxProInput: Record<string, unknown> = {
      prompt,
      aspect_ratio: extraParams?.aspect_ratio || "1:1",
      output_format: extraParams?.output_format || "jpeg",
    };
    if (
      extraParams?.prompt_upsampling === "true" ||
      extraParams?.prompt_upsampling === true
    ) {
      fluxProInput.prompt_upsampling = true;
    }
    if (
      extraParams?.safety_tolerance !== undefined &&
      extraParams?.safety_tolerance !== ""
    ) {
      fluxProInput.safety_tolerance = Number(extraParams.safety_tolerance);
    }
    if (
      extraParams?.seed !== undefined &&
      extraParams?.seed !== "" &&
      Number(extraParams.seed) > 0
    ) {
      fluxProInput.seed = Number(extraParams.seed);
    }
    return { input: fluxProInput };
  }

  if (normalizedModel === "ideogram-v4") {
    const ideogramV4Input: Record<string, unknown> = {
      text_prompt: prompt,
      resolution: extraParams?.resolution || "2048x2048",
      rendering_speed: String(extraParams?.rendering_speed || "DEFAULT"),
    };
    return { input: ideogramV4Input };
  }

  if (model === "V3" || normalizedModel === "V3") {
    const v3AspectRatio =
      String(extraParams?.aspect_ratio || "").replace(":", "x") || "1x1";
    const ideogramInput: Record<string, unknown> = {
      prompt,
      aspect_ratio: v3AspectRatio,
      rendering_speed: String(extraParams?.rendering_speed || "DEFAULT"),
    };
    if (extraParams?.negative_prompt) {
      ideogramInput.negative_prompt = extraParams.negative_prompt;
    }
    if (extraParams?.style_preset) {
      ideogramInput.style_preset = extraParams.style_preset;
    }
    if (extraParams?.n) {
      ideogramInput.num_images = Number(extraParams.n);
    }
    if (
      extraParams?.seed !== undefined &&
      extraParams?.seed !== "" &&
      Number(extraParams.seed) > 0
    ) {
      ideogramInput.seed = Number(extraParams.seed);
    }
    return { input: ideogramInput };
  }

  if (lowerModel === "glm-image" || lowerModel.startsWith("cogview-")) {
    const glmInput: Record<string, unknown> = {
      prompt,
      size:
        extraParams?.image_size ||
        normalizedSize ||
        (lowerModel === "glm-image" ? "1280x1280" : "1024x1024"),
    };
    if (extraParams?.quality) {
      glmInput.quality = extraParams.quality;
    }
    if (extraParams?.watermark !== undefined && extraParams.watermark !== "") {
      glmInput.watermark_enabled = toBooleanParam(extraParams.watermark);
    }
    return { input: glmInput };
  }

  const input: Record<string, unknown> = {
    prompt,
    n: Number(extraParams?.n || 1),
    size: extraParams?.image_size || normalizedSize,
    ...(lowerModel === "dall-e-2"
      ? {}
      : { quality: normalizeImageQuality(model, config.quality) }),
    ...(lowerModel === "dall-e-3" ? { style: config.style ?? "vivid" } : {}),
  };

  if (extraParams?.output_format) {
    input.output_format = extraParams.output_format;
  }
  if (extraParams?.background) {
    input.background = extraParams.background;
  }
  if (
    ["jpeg", "webp"].includes(String(extraParams?.output_format || "")) &&
    extraParams?.output_compression !== undefined &&
    extraParams.output_compression !== ""
  ) {
    input.output_compression = Number(extraParams.output_compression);
  }
  if (extraParams?.moderation) {
    input.moderation = extraParams.moderation;
  }
  const hasImageInput = Boolean(
    extraParams?.image || extraParams?.input_image || extraParams?.images,
  );
  if (hasImageInput && extraParams?.input_fidelity) {
    input.input_fidelity = extraParams.input_fidelity;
  }

  return { input };
}

export function buildAiHubMixVideoPayload(
  model: string,
  options: ChatOptions,
): Record<string, unknown> {
  const prompt = getMessageTextContent(
    options.messages.slice(-1)?.pop() as any,
  );
  const latestMessage = options.messages.slice(-1)?.pop() as any;
  const imageUrls = latestMessage ? getMessageImages(latestMessage) : [];

  const veoPromptValidationError = getVeoPromptValidationError(model, prompt);
  if (veoPromptValidationError) {
    throw new Error(veoPromptValidationError);
  }

  // veo2-fast 特殊处理
  const isVeofast = isVeoVideoModel(model);

  if (isVeofast) {
    // asyncdata veo 任务需要显式携带增强与图片数组字段
    const payload: Record<string, unknown> = {
      model,
      prompt,
      images: imageUrls,
      enhance_prompt: true,
      enable_upsample: false,
    };

    return payload;
  }

  return {
    model,
    prompt,
    size: options.config?.size || "720x1280",
    seconds: parseInt(options.config?.seconds || "4"),
    ...(imageUrls[0] ? { image_url: imageUrls[0] } : {}),
  };
}

async function buildAiHubMixVideoRequestBody(
  model: string,
  options: ChatOptions,
): Promise<FormData | Record<string, unknown>> {
  const payload = buildAiHubMixVideoPayload(model, options);
  if (isVeoVideoModel(model)) {
    return payload;
  }
  const imageUrl = String((payload as any).image_url || "");

  if (!imageUrl) {
    return payload;
  }

  const formData = new FormData();
  formData.append("model", String((payload as any).model || model));
  formData.append("prompt", String((payload as any).prompt || ""));

  const imageBlob = await fetch(imageUrl).then((res) => res.blob());
  const extension = imageBlob.type.split("/")[1] || "png";
  formData.append(
    "input_reference",
    imageBlob,
    `reference.${extension.replace(/[^a-z0-9]/gi, "") || "png"}`,
  );

  return formData;
}

function isVideoUrl(url: string) {
  return (
    /^blob:/i.test(url) || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(url)
  );
}

function toVideoMarkdown(url: string) {
  return `[Generated Video](${url})`;
}

function toMediaItems(value: any) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function getStringField(value: any, keys: string[]): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  for (const key of keys) {
    const fieldValue = value?.[key];
    if (typeof fieldValue === "string" && fieldValue.length > 0) {
      return fieldValue;
    }
    if (
      fieldValue &&
      typeof fieldValue === "object" &&
      typeof fieldValue.url === "string" &&
      fieldValue.url.length > 0
    ) {
      return fieldValue.url;
    }
    if (
      fieldValue &&
      typeof fieldValue === "object" &&
      typeof fieldValue.bytesBase64 === "string" &&
      fieldValue.bytesBase64.length > 0
    ) {
      return fieldValue.bytesBase64;
    }
    if (Array.isArray(fieldValue)) {
      if (typeof fieldValue[0] === "string") {
        return fieldValue[0];
      }
      const nestedValue = getStringField(fieldValue[0], [
        "url",
        "image_url",
        "imageUrl",
        "image",
        "b64_json",
        "b64",
        "base64",
        "bytesBase64",
      ]);
      if (nestedValue) {
        return nestedValue;
      }
    }
  }
  return "";
}

async function buildImageContentsFromMediaItems(items: any[]) {
  const contents: MultimodalContent[] = [];

  for (const item of items) {
    const imageUrl = getStringField(item, [
      "url",
      "image_url",
      "imageUrl",
      "image",
    ]);
    const b64Json = getStringField(item, [
      "b64_json",
      "b64",
      "base64",
      "bytesBase64",
    ]);

    if (imageUrl && !isVideoUrl(imageUrl)) {
      contents.push({
        type: "image_url",
        image_url: { url: imageUrl },
      });
      continue;
    }

    if (b64Json) {
      const url = b64Json.startsWith("data:image/")
        ? b64Json
        : await uploadImage(base64Image2Blob(b64Json, "image/png"));
      contents.push({
        type: "image_url",
        image_url: { url },
      });
    }
  }

  return contents;
}

const runtimeBlobUrls = new Set<string>();

export function rememberRuntimeBlobUrl(url: string) {
  if (/^blob:/i.test(url)) {
    runtimeBlobUrls.add(url);
  }
}

export function isRememberedRuntimeBlobUrl(url: string) {
  return /^blob:/i.test(url) && runtimeBlobUrls.has(url);
}

const AIHUBMIX_VIDEO_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const AIHUBMIX_VIDEO_POLL_INTERVAL_MS = 3000;

function getTaskStatus(payload: any) {
  return String(
    payload?.status ||
      payload?.data?.[0]?.status ||
      payload?.output?.[0]?.status ||
      "",
  ).toLowerCase();
}

function isPendingTaskStatus(status: string) {
  return ["queued", "pending", "processing", "in_progress", "running"].includes(
    status,
  );
}

function getVideoTaskId(payload: any) {
  return String(payload?.id || payload?.data?.[0]?.id || "").trim();
}

function getTaskProgress(payload: any) {
  const progress = payload?.progress ?? payload?.data?.[0]?.progress;
  return typeof progress === "number" ? progress : 0;
}

function formatVideoTaskStatus(payload: any) {
  const status = getTaskStatus(payload) || "queued";
  const taskId = getVideoTaskId(payload);
  const progress = getTaskProgress(payload);
  return `视频生成中：${status}${progress > 0 ? `，进度 ${progress}%` : ""}${
    taskId ? `\n任务 ID：${taskId}` : ""
  }`;
}

async function pollAiHubMixTask(
  pollingUrl: string,
  requestHeaders: Record<string, string>,
  controller: AbortController,
  onProgress?: (payload: any) => void,
) {
  const startedAt = Date.now();
  let targetUrl = pollingUrl;
  let lastPayload: any = null;

  while (Date.now() - startedAt < AIHUBMIX_VIDEO_POLL_TIMEOUT_MS) {
    const pollRes = await fetch(targetUrl, {
      method: "GET",
      signal: controller.signal,
      headers: stripInternalChatHeaders(requestHeaders),
    });
    const pollText = await pollRes.text();
    const pollJson = parseJsonOrSSEPayload(pollText);
    lastPayload = pollJson;
    onProgress?.(pollJson);
    const status = getTaskStatus(pollJson);

    if (["succeeded", "completed", "success"].includes(status)) {
      return pollJson;
    }

    if (["failed", "error", "canceled", "cancelled"].includes(status)) {
      return pollJson;
    }

    const nextPollingUrl =
      pollJson?.polling_url ||
      pollJson?.data?.[0]?.polling_url ||
      pollJson?.output?.[0]?.polling_url;
    if (typeof nextPollingUrl === "string" && nextPollingUrl.length > 0) {
      targetUrl = nextPollingUrl;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, AIHUBMIX_VIDEO_POLL_INTERVAL_MS),
    );
  }

  return (
    lastPayload || {
      output: [{ polling_url: targetUrl }],
    }
  );
}

async function attachCompletedVideoContent(
  payload: any,
  contentUrl: string,
  requestHeaders: Record<string, string>,
  controller: AbortController,
) {
  if (typeof window === "undefined" || !contentUrl) {
    return payload;
  }

  try {
    const res = await fetch(contentUrl, {
      method: "GET",
      signal: controller.signal,
      headers: stripInternalChatHeaders(requestHeaders),
    });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.startsWith("video/")) {
      const responseText = await res.text();
      if (responseText.trim().length > 0) {
        let errorPayload: unknown = responseText;
        try {
          errorPayload = JSON.parse(responseText);
        } catch {
          // keep plain text
        }
        return {
          ...payload,
          output: {
            ...(payload?.output || {}),
            content_error: {
              message: `视频内容接口返回非视频响应：HTTP ${res.status}`,
              response: errorPayload,
            },
          },
        };
      }
    }
    if (contentType.includes("application/json")) {
      const errorPayload = await res.json();
      return {
        ...payload,
        output: {
          ...(payload?.output || {}),
          content_error: {
            message: `视频内容接口返回 JSON 响应：HTTP ${res.status}`,
            response: errorPayload,
          },
        },
      };
    }
    if (!res.ok) {
      const errorText = await res.text();
      let errorPayload: unknown = errorText;
      try {
        errorPayload = JSON.parse(errorText);
      } catch {
        // keep plain text
      }
      return {
        ...payload,
        output: {
          ...(payload?.output || {}),
          content_error: {
            message: `视频内容拉取失败：HTTP ${res.status}`,
            response: errorPayload,
          },
        },
      };
    }

    const blob = await res.blob();
    if (!blob || blob.size === 0) {
      return {
        ...payload,
        output: {
          ...(payload?.output || {}),
          content_error: {
            message: "视频内容接口返回空响应",
            response: null,
          },
        },
      };
    }
    const objectUrl = URL.createObjectURL(blob);
    rememberRuntimeBlobUrl(objectUrl);
    return {
      ...payload,
      output: {
        ...(payload?.output || {}),
        video_url: objectUrl,
      },
    };
  } catch (error) {
    console.warn(
      "[Video Content] Failed to fetch completed video content:",
      error,
    );
    return payload;
  }
}

export const __testables = {
  attachCompletedVideoContent,
};

function parseJsonOrSSEPayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch {}

  // 处理 SSE 流式响应：组合所有 delta content
  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .filter((line) => line && line !== "[DONE]");

  if (lines.length === 0) {
    throw new Error(`Unexpected payload: ${trimmed.slice(0, 120)}`);
  }

  // 尝试组合流式响应
  try {
    const combined = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (combined.length > 0) {
      // 获取最后一个有效的响应对象
      const last = combined[combined.length - 1];

      // 组合所有 delta.content
      const allContent = combined
        .map((item: any) => item?.choices?.[0]?.delta?.content || "")
        .filter(Boolean)
        .join("");

      if (allContent) {
        // 创建一个包含组合内容的响应对象
        return {
          ...last,
          choices: [
            {
              ...last?.choices?.[0],
              message: {
                ...(last?.choices?.[0]?.message || {}),
                content: allContent,
                role:
                  last?.choices?.[0]?.delta?.role ||
                  last?.choices?.[0]?.message?.role ||
                  "assistant",
              },
            },
          ],
        };
      }

      return last;
    }
  } catch {}

  // 降级到只取最后一个
  const ssePayload = lines.pop();
  if (!ssePayload) {
    throw new Error(`Unexpected payload: ${trimmed.slice(0, 120)}`);
  }

  return JSON.parse(ssePayload);
}

function formatAiHubMixVideoFailure(payload: any) {
  const status = getTaskStatus(payload);
  const taskId = getVideoTaskId(payload);
  if (!["failed", "error", "canceled", "cancelled"].includes(status)) {
    return "";
  }

  const errorPayload =
    payload?.error ||
    payload?.last_error ||
    payload?.output?.error ||
    payload?.data?.[0]?.error ||
    payload?.output?.[0]?.error;
  const errorMessage = String(
    errorPayload?.message || payload?.message || "视频任务执行失败",
  ).trim();
  const errorCode = String(
    errorPayload?.status || errorPayload?.code || payload?.code || "",
  ).trim();
  const requestUrl = String(
    errorPayload?.url || payload?.url || payload?.request_url || "",
  ).trim();
  const model = String(
    payload?.model || payload?.data?.[0]?.model || "",
  ).trim();
  const isInvalidArgument = errorMessage
    .toLowerCase()
    .includes("invalid argument");
  const veoPromptHint =
    isInvalidArgument && isVeoVideoModel(model)
      ? containsCjk(String(payload?.prompt || payload?.data?.[0]?.prompt || ""))
        ? "\n建议：Veo 系列当前通常只接受英文提示词，请改用英文后重试。"
        : "\n建议：当前提示词已不包含中文。如果在 YutoAPI 官方后台测试同样失败，可视为渠道侧或上游模型适配异常，不是当前前端独有问题。"
      : "";

  return `视频任务失败${taskId ? `\n任务 ID：${taskId}` : ""}\n错误：${
    errorCode ? `[${errorCode}] ` : ""
  }${errorMessage}${requestUrl ? `\n接口：${requestUrl}` : ""}${veoPromptHint}`;
}

function getGroupedApiKeyRetryableErrorMessage(payload: any) {
  // 复用公共函数，保持向后兼容
  return getRetryableErrorReason(payload);
}

function parseStructuredOutputSchema(schemaText: string) {
  try {
    return JSON.parse(schemaText);
  } catch {
    throw new Error("JSON Schema 格式不正确，请检查结构化输出配置");
  }
}

function normalizeSearchContextSize(size: string | undefined) {
  const normalized = size?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["low", "medium", "high"].includes(normalized)) {
    return normalized;
  }
  return undefined;
}

function buildImageGenerationPromptFromMessages(
  messages: ChatOptions["messages"],
) {
  const usefulMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => {
      const text = getMessageTextContent(message).trim();
      const imageCount = getMessageImages(message).length;
      return { role: message.role, text, imageCount };
    })
    .filter((message) => message.text || message.imageCount > 0);

  const latest = usefulMessages.at(-1);
  if (!latest) return "";

  const contextMessages = usefulMessages.slice(-8, -1);
  if (contextMessages.length === 0) {
    return latest.text;
  }

  const roleLabel = (role?: string) =>
    role === "assistant" ? "助手" : role === "user" ? "用户" : "上下文";
  const contextText = contextMessages
    .map((message) => {
      const imageHint =
        message.imageCount > 0 ? `（包含 ${message.imageCount} 张图片）` : "";
      return `${roleLabel(message.role)}${imageHint}: ${
        message.text || "[图片]"
      }`;
    })
    .join("\n");
  const latestImageHint =
    latest.imageCount > 0 ? `（包含 ${latest.imageCount} 张参考图片）` : "";

  return [
    "请根据以下对话上下文完成用户最新请求，保持上下文一致。",
    "",
    "对话上下文:",
    contextText,
    "",
    `用户最新请求${latestImageHint}: ${latest.text || "[图片]"}`,
  ]
    .join("\n")
    .slice(-6000);
}

async function buildImageEditRequestBody(
  model: string,
  options: ChatOptions,
): Promise<FormData> {
  const latestMessage = options.messages.slice(-1)?.pop() as any;
  const prompt =
    getMessageTextContent(latestMessage).trim() ||
    buildImageGenerationPromptFromMessages(options.messages);
  const imageUrls = getMessageImages(latestMessage);
  const formData = new FormData();

  formData.append("model", model);
  formData.append("prompt", prompt);
  formData.append("n", "1");
  formData.append("size", normalizeModelSize(model, options.config?.size));

  const quality = normalizeImageQuality(model, options.config?.quality);
  if (quality) {
    formData.append("quality", quality);
  }

  for (let index = 0; index < imageUrls.length; index += 1) {
    const imageBlob = await fetch(imageUrls[index]).then((res) => res.blob());
    const extension = imageBlob.type.split("/")[1] || "png";
    formData.append(
      imageUrls.length > 1 ? "image[]" : "image",
      imageBlob,
      `input-${index + 1}.${extension}`,
    );
  }

  return formData;
}

function isInlineImageUrl(url: string) {
  return url.startsWith("data:") || url.startsWith("blob:");
}

function isBase64ImageUrl(url: string) {
  return /^data:image\/[^;]+;base64,/i.test(url);
}

async function inlineImageUrlToBlob(url: string) {
  if (isBase64ImageUrl(url) || url.startsWith("blob:")) {
    return fetch(url).then((res) => res.blob());
  }
  return null;
}

async function ensureUrlOnlyProviderImageUrls(imageUrls: string[]) {
  const normalizedUrls: string[] = [];

  for (const imageUrl of imageUrls) {
    if (!imageUrl) continue;

    if (!isInlineImageUrl(imageUrl)) {
      normalizedUrls.push(imageUrl);
      continue;
    }

    const imageBlob = await inlineImageUrlToBlob(imageUrl);
    const uploadedUrl = imageBlob ? await uploadImage(imageBlob) : imageUrl;
    if (isInlineImageUrl(uploadedUrl)) {
      throw new Error(
        "ToAPI 的图片参考接口不接受 base64 图片；当前图片没有可发送给上游的 URL，请改用 Ocoolai/Yuto/AihubMix，或先把图片上传到可访问的图片地址后再试。",
      );
    }
    normalizedUrls.push(uploadedUrl);
  }

  return normalizedUrls;
}

async function buildToApisImageGenerationPayload(
  model: string,
  options: ChatOptions,
): Promise<Record<string, unknown>> {
  const latestMessage = options.messages.slice(-1)?.pop() as any;
  const prompt =
    getMessageTextContent(latestMessage).trim() ||
    buildImageGenerationPromptFromMessages(options.messages);
  const imageUrls = await ensureUrlOnlyProviderImageUrls(
    getMessageImages(latestMessage),
  );

  return {
    model,
    prompt,
    image_urls: imageUrls,
    n: 1,
    size: normalizeModelSize(model, options.config?.size),
    quality: normalizeImageQuality(model, options.config?.quality),
  };
}

function buildProxyPathForBaseUrl(baseUrl: string, path: string) {
  let proxyBaseUrl = baseUrl.trim();
  if (proxyBaseUrl.endsWith("/")) {
    proxyBaseUrl = proxyBaseUrl.slice(0, -1);
  }
  const proxyPath = joinUrlPath(
    "",
    joinUrlPath(proxyBaseUrl, path).replace(proxyBaseUrl, ""),
  );
  return {
    chatPath: `/api/proxy/${proxyPath}`,
    proxyBaseUrl,
  };
}

export class ChatGPTApi implements LLMApi {
  private disableListModels = true;

  path(path: string, modelConfig?: Partial<ChatOptions["config"]>): string {
    const accessStore = useAccessStore.getState() as any;
    const configStore = useChatStore.getState();
    const currentProvider = normalizeServiceProvider(
      modelConfig?.providerName ||
        configStore.currentSession().mask.modelConfig.providerName,
      accessStore.useCustomConfig,
    );
    const configuredCustomProfile =
      currentProvider === ServiceProvider.Custom
        ? getCustomProfileForModelConfig(accessStore, modelConfig)
        : undefined;

    let baseUrl = "";

    const isAzure = path.includes("deployments");
    if (accessStore.useCustomConfig) {
      if (isAzure && !accessStore.isValidAzure()) {
        throw Error(
          "incomplete azure config, please check it in your settings page",
        );
      }

      // Docker / Web 部署下如果本地没有配置 OpenAI Key，就优先回退到服务端路由，
      // 避免浏览器残留的旧 endpoint 持续导致超时。
      if (
        !isAzure &&
        currentProvider === ServiceProvider.OpenAI &&
        !accessStore.openaiApiKey.trim()
      ) {
        return ApiPath.OpenAI + "/" + path;
      }

      if (currentProvider === ServiceProvider.Custom) {
        const profileCompatible =
          configuredCustomProfile?.openAICompatible ??
          accessStore.customOpenAICompatible;
        if (!profileCompatible) {
          throw Error(
            "current custom profile is not OpenAI-compatible, please enable it in API config or choose a matching provider",
          );
        }
        baseUrl = configuredCustomProfile?.baseUrl || accessStore.customUrl;
      } else {
        baseUrl = isAzure ? accessStore.azureUrl : accessStore.openaiUrl;
      }
    }

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      const apiPath = isAzure ? ApiPath.Azure : ApiPath.OpenAI;
      baseUrl = isApp ? OPENAI_BASE_URL : apiPath;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (
      !baseUrl.startsWith("http") &&
      !isAzure &&
      !baseUrl.startsWith(ApiPath.OpenAI)
    ) {
      baseUrl = "https://" + baseUrl;
    }

    // 自动补全 /v1 路径（用于 OpenAI 兼容 API）
    let hasV1Path = baseUrl.endsWith("/v1") || baseUrl.includes("/v1/");
    if (!isAzure && !hasV1Path && baseUrl !== ApiPath.OpenAI) {
      baseUrl = baseUrl + "/v1";
      hasV1Path = true;
    }

    // 如果 baseUrl 已经包含 /v1，从 path 中去掉 v1/ 前缀
    let finalPath = path;
    if (hasV1Path && path.startsWith("v1/")) {
      finalPath = path.substring(3); // 去掉 "v1/"
    }

    // try rebuild url, when using cloudflare ai gateway in client
    return cloudflareAIGatewayUrl(joinUrlPath(baseUrl, finalPath));
  }

  async extractMessage(res: any) {
    const videoFailureMessage = formatAiHubMixVideoFailure(res);
    if (videoFailureMessage) {
      return videoFailureMessage;
    }

    // 服务端 /api/proxy 在上游对所有候选 baseURL 都返回 HTML 时，
    // 会返回 502 + proxy_baseurl_adaptation_failed，这里优先展示中文友好提示
    if (
      typeof res?.error === "string" &&
      res.error === "proxy_baseurl_adaptation_failed" &&
      typeof res?.message === "string"
    ) {
      const tried = Array.isArray(res.tried)
        ? res.tried
            .map(
              (item: any) =>
                `  - \`${item?.baseUrl || ""}/${item?.subpath || ""}\`（${
                  item?.reason || ""
                }）`,
            )
            .join("\n")
        : "";
      return [
        "⚠️ API 地址无法自动适配",
        "",
        res.message,
        "",
        tried ? `服务端已尝试的候选地址：\n${tried}` : "",
        "",
        "请打开「API 配置」页面，把「基础地址」改成上面任意一个可用的地址（通常是带 `/api/v1` 的那个），保存后重新发送对话。",
      ]
        .filter(Boolean)
        .join("\n");
    }

    if (res.error) {
      return "```\n" + JSON.stringify(res, null, 4) + "\n```";
    }
    // dalle3 model return url, using url create image message
    if (res.data) {
      const mediaItems = toMediaItems(res.data);
      const firstItem = mediaItems[0];
      let url = getStringField(firstItem, ["url", "image_url", "imageUrl"]);
      const videoUrl =
        getStringField(firstItem, ["video_url", "videoUrl"]) ||
        (isVideoUrl(url ?? "") ? url : "");
      if (videoUrl) {
        return toVideoMarkdown(videoUrl);
      }
      const imageContents = await buildImageContentsFromMediaItems(mediaItems);
      if (imageContents.length > 0) {
        return imageContents;
      }
    }
    if (Array.isArray(res.output) && res.output.length > 0) {
      const first = res.output[0];
      const url =
        first?.url ||
        first?.image_url ||
        first?.imageUrl ||
        (typeof first === "string" && first.startsWith("http") ? first : "");
      const videoUrl =
        first?.video_url ||
        first?.videoUrl ||
        (typeof first === "string" && isVideoUrl(first) ? first : "") ||
        (typeof url === "string" && isVideoUrl(url) ? url : "");
      const b64_json = first?.b64_json || first?.b64 || "";
      if (videoUrl) {
        return toVideoMarkdown(videoUrl);
      }
      if (url) {
        return [
          {
            type: "image_url",
            image_url: {
              url,
            },
          },
        ];
      }
      if (b64_json) {
        return [
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${b64_json}`,
            },
          },
        ];
      }
      if (first?.polling_url) {
        return `图像生成任务已创建：${first.polling_url}`;
      }
      const imageContents = await buildImageContentsFromMediaItems(res.output);
      if (imageContents.length > 0) {
        return imageContents;
      }
    }
    if (res.output && typeof res.output === "object") {
      const outputVideoUrl =
        res.output?.video_url || res.output?.videoUrl || "";
      const outputUrl =
        res.output?.url ||
        res.output?.image_url ||
        res.output?.imageUrl ||
        res.output?.urls?.[0] ||
        "";
      const outputError = res.output?.content_error;
      const outputB64 = getStringField(res.output, [
        "b64_json",
        "b64",
        "base64",
        "bytesBase64",
      ]);
      if (typeof outputVideoUrl === "string" && outputVideoUrl.length > 0) {
        return toVideoMarkdown(outputVideoUrl);
      }
      if (typeof outputUrl === "string" && outputUrl.length > 0) {
        if (isVideoUrl(outputUrl)) {
          return toVideoMarkdown(outputUrl);
        }
        return [
          {
            type: "image_url",
            image_url: {
              url: outputUrl,
            },
          },
        ];
      }
      if (typeof outputB64 === "string" && outputB64.length > 0) {
        return [
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${outputB64}`,
            },
          },
        ];
      }
      if (outputError) {
        const errorPayload =
          typeof outputError === "object"
            ? outputError
            : { message: String(outputError) };
        return `视频内容拉取失败${
          res.id ? `\n任务 ID：${res.id}` : ""
        }\n\`\`\`json\n${JSON.stringify(errorPayload, null, 2)}\n\`\`\``;
      }
    }
    if (res.object === "video" && res.id) {
      const status = getTaskStatus(res);
      const progress = getTaskProgress(res);
      if (status) {
        return `视频任务状态：${status} (${res.id})${
          progress > 0 ? `，进度 ${progress}%` : ""
        }`;
      }
    }
    const multiModContent = res.choices?.at(0)?.message?.multi_mod_content;
    if (Array.isArray(multiModContent) && multiModContent.length > 0) {
      const contents = multiModContent
        .map((item: any) => {
          const mimeType =
            item?.inlineData?.mimeType || item?.inline_data?.mime_type;
          const data = item?.inlineData?.data || item?.inline_data?.data;
          if (mimeType?.startsWith("image/") && data) {
            return {
              type: "image_url",
              image_url: {
                url: `data:${mimeType};base64,${data}`,
              },
            };
          }
          if (item?.text) {
            return item.text;
          }
          return null;
        })
        .filter(Boolean);
      if (contents.length > 0) {
        return contents;
      }
    }
    const content = res.choices?.at(0)?.message?.content;
    if (content) {
      return content;
    }
    if (res && typeof res === "object") {
      return "```\n" + JSON.stringify(res, null, 4) + "\n```";
    }
    return res;
  }

  async speech(options: SpeechOptions): Promise<ArrayBuffer> {
    const requestPayload = {
      model: options.model,
      input: options.input,
      voice: options.voice,
      response_format: options.response_format,
      speed: options.speed,
    };

    console.log("[Request] openai speech payload: ", requestPayload);

    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const speechPath = this.path(OpenaiPath.SpeechPath);
      const speechPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: getHeaders(),
      };

      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );

      const res = await fetch(speechPath, speechPayload);
      clearTimeout(requestTimeoutId);
      return await res.arrayBuffer();
    } catch (e) {
      console.log("[Request] failed to make a speech request", e);
      throw e;
    }
  }

  async chat(options: ChatOptions) {
    const requestedModel = normalizeReservedDisplayModelName(
      options.config.model,
    );
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...options.config,
      ...(options.config.outputTokenLimit
        ? { max_tokens: options.config.outputTokenLimit }
        : {}),
      ...{
        model: requestedModel,
        providerName: normalizeServiceProvider(
          options.config.providerName,
          useAccessStore.getState().useCustomConfig,
        ),
      },
    };

    let requestPayload:
      | RequestPayload
      | DalleRequestPayload
      | Record<string, unknown>
      | FormData;

    const isDalle3 = _isDalle3(requestedModel);
    const isImageModel = isImageGenerationModel(requestedModel);
    const isVideoModel = isVideoGenerationModel(requestedModel);
    const isGeminiImagePreview = isGeminiImagePreviewModel(requestedModel);
    const hasImageMessages = options.messages.some(
      (message) => getMessageImages(message).length > 0,
    );
    const shouldUseImageEndpoint = isImageModel && !isGeminiImagePreview;
    const shouldUseImageEditEndpoint =
      shouldUseImageEndpoint && hasImageMessages;
    const shouldUseImageGenerationEndpoint =
      shouldUseImageEndpoint && !hasImageMessages;
    const currentAccessState = useAccessStore.getState();
    const currentCustomProfileForRequest =
      modelConfig.providerName === ServiceProvider.Custom
        ? getCustomProfileForModelConfig(currentAccessState, modelConfig)
        : undefined;
    const currentBaseUrlForRequest =
      modelConfig.providerName === ServiceProvider.Custom
        ? currentCustomProfileForRequest?.baseUrl ||
          currentAccessState.customUrl
        : modelConfig.providerName === ServiceProvider.Azure
        ? currentAccessState.azureUrl
        : currentAccessState.openaiUrl;
    const shouldUseToApisImageReferenceEndpoint =
      shouldUseImageEditEndpoint && isToApisBaseUrl(currentBaseUrlForRequest);
    const requestCompatibilityKey = buildRequestCompatibilityKey({
      providerName: modelConfig.providerName,
      model: modelConfig.model,
      baseUrl: currentBaseUrlForRequest,
    });
    let requestCompatibilityState = getRequestCompatibilityState(
      requestCompatibilityKey,
    );
    const aiHubMixPredictionPath =
      shouldUseImageGenerationEndpoint &&
      isAiHubMixBaseUrl(currentBaseUrlForRequest)
        ? getAiHubMixPredictionModelPath(requestedModel)
        : null;
    const aiHubMixVideoPath =
      isVideoModel && isAiHubMixBaseUrl(currentBaseUrlForRequest)
        ? "v1/videos"
        : null;
    const isReasoningOpenAIModel =
      requestedModel.startsWith("o1") ||
      requestedModel.startsWith("o3") ||
      requestedModel.startsWith("o4") ||
      requestedModel.startsWith("o5");
    const isGpt5 = requestedModel.startsWith("gpt-5");
    const parameterSupport = getModelParameterSupport(modelConfig.model);
    if (shouldUseToApisImageReferenceEndpoint) {
      try {
        requestPayload = await buildToApisImageGenerationPayload(
          requestedModel,
          {
            ...options,
            config: {
              ...options.config,
              model: requestedModel,
            },
          },
        );
      } catch (e) {
        console.error("[Chat Payload Error]", {
          provider: modelConfig.providerName,
          model: modelConfig.model,
          baseUrl: currentBaseUrlForRequest,
          error: e,
        });
        options.onError?.(e as Error);
        return;
      }
    } else if (shouldUseImageEditEndpoint) {
      requestPayload = await buildImageEditRequestBody(requestedModel, {
        ...options,
        config: {
          ...options.config,
          model: requestedModel,
        },
      });
    } else if (aiHubMixPredictionPath) {
      requestPayload = buildAiHubMixPredictionPayload(requestedModel, {
        ...options,
        config: {
          ...options.config,
          model: requestedModel,
        },
      });
    } else if (aiHubMixVideoPath) {
      requestPayload = await buildAiHubMixVideoRequestBody(requestedModel, {
        ...options,
        config: {
          ...options.config,
          model: requestedModel,
        },
      });
    } else if (shouldUseImageGenerationEndpoint) {
      const prompt = buildImageGenerationPromptFromMessages(options.messages);
      const lowerImageModel = requestedModel.toLowerCase();
      const isGptImage15 = lowerImageModel === "gpt-image-1.5";
      requestPayload = {
        model: requestedModel,
        prompt,
        // URLs are only valid for 60 minutes after the image has been generated.
        response_format: "b64_json", // using b64_json, and save image in CacheStorage
        n: 1,
        size: normalizeModelSize(requestedModel, options.config?.size),
        ...(lowerImageModel === "dall-e-2" || isGptImage15
          ? {}
          : {
              quality: normalizeImageQuality(
                requestedModel,
                options.config?.quality,
              ),
            }),
        ...(lowerImageModel === "dall-e-3"
          ? {
              style: options.config?.style ?? "vivid",
            }
          : {}),
      };
    } else {
      const messages: ChatOptions["messages"] = [];
      for (const v of options.messages) {
        const shouldSendImages = getMessageImages(v).length > 0;
        const content = shouldSendImages
          ? await preProcessImageContent(v.content)
          : getMessageTextContent(v);
        if (!(isReasoningOpenAIModel && v.role === "system")) {
          messages.push({
            role: v.role,
            content,
            reasoning_details: (v as any).reasoning_details,
          });
        }
      }

      // O1 not support image, tools (plugin in ChatGPTNextWeb) and system, stream, logprobs, temperature, top_p, n, presence_penalty, frequency_penalty yet.
      requestPayload = {
        messages,
        ...(isGeminiImagePreview ? { modalities: ["text", "image"] } : {}),
        stream: options.config.stream,
        model: modelConfig.model,
        temperature:
          !isReasoningOpenAIModel && !isGpt5 ? modelConfig.temperature : 1,
        presence_penalty: !isReasoningOpenAIModel
          ? modelConfig.presence_penalty
          : 0,
        frequency_penalty: !isReasoningOpenAIModel
          ? modelConfig.frequency_penalty
          : 0,
        top_p: !isReasoningOpenAIModel ? modelConfig.top_p : 1,
        ...(options.config.outputTokenLimit
          ? { max_tokens: modelConfig.max_tokens }
          : {}),
        // max_tokens: Math.max(modelConfig.max_tokens, 1024),
        // Please do not ask me why not send max_tokens, no reason, this param is just shit, I dont want to explain anymore.
      };

      requestPayload = applyModelSamplingRules(
        modelConfig.model,
        requestPayload,
      );

      const reasoningSettings = getDefaultReasoningSettings(
        modelConfig.model,
        modelConfig.max_tokens,
        modelConfig.reasoningEffort,
        modelConfig.reasoningMaxTokens,
      );

      // web_search_options 仅 OpenAI 官方支持，第三方中转会报 Unknown parameter 错误
      if (
        modelConfig.webSearch &&
        !isAiHubMixBaseUrl(currentBaseUrlForRequest)
      ) {
        requestPayload["web_search_options"] = {
          ...(normalizeSearchContextSize(modelConfig.webSearchContextSize)
            ? {
                search_context_size: normalizeSearchContextSize(
                  modelConfig.webSearchContextSize,
                ),
              }
            : {}),
        };
      }

      const normalizedReasoningEffort = reasoningSettings.reasoningEffort;
      if (normalizedReasoningEffort) {
        requestPayload["reasoning_effort"] = normalizedReasoningEffort;
        requestPayload["reasoning"] = {
          ...(requestPayload["reasoning"] as
            | Record<string, unknown>
            | undefined),
          effort: normalizedReasoningEffort,
        };
      } else if ((reasoningSettings.reasoningMaxTokens ?? 0) > 0) {
        requestPayload["reasoning"] = {
          ...(requestPayload["reasoning"] as
            | Record<string, unknown>
            | undefined),
          max_tokens: reasoningSettings.reasoningMaxTokens,
        };
      }

      // 豆包的 OpenAI 兼容接口默认可能把思考过程直接混进 content。
      // 对自定义兼容渠道默认关闭 thinking，避免正文里出现思考文本和额外空白。
      if (
        isCustomDoubaoThinkingModel(modelConfig.providerName, modelConfig.model)
      ) {
        requestPayload["thinking"] = {
          type: "disabled",
        };
      }

      if (modelConfig.mediaResolution?.trim()) {
        requestPayload["media_resolution"] = modelConfig.mediaResolution.trim();
      }
      if (modelConfig.structuredOutput && modelConfig.jsonSchema?.trim()) {
        requestPayload["response_format"] = {
          type: "json_schema",
          json_schema: {
            name: "nextchat_structured_output",
            schema: parseStructuredOutputSchema(modelConfig.jsonSchema),
          },
        };
      }

      const globalSystemPrompt = String(
        useAppConfig.getState().modelConfig.customSystemPrompt || "",
      );

      if (isGpt5) {
        if (globalSystemPrompt) {
          (requestPayload as RequestPayload).messages.unshift({
            role: "developer",
            content: globalSystemPrompt,
          });
        }
        // Remove max_tokens if present
        delete requestPayload.max_tokens;
        // Add max_completion_tokens (or max_completion_tokens if that's what you meant)
        requestPayload["max_completion_tokens"] = modelConfig.max_tokens;
      } else if (isReasoningOpenAIModel) {
        // by default the o1/o3 models will not attempt to produce output that includes markdown formatting
        // manually add "Formatting re-enabled" developer message to encourage markdown inclusion in model responses
        // (https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reasoning?tabs=python-secure#markdown-output)
        (requestPayload as RequestPayload).messages.unshift({
          role: "developer",
          content: [globalSystemPrompt, "Formatting re-enabled"]
            .filter(Boolean)
            .join("\n"),
        });

        // o1/o3 uses max_completion_tokens to control the number of tokens (https://platform.openai.com/docs/guides/reasoning#controlling-costs)
        requestPayload["max_completion_tokens"] = modelConfig.max_tokens;
      }

      // 图片消息按多模态内容发送，是否支持由真实接口返回决定
      if (hasImageMessages && !parameterSupport.max_completion_tokens) {
        requestPayload["max_tokens"] = Math.max(modelConfig.max_tokens, 4000);
      }
    }

    // console.log("[Request] openai payload: ", requestPayload);

    const shouldStream =
      isGeminiImagePreview ||
      (!shouldUseImageEndpoint && !isVideoModel && !!options.config.stream);

    if (
      shouldStream &&
      !(requestPayload instanceof FormData) &&
      typeof requestPayload === "object" &&
      requestPayload
    ) {
      const streamRequestPayload = requestPayload as Record<string, unknown>;
      streamRequestPayload["stream_options"] = {
        ...((streamRequestPayload["stream_options"] as
          | Record<string, unknown>
          | undefined) || {}),
        include_usage: true,
      };
    }

    requestPayload = applyRequestCompatibilityState(
      requestPayload,
      requestCompatibilityState,
    );

    const tryRequestCompatibilityRetry = (reason: string) => {
      const fallback = getRequestCompatibilityFallback(
        reason,
        requestCompatibilityState,
      );
      if (!fallback) {
        return false;
      }

      requestCompatibilityState = fallback.nextState;
      rememberRequestCompatibilityState(
        requestCompatibilityKey,
        requestCompatibilityState,
      );
      requestPayload = applyRequestCompatibilityState(
        requestPayload,
        requestCompatibilityState,
      );

      console.warn(
        `[Chat Compatibility] ${modelConfig.providerName}/${modelConfig.model} 关闭 ${fallback.disabledField} 后重试`,
      );
      return true;
    };

    const controller = new AbortController();
    options.onController?.(controller);

    let chatPath = "";
    let currentBaseUrl = "";
    let proxyBaseUrl = "";
    let shouldProbeChatPaths = false;
    let rememberedChatEndpoint:
      | ReturnType<typeof getRememberedChatEndpoint>
      | undefined;
    let chatPathMemoryParams:
      | {
          provider?: string;
          profileId?: string;
          profileName?: string;
          baseUrl?: string;
        }
      | undefined;

    try {
      if (modelConfig.providerName === ServiceProvider.Azure) {
        // find model, and get displayName as deployName
        const { models: configModels, customModels: configCustomModels } =
          useAppConfig.getState();
        const {
          defaultModel,
          customModels: accessCustomModels,
          useCustomConfig,
        } = useAccessStore.getState();
        const models = collectModelsWithDefaultModel(
          configModels,
          [configCustomModels, accessCustomModels].join(","),
          defaultModel,
        );
        const model = models.find(
          (model) =>
            model.name === modelConfig.model &&
            model?.provider?.providerName === ServiceProvider.Azure,
        );
        chatPath = this.path(
          (shouldUseImageGenerationEndpoint ? Azure.ImagePath : Azure.ChatPath)(
            (model?.displayName ?? model?.name) as string,
            useCustomConfig ? useAccessStore.getState().azureApiVersion : "",
          ),
          modelConfig,
        );
      } else {
        const configuredCustomProfileForRequest =
          modelConfig.providerName === ServiceProvider.Custom
            ? getCustomProfileForModelConfig(
                useAccessStore.getState() as any,
                modelConfig,
              )
            : undefined;
        chatPathMemoryParams = {
          provider: String(modelConfig.providerName || ServiceProvider.Custom),
          profileId: configuredCustomProfileForRequest?.id,
          profileName: configuredCustomProfileForRequest?.name,
          baseUrl: currentBaseUrlForRequest,
        };
        shouldProbeChatPaths =
          modelConfig.providerName === ServiceProvider.Custom &&
          !shouldUseImageEndpoint &&
          Boolean(currentBaseUrlForRequest);
        const nextPath = aiHubMixPredictionPath
          ? `v1/models/${aiHubMixPredictionPath}/predictions`
          : aiHubMixVideoPath
          ? aiHubMixVideoPath
          : shouldUseToApisImageReferenceEndpoint
          ? OpenaiPath.ImagePath
          : shouldUseImageEditEndpoint
          ? OpenaiPath.ImageEditPath
          : shouldUseImageGenerationEndpoint
          ? OpenaiPath.ImagePath
          : OpenaiPath.ChatPath;
        rememberedChatEndpoint =
          shouldProbeChatPaths && !shouldStream
            ? getRememberedChatEndpoint(chatPathMemoryParams)
            : undefined;
        const initialNextPath = rememberedChatEndpoint?.path
          ? rememberedChatEndpoint.path
          : nextPath;
        // 自定义（OpenAI 兼容）供应商若配置的是绝对 http(s) 上游地址，
        // 必须经由 /api/proxy + x-base-url 头走服务端代理，否则浏览器直连会被 CORS 拒绝。
        const isAbsoluteCrossOriginBaseUrl =
          !!currentBaseUrlForRequest &&
          /^https?:\/\//i.test(currentBaseUrlForRequest) &&
          !currentBaseUrlForRequest.startsWith(ApiPath.OpenAI) &&
          (typeof window === "undefined" ||
            !currentBaseUrlForRequest.startsWith(window.location.origin));
        const shouldProxyCustomChat =
          !shouldUseImageEndpoint &&
          modelConfig.providerName === ServiceProvider.Custom &&
          isAbsoluteCrossOriginBaseUrl;
        if (
          (shouldUseImageEndpoint || shouldProxyCustomChat) &&
          modelConfig.providerName === ServiceProvider.Custom &&
          currentBaseUrlForRequest
        ) {
          const proxyTarget = buildProxyPathForBaseUrl(
            currentBaseUrlForRequest,
            initialNextPath,
          );
          chatPath = proxyTarget.chatPath;
          proxyBaseUrl = proxyTarget.proxyBaseUrl;
        } else {
          chatPath = this.path(initialNextPath, modelConfig);
        }
      }

      currentBaseUrl = currentBaseUrlForRequest;
      const requestHeaders = {
        ...getHeaders(requestPayload instanceof FormData, modelConfig),
        ...(modelConfig.anthropicBeta?.trim()
          ? { "anthropic-beta": modelConfig.anthropicBeta.trim() }
          : {}),
        ...(proxyBaseUrl ? { "x-base-url": proxyBaseUrl } : {}),
      };
      chatPath = appendAuthQueryParam(
        chatPath,
        (requestHeaders as any).Authorization ||
          (requestHeaders as any)["x-api-key"] ||
          (requestHeaders as any)["api-key"] ||
          (requestHeaders as any)["x-goog-api-key"] ||
          (requestHeaders as any)["x-api-key-query-value"],
        (requestHeaders as any)["x-api-key-auth-type"],
        (requestHeaders as any)["x-api-key-auth-query-param"],
      );
      const buildChatPathForCandidate = (candidatePath: string) =>
        appendAuthQueryParam(
          proxyBaseUrl
            ? buildProxyPathForBaseUrl(
                proxyBaseUrl,
                normalizeCandidatePath(candidatePath),
              ).chatPath
            : this.path(normalizeCandidatePath(candidatePath), modelConfig),
          (requestHeaders as any).Authorization ||
            (requestHeaders as any)["x-api-key"] ||
            (requestHeaders as any)["api-key"] ||
            (requestHeaders as any)["x-goog-api-key"] ||
            (requestHeaders as any)["x-api-key-query-value"],
          (requestHeaders as any)["x-api-key-auth-type"],
          (requestHeaders as any)["x-api-key-auth-query-param"],
        );
      let currentChatEndpoint: GenericChatEndpointCandidate =
        rememberedChatEndpoint?.path
          ? {
              path: normalizeCandidatePath(rememberedChatEndpoint.path),
              method: "POST",
              format:
                (rememberedChatEndpoint.format as GenericChatEndpointFormat) ||
                "openai-chat",
            }
          : DEFAULT_GENERIC_CHAT_ENDPOINT;
      const chatEndpointCandidates = shouldProbeChatPaths
        ? [currentChatEndpoint, ...GENERIC_CHAT_ENDPOINT_CANDIDATES].filter(
            (candidate, index, all) =>
              candidate.path &&
              all.findIndex(
                (item) =>
                  item.path === candidate.path &&
                  item.method === candidate.method &&
                  item.format === candidate.format,
              ) === index,
          )
        : [];
      let chatPathProbeIndex = 0;
      const rememberCurrentChatEndpoint = (endpoint = currentChatEndpoint) => {
        if (shouldProbeChatPaths && chatPathMemoryParams) {
          rememberChatEndpoint(chatPathMemoryParams, {
            ...endpoint,
            path: normalizeCandidatePath(endpoint.path),
          });
        }
      };
      const rememberCurrentChatPath = () => {
        rememberCurrentChatEndpoint(currentChatEndpoint);
      };
      const getNextChatEndpointCandidate = (currentPath = chatPath) => {
        if (!shouldProbeChatPaths) return undefined;
        while (chatPathProbeIndex < chatEndpointCandidates.length) {
          const candidate = chatEndpointCandidates[chatPathProbeIndex++];
          const candidateChatPath = buildChatPathForCandidate(candidate.path);
          if (candidateChatPath !== currentPath) {
            return {
              ...candidate,
              chatPath: candidateChatPath,
            };
          }
        }
        return undefined;
      };
      options.onRequest?.({
        provider: modelConfig.providerName,
        model: modelConfig.model,
        useCustomConfig: currentAccessState.useCustomConfig,
        baseUrl: currentBaseUrl,
        chatPath,
        stream: shouldStream,
      });

      if (shouldStream) {
        let index = -1;
        const toolCallIndexById = new Map<string, number>();
        const toolCallIndexByServerIndex = new Map<number, number>();
        let latestReasoningDetails: Record<string, unknown> | undefined;
        let latestUsage: Record<string, unknown> | undefined;
        const effectivePluginIds = usePluginStore
          .getState()
          .getAll()
          .filter((plugin) => plugin.enabled !== false)
          .map((plugin) => plugin.id);
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(effectivePluginIds);
        console.log("[Plugin] 当前会话工具", {
          enabledPluginIds: effectivePluginIds,
          toolNames: tools.map((tool: any) => tool?.function?.name),
        });
        const streamOptions = {
          ...options,
          onPathRetry(
            reason: string,
            currentPath: string,
            response?: Response,
          ) {
            const status = response?.status || 0;
            if (status && !isRetryablePathProbeStatus(status)) {
              return "";
            }
            const nextCandidate = getNextChatEndpointCandidate(currentPath);
            if (nextCandidate) {
              console.warn(
                "[Chat Path Probe] 当前候选请求失败，自动尝试下一个候选",
                {
                  currentPath,
                  nextCandidate: nextCandidate.chatPath,
                  status,
                  reason: String(reason || "").slice(0, 160),
                },
              );
              currentChatEndpoint = nextCandidate;
            }
            return nextCandidate?.chatPath || "";
          },
          onPathSuccess() {
            rememberCurrentChatPath();
          },
          onCompatibilityRetry(reason: string) {
            if (!tryRequestCompatibilityRetry(reason)) {
              return false;
            }
            return requestPayload;
          },
          onCompatibilitySuccess() {
            if (JSON.stringify(requestCompatibilityState) === "{}") {
              rememberRequestCompatibilityState(
                requestCompatibilityKey,
                requestCompatibilityState,
              );
            }
          },
          onFinish(message: string, responseRes: Response) {
            if (latestReasoningDetails) {
              (responseRes as any).__reasoning_details = latestReasoningDetails;
            }
            if (latestUsage) {
              (responseRes as any).__usage = latestUsage;
            }
            rememberCurrentChatPath();
            options.onFinish(message, responseRes);
          },
        };
        streamWithThink(
          chatPath,
          requestPayload,
          requestHeaders,
          tools as any,
          funcs,
          controller,
          // parseSSE
          (text: string, runTools: ChatMessageTool[]) => {
            // console.log("parseSSE", text, runTools);
            const json = JSON.parse(text);
            if (json?.usage) {
              latestUsage = json.usage;
            }
            const choices = json.choices as Array<{
              delta: {
                content: string;
                tool_calls: ChatMessageTool[];
                reasoning_content: string | null;
                reasoning_details?: Record<string, unknown>;
                multi_mod_content?: Array<{
                  inlineData?: { mimeType?: string; data?: string };
                  inline_data?: { mime_type?: string; data?: string };
                }>;
              };
            }>;

            if (!choices?.length) return { isThinking: false, content: "" };

            const tool_calls = choices[0]?.delta?.tool_calls;
            const reasoningDetails = choices[0]?.delta?.reasoning_details;
            if (reasoningDetails) {
              latestReasoningDetails = {
                ...(latestReasoningDetails || {}),
                ...reasoningDetails,
              };
            }
            if (tool_calls?.length > 0) {
              for (const toolCall of tool_calls) {
                const id = toolCall?.id;
                const toolIndex =
                  typeof toolCall?.index === "number"
                    ? toolCall.index
                    : undefined;
                const name = toolCall?.function?.name;
                const args = toolCall?.function?.arguments ?? "";
                let targetIndex =
                  id && toolCallIndexById.has(id)
                    ? toolCallIndexById.get(id)
                    : undefined;

                if (
                  targetIndex === undefined &&
                  toolIndex !== undefined &&
                  toolCallIndexByServerIndex.has(toolIndex)
                ) {
                  targetIndex = toolCallIndexByServerIndex.get(toolIndex);
                }

                const targetTool =
                  targetIndex !== undefined ? runTools[targetIndex] : undefined;

                if (targetTool) {
                  if (id && !targetTool.id) {
                    targetTool.id = id;
                  }
                  if (id) {
                    toolCallIndexById.set(id, targetIndex as number);
                  }
                  if (toolCall?.type) {
                    targetTool.type = toolCall.type;
                  }
                  if (!targetTool.function) {
                    targetTool.function = {
                      name: name as string,
                      arguments: "",
                    };
                  } else if (name) {
                    targetTool.function.name = name;
                  }
                  targetTool.function.arguments =
                    (targetTool.function.arguments || "") + args;
                } else if (id || name) {
                  index += 1;
                  const nextIndex = runTools.length;
                  runTools.push({
                    id: id as string,
                    type: toolCall?.type,
                    function: {
                      name: name as string,
                      arguments: args,
                    },
                  });
                  if (id) {
                    toolCallIndexById.set(id, nextIndex);
                  }
                  if (toolIndex !== undefined) {
                    toolCallIndexByServerIndex.set(toolIndex, nextIndex);
                  }
                } else {
                  const currentTool = index >= 0 ? runTools[index] : undefined;
                  if (currentTool?.function) {
                    currentTool.function.arguments =
                      (currentTool.function.arguments || "") + args;
                  }
                }
              }
            }

            const reasoning = choices[0]?.delta?.reasoning_content;
            const content = choices[0]?.delta?.content;
            const imageParts = choices[0]?.delta?.multi_mod_content;
            const imageMarkdown = (imageParts || [])
              .map((item) => {
                const mimeType =
                  item?.inlineData?.mimeType || item?.inline_data?.mime_type;
                const data = item?.inlineData?.data || item?.inline_data?.data;
                if (mimeType?.startsWith("image/") && data) {
                  return `![Generated Image](data:${mimeType};base64,${data})`;
                }
                return "";
              })
              .filter(Boolean)
              .join("\n\n");

            // Skip if both content and reasoning_content are empty or null
            if (
              (!imageMarkdown || imageMarkdown.length === 0) &&
              (!reasoning || reasoning.length === 0) &&
              (!content || content.length === 0)
            ) {
              return {
                isThinking: false,
                content: "",
              };
            }

            if (reasoning && reasoning.length > 0) {
              return {
                isThinking: true,
                content: reasoning,
              };
            } else if (imageMarkdown && imageMarkdown.length > 0) {
              return {
                isThinking: false,
                content: imageMarkdown,
              };
            } else if (content && content.length > 0) {
              return {
                isThinking: false,
                content: content,
              };
            }

            return {
              isThinking: false,
              content: "",
            };
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            // reset index value
            index = -1;
            toolCallIndexById.clear();
            toolCallIndexByServerIndex.clear();
            // @ts-ignore
            requestPayload?.messages?.splice(
              // @ts-ignore
              requestPayload?.messages?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          streamOptions,
        );
      } else {
        const buildChatPayloadForEndpoint = (
          endpoint = currentChatEndpoint,
        ) => ({
          method: endpoint.method,
          body:
            requestPayload instanceof FormData
              ? requestPayload
              : JSON.stringify(
                  buildGenericChatPayload(requestPayload, endpoint.format),
                ),
          signal: controller.signal,
          headers: stripInternalChatHeaders(requestHeaders),
        });
        let chatPayload = buildChatPayloadForEndpoint();

        // make a fetch request
        const requestTimeoutId = setTimeout(
          () => controller.abort(),
          getTimeoutMSByModel(options.config.model),
        );

        let res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        if (
          shouldProbeChatPaths &&
          isRetryablePathProbeStatus(res.status) &&
          chatEndpointCandidates.length > 0
        ) {
          let nextEndpoint = getNextChatEndpointCandidate(chatPath);
          while (nextEndpoint) {
            const probePayload = buildChatPayloadForEndpoint(nextEndpoint);
            const probeTimeoutId = setTimeout(
              () => controller.abort(),
              getTimeoutMSByModel(options.config.model),
            );
            const probeRes = await fetch(nextEndpoint.chatPath, probePayload);
            clearTimeout(probeTimeoutId);
            if (!isRetryablePathProbeStatus(probeRes.status) || probeRes.ok) {
              currentChatEndpoint = nextEndpoint;
              chatPath = nextEndpoint.chatPath;
              chatPayload = probePayload;
              res = probeRes;
              rememberCurrentChatEndpoint(nextEndpoint);
              break;
            }
            res = probeRes;
            nextEndpoint = getNextChatEndpointCandidate(nextEndpoint.chatPath);
          }
        }

        // 通用多 key 降级重试：检测到失败后按分组顺序尝试下一个 API key
        const fallbackApiKeys: string[] =
          (requestHeaders as any)["x-fallback-api-keys"] || [];
        const fallbackApiKeyGroups: string[] =
          (requestHeaders as any)["x-fallback-api-key-groups"] || [];
        const supportsGrouping = fallbackApiKeyGroups.length > 0;
        let retryCount = 0;
        let resText = "";
        let resJson: any = null;

        while (true) {
          resText = await res.text();
          resJson = parseJsonOrSSEPayload(resText);

          if (!res.ok && tryRequestCompatibilityRetry(resText)) {
            chatPayload = buildChatPayloadForEndpoint();
            const retryTimeoutId = setTimeout(
              () => controller.abort(),
              getTimeoutMSByModel(options.config.model),
            );
            res = await fetch(chatPath, chatPayload);
            clearTimeout(retryTimeoutId);
            retryCount = 0;
            continue;
          }

          const retryableError = supportsGrouping
            ? getGroupedApiKeyRetryableErrorMessage(resJson)
            : "";
          const shouldRetry =
            supportsGrouping &&
            retryCount < fallbackApiKeys.length - 1 &&
            (!res.ok || Boolean(retryableError));

          if (!shouldRetry) {
            break;
          }

          console.log(
            `[MultiKey Retry] 非流式请求失败，尝试降级重试 (${retryCount + 1}/${
              fallbackApiKeys.length
            })`,
            {
              currentGroup: fallbackApiKeyGroups[retryCount] || "",
              nextGroup: fallbackApiKeyGroups[retryCount + 1] || "",
              retryableError,
            },
          );

          // 使用下一个 API key 重试
          retryCount++;
          const nextApiKey = fallbackApiKeys[retryCount];

          // 更新 headers 中的 API key
          const authHeader =
            (requestHeaders as any)["x-api-key-auth-header"] ||
            Object.keys(requestHeaders).find(
              (k) =>
                k.toLowerCase() === "authorization" ||
                k.toLowerCase() === "x-api-key" ||
                k.toLowerCase() === "api-key" ||
                k.toLowerCase() === "x-goog-api-key",
            );
          const authType = String(
            (requestHeaders as any)["x-api-key-auth-type"] || "bearer",
          );
          if (authType === "query-key") {
            (requestHeaders as any)["x-api-key-query-value"] = nextApiKey;
            const queryParamName = String(
              (requestHeaders as any)["x-api-key-auth-query-param"] || "key",
            ).trim();
            chatPath = replaceUrlQueryParam(
              chatPath,
              queryParamName,
              nextApiKey,
            );
          } else if (authHeader) {
            (requestHeaders as any)[authHeader] =
              authType === "bearer" ? `Bearer ${nextApiKey}` : nextApiKey;
          }

          // 更新 chatPayload 中的 headers
          chatPayload = buildChatPayloadForEndpoint();

          // 重试请求
          const retryTimeoutId = setTimeout(
            () => controller.abort(),
            getTimeoutMSByModel(options.config.model),
          );
          res = await fetch(chatPath, chatPayload);
          clearTimeout(retryTimeoutId);
        }

        const pollingUrl =
          resJson?.polling_url ||
          resJson?.data?.[0]?.polling_url ||
          resJson?.output?.[0]?.polling_url;
        if (typeof pollingUrl === "string" && pollingUrl.length > 0) {
          options.onUpdate?.(formatVideoTaskStatus(resJson), "");
          resJson = await pollAiHubMixTask(
            pollingUrl,
            requestHeaders,
            controller,
            (payload) => {
              if (aiHubMixVideoPath) {
                options.onUpdate?.(formatVideoTaskStatus(payload), "");
              }
            },
          );
        } else if (aiHubMixVideoPath) {
          const status = getTaskStatus(resJson);
          const videoTaskId = getVideoTaskId(resJson);
          if (videoTaskId && isPendingTaskStatus(status)) {
            options.onUpdate?.(formatVideoTaskStatus(resJson), "");
          }
          if (videoTaskId && isPendingTaskStatus(status)) {
            resJson = await pollAiHubMixTask(
              this.path(`v1/videos/${videoTaskId}`, modelConfig),
              requestHeaders,
              controller,
              (payload) => {
                options.onUpdate?.(formatVideoTaskStatus(payload), "");
              },
            );
          }
          const completedStatus = getTaskStatus(resJson);
          const completedVideoTaskId = getVideoTaskId(resJson);
          if (
            completedVideoTaskId &&
            ["succeeded", "completed", "success"].includes(completedStatus)
          ) {
            const contentUrl = this.path(
              `v1/videos/${completedVideoTaskId}/content`,
              modelConfig,
            );
            options.onUpdate?.(
              `视频任务已完成，正在拉取内容...\n${contentUrl}`,
              "",
            );
            resJson = await attachCompletedVideoContent(
              resJson,
              contentUrl,
              requestHeaders,
              controller,
            );
          }
        }
        const reasoningDetails =
          resJson?.choices?.[0]?.message?.reasoning_details ??
          resJson?.choices?.[0]?.delta?.reasoning_details;
        if (reasoningDetails) {
          (res as any).__reasoning_details = reasoningDetails;
        }
        if (resJson?.usage) {
          (res as any).__usage = resJson.usage;
        }
        if (res.ok && supportsGrouping && fallbackApiKeyGroups[retryCount]) {
          rememberSuccessfulCustomModelApiKeyGroup({
            modelName: modelConfig.model,
            groupName: fallbackApiKeyGroups[retryCount],
            profileId: (requestHeaders as any)["x-api-key-profile-id"],
            providerId: (requestHeaders as any)["x-api-key-provider-id"],
          });
        }
        const message =
          extractGenericMessage(resJson) ||
          (await this.extractMessage(resJson));
        if (res.ok) {
          rememberCurrentChatPath();
        }
        options.onFinish(message, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      console.error("[Chat Request Error]", {
        provider: modelConfig.providerName,
        model: modelConfig.model,
        useCustomConfig: useAccessStore.getState().useCustomConfig,
        baseUrl: currentBaseUrl,
        chatPath,
        stream: shouldStream,
        error: e,
      });
      options.onError?.(e as Error);
    }
  }
  async usage() {
    const formatDate = (d: Date) =>
      `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}-${d
        .getDate()
        .toString()
        .padStart(2, "0")}`;
    const ONE_DAY = 1 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDate = formatDate(startOfMonth);
    const endDate = formatDate(new Date(Date.now() + ONE_DAY));

    const [used, subs] = await Promise.all([
      fetch(
        this.path(
          `${OpenaiPath.UsagePath}?start_date=${startDate}&end_date=${endDate}`,
        ),
        {
          method: "GET",
          headers: getHeaders(),
        },
      ),
      fetch(this.path(OpenaiPath.SubsPath), {
        method: "GET",
        headers: getHeaders(),
      }),
    ]);

    if (used.status === 401) {
      throw new Error(Locale.Error.Unauthorized);
    }

    if (!used.ok || !subs.ok) {
      throw new Error("Failed to query usage from openai");
    }

    const response = (await used.json()) as {
      total_usage?: number;
      error?: {
        type: string;
        message: string;
      };
    };

    const total = (await subs.json()) as {
      hard_limit_usd?: number;
    };

    if (response.error && response.error.type) {
      throw Error(response.error.message);
    }

    if (response.total_usage) {
      response.total_usage = Math.round(response.total_usage) / 100;
    }

    if (total.hard_limit_usd) {
      total.hard_limit_usd = Math.round(total.hard_limit_usd * 100) / 100;
    }

    return {
      used: response.total_usage,
      total: total.hard_limit_usd,
    } as LLMUsage;
  }

  async models(): Promise<LLMModel[]> {
    if (this.disableListModels) {
      return [];
    }

    const res = await fetch(this.path(OpenaiPath.ListModelPath), {
      method: "GET",
      headers: {
        ...getHeaders(),
      },
    });

    const resJson = (await res.json()) as OpenAIListModelResponse;
    const chatModels = resJson.data?.filter(
      (m) => m.id.startsWith("gpt-") || m.id.startsWith("chatgpt-"),
    );
    console.log("[Models]", chatModels);

    if (!chatModels) {
      return [];
    }

    //由于目前 OpenAI 的 disableListModels 默认为 true，所以当前实际不会运行到这场
    let seq = 1000; //同 Constant.ts 中的排序保持一致
    return chatModels.map((m) => ({
      name: m.id,
      available: true,
      sorted: seq++,
      provider: {
        id: "openai",
        providerName: "OpenAI",
        providerType: "openai",
        sorted: 1,
      },
    }));
  }
}
export { OpenaiPath };
