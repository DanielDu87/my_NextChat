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
  buildProxyModelFetchCandidates,
  getModelFetchApiKeyCandidates,
  isLocalModelProxyBaseUrl,
} from "./model-fetch-common";
import { getEffectiveProviderBaseUrl } from "./provider-url";

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
let aihubmixCatalogMetadataMapPromise: Promise<
  Map<
    string,
    { rank: number; vendor?: { id: number; name: string; icon?: string } }
  >
> | null = null;
let aihubmixClassificationMapPromise: Promise<
  Map<string, { features?: string[]; types?: string[] }>
> | null = null;

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
      hostname === "api.ocoolai.com" ||
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

function getRawModelName(model: any) {
  if (typeof model === "string") return model;
  return model?.id || model?.name || model?.model_id || model?.model_name;
}

function normalizeModelItems(items: any[]) {
  return items
    .map((item) => (typeof item === "string" ? { id: item } : item))
    .filter((item) => Boolean(getRawModelName(item)));
}

function extractOcoolaiAvailableModels(data: any): any[] {
  if (data?.success === true && Array.isArray(data?.data)) {
    return normalizeModelItems(data.data);
  }

  if (Array.isArray(data)) {
    return normalizeModelItems(data);
  }

  if (Array.isArray(data?.items)) {
    return normalizeModelItems(data.items);
  }

  if (Array.isArray(data?.data)) {
    return normalizeModelItems(data.data);
  }

  if (data?.data && typeof data.data === "object") {
    return normalizeModelItems(Object.values(data.data));
  }

  if (Array.isArray(data?.models)) {
    return normalizeModelItems(data.models);
  }

  if (Array.isArray(data?.data?.models)) {
    return normalizeModelItems(data.data.models);
  }

  if (Array.isArray(data?.data?.Models)) {
    return normalizeModelItems(data.data.Models);
  }

  if (Array.isArray(data?.data?.groups)) {
    return normalizeModelItems(
      data.data.groups.flatMap((group: any) =>
        Array.isArray(group?.models)
          ? group.models
          : Array.isArray(group?.items)
            ? group.items
            : [],
      ),
    );
  }

  if (Array.isArray(data?.groups)) {
    return normalizeModelItems(
      data.groups.flatMap((group: any) =>
        Array.isArray(group?.models)
          ? group.models
          : Array.isArray(group?.items)
            ? group.items
            : [],
      ),
    );
  }

  return [];
}

function extractModelListFromResponse(data: any, baseUrl?: string): any[] {
  if (
    data?.vendors &&
    Array.isArray(data.vendors) &&
    Array.isArray(data?.data)
  ) {
    return normalizeModelItems(data.data);
  }

  if (isOcoolaiUrl(baseUrl)) {
    return extractOcoolaiAvailableModels(data);
  }

  const candidates = [
    data?.data,
    data?.models,
    data?.items,
    data?.data?.models,
    data?.data?.Models,
    data?.data?.items,
    data?.result,
    data?.result?.models,
    data?.result?.data,
    data?.payload?.models,
    data?.payload?.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      const normalized = normalizeModelItems(candidate);
      if (normalized.length > 0) return normalized;
    }
  }

  const objectCandidates = [
    data?.data,
    data?.models,
    data?.result,
    data?.payload,
  ];
  for (const candidate of objectCandidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      !Array.isArray(candidate)
    ) {
      const values = Object.values(candidate);
      if (values.length === 0) continue;
      const normalizedValues = normalizeModelItems(values);
      if (normalizedValues.length > 0) return normalizedValues;
    }
  }

  if (Array.isArray(data?.data?.groups) || Array.isArray(data?.groups)) {
    return extractOcoolaiAvailableModels(data);
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

async function fetchAiHubMixCatalogMetadataMap() {
  const response = await fetch("/api/aihubmix/models", {
    method: "GET",
    headers: {
      Accept: "application/json",
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

async function fetchAiHubMixClassificationMap() {
  const response = await fetch(
    "/api/aihubmix/models?source=page&p=0&num=10000",
    {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    },
  );

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

async function getAiHubMixCatalogMetadataMap() {
  if (!aihubmixCatalogMetadataMapPromise) {
    aihubmixCatalogMetadataMapPromise = fetchAiHubMixCatalogMetadataMap().catch(
      (error) => {
        const cachedMetadataMap = readAiHubMixCatalogMetadataCache();
        if (cachedMetadataMap.size > 0) {
          console.warn(
            "[Fetch Models] AihubMix 模型目录顺序拉取失败，回退到本地缓存",
            error instanceof Error ? error.message : String(error),
          );
          return cachedMetadataMap;
        }
        aihubmixCatalogMetadataMapPromise = null;
        throw error;
      },
    );
  }

  return aihubmixCatalogMetadataMapPromise;
}

async function getAiHubMixClassificationMap() {
  if (!aihubmixClassificationMapPromise) {
    aihubmixClassificationMapPromise = fetchAiHubMixClassificationMap().catch(
      (error) => {
        const cachedClassificationMap = readAiHubMixClassificationCache();
        if (cachedClassificationMap.size > 0) {
          console.warn(
            "[Fetch Models] AihubMix 分类元数据拉取失败，回退到本地缓存",
            error instanceof Error ? error.message : String(error),
          );
          return cachedClassificationMap;
        }
        aihubmixClassificationMapPromise = null;
        throw error;
      },
    );
  }

  return aihubmixClassificationMapPromise;
}

/**
 * 将相对路径转为完整 URL 用于日志显示
 */
function fullUrl(url: string, baseUrl?: string): string {
  if (url.startsWith("/")) {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (url.startsWith("/api/ocoolai/available-models-by-groups")) {
      return `${origin}${url} (固定 → https://one.ocoolai.com/api/user/available_models_by_groups)`;
    }
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
        : (candidate.displayBaseUrl ?? baseUrl);
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
      if (authorization) {
        requestHeaders.Authorization = authorization;
      } else {
        delete requestHeaders.Authorization;
      }
      const logPayload = {
        url: display,
        keyIndex: authIndex + 1,
        keyTotal: orderedAuthCandidates.length,
      };
      const progressPrefix = `第 ${i + 1}/${urls.length} 个接口，第 ${
        authIndex + 1
      }/${orderedAuthCandidates.length} 个 key`;
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
            `[Fetch Models] 🔁 正在尝试${logLabel}：${progressPrefix} ${interfaceLabel}`,
            logPayload,
          );
        }
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15_000);
        const response = await fetchModelCandidate(
          url,
          requestHeaders,
          controller.signal,
        ).finally(() => clearTimeout(timeoutId));

        if (!response.ok) {
          lastError = new Error(`${response.status} ${response.statusText}`);
          recordAttempt(`${response.status} ${response.statusText}`.trim());
          if (logAttempt && response.status === 404) {
            logFetchModels(
              `[Fetch Models] 💡 ${logLabel}尝试失败：${progressPrefix} ${interfaceLabel}，原因：404 不存在`,
              logPayload,
            );
          } else if (logAttempt && suppressStatusCodes.has(response.status)) {
            logFetchModels(
              `[Fetch Models] 💡 ${logLabel}尝试失败：${progressPrefix} ${interfaceLabel}，原因：${response.status} ${response.statusText}`.trim(),
              logPayload,
            );
          } else if (logAttempt) {
            logFetchModels(
              `[Fetch Models] ⚠️ ${logLabel}尝试失败：${progressPrefix} ${interfaceLabel}，原因：${response.status} ${response.statusText}`.trim(),
              logPayload,
            );
          }
          continue;
        }

        const contentType = response.headers.get("content-type") || "";
        if (contentType && !contentType.toLowerCase().includes("json")) {
          lastError = new Error(`响应不是 JSON (${contentType})`);
          recordAttempt(`非 JSON (${contentType})`);
          if (logAttempt) {
            logFetchModels(
              `[Fetch Models] 💡 ${logLabel}尝试失败：${progressPrefix} ${interfaceLabel}，原因：返回非 JSON (${contentType})`,
              logPayload,
            );
          }
          continue;
        }

        let data: any;
        try {
          data = await response.json();
        } catch (error) {
          lastError =
            error instanceof Error ? error : new Error("响应 JSON 解析失败");
          recordAttempt("JSON 解析失败");
          if (logAttempt && options?.suppressNonJsonResponse !== false) {
            logFetchModels(
              `[Fetch Models] 💡 ${logLabel}尝试失败：${progressPrefix} ${interfaceLabel}，原因：JSON 解析失败`,
              logPayload,
            );
          } else if (logAttempt && !options?.suppressCandidateErrors) {
            logFetchModels(
              `[Fetch Models] ⚠️ 第 ${i + 1} 个 URL 响应 JSON 解析失败`,
              error,
            );
          }
          continue;
        }
        if (options?.validateJson && !options.validateJson(data)) {
          recordAttempt("内容无有效模型列表");
          if (logAttempt) {
            logFetchModels(
              `[Fetch Models] 💡 ${logLabel}尝试失败：${progressPrefix} ${interfaceLabel}，原因：内容无有效模型列表`,
              logPayload,
            );
          }
          lastError = new Error("响应内容无效");
          continue;
        }
        recordAttempt("成功");
        const modelCount = options?.getModelCount?.(data);
        const modelCountText =
          typeof modelCount === "number" ? `，获取到 ${modelCount} 个模型` : "";
        if (options?.logSuccess !== false) {
          logFetchModels(
            `[Fetch Models] ✅ ${logLabel}获取成功：${progressPrefix} ${interfaceLabel}${modelCountText}`,
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
        return data;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          lastError = new Error("请求超时，请检查网络连接");
        } else {
          lastError = error instanceof Error ? error : new Error("请求失败");
        }
        recordAttempt(lastError.message || "请求失败");
        if (logAttempt && !options?.suppressCandidateErrors) {
          logFetchModels(
            `[Fetch Models] ⚠️ ${logLabel}尝试失败：${progressPrefix} ${interfaceLabel}，原因：${lastError.message}`,
            error,
          );
        }
      }
    }
  }

  logFetchModels(`[Fetch Models] ⚠️ ${logLabel}全部候选均未成功`, {
    tried: attempts,
    lastError: lastError?.message,
  });
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
  multiKeyGroupOrder?: string[],
): Promise<FetchModelsResult> {
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
    const accessProfiles = useAccessStore.getState().apiProfiles || [];
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
      headers["Authorization"] = `Bearer ${modelFetchApiKeyCandidates[0]}`;
    }

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
        provider === ServiceProvider.OpenAI ||
        provider === ServiceProvider.Custom ||
        provider === ServiceProvider.Local
      ) {
        headers["x-base-url"] =
          provider === ServiceProvider.Local ? baseWithoutV1 : proxyBaseUrl;
      }

      logFetchModels(`[Fetch Models] 🔍 检测 baseUrl:`, {
        baseUrl,
        normalizedBaseUrl: effectiveNormalizedBaseUrl,
        isServerSide: isServerSide(),
        hasApiKey: !!apiKey,
        apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + "..." : "none",
      });

      // 按兼容性顺序依次尝试所有候选模型接口
      const candidateUrls: FetchCandidate[] =
        buildProxyModelFetchCandidates(baseUrl);

      logFetchModels(
        `[Fetch Models] 📋 将依次尝试 ${candidateUrls.length} 个模型接口`,
      );

      data = await fetchJsonWithCandidates(candidateUrls, headers, baseUrl, {
        authorizationCandidates: modelFetchApiKeyCandidates.map(
          (key) => `Bearer ${key}`,
        ),
        authCacheKey: normalizedBaseUrl
          ? `model-fetch:${normalizedBaseUrl}`
          : undefined,
        suppressStatusCodes: [404],
        logSuccess: !isYutoApiUrl(baseUrl),
        getModelCount: (payload) =>
          extractModelListFromResponse(payload, baseUrl).length,
        validateJson: (payload) =>
          extractModelListFromResponse(payload, baseUrl).length > 0,
      });
    } else {
      const normalizedProviderBaseUrl = baseUrl
        ? normalizeBaseUrl(baseUrl)
        : "";
      const candidateUrls = isLocalModelProxyBaseUrl(normalizedProviderBaseUrl)
        ? [apiPath]
        : normalizedProviderBaseUrl
          ? buildProxyModelFetchCandidates(normalizedProviderBaseUrl)
          : [apiPath];

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

      logFetchModels(
        `[Fetch Models] 📋 ${provider} 将依次尝试 ${candidateUrls.length} 个模型接口`,
      );

      try {
        data = await fetchJsonWithCandidates(
          candidateUrls,
          nextHeaders,
          nextHeaders["x-base-url"] || normalizedProviderBaseUrl,
          {
            authorizationCandidates: modelFetchApiKeyCandidates.map(
              (key) => `Bearer ${key}`,
            ),
            authCacheKey: normalizedProviderBaseUrl
              ? `model-fetch:${provider}:${normalizedProviderBaseUrl}`
              : undefined,
            suppressStatusCodes: [404],
            getModelCount: (payload) =>
              extractModelListFromResponse(
                payload,
                nextHeaders["x-base-url"] || normalizedProviderBaseUrl,
              ).length,
            validateJson: (payload) =>
              extractModelListFromResponse(
                payload,
                nextHeaders["x-base-url"] || normalizedProviderBaseUrl,
              ).length > 0,
          },
        );
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

    try {
      catalogMetadataMap = await getAiHubMixCatalogMetadataMap();
    } catch (error) {
      console.warn(
        "[Fetch Models] 获取 AihubMix 模型目录顺序失败，将回退到原始返回顺序",
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      classificationMap = await getAiHubMixClassificationMap();
    } catch (error) {
      console.warn(
        "[Fetch Models] 获取 AihubMix 分类元数据失败，将回退到当前模型字段",
        error instanceof Error ? error.message : String(error),
      );
    }

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

    // 统一兼容 OpenAI、聚合商、Ollama、网关面板等常见模型列表格式
    models = extractModelListFromResponse(data, baseUrl);

    if (isYutoApiUrl(baseUrl)) {
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
      isOcoolaiUrl(baseUrl) &&
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
          logLabel: "分组接口",
          logAttempt: false,
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

    if (isOcoolaiUrl(baseUrl)) {
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
