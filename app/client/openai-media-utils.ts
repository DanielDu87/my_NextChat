import {
  getModelSizes,
  getSupportedImageQualityOptions,
  isImageGenerationModel,
  isVideoGenerationModel,
} from "../utils/model-capabilities";
import { inferModelCapability } from "./model-capability";
import {
  getDrawModelFamily,
  parseDrawImageSize,
  toBooleanParam,
  toDashScopeSize,
} from "@/app/utils/draw-model-params";

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
    n?: number;
    safety_tolerance?: number;
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

function pickParams(
  params: Record<string, string | undefined>,
  keys: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of keys) {
    const val = params[key];
    if (val !== undefined && val !== "" && val !== "auto") {
      result[key] = val;
    }
  }
  return result;
}

export function buildAiHubMixPredictionPayload(
  model: string,
  options: ChatOptionsLike,
  extraParams?: Record<string, unknown>,
) {
  const normalizedModel = normalizeAiHubMixModelId(model);
  const lowerModel = normalizedModel.toLowerCase();
  const prompt = getMessageTextContent(options.messages.slice(-1).pop());
  const normalizedSize = normalizeModelSize(model, options.config?.size);
  const config = options.config || {};

  if (lowerModel.startsWith("imagen-")) {
    const imagenInput: Record<string, unknown> = {
      prompt,
      numberOfImages: Number(extraParams?.n || config.n || 1),
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
      n: Number(extraParams?.n || config.n || 1),
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
      wanInput.n = Number(extraParams?.n || config.n || 1);
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
      wanInput.n = Number(extraParams?.n || config.n || 1);
      if (extraParams?.style) {
        wanInput.style = extraParams.style;
      }
    } else if (family !== "alibaba-wan") {
      wanInput.n = Number(extraParams?.n || config.n || 1);
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

  if (lowerModel.startsWith("flux-2-")) {
    const size = parseDrawImageSize(extraParams?.image_size) || {
      width: 1024,
      height: 1024,
    };
    const fluxInput: Record<string, unknown> = {
      prompt,
      width: size.width,
      height: size.height,
      safety_tolerance: Number(
        extraParams?.safety_tolerance || config.safety_tolerance || 2,
      ),
    };
    if (extraParams?.output_format) {
      fluxInput.output_format = extraParams.output_format;
    }
    if (
      extraParams?.seed !== undefined &&
      extraParams.seed !== "" &&
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
      extraParams.prompt_upsampling !== ""
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
    const fluxInput: Record<string, unknown> = {
      prompt,
      size: extraParams?.image_size || normalizedSize || "1024x1024",
      output_format: extraParams?.output_format || "jpeg",
    };
    const extraBody: Record<string, unknown> = {};
    if (
      extraParams?.prompt_upsampling === "true" ||
      extraParams?.prompt_upsampling === true
    ) {
      extraBody.prompt_upsampling = true;
    }
    if (
      extraParams?.safety_tolerance !== undefined &&
      extraParams?.safety_tolerance !== ""
    ) {
      extraBody.safety_tolerance = Number(extraParams.safety_tolerance);
    }
    if (
      extraParams?.seed !== undefined &&
      extraParams?.seed !== "" &&
      Number(extraParams.seed) > 0
    ) {
      extraBody.seed = Number(extraParams.seed);
    }
    if (Object.keys(extraBody).length > 0) {
      fluxInput.extra_body = extraBody;
    }
    return { input: fluxInput };
  }

  if (normalizedModel === "ideogram-v4") {
    return {
      input: {
        text_prompt: prompt,
        resolution: extraParams?.resolution || "2048x2048",
        rendering_speed: String(extraParams?.rendering_speed || "DEFAULT"),
      },
    };
  }

  if (normalizedModel === "V3") {
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
      extraParams.seed !== "" &&
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
    n: Number(extraParams?.n || config.n || 1),
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
  if (extraParams?.input_fidelity) {
    input.input_fidelity = extraParams.input_fidelity;
  }

  return { input };
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
