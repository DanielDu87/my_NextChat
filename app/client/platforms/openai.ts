"use client";
// azure and openai, using same models. so using same LLMApi.
import {
  ApiPath,
  OPENAI_BASE_URL,
  OpenaiPath,
  Azure,
  REQUEST_TIMEOUT_MS,
  ServiceProvider,
} from "@/app/constant";
import {
  ChatMessageTool,
  useAccessStore,
  useAppConfig,
  useChatStore,
  usePluginStore,
} from "@/app/store";
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
  getModelParameterSupport,
} from "../model-parameter-rules";
import Locale from "../../locales";
import { getClientConfig } from "@/app/config/client";
import {
  getMessageTextContent,
  isVisionModel,
  isDalle3 as _isDalle3,
  isImageGenerationModel,
  getTimeoutMSByModel,
} from "@/app/utils";
import { fetch } from "@/app/utils/stream";

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
  }[];
  modalities?: string[];
  stream?: boolean;
  model: string;
  temperature: number;
  presence_penalty: number;
  frequency_penalty: number;
  top_p: number;
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
    Object.values(ServiceProvider).includes(providerName as ServiceProvider)
  ) {
    return providerName as ServiceProvider;
  }

  return useCustomConfig ? ServiceProvider.Custom : ServiceProvider.OpenAI;
}

function isGeminiImagePreviewModel(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.startsWith("gemini-") &&
    (lowerModel.includes("image-preview") ||
      lowerModel.includes("image-generation"))
  );
}

function isAiHubMixBaseUrl(baseUrl: string) {
  return baseUrl.includes("aihubmix.com");
}

function normalizeAiHubMixModelId(model: string) {
  const lowerModel = model.toLowerCase();
  if (lowerModel.endsWith("/qwen-image")) return "qwen-image";
  if (lowerModel.endsWith("/qwen-image-edit")) return "qwen-image-edit";
  if (lowerModel.endsWith("/qwen-image-plus")) return "qwen-image-plus";
  if (lowerModel.endsWith("/gpt-image-1")) return "gpt-image-1";
  if (lowerModel.endsWith("/gpt-image-1-mini")) return "gpt-image-1-mini";
  if (lowerModel.endsWith("/dall-e-3")) return "dall-e-3";
  if (lowerModel.endsWith("/dall-e-2")) return "dall-e-2";
  return model;
}

function getAiHubMixPredictionModelPath(model: string) {
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
    lowerModel.startsWith("flux-kontext-")
  ) {
    return `bfl/${normalizedModel}`;
  }
  if (normalizedModel === "V3") {
    return `ideogram/${normalizedModel}`;
  }

  return null;
}

function buildAiHubMixPredictionPayload(
  model: string,
  options: ChatOptions,
): Record<string, unknown> {
  const normalizedModel = normalizeAiHubMixModelId(model);
  const lowerModel = normalizedModel.toLowerCase();
  const prompt = getMessageTextContent(
    options.messages.slice(-1)?.pop() as any,
  );

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
        size: options.config?.size ?? "1024x1024",
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
      size: options.config?.size ?? "1024x1024",
      quality: options.config?.quality ?? "standard",
    },
  };
}

function parseJsonOrSSEPayload(text: string) {
  const trimmed = text.trim();
  if (!trimmed) return {};

  try {
    return JSON.parse(trimmed);
  } catch {}

  const ssePayload = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.replace(/^data:\s*/, ""))
    .filter((line) => line && line !== "[DONE]")
    .pop();

  if (!ssePayload) {
    throw new Error(`Unexpected payload: ${trimmed.slice(0, 120)}`);
  }

  return JSON.parse(ssePayload);
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
    return cloudflareAIGatewayUrl([baseUrl, finalPath].join("/"));
  }

  async extractMessage(res: any) {
    if (res.error) {
      return "```\n" + JSON.stringify(res, null, 4) + "\n```";
    }
    // dalle3 model return url, using url create image message
    if (res.data) {
      let url = res.data?.at(0)?.url ?? "";
      const b64_json = res.data?.at(0)?.b64_json ?? "";
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
      const b64_json = first?.b64_json || first?.b64 || "";
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
      | Record<string, unknown>;

    const isDalle3 = _isDalle3(options.config.model);
    const isImageModel = isImageGenerationModel(options.config.model);
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
    } else if (isImageModel && !isGeminiImagePreview) {
      const prompt = getMessageTextContent(
        options.messages.slice(-1)?.pop() as any,
      );
      requestPayload = {
        model: options.config.model,
        prompt,
        // URLs are only valid for 60 minutes after the image has been generated.
        response_format: "b64_json", // using b64_json, and save image in CacheStorage
        n: 1,
        size: options.config?.size ?? "1024x1024",
        quality: options.config?.quality ?? "standard",
        style: options.config?.style ?? "vivid",
      };
    } else {
      const visionModel = isVisionModel(options.config.model);
      const messages: ChatOptions["messages"] = [];
      for (const v of options.messages) {
        const content = visionModel
          ? await preProcessImageContent(v.content)
          : getMessageTextContent(v);
        if (!(isReasoningOpenAIModel && v.role === "system"))
          messages.push({ role: v.role, content });
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

      if (isGpt5) {
        // Remove max_tokens if present
        delete requestPayload.max_tokens;
        // Add max_completion_tokens (or max_completion_tokens if that's what you meant)
        requestPayload["max_completion_tokens"] = modelConfig.max_tokens;
      } else if (isReasoningOpenAIModel) {
        // by default the o1/o3 models will not attempt to produce output that includes markdown formatting
        // manually add "Formatting re-enabled" developer message to encourage markdown inclusion in model responses
        // (https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/reasoning?tabs=python-secure#markdown-output)
        requestPayload["messages"].unshift({
          role: "developer",
          content: "Formatting re-enabled",
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
      isGeminiImagePreview || (!isImageModel && !!options.config.stream);
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
            : isImageModel && !isGeminiImagePreview
            ? OpenaiPath.ImagePath
            : OpenaiPath.ChatPath,
        );
      }

      currentBaseUrl = currentBaseUrlForRequest;
      console.log("[Chat Request]", {
        provider: modelConfig.providerName,
        model: modelConfig.model,
        useCustomConfig: currentAccessState.useCustomConfig,
        baseUrl: currentBaseUrl,
        chatPath,
        stream: shouldStream,
      });

      if (shouldStream) {
        let index = -1;
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(
            useChatStore.getState().currentSession().mask?.plugin || [],
          );
        // console.log("getAsTools", tools, funcs);
        streamWithThink(
          chatPath,
          requestPayload,
          getHeaders(),
          tools as any,
          funcs,
          controller,
          // parseSSE
          (text: string, runTools: ChatMessageTool[]) => {
            // console.log("parseSSE", text, runTools);
            const json = JSON.parse(text);
            const choices = json.choices as Array<{
              delta: {
                content: string;
                tool_calls: ChatMessageTool[];
                reasoning_content: string | null;
                multi_mod_content?: Array<{
                  inlineData?: { mimeType?: string; data?: string };
                  inline_data?: { mime_type?: string; data?: string };
                }>;
              };
            }>;

            if (!choices?.length) return { isThinking: false, content: "" };

            const tool_calls = choices[0]?.delta?.tool_calls;
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
          options,
        );
      } else {
        const chatPayload = {
          method: "POST",
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
          headers: getHeaders(),
        };

        // make a fetch request
        const requestTimeoutId = setTimeout(
          () => controller.abort(),
          getTimeoutMSByModel(options.config.model),
        );

        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resText = await res.text();
        const resJson = parseJsonOrSSEPayload(resText);
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
