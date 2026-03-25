"use client";
// azure and openai, using same models. so using same LLMApi.
import { default as constants } from "@/app/constant";
import type { ChatMessageTool } from "@/app/store/chat";
import { useChatStore } from "@/app/store/chat";
import { useAccessStore } from "@/app/store/access";
import { useAppConfig } from "@/app/store/config";
import { usePluginStore } from "@/app/store/plugin";
import { collectModelsWithDefaultModel } from "@/app/utils/model";
import {
  preProcessImageContent,
  uploadImage,
  base64Image2Blob,
  streamWithThink,
} from "@/app/utils/chat";
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
  isVisionModel,
  isDalle3 as _isDalle3,
  isImageGenerationModel,
  isVideoGenerationModel,
  getTimeoutMSByModel,
  normalizeModelSize,
  normalizeImageQuality,
} from "@/app/utils";
import { fetch } from "@/app/utils/stream";

const {
  ALWAYS_USE_CHINESE_SYSTEM_PROMPT,
  ApiPath,
  OPENAI_BASE_URL,
  OpenaiPath,
  Azure,
  REQUEST_TIMEOUT_MS,
  ServiceProvider,
} = constants;
type ServiceProviderValue =
  (typeof ServiceProvider)[keyof typeof ServiceProvider];

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
  return baseUrl.includes("aihubmix.com");
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
  if (lowerModel.endsWith("/gpt-image-1.5")) return "gpt-image-1.5";
  if (lowerModel.endsWith("/gpt-image-1")) return "gpt-image-1";
  if (lowerModel.endsWith("/gpt-image-1-mini")) return "gpt-image-1-mini";
  if (lowerModel.endsWith("/gpt-image-test")) return "gpt-image-test";
  if (lowerModel.endsWith("/dall-e-3")) return "dall-e-3";
  if (lowerModel.endsWith("/dall-e-2")) return "dall-e-2";
  if (lowerModel.includes("ideogram")) return "V3";
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
  if (lowerModel.startsWith("doubao-seedream-")) {
    return `doubao/${normalizedModel}`;
  }
  if (
    lowerModel.startsWith("flux-2-") ||
    lowerModel.startsWith("flux-kontext-") ||
    lowerModel.startsWith("flux/")
  ) {
    return `bfl/${normalizedModel}`;
  }
  if (normalizedModel === "V3" || lowerModel.includes("ideogram")) {
    return `ideogram/${normalizedModel}`;
  }

  return null;
}

export function isAiHubMixVideoModel(model: string) {
  return isVideoGenerationModel(model);
}

export function buildAiHubMixPredictionPayload(
  model: string,
  options: ChatOptions,
): Record<string, unknown> {
  const normalizedModel = normalizeAiHubMixModelId(model);
  const lowerModel = normalizedModel.toLowerCase();
  const prompt = getMessageTextContent(
    options.messages.slice(-1)?.pop() as any,
  );
  const isGptImage15 = lowerModel === "gpt-image-1.5";
  const normalizedSize = normalizeModelSize(model, options.config?.size);

  if (lowerModel.startsWith("imagen-")) {
    return {
      input: {
        prompt,
        numberOfImages: 1,
      },
    };
  }

  if (
    lowerModel.startsWith("qwen-image") ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-")
  ) {
    return {
      input: {
        prompt,
        n: 1,
        size: normalizedSize,
        watermark: false,
      },
    };
  }

  if (lowerModel.startsWith("doubao-seedream-")) {
    return {
      input: {
        prompt,
        size: "2K",
        response_format: "url",
        watermark: true,
        stream: false,
      },
    };
  }

  if (
    lowerModel.startsWith("flux-2-") ||
    lowerModel.startsWith("flux-kontext-")
  ) {
    return {
      input: {
        prompt,
        aspect_ratio: "1:1",
        safety_tolerance: 2,
      },
    };
  }

  if (model === "V3") {
    return {
      input: {
        prompt,
        aspect_ratio: "1x1",
      },
    };
  }

  return {
    input: {
      prompt,
      n: 1,
      size: normalizedSize,
      ...(lowerModel === "dall-e-2" || isGptImage15
        ? {}
        : { quality: normalizeImageQuality(model, options.config?.quality) }),
      ...(lowerModel === "dall-e-3"
        ? { style: options.config?.style ?? "vivid" }
        : {}),
    },
  };
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
      headers: requestHeaders,
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
      headers: requestHeaders,
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

function getYutoRetryableErrorMessage(payload: any) {
  const errorCode = String(payload?.error?.code || payload?.code || "").trim();
  const errorMessage = String(
    payload?.error?.message || payload?.message || "",
  ).trim();

  if (!errorCode && !errorMessage) {
    return "";
  }

  if (
    errorCode === "model_not_found" ||
    errorMessage.includes("无可用渠道") ||
    errorMessage.includes("no available distributor")
  ) {
    return errorMessage || errorCode;
  }

  return "";
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

export class ChatGPTApi implements LLMApi {
  private disableListModels = true;

  path(path: string): string {
    const accessStore = useAccessStore.getState() as any;
    const configStore = useChatStore.getState();
    const currentProvider = normalizeServiceProvider(
      configStore.currentSession().mask.modelConfig.providerName,
      accessStore.useCustomConfig,
    );

    let baseUrl = "";

    const isAzure = path.includes("deployments");
    if (accessStore.useCustomConfig) {
      console.log("[ChatGPTApi.path] useCustomConfig=true", {
        customUrl: accessStore.customUrl,
        path: path,
      });

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

      if (
        currentProvider === ServiceProvider.Custom &&
        accessStore.customOpenAICompatible
      ) {
        baseUrl = accessStore.customUrl;
        console.log("[ChatGPTApi.path] Using customUrl:", baseUrl);
      } else {
        baseUrl = isAzure ? accessStore.azureUrl : accessStore.openaiUrl;
        console.log("[ChatGPTApi.path] Using azureUrl/openaiUrl:", baseUrl);
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
    return cloudflareAIGatewayUrl([baseUrl, finalPath].join("/"));
  }

  async extractMessage(res: any) {
    const videoFailureMessage = formatAiHubMixVideoFailure(res);
    if (videoFailureMessage) {
      return videoFailureMessage;
    }

    if (res.error) {
      return "```\n" + JSON.stringify(res, null, 4) + "\n```";
    }
    // dalle3 model return url, using url create image message
    if (res.data) {
      let url = res.data?.at(0)?.url ?? "";
      const videoUrl =
        res.data?.at(0)?.video_url ||
        res.data?.at(0)?.videoUrl ||
        (isVideoUrl(url) ? url : "");
      const b64_json = res.data?.at(0)?.b64_json ?? "";
      if (videoUrl) {
        return toVideoMarkdown(videoUrl);
      }
      if (!url && b64_json) {
        // uploadImage
        url = await uploadImage(base64Image2Blob(b64_json, "image/png"));
      }
      return [
        {
          type: "image_url",
          image_url: {
            url,
          },
        },
      ];
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
      const outputB64 =
        res.output?.b64_json?.[0] ||
        res.output?.b64_json ||
        res.output?.b64?.[0] ||
        res.output?.b64 ||
        "";
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
    return res.choices?.at(0)?.message?.content ?? res;
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
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
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

    const isDalle3 = _isDalle3(options.config.model);
    const isImageModel = isImageGenerationModel(options.config.model);
    const isVideoModel = isVideoGenerationModel(options.config.model);
    const isGeminiImagePreview = isGeminiImagePreviewModel(
      options.config.model,
    );
    const currentAccessState = useAccessStore.getState();
    const currentBaseUrlForRequest =
      modelConfig.providerName === ServiceProvider.Custom
        ? currentAccessState.customUrl
        : modelConfig.providerName === ServiceProvider.Azure
        ? currentAccessState.azureUrl
        : currentAccessState.openaiUrl;
    const aiHubMixPredictionPath =
      isImageModel &&
      !isGeminiImagePreview &&
      isAiHubMixBaseUrl(currentBaseUrlForRequest)
        ? getAiHubMixPredictionModelPath(options.config.model)
        : null;
    const aiHubMixVideoPath =
      isVideoModel && isAiHubMixBaseUrl(currentBaseUrlForRequest)
        ? "v1/videos"
        : null;
    const isReasoningOpenAIModel =
      options.config.model.startsWith("o1") ||
      options.config.model.startsWith("o3") ||
      options.config.model.startsWith("o4") ||
      options.config.model.startsWith("o5");
    const isGpt5 = options.config.model.startsWith("gpt-5");
    const parameterSupport = getModelParameterSupport(modelConfig.model);
    if (aiHubMixPredictionPath) {
      requestPayload = buildAiHubMixPredictionPayload(
        options.config.model,
        options,
      );
    } else if (aiHubMixVideoPath) {
      requestPayload = await buildAiHubMixVideoRequestBody(
        options.config.model,
        options,
      );
    } else if (isImageModel && !isGeminiImagePreview) {
      const prompt = getMessageTextContent(
        options.messages.slice(-1)?.pop() as any,
      );
      const lowerImageModel = options.config.model.toLowerCase();
      const isGptImage15 = lowerImageModel === "gpt-image-1.5";
      requestPayload = {
        model: options.config.model,
        prompt,
        // URLs are only valid for 60 minutes after the image has been generated.
        response_format: "b64_json", // using b64_json, and save image in CacheStorage
        n: 1,
        size: normalizeModelSize(options.config.model, options.config?.size),
        ...(lowerImageModel === "dall-e-2" || isGptImage15
          ? {}
          : {
              quality: normalizeImageQuality(
                options.config.model,
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
      const visionModel = isVisionModel(options.config.model);
      const messages: ChatOptions["messages"] = [];
      for (const v of options.messages) {
        const content = visionModel
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

      if (modelConfig.webSearch) {
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

      if (isGpt5) {
        (requestPayload as RequestPayload).messages.unshift({
          role: "developer",
          content: ALWAYS_USE_CHINESE_SYSTEM_PROMPT,
        });
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
          content: `${ALWAYS_USE_CHINESE_SYSTEM_PROMPT}\nFormatting re-enabled`,
        });

        // o1/o3 uses max_completion_tokens to control the number of tokens (https://platform.openai.com/docs/guides/reasoning#controlling-costs)
        requestPayload["max_completion_tokens"] = modelConfig.max_tokens;
      }

      // add max_tokens to vision model
      if (visionModel && !parameterSupport.max_completion_tokens) {
        requestPayload["max_tokens"] = Math.max(modelConfig.max_tokens, 4000);
      }
    }

    // console.log("[Request] openai payload: ", requestPayload);

    const shouldStream =
      isGeminiImagePreview ||
      (!isImageModel && !isVideoModel && !!options.config.stream);

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

    const controller = new AbortController();
    options.onController?.(controller);

    let chatPath = "";
    let currentBaseUrl = "";

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
          (isImageModel && !isGeminiImagePreview
            ? Azure.ImagePath
            : Azure.ChatPath)(
            (model?.displayName ?? model?.name) as string,
            useCustomConfig ? useAccessStore.getState().azureApiVersion : "",
          ),
        );
      } else {
        chatPath = this.path(
          aiHubMixPredictionPath
            ? `v1/models/${aiHubMixPredictionPath}/predictions`
            : aiHubMixVideoPath
            ? aiHubMixVideoPath
            : isImageModel && !isGeminiImagePreview
            ? OpenaiPath.ImagePath
            : OpenaiPath.ChatPath,
        );
      }

      currentBaseUrl = currentBaseUrlForRequest;
      const requestHeaders = {
        ...getHeaders(requestPayload instanceof FormData),
        ...(modelConfig.anthropicBeta?.trim()
          ? { "anthropic-beta": modelConfig.anthropicBeta.trim() }
          : {}),
      };
      console.log("[Chat Request]", {
        provider: modelConfig.providerName,
        model: modelConfig.model,
        useCustomConfig: currentAccessState.useCustomConfig,
        baseUrl: currentBaseUrl,
        chatPath,
        stream: shouldStream,
      });
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
        let latestReasoningDetails: Record<string, unknown> | undefined;
        let latestUsage: Record<string, unknown> | undefined;
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(
            useChatStore.getState().currentSession().mask?.plugin || [],
          );
        // console.log("getAsTools", tools, funcs);
        const streamOptions = {
          ...options,
          onFinish(message: string, responseRes: Response) {
            if (latestReasoningDetails) {
              (responseRes as any).__reasoning_details = latestReasoningDetails;
            }
            if (latestUsage) {
              (responseRes as any).__usage = latestUsage;
            }
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
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
                index += 1;
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else {
                // @ts-ignore
                runTools[index]["function"]["arguments"] += args;
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
        let chatPayload = {
          method: "POST",
          body:
            requestPayload instanceof FormData
              ? requestPayload
              : JSON.stringify(requestPayload),
          signal: controller.signal,
          headers: requestHeaders,
        };

        // make a fetch request
        const requestTimeoutId = setTimeout(
          () => controller.abort(),
          getTimeoutMSByModel(options.config.model),
        );

        let res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        // YutoAPI 降级重试：检测到任何失败都尝试下一个 API key
        const fallbackApiKeys: string[] =
          (requestHeaders as any)["x-fallback-api-keys"] || [];
        const isYutoApi =
          chatPath.includes("cn.gptapi.asia") ||
          chatPath.includes("gptapi.asia");
        let retryCount = 0;
        let resText = "";
        let resJson: any = null;

        while (true) {
          resText = await res.text();
          resJson = parseJsonOrSSEPayload(resText);
          const retryableYutoError = isYutoApi
            ? getYutoRetryableErrorMessage(resJson)
            : "";
          const shouldRetry =
            isYutoApi &&
            retryCount < fallbackApiKeys.length - 1 &&
            (!res.ok || Boolean(retryableYutoError));

          if (!shouldRetry) {
            break;
          }

          console.log(
            `[Chat] YutoAPI 非流式请求失败，尝试降级重试 (${retryCount + 1}/${
              fallbackApiKeys.length
            })`,
            retryableYutoError ? { retryableYutoError } : undefined,
          );

          // 使用下一个 API key 重试
          retryCount++;
          const nextApiKey = fallbackApiKeys[retryCount];

          // 更新 headers 中的 API key
          const authHeader = Object.keys(requestHeaders).find(
            (k) =>
              k.toLowerCase() === "authorization" ||
              k.toLowerCase() === "x-api-key",
          );
          if (authHeader) {
            (requestHeaders as any)[authHeader] = `Bearer ${nextApiKey}`;
          }

          // 更新 chatPayload 中的 headers
          chatPayload = {
            method: "POST",
            body:
              requestPayload instanceof FormData
                ? requestPayload
                : JSON.stringify(requestPayload),
            signal: controller.signal,
            headers: requestHeaders,
          };

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
              this.path(`v1/videos/${videoTaskId}`),
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
        const message = await this.extractMessage(resJson);
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
