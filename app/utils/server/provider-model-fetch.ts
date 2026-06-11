import { ServiceProvider } from "@/app/constant";
import { requestUpstream } from "@/app/api/upstream";
import { applyModelPublishedAt } from "@/app/utils/model-published-at";
import { normalizeModelClassification } from "@/app/utils/model-classification";
import {
  buildModelFetchCandidateUrls,
  getModelFetchApiKeyCandidates,
} from "@/app/utils/model-fetch-common";

export type SyncedLLMModel = {
  name: string;
  displayName?: string;
  available: boolean;
  provider: {
    id: string;
    providerName: string;
    providerType: string;
    sorted: number;
  };
  sorted: number;
  publishedAt?: number;
  publishedAtSource?: string;
  publishedAtUrl?: string;
  publishedAtNote?: string;
  catalogRank?: number;
  remoteRank?: number;
  remoteRankSource?: string;
  vendor?: {
    id: number;
    name: string;
    icon?: string;
  };
  category?: string;
  categorySource?: 0 | 1;
  type?: string;
  types?: string[];
  features?: string[];
  capabilities?: string[];
  categories?: string[];
  apiKeyGroup?: string;
};

export type ServerFetchModelsResult = {
  models: SyncedLLMModel[];
  total: number;
};

type ProviderFetchPreset = {
  providerId: string;
  providerName: string;
  providerType: string;
  sorted: number;
  strategy?: "openai_compatible" | "unsupported";
};

const AIHUBMIX_VENDOR_MAP: Record<number, { name: string; icon?: string }> = {
  1: { name: "OpenAI", icon: "OpenAI" },
  2: { name: "Anthropic", icon: "Claude.Color" },
  3: { name: "Microsoft", icon: "Nvidia" },
  4: { name: "ByteDance", icon: "Doubao.Color" },
  5: { name: "Zhipu", icon: "Zhipu.Color" },
  6: { name: "Cohere", icon: "Cohere" },
  7: { name: "DeepSeek", icon: "DeepSeek.Color" },
  8: { name: "Google", icon: "Gemini.Color" },
  9: { name: "xAI", icon: "XAI" },
  10: { name: "Mistral", icon: "Mistral.Color" },
  11: { name: "Meta", icon: "Meta.Color" },
  12: { name: "OpenAI", icon: "OpenAI" },
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

let aihubmixCatalogMetadataMapPromise: Promise<
  Map<
    string,
    { rank: number; vendor?: { id: number; name: string; icon?: string } }
  >
> | null = null;
let aihubmixClassificationMapPromise: Promise<
  Map<string, { features?: string[]; types?: string[] }>
> | null = null;
const TRAILING_RELEASE_DATE_PATTERN =
  /(?:[-_.](?:20\d{2}[-_.]?(?:0[1-9]|1[0-2])[-_.]?(?:0[1-9]|[12]\d|3[01])|(?:0[1-9]|1[0-2])[-_.](?:0[1-9]|[12]\d|3[01])))$/i;

function getAiHubMixLookupKeys(name: string) {
  const normalizedName = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\bgpt-40\b/g, "gpt-4o")
    .replace(/\bgpt-40(?=[-_.])/g, "gpt-4o")
    .replace(/\bchatgpt-40\b/g, "chatgpt-4o")
    .replace(/\bchatgpt-40(?=[-_.])/g, "chatgpt-4o");
  if (!normalizedName) {
    return [];
  }

  const withoutTrailingDate = normalizedName
    .replace(TRAILING_RELEASE_DATE_PATTERN, "")
    .replace(/[-_.]+$/, "");

  return [...new Set([normalizedName, withoutTrailingDate].filter(Boolean))];
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

const PROVIDER_FETCH_PRESETS: Partial<
  Record<ServiceProvider, ProviderFetchPreset>
> = {
  [ServiceProvider.Custom]: {
    providerId: "custom",
    providerName: "Custom",
    providerType: "openai",
    sorted: 0,
    strategy: "openai_compatible",
  },
  [ServiceProvider.OpenAI]: {
    providerId: "openai",
    providerName: "OpenAI",
    providerType: "openai",
    sorted: 1,
    strategy: "openai_compatible",
  },
  [ServiceProvider.Azure]: {
    providerId: "azure",
    providerName: "Azure",
    providerType: "azure",
    sorted: 2,
    strategy: "openai_compatible",
  },
  [ServiceProvider.Google]: {
    providerId: "google",
    providerName: "Google",
    providerType: "google",
    sorted: 3,
    strategy: "openai_compatible",
  },
  [ServiceProvider.Anthropic]: {
    providerId: "anthropic",
    providerName: "Anthropic",
    providerType: "anthropic",
    sorted: 4,
    strategy: "openai_compatible",
  },
  [ServiceProvider.Baidu]: {
    providerId: "baidu",
    providerName: "Baidu",
    providerType: "baidu",
    sorted: 5,
    strategy: "openai_compatible",
  },
  [ServiceProvider.ByteDance]: {
    providerId: "bytedance",
    providerName: "ByteDance",
    providerType: "bytedance",
    sorted: 6,
    strategy: "openai_compatible",
  },
  [ServiceProvider.Alibaba]: {
    providerId: "alibaba",
    providerName: "Alibaba",
    providerType: "alibaba",
    sorted: 7,
    strategy: "openai_compatible",
  },
  [ServiceProvider.Tencent]: {
    providerId: "tencent",
    providerName: "Tencent",
    providerType: "tencent",
    sorted: 8,
    strategy: "openai_compatible",
  },
  [ServiceProvider.Moonshot]: {
    providerId: "moonshot",
    providerName: "Moonshot",
    providerType: "moonshot",
    sorted: 9,
    strategy: "openai_compatible",
  },
  [ServiceProvider.Iflytek]: {
    providerId: "iflytek",
    providerName: "Iflytek",
    providerType: "iflytek",
    sorted: 10,
    strategy: "openai_compatible",
  },
  [ServiceProvider.ChatGLM]: {
    providerId: "chatglm",
    providerName: "ChatGLM",
    providerType: "chatglm",
    sorted: 11,
    strategy: "openai_compatible",
  },
  [ServiceProvider.XAI]: {
    providerId: "xai",
    providerName: "XAI",
    providerType: "xai",
    sorted: 12,
    strategy: "openai_compatible",
  },
  [ServiceProvider.DeepSeek]: {
    providerId: "deepseek",
    providerName: "DeepSeek",
    providerType: "deepseek",
    sorted: 13,
    strategy: "openai_compatible",
  },
  [ServiceProvider.SiliconFlow]: {
    providerId: "siliconflow",
    providerName: "SiliconFlow",
    providerType: "siliconflow",
    sorted: 14,
    strategy: "openai_compatible",
  },
  [ServiceProvider["302.AI"]]: {
    providerId: "ai302",
    providerName: "302.AI",
    providerType: "302ai",
    sorted: 15,
    strategy: "openai_compatible",
  },
  [ServiceProvider.Stability]: {
    providerId: "stability",
    providerName: "Stability",
    providerType: "stability",
    sorted: 16,
    strategy: "openai_compatible",
  },
};

function resolveProviderFetchPreset(
  provider: ServiceProvider,
  baseUrl?: string,
  profileName?: string,
): ProviderFetchPreset | null {
  const preset = PROVIDER_FETCH_PRESETS[provider];
  if (preset) {
    return {
      ...preset,
      providerId:
        provider === ServiceProvider.Custom && profileName
          ? `custom_${profileName}`.toLowerCase()
          : preset.providerId,
    };
  }

  if (!baseUrl) {
    return null;
  }

  return {
    providerId: profileName
      ? provider === ServiceProvider.Local
        ? `${String(provider).toLowerCase()}_${profileName}`.toLowerCase()
        : `custom_${profileName}`
      : String(provider).toLowerCase(),
    providerName: String(provider),
    providerType: "openai",
    sorted: 999,
    strategy: "openai_compatible",
  };
}

function isAiHubMixUrl(baseUrl?: string) {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).hostname === "aihubmix.com";
  } catch {
    return false;
  }
}

function isYutoApiUrl(baseUrl?: string) {
  if (!baseUrl) return false;
  try {
    const hostname = new URL(baseUrl).hostname;
    return hostname === "cn.gptapi.asia" || hostname === "gptapi.asia";
  } catch {
    return false;
  }
}

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

function inferVendorFromModelName(
  modelName: string,
): { name: string; icon?: string } | null {
  const lowerName = modelName.toLowerCase();

  if (lowerName.includes("aihubmix")) {
    return { name: "AihubMix", icon: "aihubmix" };
  }

  if (
    lowerName.startsWith("gpt-") ||
    lowerName.startsWith("chatgpt-") ||
    lowerName.startsWith("o1-") ||
    lowerName.startsWith("o3-")
  ) {
    return { name: "OpenAI", icon: "OpenAI" };
  }
  if (lowerName.startsWith("claude-")) {
    return { name: "Anthropic", icon: "Claude.Color" };
  }
  if (lowerName.startsWith("gemini-") || lowerName.startsWith("pregenie-")) {
    return { name: "Google", icon: "Gemini.Color" };
  }
  if (lowerName.startsWith("deepseek-")) {
    return { name: "DeepSeek", icon: "DeepSeek.Color" };
  }
  if (lowerName.startsWith("grok-")) {
    return { name: "xAI", icon: "XAI" };
  }
  if (lowerName.startsWith("qwen-") || lowerName.startsWith("qwen3")) {
    return { name: "Alibaba", icon: "Qwen.Color" };
  }
  if (lowerName.startsWith("doubao-")) {
    return { name: "ByteDance", icon: "Doubao.Color" };
  }
  if (lowerName.startsWith("moonshot-")) {
    return { name: "Moonshot", icon: "Moonshot" };
  }
  if (lowerName.startsWith("ernie-")) {
    return { name: "Baidu", icon: "Ernie.Color" };
  }
  if (lowerName.startsWith("hunyuan-")) {
    return { name: "Tencent", icon: "Hunyuan.Color" };
  }
  if (lowerName.startsWith("glm-")) {
    return { name: "Zhipu", icon: "Zhipu.Color" };
  }
  if (lowerName.startsWith("llama-") || lowerName.startsWith("llama3")) {
    return { name: "Meta", icon: "Ollama" };
  }
  if (lowerName.startsWith("mistral-") || lowerName.startsWith("mixtral-")) {
    return { name: "Mistral", icon: "Mistral.Color" };
  }
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

function getRawModelName(model: any) {
  if (typeof model === "string") return model;
  return model?.id || model?.name || model?.model_id || model?.model_name;
}

function normalizeModelItems(items: any[]) {
  return items
    .map((item) => (typeof item === "string" ? { id: item } : item))
    .filter((item) => Boolean(getRawModelName(item)));
}

function extractModelListFromResponse(data: any): any[] {
  if (
    data?.vendors &&
    Array.isArray(data.vendors) &&
    Array.isArray(data?.data)
  ) {
    return normalizeModelItems(data.data);
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

  const groupContainers = [data?.data?.groups, data?.groups];
  for (const groups of groupContainers) {
    if (!Array.isArray(groups)) continue;
    const normalized = normalizeModelItems(
      groups.flatMap((group: any) =>
        Array.isArray(group?.models)
          ? group.models
          : Array.isArray(group?.items)
          ? group.items
          : [],
      ),
    );
    if (normalized.length > 0) return normalized;
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
  return models.map((model: any) => {
    const currentSeq = seq++;
    const modelName =
      model.id || model.name || model.model_id || model.model_name;
    const lookupKeys = getAiHubMixLookupKeys(String(modelName || ""));
    const catalogMetadata = lookupKeys
      .map((key) => catalogMetadataMap?.get(key))
      .find(Boolean);
    const catalogRank = catalogMetadata?.rank ?? undefined;
    const classificationMeta = lookupKeys
      .map((key) => classificationMap?.get(key))
      .find(Boolean);
    const normalized = normalizeModelClassification(
      classificationMeta
        ? {
            name: modelName,
            features: classificationMeta.features,
            types: classificationMeta.types,
            type: classificationMeta.types?.[0],
          }
        : model,
    );
    const isAiHubMixBrandedModel = String(modelName || "")
      .toLowerCase()
      .includes("aihubmix");

    let vendor: { id: number; name: string; icon?: string } | undefined;
    if (model.vendor_id !== undefined && vendorsMap) {
      const vendorInfo = vendorsMap[model.vendor_id];
      if (vendorInfo) {
        vendor = {
          id: model.vendor_id,
          name: vendorInfo.name,
          icon: vendorInfo.icon,
        };
      }
    } else if (model.developer_id !== undefined && vendorsMap) {
      const vendorInfo = vendorsMap[model.developer_id];
      if (vendorInfo) {
        vendor = {
          id: model.developer_id,
          name: vendorInfo.name,
          icon: vendorInfo.icon,
        };
      }
    } else {
      const inferred = inferVendorFromOcoolaiModel(modelName);
      if (inferred) {
        vendor = {
          id: -1,
          name: inferred.name,
          icon: inferred.icon,
        };
      }
    }

    if (catalogMetadata?.vendor) {
      vendor = catalogMetadata.vendor;
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
      catalogRank,
      remoteRank: catalogRank ?? currentSeq,
      remoteRankSource:
        catalogRank !== undefined ? "aihubmix_catalog" : "provider_models",
      category: normalized.category,
      categorySource: normalized.categorySource,
      type: normalized.type,
      types: normalized.types,
      features: normalized.features,
      capabilities: normalized.capabilities,
      categories: normalized.categories,
      apiKeyGroup,
      provider: {
        id: providerId,
        providerName,
        providerType,
        sorted,
      },
      vendor,
    }) as SyncedLLMModel;
  });
}

async function fetchAiHubMixCatalogMetadataMap() {
  const response = await requestUpstream("https://aihubmix.com/api/v1/models", {
    method: "GET",
    dnsServers: ["1.1.1.1", "8.8.8.8"],
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `AihubMix 模型目录请求失败: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const metadataMap = new Map<
    string,
    { rank: number; vendor?: { id: number; name: string; icon?: string } }
  >();

  items.forEach((item: any, index: number) => {
    const modelName =
      item?.id ||
      item?.model ||
      item?.name ||
      item?.model_id ||
      item?.model_name;
    const normalizedName = String(modelName || "")
      .trim()
      .toLowerCase();
    if (!normalizedName || metadataMap.has(normalizedName)) {
      return;
    }
    const vendorInfo = AIHUBMIX_VENDOR_MAP[Number(item?.developer_id)];
    metadataMap.set(normalizedName, {
      rank: index + 1,
      vendor:
        item?.developer_id !== undefined && vendorInfo
          ? {
              id: Number(item.developer_id),
              name: vendorInfo.name,
              icon: vendorInfo.icon,
            }
          : undefined,
    });
  });

  return metadataMap;
}

async function fetchAiHubMixClassificationMap() {
  const response = await requestUpstream(
    "https://aihubmix.com/call/mdl_info_pagination?p=0&num=10000",
    {
      method: "GET",
      dnsServers: ["1.1.1.1", "8.8.8.8"],
      headers: {
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `AihubMix 分类元数据请求失败: ${response.status} ${response.statusText}`,
    );
  }

  const payload = await response.json();
  const items = Array.isArray(payload?.data) ? payload.data : [];
  const classificationMap = new Map<
    string,
    { features?: string[]; types?: string[] }
  >();

  items.forEach((item: any) => {
    const modelName =
      item?.model ||
      item?.id ||
      item?.name ||
      item?.model_id ||
      item?.model_name;
    const normalizedName = String(modelName || "")
      .trim()
      .toLowerCase();
    if (!normalizedName || classificationMap.has(normalizedName)) {
      return;
    }

    const features = String(item?.features || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const types = String(item?.modalities || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);

    classificationMap.set(normalizedName, {
      features: features.length > 0 ? features : undefined,
      types: types.length > 0 ? types : undefined,
    });
  });

  return classificationMap;
}

async function getAiHubMixCatalogMetadataMap() {
  if (!aihubmixCatalogMetadataMapPromise) {
    aihubmixCatalogMetadataMapPromise = fetchAiHubMixCatalogMetadataMap().catch(
      (error) => {
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
        aihubmixClassificationMapPromise = null;
        throw error;
      },
    );
  }
  return aihubmixClassificationMapPromise;
}

async function fetchJsonWithCandidates(
  urls: string[],
  headers: Record<string, string>,
  authorizationCandidates?: string[],
  validateJson?: (data: any) => boolean,
  getModelCount?: (data: any) => number,
) {
  let lastError: Error | null = null;
  const attempts: Array<{
    index: number;
    total: number;
    interface: string;
    result: string;
    keyIndex: number;
    keyTotal: number;
  }> = [];
  const authCandidates =
    authorizationCandidates && authorizationCandidates.length > 0
      ? authorizationCandidates
      : headers.Authorization
      ? [headers.Authorization]
      : [undefined];

  for (let index = 0; index < urls.length; index++) {
    const url = urls[index];
    for (let authIndex = 0; authIndex < authCandidates.length; authIndex++) {
      const authorization = authCandidates[authIndex];
      const progressPrefix = `第 ${index + 1}/${urls.length} 个接口，第 ${
        authIndex + 1
      }/${authCandidates.length} 个 key`;
      const recordAttempt = (result: string) => {
        attempts.push({
          index: index + 1,
          total: urls.length,
          interface: url,
          result,
          keyIndex: authIndex + 1,
          keyTotal: authCandidates.length,
        });
      };
      try {
        console.log(
          `[Fetch Models] 🔁 正在尝试服务端模型接口：${progressPrefix} ${url}`,
        );
        const requestHeaders = { ...headers };
        if (authorization) {
          requestHeaders.Authorization = authorization;
        } else {
          delete requestHeaders.Authorization;
        }
        const hostname = new URL(url).hostname;
        const response = await requestUpstream(url, {
          method: "GET",
          headers: requestHeaders,
          dnsServers: [
            "aihubmix.com",
            "toapis.com",
            "cn.gptapi.asia",
            "gptapi.asia",
            "one.ocoolai.com",
            "ocoolai.com",
            "one.ooo.cool",
          ].includes(hostname)
            ? ["1.1.1.1", "8.8.8.8"]
            : undefined,
        });
        if (!response.ok) {
          lastError = new Error(`${response.status} ${response.statusText}`);
          recordAttempt(`${response.status} ${response.statusText}`.trim());
          console.log(
            `[Fetch Models] 💡 服务端模型接口尝试失败：${progressPrefix} ${url}，原因：${response.status} ${response.statusText}`.trim(),
          );
          continue;
        }
        const contentType = response.headers.get("content-type") || "";
        if (contentType && !contentType.toLowerCase().includes("json")) {
          lastError = new Error(`响应不是 JSON (${contentType})`);
          recordAttempt(`非 JSON (${contentType})`);
          console.log(
            `[Fetch Models] 💡 服务端模型接口尝试失败：${progressPrefix} ${url}，原因：返回非 JSON (${contentType})`,
          );
          continue;
        }
        let data: any;
        try {
          data = await response.json();
        } catch (error) {
          lastError =
            error instanceof Error ? error : new Error("响应 JSON 解析失败");
          recordAttempt("JSON 解析失败");
          console.log(
            `[Fetch Models] 💡 服务端模型接口尝试失败：${progressPrefix} ${url}，原因：JSON 解析失败`,
          );
          continue;
        }
        if (validateJson && !validateJson(data)) {
          lastError = new Error("响应内容无有效模型列表");
          recordAttempt("内容无有效模型列表");
          console.log(
            `[Fetch Models] 💡 服务端模型接口尝试失败：${progressPrefix} ${url}，原因：内容无有效模型列表`,
          );
          continue;
        }
        recordAttempt("成功");
        const modelCount = getModelCount?.(data);
        const modelCountText =
          typeof modelCount === "number" ? `，获取到 ${modelCount} 个模型` : "";
        console.log(
          `[Fetch Models] ✅ 服务端模型接口获取成功：${progressPrefix} ${url}${modelCountText}`,
          {
            success: attempts[attempts.length - 1],
            totalModels: modelCount,
            tried: attempts,
          },
        );
        return data;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error("请求失败");
        recordAttempt(lastError.message || "请求失败");
        console.log(
          `[Fetch Models] ⚠️ 服务端模型接口尝试失败：${progressPrefix} ${url}，原因：${lastError.message}`,
        );
      }
    }
  }

  console.warn("[Fetch Models] ⚠️ 服务端模型接口全部候选均未成功", {
    tried: attempts,
    lastError: lastError?.message,
  });
  throw lastError ?? new Error("未找到可用的模型接口");
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

// Ocoolai 分组优先级
function getOcoolApiKeyGroupPriority(modelName: string, groupName?: string) {
  const normalizedGroup = String(groupName || "default")
    .trim()
    .toLowerCase();
  const lowerModelName = modelName.toLowerCase();
  const isClaudeModel = lowerModelName.startsWith("claude");

  if (isClaudeModel) {
    // Claude 模型优先级: default > official > cc > cn > open_source_cn
    const priorityMap: Record<string, number> = {
      default: 50,
      official: 45,
      cc: 40,
      cn: 30,
      open_source_cn: 20,
    };
    return priorityMap[normalizedGroup] ?? 0;
  }

  // 其他模型优先级: default > official > open_source_cn > cn > cc
  const priorityMap: Record<string, number> = {
    default: 50,
    official: 45,
    open_source_cn: 40,
    cn: 30,
    cc: 20,
  };
  return priorityMap[normalizedGroup] ?? 0;
}

export function modelsToCustomModelsString(models: SyncedLLMModel[]): string {
  return models
    .map((model) => {
      if (model.provider && model.provider.providerName !== "Custom") {
        return `${model.name}@${model.provider.providerName}`;
      }
      return model.name;
    })
    .join(",");
}

export async function fetchModelsFromProviderForServer(
  provider: ServiceProvider,
  baseUrl?: string,
  apiKey?: string,
  profileName?: string,
  apiKeyGroups?: Record<string, string>,
): Promise<ServerFetchModelsResult> {
  const preset = resolveProviderFetchPreset(provider, baseUrl, profileName);
  if (!preset || !baseUrl || preset.strategy === "unsupported") {
    return { models: [], total: 0 };
  }

  const { providerId, providerName, providerType, sorted } = preset;

  const modelFetchApiKeyCandidates = getModelFetchApiKeyCandidates({
    apiKey,
    apiKeyGroups,
  });

  const headers: Record<string, string> = {};
  if (modelFetchApiKeyCandidates[0]) {
    headers.Authorization = `Bearer ${modelFetchApiKeyCandidates[0]}`;
  }

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const baseWithoutV1 = normalizedBaseUrl.replace(/\/v1$/, "");

  const candidateUrls = buildModelFetchCandidateUrls(baseUrl);
  console.log(
    `[Fetch Models] 📋 将依次尝试 ${candidateUrls.length} 个服务端模型接口`,
  );

  const data = await fetchJsonWithCandidates(
    candidateUrls,
    headers,
    modelFetchApiKeyCandidates.map((key) => `Bearer ${key}`),
    (payload) => extractModelListFromResponse(payload).length > 0,
    (payload) => extractModelListFromResponse(payload).length,
  );

  let models: any[] = [];
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
      "[Fetch Models] 获取 AihubMix 模型目录顺序失败，将回退到本地兜底排序",
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

  if (data.vendors && Array.isArray(data.vendors)) {
    vendorsMap = {};
    data.vendors.forEach((vendor: any) => {
      vendorsMap![vendor.id] = {
        name: vendor.name,
        icon: vendor.icon,
      };
    });
  } else if (isAiHubMixUrl(baseUrl)) {
    vendorsMap = AIHUBMIX_VENDOR_MAP;
  }

  models = extractModelListFromResponse(data);

  if (isYutoApiUrl(baseUrl)) {
    const groupedEntries = Object.entries(apiKeyGroups || {}).filter(
      ([, value]) => Boolean(value?.trim()),
    );
    const fetchEntries =
      groupedEntries.length > 0 ? groupedEntries : [["default", apiKey || ""]];
    const mergedModelMap = new Map<string, SyncedLLMModel>();

    for (const [groupName, groupApiKey] of fetchEntries) {
      if (!groupApiKey) continue;
      const groupedHeaders: Record<string, string> = {
        Authorization: `Bearer ${groupApiKey}`,
      };
      const groupedData = await fetchJsonWithCandidates(
        [`${baseWithoutV1}/api/pricing`, `${baseWithoutV1}/pricing`],
        groupedHeaders,
      );
      const groupedModels =
        groupedData?.vendors &&
        Array.isArray(groupedData.vendors) &&
        groupedData?.data &&
        Array.isArray(groupedData.data)
          ? groupedData.data
          : [];
      const groupedVendorsMap: Record<number, { name: string; icon?: string }> =
        {};
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
        catalogMetadataMap,
        classificationMap,
      ).forEach((model) => {
        const key = `${model.name}@${model.provider?.id}`;
        const existing = mergedModelMap.get(key);
        if (!existing) {
          mergedModelMap.set(key, model);
          return;
        }

        const existingPriority = getYutoApiKeyGroupPriority(
          model.name,
          existing.apiKeyGroup,
        );
        const nextPriority = getYutoApiKeyGroupPriority(model.name, groupName);

        if (nextPriority > existingPriority) {
          mergedModelMap.set(key, { ...model, apiKeyGroup: groupName });
        }
      });
    }

    const mappedModels = [...mergedModelMap.values()];
    return {
      models: mappedModels,
      total: mappedModels.length,
    };
  }

  // Ocoolai 分组模型获取
  if (
    isOcoolaiUrl(baseUrl) &&
    apiKeyGroups &&
    Object.keys(apiKeyGroups).length > 0
  ) {
    const groupedEntries = Object.entries(apiKeyGroups).filter(
      ([key, value]) => key && value?.trim(),
    );

    if (groupedEntries.length === 0) {
      // 没有配置分组，使用默认获取方式
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

    const mergedModelMap = new Map<string, SyncedLLMModel>();

    // 使用 Ocoolai 的分组 API
    const groupsData = await fetchJsonWithCandidates(
      [`${baseWithoutV1}/api/user/available_models_by_groups`],
      { Authorization: `Bearer ${modelFetchApiKeyCandidates[0] || ""}` },
      modelFetchApiKeyCandidates.map((key) => `Bearer ${key}`),
    );

    if (
      groupsData.success &&
      groupsData.data?.groups &&
      Array.isArray(groupsData.data.groups)
    ) {
      const groups = groupsData.data.groups;

      for (const group of groups) {
        const groupName = group.name;
        const groupApiKey = apiKeyGroups[groupName];

        if (!groupApiKey) continue;

        const groupModels = group.models || [];
        const groupModelsArray = Array.isArray(groupModels)
          ? groupModels.map((name: string) => ({ id: name }))
          : [];

        // 将 Ocoolai 的分组名映射到 apiKeyGroup
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
    }

    const mappedModels = [...mergedModelMap.values()];
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
}
