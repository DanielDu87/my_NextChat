import constants from "../constant";
import type { LLMModel } from "../client/api";
import { useAccessStore } from "../store";
import { writeAccessSnapshot } from "./access-snapshot";
import { appendAihubmixHeaders, isAiHubMixUrl } from "./aihubmix";
import {
  getAiHubMixLookupKeys,
  hydrateModelsWithAiHubMixMetadata,
  persistAiHubMixCatalogMetadataCache,
  readAiHubMixCatalogMetadataCache,
  resolveAiHubMixCatalogRank,
  resolveAiHubMixMetadataByName,
} from "./aihubmix-model-metadata";
import modelPublishedAtUtils from "./model-published-at";
import {
  buildAuthHeaders,
  buildProxyModelFetchCandidates,
  fetchModelRoutesFast,
  getAuthorizationCandidates,
  getModelFetchApiKeyCandidates,
  MODEL_FETCH_REQUEST_TIMEOUT_MS,
  MODEL_FETCH_ROUTE_REVALIDATE_MS,
  MODEL_FETCH_SINGLE_ROUTE_TIMEOUT_MS,
  isLocalModelProxyBaseUrl,
  parseExtraHeaders,
  appendAuthQueryParam,
  type ApiProfileAuthType,
} from "./model-fetch-common";
import { getEffectiveProviderBaseUrl } from "./provider-url";
import {
  getRememberedModelListPath,
  getRememberedModelListApiKey,
  getRememberedModelListUpdatedAt,
  rememberModelListPath,
} from "./api-path-memory";
import { isYutoProfileLike, isOcoolProfileLike } from "./multi-key";
import {
  getDeclaredModelVendor,
  getProviderFallbackModelVendor,
  isCustomAutoModelName,
  isOcoolaiProprietaryModelName,
  normalizeModelVendorName,
} from "./model-vendor-normalize";

export {
  getAiHubMixLookupKeys,
  hydrateModelsWithAiHubMixMetadata,
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
  17: { name: "NVIDIA", icon: "Nvidia" },
  18: { name: "MiniMax", icon: "Minimax.Color" },
  19: { name: "Perplexity", icon: "Perplexity" },
  20: { name: "Baichuan", icon: "Baichuan" },
  21: { name: "Ideogram", icon: "Ideogram" },
  22: { name: "Jina AI", icon: "Jina" },
  23: { name: "Stability", icon: "Stability" },
  24: { name: "Tencent", icon: "Hunyuan.Color" },
  25: { name: "Baidu", icon: "Ernie.Color" },
  27: { name: "FLUX", icon: "Flux" },
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
  const lowerName = modelName
    .toLowerCase()
    // Ocoolai 的历史模型名会加 net/network 前缀，它不属于真实模型商。
    .replace(/^(?:net|network)[-_.]+/, "");

  if (lowerName.includes("aihubmix")) {
    return { name: "AihubMix", icon: "aihubmix" };
  }

  const namespace = lowerName.replace(/^~+/, "").split("/", 1)[0];
  const namespaceVendors: Record<string, { name: string; icon?: string }> = {
    anthropic: { name: "Anthropic", icon: "Claude.Color" },
    baai: { name: "BAAI", icon: "BAAI" },
    bytedance: { name: "ByteDance", icon: "Doubao.Color" },
    deepseek: { name: "DeepSeek", icon: "DeepSeek.Color" },
    "deepseek-ai": { name: "DeepSeek", icon: "DeepSeek.Color" },
    google: { name: "Google", icon: "Gemini.Color" },
    meta: { name: "Meta", icon: "Ollama" },
    "meta-llama": { name: "Meta", icon: "Ollama" },
    moonshotai: { name: "Moonshot", icon: "Moonshot" },
    openai: { name: "OpenAI", icon: "OpenAI" },
    qwen: { name: "Alibaba", icon: "Qwen.Color" },
    "x-ai": { name: "xAI", icon: "XAI" },
    "z-ai": { name: "Zhipu", icon: "Zhipu.Color" },
  };
  if (lowerName.includes("/") && namespaceVendors[namespace]) {
    return namespaceVendors[namespace];
  }

  // OpenAI
  if (
    lowerName.startsWith("gpt-") ||
    lowerName.startsWith("chatgpt-") ||
    lowerName.startsWith("chat-latest") ||
    lowerName.startsWith("codex-") ||
    lowerName.startsWith("computer-use-") ||
    lowerName.startsWith("dall-e-") ||
    lowerName.startsWith("dalle-") ||
    lowerName.startsWith("omni-moderation-") ||
    lowerName.startsWith("text-moderation-") ||
    lowerName.startsWith("sora-") ||
    lowerName.startsWith("tts-") ||
    lowerName.startsWith("whisper-") ||
    lowerName.startsWith("text-ada-") ||
    lowerName.startsWith("text-babbage-") ||
    lowerName.startsWith("text-curie-") ||
    lowerName.startsWith("text-davinci-") ||
    lowerName.startsWith("text-embedding-") ||
    lowerName === "babbage-002" ||
    lowerName === "davinci-002" ||
    lowerName === "o1" ||
    lowerName === "o3" ||
    lowerName === "o4" ||
    lowerName === "o5" ||
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
    lowerName.startsWith("gemma-") ||
    lowerName.startsWith("pregenie-") ||
    lowerName.startsWith("text-embedding-004") ||
    lowerName.startsWith("embedding-gecko-") ||
    lowerName === "embedding-001" ||
    lowerName.startsWith("veo-") ||
    lowerName.startsWith("veo3") ||
    lowerName.startsWith("veo/") ||
    lowerName.startsWith("chirp-") ||
    lowerName.startsWith("imagen-") ||
    lowerName.startsWith("nano_banana") ||
    lowerName.startsWith("nano-banana") ||
    lowerName === "gemini_omni" ||
    lowerName.startsWith("gemini_omni_") ||
    lowerName === "veo_query"
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
  if (
    lowerName.startsWith("qwen-") ||
    lowerName.startsWith("qwen2") ||
    lowerName.startsWith("qwen3") ||
    lowerName.startsWith("qwq-") ||
    lowerName.startsWith("qvq-") ||
    lowerName.startsWith("wan2") ||
    lowerName.startsWith("wanx") ||
    lowerName.startsWith("happyhorse-") ||
    lowerName.startsWith("gte-") ||
    lowerName.startsWith("paraformer-") ||
    lowerName.startsWith("sambert-") ||
    lowerName.startsWith("sensevoice")
  ) {
    return { name: "Alibaba", icon: "Qwen.Color" };
  }
  if (lowerName.startsWith("z-image")) {
    return { name: "Alibaba", icon: "Qwen.Color" };
  }
  // ByteDance Doubao
  if (
    lowerName.startsWith("doubao-") ||
    lowerName.startsWith("seed-") ||
    lowerName.startsWith("seedream-") ||
    lowerName.startsWith("seedance-") ||
    lowerName.startsWith("jimeng-")
  ) {
    return { name: "ByteDance", icon: "Doubao.Color" };
  }
  // Moonshot
  if (lowerName.startsWith("moonshot-") || lowerName.startsWith("kimi-")) {
    return { name: "Moonshot", icon: "Moonshot" };
  }
  // Baidu Ernie
  if (lowerName.startsWith("ernie-")) {
    return { name: "Baidu", icon: "Ernie.Color" };
  }
  if (lowerName.startsWith("bce-")) {
    return { name: "Baidu", icon: "Ernie.Color" };
  }
  // Tencent Hunyuan
  if (lowerName.startsWith("hunyuan-")) {
    return { name: "Tencent", icon: "Hunyuan.Color" };
  }
  // Zhipu GLM
  if (
    lowerName.startsWith("glm-") ||
    lowerName.startsWith("glm_") ||
    lowerName.startsWith("chatglm-") ||
    lowerName.startsWith("chatglm_")
  ) {
    return { name: "Zhipu", icon: "Zhipu.Color" };
  }
  if (lowerName.startsWith("charglm-") || lowerName.startsWith("codegeex-")) {
    return { name: "Zhipu", icon: "Zhipu.Color" };
  }
  // Meta Llama
  if (lowerName.startsWith("llama-") || lowerName.startsWith("llama3")) {
    return { name: "Meta", icon: "Ollama" };
  }
  if (lowerName.startsWith("nemotron-")) {
    return { name: "NVIDIA", icon: "Nvidia" };
  }
  // Mistral
  if (lowerName.startsWith("mistral-") || lowerName.startsWith("mixtral-")) {
    return { name: "Mistral", icon: "Mistral.Color" };
  }
  // Minimax
  if (lowerName.startsWith("abab") || lowerName.startsWith("minimax")) {
    return { name: "MiniMax", icon: "Minimax.Color" };
  }
  if (lowerName.startsWith("image-01")) {
    return { name: "MiniMax", icon: "Minimax.Color" };
  }
  if (lowerName.startsWith("hailuo")) {
    return { name: "MiniMax", icon: "Minimax.Color" };
  }
  if (lowerName.startsWith("mimo-")) {
    return { name: "Xiaomi", icon: "Xiaomi" };
  }
  if (lowerName.startsWith("yi-")) {
    return { name: "01.AI", icon: "Yi" };
  }
  if (lowerName.startsWith("spark-")) {
    return { name: "iFLYTEK Spark", icon: "Box" };
  }
  if (lowerName.startsWith("step-")) {
    return { name: "StepFun", icon: "StepFun" };
  }
  if (lowerName.startsWith("baichuan")) {
    return { name: "Baichuan", icon: "Baichuan" };
  }
  if (lowerName.startsWith("internlm") || lowerName.startsWith("intern-lm")) {
    return { name: "InternLM", icon: "Box" };
  }
  if (lowerName.startsWith("command-") || lowerName.startsWith("cohere-")) {
    return { name: "Cohere", icon: "Box" };
  }
  if (lowerName.startsWith("jamba")) {
    return { name: "AI21", icon: "Box" };
  }
  if (lowerName.startsWith("bge-")) {
    return { name: "BAAI", icon: "BAAI" };
  }
  if (lowerName.startsWith("longcat")) {
    return { name: "Meituan", icon: "Meituan" };
  }
  if (lowerName.startsWith("ling-") || lowerName.startsWith("ring-")) {
    return { name: "InclusionAI", icon: "InclusionAI" };
  }
  if (lowerName.startsWith("composer-")) {
    return { name: "Cursor", icon: "Box" };
  }
  if (
    lowerName.startsWith("act_two/") ||
    lowerName.startsWith("aleph2/") ||
    lowerName.startsWith("gen3") ||
    lowerName.startsWith("gen4") ||
    lowerName.startsWith("runway_")
  ) {
    return { name: "Runway", icon: "Runway" };
  }
  if (lowerName.startsWith("kling-") || lowerName.startsWith("kling_")) {
    return { name: "Kling AI", icon: "Kling.Color" };
  }
  if (lowerName.startsWith("kat-") || lowerName.startsWith("kat_")) {
    return { name: "Kwai Kolors", icon: "Box" };
  }
  if (
    lowerName.startsWith("eleven_") ||
    lowerName.startsWith("scribe_") ||
    lowerName === "dubbing"
  ) {
    return { name: "ElevenLabs", icon: "Box" };
  }
  if (
    lowerName === "flux" ||
    lowerName.startsWith("flux-") ||
    lowerName.startsWith("flux_")
  ) {
    return { name: "FLUX", icon: "Flux" };
  }
  if (
    lowerName.startsWith("mj_") ||
    lowerName.startsWith("mj-") ||
    lowerName.startsWith("midjourney")
  ) {
    return { name: "Midjourney", icon: "Midjourney" };
  }
  if (lowerName.startsWith("mureka")) {
    return { name: "Mureka", icon: "Box" };
  }
  if (
    lowerName === "luma-video" ||
    lowerName.startsWith("luma_") ||
    lowerName.startsWith("luma-")
  ) {
    return { name: "Luma", icon: "Luma" };
  }
  if (
    lowerName === "suno" ||
    lowerName.startsWith("suno_") ||
    lowerName.startsWith("suno-")
  ) {
    return { name: "Suno", icon: "Suno" };
  }
  if (lowerName.startsWith("pixverse/")) {
    return { name: "PixVerse", icon: "Pixverse" };
  }
  if (lowerName.startsWith("viggle/")) {
    return { name: "Viggle", icon: "Viggle" };
  }
  if (lowerName.startsWith("vidu")) {
    return { name: "Vidu", icon: "Vidu" };
  }
  if (lowerName.startsWith("jina-")) {
    return { name: "Jina AI", icon: "Jina" };
  }
  if (lowerName.startsWith("sparkdesk-")) {
    return { name: "iFLYTEK Spark", icon: "Box" };
  }
  if (lowerName.startsWith("stable-diffusion")) {
    return { name: "Stability", icon: "Stability" };
  }
  if (lowerName.startsWith("pika-")) {
    return { name: "Pika", icon: "Box" };
  }

  return null;
}

function isGenericVendorName(vendorName?: string) {
  const normalized = String(vendorName || "")
    .trim()
    .toLowerCase();
  return (
    !normalized ||
    [
      "api",
      "custom",
      "default",
      "model",
      "models",
      "other",
      "system",
      "unknown",
    ].includes(normalized)
  );
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
  if (isOcoolaiProprietaryModelName(normalizedModelName)) {
    return { name: "Ocoolai", icon: "Box" };
  }
  const [prefix] = normalizedModelName.split("/", 1);
  const normalizedPrefix = prefix.trim().toLowerCase();
  const inferredVendor = inferVendorFromModelName(normalizedModelName);

  if (inferredVendor) {
    return inferredVendor;
  }

  // Ocoolai 有时会把上游路由商放在命名空间前，例如 Ascend/DeepSeek-R1。
  // 先识别斜杠后的真实模型 ID，避免把路由商误显示为模型商。
  const namespacedModelVendor = normalizedModelName
    .split("/")
    .slice(1)
    .map((segment) => inferVendorFromModelName(segment))
    .find(Boolean);
  if (namespacedModelVendor) {
    return namespacedModelVendor;
  }

  const prefixVendorMap: Record<string, { name: string; icon?: string }> = {
    "01-ai": { name: "01.AI", icon: "Yi" },
    "01ai": { name: "01.AI", icon: "Yi" },
    ai21: { name: "AI21", icon: "Box" },
    ascend: { name: "Ascend", icon: "Box" },
    anthropic: { name: "Anthropic", icon: "Claude.Color" },
    amazon: { name: "Amazon", icon: "Box" },
    "amazon-nova": { name: "Amazon", icon: "Box" },
    azure: { name: "Microsoft", icon: "Azure" },
    baai: { name: "BAAI", icon: "Box" },
    baidu: { name: "Baidu", icon: "Ernie.Color" },
    baichuan: { name: "Baichuan", icon: "Baichuan" },
    "baichuan-inc": { name: "Baichuan", icon: "Baichuan" },
    bytedance: { name: "ByteDance", icon: "Doubao.Color" },
    cohere: { name: "Cohere", icon: "Box" },
    "deepseek-ai": { name: "DeepSeek", icon: "DeepSeek.Color" },
    iflytek: { name: "iFLYTEK Spark", icon: "Box" },
    internlm: { name: "InternLM", icon: "Box" },
    kat: { name: "Kwai Kolors", icon: "Box" },
    "kat-coder": { name: "Kwai Kolors", icon: "Box" },
    "kat-dev": { name: "Kwai Kolors", icon: "Box" },
    kwaipilot: { name: "Kwai Kolors", icon: "Box" },
    google: { name: "Google", icon: "Gemini.Color" },
    "google-ai": { name: "Google", icon: "Gemini.Color" },
    "ibm-granite": { name: "IBM", icon: "Box" },
    "meta-llama": { name: "Meta", icon: "Ollama" },
    meta: { name: "Meta", icon: "Ollama" },
    microsoft: { name: "Microsoft", icon: "Azure" },
    mistralai: { name: "Mistral", icon: "Mistral.Color" },
    minimax: { name: "MiniMax", icon: "Minimax.Color" },
    moonshot: { name: "Moonshot", icon: "Moonshot" },
    moonshotai: { name: "Moonshot", icon: "Moonshot" },
    nvidia: { name: "NVIDIA", icon: "Box" },
    ocoolai: { name: "Ocoolai", icon: "Box" },
    openai: { name: "OpenAI", icon: "OpenAI" },
    openrouter: { name: "OpenRouter", icon: "Box" },
    perplexity: { name: "Perplexity", icon: "Box" },
    qwen: { name: "Alibaba", icon: "Qwen.Color" },
    "zai-org": { name: "Zhipu", icon: "Zhipu.Color" },
    tencent: { name: "Tencent", icon: "Hunyuan.Color" },
    web: { name: "Web", icon: "Globe" },
    "x-ai": { name: "xAI", icon: "XAI" },
    xai: { name: "xAI", icon: "XAI" },
    "z-ai": { name: "Zhipu", icon: "Zhipu.Color" },
    "zhipu-ai": { name: "Zhipu", icon: "Zhipu.Color" },
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

  return null;
}

function inferVendorFromDeclaredModelOwner(
  model: Record<string, unknown>,
): { name: string; icon?: string } | null {
  const commonVendor = getDeclaredModelVendor(model);
  if (commonVendor) return commonVendor;
  const declaredVendorAliases: Record<string, { name: string; icon?: string }> =
    {
      alibaba: { name: "Alibaba", icon: "Qwen.Color" },
      阿里巴巴: { name: "Alibaba", icon: "Qwen.Color" },
      bytedance: { name: "ByteDance", icon: "Doubao.Color" },
      字节跳动: { name: "ByteDance", icon: "Doubao.Color" },
      火山引擎: { name: "ByteDance", icon: "Doubao.Color" },
      deepseek: { name: "DeepSeek", icon: "DeepSeek.Color" },
      flux: { name: "FLUX", icon: "Flux" },
      iflytek: { name: "iFLYTEK Spark", icon: "Box" },
      讯飞: { name: "iFLYTEK Spark", icon: "Box" },
      讯飞星火: { name: "iFLYTEK Spark", icon: "Box" },
      minimax: { name: "MiniMax", icon: "Minimax.Color" },
      "mini max": { name: "MiniMax", icon: "Minimax.Color" },
      "01.ai": { name: "01.AI", icon: "Yi" },
      "01-ai": { name: "01.AI", icon: "Yi" },
      零一万物: { name: "01.AI", icon: "Yi" },
      zhipu: { name: "Zhipu", icon: "Zhipu.Color" },
      "zhipu ai": { name: "Zhipu", icon: "Zhipu.Color" },
      "z.ai": { name: "Zhipu", icon: "Zhipu.Color" },
      智谱: { name: "Zhipu", icon: "Zhipu.Color" },
    };
  const ownerFields = [
    "vendor",
    "vendor_name",
    "vendorName",
    "developer",
    "developer_name",
    "developerName",
    "owned_by",
    "ownedBy",
    "owner",
    "organization",
    "organization_name",
    "organizationName",
    "author",
    "publisher",
    "company",
  ];

  for (const field of ownerFields) {
    const owner = model[field];
    if (typeof owner !== "string" || isGenericVendorName(owner)) continue;
    const declaredVendor = declaredVendorAliases[owner.trim().toLowerCase()];
    if (declaredVendor) return declaredVendor;
    return inferVendorFromOcoolaiModel(`${owner}/_`);
  }

  return null;
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
        if (first && typeof first === "object" && getRawModelName(first)) {
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
    const isAiHubMixBrandedModel = String(modelName || "")
      .toLowerCase()
      .includes("aihubmix");

    // 提取供应商信息
    let vendor: { id: number; name: string; icon?: string } | undefined;

    // Auto/默认/系统是选择策略而非真实模型商，必须覆盖上游可能返回的
    // vendor_id、owned_by 等字段，固定进入 Custom 分组。
    if (isCustomAutoModelName(modelName)) {
      vendor = { id: -5, name: "Custom", icon: "default" };
    }

    // YutoAPI: 有 vendor_id 和 vendors 数组
    if (!vendor && m.vendor_id !== undefined && vendorsMap) {
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
    else if (!vendor && m.developer_id !== undefined && vendorsMap) {
      const vendorInfo = vendorsMap[m.developer_id];
      if (vendorInfo) {
        vendor = {
          id: m.developer_id,
          name: vendorInfo.name,
          icon: vendorInfo.icon,
        };
      }
    }
    if (vendor) {
      const normalizedVendor = normalizeModelVendorName(vendor.name);
      if (normalizedVendor) {
        vendor = { ...vendor, ...normalizedVendor };
      }
    }
    if (!vendor) {
      const declaredVendor = inferVendorFromDeclaredModelOwner(m);
      if (declaredVendor) {
        vendor = {
          id: -3,
          name: declaredVendor.name,
          icon: declaredVendor.icon,
        };
      }
    }
    // Ocoolai / 其他：没有声明模型商时，优先按命名空间前缀分类，再降级到模型名前缀推断
    if (!vendor) {
      const inferred = inferVendorFromOcoolaiModel(modelName);
      if (inferred) {
        vendor = {
          id: -1, // 推断的供应商没有固定 ID
          name: inferred.name,
          icon: inferred.icon,
        };
      }
    }
    if (!vendor) {
      const providerVendor = getProviderFallbackModelVendor(
        providerId,
        providerName,
      );
      if (providerVendor) {
        vendor = { id: -4, ...providerVendor };
      }
    }

    if (catalogMetadata?.vendor && !isCustomAutoModelName(modelName)) {
      vendor = catalogMetadata.vendor;
    }

    const inferredVendor = inferVendorFromModelName(String(modelName || ""));
    if (
      inferredVendor &&
      (isGenericVendorName(vendor?.name) || inferredVendor.name === "Kling AI")
    ) {
      vendor = {
        id: -1,
        name: inferredVendor.name,
        icon: inferredVendor.icon,
      };
    }

    if (
      isOcoolProfileLike({ name: providerName || providerId }) &&
      isOcoolaiProprietaryModelName(modelName)
    ) {
      vendor = { id: -4, name: "Ocoolai", icon: "Box" };
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
  requestTimeoutMs?: number;
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

type BrowserModelKeyRoute = {
  cachedModelPath?: string;
  modelCount?: number;
  updatedAt?: string;
};

function isFreshModelFetchRoute(route?: BrowserModelKeyRoute | null) {
  const updatedAt = Date.parse(String(route?.updatedAt || ""));
  return (
    Number.isFinite(updatedAt) &&
    Date.now() - updatedAt < MODEL_FETCH_ROUTE_REVALIDATE_MS
  );
}

async function loadBrowserModelKeyRoutes(profileId: string, apiKeys: string[]) {
  if (isServerSide() || !profileId || apiKeys.length === 0) {
    return { keyRoutes: [], knownRoutes: [] };
  }
  try {
    const response = await fetch("/api/db/models/routes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, apiKeys }),
      cache: "no-store",
    });
    if (!response.ok) return { keyRoutes: [], knownRoutes: [] };
    const payload = await response.json();
    const routes = Array.isArray(payload?.routes) ? payload.routes : [];
    const keyRoutes = apiKeys.map((_, index) => {
      const matched = routes.find((item: any) => item?.index === index);
      return (matched?.route || null) as BrowserModelKeyRoute | null;
    });
    const knownRoutes = Array.isArray(payload?.knownRoutes)
      ? (payload.knownRoutes as BrowserModelKeyRoute[])
      : [];
    return { keyRoutes, knownRoutes };
  } catch {
    return { keyRoutes: [], knownRoutes: [] };
  }
}

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
        const timeoutId = setTimeout(
          () => controller.abort(),
          options?.requestTimeoutMs || MODEL_FETCH_REQUEST_TIMEOUT_MS,
        );
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

  if (!options?.suppressCandidateErrors) {
    logFetchModels(`[Fetch Models] ⚠️ ${logLabel}全部候选均未成功`, {
      tried: attempts,
      lastError: lastError?.message,
    });
  }
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
    modelFetchUrl?: string;
    silentLogs?: boolean;
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
    const rememberedModelListUpdatedAt =
      getRememberedModelListUpdatedAt(pathMemoryParams);
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
    const configuredModelFetchUrl = String(
      fetchOptions?.modelFetchUrl ||
        matchedProviderProfile?.modelFetchUrl ||
        "",
    ).trim();
    const silentFetchLogs = Boolean(fetchOptions?.silentLogs);
    const configuredModelFetchBaseUrl = (() => {
      if (!configuredModelFetchUrl) return "";
      try {
        return new URL(configuredModelFetchUrl).origin;
      } catch {
        return "";
      }
    })();
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
    const modelFetchKeyEntries = (
      configuredModelFetchUrl
        ? [
            {
              groupName: undefined as string | undefined,
              apiKey: matchedProviderProfile?.modelFetchApiKey || apiKey || "",
            },
          ]
        : [
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
    )
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
    const browserRouteState = matchedProviderProfile?.id
      ? await loadBrowserModelKeyRoutes(
          matchedProviderProfile.id,
          modelFetchKeyEntries.map((entry) => entry.apiKey),
        )
      : { keyRoutes: [], knownRoutes: [] };
    const browserRouteByApiKey = new Map(
      modelFetchKeyEntries.map((entry, index) => [
        entry.apiKey,
        browserRouteState.keyRoutes[index],
      ]),
    );
    const bestKnownProviderPath =
      browserRouteState.knownRoutes[0]?.cachedModelPath;
    const rememberedBrowserRoute = rememberedModelListPath
      ? {
          cachedModelPath: rememberedModelListPath,
          modelCount: 0,
          updatedAt: rememberedModelListUpdatedAt
            ? new Date(rememberedModelListUpdatedAt).toISOString()
            : undefined,
        }
      : undefined;
    if (!silentFetchLogs) {
      console.log("[Fetch Models] 🧭 路径缓存读取完成", {
        keyCount: modelFetchKeyEntries.length,
        keyRouteCount: browserRouteState.keyRoutes.filter(Boolean).length,
        knownRouteCount: browserRouteState.knownRoutes.length,
        localFallbackAvailable: isFreshModelFetchRoute(rememberedBrowserRoute),
      });
    }

    const collectAllModelPayloads = async (
      candidateUrls: FetchCandidate[],
      requestHeaders: Record<string, string>,
      requestBaseUrl?: string,
      authCachePrefix?: string,
      useDeferredFallbackKeys = false,
    ) => {
      const primaryEntries = modelFetchKeyEntries.filter(
        (entry) => entry.groupName !== "__balance_query_key",
      );
      const deferredEntries = modelFetchKeyEntries.filter(
        (entry) => entry.groupName === "__balance_query_key",
      );
      const entries =
        (useDeferredFallbackKeys ? deferredEntries : primaryEntries).length > 0
          ? useDeferredFallbackKeys
            ? deferredEntries
            : primaryEntries
          : [{ groupName: undefined, apiKey: modelFetchApiKeyCandidates[0] }];
      const findCandidateByPath = (rememberedPath?: string) =>
        rememberedPath
          ? candidateUrls.find((candidate) => {
              const path =
                typeof candidate === "string"
                  ? candidate
                  : candidate.upstreamPath || candidate.url;
              return path === rememberedPath;
            })
          : undefined;
      const buildKnownCandidate = (
        path?: string,
      ): FetchCandidate | undefined => {
        if (!path) return undefined;
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        return (
          findCandidateByPath(normalizedPath) || {
            url: `/api/proxy${normalizedPath}`,
            upstreamPath: normalizedPath,
          }
        );
      };
      const knownCandidates = (
        configuredModelFetchUrl ? [] : browserRouteState.knownRoutes
      )
        .map((route) => buildKnownCandidate(route.cachedModelPath))
        .filter((candidate): candidate is FetchCandidate => Boolean(candidate));
      const routedCandidateUrls = [...knownCandidates, ...candidateUrls];
      const routeFetch = await fetchModelRoutesFast(
        entries.map((entry, index) => ({
          entry: {
            ...entry,
            keyIndex: index + 1,
            cachedModelCount:
              browserRouteByApiKey.get(entry.apiKey)?.modelCount || 0,
          },
          cachedCandidate:
            !configuredModelFetchUrl &&
            isFreshModelFetchRoute(
              browserRouteByApiKey.get(entry.apiKey) ||
                browserRouteState.knownRoutes[0] ||
                rememberedBrowserRoute,
            )
              ? buildKnownCandidate(
                  browserRouteByApiKey.get(entry.apiKey)?.cachedModelPath ||
                    bestKnownProviderPath ||
                    rememberedModelListPath,
                )
              : undefined,
        })),
        routedCandidateUrls,
        async (entry, candidate, context) => {
          const nextHeaders = {
            ...requestHeaders,
            ...buildAuthHeaders(entry.apiKey, authType),
          };
          const data = await fetchJsonWithCandidates(
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
              logAttempt: !silentFetchLogs && !context.fromCache,
              logSuccess: false,
              getModelCount: (payload) =>
                extractModelListFromResponse(payload, requestBaseUrl).length,
              validateJson: (payload) =>
                extractModelListFromResponse(payload, requestBaseUrl).length >
                0,
              outerIndex: context.candidateIndex,
              outerTotal: context.candidateTotal,
              keyIndex: entry.keyIndex,
              keyTotal: entries.length,
              requestTimeoutMs:
                context.candidateTotal === 1
                  ? MODEL_FETCH_SINGLE_ROUTE_TIMEOUT_MS
                  : MODEL_FETCH_REQUEST_TIMEOUT_MS,
            },
          );
          return data;
        },
        (candidate) =>
          typeof candidate === "string"
            ? candidate
            : candidate.upstreamPath || candidate.url,
        {
          getResultScore: (payload) =>
            extractModelListFromResponse(payload, requestBaseUrl).length,
          acceptCachedResult: (entry, payload) =>
            extractModelListFromResponse(payload, requestBaseUrl).length >=
            entry.cachedModelCount,
          discoveryBatchSize: 8,
        },
      );
      const successfulResults = routeFetch.results.map((result) => {
        payloadResults.push({
          data: result.result,
          groupName: result.entry.groupName,
          candidate: result.candidate,
        });
        const path =
          typeof result.candidate === "string"
            ? result.candidate
            : result.candidate.upstreamPath || result.candidate.url;
        return {
          path,
          apiKey: result.entry.apiKey,
          modelCount: extractModelListFromResponse(
            result.result,
            requestBaseUrl,
          ).length,
          keyLabel: `${result.entry.keyIndex}/${entries.length}（${
            result.entry.groupName || "default"
          }）`,
          fromCache: result.fromCache,
        };
      });
      const bestSuccessfulResult = successfulResults.reduce<
        (typeof successfulResults)[number] | undefined
      >(
        (best, result) =>
          !best || result.modelCount > best.modelCount ? result : best,
        undefined,
      );

      if (!silentFetchLogs)
        console.log("[Fetch Models] ⚡ 快速路径探测完成", {
          keyCount: entries.length,
          resolvedKeyCount: successfulResults.length,
          cacheHitKeyCount: successfulResults.filter(
            (result) => result.fromCache,
          ).length,
          discoverySuccessKeyCount: successfulResults.filter(
            (result) => !result.fromCache,
          ).length,
          unresolvedKeyCount: routeFetch.unresolvedEntries.length,
          cachedFailureReasons: routeFetch.cachedFailureReasons,
          cachedRejectedResultCount: routeFetch.cachedRejectedResultCount,
        });

      if (!bestSuccessfulResult) {
        if (!useDeferredFallbackKeys && deferredEntries.length > 0) {
          if (!silentFetchLogs)
            console.log(
              "[Fetch Models] ↪️ 常规模型 Key 全部失败，开始尝试后备 Key",
            );
          await collectAllModelPayloads(
            candidateUrls,
            requestHeaders,
            requestBaseUrl,
            authCachePrefix,
            true,
          );
        }
        return;
      }

      if (!silentFetchLogs)
        console.log("[Fetch Models] 📌 已选择模型数量最多的成功路径", {
          path: bestSuccessfulResult.path,
          key: bestSuccessfulResult.keyLabel,
          modelCount: bestSuccessfulResult.modelCount,
          mergedPathCount: payloadResults.length,
        });
      // 仅缓存本轮模型数量最多的路径；所有成功路径的模型会在后续统一去重合并。
      rememberModelListPath(
        pathMemoryParams,
        bestSuccessfulResult.path,
        bestSuccessfulResult.apiKey,
      );
      if (!bestSuccessfulResult.fromCache) {
        if (!silentFetchLogs)
          console.log("[Fetch Models] 💾 已缓存模型数量最多的路径", {
            path: bestSuccessfulResult.path,
          });
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
      const useAiHubMixCatalog = isAiHubMixUrl(effectiveBaseUrl);

      headers["x-base-url"] =
        configuredModelFetchBaseUrl ||
        (provider === ServiceProvider.Local ? baseWithoutV1 : proxyBaseUrl);

      // AiHubMix 的 `/v1/models` 按当前 Key 的权限范围返回，不能代表平台
      // 官方完整目录。模型管理器需优先使用 `/api/v1/models` 的完整目录。
      const allCandidateUrls: FetchCandidate[] = configuredModelFetchUrl
        ? buildProxyModelFetchCandidates(baseUrl, [
            configuredModelFetchUrl,
          ]).slice(0, 1)
        : useAiHubMixCatalog
        ? [
            {
              url: `/api/aihubmix/models?baseUrl=${encodeURIComponent(
                baseWithoutV1,
              )}`,
              displayBaseUrl: baseWithoutV1,
              upstreamPath: "/api/v1/models",
              note: "AiHubMix 官方完整目录",
            },
          ]
        : buildProxyModelFetchCandidates(baseUrl, rememberedModelListPath);
      const candidateUrls = allCandidateUrls;

      if (!silentFetchLogs) {
        logFetchModels(
          `[Fetch Models] 🗃️ 缓存直连：仅尝试 ${candidateUrls.length} 个接口`,
        );
      }

      await collectAllModelPayloads(
        candidateUrls,
        headers,
        baseUrl,
        normalizedBaseUrl ? `model-fetch:${normalizedBaseUrl}` : undefined,
      );
      data = payloadResults[0]?.data;
    } else {
      const normalizedProviderBaseUrl = baseUrl
        ? normalizeBaseUrl(baseUrl)
        : "";
      const allCandidateUrls = configuredModelFetchUrl
        ? buildProxyModelFetchCandidates(normalizedProviderBaseUrl, [
            configuredModelFetchUrl,
          ]).slice(0, 1)
        : isLocalModelProxyBaseUrl(normalizedProviderBaseUrl)
        ? [apiPath]
        : normalizedProviderBaseUrl && profileOpenAICompatible
        ? buildProxyModelFetchCandidates(
            normalizedProviderBaseUrl,
            rememberedModelListPath,
          )
        : [apiPath];
      const candidateUrls = allCandidateUrls;

      const nextHeaders = { ...headers };
      if (
        normalizedProviderBaseUrl &&
        !isLocalModelProxyBaseUrl(normalizedProviderBaseUrl)
      ) {
        nextHeaders["x-base-url"] =
          configuredModelFetchBaseUrl ||
          normalizedProviderBaseUrl.replace(/\/v1$/i, "");
      }

      if (!silentFetchLogs) {
        logFetchModels(
          `[Fetch Models] 🔁 正在尝试模型接口：${candidateUrls.length} 个`,
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
      } catch (error) {
        if (!silentFetchLogs) {
          console.warn(
            `[Fetch Models] ⚠️ 从 ${provider} 获取模型失败:`,
            error instanceof Error ? error.message : String(error),
          );
        }
        return { models: [], total: 0 };
      }
    }

    // 标准化模型列表响应
    let models: any[] = [];
    let vendorsMap: Record<number, { name: string; icon?: string }> | undefined;
    let catalogMetadataMap:
      | Map<
          string,
          { rank: number; vendor?: { id: number; name: string; icon?: string } }
        >
      | undefined;

    // YutoAPI: 从 vendors 数组构建映射
    if (isYutoApiUrl(baseUrl, profileName || matchedProviderProfile?.name)) {
      if (data?.vendors && Array.isArray(data.vendors)) {
        vendorsMap = {};
        data.vendors.forEach((v: any) => {
          vendorsMap![v.id] = {
            name: v.name,
            icon: v.icon,
          };
        });
      }
    }
    // AiHubMix: 使用预定义的映射表和目录顺序
    else if (isAiHubMixUrl(baseUrl)) {
      vendorsMap = AIHUBMIX_VENDOR_MAP;
      try {
        catalogMetadataMap = await getAiHubMixCatalogMetadataMap(baseUrl!);
      } catch (error) {
        if (!silentFetchLogs) {
          console.warn(
            "[Fetch Models] 获取 AihubMix 模型目录顺序失败，将回退到原始返回顺序",
            error instanceof Error ? error.message : String(error),
          );
        }
      }
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
      const mergedModelMap = new Map<string, LLMModel>();

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
