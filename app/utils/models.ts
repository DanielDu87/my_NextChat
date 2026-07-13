import constants from "../constant";
import type { LLMModel } from "../client/api";
import { useAccessStore } from "../store";
import { writeAccessSnapshot } from "./access-snapshot";
import { appendAihubmixHeaders, isAiHubMixUrl } from "./aihubmix";
import {
  getAiHubMixLookupKeys,
  hydrateModelsWithAiHubMixMetadata,
  normalizeAiHubMixModelMetadata,
  persistAiHubMixCatalogMetadataCache,
  persistAiHubMixClassificationCache,
  readAiHubMixCatalogMetadataCache,
  readAiHubMixClassificationCache,
  resolveAiHubMixCatalogRank,
  resolveAiHubMixMetadataByName,
} from "./aihubmix-model-metadata";
import modelPublishedAtUtils from "./model-published-at";
import {
  buildAuthHeaders,
  buildProxyModelFetchCandidates,
  getAuthorizationCandidates,
  getModelFetchApiKeyCandidates,
  isLocalModelProxyBaseUrl,
  parseExtraHeaders,
  appendAuthQueryParam,
  type ApiProfileAuthType,
} from "./model-fetch-common";
import { getEffectiveProviderBaseUrl } from "./provider-url";
import {
  getRememberedModelListPath,
  getRememberedModelListApiKey,
  rememberModelListPath,
} from "./api-path-memory";
import { isYutoProfileLike, isOcoolProfileLike } from "./multi-key";

export {
  getAiHubMixLookupKeys,
  hydrateModelsWithAiHubMixMetadata,
  normalizeAiHubMixModelMetadata,
  resolveAiHubMixCatalogRank,
  resolveAiHubMixMetadataByName,
};

const { ServiceProvider } = constants;
type ServiceProviderValue =
  (typeof ServiceProvider)[keyof typeof ServiceProvider];
const { applyModelPublishedAt } = modelPublishedAtUtils;
const aihubmixCatalogMetadataMapPromises = new Map<
  string,
  Promise<
    Map<
      string,
      { rank: number; vendor?: { id: number; name: string; icon?: string } }
    >
  >
>();
const aihubmixClassificationMapPromises = new Map<
  string,
  Promise<Map<string, { features?: string[]; types?: string[] }>>
>();

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

/**
 * AiHubMix developer_id 到供应商名称的映射
 * 数据来源: https://api.inferera.com/api/v1/models
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
export function inferVendorFromModelName(
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
    lowerName.startsWith("dall-e-") ||
    lowerName.startsWith("dalle-") ||
    lowerName.startsWith("tts-") ||
    lowerName.startsWith("whisper-") ||
    lowerName.startsWith("o1-") ||
    lowerName.startsWith("o3-") ||
    lowerName.startsWith("o4-")
  ) {
    return { name: "OpenAI", icon: "OpenAI" };
  }
  // Anthropic Claude
  if (lowerName.startsWith("claude-")) {
    return { name: "Anthropic", icon: "Claude.Color" };
  }
  // Google Gemini
  if (
    lowerName.startsWith("gemini-") ||
    lowerName.startsWith("pregenie-") ||
    lowerName.startsWith("veo-") ||
    lowerName.startsWith("imagen-")
  ) {
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
  if (
    lowerName.startsWith("llama-") ||
    lowerName.startsWith("llama3") ||
    lowerName.startsWith("nemotron-")
  ) {
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

function isGenericVendorName(vendorName?: string) {
  const normalized = String(vendorName || "")
    .trim()
    .toLowerCase();
  return !normalized || ["custom", "other", "unknown"].includes(normalized);
}

function formatNamespacedVendorName(prefix: string) {
  return prefix
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((part) =>
      part.toLowerCase() === "ai"
        ? "AI"
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

function inferVendorFromOcoolaiModel(
  modelName: string,
): { name: string; icon?: string } | null {
  // OpenRouter 会在部分模型 ID 前加 `~` 标记；它不是厂商名的一部分。
  const normalizedModelName = modelName.trim().replace(/^~+/, "");
  const [prefix] = normalizedModelName.split("/", 1);
  const normalizedPrefix = prefix.trim().toLowerCase();

  const prefixVendorMap: Record<string, { name: string; icon?: string }> = {
    "01-ai": { name: "01.AI", icon: "Yi" },
    ascend: { name: "Ascend", icon: "Box" },
    anthropic: { name: "Anthropic", icon: "Claude.Color" },
    amazon: { name: "Amazon", icon: "Box" },
    "amazon-nova": { name: "Amazon", icon: "Box" },
    azure: { name: "Microsoft", icon: "Azure" },
    baai: { name: "BAAI", icon: "Box" },
    baidu: { name: "Baidu", icon: "Ernie.Color" },
    cohere: { name: "Cohere", icon: "Box" },
    "deepseek-ai": { name: "DeepSeek", icon: "DeepSeek.Color" },
    google: { name: "Google", icon: "Gemini.Color" },
    "google-ai": { name: "Google", icon: "Gemini.Color" },
    "ibm-granite": { name: "IBM", icon: "Box" },
    "meta-llama": { name: "Meta", icon: "Ollama" },
    meta: { name: "Meta", icon: "Ollama" },
    microsoft: { name: "Microsoft", icon: "Azure" },
    mistralai: { name: "Mistral", icon: "Mistral.Color" },
    moonshotai: { name: "Moonshot", icon: "Moonshot" },
    nvidia: { name: "Nvidia", icon: "Box" },
    ocoolai: { name: "Ocoolai", icon: "Box" },
    openai: { name: "OpenAI", icon: "OpenAI" },
    openrouter: { name: "OpenRouter", icon: "Box" },
    perplexity: { name: "Perplexity", icon: "Box" },
    qwen: { name: "Alibaba", icon: "Qwen.Color" },
    tencent: { name: "Tencent", icon: "Hunyuan.Color" },
    web: { name: "Web", icon: "Globe" },
    "x-ai": { name: "xAI", icon: "XAI" },
    xai: { name: "xAI", icon: "XAI" },
    "z-ai": { name: "Zhipu", icon: "Zhipu.Color" },
    zhipu: { name: "Zhipu", icon: "Zhipu.Color" },
  };

  if (normalizedModelName.includes("/") && normalizedPrefix) {
    return (
      prefixVendorMap[normalizedPrefix] ?? {
        name: formatNamespacedVendorName(normalizedPrefix),
        icon: "Box",
      }
    );
  }

  return inferVendorFromModelName(normalizedModelName);
}

export type FetchModelsResult = {
  models: LLMModel[];
  total: number;
};

const fetchModelsLogDedupMap = new Map<string, number>();

function stringifyFetchModelsLogPayload(payload: unknown) {
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function logFetchModels(message: string, payload?: unknown) {
  const dedupKey = `${message}|${
    payload === undefined ? "" : stringifyFetchModelsLogPayload(payload)
  }`;
  const now = Date.now();
  const lastAt = fetchModelsLogDedupMap.get(dedupKey) || 0;
  const dedupWindowMs =
    message.includes("✅ 使用模型接口") ||
    message.includes("✅ 模型接口获取成功")
      ? 30_000
      : 1500;
  if (now - lastAt < dedupWindowMs) {
    return;
  }
  fetchModelsLogDedupMap.set(dedupKey, now);

  if (payload === undefined) {
    console.log(message);
    return;
  }
  console.log(message, payload);
}

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
function isYutoApiUrl(baseUrl?: string, profileName?: string) {
  return isYutoProfileLike({ name: profileName, baseUrl });
}

/**
 * 检测是否为 Ocoolai (one.ocoolai.com)
 */
function isOcoolaiUrl(baseUrl?: string, profileName?: string) {
  return isOcoolProfileLike({ name: profileName, baseUrl });
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

function getRawModelName(model: any) {
  if (typeof model === "string") return model;
  return model?.id || model?.name || model?.model_id || model?.model_name;
}

function normalizeModelItems(items: any[]) {
  return items
    .map((item) => (typeof item === "string" ? { id: item } : item))
    .filter((item) => Boolean(getRawModelName(item)));
}

function extractModelListFromResponse(data: any, _baseUrl?: string): any[] {
  if (
    data?.vendors &&
    Array.isArray(data.vendors) &&
    Array.isArray(data?.data)
  ) {
    return normalizeModelItems(data.data);
  }

  // 递归收集所有可能的模型列表容器
  const containers: any[] = [];

  const visit = (item: unknown, depth: number) => {
    if (!item || typeof item !== "object" || depth > 3) return;
    if (Array.isArray(item)) {
      // 如果是数组且包含模型对象，收集它
      if (item.length > 0) {
        const first = item[0];
        if (
          first &&
          typeof first === "object" &&
          (first.id || first.name || first.model)
        ) {
          containers.push(item);
        }
      }
      return;
    }
    const obj = item as Record<string, unknown>;
    // 常见字段名
    const modelFields = [
      "data",
      "models",
      "items",
      "result",
      "payload",
      "groups",
      "data.models",
      "data.items",
      "data.Models",
      "data.groups",
      "result.models",
      "result.data",
    ];
    for (const field of modelFields) {
      let value: unknown;
      if (field.includes(".")) {
        // 处理嵌套路径如 "data.models"
        value = field.split(".").reduce((o: unknown, k: string) => {
          if (o && typeof o === "object") {
            return (o as Record<string, unknown>)[k];
          }
          return undefined;
        }, obj);
      } else {
        value = obj[field];
      }
      if (value !== undefined) {
        visit(value, depth + 1);
      }
    }
  };

  visit(data, 0);

  // 尝试从每个容器中提取模型
  for (const container of containers) {
    const normalized = normalizeModelItems(container);
    if (normalized.length > 0) return normalized;
  }

  // 尝试从对象值中提取
  if (data && typeof data === "object" && !Array.isArray(data)) {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) {
        const normalized = normalizeModelItems(value);
        if (normalized.length > 0) return normalized;
      }
    }

    // 处理 groups 结构（Ocoolai 等）
    const groups = data.groups || data.data?.groups;
    if (Array.isArray(groups)) {
      const models = groups.flatMap((group: any) => {
        if (Array.isArray(group?.models)) return group.models;
        if (Array.isArray(group?.items)) return group.items;
        return [];
      });
      const normalized = normalizeModelItems(models);
      if (normalized.length > 0) return normalized;
    }
  }

  return [];
}

function inferEndpointCapabilities(model: any) {
  const endpointTypes = Array.isArray(model?.supported_endpoint_types)
    ? model.supported_endpoint_types
    : Array.isArray(model?.supportedEndpointTypes)
    ? model.supportedEndpointTypes
    : Array.isArray(model?.endpoints)
    ? model.endpoints
    : [];
  const normalizedEndpoints = endpointTypes
    .map((item: unknown) => String(item || "").toLowerCase())
    .filter(Boolean);
  if (normalizedEndpoints.length === 0) {
    return {};
  }

  const features = new Set<string>();
  const types = new Set<string>();
  if (normalizedEndpoints.some((item: string) => item.includes("chat"))) {
    features.add("chat");
    types.add("chat");
  }
  if (normalizedEndpoints.some((item: string) => item.includes("response"))) {
    features.add("responses");
    types.add("chat");
  }
  if (normalizedEndpoints.some((item: string) => item.includes("image"))) {
    features.add("image");
    types.add("image");
  }
  if (normalizedEndpoints.some((item: string) => item.includes("video"))) {
    features.add("video");
    types.add("video");
  }
  if (normalizedEndpoints.some((item: string) => item.includes("audio"))) {
    features.add("audio");
    types.add("audio");
  }
  if (normalizedEndpoints.some((item: string) => item.includes("embedding"))) {
    features.add("embedding");
    types.add("embedding");
  }

  return {
    features: [...features],
    types: [...types],
    type: types.values().next().value,
    capabilities: [
      ...(features.has("chat") || features.has("responses") ? ["chat"] : []),
      ...(features.has("responses") ? ["responses"] : []),
      ...(features.has("image") ? ["image"] : []),
      ...(features.has("video") ? ["video"] : []),
      ...(features.has("audio") ? ["audio"] : []),
      ...(features.has("embedding") ? ["embedding"] : []),
    ],
  };
}

function mapModels(
  models: any[],
  providerId: string,
  providerName: string,
  providerType: string,
  sorted: number,
  vendorsMap?: Record<number, { name: string; icon?: string }>,
  apiKeyGroup?: string,
  catalogMetadataMap?: Map<
    string,
    { rank: number; vendor?: { id: number; name: string; icon?: string } }
  >,
  classificationMap?: Map<string, { features?: string[]; types?: string[] }>,
) {
  let seq = 1000;
  return models.map((m: any) => {
    const currentSeq = seq++;
    const modelName = m.id || m.name || m.model_id || m.model_name;
    const catalogMetadata = resolveAiHubMixMetadataByName(
      String(modelName || ""),
      catalogMetadataMap,
    );
    const catalogRank = catalogMetadata?.rank ?? undefined;
    const classificationMeta = resolveAiHubMixMetadataByName(
      String(modelName || ""),
      classificationMap,
    );
    const normalizedCapabilities = normalizeAiHubMixModelMetadata(
      classificationMeta
        ? {
            name: modelName,
            features: classificationMeta.features,
            types: classificationMeta.types,
            type: classificationMeta.types?.[0],
          }
        : m,
    );
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

    if (catalogMetadata?.vendor) {
      vendor = catalogMetadata.vendor;
    }

    const inferredVendor = inferVendorFromModelName(String(modelName || ""));
    if (inferredVendor && isGenericVendorName(vendor?.name)) {
      vendor = {
        id: -1,
        name: inferredVendor.name,
        icon: inferredVendor.icon,
      };
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
      sorted: currentSeq,
      remoteRank: catalogRank ?? currentSeq,
      remoteRankSource:
        catalogRank !== undefined ? "aihubmix_catalog" : "provider_models",
      catalogRank,
      category: normalizedCapabilities.category,
      categorySource: normalizedCapabilities.categorySource,
      type: inferEndpointCapabilities(m).type || normalizedCapabilities.type,
      types: inferEndpointCapabilities(m).types?.length
        ? inferEndpointCapabilities(m).types
        : normalizedCapabilities.types,
      features: [
        ...new Set([
          ...(normalizedCapabilities.features || []),
          ...(inferEndpointCapabilities(m).features || []),
        ]),
      ],
      capabilities: [
        ...new Set([
          ...(normalizedCapabilities.capabilities || []),
          ...(inferEndpointCapabilities(m).capabilities || []),
        ]),
      ],
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

async function fetchAiHubMixCatalogMetadataMap(baseUrl: string) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl).replace(/\/v1$/i, "");
  const targetUrl = `/api/proxy/api/v1/models`;
  const response = await fetch(targetUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(normalizedBaseUrl ? { "x-base-url": normalizedBaseUrl } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`AihubMix catalog ${response.status}`);
  }

  const payload = await response.json();
  const models = Array.isArray(payload?.data) ? payload.data : [];
  const catalogMetadataMap = new Map<
    string,
    { rank: number; vendor?: { id: number; name: string; icon?: string } }
  >();

  models.forEach((model: any, index: number) => {
    const modelName =
      model?.id || model?.name || model?.model_id || model?.model_name;
    const normalizedName = String(modelName || "")
      .trim()
      .toLowerCase();
    if (!normalizedName || catalogMetadataMap.has(normalizedName)) {
      return;
    }
    const vendorInfo = AIHUBMIX_VENDOR_MAP[Number(model?.developer_id)];
    catalogMetadataMap.set(normalizedName, {
      rank: index,
      vendor:
        model?.developer_id !== undefined && vendorInfo
          ? {
              id: Number(model.developer_id),
              name: vendorInfo.name,
              icon: vendorInfo.icon,
            }
          : undefined,
    });
  });

  persistAiHubMixCatalogMetadataCache(catalogMetadataMap);
  return catalogMetadataMap;
}

async function fetchAiHubMixClassificationMap(baseUrl: string) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl).replace(/\/v1$/i, "");
  const targetUrl = `/api/proxy/call/mdl_info_pagination?p=0&num=10000`;
  const response = await fetch(targetUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(normalizedBaseUrl ? { "x-base-url": normalizedBaseUrl } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`AihubMix classification ${response.status}`);
  }

  const payload = await response.json();
  const models = Array.isArray(payload?.data) ? payload.data : [];
  const classificationMap = new Map<
    string,
    { features?: string[]; types?: string[] }
  >();

  models.forEach((model: any) => {
    const modelName =
      model?.model ||
      model?.id ||
      model?.name ||
      model?.model_id ||
      model?.model_name;
    const normalizedName = String(modelName || "")
      .trim()
      .toLowerCase();
    if (!normalizedName || classificationMap.has(normalizedName)) {
      return;
    }

    const features = String(model?.features || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const types = String(model?.modalities || "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    classificationMap.set(normalizedName, {
      features: features.length > 0 ? features : undefined,
      types: types.length > 0 ? types : undefined,
    });
  });

  persistAiHubMixClassificationCache(classificationMap);
  return classificationMap;
}

async function getAiHubMixCatalogMetadataMap(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  let promise = aihubmixCatalogMetadataMapPromises.get(normalized);
  if (!promise) {
    promise = fetchAiHubMixCatalogMetadataMap(baseUrl).catch((error) => {
      const cachedMetadataMap = readAiHubMixCatalogMetadataCache();
      if (cachedMetadataMap.size > 0) {
        console.warn(
          "[Fetch Models] AihubMix 模型目录顺序拉取失败，回退到本地缓存",
          error instanceof Error ? error.message : String(error),
        );
        return cachedMetadataMap;
      }
      aihubmixCatalogMetadataMapPromises.delete(normalized);
      throw error;
    });
    aihubmixCatalogMetadataMapPromises.set(normalized, promise);
  }

  return promise;
}

async function getAiHubMixClassificationMap(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  let promise = aihubmixClassificationMapPromises.get(normalized);
  if (!promise) {
    promise = fetchAiHubMixClassificationMap(baseUrl).catch((error) => {
      const cachedClassificationMap = readAiHubMixClassificationCache();
      if (cachedClassificationMap.size > 0) {
        console.warn(
          "[Fetch Models] AihubMix 分类元数据拉取失败，回退到本地缓存",
          error instanceof Error ? error.message : String(error),
        );
        return cachedClassificationMap;
      }
      aihubmixClassificationMapPromises.delete(normalized);
      throw error;
    });
    aihubmixClassificationMapPromises.set(normalized, promise);
  }

  return promise;
}

/**
 * 将相对路径转为完整 URL 用于日志显示
 */
function fullUrl(url: string, baseUrl?: string): string {
  if (url.startsWith("/")) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (baseUrl) {
      if (url.startsWith("/api/proxy/")) {
        const upstreamPath = url.replace("/api/proxy", "") || "/";
        return `${origin}${url} (代理 → ${baseUrl}${upstreamPath})`;
      }
    }
    return baseUrl ? `${origin}${url} (代理 → ${baseUrl})` : `${origin}${url}`;
  }
  return url;
}

function isServerSide() {
  return typeof window === "undefined";
}

function normalizeProbeStatus(status: unknown) {
  const numericStatus = Number(status);
  if (!Number.isFinite(numericStatus)) return 502;
  return Math.min(599, Math.max(200, numericStatus));
}

async function fetchModelCandidate(
  url: string,
  requestHeaders: Record<string, string>,
  signal: AbortSignal,
) {
  if (isServerSide() || !url.startsWith("/api/")) {
    return fetch(url, {
      method: "GET",
      headers: requestHeaders,
      signal,
    });
  }

  const probeHeaders = {
    ...requestHeaders,
    "x-model-probe-url": url,
  };
  const probeResponse = await fetch("/api/model-probe", {
    method: "GET",
    headers: probeHeaders,
    signal,
  });
  const probe = await probeResponse.json().catch(() => null);
  const responseHeaders = new Headers();
  if (probe?.contentType) {
    responseHeaders.set("content-type", probe.contentType);
  }

  return new Response(probe?.bodyText ?? "", {
    status: normalizeProbeStatus(probe?.status),
    statusText: probe?.statusText || "Bad Gateway",
    headers: responseHeaders,
  });
}

type FetchCandidate =
  | string
  | {
      url: string;
      displayBaseUrl?: string;
      headerBaseUrl?: string;
      upstreamPath?: string;
      note?: string;
    };

type FetchJsonOptions = {
  signal?: AbortSignal;
  logSuccess?: boolean;
  logAttempt?: boolean;
  logLabel?: string;
  getModelCount?: (data: any) => number;
  suppressCandidateErrors?: boolean;
  suppressStatusCodes?: number[];
  suppressNonJsonResponse?: boolean;
  validateJson?: (data: any) => boolean;
  authorizationCandidates?: string[];
  authCacheKey?: string;
  authType?: ApiProfileAuthType;
  onSuccessCandidate?: (candidate: FetchCandidate) => void;
  authQueryParam?: string;
  authorizationHeaderName?: string;
  outerIndex?: number;
  outerTotal?: number;
  keyIndex?: number;
  keyTotal?: number;
};

const preferredAuthorizationCache = new Map<string, string>();

type FetchAttemptLog = {
  index: number;
  total: number;
  interface: string;
  result: string;
  keyIndex: number;
  keyTotal: number;
  url: string;
};

async function fetchJsonWithCandidates(
  urls: FetchCandidate[],
  headers: Record<string, string>,
  baseUrl?: string,
  options?: FetchJsonOptions,
) {
  let lastError: Error | null = null;
  const attempts: FetchAttemptLog[] = [];
  const logAttempt = options?.logAttempt !== false;
  const logLabel = options?.logLabel || "模型接口";
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

  for (let i = 0; i < urls.length; i++) {
    const candidate = urls[i];
    const url = typeof candidate === "string" ? candidate : candidate.url;
    const displayBaseUrl =
      typeof candidate === "string"
        ? baseUrl
        : candidate.displayBaseUrl ?? baseUrl;
    const display = fullUrl(url, displayBaseUrl);
    const interfaceLabel =
      typeof candidate === "string"
        ? display
        : candidate.note && candidate.upstreamPath
        ? `${candidate.note} (${candidate.upstreamPath})`
        : candidate.upstreamPath || candidate.note || display;

    for (
      let authIndex = 0;
      authIndex < orderedAuthCandidates.length;
      authIndex++
    ) {
      const requestHeaders = {
        ...headers,
        ...(typeof candidate === "string" || !candidate.headerBaseUrl
          ? {}
          : { "x-base-url": candidate.headerBaseUrl }),
      } as Record<string, string>;
      const authorization = orderedAuthCandidates[authIndex];
      const authorizationHeaderName =
        options?.authorizationHeaderName || "Authorization";
      if (authorization && authorizationHeaderName) {
        requestHeaders[authorizationHeaderName] = authorization;
      } else if (authorizationHeaderName) {
        delete requestHeaders[authorizationHeaderName];
      }
      const progressIndex =
        options?.outerIndex !== undefined ? options.outerIndex + 1 : i + 1;
      const progressTotal =
        options?.outerTotal !== undefined ? options.outerTotal : urls.length;
      const keyIndex =
        options?.keyIndex !== undefined ? options.keyIndex : authIndex + 1;
      const keyTotal =
        options?.keyTotal !== undefined
          ? options.keyTotal
          : orderedAuthCandidates.length;
      const keySuffix =
        keyTotal > 1 ? `，第 ${keyIndex}/${keyTotal} 个 key` : "";
      const progressPrefix = `${progressIndex}/${progressTotal}${keySuffix}`;
      const logPayload = {
        url: display,
        keyIndex: authIndex + 1,
        keyTotal: orderedAuthCandidates.length,
      };
      const recordAttempt = (result: string) => {
        attempts.push({
          index: i + 1,
          total: urls.length,
          interface: interfaceLabel,
          result,
          keyIndex: authIndex + 1,
          keyTotal: orderedAuthCandidates.length,
          url: display,
        });
      };
      try {
        if (logAttempt) {
          logFetchModels(
            `[Fetch Models] 🔁 正在尝试${logLabel}：${progressPrefix}`,
          );
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15_000);
        const requestUrl = appendAuthQueryParam(
          url,
          authorization,
          options?.authType,
          options?.authQueryParam,
        );
        const signal = options?.signal
          ? AbortSignal.any([controller.signal, options.signal])
          : controller.signal;
        const response = await fetchModelCandidate(
          requestUrl,
          requestHeaders,
          signal,
        ).finally(() => clearTimeout(timeoutId));

        if (!response.ok) {
          lastError = new Error(`${response.status} ${response.statusText}`);
          recordAttempt(`${response.status} ${response.statusText}`.trim());
          continue;
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType && !contentType.toLowerCase().includes("json")) {
          lastError = new Error(`响应不是 JSON (${contentType})`);
          recordAttempt(`非 JSON (${contentType})`);
          continue;
        }

        let data: any;
        try {
          data = await response.json();
        } catch (error) {
          lastError =
            error instanceof Error ? error : new Error("响应 JSON 解析失败");
          recordAttempt("JSON 解析失败");
          continue;
        }
        if (options?.validateJson && !options.validateJson(data)) {
          recordAttempt("内容无有效模型列表");
          lastError = new Error("响应内容无效");
          continue;
        }
        recordAttempt("成功");
        const modelCount = options?.getModelCount?.(data);
        const modelCountText =
          typeof modelCount === "number" ? `，获取到 ${modelCount} 个模型` : "";
        if (options?.logSuccess !== false) {
          logFetchModels(
            `[Fetch Models] ✅ ${logLabel}获取成功：${progressPrefix}${modelCountText}`,
            {
              success: attempts[attempts.length - 1],
              totalModels: modelCount,
              tried: attempts,
            },
          );
        }
        if (options?.authCacheKey && authorization) {
          preferredAuthorizationCache.set(options.authCacheKey, authorization);
        }
        options?.onSuccessCandidate?.(candidate);
        return data;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          lastError = new Error("请求超时，请检查网络连接");
        } else {
          lastError = error instanceof Error ? error : new Error("请求失败");
        }
        recordAttempt(lastError.message || "请求失败");
      }
    }
  }

  logFetchModels(`[Fetch Models] ⚠️ ${logLabel}全部候选均未成功`, {
    tried: attempts,
    lastError: lastError?.message,
  });
  throw lastError ?? new Error("未找到可用的模型接口");
}

async function fetchAllJsonWithCandidates(
  urls: FetchCandidate[],
  headers: Record<string, string>,
  baseUrl?: string,
  options?: FetchJsonOptions,
) {
  let idx = 0;
  for (const candidate of urls) {
    try {
      const data = await fetchJsonWithCandidates(
        [candidate],
        headers,
        baseUrl,
        {
          ...options,
          logSuccess: false,
          outerIndex:
            options?.outerIndex !== undefined ? options.outerIndex : idx,
          outerTotal:
            options?.outerTotal !== undefined
              ? options.outerTotal
              : urls.length,
        },
      );
      return [{ data, candidate }];
    } catch {
      // 单个路径失败不影响后续全路径尝试。
    }
    idx++;
  }

  throw new Error("未找到可用的模型接口");
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
  multiKeyGroupOrder?: string[],
  openAICompatible?: boolean,
  fetchOptions?: {
    signal?: AbortSignal;
    authType?: string;
    authQueryParam?: string;
    extraHeaders?: string;
  },
): Promise<FetchModelsResult> {
  const profileOpenAICompatible =
    openAICompatible ??
    (provider === ServiceProvider.Custom || provider === ServiceProvider.Local);
  baseUrl = getEffectiveProviderBaseUrl(provider, baseUrl) || baseUrl;

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
      apiPath = "/api/anthropic/v1/models";
      providerId = "anthropic";
      providerName = "Anthropic";
      providerType = "anthropic";
      sorted = 4;
      break;
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
      // 自定义供应商只有在配置页勾选 OpenAI 兼容时才走通用模型接口。
      if (!profileOpenAICompatible) {
        return { models: [], total: 0 };
      }
      if (baseUrl) {
        apiPath = "/api/proxy/v1/models";
        providerId = profileName
          ? `custom_${profileName}`.toLowerCase()
          : "custom";
        providerName = "Custom";
        providerType = "openai";
        sorted = 0;
      } else {
        return { models: [], total: 0 };
      }
      break;
    case ServiceProvider.Local:
      if (!profileOpenAICompatible) {
        return { models: [], total: 0 };
      }
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
    const accessProfiles = useAccessStore.getState().apiProfiles || [];
    const normalizedBaseUrl = baseUrl ? normalizeBaseUrl(baseUrl) : undefined;
    const matchedProviderProfile =
      accessProfiles.find(
        (profile) =>
          profile.provider === provider &&
          profileName &&
          String(profile.name || "").toLowerCase() ===
            String(profileName || "").toLowerCase(),
      ) ||
      accessProfiles.find(
        (profile) =>
          profile.provider === provider &&
          normalizedBaseUrl &&
          normalizeBaseUrl(
            getEffectiveProviderBaseUrl(profile.provider, profile.baseUrl) ||
              profile.baseUrl ||
              "",
          ) === normalizedBaseUrl,
      ) ||
      accessProfiles.find(
        (profile) => profile.provider === provider && profile.enabled,
      );
    const authType = (fetchOptions?.authType ||
      matchedProviderProfile?.authType ||
      (String(provider) === ServiceProvider.Anthropic
        ? "x-api-key"
        : String(provider) === ServiceProvider.Azure
        ? "api-key"
        : String(provider) === ServiceProvider.Google
        ? "x-goog-api-key"
        : "bearer")) as ApiProfileAuthType;
    const authQueryParam =
      fetchOptions?.authQueryParam ||
      matchedProviderProfile?.authQueryParam ||
      "key";
    const pathMemoryParams = {
      provider: String(provider),
      profileId: matchedProviderProfile?.id,
      profileName: profileName || matchedProviderProfile?.name,
      baseUrl,
    };
    const rememberedModelListPath =
      getRememberedModelListPath(pathMemoryParams);
    const rememberedModelListApiKey =
      getRememberedModelListApiKey(pathMemoryParams);
    const headers: Record<string, string> = {
      ...parseExtraHeaders(
        fetchOptions?.extraHeaders || matchedProviderProfile?.extraHeaders,
      ),
      ...buildAuthHeaders(apiKey, authType),
    };
    appendAihubmixHeaders(headers, baseUrl);

    let data: any;
    const matchedCustomProfile =
      provider === ServiceProvider.Custom ? matchedProviderProfile : undefined;
    const modelFetchApiKeyCandidates = getModelFetchApiKeyCandidates({
      modelFetchApiKey: matchedProviderProfile?.modelFetchApiKey,
      apiKey: matchedProviderProfile?.apiKey || apiKey,
      apiKeyGroups,
      multiKeyGroupOrder:
        matchedProviderProfile?.multiKeyGroupOrder || multiKeyGroupOrder,
    });
    if (modelFetchApiKeyCandidates[0]) {
      Object.assign(
        headers,
        buildAuthHeaders(modelFetchApiKeyCandidates[0], authType),
      );
    }

    const orderedModelFetchGroupNames = [
      ...(matchedProviderProfile?.multiKeyGroupOrder ||
        multiKeyGroupOrder ||
        []),
      ...Object.keys(apiKeyGroups || {}),
    ].filter((group, index, all) => group && all.indexOf(group) === index);
    const modelFetchKeyEntries = [
      {
        groupName: undefined as string | undefined,
        apiKey: matchedProviderProfile?.modelFetchApiKey || "",
      },
      {
        groupName: undefined as string | undefined,
        apiKey: matchedProviderProfile?.apiKey || apiKey || "",
      },
      ...orderedModelFetchGroupNames.map((groupName) => ({
        groupName,
        apiKey: apiKeyGroups?.[groupName] || "",
      })),
    ]
      .map((entry) => ({
        ...entry,
        apiKey: String(entry.apiKey || "").trim(),
      }))
      .filter((entry) => entry.apiKey)
      .filter(
        (entry, index, all) =>
          all.findIndex((item) => item.apiKey === entry.apiKey) === index,
      );
    if (rememberedModelListApiKey) {
      modelFetchKeyEntries.sort((left, right) =>
        left.apiKey === rememberedModelListApiKey
          ? -1
          : right.apiKey === rememberedModelListApiKey
          ? 1
          : 0,
      );
    }
    const payloadResults: Array<{
      data: any;
      groupName?: string;
      candidate: FetchCandidate;
    }> = [];

    const collectAllModelPayloads = async (
      candidateUrls: FetchCandidate[],
      requestHeaders: Record<string, string>,
      requestBaseUrl?: string,
      authCachePrefix?: string,
    ) => {
      // 缓存命中时只尝试缓存 key（1 次）；未命中或缓存失败时尝试全部 key
      const hasCachedKey = Boolean(rememberedModelListApiKey);
      let useCacheKeyOnly = Boolean(rememberedModelListPath && hasCachedKey);
      const cacheKeyEntry = hasCachedKey
        ? {
            groupName: undefined as string | undefined,
            apiKey: rememberedModelListApiKey,
          }
        : null;
      let entries =
        useCacheKeyOnly && cacheKeyEntry
          ? [cacheKeyEntry]
          : modelFetchKeyEntries.length > 0
          ? modelFetchKeyEntries
          : [{ groupName: undefined, apiKey: modelFetchApiKeyCandidates[0] }];

      for (
        let candidateIndex = 0;
        candidateIndex < candidateUrls.length;
        candidateIndex += 1
      ) {
        const candidate = candidateUrls[candidateIndex];
        for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
          const entry = entries[entryIndex];
          if (!entry.apiKey) continue;

          // 缓存直连时先提示再请求
          if (useCacheKeyOnly && candidateIndex === 0 && entryIndex === 0) {
            console.log(
              `[Fetch Models] 🗃️ 已直接复用缓存成功路径 ${candidateUrls[0]}`,
            );
          }

          const nextHeaders = {
            ...requestHeaders,
            ...buildAuthHeaders(entry.apiKey, authType),
          };

          let results: any[] = [];
          let fetchError: Error | undefined;
          try {
            results = await fetchAllJsonWithCandidates(
              [candidate],
              nextHeaders,
              requestBaseUrl,
              {
                authorizationCandidates: getAuthorizationCandidates(
                  [entry.apiKey],
                  authType,
                ),
                authorizationHeaderName:
                  Object.keys(buildAuthHeaders("__key__", authType))[0] || "",
                authType,
                authQueryParam,
                authCacheKey: authCachePrefix
                  ? `${authCachePrefix}:${entry.groupName || "default"}`
                  : undefined,
                suppressStatusCodes: [404],
                suppressCandidateErrors: true,
                logAttempt: !useCacheKeyOnly, // 缓存直连时禁用进度日志
                logSuccess: false,
                getModelCount: (payload) =>
                  extractModelListFromResponse(payload, requestBaseUrl).length,
                validateJson: (payload) =>
                  extractModelListFromResponse(payload, requestBaseUrl).length >
                  0,
                outerIndex: candidateIndex,
                outerTotal: candidateUrls.length,
                keyIndex: entryIndex + 1,
                keyTotal: entries.length,
              },
            );
          } catch (error) {
            fetchError =
              error instanceof Error ? error : new Error(String(error));
          }

          // 缓存 key 失败后，切换到完整探测模式
          if (
            fetchError &&
            useCacheKeyOnly &&
            cacheKeyEntry &&
            entryIndex === 0
          ) {
            console.warn(
              `[Fetch Models] ⚠️ 缓存 key 失败，切换到完整探测模式`,
              fetchError.message,
            );
            useCacheKeyOnly = false;
            entries =
              modelFetchKeyEntries.length > 0
                ? modelFetchKeyEntries
                : [
                    {
                      groupName: undefined,
                      apiKey: modelFetchApiKeyCandidates[0],
                    },
                  ];
            // 重置 entryIndex，从第一个 key 重新尝试
            entryIndex = -1;
            continue;
          }

          if (fetchError) {
            if (!useCacheKeyOnly) {
              console.warn(
                `[Fetch Models] ⚠️ 路径 ${candidateIndex + 1}/${
                  candidateUrls.length
                } 使用 key ${entryIndex + 1}/${entries.length}（${
                  entry.groupName || "default"
                }）失败`,
                fetchError.message,
              );
            }
            continue;
          }

          results.forEach((result) => {
            payloadResults.push({
              data: result.data,
              groupName: entry.groupName,
              candidate: result.candidate,
            });
          });
          if (results.length > 0) {
            const successfulPath =
              typeof candidate === "string"
                ? candidate
                : candidate.upstreamPath || candidate.url;
            console.log("[Fetch Models] ✅ 当前路径与 Key 查询模型成功", {
              path: successfulPath,
              key: `${entryIndex + 1}/${entries.length}（${
                entry.groupName || "default"
              }）`,
              modelCount: extractModelListFromResponse(
                results[0].data,
                requestBaseUrl,
              ).length,
            });
            // 只有非缓存直连模式成功时才缓存（复用失败重试成功才缓存）
            if (!useCacheKeyOnly) {
              rememberModelListPath(
                pathMemoryParams,
                successfulPath,
                entry.apiKey,
              );
              console.log("[Fetch Models] 💾 已缓存成功模型路径", {
                path: successfulPath,
              });
            }
            if (rememberedModelListPath && candidateIndex === 0) {
              console.log("[Fetch Models] 🗃️ 已直接复用缓存成功路径", {
                path: successfulPath,
              });
            }
            return;
          }
        }
      }
    };

    if (baseUrl && profileOpenAICompatible) {
      const effectiveBaseUrl =
        provider === ServiceProvider.Local
          ? normalizeLocalProxyBaseUrl(baseUrl)
          : baseUrl;
      const effectiveNormalizedBaseUrl = normalizeBaseUrl(effectiveBaseUrl);
      const baseWithoutV1 = effectiveNormalizedBaseUrl.replace(/\/v1$/, "");
      const proxyBaseUrl = isServerSide() ? baseUrl : baseWithoutV1;

      headers["x-base-url"] =
        provider === ServiceProvider.Local ? baseWithoutV1 : proxyBaseUrl;

      // 按兼容性顺序依次尝试所有候选模型接口
      const allCandidateUrls: FetchCandidate[] = buildProxyModelFetchCandidates(
        baseUrl,
        rememberedModelListPath,
      );
      const candidateUrls = rememberedModelListPath
        ? allCandidateUrls.slice(0, 1)
        : allCandidateUrls;

      if (rememberedModelListPath) {
        logFetchModels(
          `[Fetch Models] 🗃️ 缓存直连：仅尝试 ${rememberedModelListPath}`,
        );
      } else {
        logFetchModels(
          `[Fetch Models] 📋 将依次尝试 ${candidateUrls.length} 个模型接口`,
        );
      }

      await collectAllModelPayloads(
        candidateUrls,
        headers,
        baseUrl,
        normalizedBaseUrl ? `model-fetch:${normalizedBaseUrl}` : undefined,
      );
      data = payloadResults[0]?.data;

      // 如果缓存直连失败，清除缓存并尝试全量 fallback 探测
      if (!data && rememberedModelListPath) {
        console.warn(
          `[Fetch Models] ⚠️ 缓存直连失败 (${rememberedModelListPath})，清除缓存并重新尝试全量探测...`,
        );
        rememberModelListPath(pathMemoryParams, undefined, undefined);
        const fallbackUrls = allCandidateUrls.filter(
          (c) =>
            (typeof c === "string" ? c : c.upstreamPath || c.url) !==
            rememberedModelListPath,
        );
        payloadResults.length = 0;
        await collectAllModelPayloads(
          fallbackUrls,
          headers,
          baseUrl,
          normalizedBaseUrl ? `model-fetch:${normalizedBaseUrl}` : undefined,
        );
        data = payloadResults[0]?.data;
      }
    } else {
      const normalizedProviderBaseUrl = baseUrl
        ? normalizeBaseUrl(baseUrl)
        : "";
      const allCandidateUrls = isLocalModelProxyBaseUrl(
        normalizedProviderBaseUrl,
      )
        ? [apiPath]
        : normalizedProviderBaseUrl && profileOpenAICompatible
        ? buildProxyModelFetchCandidates(
            normalizedProviderBaseUrl,
            rememberedModelListPath,
          )
        : [apiPath];
      const candidateUrls = rememberedModelListPath
        ? allCandidateUrls.slice(0, 1)
        : allCandidateUrls;

      const nextHeaders = { ...headers };
      if (
        normalizedProviderBaseUrl &&
        !isLocalModelProxyBaseUrl(normalizedProviderBaseUrl)
      ) {
        nextHeaders["x-base-url"] = normalizedProviderBaseUrl.replace(
          /\/v1$/i,
          "",
        );
      }

      if (rememberedModelListPath) {
        logFetchModels(
          `[Fetch Models] 🗃️ ${provider} 缓存直连：仅尝试 ${rememberedModelListPath}`,
        );
      } else {
        logFetchModels(
          `[Fetch Models] 📋 ${provider} 将依次尝试 ${candidateUrls.length} 个模型接口`,
        );
      }

      try {
        await collectAllModelPayloads(
          candidateUrls,
          nextHeaders,
          nextHeaders["x-base-url"] || normalizedProviderBaseUrl,
          normalizedProviderBaseUrl
            ? `model-fetch:${provider}:${normalizedProviderBaseUrl}`
            : undefined,
        );
        data = payloadResults[0]?.data;

        // 如果缓存直连失败，清除缓存并尝试全量 fallback 探测
        if (!data && rememberedModelListPath) {
          console.warn(
            `[Fetch Models] ⚠️ ${provider} 缓存直连失败 (${rememberedModelListPath})，清除缓存并重新尝试全量探测...`,
          );
          rememberModelListPath(pathMemoryParams, undefined, undefined);
          const fallbackUrls = allCandidateUrls.filter(
            (c) =>
              (typeof c === "string" ? c : c.upstreamPath || c.url) !==
              rememberedModelListPath,
          );
          payloadResults.length = 0;
          await collectAllModelPayloads(
            fallbackUrls,
            nextHeaders,
            nextHeaders["x-base-url"] || normalizedProviderBaseUrl,
            normalizedProviderBaseUrl
              ? `model-fetch:${provider}:${normalizedProviderBaseUrl}`
              : undefined,
          );
          data = payloadResults[0]?.data;
        }
      } catch (error) {
        console.warn(
          `[Fetch Models] ⚠️ 从 ${provider} 获取模型失败:`,
          error instanceof Error ? error.message : String(error),
        );
        return { models: [], total: 0 };
      }
    }

    // 标准化模型列表响应
    let models: any[] = [];

    // 提取供应商映射
    let vendorsMap: Record<number, { name: string; icon?: string }> | undefined;
    let catalogMetadataMap:
      | Map<
          string,
          { rank: number; vendor?: { id: number; name: string; icon?: string } }
        >
      | undefined;
    let classificationMap:
      | Map<string, { features?: string[]; types?: string[] }>
      | undefined;

    if (isAiHubMixUrl(baseUrl)) {
      try {
        catalogMetadataMap = await getAiHubMixCatalogMetadataMap(baseUrl!);
      } catch (error) {
        console.warn(
          "[Fetch Models] 获取 AihubMix 模型目录顺序失败，将回退到原始返回顺序",
          error instanceof Error ? error.message : String(error),
        );
      }
      try {
        classificationMap = await getAiHubMixClassificationMap(baseUrl!);
      } catch (error) {
        console.warn(
          "[Fetch Models] 获取 AihubMix 分类元数据失败，将回退到当前模型字段",
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // YutoAPI: 从 vendors 数组构建映射
    if (data?.vendors && Array.isArray(data.vendors)) {
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

    // 统一兼容 OpenAI、聚合商、Ollama、网关面板等常见模型列表格式
    models = data ? extractModelListFromResponse(data, baseUrl) : [];

    const mergedModelMap = new Map<string, LLMModel>();
    for (const result of payloadResults) {
      const payload = result.data;
      let payloadVendorsMap = vendorsMap;
      if (payload?.vendors && Array.isArray(payload.vendors)) {
        payloadVendorsMap = {};
        payload.vendors.forEach((vendor: any) => {
          payloadVendorsMap![vendor.id] = {
            name: vendor.name,
            icon: vendor.icon,
          };
        });
      }

      mapModels(
        extractModelListFromResponse(payload, baseUrl),
        providerId,
        providerName,
        providerType,
        sorted,
        payloadVendorsMap,
        result.groupName,
        catalogMetadataMap,
        classificationMap,
      ).forEach((model) => {
        const key = `${model.name}@${model.provider?.id}`;
        if (!mergedModelMap.has(key)) {
          mergedModelMap.set(key, model);
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

    if (isYutoApiUrl(baseUrl, profileName || matchedProviderProfile?.name)) {
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl!);
      const baseWithoutV1 = normalizedBaseUrl.replace(/\/v1$/, "");
      const candidateUrls = isServerSide()
        ? [`${baseWithoutV1}/api/pricing`, `${baseWithoutV1}/pricing`]
        : baseWithoutV1.includes("toapis.com")
        ? ["/api/toapis/pricing"]
        : ["/api/yuto/pricing"];

      const fetchKey = apiKey || "";

      const fetchHeaders: Record<string, string> = {
        Authorization: `Bearer ${fetchKey}`,
        ...(baseUrl ? { "x-base-url": baseUrl } : {}),
      };
      const pricingData = await fetchJsonWithCandidates(
        candidateUrls,
        fetchHeaders,
        baseUrl,
        {
          logSuccess: true,
          logAttempt: false,
          logLabel: "Yuto 定价接口",
          authCacheKey: `yuto:${normalizedBaseUrl}`,
          suppressCandidateErrors: true,
          suppressStatusCodes: [404],
          getModelCount: (payload) =>
            payload?.vendors &&
            Array.isArray(payload.vendors) &&
            Array.isArray(payload?.data)
              ? payload.data.length
              : 0,
        },
      );

      const pricingModels =
        pricingData?.vendors &&
        Array.isArray(pricingData.vendors) &&
        pricingData?.data &&
        Array.isArray(pricingData.data)
          ? pricingData.data
          : [];
      const vendorsMap: Record<number, { name: string; icon?: string }> = {};
      (pricingData?.vendors || []).forEach((vendor: any) => {
        vendorsMap[vendor.id] = { name: vendor.name, icon: vendor.icon };
      });

      // 单次请求获取全部模型，根据 enable_groups 分配最优 apiKeyGroup
      const autoGroups: string[] = pricingData?.auto_groups || [];
      const mappedModels = mapModels(
        pricingModels,
        providerId,
        providerName,
        providerType,
        sorted,
        vendorsMap,
        undefined,
        catalogMetadataMap,
        classificationMap,
      ).map((model) => {
        const raw = pricingModels.find((m: any) => m.model_name === model.name);
        const enableGroups: string[] = raw?.enable_groups || [];
        const bestGroup = autoGroups
          .filter((g) => enableGroups.includes(g))
          .sort((a, b) => {
            const availableGroupKeys = Object.keys(apiKeyGroups || {});
            const aHas = availableGroupKeys.includes(a) ? 1 : 0;
            const bHas = availableGroupKeys.includes(b) ? 1 : 0;
            return bHas - aHas;
          })[0];
        return {
          ...model,
          apiKeyGroup: bestGroup || "default",
        };
      });

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
        undefined,
        catalogMetadataMap,
        classificationMap,
      );
      return {
        models: mappedModels,
        total: mappedModels.length,
      };
    }

    if (
      isOcoolaiUrl(baseUrl, profileName || matchedProviderProfile?.name) &&
      apiKeyGroups &&
      Object.keys(apiKeyGroups).length > 0
    ) {
      const modelFetchApiKeyCandidates = getModelFetchApiKeyCandidates({
        modelFetchApiKey: matchedProviderProfile?.modelFetchApiKey,
        apiKey: matchedProviderProfile?.apiKey || apiKey,
        apiKeyGroups,
        multiKeyGroupOrder:
          matchedProviderProfile?.multiKeyGroupOrder || multiKeyGroupOrder,
      });
      const normalizedBaseUrl = normalizeBaseUrl(baseUrl!);
      const baseWithoutV1 = normalizedBaseUrl.replace(/\/v1$/, "");
      const orderedGroupNames = [
        ...(matchedProviderProfile?.multiKeyGroupOrder ||
          multiKeyGroupOrder ||
          []),
        ...Object.keys(apiKeyGroups),
      ].filter((group, index, all) => group && all.indexOf(group) === index);
      const groupedEntries = orderedGroupNames
        .map((groupName) => [groupName, apiKeyGroups[groupName] || ""] as const)
        .filter(([key, value]) => key && value?.trim());
      const mergedModelMap = new Map<string, LLMModel>();

      for (const [groupName, groupApiKey] of groupedEntries) {
        try {
          const groupResults = await fetchAllJsonWithCandidates(
            buildProxyModelFetchCandidates(baseWithoutV1),
            {
              ...headers,
              ...buildAuthHeaders(groupApiKey, authType),
              ...(baseUrl ? { "x-base-url": baseWithoutV1 } : {}),
            },
            baseUrl,
            {
              logLabel: `分组 ${groupName} 模型接口`,
              authorizationCandidates: getAuthorizationCandidates(
                [groupApiKey],
                authType,
              ),
              authorizationHeaderName:
                Object.keys(buildAuthHeaders("__key__", authType))[0] || "",
              authType,
              authQueryParam,
              authCacheKey: `ocool-models:${normalizedBaseUrl}:${groupName}`,
              suppressCandidateErrors: true,
              suppressStatusCodes: [404],
              getModelCount: (payload) =>
                extractModelListFromResponse(payload, baseUrl).length,
              validateJson: (payload) =>
                extractModelListFromResponse(payload, baseUrl).length > 0,
            },
          );
          for (const result of groupResults) {
            const groupModels = extractModelListFromResponse(
              result.data,
              baseUrl,
            );

            mapModels(
              groupModels,
              providerId,
              providerName,
              providerType,
              sorted,
              vendorsMap,
              groupName,
              catalogMetadataMap,
              classificationMap,
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
        } catch (error) {
          console.warn(
            `[Fetch Models] Ocoolai 分组 ${groupName} 获取失败，继续尝试其他分组`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      if (mergedModelMap.size > 0) {
        const mappedModels = [...mergedModelMap.values()];
        return {
          models: mappedModels,
          total: mappedModels.length,
        };
      }

      const groupsData = await fetchJsonWithCandidates(
        [
          {
            url: "/api/proxy/api/user/available_models_by_groups",
            displayBaseUrl: baseWithoutV1,
            headerBaseUrl: baseWithoutV1,
            upstreamPath: "/api/user/available_models_by_groups",
          },
        ],
        {
          Authorization: `Bearer ${modelFetchApiKeyCandidates[0] || ""}`,
          ...(baseUrl ? { "x-base-url": baseWithoutV1 } : {}),
        },
        baseUrl,
        {
          logLabel: "分组接口",
          logAttempt: false,
          authorizationCandidates: getAuthorizationCandidates(
            modelFetchApiKeyCandidates,
            authType,
          ),
          authorizationHeaderName:
            Object.keys(buildAuthHeaders("__key__", authType))[0] || "",
          authType,
          authQueryParam,
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
          catalogMetadataMap,
          classificationMap,
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

    if (models.length === 0) {
      throw new Error("未找到可用的模型接口");
    }

    if (isAiHubMixUrl(baseUrl)) {
      const mappedModels = mapModels(
        models,
        providerId,
        providerName,
        providerType,
        sorted,
        vendorsMap,
        undefined,
        catalogMetadataMap,
        classificationMap,
      );
      return {
        models: mappedModels,
        total: mappedModels.length,
      };
    }

    if (isOcoolaiUrl(baseUrl, profileName || matchedProviderProfile?.name)) {
      const mappedModels = mapModels(
        models,
        providerId,
        providerName,
        providerType,
        sorted,
        vendorsMap,
        undefined,
        catalogMetadataMap,
        classificationMap,
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
      undefined,
      catalogMetadataMap,
      classificationMap,
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
  const accessStore = useAccessStore.getState();
  const configStore = useAppConfig.getState() as any;

  // 仅替换本次拉取到的供应商模型，其他供应商模型保持不变。
  configStore.mergeModels(models, { silent: true });

  // 当前启用平台的可用模型只跟随本次真实获取结果，不再叠加历史缓存。
  accessStore.update((state) => {
    state.apiProfiles = (state.apiProfiles || []).map((profile) =>
      profile.enabled
        ? {
            ...profile,
            modelCount: models.length,
          }
        : profile,
    );
  });
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
