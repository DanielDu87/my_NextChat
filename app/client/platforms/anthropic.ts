import { Anthropic, ApiPath } from "@/app/constant";
import { ChatOptions, getHeaders, LLMApi, SpeechOptions } from "../api";
import type { ChatMessageTool } from "@/app/store/chat";
import { useChatStore } from "@/app/store/chat";
import { useAccessStore } from "@/app/store/access";
import { useAppConfig } from "@/app/store/config";
import { usePluginStore } from "@/app/store/plugin";
import { getClientConfig } from "@/app/config/client";
import { ANTHROPIC_BASE_URL } from "@/app/constant";
import { getMessageTextContent, isVisionModel } from "@/app/utils";
import { preProcessImageContent, stream } from "@/app/utils/chat";
import { cloudflareAIGatewayUrl } from "@/app/utils/cloudflare";
import { RequestPayload } from "./openai";
import { fetch } from "@/app/utils/stream";
import {
  applyModelSamplingRules,
  getModelParameterSupport,
  normalizeToolChoiceForModel,
  parseStopSequences,
} from "../model-parameter-rules";
import { getDefaultReasoningSettings } from "../model-parameter-rules";
import { joinUrlPath } from "@/app/utils/url";

export type MultiBlockContent = {
  type: "image" | "text";
  source?: {
    type: string;
    media_type: string;
    data: string;
  };
  text?: string;
  cache_control?: {
    type: "ephemeral";
  };
};

type AnthropicSystemBlock = {
  type: "text";
  text: string;
  cache_control?: {
    type: "ephemeral";
  };
};

export type AnthropicMessage = {
  role: (typeof ClaudeMapper)[keyof typeof ClaudeMapper];
  content: string | MultiBlockContent[];
};

export interface AnthropicChatRequest {
  model: string; // The model that will complete your prompt.
  messages: AnthropicMessage[]; // The prompt that you want Claude to complete.
  system?: AnthropicSystemBlock[];
  max_tokens: number; // The maximum number of tokens to generate before stopping.
  stop_sequences?: string[]; // Sequences that will cause the model to stop generating completion text.
  temperature?: number; // Amount of randomness injected into the response.
  top_p?: number; // Use nucleus sampling.
  top_k?: number; // Only sample from the top K options for each subsequent token.
  metadata?: object; // An object describing metadata about the request.
  stream?: boolean; // Whether to incrementally stream the response using server-sent events.
  thinking?: {
    type: "enabled" | "adaptive";
    budget_tokens?: number;
  };
  output_config?: {
    effort?: string;
    format?: {
      type: "json_schema";
      schema: Record<string, unknown>;
    };
  };
  tool_choice?: {
    type: "auto" | "any" | "none";
  };
}

export interface ChatRequest {
  model: string; // The model that will complete your prompt.
  prompt: string; // The prompt that you want Claude to complete.
  max_tokens_to_sample: number; // The maximum number of tokens to generate before stopping.
  stop_sequences?: string[]; // Sequences that will cause the model to stop generating completion text.
  temperature?: number; // Amount of randomness injected into the response.
  top_p?: number; // Use nucleus sampling.
  top_k?: number; // Only sample from the top K options for each subsequent token.
  metadata?: object; // An object describing metadata about the request.
  stream?: boolean; // Whether to incrementally stream the response using server-sent events.
}

export interface ChatResponse {
  completion: string;
  stop_reason: "stop_sequence" | "max_tokens";
  model: string;
}

export type ChatStreamResponse = ChatResponse & {
  stop?: string;
  log_id: string;
};

const ClaudeMapper = {
  assistant: "assistant",
  user: "user",
  system: "user",
} as const;

const keys = ["claude-2, claude-instant-1"];

function mapReasoningEffortToBudgetTokens(effort: string) {
  const normalized = effort.trim().toLowerCase();
  const mapping: Record<string, number> = {
    minimal: 1024,
    low: 1024,
    medium: 8192,
    high: 24576,
  };
  return mapping[normalized] ?? 0;
}

function supportsAnthropicEffort(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    lowerModel.includes("claude-opus-4-5") ||
    lowerModel.includes("claude-opus-4-6") ||
    lowerModel.includes("claude-opus-4-7") ||
    lowerModel.includes("claude-opus-4-8") ||
    lowerModel.includes("claude-sonnet-4-6") ||
    /claude-(?:opus|sonnet)-[5-9]/.test(lowerModel) ||
    lowerModel.includes("claude-fable-") ||
    lowerModel.includes("claude-mythos")
  );
}

function usesAnthropicAdaptiveThinking(model: string) {
  const lowerModel = model.toLowerCase();
  return (
    /claude-opus-4-(?:6|7|8)/.test(lowerModel) ||
    /claude-sonnet-(?:4-6|[5-9])/.test(lowerModel) ||
    lowerModel.includes("claude-fable-") ||
    lowerModel.includes("claude-mythos")
  );
}

export class ClaudeApi implements LLMApi {
  speech(options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  extractMessage(res: any) {
    console.log("[Response] claude response: ", res);

    return res?.content?.[0]?.text;
  }
  async chat(options: ChatOptions): Promise<void> {
    const visionModel = isVisionModel(options.config.model);

    const accessStore = useAccessStore.getState();

    const shouldStream = !!options.config.stream;

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

    // try get base64image from local cache image_url
    const messages: ChatOptions["messages"] = [];
    for (const v of options.messages) {
      const content = await preProcessImageContent(v.content);
      messages.push({ role: v.role, content });
    }

    const keys = ["system", "user"];

    // roles must alternate between "user" and "assistant" in claude, so add a fake assistant message between two user messages
    for (let i = 0; i < messages.length - 1; i++) {
      const message = messages[i];
      const nextMessage = messages[i + 1];

      if (keys.includes(message.role) && keys.includes(nextMessage.role)) {
        messages[i] = [
          message,
          {
            role: "assistant",
            content: ";",
          },
        ] as any;
      }
    }

    const system = messages
      .filter((message) => message.role === "system")
      .map((message) => ({
        type: "text" as const,
        text: getMessageTextContent(message),
      }))
      .filter((message) => message.text.trim());

    const prompt = messages
      .filter((message) => message.role !== "system")
      .flat()
      .filter((v) => {
        if (!v.content) return false;
        if (typeof v.content === "string" && !v.content.trim()) return false;
        return true;
      })
      .map((v) => {
        const { role, content } = v;
        const insideRole = ClaudeMapper[role] ?? "user";

        if (!visionModel || typeof content === "string") {
          return {
            role: insideRole,
            content: getMessageTextContent(v),
          };
        }
        return {
          role: insideRole,
          content: content
            .filter((v) => v.image_url || v.text)
            .map(({ type, text, image_url }) => {
              if (type === "text") {
                return {
                  type,
                  text: text!,
                };
              }
              const { url = "" } = image_url || {};
              const colonIndex = url.indexOf(":");
              const semicolonIndex = url.indexOf(";");
              const comma = url.indexOf(",");

              const mimeType = url.slice(colonIndex + 1, semicolonIndex);
              const encodeType = url.slice(semicolonIndex + 1, comma);
              const data = url.slice(comma + 1);

              return {
                type: "image" as const,
                source: {
                  type: encodeType,
                  media_type: mimeType,
                  data,
                },
              };
            }),
        };
      });

    if (prompt[0]?.role === "assistant") {
      prompt.unshift({
        role: "user",
        content: ";",
      });
    }

    const requestBody: AnthropicChatRequest = applyModelSamplingRules(
      modelConfig.model,
      {
        messages: prompt,
        ...(system.length > 0 ? { system } : {}),
        stream: shouldStream,

        model: modelConfig.model,
        max_tokens: modelConfig.max_tokens,
        temperature: modelConfig.temperature,
        top_p: modelConfig.top_p,
      },
    );
    const parameterSupport = getModelParameterSupport(modelConfig.model);
    const stopSequences = parseStopSequences(
      modelConfig.stopSequences,
      parameterSupport.stop_sequence_limit,
    );
    if (stopSequences.length > 0) {
      requestBody.stop_sequences = stopSequences;
    }
    if (options.config.stream) {
      const toolChoice = normalizeToolChoiceForModel(
        modelConfig.model,
        modelConfig.toolChoice,
      );
      requestBody.tool_choice = {
        type: toolChoice === "required" ? "any" : toolChoice,
      };
    }
    if (parameterSupport.prompt_cache && modelConfig.promptCache !== false) {
      // Anthropic only accepts cache_control on a content block. Pin the
      // stable global system prefix instead of caching an entire conversation.
      const cacheTarget = requestBody.system?.at(-1);
      if (cacheTarget) {
        cacheTarget.cache_control = { type: "ephemeral" };
      }
    }

    const reasoningSettings = getDefaultReasoningSettings(
      modelConfig.model,
      modelConfig.max_tokens,
      modelConfig.reasoningEffort,
      modelConfig.reasoningMaxTokens,
    );
    const normalizedReasoningEffort = String(
      reasoningSettings.reasoningEffort || "",
    )
      .trim()
      .toLowerCase();
    const reasoningBudget =
      (reasoningSettings.reasoningMaxTokens ?? 0) > 0
        ? reasoningSettings.reasoningMaxTokens
        : mapReasoningEffortToBudgetTokens(normalizedReasoningEffort);

    if (
      normalizedReasoningEffort &&
      supportsAnthropicEffort(modelConfig.model)
    ) {
      requestBody.output_config = {
        effort: normalizedReasoningEffort,
      };
    }

    if (
      parameterSupport.structured_output_mode === "json_schema" &&
      modelConfig.structuredOutput &&
      modelConfig.jsonSchema?.trim()
    ) {
      let schema: Record<string, unknown>;
      try {
        schema = JSON.parse(modelConfig.jsonSchema);
      } catch {
        options.onError?.(
          new Error("JSON Schema 格式不正确，请检查结构化输出配置"),
        );
        return;
      }
      requestBody.output_config = {
        ...requestBody.output_config,
        format: {
          type: "json_schema",
          schema,
        },
      };
    }

    if (usesAnthropicAdaptiveThinking(modelConfig.model)) {
      requestBody.thinking = {
        type: "adaptive",
      };
    } else if (reasoningBudget > 0) {
      requestBody.thinking = {
        type: "enabled",
        budget_tokens: reasoningBudget,
      };
      if (requestBody.max_tokens <= reasoningBudget) {
        requestBody.max_tokens = reasoningBudget + 1;
      }
    }

    const requestHeaders = {
      ...getHeaders(),
      "anthropic-version": accessStore.anthropicApiVersion,
      ...(modelConfig.anthropicBeta?.trim()
        ? { "anthropic-beta": modelConfig.anthropicBeta.trim() }
        : {}),
    };

    const path = this.path(Anthropic.ChatPath);

    const controller = new AbortController();
    options.onController?.(controller);

    if (shouldStream) {
      let index = -1;
      let latestReasoningText = "";
      const [tools, funcs] = usePluginStore
        .getState()
        .getAsTools(
          useChatStore.getState().currentSession().mask?.plugin || [],
        );
      const streamOptions = {
        ...options,
        onFinish(message: string, responseRes: Response) {
          if (modelConfig.includeThoughts && latestReasoningText.trim()) {
            (responseRes as any).__reasoning_details = {
              type: "thinking",
              thinking: latestReasoningText,
            };
          }
          options.onFinish(message, responseRes);
        },
      };
      return stream(
        path,
        requestBody,
        requestHeaders,
        // @ts-ignore
        tools.map((tool) => ({
          name: tool?.function?.name,
          description: tool?.function?.description,
          input_schema: tool?.function?.parameters,
        })),
        funcs,
        controller,
        // parseSSE
        (text: string, runTools: ChatMessageTool[]) => {
          // console.log("parseSSE", text, runTools);
          let chunkJson:
            | undefined
            | {
                type:
                  | "content_block_delta"
                  | "content_block_stop"
                  | "message_delta"
                  | "message_stop";
                content_block?: {
                  type: "tool_use";
                  id: string;
                  name: string;
                };
                delta?: {
                  type: "text_delta" | "input_json_delta" | "thinking_delta";
                  text?: string;
                  thinking?: string;
                  partial_json?: string;
                  stop_reason?: string;
                };
                index: number;
              };
          chunkJson = JSON.parse(text);

          // Handle refusal stop reason in message_delta
          if (chunkJson?.delta?.stop_reason === "refusal") {
            // Return a message to display to the user
            const refusalMessage =
              "\n\n[Assistant refused to respond. Please modify your request and try again.]";
            options.onError?.(
              new Error("Content policy violation: " + refusalMessage),
            );
            return refusalMessage;
          }

          if (chunkJson?.content_block?.type == "tool_use") {
            index += 1;
            const id = chunkJson?.content_block.id;
            const name = chunkJson?.content_block.name;
            runTools.push({
              id,
              type: "function",
              function: {
                name,
                arguments: "",
              },
            });
          }
          if (
            chunkJson?.delta?.type == "input_json_delta" &&
            chunkJson?.delta?.partial_json
          ) {
            // @ts-ignore
            runTools[index]["function"]["arguments"] +=
              chunkJson?.delta?.partial_json;
          }
          if (
            chunkJson?.delta?.type === "thinking_delta" &&
            (chunkJson?.delta?.thinking || chunkJson?.delta?.text)
          ) {
            latestReasoningText +=
              chunkJson?.delta?.thinking || chunkJson?.delta?.text || "";
          }
          return chunkJson?.delta?.text;
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
            {
              role: "assistant",
              content: toolCallMessage.tool_calls.map(
                (tool: ChatMessageTool) => ({
                  type: "tool_use",
                  id: tool.id,
                  name: tool?.function?.name,
                  input: tool?.function?.arguments
                    ? JSON.parse(tool?.function?.arguments)
                    : {},
                }),
              ),
            },
            // @ts-ignore
            ...toolCallResult.map((result) => ({
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: result.tool_call_id,
                  content: result.content,
                },
              ],
            })),
          );
        },
        streamOptions,
      );
    } else {
      const payload = {
        method: "POST",
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        headers: {
          ...requestHeaders,
          // do not send `anthropicApiKey` in browser!!!
          // Authorization: getAuthKey(accessStore.anthropicApiKey),
        },
      };

      try {
        controller.signal.onabort = () =>
          options.onFinish("", new Response(null, { status: 400 }));

        const res = await fetch(path, payload);
        const resJson = await res.json();
        const thinkingContent = Array.isArray(resJson?.content)
          ? resJson.content
              .filter((item: any) => item?.type === "thinking")
              .map((item: any) => item?.thinking || item?.text || "")
              .join("")
          : "";
        if (modelConfig.includeThoughts && thinkingContent.trim()) {
          (res as any).__reasoning_details = {
            type: "thinking",
            thinking: thinkingContent,
          };
        }

        const message = this.extractMessage(resJson);
        options.onFinish(message, res);
      } catch (e) {
        console.error("failed to chat", e);
        options.onError?.(e as Error);
      }
    }
  }
  async usage() {
    return {
      used: 0,
      total: 0,
    };
  }
  async models() {
    // const provider = {
    //   id: "anthropic",
    //   providerName: "Anthropic",
    //   providerType: "anthropic",
    // };

    return [
      // {
      //   name: "claude-instant-1.2",
      //   available: true,
      //   provider,
      // },
      // {
      //   name: "claude-2.0",
      //   available: true,
      //   provider,
      // },
      // {
      //   name: "claude-2.1",
      //   available: true,
      //   provider,
      // },
      // {
      //   name: "claude-3-opus-20240229",
      //   available: true,
      //   provider,
      // },
      // {
      //   name: "claude-3-sonnet-20240229",
      //   available: true,
      //   provider,
      // },
      // {
      //   name: "claude-3-haiku-20240307",
      //   available: true,
      //   provider,
      // },
    ];
  }
  path(path: string): string {
    const accessStore = useAccessStore.getState();

    let baseUrl: string = "";

    if (accessStore.useCustomConfig) {
      baseUrl = accessStore.anthropicUrl;
    }

    // if endpoint is empty, use default endpoint
    if (baseUrl.trim().length === 0) {
      const isApp = !!getClientConfig()?.isApp;

      baseUrl = isApp ? ANTHROPIC_BASE_URL : ApiPath.Anthropic;
    }

    if (!baseUrl.startsWith("http") && !baseUrl.startsWith("/api")) {
      baseUrl = "https://" + baseUrl;
    }

    baseUrl = trimEnd(baseUrl, "/");

    // try rebuild url, when using cloudflare ai gateway in client
    return cloudflareAIGatewayUrl(joinUrlPath(baseUrl, path));
  }
}

function trimEnd(s: string, end = " ") {
  if (end.length === 0) return s;

  while (s.endsWith(end)) {
    s = s.slice(0, -end.length);
  }

  return s;
}
