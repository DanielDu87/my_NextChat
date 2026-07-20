"use client";
import { Local, ServiceProvider } from "@/app/constant";
import type { ChatMessageTool } from "@/app/store/chat";
import { useChatStore } from "@/app/store/chat";
import { useAccessStore } from "@/app/store/access";
import { useAppConfig } from "@/app/store/config";
import { usePluginStore } from "@/app/store/plugin";
import { streamWithThink } from "@/app/utils/chat";
import { ChatOptions, LLMApi, LLMModel, LLMUsage, SpeechOptions } from "../api";
import {
  getMessageTextContent,
  getMessageTextContentWithoutThinking,
  getTimeoutMSByModel,
} from "@/app/utils";
import { RequestPayload } from "./openai";
import { fetch } from "@/app/utils/stream";
import { applyModelSamplingRules } from "../model-parameter-rules";

function normalizeSub2ApiBaseUrl(baseUrl: string) {
  const normalizedBaseUrl = String(baseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!normalizedBaseUrl) return "";

  try {
    const url = new URL(
      normalizedBaseUrl.startsWith("http")
        ? normalizedBaseUrl
        : `https://${normalizedBaseUrl}`,
    );
    const hostname = url.hostname.toLowerCase();
    if (hostname === "sub2api.ngpt.chat") {
      url.protocol = "http:";
      url.host = "127.0.0.1:8080";
      return url.toString().replace(/\/+$/, "");
    }
    return url.toString().replace(/\/+$/, "");
  } catch {
    return normalizedBaseUrl.startsWith("http")
      ? normalizedBaseUrl
      : `https://${normalizedBaseUrl}`;
  }
}

export class LocalApi implements LLMApi {
  private getCurrentProfile() {
    const accessStore = useAccessStore.getState();
    return accessStore.apiProfiles?.find(
      (p) => p.provider === ServiceProvider.Local && p.enabled,
    );
  }

  private resolveBaseUrl(): string {
    let baseUrl = "";
    const profile = this.getCurrentProfile();
    baseUrl = profile?.baseUrl || "";

    if (baseUrl.length === 0) {
      baseUrl = Local.ExampleEndpoint;
    }
    return normalizeSub2ApiBaseUrl(baseUrl);
  }

  private buildHeaders() {
    const profile = this.getCurrentProfile();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-base-url": this.resolveBaseUrl(),
    };

    const defaultGroupApiKey = String(
      profile?.apiKeyGroups?.default || "",
    ).trim();
    const apiKey = String(defaultGroupApiKey || profile?.apiKey || "").trim();

    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    return { headers, profile };
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

    console.log("[Request] Local API payload: ", requestPayload);

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    try {
      const chatPath = this.path(Local.ChatPath);
      const { headers } = this.buildHeaders();
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers,
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
          headers,
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
              const args = tool_calls[0]?.function?.arguments ?? "";
              const targetTool =
                typeof index === "number" ? runTools[index] : undefined;
              if (id) {
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else if (targetTool?.function?.arguments !== undefined) {
                targetTool.function.arguments += args;
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

  async usage(): Promise<LLMUsage> {
    try {
      const { headers, profile } = this.buildHeaders();

      if (!profile?.baseUrl) {
        return {
          used: 0,
          total: 0,
        };
      }

      const usagePath = this.path(Local.UsagePath);
      const res = await fetch(usagePath, {
        method: "GET",
        headers,
      });

      if (!res.ok) {
        console.warn("[Local API] usage 查询失败", {
          status: res.status,
          statusText: res.statusText,
          baseUrl: profile.baseUrl,
        });
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
      const totalCost = Number(data?.usage?.total?.cost);
      const totalRequests = Number(data?.usage?.total?.requests);
      const totalTokens = Number(data?.usage?.total?.total_tokens);

      // Local/Sub2API 在聊天页展示的是“总使用量”，优先取累计消费。
      if (Number.isFinite(totalActualCost) && totalActualCost > 0) {
        return {
          used: totalActualCost,
          total: totalActualCost,
          metricType: "currency" as const,
          displayValue: totalActualCost,
          displayLabel: `${profile.name || "Sub2API"} 累计消费`,
        };
      }

      if (Number.isFinite(totalCost) && totalCost > 0) {
        return {
          used: totalCost,
          total: totalCost,
          metricType: "currency" as const,
          displayValue: totalCost,
          displayLabel: `${profile.name || "Sub2API"} 累计消费`,
        };
      }

      if (Number.isFinite(totalRequests) && totalRequests > 0) {
        return {
          used: totalRequests,
          total: totalRequests,
          metricType: "requests" as const,
          displayValue: totalRequests,
          displayLabel: `${profile.name || "Sub2API"} 累计请求数`,
        };
      }

      if (Number.isFinite(totalTokens) && totalTokens > 0) {
        return {
          used: totalTokens,
          total: totalTokens,
          metricType: "tokens" as const,
          displayValue: totalTokens,
          displayLabel: `${profile.name || "Sub2API"} 累计 Tokens`,
        };
      }

      if (Number.isFinite(monthlyUsage) && monthlyUsage >= 0) {
        return {
          used: monthlyUsage,
          total:
            Number.isFinite(monthlyLimit) && monthlyLimit > 0
              ? monthlyLimit
              : monthlyUsage,
          metricType: "currency" as const,
          displayValue: monthlyUsage,
          displayLabel: `${profile.name || "Sub2API"} 月度使用量`,
        };
      }

      if (Number.isFinite(weeklyUsage) && weeklyUsage >= 0) {
        return {
          used: weeklyUsage,
          total:
            Number.isFinite(weeklyLimit) && weeklyLimit > 0
              ? weeklyLimit
              : weeklyUsage,
          metricType: "currency" as const,
          displayValue: weeklyUsage,
          displayLabel: `${profile.name || "Sub2API"} 周度使用量`,
        };
      }

      if (Number.isFinite(dailyUsage) && dailyUsage >= 0) {
        return {
          used: dailyUsage,
          total:
            Number.isFinite(dailyLimit) && dailyLimit > 0
              ? dailyLimit
              : dailyUsage,
          metricType: "currency" as const,
          displayValue: dailyUsage,
          displayLabel: `${profile.name || "Sub2API"} 日使用量`,
        };
      }

      // 当接口只返回 remaining 时，无法反推出累计消费，这里仅作为兜底。
      if (Number.isFinite(remaining) && remaining >= 0) {
        return {
          used:
            Number.isFinite(totalRequests) && totalRequests > 0
              ? totalRequests
              : 0,
          total: remaining,
          metricType:
            Number.isFinite(totalRequests) && totalRequests > 0
              ? ("requests" as const)
              : ("currency" as const),
          displayValue:
            Number.isFinite(totalRequests) && totalRequests > 0
              ? totalRequests
              : remaining,
          displayLabel:
            Number.isFinite(totalRequests) && totalRequests > 0
              ? `${profile.name || "Sub2API"} 累计请求数`
              : `${profile.name || "Sub2API"} 使用量`,
        };
      }

      return {
        used: Number(data.used || 0),
        total: Number(data.total || 0),
        metricType: "currency" as const,
        displayValue: Number(data.used || 0),
        displayLabel: `${profile.name || "Sub2API"} 总使用量`,
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
      const { headers, profile } = this.buildHeaders();

      if (!profile?.baseUrl) {
        console.error("[Local API] No enabled Local profile found");
        return [];
      }

      const modelsPath = this.path(Local.ListModelPath);

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
