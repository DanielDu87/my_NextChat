import {
  getModelSizes,
  getSupportedImageQualityOptions,
  isImageGenerationModel,
  isVideoGenerationModel,
} from "../utils/model-capabilities";
import { inferModelCapability } from "./model-capability";

type ChatOptionsLike = {
  messages: Array<{
    role?: string;
    content?:
      | string
      | Array<{ type?: string; text?: string; image_url?: { url?: string } }>;
  }>;
  config?: {
    model?: string;
    size?: string;
    quality?: string;
    style?: string;
    seconds?: string;
  };
};

function getMessageTextContent(
  message: ChatOptionsLike["messages"][number] | undefined,
) {
  if (!message) return "";
  if (typeof message.content === "string") {
    return message.content;
  }
  if (!Array.isArray(message.content)) {
    return "";
  }
  for (const item of message.content) {
    if (item.type === "text") {
      return item.text ?? "";
    }
  }
  return "";
}

function getMessageImages(
  message: ChatOptionsLike["messages"][number] | undefined,
) {
  if (
    !message ||
    typeof message.content === "string" ||
    !Array.isArray(message.content)
  ) {
    return [] as string[];
  }
  return message.content
    .filter((item) => item.type === "image_url")
    .map((item) => item.image_url?.url ?? "")
    .filter(Boolean);
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

function normalizeModelSize(model: string, preferredSize?: string) {
  const supportedSizes = getModelSizes(model);
  if (supportedSizes.length === 0) {
    return preferredSize || "1024x1024";
  }
  return preferredSize && supportedSizes.includes(preferredSize)
    ? preferredSize
    : supportedSizes[0];
}

function normalizeImageQuality(model: string, preferredQuality?: string) {
  const lowerModel = model.toLowerCase();
  const supported = getSupportedImageQualityOptions(model);
  if (lowerModel.includes("gpt-image-")) {
    if (!preferredQuality || preferredQuality === "standard") return "auto";
    if (preferredQuality === "hd") return "high";
    return supported.includes(preferredQuality) ? preferredQuality : "auto";
  }
  if (lowerModel.includes("dall-e-3")) {
    if (!preferredQuality || preferredQuality === "standard") return "standard";
    if (preferredQuality === "high") return "hd";
    return supported.includes(preferredQuality) ? preferredQuality : "standard";
  }
  return "";
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
  options: ChatOptionsLike,
) {
  const normalizedModel = normalizeAiHubMixModelId(model);
  const lowerModel = normalizedModel.toLowerCase();
  const prompt = getMessageTextContent(options.messages.slice(-1).pop());
  const isGptImage15 = lowerModel === "gpt-image-1.5";
  const normalizedSize = normalizeModelSize(model, options.config?.size);

  if (lowerModel.startsWith("imagen-")) {
    return { input: { prompt, numberOfImages: 1 } };
  }
  if (
    lowerModel.startsWith("qwen-image") ||
    lowerModel.startsWith("irag-") ||
    lowerModel.startsWith("ernie-irag-")
  ) {
    return {
      input: { prompt, n: 1, size: normalizedSize, watermark: false },
    };
  }
  if (
    lowerModel.startsWith("flux-2-") ||
    lowerModel.startsWith("flux-kontext-")
  ) {
    return {
      input: { prompt, aspect_ratio: "1:1", safety_tolerance: 2 },
    };
  }
  if (normalizedModel === "V3") {
    return {
      input: { prompt, aspect_ratio: "1x1" },
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
  options: ChatOptionsLike,
) {
  const latestMessage = options.messages.slice(-1).pop();
  const prompt = getMessageTextContent(latestMessage);
  const imageUrls = getMessageImages(latestMessage);
  const veoPromptValidationError = getVeoPromptValidationError(model, prompt);
  if (veoPromptValidationError) {
    throw new Error(veoPromptValidationError);
  }

  if (isVeoVideoModel(model)) {
    return {
      model,
      prompt,
      images: imageUrls,
      enhance_prompt: true,
      enable_upsample: false,
    };
  }

  return {
    model,
    prompt,
    size: options.config?.size || "720x1280",
    seconds: parseInt(options.config?.seconds || "4"),
    ...(imageUrls[0] ? { image_url: imageUrls[0] } : {}),
  };
}

function isVideoUrl(url: string) {
  return (
    /^blob:/i.test(url) || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|#|$)/i.test(url)
  );
}

function toVideoMarkdown(url: string) {
  return `[Generated Video](${url})`;
}

function getTaskStatus(payload: any) {
  return String(
    payload?.status ||
      payload?.data?.[0]?.status ||
      payload?.output?.[0]?.status ||
      "",
  ).toLowerCase();
}

function getTaskProgress(payload: any) {
  const progress = payload?.progress ?? payload?.data?.[0]?.progress;
  return typeof progress === "number" ? progress : 0;
}

function getVideoTaskId(payload: any) {
  return String(payload?.id || payload?.data?.[0]?.id || "").trim();
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

export async function attachCompletedVideoContent(
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
    if (contentType.includes("video/")) {
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
      return {
        ...payload,
        output: {
          ...(payload?.output || {}),
          video_url: objectUrl,
        },
      };
    }
    if (!res.ok || contentType.includes("application/json")) {
      const responseText = await res.text();
      let errorPayload: unknown = responseText;
      try {
        errorPayload = JSON.parse(responseText);
      } catch {}
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
  } catch (error) {
    return payload;
  }

  return payload;
}

export async function extractOpenAIMediaMessage(res: any) {
  const videoFailureMessage = formatAiHubMixVideoFailure(res);
  if (videoFailureMessage) {
    return videoFailureMessage;
  }
  if (res.data) {
    const url = res.data?.at(0)?.url ?? "";
    return [
      {
        type: "image_url",
        image_url: { url },
      },
    ];
  }
  if (res.output && typeof res.output === "object") {
    const outputVideoUrl = res.output?.video_url || res.output?.videoUrl || "";
    const outputUrl =
      res.output?.url ||
      res.output?.image_url ||
      res.output?.imageUrl ||
      res.output?.urls?.[0] ||
      "";
    const outputError = res.output?.content_error;

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
          image_url: { url: outputUrl },
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
  return res?.choices?.at(0)?.message?.content ?? res;
}

const openaiMediaUtils = {
  attachCompletedVideoContent,
  buildAiHubMixPredictionPayload,
  buildAiHubMixVideoPayload,
  extractOpenAIMediaMessage,
  getAiHubMixPredictionModelPath,
  inferModelCapability,
  isAiHubMixVideoModel,
};

export default openaiMediaUtils;
