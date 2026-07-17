import { getCanonicalProviderKey } from "../config/provider-icons";

export type ModelVendorInfo = {
  name: string;
  icon?: string;
};

const GENERIC_VENDOR_NAMES = new Set([
  "",
  "api",
  "custom",
  "default",
  "model",
  "models",
  "other",
  "system",
  "unknown",
]);

const KNOWN_VENDOR_ALIASES: Record<string, ModelVendorInfo> = {
  "360": { name: "360", icon: "Box" },
  "360 ai": { name: "360", icon: "Box" },
  "360gpt": { name: "360", icon: "Box" },
  "360智脑": { name: "360", icon: "Box" },
  cursor: { name: "Cursor", icon: "Box" },
  "cursor ai": { name: "Cursor", icon: "Box" },
  "cursor composer": { name: "Cursor", icon: "Box" },
  "01-ai": { name: "01.AI", icon: "Yi" },
  "01.ai": { name: "01.AI", icon: "Yi" },
  "01ai": { name: "01.AI", icon: "Yi" },
  ai21: { name: "AI21", icon: "Box" },
  ali: { name: "Alibaba", icon: "Qwen.Color" },
  alibaba: { name: "Alibaba", icon: "Qwen.Color" },
  amazon: { name: "Amazon", icon: "Box" },
  aws: { name: "Amazon", icon: "Box" },
  "amazon-nova": { name: "Amazon", icon: "Box" },
  anthropic: { name: "Anthropic", icon: "Claude.Color" },
  claude: { name: "Anthropic", icon: "Claude.Color" },
  ascend: { name: "Ascend", icon: "Box" },
  azure: { name: "Microsoft", icon: "Azure" },
  baai: { name: "BAAI", icon: "BAAI" },
  baichuan: { name: "Baichuan", icon: "Baichuan" },
  "baichuan-inc": { name: "Baichuan", icon: "Baichuan" },
  baidu: { name: "Baidu", icon: "Ernie.Color" },
  "gemini (anthropic format)": { name: "Google", icon: "Gemini.Color" },
  bytedance: { name: "ByteDance", icon: "Doubao.Color" },
  doubao: { name: "ByteDance", icon: "Doubao.Color" },
  cohere: { name: "Cohere", icon: "Box" },
  deepseek: { name: "DeepSeek", icon: "DeepSeek.Color" },
  "deepseek-ai": { name: "DeepSeek", icon: "DeepSeek.Color" },
  flux: { name: "FLUX", icon: "Flux" },
  google: { name: "Google", icon: "Gemini.Color" },
  "google-ai": { name: "Google", icon: "Gemini.Color" },
  gemini: { name: "Google", icon: "Gemini.Color" },
  gemma: { name: "Google", icon: "Gemini.Color" },
  veo: { name: "Google", icon: "Gemini.Color" },
  huggingface: { name: "Hugging Face", icon: "Box" },
  "hugging face": { name: "Hugging Face", icon: "Box" },
  iflytek: { name: "iFLYTEK Spark", icon: "Box" },
  "ibm-granite": { name: "IBM", icon: "Box" },
  internlm: { name: "InternLM", icon: "Box" },
  kat: { name: "Kwai Kolors", icon: "Box" },
  "kat coder": { name: "Kwai Kolors", icon: "Box" },
  "kat-coder": { name: "Kwai Kolors", icon: "Box" },
  "kat dev": { name: "Kwai Kolors", icon: "Box" },
  "kat-dev": { name: "Kwai Kolors", icon: "Box" },
  kuaishou: { name: "Kling AI", icon: "Kling.Color" },
  kwaipilot: { name: "Kwai Kolors", icon: "Box" },
  minimax: { name: "MiniMax", icon: "Minimax.Color" },
  "mini max": { name: "MiniMax", icon: "Minimax.Color" },
  meta: { name: "Meta", icon: "Ollama" },
  "meta llama": { name: "Meta", icon: "Ollama" },
  "meta-llama": { name: "Meta", icon: "Ollama" },
  microsoft: { name: "Microsoft", icon: "Azure" },
  mistralai: { name: "Mistral", icon: "Mistral.Color" },
  moonshot: { name: "Moonshot", icon: "Moonshot" },
  moonshotai: { name: "Moonshot", icon: "Moonshot" },
  kimi: { name: "Moonshot", icon: "Moonshot" },
  nvidia: { name: "NVIDIA", icon: "Nvidia" },
  ocoolai: { name: "Ocoolai", icon: "Box" },
  openai: { name: "OpenAI", icon: "OpenAI" },
  codex: { name: "OpenAI", icon: "OpenAI" },
  openrouter: { name: "OpenRouter", icon: "Box" },
  perplexity: { name: "Perplexity", icon: "Box" },
  qwen: { name: "Alibaba", icon: "Qwen.Color" },
  wan: { name: "Alibaba", icon: "Qwen.Color" },
  siliconflow: { name: "SiliconFlow", icon: "Box" },
  "silicon flow": { name: "SiliconFlow", icon: "Box" },
  stepfun: { name: "StepFun", icon: "StepFun" },
  "stepfun ai": { name: "StepFun", icon: "StepFun" },
  "stepfun al": { name: "StepFun", icon: "StepFun" },
  "stepfun-ai": { name: "StepFun", icon: "StepFun" },
  "step fun": { name: "StepFun", icon: "StepFun" },
  tencent: { name: "Tencent", icon: "Hunyuan.Color" },
  hunyuan: { name: "Tencent", icon: "Hunyuan.Color" },
  "z-ai": { name: "Zhipu", icon: "Zhipu.Color" },
  "zai-org": { name: "Zhipu", icon: "Zhipu.Color" },
  "zhipu-ai": { name: "Zhipu", icon: "Zhipu.Color" },
  xai: { name: "xAI", icon: "XAI" },
  "x-ai": { name: "xAI", icon: "XAI" },
  grok: { name: "xAI", icon: "XAI" },
  glm: { name: "Zhipu", icon: "Zhipu.Color" },
  chatglm: { name: "Zhipu", icon: "Zhipu.Color" },
  zhipu: { name: "Zhipu", icon: "Zhipu.Color" },
  "zhipu ai": { name: "Zhipu", icon: "Zhipu.Color" },
  "z.ai": { name: "Zhipu", icon: "Zhipu.Color" },
  阿里巴巴: { name: "Alibaba", icon: "Qwen.Color" },
  字节跳动: { name: "ByteDance", icon: "Doubao.Color" },
  火山引擎: { name: "ByteDance", icon: "Doubao.Color" },
  快手: { name: "Kling AI", icon: "Kling.Color" },
  硅基流动: { name: "SiliconFlow", icon: "Box" },
  阶跃: { name: "StepFun", icon: "StepFun" },
  智谱: { name: "Zhipu", icon: "Zhipu.Color" },
  讯飞: { name: "iFLYTEK Spark", icon: "Box" },
  讯飞星火: { name: "iFLYTEK Spark", icon: "Box" },
  零一万物: { name: "01.AI", icon: "Yi" },
};

const MODEL_VENDOR_GROUP_NAMES: Record<string, string> = {
  "01.ai": "01.AI",
  ai21: "AI21",
  aihubmix: "AihubMix",
  aionlabs: "Aion Labs",
  allenai: "AllenAI",
  alibaba: "Alibaba",
  anthropic: "Anthropic",
  baai: "BAAI",
  baidu: "Baidu",
  bytedance: "ByteDance",
  custom: "CUSTOM",
  cognitivecom: "Cognitive Computations",
  deepcogito: "Deep Cogito",
  deepseek: "DeepSeek",
  elevenlabs: "ElevenLabs",
  flux: "FLUX",
  google: "Google",
  huggingface: "Hugging Face",
  iflytek: "iFLYTEK",
  inclusionai: "InclusionAI",
  ibm: "IBM",
  kuaishou: "Kuaishou",
  kwaipilot: "Kuaishou",
  minimax: "MiniMax",
  moonshot: "Moonshot",
  nvidia: "NVIDIA",
  nexagi: "Nex AGI",
  "nex agi": "Nex AGI",
  nousresearch: "Nous Research",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  pixverse: "PixVerse",
  rekaai: "Reka AI",
  sao10k: "Sao10K",
  siliconflow: "SiliconFlow",
  suno: "Suno",
  "suno v3": "Suno",
  stepfun: "StepFun",
  tencent: "Tencent",
  thedrummer: "TheDrummer",
  undi95: "Undi95",
  xai: "xAI",
  zhipu: "Z.ai",
};

const OCOOLAI_PROPRIETARY_MODEL_NAMES = new Set([
  "concise",
  "concise-scholar",
  "detail",
  "detail-scholar",
  "ocoolai-deepresearch-v1pro",
  "ocoolai-deepresearch-v2",
  "ocoolai-deepsearch-v3",
  "ocoolai-helper",
  "parse-pdf",
  "research",
  "research-scholar",
  "search-gpts-chat",
  "speech-01-hd",
  "speech-01-turbo",
  "speech-02-hd",
  "speech-02-turbo",
  "url-analysis",
]);

const DECLARED_OWNER_FIELDS = [
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
] as const;

export function isGenericModelVendorName(value?: string) {
  return GENERIC_VENDOR_NAMES.has(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

export function formatModelVendorName(value: string) {
  return value
    .trim()
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) =>
      part.toLowerCase() === "ai"
        ? "AI"
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`,
    )
    .join(" ");
}

export function normalizeModelVendorName(
  value?: string,
): ModelVendorInfo | null {
  const source = String(value || "").trim();
  if (isGenericModelVendorName(source)) return null;
  return (
    KNOWN_VENDOR_ALIASES[source.toLowerCase()] || {
      name: formatModelVendorName(source),
      icon: "Box",
    }
  );
}

/**
 * 供应商分组的唯一可见名称。先复用模型商规范表，再按共享图标资源收敛
 * 未在规范表中的别名，避免新接口和旧缓存分别产生重复分组。
 */
export function getModelVendorGroupName(value?: string): string {
  const source = String(value || "").trim();
  if (!source) return "Other";

  const normalizedVendor = normalizeModelVendorName(source);
  const canonicalKey =
    getCanonicalProviderKey(source) ||
    getCanonicalProviderKey(normalizedVendor?.name || source);
  const normalizedKey = (canonicalKey || normalizedVendor?.name || source)
    .trim()
    .toLowerCase();

  return (
    MODEL_VENDOR_GROUP_NAMES[normalizedKey] ||
    formatModelVendorName(canonicalKey || normalizedVendor?.name || source)
  );
}

export function getDeclaredModelVendor(
  model: Record<string, unknown>,
): ModelVendorInfo | null {
  const modelIdentifiers = new Set(
    [model.id, model.name, model.model_id, model.model_name]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );

  for (const field of DECLARED_OWNER_FIELDS) {
    const value = model[field];
    if (typeof value !== "string") continue;
    const normalizedValue = value.trim().toLowerCase();
    if (isGenericModelVendorName(normalizedValue)) continue;

    // Ocoolai 等聚合接口会把 `owned_by` 填成完整模型 ID；这不是模型商，
    // 必须回退到模型 ID / 命名空间推断，避免每个模型生成一个伪分组。
    if (modelIdentifiers.has(normalizedValue)) continue;

    const knownVendor = KNOWN_VENDOR_ALIASES[normalizedValue];
    if (knownVendor) return knownVendor;

    // 未知声明只有在形态上像稳定的组织名时才作为厂商；模型 ID 通常包含
    // 数字、下划线、斜杠或主流模型系列前缀，应继续交给模型名推断。
    if (
      /[0-9_/]/.test(normalizedValue) ||
      /^(claude|codex|deepseek|gemini|glm|gpt|grok|kimi|qwen|llama|mistral|o[1345])-/.test(
        normalizedValue,
      )
    ) {
      continue;
    }

    return { name: formatModelVendorName(value), icon: "Box" };
  }
  return null;
}

export function getProviderFallbackModelVendor(providerName: string) {
  const normalizedProviderName = String(providerName || "").trim();
  if (
    !normalizedProviderName ||
    ["custom", "local"].includes(normalizedProviderName.toLowerCase())
  ) {
    return null;
  }
  return normalizeModelVendorName(normalizedProviderName);
}

export function isCustomAutoModelName(value?: string) {
  return [
    "auto",
    "automatic",
    "default",
    "system",
    "自动",
    "默认",
    "系统",
  ].includes(
    String(value || "")
      .trim()
      .toLowerCase(),
  );
}

export function isOcoolaiProprietaryModelName(value?: string) {
  return OCOOLAI_PROPRIETARY_MODEL_NAMES.has(
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/^(?:net|network)[-_.]+/, ""),
  );
}

function normalizeModelIdentifier(value?: string) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

/**
 * Ocoolai 的旧缓存曾把完整模型 ID 写进 vendor.name。仅在该值与模型 ID
 * 实质相同的情况下修正，避免覆盖上游提供的真实模型商声明。
 */
export function isModelIdentifierStoredAsVendor(
  modelName?: string,
  vendorName?: string,
) {
  const normalizedModelName = normalizeModelIdentifier(modelName);
  const normalizedVendorName = normalizeModelIdentifier(vendorName);
  return Boolean(
    normalizedModelName &&
      normalizedVendorName &&
      normalizedModelName === normalizedVendorName,
  );
}

export function inferVendorFromOcoolaiCachedModelName(value?: string) {
  const modelName = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^(?:net|network)[-_.]+/, "");

  if (
    modelName.startsWith("gpt-") ||
    modelName.startsWith("chatgpt-") ||
    /^o[1345](?:[-_.]|$)/.test(modelName)
  ) {
    return { name: "OpenAI", icon: "OpenAI" };
  }
  if (modelName.startsWith("glm-") || modelName.startsWith("chatglm-")) {
    return { name: "Zhipu", icon: "Zhipu.Color" };
  }
  if (
    modelName.startsWith("nano_banana") ||
    modelName.startsWith("nano-banana")
  ) {
    return { name: "Google", icon: "Gemini.Color" };
  }
  if (modelName.startsWith("bce-")) {
    return { name: "Baidu", icon: "Ernie.Color" };
  }
  if (modelName.startsWith("charglm-") || modelName.startsWith("codegeex-")) {
    return { name: "Zhipu", icon: "Zhipu.Color" };
  }
  if (modelName.startsWith("luma-video")) {
    return { name: "Luma", icon: "Luma" };
  }
  if (
    modelName.startsWith("embedding-gecko") ||
    modelName === "embedding-001"
  ) {
    return { name: "Google", icon: "Gemini.Color" };
  }
  if (modelName.startsWith("z-image")) {
    return { name: "Alibaba", icon: "Qwen.Color" };
  }
  return null;
}
