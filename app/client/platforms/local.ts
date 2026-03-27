"use client";
import { Local, ServiceProvider } from "@/app/constant";
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
import { RequestPayload } from "./openai";
import { fetch } from "@/app/utils/stream";
import { applyModelSamplingRules } from "../model-parameter-rules";

export class LocalApi implements LLMApi {
  private resolveBaseUrl(): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = "";

    if (accessStore.useCustomConfig) {
      // 从 apiProfiles 中查找 Local 配置
      const profile = accessStore.apiProfiles?.find(
        (p) => p.provider === ServiceProvider.Local && p.enabled,
      );
      baseUrl = profile?.baseUrl || "";
    }

    if (baseUrl.length === 0) {
      baseUrl = Local.ExampleEndpoint;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http")) {
      baseUrl = "https://" + baseUrl;
    }

    return baseUrl;
  }

  path(path: string): string {
    const baseUrl = this.resolveBaseUrl();

    console.log("[Local API Endpoint] ", baseUrl, path);

    return `/api/proxy/${path}`;
  }

  extractMessage(res: any) {
    return res.choices?.at(0)?.message?.content ?? "";
  }

  speech(options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  async chat(options: ChatOptions) {
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
        filteredMessages.push(msg);
      } else if (msg.role === "user") {
        filteredMessages.push(msg);
        hasFoundFirstUser = true;
      } else if (hasFoundFirstUser) {
        filteredMessages.push(msg);
      }
    }

    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
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
      },
    );

    console.log("[Request] Local API payload: ", requestPayload);

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const chatPath = this.path(Local.ChatPath);
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: getHeaders(),
      };

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
        return streamWithThink(
          chatPath,
          requestPayload,
          getHeaders(),
          tools as any,
          funcs,
          controller,
          (text: string, runTools: ChatMessageTool[]) => {
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
                runTools[index]["function"]["arguments"] += args;
              }
            }
            const reasoning = choices[0]?.delta?.reasoning_content;
            const content = choices[0]?.delta?.content;

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
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            requestPayload?.messages?.splice(
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
    try {
      const accessStore = useAccessStore.getState();
      const profile = accessStore.apiProfiles?.find(
        (p) => p.provider === ServiceProvider.Local && p.enabled,
      );

      if (!profile?.baseUrl) {
        return {
          used: 0,
          total: 0,
        };
      }

      const usagePath = this.path(Local.UsagePath);
      const res = await fetch(usagePath, {
        method: "GET",
        headers: getHeaders(),
      });

      if (!res.ok) {
        return {
          used: 0,
          total: 0,
        };
      }

      const data = await res.json();
      const remaining =
        typeof data?.remaining === "number" ? Number(data.remaining) : NaN;
      const monthlyLimit = Number(data?.subscription?.monthly_limit_usd);
      const monthlyUsage = Number(data?.subscription?.monthly_usage_usd);
      const weeklyLimit = Number(data?.subscription?.weekly_limit_usd);
      const weeklyUsage = Number(data?.subscription?.weekly_usage_usd);
      const dailyLimit = Number(data?.subscription?.daily_limit_usd);
      const dailyUsage = Number(data?.subscription?.daily_usage_usd);
      const totalActualCost = Number(data?.usage?.total?.actual_cost);

      // 优先使用 Sub2API 返回的剩余额度；若是不限额模式，则回退到各周期额度信息。
      if (Number.isFinite(remaining) && remaining >= 0) {
        return {
          used: 0,
          total: remaining,
        };
      }

      if (Number.isFinite(monthlyLimit) && monthlyLimit > 0) {
        return {
          used: Number.isFinite(monthlyUsage) ? monthlyUsage : 0,
          total: monthlyLimit,
        };
      }

      if (Number.isFinite(weeklyLimit) && weeklyLimit > 0) {
        return {
          used: Number.isFinite(weeklyUsage) ? weeklyUsage : 0,
          total: weeklyLimit,
        };
      }

      if (Number.isFinite(dailyLimit) && dailyLimit > 0) {
        return {
          used: Number.isFinite(dailyUsage) ? dailyUsage : 0,
          total: dailyLimit,
        };
      }

      if (Number.isFinite(totalActualCost) && totalActualCost >= 0) {
        return {
          used: totalActualCost,
          total: totalActualCost,
        };
      }

      return {
        used: data.used || 0,
        total: data.total || 0,
      };
    } catch (e) {
      console.error("[Local API] failed to fetch usage", e);
      return {
        used: 0,
        total: 0,
      };
    }
  }

  async models(): Promise<LLMModel[]> {
    try {
      const accessStore = useAccessStore.getState();
      const profile = accessStore.apiProfiles?.find(
        (p) => p.provider === ServiceProvider.Local && p.enabled,
      );

      if (!profile?.baseUrl) {
        console.error("[Local API] No enabled Local profile found");
        return [];
      }

      const modelsPath = this.path(Local.ListModelPath);
      const normalizedBaseUrl = this.resolveBaseUrl();

      // 直接使用 profile 的 API Key 构建请求头
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-base-url": normalizedBaseUrl,
      };

      if (profile.apiKey) {
        headers["Authorization"] = `Bearer ${profile.apiKey}`;
      }

      console.log("[Local API] Fetching models from:", modelsPath);

      const res = await fetch(modelsPath, {
        method: "GET",
        headers,
      });

      if (!res.ok) {
        console.error(
          "[Local API] Failed to fetch models:",
          res.status,
          res.statusText,
        );
        return [];
      }

      const data = await res.json();
      console.log("[Local API] Models response:", data);

      // 根据 API 响应格式解析模型列表
      const models = data.data || [];
      return models.map((m: any) => ({
        id: m.id,
        name: m.id,
        provider: "Local",
      }));
    } catch (e) {
      console.error("[Local API] failed to fetch models", e);
      return [];
    }
  }
}
