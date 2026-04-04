import constants from "../constant";
import type { LLMModel } from "../client/api";
import { useAccessStore } from "../store";
import { writeAccessSnapshot } from "./access-snapshot";
import { appendAihubmixHeaders, isAiHubMixUrl } from "./aihubmix";
import { normalizeModelClassification } from "./model-classification";
import modelPublishedAtUtils from "./model-published-at";

const { ServiceProvider } = constants;
type ServiceProviderValue =
  (typeof ServiceProvider)[keyof typeof ServiceProvider];
const { applyModelPublishedAt } = modelPublishedAtUtils;
const OCOOLAI_FIXED_MODEL_FETCH_API_KEY = "4216a3b60ebf4850bf822e97c02e0e55";

function getOcoolApiKeyGroupPriority(modelName: string, groupName?: string) {
  const normalizedGroup = String(groupName || "default")
    .trim()
    .toLowerCase();
  const lowerModelName = modelName.toLowerCase();
  const isClaudeModel = lowerModelName.startsWith("claude");

  if (isClaudeModel) {
    const priorityMap: Record<string, number> = {
      default: 50,
      official: 45,
      cc: 40,
      cn: 30,
      open_source_cn: 20,
    };
    return priorityMap[normalizedGroup] ?? 0;
  }

  const priorityMap: Record<string, number> = {
    default: 50,
    official: 45,
    open_source_cn: 40,
    cn: 30,
    cc: 20,
  };
  return priorityMap[normalizedGroup] ?? 0;
}

function getModelFetchApiKeyCandidates(params: {
  profile?: {
    baseUrl?: string;
    modelFetchApiKey?: string;
    balanceQueryApiKey?: string;
    apiKey?: string;
    apiKeyGroups?: Record<string, string>;
  };
  apiKey?: string;
  apiKeyGroups?: Record<string, string>;
}) {
  const profile = params.profile;
  const groupedKeys = params.apiKeyGroups || profile?.apiKeyGroups || {};
  if (profile?.baseUrl && isOcoolaiUrl(profile.baseUrl)) {
    return [OCOOLAI_FIXED_MODEL_FETCH_API_KEY];
  }
  const candidates = [
    profile?.modelFetchApiKey,
    groupedKeys.default,
    profile?.apiKey,
    params.apiKey,
    ...Object.values(groupedKeys),
    profile?.balanceQueryApiKey,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);

  return [...new Set(candidates)];
}

/**
 * AiHubMix developer_id 到供应商名称的映射
 * 数据来源: https://aihubmix.com/api/v1/models
 * 最后更新: 2026-03-16
 *
 * 注意: developer_id 分类是 AiHubMix 内部使用的，不完全对应原始供应商
 * 如 developer_id: 3 实际是 Microsoft Phi 系列模型
 */
const AIHUBMIX_VENDOR_MAP: Record<number, { name: string; icon?: string }> = {
  1: { name: "OpenAI", icon: "OpenAI" }, // o1-global, Jamba
  2: { name: "Anthropic", icon: "Claude.Color" },
  3: { name: "Microsoft", icon: "Nvidia" }, // Phi 系列 (微软/Nvidia)
  4: { name: "ByteDance", icon: "Doubao.Color" }, // Doubao/Seed
  5: { name: "Zhipu", icon: "Zhipu.Color" }, // GLM 系列
  6: { name: "Cohere", icon: "Cohere" }, // Command A/R
  7: { name: "DeepSeek", icon: "DeepSeek.Color" },
  8: { name: "Google", icon: "Gemini.Color" },
  9: { name: "xAI", icon: "XAI" }, // Grok 系列
  10: { name: "Mistral", icon: "Mistral.Color" },
  11: { name: "Meta", icon: "Meta.Color" }, // Llama 系列
  12: { name: "OpenAI", icon: "OpenAI" }, // GPT 系列
  13: { name: "Alibaba", icon: "Qwen.Color" },
  14: { name: "01.AI", icon: "Yi" },
  15: { name: "Moonshot", icon: "Moonshot" },
  16: { name: "StepFun", icon: "StepFun" },
  17: { name: "Nvidia", icon: "Nvidia" },
  18: { name: "Minimax", icon: "Minimax.Color" },
  19: { name: "Perplexity", icon: "Perplexity" },
  20: { name: "Baichuan", icon: "Baichuan" },
  21: { name: "Ideogram", icon: "Ideogram" },
  22: { name: "Jina AI", icon: "Jina" },
  23: { name: "Stability", icon: "Stability" },
  24: { name: "Tencent", icon: "Hunyuan.Color" },
  25: { name: "Baidu", icon: "Ernie.Color" },
  27: { name: "Flux", icon: "Flux" },
  28: { name: "Meituan", icon: "Meituan" },
  29: { name: "InclusionAI", icon: "InclusionAI" },
  30: { name: "BAAI", icon: "BAAI" },
  31: { name: "Xiaomi", icon: "Xiaomi" },
};

/**
 * 通过模型名称前缀推断供应商
 */
function inferVendorFromModelName(
  modelName: string,
): { name: string; icon?: string } | null {
  const lowerName = modelName.toLowerCase();

  if (lowerName.includes("aihubmix")) {
    return { name: "AihubMix", icon: "aihubmix" };
  }

  // OpenAI
  if (
    lowerName.startsWith("gpt-") ||
    lowerName.startsWith("chatgpt-") ||
    lowerName.startsWith("o1-") ||
    lowerName.startsWith("o3-")
  ) {
    return { name: "OpenAI", icon: "OpenAI" };
  }
  // Anthropic Claude
  if (lowerName.startsWith("claude-")) {
    return { name: "Anthropic", icon: "Claude.Color" };
  }
  // Google Gemini
  if (lowerName.startsWith("gemini-") || lowerName.startsWith("pregenie-")) {
    return { name: "Google", icon: "Gemini.Color" };
  }
  // DeepSeek
  if (lowerName.startsWith("deepseek-")) {
    return { name: "DeepSeek", icon: "DeepSeek.Color" };
  }
  // xAI Grok
  if (lowerName.startsWith("grok-")) {
    return { name: "xAI", icon: "XAI" };
  }
  // Alibaba Qwen
  if (lowerName.startsWith("qwen-") || lowerName.startsWith("qwen3")) {
    return { name: "Alibaba", icon: "Qwen.Color" };
  }
  // ByteDance Doubao
  if (lowerName.startsWith("doubao-")) {
    return { name: "ByteDance", icon: "Doubao.Color" };
  }
  // Moonshot
  if (lowerName.startsWith("moonshot-")) {
    return { name: "Moonshot", icon: "Moonshot" };
  }
  // Baidu Ernie
  if (lowerName.startsWith("ernie-")) {
    return { name: "Baidu", icon: "Ernie.Color" };
  }
  // Tencent Hunyuan
  if (lowerName.startsWith("hunyuan-")) {
    return { name: "腾讯混元", icon: "Hunyuan.Color" };
  }
  // Zhipu GLM
  if (lowerName.startsWith("glm-")) {
    return { name: "Zhipu", icon: "Zhipu.Color" };
  }
  // Meta Llama
  if (lowerName.startsWith("llama-") || lowerName.startsWith("llama3")) {
    return { name: "Meta", icon: "Ollama" };
  }
  // Mistral
  if (lowerName.startsWith("mistral-") || lowerName.startsWith("mixtral-")) {
    return { name: "Mistral", icon: "Mistral.Color" };
  }
  // Minimax
  if (lowerName.startsWith("abab-") || lowerName.startsWith("minimax")) {
    return { name: "Minimax", icon: "Minimax.Color" };
  }

  return null;
}

function inferVendorFromOcoolaiModel(
  modelName: string,
): { name: string; icon?: string } | null {
  const [prefix] = modelName.split("/", 1);
  const normalizedPrefix = prefix.trim().toLowerCase();

  const prefixVendorMap: Record<string, { name: string; icon?: string }> = {
    "01-ai": { name: "01.AI", icon: "Yi" },
    ascend: { name: "Ascend", icon: "Box" },
    azure: { name: "Microsoft", icon: "Azure" },
    baai: { name: "BAAI", icon: "Box" },
    "deepseek-ai": { name: "DeepSeek", icon: "DeepSeek.Color" },
    "ibm-granite": { name: "IBM", icon: "Box" },
    "meta-llama": { name: "Meta", icon: "Ollama" },
    meta: { name: "Meta", icon: "Ollama" },
    mistralai: { name: "Mistral", icon: "Mistral.Color" },
    ocoolai: { name: "Ocoolai", icon: "Box" },
    qwen: { name: "Alibaba", icon: "Qwen.Color" },
    web: { name: "Web", icon: "Globe" },
  };

  if (modelName.includes("/") && prefixVendorMap[normalizedPrefix]) {
    return prefixVendorMap[normalizedPrefix];
  }

  return inferVendorFromModelName(modelName);
}

export type FetchModelsResult = {
  models: LLMModel[];
  total: number;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function normalizeLocalProxyBaseUrl(baseUrl?: string) {
  const normalizedBaseUrl = normalizeBaseUrl(String(baseUrl || "").trim());
  if (!normalizedBaseUrl) return normalizedBaseUrl;

  try {
    const url = new URL(
      normalizedBaseUrl.startsWith("http")
        ? normalizedBaseUrl
        : `https://${normalizedBaseUrl}`,
    );
    if (url.hostname.toLowerCase() === "sub2api.ngpt.chat") {
      url.protocol = "http:";
      url.host = "127.0.0.1:8080";
    }
    return normalizeBaseUrl(url.toString());
  } catch {
    return normalizedBaseUrl;
  }
}

/**
 * 从 baseUrl 中提取平台名称用于显示
 */
export function getProviderDisplayName(
  provider: ServiceProviderValue,
  baseUrl?: string,
): string {
  if (provider !== ServiceProvider.Custom || !baseUrl) {
    return provider;
  }

  try {
    const url = new URL(baseUrl);
    const hostname = url.hostname;

    // 尝试从域名中提取有意义的平台名称
    const parts = hostname.split(".");
    // 移除常见的 TLD 和二级域名
    const cleanParts = parts.filter(
      (part) =>
        !["com", "cn", "org", "net", "io", "ai", "api", "www", "open"].includes(
          part,
        ),
    );

    if (cleanParts.length > 0) {
      // 取第一个有意义的部分，首字母大写
      const name = cleanParts[0];
      return name.charAt(0).toUpperCase() + name.slice(1);
    }

    return hostname;
  } catch {
    return baseUrl;
  }
}

/**
 * 检测是否为 YutoAPI (cn.gptapi.asia)
 */
function isYutoApiUrl(baseUrl?: string) {
  if (!baseUrl) return false;

  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "cn.gptapi.asia" || hostname === "gptapi.asia";
  } catch {
    return false;
  }
}

/**
 * 检测是否为 Ocoolai (one.ocoolai.com)
 */
function isOcoolaiUrl(baseUrl?: string) {
  if (!baseUrl) return false;

  try {
    const hostname = new URL(baseUrl).hostname;
    return (
      hostname === "one.ocoolai.com" ||
      hostname === "ocoolai.com" ||
      hostname === "one.ooo.cool"
    );
  } catch {
    return false;
  }
}

function isToApisUrl(baseUrl?: string) {
  if (!baseUrl) return false;

  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "toapis.com" || hostname === "www.toapis.com";
  } catch {
    return false;
  }
}

function extractOcoolaiAvailableModels(data: any): any[] {
  if (data?.success === true && Array.isArray(data?.data)) {
    return data.data.map((item: any) =>
      typeof item === "string" ? { id: item } : item,
    );
  }

  if (Array.isArray(data)) {
    return data.map((item) => (typeof item === "string" ? { id: item } : item));
  }

  if (Array.isArray(data?.items)) {
    return data.items.map((item: any) =>
      typeof item === "string" ? { id: item } : item,
    );
  }

  if (Array.isArray(data?.data)) {
    return data.data.map((item: any) =>
      typeof item === "string" ? { id: item } : item,
    );
  }

  if (data?.data && typeof data.data === "object") {
    const keys = Object.keys(data.data);
    if (keys.length > 0) {
      return keys.map((name) => ({ id: name }));
    }
  }

  if (Array.isArray(data?.models)) {
    return data.models.map((item: any) =>
      typeof item === "string" ? { id: item } : item,
    );
  }

  if (Array.isArray(data?.data?.models)) {
    return data.data.models.map((item: any) =>
      typeof item === "string" ? { id: item } : item,
    );
  }

  if (Array.isArray(data?.data?.Models)) {
    return data.data.Models.map((name: string) => ({ id: name }));
  }

  if (Array.isArray(data?.data?.groups)) {
    return data.data.groups.flatMap((group: any) => {
      const models = Array.isArray(group?.models)
        ? group.models
        : Array.isArray(group?.items)
        ? group.items
        : [];
      return models.map((item: any) =>
        typeof item === "string" ? { id: item } : item,
      );
    });
  }

  if (Array.isArray(data?.groups)) {
    return data.groups.flatMap((group: any) => {
      const models = Array.isArray(group?.models)
        ? group.models
        : Array.isArray(group?.items)
        ? group.items
        : [];
      return models.map((item: any) =>
        typeof item === "string" ? { id: item } : item,
      );
    });
  }

  return [];
}

function mapModels(
  models: any[],
  providerId: string,
  providerName: string,
  providerType: string,
  sorted: number,
  vendorsMap?: Record<number, { name: string; icon?: string }>,
  apiKeyGroup?: string,
) {
  let seq = 1000;
  return models.map((m: any) => {
    const modelName = m.id || m.name || m.model_id || m.model_name;
    const normalizedCapabilities = normalizeAiHubMixModelMetadata(m);
    const isAiHubMixBrandedModel = String(modelName || "")
      .toLowerCase()
      .includes("aihubmix");

    // 提取供应商信息
    let vendor: { id: number; name: string; icon?: string } | undefined;

    // YutoAPI: 有 vendor_id 和 vendors 数组
    if (m.vendor_id !== undefined && vendorsMap) {
      const vendorInfo = vendorsMap[m.vendor_id];
      if (vendorInfo) {
        vendor = {
          id: m.vendor_id,
          name: vendorInfo.name,
          icon: vendorInfo.icon,
        };
      }
    }
    // AiHubMix: 有 developer_id
    else if (m.developer_id !== undefined && vendorsMap) {
      const vendorInfo = vendorsMap[m.developer_id];
      if (vendorInfo) {
        vendor = {
          id: m.developer_id,
          name: vendorInfo.name,
          icon: vendorInfo.icon,
        };
      }
    }
    // Ocoolai / 其他：优先按命名空间前缀分类，再降级到模型名前缀推断
    else {
      const inferred = inferVendorFromOcoolaiModel(modelName);
      if (inferred) {
        vendor = {
          id: -1, // 推断的供应商没有固定 ID
          name: inferred.name,
          icon: inferred.icon,
        };
      }
    }

    if (isAiHubMixBrandedModel) {
      vendor = {
        id: -2,
        name: "AihubMix",
        icon: "aihubmix",
      };
    }

    return applyModelPublishedAt({
      name: modelName,
      available: true,
      sorted: seq++,
      category: normalizedCapabilities.category,
      categorySource: normalizedCapabilities.categorySource,
      type: normalizedCapabilities.type,
      types: normalizedCapabilities.types,
      features: normalizedCapabilities.features,
      capabilities: normalizedCapabilities.capabilities,
      categories: normalizedCapabilities.categories,
      apiKeyGroup,
      provider: {
        id: providerId,
        providerName: providerName,
        providerType: providerType,
        sorted: sorted,
      },
      vendor,
    });
  });
}

function getYutoApiKeyGroupPriority(modelName: string, groupName?: string) {
  const normalizedGroup = String(groupName || "default")
    .trim()
    .toLowerCase();
  const lowerModelName = modelName.toLowerCase();
  const isClaudeModel = lowerModelName.startsWith("claude");

  if (isClaudeModel) {
    const priorityMap: Record<string, number> = {
      anthropic: 50,
      enterprise: 40,
      discount: 30,
      user: 20,
      default: 10,
    };
    return priorityMap[normalizedGroup] ?? 0;
  }

  const priorityMap: Record<string, number> = {
    enterprise: 50,
    discount: 40,
    user: 30,
    anthropic: 20,
    default: 10,
  };
  return priorityMap[normalizedGroup] ?? 0;
}

export function normalizeAiHubMixModelMetadata(model: any): {
  category?: string;
  categorySource?: 0 | 1;
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
  categories?: string[];
} {
  return normalizeModelClassification(model);
}

/**
 * 将相对路径转为完整 URL 用于日志显示
 */
function fullUrl(url: string, baseUrl?: string): string {
  if (url.startsWith("/")) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (baseUrl) {
      if (url.includes("/yuto/pricing") || url.includes("/proxy/v1/pricing")) {
        return `${origin}${url} (代理 → ${baseUrl}/api/pricing)`;
      }
      if (url.includes("/ocoolai/available-model")) {
        return `${origin}${url} (代理 → https://one.ocoolai.com/api/user/available_model)`;
      }
      if (url.includes("/ocoolai/available-models-by-groups")) {
        return `${origin}${url} (代理 → https://one.ocoolai.com/api/user/available_models_by_groups)`;
      }
    }
    return baseUrl ? `${origin}${url} (代理 → ${baseUrl})` : `${origin}${url}`;
  }
  return url;
}

function isServerSide() {
  return typeof window === "undefined";
}

type FetchCandidate =
  | string
  | {
      url: string;
      displayBaseUrl?: string;
      headerBaseUrl?: string;
    };

type FetchJsonOptions = {
  logSuccess?: boolean;
  suppressCandidateErrors?: boolean;
  suppressStatusCodes?: number[];
  validateJson?: (data: any) => boolean;
  authorizationCandidates?: string[];
  authCacheKey?: string;
};

const preferredAuthorizationCache = new Map<string, string>();

async function fetchJsonWithCandidates(
  urls: FetchCandidate[],
  headers: Record<string, string>,
  baseUrl?: string,
  options?: FetchJsonOptions,
) {
  let lastError: Error | null = null;
  const suppressStatusCodes = new Set(options?.suppressStatusCodes || []);
  const authCandidates =
    options?.authorizationCandidates &&
    options.authorizationCandidates.length > 0
      ? options.authorizationCandidates
      : headers.Authorization
      ? [headers.Authorization]
      : [undefined];
  const preferredAuthorization = options?.authCacheKey
    ? preferredAuthorizationCache.get(options.authCacheKey)
    : undefined;
  const orderedAuthCandidates = preferredAuthorization
    ? [
        preferredAuthorization,
        ...authCandidates.filter(
          (candidate) => candidate !== preferredAuthorization,
        ),
      ]
    : authCandidates;

  for (
    let authIndex = 0;
    authIndex < orderedAuthCandidates.length;
    authIndex++
  ) {
    for (let i = 0; i < urls.length; i++) {
      const candidate = urls[i];
      const url = typeof candidate === "string" ? candidate : candidate.url;
      const displayBaseUrl =
        typeof candidate === "string"
          ? baseUrl
          : candidate.displayBaseUrl ?? baseUrl;
      const requestHeaders = {
        ...headers,
        ...(typeof candidate === "string" || !candidate.headerBaseUrl
          ? {}
          : { "x-base-url": candidate.headerBaseUrl }),
      } as Record<string, string>;
      const authorization = orderedAuthCandidates[authIndex];
      if (authorization) {
        requestHeaders.Authorization = authorization;
      } else {
        delete requestHeaders.Authorization;
      }
      const display = fullUrl(url, displayBaseUrl);
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: requestHeaders,
        });

        if (!response.ok) {
          lastError = new Error(`${response.status} ${response.statusText}`);
          if (suppressStatusCodes.has(response.status)) {
            continue;
          }
          if (response.status === 404) {
            console.log(
              `[Fetch Models] 💡 第 ${
                i + 1
              } 个 URL 不存在 (404)，尝试下一个...`,
            );
          } else {
            console.log(
              `[Fetch Models] ⚠️ 第 ${i + 1} 个 URL 返回 ${response.status}`,
            );
          }
          continue;
        }

        const data = await response.json();
        if (options?.validateJson && !options.validateJson(data)) {
          console.log(`[Fetch Models] ❌ 验证失败，响应内容:`, data);
          lastError = new Error("响应内容无效");
          continue;
        }
        if (options?.logSuccess !== false) {
          console.log(`[Fetch Models] ✅ 使用模型接口: ${display}`);
        }
        if (options?.authCacheKey && authorization) {
          preferredAuthorizationCache.set(options.authCacheKey, authorization);
        }
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("请求失败");
        if (!options?.suppressCandidateErrors) {
          console.log(`[Fetch Models] ❌ 第 ${i + 1} 个 URL 请求异常:`, error);
        }
      }
    }
  }

  throw lastError ?? new Error("未找到可用的模型接口");
}

/**
 * 从指定供应商获取模型列表
 */
export async function fetchModelsFromProvider(
  provider: ServiceProviderValue,
  baseUrl?: string,
  apiKey?: string,
  profileName?: string,
  apiKeyGroups?: Record<string, string>,
): Promise<FetchModelsResult> {
  // 构建API路径
  let apiPath = "";
  let providerId = "";
  let providerName = "";
  let providerType = "";
  let sorted = 0;

  switch (provider) {
    case ServiceProvider.OpenAI:
      apiPath = "/api/openai/v1/models";
      providerId = "openai";
      providerName = "OpenAI";
      providerType = "openai";
      sorted = 1;
      break;
    case ServiceProvider.Anthropic:
      // Anthropic 暂不支持公开模型列表API，返回空
      return { models: [], total: 0 };
    case ServiceProvider.Azure:
      apiPath = "/api/azure/openai/deployments";
      providerId = "azure";
      providerName = "Azure";
      providerType = "azure";
      sorted = 2;
      break;
    case ServiceProvider.SiliconFlow:
      apiPath = "/api/siliconflow/v1/models?sub_type=chat";
      providerId = "siliconflow";
      providerName = "SiliconFlow";
      providerType = "siliconflow";
      sorted = 14;
      break;
    case ServiceProvider["302.AI"]:
      apiPath = "/api/302ai/v1/models?llm=1";
      providerId = "ai302";
      providerName = "302.AI";
      providerType = "302ai";
      sorted = 15;
      break;
    case ServiceProvider.DeepSeek:
      apiPath = "/api/deepseek/v1/models";
      providerId = "deepseek";
      providerName = "DeepSeek";
      providerType = "deepseek";
      sorted = 13;
      break;
    case ServiceProvider.XAI:
      apiPath = "/api/xai/v1/models";
      providerId = "xai";
      providerName = "XAI";
      providerType = "xai";
      sorted = 12;
      break;
    case ServiceProvider.Custom:
      // 自定义供应商通过代理获取模型列表
      if (baseUrl) {
        apiPath = "/api/proxy/v1/models";
        providerId = profileName ? `custom_${profileName}` : "custom";
        providerName = "Custom";
        providerType = "openai";
        sorted = 0;
      } else {
        return { models: [], total: 0 };
      }
      break;
    case ServiceProvider.Local:
      if (baseUrl) {
        apiPath = "/api/proxy/v1/models";
        providerId = profileName
          ? `${String(provider).toLowerCase()}_${profileName}`.toLowerCase()
          : String(provider).toLowerCase();
        providerName = "Local";
        providerType = "openai";
        sorted = 999;
      } else {
        return { models: [], total: 0 };
      }
      break;
    default:
      return { models: [], total: 0 };
  }

  try {
    const headers: Record<string, string> = {};
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    appendAihubmixHeaders(headers, baseUrl);

    let data: any;
    const normalizedBaseUrl = baseUrl ? normalizeBaseUrl(baseUrl) : undefined;
    const matchedCustomProfile =
      provider === ServiceProvider.Custom && normalizedBaseUrl
        ? useAccessStore
            .getState()
            .apiProfiles.find(
              (profile) =>
                profile.provider === ServiceProvider.Custom &&
                normalizeBaseUrl(profile.baseUrl || "") === normalizedBaseUrl,
            )
        : undefined;

    if (
      baseUrl &&
      [
        ServiceProvider.OpenAI,
        ServiceProvider.Custom,
        ServiceProvider.Local,
      ].includes(provider)
    ) {
      const effectiveBaseUrl =
        provider === ServiceProvider.Local
          ? normalizeLocalProxyBaseUrl(baseUrl)
          : baseUrl;
      const effectiveNormalizedBaseUrl = normalizeBaseUrl(effectiveBaseUrl);
      const baseWithoutV1 = effectiveNormalizedBaseUrl.replace(/\/v1$/, "");
      const proxyBaseUrl = isServerSide() ? baseUrl : baseWithoutV1;

      // 为代理型供应商设置 x-base-url header
      if (
        provider === ServiceProvider.Custom ||
        provider === ServiceProvider.Local
      ) {
        headers["x-base-url"] =
          provider === ServiceProvider.Local ? baseWithoutV1 : proxyBaseUrl;
      }

      // 某些聚合平台需要特殊接口获取模型列表
      const isOcoolai = isOcoolaiUrl(baseUrl);

      // Ocoolai 使用专用 API Key 获取模型列表（不影响聊天）
      const modelFetchApiKeyCandidates = isOcoolai
        ? getModelFetchApiKeyCandidates({
            profile: matchedCustomProfile,
            apiKey,
            apiKeyGroups,
          })
        : apiKey
        ? [apiKey]
        : [];

      if (modelFetchApiKeyCandidates[0]) {
        headers["Authorization"] = `Bearer ${modelFetchApiKeyCandidates[0]}`;
      }

      console.log(`[Fetch Models] 🔍 检测 baseUrl:`, {
        baseUrl,
        normalizedBaseUrl: effectiveNormalizedBaseUrl,
        isOcoolai,
        isServerSide: isServerSide(),
        hasApiKey: !!apiKey,
        apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + "..." : "none",
      });

      // 简化候选 URL，只使用成功的单个 URL
      const candidateUrls: FetchCandidate[] = isToApisUrl(baseUrl)
        ? ["/api/toapis/pricing"]
        : isOcoolaiUrl(baseUrl)
        ? [
            {
              url: "/api/ocoolai/available-model",
              displayBaseUrl: "https://one.ocoolai.com",
              headerBaseUrl: "https://one.ocoolai.com",
            },
          ]
        : isYutoApiUrl(baseUrl)
        ? ["/api/yuto/pricing"]
        : isAiHubMixUrl(baseUrl)
        ? ["/api/aihubmix/models"]
        : [
            "/api/proxy/v1/models",
            "/api/proxy/api/v1/models",
            "/api/proxy/models",
          ];

      // console.log(`[Fetch Models] 📋 候选 URLs:`, candidateUrls);

      data = await fetchJsonWithCandidates(candidateUrls, headers, baseUrl, {
        authorizationCandidates: modelFetchApiKeyCandidates.map(
          (key) => `Bearer ${key}`,
        ),
        authCacheKey: isOcoolai
          ? `model-fetch:${normalizedBaseUrl}`
          : undefined,
        suppressCandidateErrors: isOcoolai,
        suppressStatusCodes: isOcoolai ? [401, 404] : [404],
        validateJson: isOcoolai
          ? (payload) =>
              payload?.success !== false &&
              extractOcoolaiAvailableModels(payload).length > 0
          : undefined,
      });
    } else {
      const url = baseUrl ? `${normalizeBaseUrl(baseUrl)}${apiPath}` : apiPath;

      const response = await fetch(url, {
        method: "GET",
        headers,
      });

      if (!response.ok) {
        if (response.status === 404) {
          console.log(
            `[Fetch Models] 💡 ${provider} 不支持模型列表接口 (${url})`,
          );
        } else {
          console.error(
            `[Fetch Models] ❌ 从 ${provider} 获取模型失败: ${response.status}`,
          );
        }
        return { models: [], total: 0 };
      }

      data = await response.json();
    }

    // 标准化模型列表响应
    let models: any[] = [];

    // 提取供应商映射
    let vendorsMap: Record<number, { name: string; icon?: string }> | undefined;

    // YutoAPI: 从 vendors 数组构建映射
    if (data.vendors && Array.isArray(data.vendors)) {
      vendorsMap = {};
      data.vendors.forEach((v: any) => {
        vendorsMap![v.id] = {
          name: v.name,
          icon: v.icon,
        };
      });
    }
    // AiHubMix: 使用预定义的映射表
    else if (isAiHubMixUrl(baseUrl)) {
      vendorsMap = AIHUBMIX_VENDOR_MAP;
    }
    // Ocoolai: 使用模型名推断（在 mapModels 中处理）
    else if (isOcoolaiUrl(baseUrl)) {
      // 不需要特殊处理，mapModels 会推断
    }

    // 检测数据格式
    // ToAPIs pricing 格式: {data: [{model_name: "...", supported_endpoint_types: [...]}]}
    if (
      isToApisUrl(baseUrl) &&
      Array.isArray(data.data) &&
      data.data.length > 0 &&
      data.data[0].model_name
    ) {
      models = data.data;
    }
    // YutoAPI 格式: {vendors: [...], data: [{model_name: "...", vendor_id: ..., ...}]}
    // 必须同时有 vendors 数组才能确认是 YutoAPI
    else if (
      data.vendors &&
      Array.isArray(data.vendors) &&
      data.data &&
      Array.isArray(data.data) &&
      data.data.length > 0 &&
      data.data[0].model_name
    ) {
      models = data.data;
    }
    // Ocoolai available_model / pricing 兼容格式
    else if (isOcoolaiUrl(baseUrl)) {
      models = extractOcoolaiAvailableModels(data);
    }
    // AiHubMix 格式: {data: [{model_id: "...", model_name: "...", developer_id: ...}]}
    else if (
      data.data &&
      Array.isArray(data.data) &&
      data.data.length > 0 &&
      data.data[0].model_id !== undefined &&
      data.data[0].developer_id !== undefined
    ) {
      models = data.data;
    }
    // 标准 OpenAI 格式
    else if (data.data && Array.isArray(data.data)) {
      models = data.data;
    } else if (data.object === "list" && data.data) {
      models = data.data;
    } else if (data.models && Array.isArray(data.models)) {
      models = data.models;
    }

    if (isYutoApiUrl(baseUrl)) {
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl!);
      const baseWithoutV1 = normalizedBaseUrl.replace(/\/v1$/, "");
      const candidateUrls = isServerSide()
        ? [`${baseWithoutV1}/api/pricing`, `${baseWithoutV1}/pricing`]
        : ["/api/yuto/pricing"];
      const groupedEntries = Object.entries(apiKeyGroups || {}).filter(
        ([, value]) => Boolean(value?.trim()),
      );
      const fetchEntries =
        groupedEntries.length > 0
          ? groupedEntries
          : [["default", apiKey || ""]];
      const mergedModelMap = new Map<string, LLMModel>();
      for (const [groupName, groupApiKey] of fetchEntries) {
        if (!groupApiKey) continue;
        const groupedHeaders: Record<string, string> = {
          Authorization: `Bearer ${groupApiKey}`,
          ...(baseUrl ? { "x-base-url": baseUrl } : {}),
        };
        const groupedData = await fetchJsonWithCandidates(
          candidateUrls,
          groupedHeaders,
          baseUrl,
          {
            logSuccess: false,
            authCacheKey: `yuto-group:${normalizedBaseUrl}:${groupName}`,
            suppressCandidateErrors: true,
            suppressStatusCodes: [404],
          },
        );
        const groupedModels =
          groupedData?.vendors &&
          Array.isArray(groupedData.vendors) &&
          groupedData?.data &&
          Array.isArray(groupedData.data)
            ? groupedData.data
            : [];
        const groupedVendorsMap: Record<
          number,
          { name: string; icon?: string }
        > = {};
        (groupedData?.vendors || []).forEach((vendor: any) => {
          groupedVendorsMap[vendor.id] = {
            name: vendor.name,
            icon: vendor.icon,
          };
        });

        mapModels(
          groupedModels,
          providerId,
          providerName,
          providerType,
          sorted,
          groupedVendorsMap,
          groupName,
        ).forEach((model) => {
          const key = `${model.name}@${model.provider?.id}`;
          const existing = mergedModelMap.get(key);

          if (!existing) {
            mergedModelMap.set(key, model);
          } else {
            const existingPriority = getYutoApiKeyGroupPriority(
              model.name,
              existing.apiKeyGroup,
            );
            const nextPriority = getYutoApiKeyGroupPriority(
              model.name,
              groupName,
            );

            if (nextPriority > existingPriority) {
              mergedModelMap.set(key, { ...model, apiKeyGroup: groupName });
            }
          }
        });
      }

      const mappedModels = [...mergedModelMap.values()];
      return {
        models: mappedModels,
        total: mappedModels.length,
      };
    }

    if (isToApisUrl(baseUrl)) {
      const mappedModels = mapModels(
        models,
        providerId,
        providerName,
        providerType,
        sorted,
        vendorsMap,
      );
      return {
        models: mappedModels,
        total: mappedModels.length,
      };
    }

    if (
      isOcoolaiUrl(baseUrl) &&
      apiKeyGroups &&
      Object.keys(apiKeyGroups).length > 0
    ) {
      const modelFetchApiKeyCandidates = getModelFetchApiKeyCandidates({
        profile: matchedCustomProfile,
        apiKey,
        apiKeyGroups,
      });
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl!);
      const baseWithoutV1 = normalizedBaseUrl.replace(/\/v1$/, "");
      const groupsData = await fetchJsonWithCandidates(
        [
          {
            url: "/api/ocoolai/available-models-by-groups",
            displayBaseUrl: "https://one.ocoolai.com",
            headerBaseUrl: "https://one.ocoolai.com",
          },
        ],
        {
          Authorization: `Bearer ${modelFetchApiKeyCandidates[0] || ""}`,
          ...(baseUrl ? { "x-base-url": baseWithoutV1 } : {}),
        },
        baseUrl,
        {
          authorizationCandidates: modelFetchApiKeyCandidates.map(
            (key) => `Bearer ${key}`,
          ),
          authCacheKey: `ocool-groups:${normalizedBaseUrl}`,
          logSuccess: false,
          suppressCandidateErrors: true,
          suppressStatusCodes: [404],
        },
      );

      const groups =
        groupsData?.success && Array.isArray(groupsData?.data?.groups)
          ? groupsData.data.groups
          : [];

      const mergedModelMap = new Map<string, LLMModel>();

      for (const group of groups) {
        const groupName = group.name;
        const groupApiKey = apiKeyGroups[groupName];
        if (!groupApiKey) continue;

        const groupModelsArray = Array.isArray(group.models)
          ? group.models.map((name: string) => ({ id: name }))
          : [];

        mapModels(
          groupModelsArray,
          providerId,
          providerName,
          providerType,
          sorted,
          vendorsMap,
          groupName,
        ).forEach((model) => {
          const key = `${model.name}@${model.provider?.id}`;
          const existing = mergedModelMap.get(key);

          if (!existing) {
            mergedModelMap.set(key, model);
            return;
          }

          const existingPriority = getOcoolApiKeyGroupPriority(
            model.name,
            existing.apiKeyGroup,
          );
          const nextPriority = getOcoolApiKeyGroupPriority(
            model.name,
            groupName,
          );

          if (nextPriority > existingPriority) {
            mergedModelMap.set(key, { ...model, apiKeyGroup: groupName });
          }
        });
      }

      if (mergedModelMap.size > 0) {
        const mappedModels = [...mergedModelMap.values()];
        return {
          models: mappedModels,
          total: mappedModels.length,
        };
      }
    }

    if (isAiHubMixUrl(baseUrl)) {
      const mappedModels = mapModels(
        models,
        providerId,
        providerName,
        providerType,
        sorted,
        vendorsMap,
      );
      return {
        models: mappedModels,
        total: mappedModels.length,
      };
    }

    if (isOcoolaiUrl(baseUrl)) {
      const mappedModels = mapModels(
        models,
        providerId,
        providerName,
        providerType,
        sorted,
        vendorsMap,
      );
      return {
        models: mappedModels,
        total: mappedModels.length,
      };
    }

    const mappedModels = mapModels(
      models,
      providerId,
      providerName,
      providerType,
      sorted,
      vendorsMap,
    );
    return {
      models: mappedModels,
      total: mappedModels.length,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * 将模型列表转换为 customModels 字符串格式
 */
export function modelsToCustomModelsString(models: LLMModel[]): string {
  return models
    .map((m) => {
      if (m.provider && m.provider.providerName !== "Custom") {
        return `${m.name}@${m.provider.providerName}`;
      }
      return m.name;
    })
    .join(",");
}

/**
 * 将已获取的模型列表更新到配置
 */
export async function updateModelsInStore(models: LLMModel[]): Promise<string> {
  if (models.length === 0) {
    return "";
  }

  const modelsString = modelsToCustomModelsString(models);

  // 动态导入store（避免循环依赖）
  const { useAccessStore } = await import("../store/access");
  const { useAppConfig } = await import("../store/config");
  const { useModelCacheStore } = await import("../store/model-cache");
  const accessStore = useAccessStore.getState();
  const configStore = useAppConfig.getState() as any;

  // 仅替换本次拉取到的供应商模型，其他供应商模型保持不变。
  configStore.mergeModels(models, { silent: true });

  // 当前启用平台的可用模型只跟随本次真实获取结果，不再叠加历史缓存。
  accessStore.update((state) => {
    state.customModels = modelsString;
    state.apiProfiles = (state.apiProfiles || []).map((profile) =>
      profile.enabled
        ? {
            ...profile,
            cachedModels: modelsString,
            modelCount: models.length,
          }
        : profile,
    );
  });
  const enabledProfile = useAccessStore
    .getState()
    .apiProfiles.find((profile) => profile.enabled);
  if (enabledProfile) {
    useModelCacheStore.getState().upsertProfileCache(enabledProfile.id, {
      cachedModels: modelsString,
      modelCount: models.length,
    });
  }
  const latestAccessState = useAccessStore.getState();
  writeAccessSnapshot({
    useCustomConfig: latestAccessState.useCustomConfig,
    provider: latestAccessState.provider,
    apiProfiles: latestAccessState.apiProfiles,
    customModels: latestAccessState.customModels,
    customUrl: latestAccessState.customUrl,
    customApiKey: latestAccessState.customApiKey,
    customOpenAICompatible: latestAccessState.customOpenAICompatible,
  });

  // 等待一下让持久化完成
  await new Promise((resolve) => setTimeout(resolve, 300));

  return modelsString;
}

/**
 * 获取并更新模型列表到配置
 */
export async function fetchAndUpdateModels(
  provider: ServiceProviderValue,
  baseUrl?: string,
  apiKey?: string,
): Promise<string> {
  const displayName = getProviderDisplayName(provider, baseUrl);
  console.log(`[Models] 🔍 开始从 ${displayName} 获取模型列表...`);
  const result = await fetchModelsFromProvider(provider, baseUrl, apiKey);

  console.log(
    "[fetchAndUpdateModels] 📊 获取到的模型数量:",
    result.models.length,
  );

  return updateModelsInStore(result.models);
}
