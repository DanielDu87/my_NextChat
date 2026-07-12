import { ServiceProvider } from "@/app/constant";
import { requestUpstream } from "@/app/api/upstream";
import { applyModelPublishedAt } from "@/app/utils/model-published-at";
import { normalizeModelClassification } from "@/app/utils/model-classification";
import {
  appendAuthQueryParam,
  buildAuthHeaders,
  buildModelFetchCandidateUrls,
  getAuthorizationCandidates,
  getModelFetchApiKeyCandidates,
  parseExtraHeaders,
  type ApiProfileAuthType,
} from "@/app/utils/model-fetch-common";
import { getEffectiveProviderBaseUrl } from "@/app/utils/provider-url";
import {
  getProviderModelCachedPath,
  saveProviderModelCachedPath,
} from "./provider-model-repository";
import { isYutoProfileLike, isOcoolProfileLike } from "@/app/utils/multi-key";

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
  // 成功获取的接口路径（用于缓存）
  cachedPath?: string;
  cachedBaseUrl?: string;
  cachedAuthType?: string;
  cachedApiKey?: string;
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

function getCachedModelPath(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

function buildCachedModelUrl(baseUrl: string, path?: string) {
  const normalizedPath = String(path || "").trim();
  if (!normalizedPath) return "";
  if (/^https?:\/\//i.test(normalizedPath)) return normalizedPath;
  return `${normalizeBaseUrl(baseUrl).replace(/\/v1$/i, "")}${
    normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`
  }`;
}

function maskCachedApiKey(apiKey?: string) {
  const value = String(apiKey || "").trim();
  if (!value) return "未缓存";
  if (value.length <= 8) return `${value.slice(0, 2)}***`;
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
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
    return ["aihubmix.com", "api.inferera.com"].includes(
      new URL(baseUrl).hostname,
    );
  } catch {
    return false;
  }
}

function isYutoApiUrl(baseUrl?: string, profileName?: string) {
  return isYutoProfileLike({ name: profileName, baseUrl });
}

function isOcoolaiUrl(baseUrl?: string, profileName?: string) {
  return isOcoolProfileLike({ name: profileName, baseUrl });
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
  if (lowerName.startsWith("claude-")) {
    return { name: "Anthropic", icon: "Claude.Color" };
  }
  if (
    lowerName.startsWith("gemini-") ||
    lowerName.startsWith("pregenie-") ||
    lowerName.startsWith("veo-") ||
    lowerName.startsWith("imagen-")
  ) {
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
  if (
    lowerName.startsWith("llama-") ||
    lowerName.startsWith("llama3") ||
    lowerName.startsWith("nemotron-")
  ) {
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
      catalogRank,
      remoteRank: catalogRank ?? currentSeq,
      remoteRankSource:
        catalogRank !== undefined ? "aihubmix_catalog" : "provider_models",
      category: normalized.category,
      categorySource: normalized.categorySource,
      type: inferEndpointCapabilities(model).type || normalized.type,
      types: inferEndpointCapabilities(model).types?.length
        ? inferEndpointCapabilities(model).types
        : normalized.types,
      features: [
        ...new Set([
          ...(normalized.features || []),
          ...(inferEndpointCapabilities(model).features || []),
        ]),
      ],
      capabilities: [
        ...new Set([
          ...(normalized.capabilities || []),
          ...(inferEndpointCapabilities(model).capabilities || []),
        ]),
      ],
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

async function fetchAiHubMixCatalogMetadataMap(baseUrl: string) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl).replace(/\/v1$/i, "");
  const response = await requestUpstream(`${normalizedBaseUrl}/api/v1/models`, {
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

async function fetchAiHubMixClassificationMap(baseUrl: string) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl).replace(/\/v1$/i, "");
  const response = await requestUpstream(
    `${normalizedBaseUrl}/call/mdl_info_pagination?p=0&num=10000`,
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

async function getAiHubMixCatalogMetadataMap(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  let promise = aihubmixCatalogMetadataMapPromises.get(normalized);
  if (!promise) {
    promise = fetchAiHubMixCatalogMetadataMap(baseUrl).catch((error) => {
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
      aihubmixClassificationMapPromises.delete(normalized);
      throw error;
    });
    aihubmixClassificationMapPromises.set(normalized, promise);
  }
  return promise;
}

async function fetchJsonWithCandidates(
  urls: string[],
  headers: Record<string, string>,
  authorizationCandidates?: string[],
  validateJson?: (data: any) => boolean,
  getModelCount?: (data: any) => number,
  options?: {
    authType?: ApiProfileAuthType;
    authQueryParam?: string;
    authorizationHeaderName?: string;
    outerIndex?: number;
    outerTotal?: number;
    keyIndex?: number;
    keyTotal?: number;
  },
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
      const progressIndex =
        options?.outerIndex !== undefined ? options.outerIndex + 1 : index + 1;
      const progressTotal =
        options?.outerTotal !== undefined ? options.outerTotal : urls.length;
      const keyIndex =
        options?.keyIndex !== undefined ? options.keyIndex : authIndex + 1;
      const keyTotal =
        options?.keyTotal !== undefined
          ? options.keyTotal
          : authCandidates.length;
      const progressPrefix = `第 ${progressIndex}/${progressTotal} 个接口，第 ${keyIndex}/${keyTotal} 个 key`;
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
        const authorizationHeaderName =
          options?.authorizationHeaderName || "Authorization";
        if (authorization && authorizationHeaderName) {
          requestHeaders[authorizationHeaderName] = authorization;
        } else if (authorizationHeaderName) {
          delete requestHeaders[authorizationHeaderName];
        }
        const requestUrl = appendAuthQueryParam(
          url,
          authorization,
          options?.authType,
          options?.authQueryParam,
        );
        const hostname = new URL(requestUrl).hostname;
        const response = await requestUpstream(requestUrl, {
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

async function fetchAllJsonWithCandidates(
  urls: string[],
  headers: Record<string, string>,
  authorizationCandidates?: string[],
  validateJson?: (data: any) => boolean,
  getModelCount?: (data: any) => number,
  options?: {
    authType?: ApiProfileAuthType;
    authQueryParam?: string;
    authorizationHeaderName?: string;
  },
) {
  for (let urlIndex = 0; urlIndex < urls.length; urlIndex++) {
    const url = urls[urlIndex];
    const authCandidates =
      authorizationCandidates && authorizationCandidates.length > 0
        ? authorizationCandidates
        : headers.Authorization
        ? [headers.Authorization]
        : [undefined];

    for (let index = 0; index < authCandidates.length; index++) {
      try {
        const data = await fetchJsonWithCandidates(
          [url],
          headers,
          [authCandidates[index]].filter(Boolean) as string[],
          validateJson,
          getModelCount,
          {
            ...options,
            outerIndex: urlIndex,
            outerTotal: urls.length,
            keyIndex: index + 1,
            keyTotal: authCandidates.length,
          },
        );
        return [{ data, url, keyIndex: index + 1 }];
      } catch {
        // 单个路径或 key 失败不影响后续全量尝试。
      }
    }
  }

  throw new Error("未找到可用的模型接口");
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
  openAICompatible?: boolean,
  multiKeyGroupOrder?: string[],
  fetchOptions?: {
    authType?: string;
    authQueryParam?: string;
    extraHeaders?: string;
    userId?: string;
    profileId?: string;
  },
): Promise<ServerFetchModelsResult> {
  const profileOpenAICompatible =
    openAICompatible ??
    (provider === ServiceProvider.Custom || provider === ServiceProvider.Local);
  baseUrl = getEffectiveProviderBaseUrl(provider, baseUrl) || baseUrl;
  const preset = resolveProviderFetchPreset(provider, baseUrl, profileName);
  if (!preset || !baseUrl || preset.strategy === "unsupported") {
    return { models: [], total: 0 };
  }

  if (
    [ServiceProvider.Custom, ServiceProvider.Local].includes(provider) &&
    !profileOpenAICompatible
  ) {
    return { models: [], total: 0 };
  }

  const { providerId, providerName, providerType, sorted } = preset;

  const modelFetchApiKeyCandidates = getModelFetchApiKeyCandidates({
    apiKey,
    apiKeyGroups,
    multiKeyGroupOrder,
  });

  const authType = (fetchOptions?.authType ||
    (String(provider) === ServiceProvider.Anthropic
      ? "x-api-key"
      : String(provider) === ServiceProvider.Azure
      ? "api-key"
      : String(provider) === ServiceProvider.Google
      ? "x-goog-api-key"
      : "bearer")) as ApiProfileAuthType;
  const authQueryParam = fetchOptions?.authQueryParam || "key";
  const headers: Record<string, string> = {
    ...parseExtraHeaders(fetchOptions?.extraHeaders),
    ...buildAuthHeaders(modelFetchApiKeyCandidates[0], authType),
  };

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const baseWithoutV1 = normalizedBaseUrl.replace(/\/v1$/, "");

  // 获取缓存的模型接口路径
  let cachedPath: string | undefined;
  let cachedBaseUrl: string | undefined;
  let cachedAuthType: string | undefined;
  let cachedApiKey: string | undefined;
  if (fetchOptions?.userId && fetchOptions?.profileId) {
    try {
      const cachedInfo = await getProviderModelCachedPath(
        fetchOptions.userId,
        fetchOptions.profileId,
      );
      if (cachedInfo?.cachedModelPath) {
        cachedPath = cachedInfo.cachedModelPath;
        cachedBaseUrl = cachedInfo.cachedModelBaseUrl;
        cachedAuthType = cachedInfo.cachedModelAuthType;
        cachedApiKey = cachedInfo.cachedModelApiKey;
      }
    } catch (e) {
      // 忽略缓存读取错误
    }
  }

  const candidateUrls = profileOpenAICompatible
    ? buildModelFetchCandidateUrls(baseUrl)
    : [normalizedBaseUrl];
  const cachedCandidateUrl = buildCachedModelUrl(
    cachedBaseUrl || normalizedBaseUrl,
    cachedPath,
  );
  console.log(
    `[Fetch Models] 📋 将依次尝试 ${candidateUrls.length} 个服务端模型接口`,
  );

  const orderedGroupNames = [
    ...(multiKeyGroupOrder || []),
    ...Object.keys(apiKeyGroups || {}),
  ].filter((group, index, all) => group && all.indexOf(group) === index);
  const keyEntries = [
    { groupName: undefined as string | undefined, apiKey: apiKey || "" },
    ...orderedGroupNames.map((groupName) => ({
      groupName,
      apiKey: apiKeyGroups?.[groupName] || "",
    })),
  ]
    .map((entry) => ({ ...entry, apiKey: String(entry.apiKey || "").trim() }))
    .filter((entry) => entry.apiKey);
  const uniqueKeyEntries = keyEntries.filter(
    (entry, index, all) =>
      all.findIndex((item) => item.apiKey === entry.apiKey) === index,
  );

  const payloadResults: Array<{
    data: any;
    groupName?: string;
    url: string;
  }> = [];

  const entries = (
    uniqueKeyEntries.length > 0
      ? uniqueKeyEntries
      : [{ groupName: undefined, apiKey: modelFetchApiKeyCandidates[0] || "" }]
  ).sort((left, right) => {
    if (!cachedApiKey || left.apiKey === right.apiKey) return 0;
    return left.apiKey === cachedApiKey
      ? -1
      : right.apiKey === cachedApiKey
      ? 1
      : 0;
  });
  const cachedKeyIsConfigured = Boolean(
    cachedApiKey && entries.some((entry) => entry.apiKey === cachedApiKey),
  );
  console.log("[Fetch Models] 🗃️ 模型获取缓存状态", {
    cached: Boolean(cachedCandidateUrl && cachedKeyIsConfigured),
    url: cachedCandidateUrl || "未缓存",
    authType: cachedAuthType || "未缓存",
    apiKey: maskCachedApiKey(cachedApiKey),
    keyIsConfigured: cachedKeyIsConfigured,
  });
  let successfulPath: string | undefined;
  let successfulBaseUrl: string | undefined;
  let successfulAuthType: string | undefined;
  let successfulApiKey: string | undefined;
  let successfulFetchPersisted = false;
  const persistSuccessfulFetch = async (url: string, key: string) => {
    if (successfulFetchPersisted) return;
    successfulFetchPersisted = true;

    successfulPath = getCachedModelPath(url);
    successfulBaseUrl = normalizedBaseUrl;
    successfulAuthType = authType;
    successfulApiKey = key;
    console.log("[Fetch Models] 💾 本轮成功模型获取组合", {
      url: `${successfulBaseUrl}${successfulPath}`,
      authType: successfulAuthType,
      apiKey: maskCachedApiKey(successfulApiKey),
    });

    if (!fetchOptions?.userId || !fetchOptions?.profileId) return;
    try {
      await saveProviderModelCachedPath(
        fetchOptions.userId,
        fetchOptions.profileId,
        {
          cachedModelPath: successfulPath,
          cachedModelBaseUrl: successfulBaseUrl,
          cachedModelAuthType: successfulAuthType,
          cachedModelApiKey: successfulApiKey,
        },
      );
      console.log("[Fetch Models] 💾 已立即保存模型获取缓存");
    } catch (error) {
      console.warn(
        "[Fetch Models] ⚠️ 立即保存模型获取缓存失败",
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const orderedUrls = cachedCandidateUrl
    ? [
        cachedCandidateUrl,
        ...candidateUrls.filter((url) => url !== cachedCandidateUrl),
      ]
    : candidateUrls;
  const entryResults = await fetchAllJsonWithCandidates(
    orderedUrls,
    headers,
    getAuthorizationCandidates(
      entries.map((entry) => entry.apiKey),
      authType,
    ),
    (payload) => extractModelListFromResponse(payload).length > 0,
    (payload) => extractModelListFromResponse(payload).length,
    {
      authType,
      authQueryParam,
      authorizationHeaderName:
        Object.keys(buildAuthHeaders("__key__", authType))[0] || "",
    },
  ).catch(() => []);

  if (entryResults[0]) {
    const entry = entries[entryResults[0].keyIndex - 1];
    if (entry) await persistSuccessfulFetch(entryResults[0].url, entry.apiKey);
  }
  entryResults.forEach((result) => {
    payloadResults.push({
      data: result.data,
      groupName: entries[result.keyIndex - 1]?.groupName,
      url: result.url,
    });
  });

  const data = payloadResults[0]?.data;

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

  if (isAiHubMixUrl(baseUrl)) {
    try {
      catalogMetadataMap = await getAiHubMixCatalogMetadataMap(baseUrl);
    } catch (error) {
      console.warn(
        "[Fetch Models] 获取 AihubMix 模型目录顺序失败，将回退到本地兜底排序",
        error instanceof Error ? error.message : String(error),
      );
    }
    try {
      classificationMap = await getAiHubMixClassificationMap(baseUrl);
    } catch (error) {
      console.warn(
        "[Fetch Models] 获取 AihubMix 分类元数据失败，将回退到当前模型字段",
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  if (data?.vendors && Array.isArray(data.vendors)) {
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

  models = data ? extractModelListFromResponse(data) : [];

  const mergedModelMap = new Map<string, SyncedLLMModel>();
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
      extractModelListFromResponse(payload),
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
      cachedPath: successfulPath || cachedPath,
      cachedBaseUrl: successfulBaseUrl || cachedBaseUrl,
      cachedAuthType: successfulAuthType || cachedAuthType,
      cachedApiKey: successfulApiKey || cachedApiKey,
    };
  }

  if (isYutoApiUrl(baseUrl, profileName)) {
    const orderedGroupNames = [
      ...(multiKeyGroupOrder || []),
      ...Object.keys(apiKeyGroups || {}),
    ].filter((group, index, all) => group && all.indexOf(group) === index);
    const groupedEntries = orderedGroupNames
      .map((groupName) => [groupName, apiKeyGroups?.[groupName] || ""] as const)
      .filter(([, value]) => Boolean(value?.trim()));
    const fetchEntries =
      groupedEntries.length > 0 ? groupedEntries : [["default", apiKey || ""]];
    const mergedModelMap = new Map<string, SyncedLLMModel>();

    for (const [groupName, groupApiKey] of fetchEntries) {
      if (!groupApiKey) continue;
      const groupedHeaders: Record<string, string> = {
        Authorization: `Bearer ${groupApiKey}`,
      };
      const groupedResults = await fetchAllJsonWithCandidates(
        [`${baseWithoutV1}/api/pricing`, `${baseWithoutV1}/pricing`],
        groupedHeaders,
      ).catch((error) => {
        console.warn(
          `[Fetch Models] Yuto 分组 ${groupName} 的定价接口获取失败，继续尝试其他分组`,
          error instanceof Error ? error.message : String(error),
        );
        return [];
      });

      for (const result of groupedResults) {
        const groupedData = result.data;
        const groupedModels =
          groupedData?.vendors &&
          Array.isArray(groupedData.vendors) &&
          groupedData?.data &&
          Array.isArray(groupedData.data)
            ? groupedData.data
            : [];
        if (groupedModels.length > 0) {
          await persistSuccessfulFetch(result.url, groupApiKey);
        }
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
          const nextPriority = getYutoApiKeyGroupPriority(
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
      cachedPath: successfulPath || cachedPath,
      cachedBaseUrl: successfulBaseUrl || cachedBaseUrl,
      cachedAuthType: successfulAuthType || cachedAuthType,
      cachedApiKey: successfulApiKey || cachedApiKey,
    };
  }

  // Ocoolai 分组模型获取
  if (
    isOcoolaiUrl(baseUrl, profileName) &&
    apiKeyGroups &&
    Object.keys(apiKeyGroups).length > 0
  ) {
    const orderedGroupNames = [
      ...(multiKeyGroupOrder || []),
      ...Object.keys(apiKeyGroups),
    ].filter((group, index, all) => group && all.indexOf(group) === index);
    const groupedEntries = orderedGroupNames
      .map((groupName) => [groupName, apiKeyGroups[groupName] || ""] as const)
      .filter(([key, value]) => key && value?.trim());

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

    for (const [groupName, groupApiKey] of groupedEntries) {
      try {
        const groupedResults = await fetchAllJsonWithCandidates(
          buildModelFetchCandidateUrls(baseWithoutV1),
          {
            ...headers,
            ...buildAuthHeaders(groupApiKey, authType),
          },
          getAuthorizationCandidates([groupApiKey], authType),
          (payload) => extractModelListFromResponse(payload).length > 0,
          (payload) => extractModelListFromResponse(payload).length,
          {
            authType,
            authQueryParam,
            authorizationHeaderName:
              Object.keys(buildAuthHeaders("__key__", authType))[0] || "",
          },
        );
        for (const result of groupedResults) {
          const groupModels = extractModelListFromResponse(result.data);
          if (groupModels.length > 0) {
            await persistSuccessfulFetch(result.url, groupApiKey);
          }

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
          `[Fetch Models] Ocoolai 分组 ${groupName} 的模型接口获取失败，继续尝试其他分组`,
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
      successfulPath ||= "/api/user/available_models_by_groups";
      successfulBaseUrl ||= normalizedBaseUrl;
      successfulAuthType ||= authType;
      successfulApiKey ||= modelFetchApiKeyCandidates[0];
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

    if (mergedModelMap.size > 0) {
      const mappedModels = [...mergedModelMap.values()];
      return {
        models: mappedModels,
        total: mappedModels.length,
        cachedPath: successfulPath || cachedPath,
        cachedBaseUrl: successfulBaseUrl || cachedBaseUrl,
        cachedAuthType: successfulAuthType || cachedAuthType,
        cachedApiKey: successfulApiKey || cachedApiKey,
      };
    }
  }

  if (models.length === 0) {
    throw new Error("未找到可用的模型接口");
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
