"use client";
import { ApiPath, Alibaba, ALIBABA_BASE_URL } from "@/app/constant";
import type { ChatMessageTool } from "@/app/store/chat";
import { useChatStore } from "@/app/store/chat";
import { useAccessStore } from "@/app/store/access";
import { useAppConfig } from "@/app/store/config";
import { usePluginStore } from "@/app/store/plugin";
import {
  preProcessImageContentForAlibabaDashScope,
  streamWithThink,
} from "@/app/utils/chat";
import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  SpeechOptions,
  MultimodalContent,
  MultimodalContentForAlibaba,
} from "../api";
import { getClientConfig } from "@/app/config/client";
import {
  getMessageTextContent,
  getMessageTextContentWithoutThinking,
  getTimeoutMSByModel,
  isVisionModel,
} from "@/app/utils";
import {
  applyModelSamplingRules,
  getModelParameterSupport,
  normalizeToolChoiceForModel,
  parseStopSequences,
} from "../model-parameter-rules";
import { fetch } from "@/app/utils/stream";
import { joinChatUrl } from "@/app/utils/url";

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

interface RequestInput {
  messages: {
    role: "system" | "user" | "assistant";
    content: string | MultimodalContent[];
  }[];
}
interface RequestParam {
  result_format: string;
  incremental_output?: boolean;
  temperature: number;
  repetition_penalty?: number;
  top_p: number;
  max_tokens?: number;
  stop?: string[];
  enable_thinking?: boolean;
  thinking_budget?: number;
  response_format?: { type: "json_object" };
  tools?: unknown[];
  tool_choice?: "auto" | "none";
}
interface RequestPayload {
  model: string;
  input: RequestInput;
  parameters: RequestParam;
}

export class QwenApi implements LLMApi {
  path(path: string, requestBaseUrl?: string): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = String(requestBaseUrl || "").trim();

    if (!baseUrl && accessStore.useCustomConfig) {
      baseUrl = accessStore.alibabaUrl;
    }

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      baseUrl = isApp ? ALIBABA_BASE_URL : ApiPath.Alibaba;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.Alibaba)) {
      baseUrl = "https://" + baseUrl;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);

    return joinChatUrl(baseUrl, path);
  }

  extractMessage(res: any) {
    return res?.output?.choices?.at(0)?.message?.content ?? "";
  }

  speech(options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  async chat(options: ChatOptions) {
    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...options.config,
      ...(options.config.outputTokenLimit
        ? { max_tokens: options.config.outputTokenLimit }
        : {}),
      ...{
        model: options.config.model,
      },
    };

    const visionModel = isVisionModel(options.config.model);

    const messages: ChatOptions["messages"] = [];
    for (const v of options.messages) {
      const content = (
        visionModel
          ? await preProcessImageContentForAlibabaDashScope(v.content)
          : v.role === "assistant"
            ? getMessageTextContentWithoutThinking(v)
            : getMessageTextContent(v)
      ) as any;

      messages.push({ role: v.role, content });
    }

    const shouldStream = !!options.config.stream;
    const parameterSupport = getModelParameterSupport(modelConfig.model);
    const thinkingDisabled = ["none", "minimal"].includes(
      String(modelConfig.reasoningEffort || "").toLowerCase(),
    );
    const requestPayload: RequestPayload = {
      model: modelConfig.model,
      input: {
        messages,
      },
      parameters: applyModelSamplingRules(modelConfig.model, {
        result_format: "message",
        incremental_output: shouldStream,
        temperature: modelConfig.temperature,
        max_tokens: modelConfig.max_tokens,
        top_p: modelConfig.top_p,
      }),
    };

    const stopSequences = parseStopSequences(
      modelConfig.stopSequences,
      parameterSupport.stop_sequence_limit,
    );
    if (parameterSupport.stop_sequences && stopSequences.length > 0) {
      requestPayload.parameters.stop = stopSequences;
    }
    if (parameterSupport.reasoning) {
      requestPayload.parameters.enable_thinking = !thinkingDisabled;
      if (
        !thinkingDisabled &&
        parameterSupport.reasoning_max_tokens &&
        modelConfig.reasoningMaxTokens > 0
      ) {
        requestPayload.parameters.thinking_budget =
          modelConfig.reasoningMaxTokens;
      }
    }
    if (
      parameterSupport.structured_output_mode === "json_object" &&
      modelConfig.structuredOutput
    ) {
      requestPayload.parameters.response_format = { type: "json_object" };
      // DashScope JSON mode rejects enable_thinking=true.
      requestPayload.parameters.enable_thinking = false;
    }

    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const headers = {
        ...getHeaders(
          false,
          modelConfig,
          options.disableAutoFallback,
          options.requestApiKey,
        ),
        "X-DashScope-SSE": shouldStream ? "enable" : "disable",
      };

      const chatPath = this.path(
        Alibaba.ChatPath(modelConfig.model),
        options.requestBaseUrl,
      );
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: headers,
      };

      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        getTimeoutMSByModel(options.config.model),
      );

      if (shouldStream) {
        const [tools, funcs] = usePluginStore
          .getState()
          .getAsTools(
            useChatStore.getState().currentSession().mask?.plugin || [],
          );
        if (parameterSupport.tool_choice && tools.length > 0) {
          requestPayload.parameters.tools = tools;
          requestPayload.parameters.tool_choice = normalizeToolChoiceForModel(
            modelConfig.model,
            modelConfig.toolChoice,
          ) as "auto" | "none";
        }
        return streamWithThink(
          chatPath,
          requestPayload,
          headers,
          [],
          funcs,
          controller,
          // parseSSE
          (text: string, runTools: ChatMessageTool[]) => {
            // console.log("parseSSE", text, runTools);
            const json = JSON.parse(text);
            const choices = json.output.choices as Array<{
              message: {
                content: string | null | MultimodalContentForAlibaba[];
                tool_calls: ChatMessageTool[];
                reasoning_content: string | null;
              };
            }>;

            if (!choices?.length) return { isThinking: false, content: "" };

            const tool_calls = choices[0]?.message?.tool_calls;
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

            const reasoning = choices[0]?.message?.reasoning_content;
            const content = choices[0]?.message?.content;

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
                content: Array.isArray(content)
                  ? content.map((item) => item.text).join(",")
                  : content,
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
            requestPayload?.input?.messages?.splice(
              requestPayload?.input?.messages?.length,
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
export { Alibaba };
