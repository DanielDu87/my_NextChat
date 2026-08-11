"use client";
// azure and openai, using same models. so using same LLMApi.
import {
  ApiPath,
  DEEPSEEK_BASE_URL,
  DeepSeek,
  ServiceProvider,
} from "@/app/constant";
import type { ChatMessageTool } from "@/app/store/chat";
import { useChatStore } from "@/app/store/chat";
import { useAccessStore } from "@/app/store/access";
import { useAppConfig } from "@/app/store/config";
import { usePluginStore } from "@/app/store/plugin";
import { streamWithThink } from "@/app/utils/chat";
import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  SpeechOptions,
} from "../api";
import { getClientConfig } from "@/app/config/client";
import {
  getMessageTextContent,
  getMessageTextContentWithoutThinking,
  getTimeoutMSByModel,
} from "@/app/utils";
import { ChatGPTApi, RequestPayload } from "./openai";
import { fetch } from "@/app/utils/stream";
import {
  applyModelSamplingRules,
  getModelParameterSupport,
  isDeepSeekV4Model,
  normalizeToolChoiceForModel,
  parseStopSequences,
} from "../model-parameter-rules";
import { joinChatUrl } from "@/app/utils/url";
import { getEffectiveProviderBaseUrl } from "@/app/utils/provider-url";

function isOfficialDeepSeekApiBaseUrl(baseUrl?: string) {
  try {
    return new URL(String(baseUrl || "")).hostname === "api.deepseek.com";
  } catch {
    return false;
  }
}

function buildProxyChatEndpoint(chatPath: string) {
  try {
    const upstream = new URL(chatPath);
    return {
      chatPath: `/api/proxy/${upstream.pathname.replace(/^\/+/, "")}${upstream.search}`,
      baseUrl: upstream.origin,
    };
  } catch {
    return undefined;
  }
}

export class DeepSeekApi implements LLMApi {
  private disableListModels = true;

  path(path: string, requestBaseUrl?: string): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = String(requestBaseUrl || "").trim();

    if (!baseUrl && accessStore.useCustomConfig) {
      baseUrl = getEffectiveProviderBaseUrl(
        "DeepSeek",
        accessStore.deepseekUrl,
      );
    }

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      const apiPath = ApiPath.DeepSeek;
      baseUrl = isApp ? DEEPSEEK_BASE_URL : apiPath;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.DeepSeek)) {
      baseUrl = "https://" + baseUrl;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);

    return joinChatUrl(baseUrl, path);
  }

  extractMessage(res: any) {
    return res.choices?.at(0)?.message?.content ?? "";
  }

  speech(options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  async chat(options: ChatOptions) {
    // 官方 DeepSeek 的聊天接口是 OpenAI 兼容接口。复用配置页“测试对话”
    // 已验证的代理与请求构造，避免专用旧实现与官方端点出现字段差异。
    if (isOfficialDeepSeekApiBaseUrl(options.requestBaseUrl)) {
      return new ChatGPTApi().chat({
        ...options,
        config: {
          ...options.config,
          providerName: ServiceProvider.Custom,
        },
        disablePlugins: true,
      });
    }

    const messages: ChatOptions["messages"] = [];
    for (const v of options.messages) {
      if (v.role === "assistant") {
        const content = getMessageTextContentWithoutThinking(v);
        messages.push({ role: v.role, content });
      } else {
        const content = getMessageTextContent(v);
        messages.push({ role: v.role, content });
      }
    }

    // 检测并修复消息顺序，确保除system外的第一个消息是user
    const filteredMessages: ChatOptions["messages"] = [];
    let hasFoundFirstUser = false;

    for (const msg of messages) {
      if (msg.role === "system") {
        // Keep all system messages
        filteredMessages.push(msg);
      } else if (msg.role === "user") {
        // User message directly added
        filteredMessages.push(msg);
        hasFoundFirstUser = true;
      } else if (hasFoundFirstUser) {
        // After finding the first user message, all subsequent non-system messages are retained.
        filteredMessages.push(msg);
      }
      // If hasFoundFirstUser is false and it is not a system message, it will be skipped.
    }

    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...options.config,
      ...(options.config.outputTokenLimit
        ? { max_tokens: options.config.outputTokenLimit }
        : {}),
      ...{
        model: options.config.model,
        providerName: options.config.providerName,
      },
    };

    const requestPayload: RequestPayload = applyModelSamplingRules(
      modelConfig.model,
      {
        messages: filteredMessages,
        stream: options.config.stream,
        model: modelConfig.model,
        temperature: modelConfig.temperature,
        presence_penalty: modelConfig.presence_penalty,
        frequency_penalty: modelConfig.frequency_penalty,
        top_p: modelConfig.top_p,
        max_tokens: modelConfig.max_tokens,
      },
    );

    const parameterSupport = getModelParameterSupport(modelConfig.model);
    const stopSequences = parseStopSequences(
      modelConfig.stopSequences,
      parameterSupport.stop_sequence_limit,
    );
    if (parameterSupport.stop_sequences && stopSequences.length > 0) {
      requestPayload.stop = stopSequences;
    }
    if (parameterSupport.tool_choice && options.config.stream) {
      requestPayload.tool_choice = normalizeToolChoiceForModel(
        modelConfig.model,
        modelConfig.toolChoice,
      );
    }
    // 官方 DeepSeek 的 OpenAI 兼容端点只接收其公开支持的标准字段。
    // `deepseek-v4-*` 等本地模型别名在部分账户下会拒绝私有 thinking 参数，
    // 因而保持普通对话与配置页测试一致的基础请求格式。
    if (
      parameterSupport.reasoning &&
      isDeepSeekV4Model(modelConfig.model) &&
      !isOfficialDeepSeekApiBaseUrl(options.requestBaseUrl)
    ) {
      const requestedEffort = String(modelConfig.reasoningEffort || "")
        .trim()
        .toLowerCase();
      const thinkingDisabled = ["none", "minimal"].includes(requestedEffort);
      requestPayload["thinking"] = {
        type: thinkingDisabled ? "disabled" : "enabled",
      };
      if (!thinkingDisabled && requestedEffort) {
        requestPayload["reasoning_effort"] = ["max", "xhigh"].includes(
          requestedEffort,
        )
          ? "max"
          : "high";
      }
    }

    if (
      parameterSupport.structured_output_mode === "json_object" &&
      modelConfig.structuredOutput
    ) {
      (requestPayload as any)["response_format"] = {
        type: "json_object",
      };
    }

    console.log("[Request] openai payload: ", requestPayload);

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const directChatPath = this.path(
        DeepSeek.ChatPath,
        options.requestBaseUrl,
      );
      const proxyEndpoint = buildProxyChatEndpoint(directChatPath);
      const chatPath = proxyEndpoint?.chatPath || directChatPath;
      const requestHeaders = {
        ...getHeaders(
          false,
          modelConfig,
          options.disableAutoFallback,
          options.requestApiKey,
        ),
        ...(proxyEndpoint ? { "x-base-url": proxyEndpoint.baseUrl } : {}),
      };
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: requestHeaders,
      };

      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        getTimeoutMSByModel(options.config.model),
      );

      if (shouldStream) {
        // DeepSeek 官方端点会拒绝当前内置插件中不兼容的工具 schema；普通
        // 对话先按官方基础协议请求，避免工具定义使整次聊天在建立流前返回 400。
        const disablePlugins =
          options.disablePlugins ||
          isOfficialDeepSeekApiBaseUrl(options.requestBaseUrl);
        const [tools, funcs] = disablePlugins
          ? [[], {}]
          : usePluginStore
              .getState()
              .getAsTools(
                useChatStore.getState().currentSession().mask?.plugin || [],
              );
        return streamWithThink(
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
            const choices = json.choices as Array<{
              delta: {
                content: string | null;
                tool_calls: ChatMessageTool[];
                reasoning_content: string | null;
              };
            }>;
            const tool_calls = choices[0]?.delta?.tool_calls;
            if (tool_calls?.length > 0) {
              const index = tool_calls[0]?.index;
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
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

            // Skip if both content and reasoning_content are empty or null
            if (
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
        const res = await fetch(chatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = this.extractMessage(resJson);
        options.onFinish(message, res);
      }
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }
  async usage() {
    return {
      used: 0,
      total: 0,
    };
  }

  async models(): Promise<LLMModel[]> {
    return [];
  }
}
